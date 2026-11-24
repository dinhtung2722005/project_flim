[CmdletBinding()]
param([switch]$RestartApi)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configurationPath = Join-Path $projectRoot '.env.api.local'
$secureToken = Read-Host 'Dan API Read Access Token TMDB (khong phai API key)' -AsSecureString
$tokenPointer = [IntPtr]::Zero
$tokenText = $null
try {
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $tokenText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer).Trim()
    if ($tokenText -notmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') {
        throw 'TMDB_TOKEN_FORMAT_INVALID: Dan nguyen API Read Access Token (3 phan ngan bang dau cham), khong dan API key hoac tien to Bearer. Khong luu thay doi.'
    }
    try {
        $result = Invoke-RestMethod -Method Get -Uri 'https://api.themoviedb.org/3/authentication' -Headers @{
            Authorization = ('Bearer ' + $tokenText)
            Accept = 'application/json'
        } -TimeoutSec 15 -MaximumRedirection 0
    } catch {
        $statusCode = 0
        try {
            if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
        } catch { $statusCode = 0 }
        switch ($statusCode) {
            { $_ -eq 401 -or $_ -eq 403 } { throw 'TMDB_AUTH_REJECTED: TMDB tu choi token. Sao chep lai API Read Access Token trong tai khoan TMDB. Khong luu thay doi.' }
            429 { throw 'TMDB_RATE_LIMITED: TMDB gioi han luot goi. Thu lai sau; khong luu thay doi.' }
            { $_ -ge 500 } { throw 'TMDB_UNAVAILABLE: May chu TMDB dang gap loi. Thu lai sau; khong luu thay doi.' }
            0 { throw 'TMDB_CONNECTION_FAILED: Khong ket noi duoc TMDB qua HTTPS. Kiem tra mang, DNS, proxy va TLS; khong luu thay doi.' }
            default { throw ('TMDB_HTTP_ERROR: HTTP ' + $statusCode + '. Khong luu thay doi.') }
        }
    }
    if ($result.success -ne $true) {
        throw 'TMDB_AUTH_INVALID_RESPONSE: Phan hoi TMDB chua xac nhan thanh cong. Khong luu thay doi.'
    }
    $rawConfiguration = if (Test-Path -LiteralPath $configurationPath) {
        [IO.File]::ReadAllText($configurationPath)
    } else { '' }
    $tokenLine = 'TMDB_API_READ_TOKEN=' + $tokenText
    if ($rawConfiguration -match '(?m)^TMDB_API_READ_TOKEN=.*$') {
        $rawConfiguration = [regex]::Replace($rawConfiguration, '(?m)^TMDB_API_READ_TOKEN=.*$', $tokenLine)
    } else {
        $rawConfiguration += [Environment]::NewLine + $tokenLine + [Environment]::NewLine
    }
    if ($rawConfiguration -match '(?m)^REVIEWS_ENABLED=.*$') {
        $rawConfiguration = [regex]::Replace($rawConfiguration, '(?m)^REVIEWS_ENABLED=.*$', 'REVIEWS_ENABLED=true')
    } else {
        $rawConfiguration += 'REVIEWS_ENABLED=true' + [Environment]::NewLine
    }
    [IO.File]::WriteAllText($configurationPath, $rawConfiguration, (New-Object Text.UTF8Encoding($false)))
    Write-Output 'TMDB xac thuc thanh cong; da luu token trong .env.api.local.'
} finally {
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    $tokenText = $null
    $tokenLine = $null
    $rawConfiguration = $null
    $secureToken.Dispose()
}
if ($RestartApi) {
    & (Join-Path $PSScriptRoot 'Start-LocalProcess.ps1') -Service api
    if (-not $?) { throw 'Da luu cau hinh nhung chua khoi dong lai duoc API.' }
}
