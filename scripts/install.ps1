param([switch]$Preview)

$ErrorActionPreference = 'Stop'

function Show-Banner {
  Write-Host ''
  Write-Host '                    T3 RUNTIME MANAGER' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '                         .------.' -ForegroundColor DarkCyan
  Write-Host '                         |  T3  |' -ForegroundColor Cyan
  Write-Host "                         '---+--'" -ForegroundColor DarkCyan
  Write-Host '                             |'
  Write-Host '                        .----+----.'
  Write-Host '                       /           \'
  Write-Host '                [ WORKTREE ]   [ WORKTREE ]' -ForegroundColor Yellow
  Write-Host '                     |               |'
  Write-Host '                 [ APP ]           [ APP ]' -ForegroundColor Green
  Write-Host ''
  Write-Host '             INSTALL  /  T3 CODE RUNTIME COMPANION' -ForegroundColor DarkGray
  Write-Host '  ----------------------------------------------------------------'
  Write-Host ''
}

function Show-Step([string]$Label, [string]$Message, [ConsoleColor]$Color = 'Gray') {
  Write-Host ('  [{0}] {1}' -f $Label, $Message) -ForegroundColor $Color
}

Show-Banner
Show-Step '*' 'Platform: Windows x64' Cyan
Show-Step '*' 'Install location: current user' Cyan

if ($Preview) {
  Show-Step '+' 'Checking latest release...' Green
  Show-Step '+' 'Downloading the latest Windows installer...' Green
  Show-Step '+' 'Installing silently...' Green
  Show-Step '+' 'Done. Launch T3 Runtime Manager from the Start menu.' Green
  Write-Host ''
  exit 0
}

try {
  Show-Step '*' 'Checking latest release...' Cyan
  $release = Invoke-RestMethod 'https://api.github.com/repos/chetjones003/thread-app-manager/releases/latest'
  $asset = $release.assets | Where-Object { $_.name -match 'Setup.*\.exe$' } | Select-Object -First 1
  if (-not $asset) { throw 'No Windows installer was found in the latest release.' }

  $installer = Join-Path $env:TEMP $asset.name
  Show-Step '*' ('Downloading {0}...' -f $asset.name) Cyan
  Invoke-WebRequest $asset.browser_download_url -OutFile $installer
  Show-Step '*' 'Installing for the current user...' Cyan
  $process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)." }

  Remove-Item -LiteralPath $installer -Force
  Show-Step '+' 'Done. Launch T3 Runtime Manager from the Start menu.' Green
  Write-Host ''
} catch {
  Show-Step '!' $_.Exception.Message Red
  exit 1
}
