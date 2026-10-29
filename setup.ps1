# Experimental Windows bootstrap; parity needs a native Windows acceptance run.
param(
    [switch]$NoBrowser,
    [ValidateSet('auto', 'claude', 'codex', 'all', 'none')][string]$Skill = 'auto',
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
if ($Help) {
    Write-Output 'Usage: ./setup.ps1 [-NoBrowser] [-Skill auto|claude|codex|all|none]'
    exit 0
}
$repo = $PSScriptRoot
$targets = @()
foreach ($agent in @('claude', 'codex')) {
    $parent = Join-Path $HOME ".$agent/skills"
    if ($Skill -eq 'all' -or $Skill -eq $agent -or ($Skill -eq 'auto' -and (Test-Path $parent))) {
        $target = Join-Path $parent 'narrated-explainer'
        if (Test-Path $target) {
            $item = Get-Item -Force $target
            if ($item.LinkType -ne 'SymbolicLink') { throw "Refusing non-link skill target: $target" }
        }
        $targets += $target
    }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    $installer = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName() + '.ps1')
    try {
        Invoke-WebRequest 'https://astral.sh/uv/install.ps1' -OutFile $installer -TimeoutSec 120
        $env:UV_NO_MODIFY_PATH = '1'
        & $installer
    } finally { Remove-Item -LiteralPath $installer -ErrorAction SilentlyContinue }
    $env:PATH = (Join-Path $HOME '.local/bin') + [IO.Path]::PathSeparator + $env:PATH
}
function Invoke-Checked([string]$Command, [string[]]$CommandArgs) {
    & $Command @CommandArgs
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit $LASTEXITCODE" }
}
Invoke-Checked 'uv' @('python', 'install', '3.12')
Invoke-Checked 'uv' @('tool', 'install', '--force', '--editable', $repo, '--python', '3.12')
$toolBin = (& uv tool dir --bin)
if ($LASTEXITCODE -ne 0) { throw 'Cannot find uv tool bin directory' }
$env:PATH = $toolBin + [IO.Path]::PathSeparator + $env:PATH
Invoke-Checked 'explainer' @('models', 'fetch')
if (-not $NoBrowser) { Invoke-Checked 'uv' @('tool', 'run', '--from', $repo, 'playwright', 'install', 'chromium') }
foreach ($target in $targets) {
    if (Test-Path $target) {
        $item = Get-Item -Force $target
        if ($item.LinkType -ne 'SymbolicLink') { throw "Refusing non-link skill target: $target" }
        $item.Delete()
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    New-Item -ItemType SymbolicLink -Path $target -Target (Join-Path $repo 'skills/narrated-explainer') | Out-Null
}
Invoke-Checked 'explainer' @('doctor', '--smoke')
Write-Output "Ready. Add $toolBin to PATH if needed."
