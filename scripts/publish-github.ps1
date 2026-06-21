param(
    [string]$Message = "Update BunnyOS",
    [string]$Remote = "origin",
    [string]$Branch = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

function Run-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & git @Args
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path (Join-Path $Root ".git"))) {
    throw "This folder is not a git repository: $Root"
}

$remoteUrl = (& git remote get-url $Remote 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $remoteUrl) {
    throw "Git remote '$Remote' is not configured. Add it first, e.g. git remote add origin <repo-url>"
}

if (-not $Branch) {
    $Branch = (& git branch --show-current).Trim()
}
if (-not $Branch) {
    throw "Cannot detect current git branch."
}

Write-Host "Repository: $Root"
Write-Host "Remote:     $Remote -> $remoteUrl"
Write-Host "Branch:     $Branch"
Write-Host ""
Write-Host "Current changes:"
& git status --short
if ($LASTEXITCODE -ne 0) {
    throw "git status failed"
}

Run-Git add -A
$staged = (& git diff --cached --name-only)
if (-not $staged) {
    Write-Host "Nothing to commit."
} else {
    Run-Git commit -m $Message
}

Run-Git push -u $Remote $Branch
Write-Host "Published to GitHub."
