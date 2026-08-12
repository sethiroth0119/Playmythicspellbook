<#
  backup-assets.ps1 — mirror the game's artwork to a backup drive.

  WHY THIS EXISTS
  public/assets is ~5.9 GB across ~2,200 files and most of it is NOT in git,
  deliberately: at least one file exceeds GitHub's 100 MB limit, so the tree
  cannot be pushed. That means the artwork exists in exactly ONE place — this
  disk. Cloudflare is not a backup: it holds whatever the last deploy uploaded,
  it has no history, and a deploy that uploads a broken or deleted file happily
  overwrites the good one. Losing this directory loses work that cannot be
  regenerated.

  USAGE
      pwsh -File tools\backup-assets.ps1 -Destination E:\MythicBackup
      pwsh -File tools\backup-assets.ps1 -Destination E:\MythicBackup -WhatIf

  NOTES
   • /MIR mirrors — it DELETES files at the destination that no longer exist in
     the source. That is what makes it a mirror rather than an ever-growing
     pile, but it also means pointing it at the wrong folder will empty that
     folder. The script refuses obviously dangerous destinations (a drive root,
     the source itself, anything inside the repo) and asks before the first run
     against a non-empty folder it did not create.
   • Use -WhatIf first if you are unsure. It runs robocopy in list-only mode:
     nothing is written or deleted.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$Source = Join-Path (Split-Path -Parent $PSScriptRoot) 'public\assets'

if (-not (Test-Path $Source)) { throw "Source not found: $Source" }

# ── refuse to mirror over something that is not a backup folder ──────────────
$destFull = [System.IO.Path]::GetFullPath($Destination)
$srcFull  = [System.IO.Path]::GetFullPath($Source)
$repoFull = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))

if ($destFull -eq $srcFull)                    { throw "Destination is the source. Refusing." }
if ($destFull.StartsWith($repoFull, 'OrdinalIgnoreCase')) { throw "Destination is inside the repo ($repoFull). Refusing — a mirror in the repo is not a backup." }
if ($destFull -match '^[A-Za-z]:\\?$')         { throw "Destination is a drive root ($destFull). /MIR would mirror over the whole drive. Give it a subfolder, e.g. $($destFull.TrimEnd('\'))\MythicBackup" }

$srcStats = Get-ChildItem $Source -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
"Source      : $Source"
"              {0:N0} files, {1:N2} GB" -f $srcStats.Count, ($srcStats.Sum / 1GB)
"Destination : $destFull"

if (-not (Test-Path $destFull)) {
  if (-not $WhatIf) { New-Item -ItemType Directory -Path $destFull -Force | Out-Null }
  "              (created)"
} else {
  $existing = @(Get-ChildItem $destFull -Force -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0 -and -not (Test-Path (Join-Path $destFull '.mythic-asset-backup'))) {
    # Not a folder this script has written before, and not empty. /MIR would
    # delete whatever is in there. Make the human say yes.
    Write-Warning "$destFull is not empty and was not created by this script."
    Write-Warning "/MIR will DELETE anything there that is not in public\assets."
    $ans = Read-Host "Type MIRROR to continue"
    if ($ans -ne 'MIRROR') { throw "Aborted by user." }
  }
}

$logDir = Join-Path $env:TEMP 'mythic-backup-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$log = Join-Path $logDir ("assets-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".log")

# /MIR mirror · /R:2 /W:5 don't hang for minutes on a locked file
# /MT:16 multithreaded · /NP no per-file percentage spam · /L list-only for -WhatIf
$args = @($Source, $destFull, '/MIR', '/R:2', '/W:5', '/MT:16', '/NP', '/NDL', "/LOG:$log", '/TEE')
if ($WhatIf) { $args += '/L'; "MODE        : -WhatIf (list only, nothing written or deleted)" }

"Log         : $log"
""
robocopy @args | Out-Null
$rc = $LASTEXITCODE

if (-not $WhatIf -and $rc -lt 8) {
  Set-Content -Path (Join-Path $destFull '.mythic-asset-backup') -Value (Get-Date -Format o)
}

# robocopy exit codes: 0-7 are success (0 = nothing to do, 1 = copied, etc.);
# 8+ means at least one file genuinely failed. Anything else is a real error.
if ($rc -ge 8) {
  Write-Error "robocopy reported failures (exit $rc). See $log"
  exit $rc
}

$dstStats = Get-ChildItem $destFull -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
""
"Result      : robocopy exit $rc (0-7 = success)"
if (-not $WhatIf) {
  "Destination : {0:N0} files, {1:N2} GB" -f $dstStats.Count, ($dstStats.Sum / 1GB)
  if ($dstStats.Count -lt $srcStats.Count) {
    Write-Warning "Destination has fewer files than the source — check the log."
  } else {
    "OK          : mirror complete."
  }
}
