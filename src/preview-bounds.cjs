function fitPreviewBounds(viewport, source) {
  if (
    !viewport ||
    !source ||
    ![viewport.x, viewport.y, viewport.width, viewport.height, source.width, source.height].every(
      Number.isFinite,
    ) ||
    viewport.width < 100 ||
    viewport.height < 100 ||
    source.width <= 0 ||
    source.height <= 0
  )
    return null;

  const scale = Math.min(viewport.width / source.width, viewport.height / source.height);
  const width = Math.floor(source.width * scale);
  const height = Math.floor(source.height * scale);
  if (width < 100 || height < 100) return null;
  return {
    x: Math.round(viewport.x + (viewport.width - width) / 2),
    y: Math.round(viewport.y + (viewport.height - height) / 2),
    width,
    height,
  };
}

function placePreviewHost(contentOrigin, bounds) {
  return {
    x: Math.round(contentOrigin.x + bounds.x),
    y: Math.round(contentOrigin.y + bounds.y),
    width: bounds.width,
    height: bounds.height,
  };
}

module.exports = { fitPreviewBounds, placePreviewHost };
