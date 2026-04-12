export const DEFAULT_VIEWPORT = {
  zoom: 1,
  centerX: 0.5,
  centerY: 0.5,
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 12;
const ZOOM_FACTOR = 1.12;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getScaledSize(container, natural, zoom) {
  const fitScale = Math.min(container.width / natural.width, container.height / natural.height);
  return {
    width: natural.width * fitScale * zoom,
    height: natural.height * fitScale * zoom,
  };
}

function clampOrigin(origin, viewportSize, scaledSize) {
  if (scaledSize <= viewportSize) {
    return (viewportSize - scaledSize) / 2;
  }

  return clamp(origin, viewportSize - scaledSize, 0);
}

function toDisplayRect(viewport, container, natural) {
  const scaled = getScaledSize(container, natural, viewport.zoom);
  const unclampedLeft = container.width / 2 - viewport.centerX * scaled.width;
  const unclampedTop = container.height / 2 - viewport.centerY * scaled.height;

  return {
    width: scaled.width,
    height: scaled.height,
    left: clampOrigin(unclampedLeft, container.width, scaled.width),
    top: clampOrigin(unclampedTop, container.height, scaled.height),
  };
}

function toViewportFromRect(rect, container, zoom) {
  return {
    zoom,
    centerX: clamp((container.width / 2 - rect.left) / rect.width, 0, 1),
    centerY: clamp((container.height / 2 - rect.top) / rect.height, 0, 1),
  };
}

export function getImageStyle(viewport, container, natural) {
  const rect = toDisplayRect(viewport, container, natural);
  return {
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    left: `${rect.left}px`,
    top: `${rect.top}px`,
  };
}

export function zoomViewportAtPoint(viewport, container, natural, cursorX, cursorY, direction) {
  const currentRect = toDisplayRect(viewport, container, natural);
  const nextZoom = clamp(
    direction > 0 ? viewport.zoom * ZOOM_FACTOR : viewport.zoom / ZOOM_FACTOR,
    MIN_ZOOM,
    MAX_ZOOM,
  );

  if (nextZoom === viewport.zoom) {
    return viewport;
  }

  const imageX = clamp((cursorX - currentRect.left) / currentRect.width, 0, 1);
  const imageY = clamp((cursorY - currentRect.top) / currentRect.height, 0, 1);
  const nextSize = getScaledSize(container, natural, nextZoom);

  const nextRect = {
    width: nextSize.width,
    height: nextSize.height,
    left: clampOrigin(cursorX - imageX * nextSize.width, container.width, nextSize.width),
    top: clampOrigin(cursorY - imageY * nextSize.height, container.height, nextSize.height),
  };

  return toViewportFromRect(nextRect, container, nextZoom);
}

export function panViewport(viewport, container, natural, deltaX, deltaY) {
  const currentRect = toDisplayRect(viewport, container, natural);
  const nextRect = {
    ...currentRect,
    left: clampOrigin(currentRect.left + deltaX, container.width, currentRect.width),
    top: clampOrigin(currentRect.top + deltaY, container.height, currentRect.height),
  };

  return toViewportFromRect(nextRect, container, viewport.zoom);
}

export function canPan(viewport) {
  return viewport.zoom > 1;
}
