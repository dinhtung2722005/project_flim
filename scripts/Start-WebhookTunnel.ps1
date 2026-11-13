$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
if((Get-Content '.env.api.local' -Raw) -match '(?m)^NODE_ENV=production'){throw 'Development tunnels are disabled in production.'}
$binary=Join-Path $root '.local\tools\cloudflared.exe'
$folder=Join-Path $root '.local\worker'
[IO.Directory]::CreateDirectory((Split-Path $binary -Parent))|Out-Null
[IO.Directory]::CreateDirectory($folder)|Out-Null
if(-not(Test-Path -LiteralPath $binary)){
 Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $binary
}
$recordPath=Join-Path $folder 'tunnel-process.json'
$running=$false
if(Test-Path -LiteralPath $recordPath){
 $old=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
 $process=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$old.pid) -ErrorAction SilentlyContinue
 if($process){
  if($old.entryPoint -ne $binary -or -not $process.CommandLine.Contains($binary)){throw 'Tunnel PID belongs to an unrelated process.'}
  $running=$true
 }
}
if($running){
 $previousLog=Get-Content (Join-Path $folder 'tunnel.stderr.log') -Raw -ErrorAction SilentlyContinue
 if($previousLog -match 'Unauthorized: Tunnel not found'){
  if($process.Name -ne 'cloudflared.exe'){throw 'Refusing to stop an unrelated tunnel process.'}
  Stop-Process -Id $old.pid -ErrorAction Stop
  $running=$false
  Write-Output 'Expired development tunnel detected; creating a fresh tunnel.'
 }
}
if(-not $running){
 $process=Start-Process -FilePath $binary -ArgumentList @('tunnel','--no-autoupdate','--url','http://127.0.0.1:3001','--protocol','http2') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $folder 'tunnel.stdout.log') -RedirectStandardError (Join-Path $folder 'tunnel.stderr.log') -PassThru
 $record=@{pid=$process.Id;entryPoint=$binary;startedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json
 [IO.File]::WriteAllText($recordPath,$record,(New-Object System.Text.UTF8Encoding($false)))
}
$match=$null
for($i=0;$i -lt 30;$i++){
 $log=Get-Content (Join-Path $folder 'tunnel.stderr.log') -Raw -ErrorAction SilentlyContinue
 if($log){$match=[regex]::Match($log,'https://[a-z0-9-]+\.trycloudflare\.com');if($match.Success){break}}
 Start-Sleep -Seconds 1
}
if(-not $match -or -not $match.Success){throw 'Tunnel URL is not ready; inspect the local tunnel log.'}
$envPath=Join-Path $root '.env.worker.local'
$text=[IO.File]::ReadAllText($envPath)
$text=[regex]::Replace($text,'(?m)^CLOUDINARY_WEBHOOK_URL=.*\r?$','CLOUDINARY_WEBHOOK_URL='+$match.Value+'/api/v1/webhooks/cloudinary')
[IO.File]::WriteAllText($envPath,$text,(New-Object System.Text.UTF8Encoding($false)))
Write-Output 'Saved the temporary webhook URL. Restart API and worker to reload it. Relay rejects all other paths.'
