$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('content-workspace-test-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'scripts') -Force
$null = New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'config') -Force
$null = New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'docs\workspace') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\Install-Workspace.ps1') -Destination (Join-Path $fixtureRoot 'scripts\Install-Workspace.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'config\antigravity') -Destination (Join-Path $fixtureRoot 'config') -Recurse
foreach ($relative in @('AGENTS.md', 'docs\workspace\WORKFLOW.md', 'docs\workspace\TEAM.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $relative) -Destination (Join-Path $fixtureRoot $relative)
}
$installer = Join-Path $fixtureRoot 'scripts\Install-Workspace.ps1'
$skillSource = Join-Path $fixtureRoot 'config\antigravity\skills\director-proyecto\SKILL.md'
$skillOriginal = Join-Path $fixtureRoot 'skill-original.md'
Move-Item -LiteralPath $skillSource -Destination $skillOriginal
$null = New-Item -ItemType HardLink -Path $skillSource -Target $skillOriginal

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$check = (& $installer -Mode Check | ConvertFrom-Json)
Assert-True ($check.Files.Count -eq 7) 'Check debe examinar siete archivos.'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $fixtureRoot '.agents'))) 'Check no debe crear destinos.'

$null = New-Item -ItemType Directory -Path (Join-Path $fixtureRoot '.agents')
$blockedDirectory = Join-Path $fixtureRoot '.agents\agents'
[IO.File]::WriteAllText($blockedDirectory, 'Archivo que ocupa la ruta de un directorio.')
$blockedRejected = $false
try { $null = & $installer -Mode Install } catch {
    $blockedRejected = $_.Exception.Message -match 'Un directorio de la ruta es un archivo'
}
Assert-True $blockedRejected 'Debe rechazar el archivo que bloquea el directorio de perfiles.'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $fixtureRoot '.agents\skills'))) 'Debe detectar el bloqueo antes de instalar la skill.'
Move-Item -LiteralPath $blockedDirectory -Destination (Join-Path $fixtureRoot 'blocked-directory.fixture')

$install = (& $installer -Mode Install | ConvertFrom-Json)
Assert-True (@($install.Files | Where-Object State -eq 'installed').Count -eq 7) 'Install debe copiar los siete archivos.'
$again = (& $installer -Mode Install | ConvertFrom-Json)
Assert-True (@($again.Files | Where-Object State -eq 'identical').Count -eq 7) 'La segunda instalación debe ser idempotente.'

$conflicting = Join-Path $fixtureRoot '.agents\agents\backend.md'
[IO.File]::AppendAllText($conflicting, "`nPersonalización que debe conservarse.`n")
$before = (Get-FileHash -LiteralPath $conflicting -Algorithm SHA256).Hash
$rejected = $false
try { $null = & $installer -Mode Install } catch {
    $rejected = $_.Exception.Message -match 'archivos diferentes'
}
Assert-True $rejected 'Debe rechazar un perfil diferente antes de escribir.'
Assert-True ((Get-FileHash -LiteralPath $conflicting -Algorithm SHA256).Hash -eq $before) 'Debe conservar la personalización.'

$profileSource = Join-Path $fixtureRoot 'config\antigravity\agents\frontend.md'
$original = [IO.File]::ReadAllText($profileSource)
[IO.File]::WriteAllText($profileSource, $original.Replace('model: inherit', 'model: invalid'))
$invalidRejected = $false
try { $null = & $installer -Mode Check } catch {
    $invalidRejected = $_.Exception.Message -match 'Perfil incompatible'
}
Assert-True $invalidRejected 'Debe rechazar metadata incompatible.'

[PSCustomObject]@{
    Passed = @('Check sin escrituras', 'Detección de directorio bloqueado antes de copiar', 'Copia y hashes desde un enlace duro', 'Idempotencia', 'Conflictos sin sobrescritura', 'Metadata inválida rechazada')
    Fixture = $fixtureRoot
    ProductionConfigurationChanged = $false
} | ConvertTo-Json -Depth 3
