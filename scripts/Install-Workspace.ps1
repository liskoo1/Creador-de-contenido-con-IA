[CmdletBinding()]
param(
    [ValidateSet('Check', 'Install')]
    [string]$Mode = 'Check'
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$bundleRoot = Join-Path $projectRoot 'config\antigravity'
$targetRoot = Join-Path $projectRoot '.agents'
$relativeFiles = @(
    'skills\director-proyecto\SKILL.md',
    'agents\architect.md',
    'agents\backend.md',
    'agents\frontend.md',
    'agents\instagram-strategist.md',
    'agents\qa-reviewer.md',
    'agents\security-reviewer.md'
)

function Assert-LocalPath([string]$Candidate, [string]$BasePath) {
    $absolute = [IO.Path]::GetFullPath($Candidate)
    $base = [IO.Path]::GetFullPath($BasePath).TrimEnd('\', '/')
    if ($absolute -ne $base -and -not $absolute.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Ruta fuera del directorio previsto: $absolute"
    }
    # Un enlace duro de archivo no redirige la ruta. La instalación lee
    # el origen y crea un archivo nuevo sin sobrescribir el destino.
    $cursor = $absolute
    while ($cursor.Length -ge $projectRoot.Length) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            $isFileHardLink = $item.LinkType -eq 'HardLink' -and -not $item.PSIsContainer
            if ($item.LinkType -and -not $isFileHardLink) { throw "No se instala a través de enlaces que redirigen rutas: $cursor" }
            if ($cursor -ne $absolute -and -not $item.PSIsContainer) { throw "Un directorio de la ruta es un archivo: $cursor" }
        }
        if ($cursor -eq $projectRoot) { break }
        $cursor = Split-Path -Parent $cursor
    }
    return $absolute
}

$requiredDocs = @('AGENTS.md', 'docs\workspace\WORKFLOW.md', 'docs\workspace\TEAM.md')
foreach ($relative in $requiredDocs) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative) -PathType Leaf)) {
        throw "Falta el contrato compartido: $relative"
    }
}

$plan = foreach ($relative in $relativeFiles) {
    $source = Assert-LocalPath (Join-Path $bundleRoot $relative) $bundleRoot
    $target = Assert-LocalPath (Join-Path $targetRoot $relative) $targetRoot
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Falta archivo del paquete: $relative" }
    $body = Get-Content -LiteralPath $source -Raw -Encoding UTF8
    $frontmatter = [regex]::Match($body, '\A---\r?\n(?<body>[\s\S]*?)\r?\n---(?:\r?\n|$)')
    if (-not $frontmatter.Success) { throw "Frontmatter ausente: $relative" }
    foreach ($field in @('name', 'description')) {
        if ($frontmatter.Groups['body'].Value -notmatch "(?m)^${field}:\s*\S+") { throw "Falta ${field}: $relative" }
    }
    if ($relative.StartsWith('agents\')) {
        foreach ($pattern in @('(?m)^subagent:\s*true\s*$', '(?m)^mainAgent:\s*false\s*$', '(?m)^model:\s*inherit\s*$', '(?m)^commandExecutionPolicy:\s*sandbox\s*$')) {
            if ($frontmatter.Groups['body'].Value -notmatch $pattern) { throw "Perfil incompatible: $relative ($pattern)" }
        }
    }
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $state = 'pending'
    if (Test-Path -LiteralPath $target) {
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "El destino no es un archivo: $target" }
        $state = if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $sourceHash) { 'identical' } else { 'conflict' }
    }
    [PSCustomObject]@{ RelativePath = $relative; Source = $source; Target = $target; Hash = $sourceHash; State = $state }
}

# Comprobar todos los conflictos antes de escribir. Nunca sustituir archivos
# personales o perfiles existentes con contenido diferente.
$conflicts = @($plan | Where-Object State -eq 'conflict')
if ($Mode -eq 'Install' -and $conflicts.Count -gt 0) {
    throw ('Hay archivos diferentes en el destino; no se ha escrito nada: ' + ($conflicts.RelativePath -join ', '))
}

if ($Mode -eq 'Install') {
    foreach ($entry in $plan) {
        if ($entry.State -eq 'identical') { continue }
        $null = Assert-LocalPath $entry.Target $targetRoot
        $directory = Split-Path -Parent $entry.Target
        $null = New-Item -ItemType Directory -Path $directory -Force
        # false impide sobrescribir incluso si otro proceso crea el archivo.
        [IO.File]::Copy($entry.Source, $entry.Target, $false)
        if ((Get-FileHash -LiteralPath $entry.Target -Algorithm SHA256).Hash -ne $entry.Hash) {
            throw "La copia no coincide con el origen: $($entry.RelativePath)"
        }
        $entry.State = 'installed'
    }
}

[PSCustomObject]@{
    Mode = $Mode
    Project = $projectRoot
    BundleValid = $true
    Files = @($plan | Select-Object RelativePath, State)
    NativeActivationVerified = $false
    NextStep = 'Abre Antigravity en la raíz, comprueba /agents e invoca /director-proyecto después de instalar los archivos.'
} | ConvertTo-Json -Depth 4
