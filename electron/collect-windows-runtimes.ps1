$ErrorActionPreference = 'Stop'
$processes = [System.Collections.Generic.List[object]]::new()
$listeners = [System.Collections.Generic.List[object]]::new()
$limitations = [System.Collections.Generic.List[string]]::new()

try {
  foreach ($item in Get-CimInstance -ClassName Win32_Process -ErrorAction Stop) {
    $processes.Add([pscustomobject]@{
      pid = [int]$item.ProcessId
      parentPid = [int]$item.ParentProcessId
      name = [string]$item.Name
      executablePath = [string]$item.ExecutablePath
      commandLine = [string]$item.CommandLine
    })
  }
} catch {
  $limitations.Add('Windows process metadata is unavailable for this scan.')
}

try {
  foreach ($item in Get-NetTCPConnection -State Listen -ErrorAction Stop) {
    $listeners.Add([pscustomobject]@{
      pid = [int]$item.OwningProcess
      address = [string]$item.LocalAddress
      port = [int]$item.LocalPort
    })
  }
} catch {
  $limitations.Add('Windows TCP listener ownership is unavailable for this scan.')
}

ConvertTo-Json -InputObject ([pscustomobject]@{
  processes = @($processes)
  listeners = @($listeners)
  limitations = @($limitations)
}) -Depth 4 -Compress
