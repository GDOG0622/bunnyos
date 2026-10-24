param(
    [string]$HostName = "107.175.234.49",
    [string]$User = "root",
    [int]$Port = 22,
    [string]$RemotePath = "/opt/bunnyos",
    [string]$StoragePath = "",
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "bunnyos-deploy-$Stamp"
$Stage = Join-Path $TempRoot "bundle"
$Archive = Join-Path $TempRoot "bunnyos-$Stamp.tgz"
$RemoteArchive = "/tmp/bunnyos-$Stamp.tgz"
$RemoteStorage = if ($StoragePath) { $StoragePath } else { "${RemotePath}-data" }

New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$ExcludeDirs = @("node_modules", ".git", ".agents", ".codex", ".claude", ".skill-build", "data", (Join-Path $Root "assets\backgrounds"), (Join-Path $Root "assets\app-icons"))
$ExcludeFiles = @("settings.json", "server-env.json")

Write-Host "Staging BunnyOS from $Root"
$RoboArgs = @($Root, $Stage, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
if ($ExcludeDirs.Count) { $RoboArgs += "/XD"; $RoboArgs += $ExcludeDirs }
if ($ExcludeFiles.Count) { $RoboArgs += "/XF"; $RoboArgs += $ExcludeFiles }
& robocopy @RoboArgs | Out-Null
if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

Write-Host "Creating archive $Archive"
& tar -czf $Archive -C $Stage .
if ($LASTEXITCODE -ne 0) {
    throw "tar failed with exit code $LASTEXITCODE"
}

$SshTarget = "$User@$HostName"
$ScpTarget = "${User}@${HostName}:$RemoteArchive"

Write-Host "Checking SSH access to $SshTarget on port $Port"
& ssh -p $Port -o BatchMode=yes -o ConnectTimeout=8 $SshTarget "echo bunnyos-ssh-ok"
if ($LASTEXITCODE -ne 0) {
    throw "ssh preflight failed. Check VPS sshd, firewall/security group, port $Port, and whether $User login is allowed."
}

Write-Host "Uploading to ${SshTarget}:$RemoteArchive"
& scp -P $Port $Archive $ScpTarget
if ($LASTEXITCODE -ne 0) {
    throw "scp failed with exit code $LASTEXITCODE"
}

$InstallCommand = if ($SkipInstall) { "true" } else { "npm install --omit=dev" }
$RemoteCommand = @"
set -e
export BUNNYOS_STORAGE_DIR='$RemoteStorage'
mkdir -p '$RemotePath'
tar -xzf '$RemoteArchive' -C '$RemotePath'
cd '$RemotePath'
# One-time migration only; stop the old writer before moving any data.
if [ -e data ] || [ -e settings.json ] || [ -e assets/backgrounds ] || [ -e assets/app-icons ]; then
  if pm2 describe bunnyos >/dev/null 2>&1; then pm2 stop bunnyos; fi
  node scripts/migrate-storage.js --pm2
fi
$InstallCommand
pm2 startOrRestart ecosystem.config.js --update-env
pm2 save
rm -f '$RemoteArchive'
"@

Write-Host "Restarting BunnyOS on VPS"
& ssh -p $Port $SshTarget $RemoteCommand
if ($LASTEXITCODE -ne 0) {
    throw "ssh remote deploy failed with exit code $LASTEXITCODE"
}

$ResolvedTemp = [System.IO.Path]::GetFullPath($TempRoot)
$ExpectedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
if (-not $ResolvedTemp.StartsWith($ExpectedTemp, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected staging directory" }
Remove-Item -LiteralPath $ResolvedTemp -Recurse -Force
Write-Host "Deploy complete: http://$HostName/"
