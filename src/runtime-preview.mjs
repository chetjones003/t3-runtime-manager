async function startRuntimePreview(runtimeId, { getRuntimePreview, getDisplayMedia }) {
  const preview = await getRuntimePreview(runtimeId);
  if (preview.kind !== 'window') return { preview, stream: null };
  if (typeof preview.sourceId !== 'string') {
    throw new Error('Electron did not provide a capture source for this window.');
  }

  const stream = await getDisplayMedia({ audio: false, video: true });
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    try {
      await videoTrack.applyConstraints({
        cursor: { exact: 'never' },
        frameRate: { ideal: 15, max: 15 },
      });
    } catch {
      try {
        await videoTrack.applyConstraints({ frameRate: { ideal: 15, max: 15 } });
      } catch {
        // Keep the preview usable when a capture backend cannot honor these preferences.
      }
    }
  }
  return { preview, stream };
}

export { startRuntimePreview };
