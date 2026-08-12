# ============================================================================
# gpu-soak.ps1 — does the title screen LEAK GPU memory, or just use a lot?
# ----------------------------------------------------------------------------
# THE QUESTION THIS ANSWERS, and it is the only one that matters right now:
#
#   The crash trail showed JS heap FLAT at 806-825 MB for ~48 minutes on the
#   idle title screen while the renderer died anyway. v120t9 cut the WebGL
#   backbuffer (4x MSAA + depth -> none) and stopped the bolt canvas clearing a
#   3840x2160 surface at 60fps. But every one of those was a CONSTANT, not a
#   leak — nothing measured grows with time.
#
#   If GPU memory is FLAT here, the crash is not a title-screen allocation
#   problem and every further CSS/WebGL cut on that screen is wasted effort.
#   If it CLIMBS, we have the leak and the slope tells us roughly where.
#
# WHY NOT THE BROWSER PANE: it does not composite (CLAUDE.md) — rAF never
# fires, the ember scene never animates, and GPU memory would look calm no
# matter what. This has to be a real Chrome window.
#
# USAGE
#   1. Open https://playmythicspellbook.com in Chrome. Sit on the TITLE screen.
#      Do not minimise it, do not switch to another tab — a hidden tab pauses
#      rAF and you would measure nothing.
#   2. In PowerShell:  .\tools\gpu-soak.ps1
#   3. Leave both alone for ~50 minutes.
#   4. Paste the summary back.
#
# Writes a CSV next to itself so the raw samples survive for a second opinion.
# ============================================================================

param(
  [int]$Minutes      = 50,
  [int]$IntervalSec  = 30,
  [string]$OutCsv    = "$PSScriptRoot\gpu-soak.csv",
  # 🎯 Target a SPECIFIC GPU process instead of guessing.
  # ⚠ The auto-pick below takes the LARGEST Chromium GPU process, which is only
  #   the game's if the game is the only browser running. On a normal desktop —
  #   a second Edge window with a dozen unrelated tabs — the auto-pick samples
  #   THAT one and reports a confident verdict about the wrong process. Worse,
  #   a shared GPU process pools every tab's memory, so even picking the right
  #   browser gives you a number the game is only partly responsible for.
  #   Launch the game with its own --user-data-dir and pass that instance's GPU
  #   pid here, and the samples belong to the game alone.
  [int]$GpuPid       = 0
)

Write-Host "Finding the browser's GPU process..." -ForegroundColor Cyan

# ⚠ EDGE, CHROME, BRAVE, OPERA — all Chromium, all identical for this purpose,
#   but each ships under its own executable name. Filtering on chrome.exe alone
#   made this exit 1 on an Edge machine, which reads as "the tool is broken"
#   rather than "wrong process name". Scan them all and take whichever is
#   actually running the game.
$browsers = @('msedge.exe','chrome.exe','brave.exe','opera.exe','vivaldi.exe')
if ($GpuPid -gt 0) {
  $gpu = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $GpuPid } | Select-Object -First 1
  if (-not $gpu) { Write-Host "PID $GpuPid is not running." -ForegroundColor Red; exit 1 }
  # ⚠ BOTH checks, not just the command line. A command-line substring match
  #   alone is startlingly easy to fool — any shell whose own arguments happen
  #   to mention --type=gpu-process passes it (a script that greps for GPU
  #   processes does exactly that, which is how this was caught). Requiring the
  #   executable to be a browser as well makes a false positive implausible.
  if ($browsers -notcontains $gpu.Name -or $gpu.CommandLine -notlike '*--type=gpu-process*') {
    # Refuse rather than silently sample a renderer or the browser process —
    # the numbers would look plausible and mean something else entirely.
    Write-Host "PID $GpuPid ($($gpu.Name)) is not a Chromium GPU process." -ForegroundColor Red; exit 1
  }
  Write-Host "Targeting the GPU process you named (PID $GpuPid)." -ForegroundColor Green
} else {
  $gpu = Get-CimInstance Win32_Process |
         Where-Object { $browsers -contains $_.Name -and $_.CommandLine -like '*--type=gpu-process*' } |
         Sort-Object WorkingSetSize -Descending |
         Select-Object -First 1
  $allGpu = @(Get-CimInstance Win32_Process | Where-Object { $browsers -contains $_.Name -and $_.CommandLine -like '*--type=gpu-process*' })
  if ($allGpu.Count -gt 1) {
    Write-Host ("⚠ {0} Chromium GPU processes are running — picking the largest, which may not be the game." -f $allGpu.Count) -ForegroundColor Yellow
    Write-Host "  Re-run with -GpuPid <pid> to be certain." -ForegroundColor Yellow
  }
}

if (-not $gpu) {
  Write-Host "No Chromium GPU process found." -ForegroundColor Red
  Write-Host "Open the game in Edge (or Chrome) first, then re-run this." -ForegroundColor Yellow
  Write-Host "Looked for: $($browsers -join ', ')" -ForegroundColor DarkGray
  exit 1
}

$pidGpu  = $gpu.ProcessId
$procName = [System.IO.Path]::GetFileNameWithoutExtension($gpu.Name)
Write-Host "$($gpu.Name) GPU process, PID $pidGpu" -ForegroundColor Green

# The perf counter is instanced by process NAME, not pid, so resolve the
# instance whose ID Process matches ours. Chrome always has several.
# Match on the ACTUAL process name found above, not a hardcoded 'chrome'.
$instance = $null
foreach ($i in (Get-Counter -ListSet Process).PathsWithInstances |
                Where-Object { $_ -like "*$procName*ID Process*" }) {
  try { if ((Get-Counter $i -ErrorAction Stop).CounterSamples[0].CookedValue -eq $pidGpu) {
          $instance = ($i -split '\(|\)')[1]; break } } catch {}
}
$counters = @(
  "\GPU Process Memory(pid_$pidGpu*)\Local Usage",
  "\GPU Process Memory(pid_$pidGpu*)\Dedicated Usage"
)
if ($instance) {
  # Private working set is a NICE-TO-HAVE second opinion, not the measurement.
  $counters = @("\Process($instance)\Working Set - Private") + $counters
} else {
  # ⚠ DO NOT ABORT HERE. This used to `exit 1`, which killed the whole soak
  #   because a SECONDARY counter could not be resolved — on this machine there
  #   are 68 `msedge*` Process instances (msedgewebview2 among them) and the
  #   pid→instance walk simply does not find a match. The verdict is computed
  #   from GPU local usage, which is keyed by pid directly and works fine, so
  #   losing the working-set column costs a column and nothing else. Refusing to
  #   run at all is how a 50-minute diagnostic turns into no diagnostic.
  Write-Host "Note: could not map PID to a Process perf-counter instance — continuing without the private-working-set column (the GPU counters, which the verdict uses, are unaffected)." -ForegroundColor Yellow
}

$samples = [System.Collections.Generic.List[object]]::new()
$end     = (Get-Date).AddMinutes($Minutes)
$n       = 0

Write-Host ("Sampling every {0}s for {1} min. Leave the title screen visible.`n" -f $IntervalSec, $Minutes) -ForegroundColor Cyan
Write-Host ("{0,-9} {1,12} {2,12} {3,12}" -f 'elapsed','privMB','gpuLocalMB','gpuDedicMB')

while ((Get-Date) -lt $end) {
  $priv = 0; $loc = 0; $ded = 0
  foreach ($c in $counters) {
    try {
      $v = (Get-Counter $c -ErrorAction Stop).CounterSamples |
           Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum
      if     ($c -like '*Working Set*')    { $priv = $v / 1MB }
      elseif ($c -like '*Local Usage*')    { $loc  = $v / 1MB }
      elseif ($c -like '*Dedicated*')      { $ded  = $v / 1MB }
    } catch {}
  }
  $mins = [math]::Round($n * $IntervalSec / 60, 1)
  $samples.Add([pscustomobject]@{ Minute=$mins; PrivMB=[math]::Round($priv,1)
                                  GpuLocalMB=[math]::Round($loc,1); GpuDedicMB=[math]::Round($ded,1) })
  Write-Host ("{0,-9} {1,12:N1} {2,12:N1} {3,12:N1}" -f "$mins m", $priv, $loc, $ded)
  $n++
  Start-Sleep -Seconds $IntervalSec
}

$samples | Export-Csv -NoTypeInformation -Path $OutCsv

# The verdict. A leak shows as a rising floor, so compare the FIRST fifth of the
# run against the LAST fifth rather than first-vs-last single samples, which
# would be at the mercy of one noisy reading.
$k     = [math]::Max(1, [int]($samples.Count / 5))
$head  = ($samples | Select-Object -First $k | Measure-Object GpuLocalMB -Average).Average
$tail  = ($samples | Select-Object -Last  $k | Measure-Object GpuLocalMB -Average).Average
$delta = $tail - $head

"`n=============== RESULT ==============="
"samples          : {0} over {1} min" -f $samples.Count, $Minutes
"GPU local start  : {0:N1} MB" -f $head
"GPU local end    : {0:N1} MB" -f $tail
"drift            : {0:+0.0;-0.0;0.0} MB  ({1:+0.0;-0.0;0.0} MB/hr)" -f $delta, ($delta * (60 / $Minutes))
"peak             : {0:N1} MB" -f ($samples | Measure-Object GpuLocalMB -Maximum).Maximum
"csv              : $OutCsv"
if ($delta -gt 50) {
  "VERDICT          : CLIMBING — this is a leak. The title screen is the right place to keep digging."
} elseif ($delta -lt -50) {
  "VERDICT          : FALLING — something is being reclaimed; re-run before drawing conclusions."
} else {
  "VERDICT          : FLAT — no title-screen leak. STOP cutting here; the crash is elsewhere."
}
"======================================"
