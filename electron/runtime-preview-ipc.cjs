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

  ipcMain.handle('runtime:preview', async (event, runtimeId) => {
    assertTrustedSender(event, 'Runtime preview');
    if (typeof runtimeId !== 'string' || runtimeId.length > 200) {
      throw new Error('Invalid runtime.');
    }

    const preview = await takeControl.getPreview(runtimeId);
    if (preview.kind !== 'window') {
      selectedDisplaySources.delete(event.sender.id);
      return preview;
    }
    // Mirroring the manager window would only display an endless tunnel of itself.
    if (preview.handle === ownWindowHandle()) {
      selectedDisplaySources.delete(event.sender.id);
      return { kind: 'self' };
    }

    let source;
    // Hidden Qt windows may need a moment before Windows exposes them to desktop capture.
    for (let attempt = 0; attempt < 5 && !source; attempt += 1) {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      source = sources.find((candidate) => candidate.id.startsWith(`window:${preview.handle}:`));
      if (!source && attempt < 4) await delay(200);
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

  return { handleDisplayMediaRequest };
}

module.exports = { registerRuntimePreviewIpc };
