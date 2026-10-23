$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WindowFocus {
  private delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)] private static extern int SetWindowLong(IntPtr hwnd, int index, int value);
  [DllImport("user32.dll", EntryPoint = "SetParent", SetLastError = true)] private static extern IntPtr SetParentWindow(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", EntryPoint = "SetWindowPos")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
  private const int GWL_STYLE = -16;
  private const int WS_CHILD = 0x40000000;
  private const int WS_POPUP = unchecked((int)0x80000000);
  private const int WS_CAPTION = 0x00C00000;
  private const int WS_THICKFRAME = 0x00040000;
  private const int WS_SYSMENU = 0x00080000;
  private const int WS_MINIMIZEBOX = 0x00020000;
  private const int WS_MAXIMIZEBOX = 0x00010000;
  private const int WS_MINIMIZE = 0x20000000;
  private const int WS_MAXIMIZE = 0x01000000;
  private const uint SWP_NOZORDER = 0x0004;
  private const uint SWP_FRAMECHANGED = 0x0020;
  private const uint SWP_SHOWWINDOW = 0x0040;
  private const uint SWP_NOACTIVATE = 0x0010;

  // The first visible, titled, unowned, non-tool top-level window in z-order owned by the process.
  public static IntPtr FindWindow(uint processId) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr hwnd, IntPtr lParam) {
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      if (owner != processId || !IsWindowVisible(hwnd) || GetWindowTextLength(hwnd) == 0) return true;
      if (GetWindow(hwnd, 4) != IntPtr.Zero) return true;
      if ((GetWindowLong(hwnd, -20) & 0x80) != 0) return true;
      found = hwnd;
      return false;
    }, IntPtr.Zero);
    return found;
  }

  public static string DescribeWindow(IntPtr hwnd) {
    IntPtr previousDpiContext = SetThreadDpiAwarenessContext(new IntPtr(-4));
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) { if (previousDpiContext != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpiContext); return "none"; }
    string result = "{\"handle\":\"" + hwnd.ToInt64() + "\",\"width\":" +
      (rect.Right - rect.Left) + ",\"height\":" + (rect.Bottom - rect.Top) + "}";
    if (previousDpiContext != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpiContext);
    return result;
  }

  public static string Embed(IntPtr hwnd, IntPtr host, int x, int y, int width, int height) {
    IntPtr previousDpiContext = SetThreadDpiAwarenessContext(new IntPtr(-4));
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) { if (previousDpiContext != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpiContext); return "none"; }
    int style = GetWindowLong(hwnd, GWL_STYLE);
    // FindWindow only returns top-level, unowned windows, so restore them as top-level windows.
    IntPtr originalParent = IntPtr.Zero;
    int childStyle = (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_MINIMIZE | WS_MAXIMIZE)) | WS_CHILD;
    SetWindowLong(hwnd, GWL_STYLE, childStyle);
    SetParentWindow(hwnd, host);
    if (GetParent(hwnd) != host) {
      SetParentWindow(hwnd, originalParent);
      SetWindowLong(hwnd, GWL_STYLE, style);
      if (previousDpiContext != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpiContext);
      return "none";
    }
    RECT hostRect;
    if (!GetClientRect(host, out hostRect) || !SetWindowPos(hwnd, IntPtr.Zero, 0, 0,
      hostRect.Right - hostRect.Left, hostRect.Bottom - hostRect.Top,
      SWP_FRAMECHANGED | SWP_SHOWWINDOW)) {
      SetParentWindow(hwnd, originalParent);
      SetWindowLong(hwnd, GWL_STYLE, style);
      SetWindowPos(hwnd, IntPtr.Zero, rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top,
        SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
      if (previousDpiContext != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpiContext);
      return "none";
    }
    ShowWindow(hwnd, 5);
    SetFocus(hwnd);
    if (previousDpiContext != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpiContext);
    return "{\"handle\":\"" + hwnd.ToInt64() + "\",\"parent\":\"" + originalParent.ToInt64() +
      "\",\"style\":" + style + ",\"x\":" + rect.Left + ",\"y\":" + rect.Top +
      ",\"width\":" + (rect.Right - rect.Left) + ",\"height\":" + (rect.Bottom - rect.Top) + "}";
  }

  public static bool UpdateEmbed(IntPtr hwnd, IntPtr host) {
    IntPtr previousDpiContext = SetThreadDpiAwarenessContext(new IntPtr(-4));
    RECT rect;
    bool updated = GetClientRect(host, out rect) && SetWindowPos(hwnd, IntPtr.Zero, 0, 0,
      rect.Right - rect.Left, rect.Bottom - rect.Top, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    if (previousDpiContext != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpiContext);
    return updated;
  }

  public static bool HideEmbed(IntPtr hwnd) { ShowWindow(hwnd, 0); return true; }
  public static bool ShowEmbed(IntPtr hwnd) { ShowWindow(hwnd, 5); return true; }

  public static bool RestoreEmbed(IntPtr hwnd, IntPtr parent, int style, int x, int y, int width, int height) {
    IntPtr previousDpiContext = SetThreadDpiAwarenessContext(new IntPtr(-4));
    SetParentWindow(hwnd, parent);
    SetWindowLong(hwnd, GWL_STYLE, style);
    bool positioned = SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height,
      SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    if ((style & WS_MAXIMIZE) != 0) ShowWindow(hwnd, 3);
    else if ((style & WS_MINIMIZE) != 0) ShowWindow(hwnd, 6);
    if (previousDpiContext != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpiContext);
    return positioned;
  }

  public static bool Focus(IntPtr hwnd) {
    if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
    // A synthetic Alt press lets a background process take the foreground.
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    return SetForegroundWindow(hwnd);
  }

}
'@

# $Mode, $Targets ('pid:name,pid:name'), and window parameters are prepended by the caller, which
# validates both before they get here.
$result = 'none'
if ($Mode -eq 'update-embed') {
  if ([WindowFocus]::UpdateEmbed([IntPtr]([long]$EmbeddedHandle), [IntPtr]([long]$HostHandle))) { $result = 'updated' }
} elseif ($Mode -eq 'restore-embed') {
  $saved = $OriginalState | ConvertFrom-Json
  if ([WindowFocus]::RestoreEmbed([IntPtr]([long]$EmbeddedHandle), [IntPtr]([long]$saved.parent), [int]$saved.style, [int]$saved.x, [int]$saved.y, [int]$saved.width, [int]$saved.height)) { $result = 'restored' }
} elseif ($Mode -eq 'hide-embed') {
  if ([WindowFocus]::HideEmbed([IntPtr]([long]$EmbeddedHandle))) { $result = 'hidden' }
} elseif ($Mode -eq 'show-embed') {
  if ([WindowFocus]::ShowEmbed([IntPtr]([long]$EmbeddedHandle))) { $result = 'shown' }
} elseif ($Mode -eq 'embed') {
  foreach ($entry in $Targets.Split(',')) {
    $pidText, $name = $entry.Split(':', 2)
    $process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if (-not $process -or ($process.ProcessName + '.exe') -ne $name) { continue }
    $window = [WindowFocus]::FindWindow([uint32]$process.Id)
    if ($window -eq [IntPtr]::Zero) { continue }
    $result = [WindowFocus]::Embed($window, [IntPtr]([long]$HostHandle), $EmbedX, $EmbedY, $EmbedWidth, $EmbedHeight)
    if ($result -ne 'none') { break }
  }
}
if ($result -eq 'none' -and $Mode -notin @('update-embed', 'restore-embed', 'embed')) {
foreach ($entry in $Targets.Split(',')) {
  $pidText, $name = $entry.Split(':', 2)
  $process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
  if (-not $process -or ($process.ProcessName + '.exe') -ne $name) { continue }
  $window = [WindowFocus]::FindWindow([uint32]$process.Id)
  if ($window -eq [IntPtr]::Zero) { continue }
  if ($Mode -eq 'find') {
    $result = [WindowFocus]::DescribeWindow($window)
    break
  }
  if ([WindowFocus]::Focus($window)) {
    $result = 'focused'
    break
  }
}
}
Write-Output $result
