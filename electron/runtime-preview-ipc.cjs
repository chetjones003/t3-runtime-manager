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
  const pendingDisplaySources = new Map();

  ipcMain.handle('runtime:preview', async (event, runtimeId) => {
    assertTrustedSender(event, 'Runtime preview');
    if (typeof runtimeId !== 'string' || runtimeId.length > 200) {
      throw new Error('Invalid runtime.');
    }

    const preview = await takeControl.getPreview(runtimeId);
    if (preview.kind !== 'window') return preview;
    // Mirroring the manager window would only display an endless tunnel of itself.
    if (preview.handle === ownWindowHandle()) return { kind: 'self' };

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
    if (!source) return { kind: 'none' };
    pendingDisplaySources.set(event.sender.id, source);
    return { kind: 'window', sourceId: source.id };
  });

  function handleDisplayMediaRequest(request, callback) {
    const mainWindow = getMainWindow();
    if (
      !mainWindow ||
      request.frame !== mainWindow.webContents.mainFrame ||
      !isTrustedCockpitUrl(request.securityOrigin) ||
      !request.videoRequested
    ) {
      callback(null);
      return;
    }
    const source = pendingDisplaySources.get(mainWindow.webContents.id);
    pendingDisplaySources.delete(mainWindow.webContents.id);
    callback(source ? { video: source } : null);
  }

  return { handleDisplayMediaRequest };
}

module.exports = { registerRuntimePreviewIpc };
