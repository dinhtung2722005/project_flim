param([Parameter(Mandatory=$true)][ValidateSet('api','worker','relay')][string]$Service)
$ErrorActionPreference='Stop'
$root='E:\pj-Flim'
$paths=@{
 api=@{Entry='dist\apps\api\src\main.js';Folder='.local\api';Record='server-process.json';Log='server';Port=3000}
 worker=@{Entry='dist\apps\worker\src\main.js';Folder='.local\worker';Record='process.json';Log='worker';Port=0}
 relay=@{Entry='dist\apps\worker\src\webhook-relay.js';Folder='.local\worker';Record='relay-process.json';Log='relay';Port=3001}
}
$selected=$paths[$Service]
$entry=Join-Path $root $selected.Entry
if(-not (Test-Path -LiteralPath $entry)){throw 'Build the project first.'}
$folder=Join-Path $root $selected.Folder
[IO.Directory]::CreateDirectory($folder)|Out-Null
$recordPath=Join-Path $folder $selected.Record
if(Test-Path -LiteralPath $recordPath){
 $old=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
 $existing=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$old.pid) -ErrorAction SilentlyContinue
 if($existing){
  if($old.entryPoint -ne $entry -or $existing.Name -ne 'node.exe' -or -not $existing.CommandLine.Contains($entry)){throw 'Refusing to stop an unrelated process.'}
  Stop-Process -Id $old.pid -ErrorAction Stop
 }
}
if($selected.Port -and (Get-NetTCPConnection -LocalPort $selected.Port -State Listen -ErrorAction SilentlyContinue)){throw 'The service port is occupied by another process.'}
$process=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @($entry) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $folder ($selected.Log+'.stdout.log')) -RedirectStandardError (Join-Path $folder ($selected.Log+'.stderr.log')) -PassThru
$record=@{pid=$process.Id;entryPoint=$entry;startedAt=[DateTime]::UtcNow.ToString('o');service=$Service}|ConvertTo-Json
[IO.File]::WriteAllText($recordPath,$record,(New-Object System.Text.UTF8Encoding($false)))
Write-Output ($Service+' started, process '+$process.Id)
