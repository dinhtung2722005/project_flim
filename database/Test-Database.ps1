[CmdletBinding()]
param([string]$PostgresBin='C:\Program Files\PostgreSQL\17\bin')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$configuration=Get-Content -LiteralPath (Join-Path $projectRoot '.local\database\connection.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$psql=Join-Path $PostgresBin 'psql.exe'
function Invoke-DatabaseCheck {
    param([string]$DatabaseUser,[string]$DatabasePassword,[string]$SqlCommand,[string]$SqlFile,[switch]$ExpectDenied)
    $previousPassword=[Environment]::GetEnvironmentVariable('PGPASSWORD','Process')
    $previousEncoding=[Environment]::GetEnvironmentVariable('PGCLIENTENCODING','Process')
    try {
        $env:PGPASSWORD=$DatabasePassword
        $env:PGCLIENTENCODING='UTF8'
        $psqlOptions=@('--no-psqlrc','--no-password','--quiet','--tuples-only','--no-align','--host',$configuration.host,'--port',"$($configuration.port)",'--username',$DatabaseUser,'--dbname',$configuration.database,'--set','ON_ERROR_STOP=1','--set',$(if($ExpectDenied){'VERBOSITY=sqlstate'}else{'VERBOSITY=terse'}))
        if ($SqlFile) { $psqlOptions+=@('--file',$SqlFile) } else { if($ExpectDenied){ $SqlCommand='BEGIN; '+$SqlCommand+' ROLLBACK;' }; $psqlOptions+=@('--command',$SqlCommand) }
        if ($ExpectDenied) {
            $previousErrorPreference=$ErrorActionPreference
            try {
                $ErrorActionPreference='Continue'
                $response=& $psql @psqlOptions 2>&1
                $exitStatus=$LASTEXITCODE
            } finally { $ErrorActionPreference=$previousErrorPreference }
            $responseText=($response | ForEach-Object { $_.ToString() }) -join ' '
            if ($exitStatus -eq 0 -or $responseText -notmatch '42501') { throw 'Expected SQLSTATE 42501 from the actual runtime connection.' }
            return
        }
        & $psql @psqlOptions
        if ($LASTEXITCODE -ne 0) { throw "Database verification failed as $DatabaseUser." }
    } finally {
        [Environment]::SetEnvironmentVariable('PGPASSWORD',$previousPassword,'Process')
        [Environment]::SetEnvironmentVariable('PGCLIENTENCODING',$previousEncoding,'Process')
    }
}
Invoke-DatabaseCheck -DatabaseUser $configuration.ownerUser -DatabasePassword $configuration.ownerPassword -SqlFile (Join-Path $PSScriptRoot 'sql\verify.sql')
$apiQuery="BEGIN; INSERT INTO movie.audit_logs(actor_kind,action,resource_type,resource_id,outcome) VALUES ('SYSTEM','database.verify','database','pj_flim','SUCCESS'); SELECT key FROM movie.policy_locks WHERE key='super_admin_roster' FOR UPDATE; ROLLBACK;"
Invoke-DatabaseCheck -DatabaseUser $configuration.apiUser -DatabasePassword $configuration.apiPassword -SqlCommand $apiQuery
foreach ($query in @('UPDATE movie.audit_logs SET reason=reason WHERE false;','DELETE FROM movie.audit_logs WHERE false;','TRUNCATE movie.audit_logs;','UPDATE movie.permissions SET description=description WHERE false;','CREATE TABLE movie.runtime_ownership_probe(id integer);')) {
    Invoke-DatabaseCheck -DatabaseUser $configuration.apiUser -DatabasePassword $configuration.apiPassword -SqlCommand $query -ExpectDenied
}
Invoke-DatabaseCheck -DatabaseUser $configuration.workerUser -DatabasePassword $configuration.workerPassword -SqlCommand 'SELECT count(*) AS catalog_rows FROM movie.titles;'
foreach ($query in @('SELECT password_hash FROM movie.users LIMIT 0;','SELECT encrypted_secret FROM movie.mfa_factors LIMIT 0;','DELETE FROM movie.audit_logs WHERE false;')) {
    Invoke-DatabaseCheck -DatabaseUser $configuration.workerUser -DatabasePassword $configuration.workerPassword -SqlCommand $query -ExpectDenied
}
Write-Output 'Runtime checks passed: API audit append/row lock, worker read, and 8 expected permission denials.'
