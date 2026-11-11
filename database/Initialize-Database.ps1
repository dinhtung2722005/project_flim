[CmdletBinding()]
param([string]$DatabaseHost='127.0.0.1',[ValidateRange(1,65535)][int]$DatabasePort=5432,[string]$AdminUser='postgres',[string]$PostgresBin='C:\Program Files\PostgreSQL\17\bin')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$psql=Join-Path $PostgresBin 'psql.exe'
if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) { throw "psql.exe not found in $PostgresBin" }
$stateDirectory=Join-Path $projectRoot '.local\database'
$statePath=Join-Path $stateDirectory 'connection.json'
$baselinePath=Join-Path $stateDirectory 'baseline.json'
$sqlDirectory=Join-Path $projectRoot 'docs\design\sql'
$schemaPath=Join-Path $sqlDirectory 'movie-database-schema.sql'
$seedPath=Join-Path $sqlDirectory 'movie-database-rbac-seed.sql'
$grantsPath=Join-Path $sqlDirectory 'movie-database-grants.sql'
$utf8=New-Object System.Text.UTF8Encoding($false)
$adminPassword=$env:PJ_FLIM_POSTGRES_PASSWORD
if ([string]::IsNullOrWhiteSpace($adminPassword)) {
    $securePassword=Read-Host 'PostgreSQL administrator password' -AsSecureString
    $passwordPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try { $adminPassword=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
}
function Invoke-ProjectPsql {
    param([string]$DatabaseName,[string]$DatabaseUser,[string]$DatabasePassword,[string]$SqlFile,[string]$SqlCommand)
    $previousPassword=[Environment]::GetEnvironmentVariable('PGPASSWORD','Process')
    $previousEncoding=[Environment]::GetEnvironmentVariable('PGCLIENTENCODING','Process')
    try {
        $env:PGPASSWORD=$DatabasePassword
        $env:PGCLIENTENCODING='UTF8'
        $psqlOptions=@('--no-psqlrc','--no-password','--quiet','--tuples-only','--no-align','--host',$DatabaseHost,'--port',"$DatabasePort",'--username',$DatabaseUser,'--dbname',$DatabaseName,'--set','ON_ERROR_STOP=1')
        if ($SqlFile) { $psqlOptions+=@('--file',$SqlFile) } else { $psqlOptions+=@('--command',$SqlCommand) }
        & $psql @psqlOptions
        if ($LASTEXITCODE -ne 0) { throw "PostgreSQL command failed for $DatabaseName as $DatabaseUser." }
    } finally {
        [Environment]::SetEnvironmentVariable('PGPASSWORD',$previousPassword,'Process')
        [Environment]::SetEnvironmentVariable('PGCLIENTENCODING',$previousEncoding,'Process')
    }
}
function New-DatabasePassword {
    $passwordBytes=New-Object byte[] 32
    $generator=[Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($passwordBytes) } finally { $generator.Dispose() }
    return ([BitConverter]::ToString($passwordBytes)).Replace('-','').ToLowerInvariant()
}
$currentHashes=[ordered]@{
    schema=(Get-FileHash -LiteralPath $schemaPath -Algorithm SHA256).Hash
    seed=(Get-FileHash -LiteralPath $seedPath -Algorithm SHA256).Hash
    grants=(Get-FileHash -LiteralPath $grantsPath -Algorithm SHA256).Hash
}
$existingDatabase=Invoke-ProjectPsql -DatabaseName 'postgres' -DatabaseUser $AdminUser -DatabasePassword $adminPassword -SqlCommand "SELECT count(*) FROM pg_database WHERE datname='pj_flim';"
$existingRoles=Invoke-ProjectPsql -DatabaseName 'postgres' -DatabaseUser $AdminUser -DatabasePassword $adminPassword -SqlCommand "SELECT count(*) FROM pg_roles WHERE rolname IN ('pj_flim_owner','pj_flim_api','pj_flim_worker','movie_api','movie_worker','movie_auditor','movie_retention');"
if (Test-Path -LiteralPath $statePath) {
    $configuration=Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($configuration.host -ne $DatabaseHost -or $configuration.port -ne $DatabasePort -or $configuration.database -ne 'pj_flim') { throw 'Stored settings differ. Refusing to target another server.' }
} else {
    if ([int]$existingDatabase -ne 0 -or [int]$existingRoles -ne 0) { throw 'Database or role names already exist without this project connection file. Refusing to overwrite or change passwords.' }
    $configuration=[ordered]@{
        host=$DatabaseHost; port=$DatabasePort; database='pj_flim'; postgresBin=$PostgresBin
        ownerUser='pj_flim_owner'; ownerPassword=New-DatabasePassword
        apiUser='pj_flim_api'; apiPassword=New-DatabasePassword
        workerUser='pj_flim_worker'; workerPassword=New-DatabasePassword
    }
    [IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
    [IO.File]::WriteAllText($statePath,($configuration | ConvertTo-Json),$utf8)
}
if (Test-Path -LiteralPath $baselinePath) {
    $storedHashes=Get-Content -LiteralPath $baselinePath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($hashKey in @('schema','seed','grants')) {
        if ($storedHashes.$hashKey -ne $currentHashes[$hashKey]) { throw 'Baseline SQL changed. Write an incremental migration instead of replaying bootstrap.' }
    }
}
$secretNames=@('PJ_FLIM_OWNER_PASSWORD','PJ_FLIM_API_PASSWORD','PJ_FLIM_WORKER_PASSWORD')
$previousSecrets=@{}
foreach ($secretName in $secretNames) { $previousSecrets[$secretName]=[Environment]::GetEnvironmentVariable($secretName,'Process') }
try {
    $env:PJ_FLIM_OWNER_PASSWORD=$configuration.ownerPassword
    $env:PJ_FLIM_API_PASSWORD=$configuration.apiPassword
    $env:PJ_FLIM_WORKER_PASSWORD=$configuration.workerPassword
    Invoke-ProjectPsql -DatabaseName 'postgres' -DatabaseUser $AdminUser -DatabasePassword $adminPassword -SqlFile (Join-Path $PSScriptRoot 'sql\bootstrap-cluster.psql')
} finally {
    foreach ($secretName in $secretNames) { [Environment]::SetEnvironmentVariable($secretName,$previousSecrets[$secretName],'Process') }
}
$actualOwner=Invoke-ProjectPsql -DatabaseName 'postgres' -DatabaseUser $AdminUser -DatabasePassword $adminPassword -SqlCommand "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='pj_flim';"
if ($actualOwner -ne 'pj_flim_owner') { throw 'Unexpected database owner.' }
Invoke-ProjectPsql -DatabaseName 'pj_flim' -DatabaseUser $configuration.ownerUser -DatabasePassword $configuration.ownerPassword -SqlFile (Join-Path $PSScriptRoot 'sql\database-settings.sql')
$tableCount=Invoke-ProjectPsql -DatabaseName 'pj_flim' -DatabaseUser $configuration.ownerUser -DatabasePassword $configuration.ownerPassword -SqlCommand "SELECT count(*) FROM information_schema.tables WHERE table_schema='movie' AND table_type='BASE TABLE';"
if ([int]$tableCount -eq 0) {
    Invoke-ProjectPsql -DatabaseName 'pj_flim' -DatabaseUser $configuration.ownerUser -DatabasePassword $configuration.ownerPassword -SqlFile $schemaPath
} elseif ([int]$tableCount -ne 47) { throw 'Unexpected schema. Bootstrap will not drop or replace it.' }
$registryCount=Invoke-ProjectPsql -DatabaseName 'pj_flim' -DatabaseUser $configuration.ownerUser -DatabasePassword $configuration.ownerPassword -SqlCommand "SELECT (SELECT count(*) FROM movie.roles)+(SELECT count(*) FROM movie.permissions);"
if ([int]$registryCount -eq 0) {
    Invoke-ProjectPsql -DatabaseName 'pj_flim' -DatabaseUser $configuration.ownerUser -DatabasePassword $configuration.ownerPassword -SqlFile $seedPath
} elseif ([int]$registryCount -ne 23) { throw 'RBAC registry incomplete. Refusing automatic repair.' }
Invoke-ProjectPsql -DatabaseName 'pj_flim' -DatabaseUser $configuration.ownerUser -DatabasePassword $configuration.ownerPassword -SqlFile $grantsPath
$apiUrl="postgresql://$($configuration.apiUser):$($configuration.apiPassword)@$($configuration.host):$($configuration.port)/pj_flim?schema=movie"
$workerUrl="postgresql://$($configuration.workerUser):$($configuration.workerPassword)@$($configuration.host):$($configuration.port)/pj_flim?schema=movie"
$ownerUrl="postgresql://$($configuration.ownerUser):$($configuration.ownerPassword)@$($configuration.host):$($configuration.port)/pj_flim?schema=movie"
$environmentLines=@('# Local development credentials. Do not commit.',"DATABASE_HOST=$($configuration.host)","DATABASE_PORT=$($configuration.port)",'DATABASE_NAME=pj_flim','DATABASE_SCHEMA=movie',"DATABASE_URL=$apiUrl","WORKER_DATABASE_URL=$workerUrl","MIGRATION_DATABASE_URL=$ownerUrl")
[IO.File]::WriteAllText((Join-Path $projectRoot '.env.database.local'),($environmentLines -join [Environment]::NewLine)+[Environment]::NewLine,$utf8)
& (Join-Path $PSScriptRoot 'Test-Database.ps1') -PostgresBin $PostgresBin
[IO.File]::WriteAllText($baselinePath,($currentHashes | ConvertTo-Json),$utf8)
Write-Output ("Database pj_flim is ready at {0}:{1} (schema movie)." -f $DatabaseHost,$DatabasePort)
Write-Output 'Connection URLs: .env.database.local. Administrator password was not saved.'
