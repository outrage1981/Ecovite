# Downloads the PocketBase binary this project is pinned to into tools/bin/.
# Keep $Version identical to ARG PB_VERSION in the Dockerfile.
param([string]$Version = '0.35.0')
$ErrorActionPreference = 'Stop'

$binDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force $binDir | Out-Null
$zip = Join-Path $binDir 'pocketbase.zip'
$url = "https://github.com/pocketbase/pocketbase/releases/download/v$Version/pocketbase_${Version}_windows_amd64.zip"

Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $binDir -Force
Remove-Item $zip
& (Join-Path $binDir 'pocketbase.exe') --version
