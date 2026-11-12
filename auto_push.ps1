# ============================================================
# RouteIQ - Auto Save & Push to GitHub
# Watches for file changes and auto-commits + pushes every 5 minutes
# or immediately when files change.
# Run this script from the SIE lab folder.
# ============================================================

$projectDir = "C:\Users\Harshal\OneDrive\Desktop\SIE lab"
$branch = "main"
$intervalSeconds = 300  # Push every 5 minutes if changes exist

Write-Host "🔄 RouteIQ Auto-Push started. Watching for changes..." -ForegroundColor Cyan
Write-Host "📁 Project: $projectDir" -ForegroundColor Gray
Write-Host "⏱️  Push interval: every $intervalSeconds seconds" -ForegroundColor Gray
Write-Host "Press Ctrl+C to stop.`n" -ForegroundColor Yellow

Set-Location $projectDir

# Setup FileSystemWatcher
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $projectDir
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]'LastWrite, FileName, DirectoryName'

# Track last push time
$lastPushTime = [DateTime]::Now
$changeDetected = $false

# Event handler for changes
$onChange = {
    $path = $Event.SourceEventArgs.FullPath
    # Ignore git internals, node_modules, .kilo, temp files
    if ($path -notmatch 'node_modules|\.git\\|\.kilo|\.tmp|\.log|~$') {
        $global:changeDetected = $true
    }
}

Register-ObjectEvent $watcher Changed  -Action $onChange | Out-Null
Register-ObjectEvent $watcher Created  -Action $onChange | Out-Null
Register-ObjectEvent $watcher Deleted  -Action $onChange | Out-Null
Register-ObjectEvent $watcher Renamed  -Action $onChange | Out-Null

function Push-Changes {
    $status = git status --porcelain 2>&1
    if ($status) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Write-Host "`n[$timestamp] 📦 Changes detected — committing & pushing..." -ForegroundColor Green
        git add -A
        git commit -m "auto-save: $timestamp"
        git push origin $branch
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Pushed to GitHub successfully!" -ForegroundColor Green
        } else {
            Write-Host "❌ Push failed. Check your internet/credentials." -ForegroundColor Red
        }
        $global:lastPushTime = [DateTime]::Now
        $global:changeDetected = $false
    } else {
        Write-Host "$(Get-Date -Format 'HH:mm:ss') ✓ No changes to push." -ForegroundColor DarkGray
    }
}

# Main loop
while ($true) {
    Start-Sleep -Seconds 30

    $secondsSinceLastPush = ([DateTime]::Now - $lastPushTime).TotalSeconds

    # Push if: changes detected AND 5 min elapsed, OR 10 min elapsed regardless
    if (($changeDetected -and $secondsSinceLastPush -ge $intervalSeconds) -or ($secondsSinceLastPush -ge 600)) {
        Push-Changes
    }
}
