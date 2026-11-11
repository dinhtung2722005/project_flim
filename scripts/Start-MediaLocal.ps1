$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
& npm.cmd run worker:configure
if($LASTEXITCODE -ne 0){throw 'Worker configuration failed.'}
& (Join-Path $PSScriptRoot 'Start-RabbitMQ.ps1')
& npm.cmd run build
if($LASTEXITCODE -ne 0){throw 'Build failed.'}
& (Join-Path $PSScriptRoot 'Start-LocalProcess.ps1') -Service relay
& (Join-Path $PSScriptRoot 'Start-WebhookTunnel.ps1')
& (Join-Path $PSScriptRoot 'Start-LocalProcess.ps1') -Service api
& (Join-Path $PSScriptRoot 'Start-LocalProcess.ps1') -Service worker
