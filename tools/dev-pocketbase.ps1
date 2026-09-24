# Runs PocketBase locally, serving this project folder as the app, so
# code edits show up on reload. Data lives outside the project folder so
# it can never be served as a public file.
#   First run:  tools/get-pocketbase.ps1, then this script, then open
#   http://127.0.0.1:8090/_/ to create your superuser.
param([int]$Port = 8090)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $PSScriptRoot 'bin\pocketbase.exe'
$data = Join-Path $env:LOCALAPPDATA 'ecovite-pocketbase\pb_data'
if (-not (Test-Path $bin)) { throw "PocketBase not found at $bin - run tools/get-pocketbase.ps1 first." }

& $bin serve "--http=127.0.0.1:$Port" "--dir=$data" "--publicDir=$root" "--migrationsDir=$(Join-Path $root 'pb_migrations')"
