$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$env:DOCKER_CONFIG=Join-Path $root '.local\docker'
[IO.Directory]::CreateDirectory($env:DOCKER_CONFIG)|Out-Null
$null=& docker.exe info --format '{{.ServerVersion}}' 2>$null
if($LASTEXITCODE -ne 0){
 $desktop=Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'
 if(-not(Test-Path -LiteralPath $desktop)){throw 'Start/install Docker Desktop before running RabbitMQ.'}
 Start-Process -FilePath $desktop -WindowStyle Hidden
 $ready=$false
 for($i=0;$i -lt 90;$i++){Start-Sleep -Seconds 1;$null=& docker.exe info --format '{{.ServerVersion}}' 2>$null;if($LASTEXITCODE -eq 0){$ready=$true;break}}
 if(-not $ready){throw 'Docker Engine did not become ready.'}
}
if(-not(Test-Path -LiteralPath '.local\rabbitmq\bootstrap.env')){throw 'Run npm.cmd run worker:configure first.'}
$existing=& docker.exe ps -a --filter name=^/pj-flim-rabbitmq$ --format '{{.Names}}'
if($existing){
 $labels=(& docker.exe inspect --format '{{json .Config.Labels}}' pj-flim-rabbitmq)|ConvertFrom-Json
 if($labels.'com.pj-flim.service' -ne 'rabbitmq'){throw 'Existing container is not owned by this project.'}
 & docker.exe start pj-flim-rabbitmq
}else{
 & docker.exe run -d --name pj-flim-rabbitmq --label com.pj-flim.service=rabbitmq --restart unless-stopped --env-file .local/rabbitmq/bootstrap.env -p 127.0.0.1:5672:5672 -p 127.0.0.1:15672:15672 -v pj-flim-rabbitmq-data:/var/lib/rabbitmq rabbitmq:4-management@sha256:af6f50d38098d8bd52fef7f3fa85015dd8b2bf6def58e995bf584ae9ba0f6407
}
if($LASTEXITCODE -ne 0){throw 'RabbitMQ container startup failed.'}
Write-Output 'RabbitMQ is starting on localhost:5672; persistent data uses pj-flim-rabbitmq-data.'
