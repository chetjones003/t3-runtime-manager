function registerRuntimePreviewIpc({
  ipcMain,
  takeControl,
  desktopCapturer,
  getMainWindow,
  ownWindowHandle,
  assertTrustedSender,
  isTrustedCockpitUrl,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  // The window chosen by the latest preview request, per renderer. It is kept (not consumed)
  // so overlapping capture requests, such as React StrictMode's double effect, both succeed.
  const selectedDisplaySources = new Map();
  let windowSources = new Map();
  let sourceScanPromise = null;

  async function refreshWindowSources() {
    if (sourceScanPromise) return sourceScanPromise;
    sourceScanPromise = desktopCapturer
      .getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const next = new Map();
        for (const source of sources) {
          const match = /^window:(\d+):/.exec(source.id);
          if (match) next.set(match[1], source);
        }
        windowSources = next;
        return next;
      })
      .finally(() => {
        sourceScanPromise = null;
      });
    return sourceScanPromise;
  }

  const hasWindowSource = (handle) => windowSources.has(handle);
  const hasWindowSources = () => windowSources.size > 0;

  ipcMain.handle('runtime:preview', async (event, runtimeId) => {
    assertTrustedSender(event, 'Runtime preview');
    if (typeof runtimeId !== 'string' || runtimeId.length > 200) {
      throw new Error('Invalid runtime.');
    }

    let preview = await takeControl.getPreview(runtimeId);
    if (preview.kind !== 'window') {
      selectedDisplaySources.delete(event.sender.id);
      return preview;
    }
    // Mirroring the manager window would only display an endless tunnel of itself.
    if (preview.handle === ownWindowHandle()) {
      selectedDisplaySources.delete(event.sender.id);
      return { kind: 'self' };
    }

    let source = windowSources.get(preview.handle);
    if (!source && windowSources.size > 0) {
      // The cached handle may have gone away while its process stayed alive. Resolve it again.
      takeControl.forgetPreviewWindow(runtimeId);
      preview = await takeControl.getPreview(runtimeId);
      if (preview.kind !== 'window') {
        selectedDisplaySources.delete(event.sender.id);
        return preview;
      }
      source = windowSources.get(preview.handle);
    }
    if (!source) {
      await refreshWindowSources();
      source = windowSources.get(preview.handle);
    }
    // Hidden Qt windows may need a moment before Windows exposes them to desktop capture.
    if (!source) {
      await delay(200);
      await refreshWindowSources();
      source = windowSources.get(preview.handle);
    }
    if (!source) {
      selectedDisplaySources.delete(event.sender.id);
      return { kind: 'none' };
    }
    selectedDisplaySources.set(event.sender.id, source);
    return { kind: 'window', sourceId: source.id };
  });

  function handleDisplayMediaRequest(request, callback) {
    const mainWindow = getMainWindow();
    const frameMatches = Boolean(mainWindow && request.frame === mainWindow.webContents.mainFrame);
    const mainFrameUrl = mainWindow?.webContents.getURL();
    const cockpitUrlTrusted = isTrustedCockpitUrl(mainFrameUrl);
    if (!mainWindow || !frameMatches || !cockpitUrlTrusted || !request.videoRequested) {
      callback(null);
      return;
    }
    const source = selectedDisplaySources.get(mainWindow.webContents.id);
    callback(source ? { video: source } : null);
  }

  return {
    handleDisplayMediaRequest,
    refreshWindowSources,
    hasWindowSource,
    hasWindowSources,
  };
}

module.exports = { registerRuntimePreviewIpc };
