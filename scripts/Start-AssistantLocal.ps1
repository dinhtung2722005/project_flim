param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
$pjAssistantRoot='E:\pj-Flim'
Set-Location -LiteralPath $pjAssistantRoot
if(-not(Test-Path -LiteralPath '.env.assistant.local') -or -not(Test-Path -LiteralPath '.local\assistant\agent.env')){ npm.cmd run assistant:configure; if($LASTEXITCODE -ne 0){throw 'Assistant configuration failed.'} }
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-RabbitMQ.ps1
if($LASTEXITCODE -ne 0){throw 'RabbitMQ startup failed.'}
if(-not $SkipBuild){npm.cmd run build:all;if($LASTEXITCODE -ne 0){throw 'Build failed.'}}
$pjDeps=Join-Path $pjAssistantRoot '.local\agent-build\deps'
if(-not(Test-Path -LiteralPath (Join-Path $pjDeps 'langchain_ollama'))){
 $pjDeps=Join-Path $pjAssistantRoot '.local\assistant\deps'
 [IO.Directory]::CreateDirectory($pjDeps)|Out-Null
 docker run --rm --mount "type=bind,source=$pjDeps,target=/deps" --mount "type=bind,source=$pjAssistantRoot\apps\agent,target=/app,readonly" python:3.12-slim python -m pip install --disable-pip-version-check --target /deps -r /app/requirements-website.txt
 if($LASTEXITCODE -ne 0){throw 'Assistant Python dependency installation failed.'}
}
$pjContainerName='pj-flim-assistant-agent'
$pjExistingId=docker ps -aq --filter "name=^/$pjContainerName$"
if($pjExistingId){
 $pjOwnedLabel=docker inspect --format '{{json .Config.Labels}}' $pjExistingId | ConvertFrom-Json
 if($pjOwnedLabel.'pj-flim.service' -ne 'assistant-agent'){throw 'Refusing to replace an unrelated container.'}
 docker stop $pjExistingId | Out-Null
 docker rm $pjExistingId | Out-Null
}
docker run -d --name $pjContainerName --label pj-flim.service=assistant-agent --restart unless-stopped -p 127.0.0.1:8010:8010 --env-file "$pjAssistantRoot\.local\assistant\agent.env" --mount "type=bind,source=$pjDeps,target=/deps,readonly" --mount "type=bind,source=$pjAssistantRoot\apps\agent,target=/app,readonly" -e PYTHONPATH=/deps:/app -w /app python:3.12-slim python -m pjflim_agent.website_server
if($LASTEXITCODE -ne 0){throw 'Assistant private service failed to start.'}
$pjPythonReady=$false
for($pjProbe=0;$pjProbe -lt 40;$pjProbe++){
 try{$pjServiceHealth=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8010/health' -TimeoutSec 2;if($pjServiceHealth.StatusCode -eq 200){$pjPythonReady=$true;break}}catch{}
 Start-Sleep -Milliseconds 500
}
if(-not $pjPythonReady){throw 'Assistant service/model is not ready; inspect local configuration and private container logs.'}
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-LocalProcess.ps1 -Service api
if($LASTEXITCODE -ne 0){throw 'API restart failed.'}
$pjHealthy=$false
for($pjTry=0;$pjTry -lt 25;$pjTry++){
 try{$pjHealth=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 2;if($pjHealth.StatusCode -eq 200){$pjHealthy=$true;break}}catch{}
 Start-Sleep -Milliseconds 500
}
if(-not $pjHealthy){throw 'API not ready; inspect private service logs.'}
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-LocalProcess.ps1 -Service assistant
if($LASTEXITCODE -ne 0){throw 'Assistant queue consumer failed to start.'}
Write-Output 'Assistant started: http://localhost:3000/assistant . Model weights are managed separately.'
