$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WindowFocus {
  private delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
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
  [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr hwnd, ref POINT point);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
  [DllImport("user32.dll", EntryPoint = "PostMessageW")] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
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

  // Prefer a normal visible window, but Qt apps can expose their real surface as a hidden,
  // untitled HWND. Keep the largest substantial top-level window as a recovery candidate.
  public static IntPtr FindWindow(uint processId) {
    IntPtr found = IntPtr.Zero;
    IntPtr fallback = IntPtr.Zero;
    long fallbackArea = 0;
    EnumWindows(delegate (IntPtr hwnd, IntPtr lParam) {
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      if (owner != processId) return true;
      if (GetWindow(hwnd, 4) != IntPtr.Zero) return true;
      if ((GetWindowLong(hwnd, -20) & 0x80) != 0) return true;
      RECT rect;
      if (!GetWindowRect(hwnd, out rect)) return true;
      long width = rect.Right - rect.Left;
      long height = rect.Bottom - rect.Top;
      long area = width * height;
      if (width < 200 || height < 150) return true;
      if (IsWindowVisible(hwnd) && GetWindowTextLength(hwnd) > 0) {
        found = hwnd;
        return false;
      }
      if (area > fallbackArea) { fallback = hwnd; fallbackArea = area; }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero && fallback != IntPtr.Zero) {
      found = fallback;
      // SW_SHOW makes hidden Qt top-level windows visible to both the user and
      // desktopCapturer. SW_SHOWNOACTIVATE alone can leave them absent from capture.
      ShowWindow(found, 5);
    }
    return found;
  }

  public static string Embed(IntPtr hwnd, IntPtr host, int x, int y, int width, int height) {
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) return "none";
    int style = GetWindowLong(hwnd, GWL_STYLE);
    // FindWindow only returns top-level, unowned windows, so restore them as top-level windows.
    IntPtr originalParent = IntPtr.Zero;
    int childStyle = (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_MINIMIZE | WS_MAXIMIZE)) | WS_CHILD;
    SetWindowLong(hwnd, GWL_STYLE, childStyle);
    SetParentWindow(hwnd, host);
    if (GetParent(hwnd) != host) {
      SetParentWindow(hwnd, originalParent);
      SetWindowLong(hwnd, GWL_STYLE, style);
      return "none";
    }
    if (!SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height,
      SWP_FRAMECHANGED | SWP_SHOWWINDOW)) {
      SetParentWindow(hwnd, originalParent);
      SetWindowLong(hwnd, GWL_STYLE, style);
      SetWindowPos(hwnd, IntPtr.Zero, rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top,
        SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
      return "none";
    }
    SetForegroundWindow(hwnd);
    SetFocus(hwnd);
    return "{\"handle\":\"" + hwnd.ToInt64() + "\",\"parent\":\"" + originalParent.ToInt64() +
      "\",\"style\":" + style + ",\"x\":" + rect.Left + ",\"y\":" + rect.Top +
      ",\"width\":" + (rect.Right - rect.Left) + ",\"height\":" + (rect.Bottom - rect.Top) + "}";
  }

  public static bool UpdateEmbed(IntPtr hwnd, int x, int y, int width, int height) {
    return SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height,
      SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }

  public static bool RestoreEmbed(IntPtr hwnd, IntPtr parent, int style, int x, int y, int width, int height) {
    SetParentWindow(hwnd, parent);
    SetWindowLong(hwnd, GWL_STYLE, style);
    bool positioned = SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height,
      SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    if ((style & WS_MAXIMIZE) != 0) ShowWindow(hwnd, 3);
    else if ((style & WS_MINIMIZE) != 0) ShowWindow(hwnd, 6);
    return positioned;
  }

  public static bool Focus(IntPtr hwnd) {
    if (!IsWindowVisible(hwnd)) ShowWindow(hwnd, 5);
    else if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
    // A synthetic Alt press lets a background process take the foreground.
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    return SetForegroundWindow(hwnd);
  }

  // Coordinates are normalized to the full captured window image, then converted to client space.
  public static bool PostMouse(IntPtr hwnd, string type, double x, double y, string button, int buttons, int delta) {
    // The bridge runs in a PowerShell process which may be DPI-unaware while the target app is
    // per-monitor aware. SetThreadDpiAwarenessContext keeps GetWindowRect, ScreenToClient, and the
    // coordinates consumed by the target window in the same physical-pixel coordinate space.
    IntPtr previousDpiContext = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      RECT rect;
      if (!GetWindowRect(hwnd, out rect)) return false;
      POINT point = new POINT {
        X = rect.Left + (int)Math.Round(x * (rect.Right - rect.Left)),
        Y = rect.Top + (int)Math.Round(y * (rect.Bottom - rect.Top))
      };
      POINT screenPoint = point;
      if (!ScreenToClient(hwnd, ref point)) return false;
      // Send coordinates to the same top-level HWND used for capture. Qt performs its own
      // child-widget hit testing; posting child-local coordinates here applies child offsets twice.
      uint clientPacked = ((uint)(ushort)point.Y << 16) | (ushort)point.X;
      IntPtr clientPosition = (IntPtr)(long)clientPacked;
      if (type == "wheel") {
        uint wheelPacked = ((uint)(ushort)screenPoint.Y << 16) | (ushort)screenPoint.X;
        return PostMessage(hwnd, 0x020A, (IntPtr)(delta << 16), (IntPtr)(long)wheelPacked);
      }
      if (type == "move") return PostMessage(hwnd, 0x0200, (IntPtr)buttons, clientPosition);
      uint message = type == "down" ? (button == "right" ? 0x0204u : 0x0201u) :
        type == "up" ? (button == "right" ? 0x0205u : 0x0202u) : 0;
      if (message == 0) return false;
      IntPtr flags = type == "down" ? (IntPtr)(button == "right" ? 0x0002 : 0x0001) : IntPtr.Zero;
      return PostMessage(hwnd, message, flags, clientPosition);
    } finally {
      if (previousDpiContext != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpiContext);
    }
  }

  public static bool OwnsWindow(IntPtr hwnd, uint processId) {
    uint owner;
    return IsWindow(hwnd) && GetWindowThreadProcessId(hwnd, out owner) != 0 && owner == processId;
  }

  public static bool PostKey(IntPtr hwnd, int keyCode, int[] charCodes, int modifiers) {
    if (keyCode < 0 || keyCode > 255 || modifiers < 0 || modifiers > 7) return false;
    int[] modifierKeys = new int[] { 0x10, 0x11, 0x12 };
    for (int i = 0; i < modifierKeys.Length; i++) {
      if ((modifiers & (1 << i)) != 0) PostMessage(hwnd, 0x0100, (IntPtr)modifierKeys[i], (IntPtr)1);
    }
    bool sent = PostMessage(hwnd, 0x0100, (IntPtr)keyCode, (IntPtr)1);
    if (charCodes != null) {
      foreach (int character in charCodes) {
        if (character < 0 || character > 65535) return false;
        sent = PostMessage(hwnd, 0x0102, (IntPtr)character, (IntPtr)1) && sent;
      }
    }
    sent = PostMessage(hwnd, 0x0101, (IntPtr)keyCode, new IntPtr(unchecked((int)0xC0000001u))) && sent;
    for (int i = modifierKeys.Length - 1; i >= 0; i--) {
      if ((modifiers & (1 << i)) != 0) PostMessage(hwnd, 0x0101, (IntPtr)modifierKeys[i], new IntPtr(unchecked((int)0xC0000001u)));
    }
    return sent;
  }

}
'@

# $Mode, $Targets ('pid:name,pid:name'), and input parameters are prepended by the caller, which
# validates both before they get here.
$result = 'none'
if ($Mode -eq 'update-embed') {
  if ([WindowFocus]::UpdateEmbed([IntPtr]([long]$EmbeddedHandle), $EmbedX, $EmbedY, $EmbedWidth, $EmbedHeight)) { $result = 'updated' }
} elseif ($Mode -eq 'restore-embed') {
  $saved = $OriginalState | ConvertFrom-Json
  if ([WindowFocus]::RestoreEmbed([IntPtr]([long]$EmbeddedHandle), [IntPtr]([long]$saved.parent), [int]$saved.style, [int]$saved.x, [int]$saved.y, [int]$saved.width, [int]$saved.height)) { $result = 'restored' }
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
  if ($Mode -eq 'mouse' -and $PreviewHandle -match '^\d{1,20}$') {
    $previewWindow = [IntPtr]([long]$PreviewHandle)
    if ([WindowFocus]::OwnsWindow($previewWindow, [uint32]$process.Id)) {
      if ([WindowFocus]::PostMouse($previewWindow, $MouseType, $MouseX, $MouseY, $MouseButton, $MouseFlags, $MouseDelta)) {
        $result = 'sent'
        break
      }
      continue
    }
  }
  $window = [WindowFocus]::FindWindow([uint32]$process.Id)
  if ($window -eq [IntPtr]::Zero) { continue }
  if ($Mode -eq 'find') {
    $result = [string][int64]$window
    break
  }
  if ($Mode -eq 'mouse') {
    if ([WindowFocus]::PostMouse($window, $MouseType, $MouseX, $MouseY, $MouseButton, $MouseFlags, $MouseDelta)) {
      $result = 'sent'
      break
    }
    continue
  }
  if ($Mode -eq 'key') {
    if ([WindowFocus]::PostKey($window, $KeyCode, $CharCodes, $Modifiers)) {
      $result = 'sent'
      break
    }
    continue
  }
  if ([WindowFocus]::Focus($window)) {
    $result = 'focused'
    break
  }
}
}
Write-Output $result
