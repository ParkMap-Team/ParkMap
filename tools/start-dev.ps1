# Windows launcher for the local development stack. Run through start-dev.bat.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repoRoot 'apps\vision-api'
$composeFile = Join-Path $repoRoot 'compose.yaml'
$dryRun = $false
$noBrowser = $false
$demo = $false

function Quote-Literal([string] $value) {
    return "'" + $value.Replace("'", "''") + "'"
}

function Invoke-Tool([string] $command, [string[]] $arguments, [switch] $Quiet, [string] $FailureMessage) {
    # Windows PowerShell 5.1 converts redirected native stderr into ErrorRecords.
    # Docker and uv also use stderr for warnings/progress, so check their exit code.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $command @arguments 2>&1 | ForEach-Object {
            if (-not $Quiet) { Write-Host ([string] $_) }
        }
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -ne 0) {
        if ($FailureMessage) { throw $FailureMessage }
        throw "Command failed (exit $exitCode). See the output above."
    }
}

function Open-Terminal([string] $title, [string] $directory, [string] $command, [switch] $EditorAccess) {
    # Encode rather than interpolate paths into cmd.exe; the repo path may contain spaces.
    $script = '$Host.UI.RawUI.WindowTitle = ' + (Quote-Literal "ParkMap - $title") + "`n" +
        'Set-Location -LiteralPath ' + (Quote-Literal $directory) + "`n" + $command
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    $serverEditorToken = $env:PARKMAP_EDITOR_TOKEN
    try {
        if (-not $EditorAccess) { $env:PARKMAP_EDITOR_TOKEN = $null }
        Start-Process -FilePath 'powershell.exe' -WorkingDirectory $directory -WindowStyle Normal `
            -ArgumentList @('-NoProfile', '-NoExit', '-EncodedCommand', $encoded) | Out-Null
    } finally {
        $env:PARKMAP_EDITOR_TOKEN = $serverEditorToken
    }
}

function Wait-ForUrl([string] $name, [string] $url) {
    Write-Host "Waiting for $name ($url)..."
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        try {
            $null = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
            return
        } catch {
            Start-Sleep -Seconds 1
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$name did not become ready. Check its terminal; already started services stay running."
}

try {
    foreach ($option in $args) {
        switch ($option) {
            '--demo' { $demo = $true }
            '--dry-run' { $dryRun = $true }
            '--no-browser' { $noBrowser = $true }
            '--help' {
                Write-Host 'Usage: start-dev.bat [--demo] [--no-browser] [--dry-run]'
                Write-Host 'Starts local Postgres, migrations, Vision API, LIFF, and Calibration UI.'
                Write-Host '--demo seeds the synthetic dev site and starts its state publisher.'
                Write-Host '--dry-run prints the plan without starting anything or changing data.'
                return
            }
            default { throw "Unknown option: $option. Use start-dev.bat --help." }
        }
    }

    Write-Host 'ParkMap local development'
    Write-Host "Repository: $repoRoot"
    Write-Host 'Postgres: docker compose up -d --wait postgres (127.0.0.1:5432)'
    Write-Host 'Migrations: uv run --no-sync python -m alembic upgrade head'
    Write-Host 'Vision API: http://localhost:8000 (uv run --no-sync uvicorn app.main:app --reload --host 127.0.0.1 --port 8000)'
    Write-Host 'LIFF: http://localhost:3001 (package dev script)'
    Write-Host 'Calibration UI: http://127.0.0.1:3000 (package dev script)'
    Write-Host 'Database log terminal: docker compose logs --follow --tail 50 postgres'
    if ($demo) {
        Write-Host 'Synthetic demo: uv run --no-sync python -m app.manage seed-dev'
        Write-Host 'Dev publisher: uv run --no-sync python -m app.manage publish-dev-state'
    }
    if (-not $noBrowser) {
        Write-Host 'Browser: LIFF, Calibration UI, and API docs (http://localhost:8000/docs)'
    }
    if ($dryRun) { return }

    # Always target compose's LOCAL database and API, even if .env points at a server.
    # Compose publishes only IPv4; localhost may try an unresponsive IPv6 address first.
    $env:DATABASE_URL = 'postgresql://parkmap:parkmap@127.0.0.1:5432/parkmap'
    $env:PARKMAP_API_URL = 'http://127.0.0.1:8000'
    $env:NEXT_PUBLIC_PARKMAP_API_URL = 'http://127.0.0.1:8000'
    $env:PGCONNECT_TIMEOUT = '10'
    $env:PYTHONUNBUFFERED = '1'
    # Shared only by these local server processes; never written to disk or printed.
    if ([string]::IsNullOrWhiteSpace($env:PARKMAP_EDITOR_TOKEN)) {
        $editorTokenBytes = New-Object byte[] 32
        $editorRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $editorRandom.GetBytes($editorTokenBytes) } finally { $editorRandom.Dispose() }
        $env:PARKMAP_EDITOR_TOKEN = [Convert]::ToBase64String($editorTokenBytes)
    }

    $docker = (Get-Command docker.exe -ErrorAction Stop).Source
    $uv = (Get-Command uv.exe -ErrorAction Stop).Source
    $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if ($pnpm) {
        $pnpmCommand = '& ' + (Quote-Literal $pnpm.Source)
        $liffDevCommand = "$pnpmCommand --filter @parkmap/liff dev"
        $calibrationDevCommand = "$pnpmCommand --filter @parkmap/calibration-ui dev"
    } else {
        # npm can run the already-installed scripts without Corepack downloads or installs.
        $npm = Get-Command npm.cmd -ErrorAction Stop
        $npmCommand = '& ' + (Quote-Literal $npm.Source)
        $liffDevCommand = $npmCommand + ' --prefix ' + (Quote-Literal (Join-Path $repoRoot 'apps\liff')) + ' run dev'
        $calibrationDevCommand = $npmCommand + ' --prefix ' + (Quote-Literal (Join-Path $repoRoot 'tools\calibration-ui')) + ' run dev'
        Write-Host 'pnpm is not on PATH; using npm to run installed dev scripts.'
    }
    foreach ($path in @('node_modules', 'apps\liff\node_modules', 'tools\calibration-ui\node_modules')) {
        if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $path))) {
            throw 'Install frontend dependencies first: corepack pnpm install --frozen-lockfile'
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $apiRoot '.venv\Scripts\python.exe'))) {
        throw 'In apps\vision-api, run: uv sync --locked --all-groups'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $apiRoot '.env'))) {
        throw 'Copy apps\vision-api\.env.example to apps\vision-api\.env and configure it first.'
    }

    $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    foreach ($port in @(3000, 3001, 8000)) {
        if ($listeners.Port -contains $port) {
            throw "Port $port is already in use. Close its existing server before running this launcher again."
        }
    }

    if ($demo) {
        Push-Location -LiteralPath $apiRoot
        try {
            Invoke-Tool $uv @('run', '--no-sync', 'python', '-c',
                "from dotenv import load_dotenv; import os, sys; load_dotenv('.env'); sys.exit(0 if os.getenv('PARKMAP_WORKER_TOKEN', '').strip() else 1)") `
                -FailureMessage 'Set PARKMAP_WORKER_TOKEN in apps\vision-api\.env before using --demo.'
        } finally {
            Pop-Location
        }
    }

    Write-Host '[1/5] Starting Postgres and waiting for its healthcheck...'
    Invoke-Tool $docker @('info') -Quiet `
        -FailureMessage 'Docker is not ready. Open Docker Desktop and wait for its engine, then retry.'
    Invoke-Tool $docker @('compose', '-f', $composeFile, 'up', '-d', '--wait', 'postgres')

    Push-Location -LiteralPath $apiRoot
    try {
        Write-Host '[2/5] Applying database migrations...'
        Invoke-Tool $uv @('run', '--no-sync', 'python', '-m', 'alembic', 'upgrade', 'head')
        if ($demo) {
            Invoke-Tool $uv @('run', '--no-sync', 'python', '-m', 'app.manage', 'seed-dev')
        }
    } finally {
        Pop-Location
    }
    Write-Host 'Database migrations complete.'

    $uvCommand = '& ' + (Quote-Literal $uv)
    Open-Terminal 'Database logs' $repoRoot ('& ' + (Quote-Literal $docker) + ' compose -f ' +
        (Quote-Literal $composeFile) + ' logs --follow --tail 50 postgres')
    Write-Host '[3/5] Starting Vision API...'
    Open-Terminal 'Vision API :8000' $apiRoot "$uvCommand run --no-sync uvicorn app.main:app --reload --host 127.0.0.1 --port 8000" -EditorAccess
    # /api/sites verifies the database as well as the API process before starting consumers.
    Wait-ForUrl 'Vision API and database' 'http://127.0.0.1:8000/api/sites'
    if ($demo) {
        Open-Terminal 'Synthetic state publisher' $apiRoot "$uvCommand run --no-sync python -m app.manage publish-dev-state"
    }
    Write-Host '[4/5] Starting LIFF and Calibration UI...'
    Open-Terminal 'LIFF :3001' $repoRoot $liffDevCommand
    Open-Terminal 'Calibration UI :3000' $repoRoot $calibrationDevCommand -EditorAccess
    Wait-ForUrl 'LIFF' 'http://localhost:3001'
    Wait-ForUrl 'Calibration UI' 'http://127.0.0.1:3000'

    Write-Host '[5/5] Web apps ready.'
    if (-not $noBrowser) {
        foreach ($url in @('http://localhost:3001', 'http://127.0.0.1:3000', 'http://localhost:8000/docs')) {
            Start-Process $url | Out-Null
        }
    }
    Write-Host 'Ready. Stop app servers with Ctrl+C in their terminals.'
    Write-Host 'Postgres stays running. Stop it from the repo root with: docker compose stop postgres'
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
