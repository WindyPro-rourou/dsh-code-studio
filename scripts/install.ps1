# Install / refresh dsh-code-studio into the web profile.
# Idempotent: safe to re-run after editing the plugin sources.
$ErrorActionPreference = "Stop"
$src = "F:\CycleMaster\dsh-code-studio"
$profile = Join-Path $env:USERPROFILE ".dsh\profiles\web"

Write-Host "==> Copying plugin package into profile node_modules..."
$dest = Join-Path $profile "node_modules\@local\dsh-code-studio"
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Copy-Item -Recurse -Force $src $dest

Write-Host "==> Ensuring package.json dependency..."
$pkgPath = Join-Path $profile "package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if (-not $pkg.dependencies."@local/dsh-code-studio") {
  $pkg.dependencies | Add-Member -NotePropertyName "@local/dsh-code-studio" -NotePropertyValue "link:F:/CycleMaster/dsh-code-studio" -Force
  ($pkg | ConvertTo-Json -Depth 10) | Set-Content $pkgPath -Encoding UTF8
  Write-Host "    added dependency."
} else {
  Write-Host "    dependency already present."
}

Write-Host "==> Ensuring cordis.patch.yml insert row..."
$patchPath = Join-Path $profile "cordis.patch.yml"
$patch = Get-Content $patchPath -Raw
if ($patch -notmatch "code-studio") {
  $row = "- insert:" + [char]10 + "    - id: code-studio" + [char]10 + "      name: '@local/dsh-code-studio'" + [char]10
  Add-Content $patchPath $row
  Write-Host "    insert row added."
} else {
  Write-Host "    insert row already present."
}

Write-Host ""
Write-Host "Done. The plugin activates on the next 'dsh web' start (client plugin roster is fixed at boot)."
Write-Host "Preview now on another port:  dsh web --port 3081"
