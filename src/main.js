import { MANIFEST_PATH, loadManifest } from './lib/manifest.js';
import { getGridLayout } from './lib/layout.js';
import {
  DEFAULT_THEME_COLOR,
  THEME_PRESETS,
  buildThemeTokens,
  normalizeThemeColor,
} from './lib/theme.js';
import {
  DEFAULT_VIEWPORT,
  canPan,
  getImageRect,
  panViewport,
  zoomViewportAtPoint,
} from './lib/viewport.js';

const THEME_STORAGE_KEY = 'cute-visualizer:theme-color';
const SIDEBAR_WIDTH_STORAGE_KEY = 'cute-visualizer:sidebar-width';
const MAX_SELECTED_METHODS = 9;
const DEFAULT_SELECTION_COUNT = 4;
const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_VIEWER_WIDTH = 320;
const SIDEBAR_KEYBOARD_STEP = 16;

function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (textContent !== undefined) {
    element.textContent = textContent;
  }

  return element;
}

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return 'unknown time';
  }

  const date = new Date(isoString);

  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  return date.toLocaleString();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

class ComparisonPanel {
  constructor({ method, imagePath, imageLabel, viewport, onViewportChange }) {
    this.method = method;
    this.imagePath = imagePath;
    this.imageLabel = imageLabel;
    this.viewport = viewport;
    this.onViewportChange = onViewportChange;
    this.naturalSize = null;
    this.isDragging = false;
    this.lastPointer = { x: 0, y: 0 };
    this.hoverPoint = null;

    this.handleWheel = this.handleWheel.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleStageMouseMove = this.handleStageMouseMove.bind(this);
    this.handleStageMouseLeave = this.handleStageMouseLeave.bind(this);
    this.handleImageLoad = this.handleImageLoad.bind(this);
    this.handleImageError = this.handleImageError.bind(this);
    this.handleResize = this.handleResize.bind(this);

    this.element = createElement('article', 'comparison-panel');
    this.header = createElement('div', 'panel-header');
    this.methodTag = createElement('span', 'method-tag', method.label);
    this.metaTag = createElement('span', 'panel-meta-tag', 'Loading...');
    this.header.append(this.methodTag, this.metaTag);

    this.stage = createElement('div', 'panel-stage');
    this.canvas = createElement('canvas', 'panel-canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `${method.label}: ${imageLabel}`);
    this.canvasContext = this.canvas.getContext('2d');
    this.image = new Image();
    this.image.draggable = false;
    this.image.decoding = 'async';

    this.overlay = createElement('div', 'panel-overlay');
    this.overlay.textContent = 'Scroll to zoom. Drag with left mouse button to pan.';
    this.coordinateTip = createElement('div', 'panel-coordinate-tip');

    this.stage.append(this.canvas, this.overlay, this.coordinateTip);
    this.element.append(this.header, this.stage);

    this.image.addEventListener('load', this.handleImageLoad);
    this.image.addEventListener('error', this.handleImageError);
    this.stage.addEventListener('wheel', this.handleWheel, { passive: false });
    this.stage.addEventListener('mousedown', this.handleMouseDown);
    this.stage.addEventListener('mousemove', this.handleStageMouseMove);
    this.stage.addEventListener('mouseleave', this.handleStageMouseLeave);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.image.src = imagePath;

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.stage);
    } else {
      window.addEventListener('resize', this.handleResize);
    }
  }

  mount(parent) {
    parent.appendChild(this.element);
  }

  destroy() {
    this.stage.removeEventListener('wheel', this.handleWheel);
    this.stage.removeEventListener('mousedown', this.handleMouseDown);
    this.stage.removeEventListener('mousemove', this.handleStageMouseMove);
    this.stage.removeEventListener('mouseleave', this.handleStageMouseLeave);
    this.image.removeEventListener('load', this.handleImageLoad);
    this.image.removeEventListener('error', this.handleImageError);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    } else {
      window.removeEventListener('resize', this.handleResize);
    }
  }

  setViewport(viewport) {
    this.viewport = viewport;
    this.refreshLayout();
    this.updateCursor();
  }

  handleImageLoad(event) {
    this.naturalSize = {
      width: event.currentTarget.naturalWidth,
      height: event.currentTarget.naturalHeight,
    };
    this.metaTag.textContent = `${this.naturalSize.width} x ${this.naturalSize.height}`;
    this.element.classList.remove('is-error');
    this.refreshLayout();
    this.updateCursor();
  }

  handleImageError() {
    this.element.classList.add('is-error');
    this.metaTag.textContent = 'Image unavailable';
    this.overlay.textContent = 'This image could not be loaded.';
    this.hideCoordinateTip();
  }

  handleResize() {
    this.refreshLayout();
  }

  handleStageMouseMove(event) {
    if (!this.naturalSize) {
      return;
    }

    const bounds = this.stage.getBoundingClientRect();
    this.hoverPoint = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    this.updateCoordinateTip();
  }

  handleStageMouseLeave() {
    if (this.isDragging) {
      return;
    }

    this.hoverPoint = null;
    this.hideCoordinateTip();
  }

  handleWheel(event) {
    if (!this.naturalSize) {
      return;
    }

    event.preventDefault();
    const bounds = this.stage.getBoundingClientRect();
    const cursorX = event.clientX - bounds.left;
    const cursorY = event.clientY - bounds.top;
    const direction = event.deltaY < 0 ? 1 : -1;

    this.onViewportChange((previous) =>
      zoomViewportAtPoint(previous, this.getStageSize(), this.naturalSize, cursorX, cursorY, direction),
    );
  }

  handleMouseDown(event) {
    if (event.button !== 0 || !this.naturalSize || !canPan(this.viewport)) {
      return;
    }

    event.preventDefault();
    this.isDragging = true;
    this.lastPointer = {
      x: event.clientX,
      y: event.clientY,
    };
    this.element.classList.add('is-dragging');
    this.updateCursor();
  }

  handleMouseMove(event) {
    if (!this.isDragging || !this.naturalSize) {
      return;
    }

    const deltaX = event.clientX - this.lastPointer.x;
    const deltaY = event.clientY - this.lastPointer.y;
    this.lastPointer = {
      x: event.clientX,
      y: event.clientY,
    };
    const bounds = this.stage.getBoundingClientRect();
    this.hoverPoint = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };

    this.onViewportChange((previous) =>
      panViewport(previous, this.getStageSize(), this.naturalSize, deltaX, deltaY),
    );
  }

  handleMouseUp() {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.element.classList.remove('is-dragging');
    this.updateCursor();
  }

  getStageSize() {
    return {
      width: Math.max(this.stage.clientWidth, 1),
      height: Math.max(this.stage.clientHeight, 1),
    };
  }

  refreshLayout() {
    if (!this.naturalSize || !this.canvasContext) {
      return;
    }

    this.drawCanvas();
    this.updateCoordinateTip();
  }

  updateCursor() {
    if (!this.naturalSize) {
      this.stage.style.cursor = 'progress';
      return;
    }

    if (this.isDragging) {
      this.stage.style.cursor = 'grabbing';
      return;
    }

    this.stage.style.cursor = canPan(this.viewport) ? 'grab' : 'zoom-in';
  }

  drawCanvas() {
    const stageSize = this.getStageSize();
    const devicePixelRatio = window.devicePixelRatio || 1;
    const targetWidth = Math.max(Math.round(stageSize.width * devicePixelRatio), 1);
    const targetHeight = Math.max(Math.round(stageSize.height * devicePixelRatio), 1);

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
      this.canvas.style.width = `${stageSize.width}px`;
      this.canvas.style.height = `${stageSize.height}px`;
    }

    const context = this.canvasContext;
    const imageRect = getImageRect(this.viewport, stageSize, this.naturalSize);
    const isZoomed = this.viewport.zoom > 1;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.imageSmoothingEnabled = !isZoomed;
    if ('mozImageSmoothingEnabled' in context) {
      context.mozImageSmoothingEnabled = !isZoomed;
    }
    if ('webkitImageSmoothingEnabled' in context) {
      context.webkitImageSmoothingEnabled = !isZoomed;
    }
    context.imageSmoothingQuality = isZoomed ? 'low' : 'high';
    context.drawImage(
      this.image,
      imageRect.left,
      imageRect.top,
      imageRect.width,
      imageRect.height,
    );

    this.element.classList.toggle('is-zoomed', isZoomed);
  }

  hideCoordinateTip() {
    this.coordinateTip.classList.remove('is-visible');
  }

  updateCoordinateTip() {
    if (!this.naturalSize || !this.hoverPoint) {
      this.hideCoordinateTip();
      return;
    }

    const stageSize = this.getStageSize();
    const imageRect = getImageRect(this.viewport, stageSize, this.naturalSize);
    const insideImage =
      this.hoverPoint.x >= imageRect.left &&
      this.hoverPoint.x < imageRect.left + imageRect.width &&
      this.hoverPoint.y >= imageRect.top &&
      this.hoverPoint.y < imageRect.top + imageRect.height;

    if (!insideImage || imageRect.width <= 0 || imageRect.height <= 0) {
      this.hideCoordinateTip();
      return;
    }

    const pixelX = clamp(
      Math.floor(((this.hoverPoint.x - imageRect.left) / imageRect.width) * this.naturalSize.width),
      0,
      this.naturalSize.width - 1,
    );
    const pixelY = clamp(
      Math.floor(((this.hoverPoint.y - imageRect.top) / imageRect.height) * this.naturalSize.height),
      0,
      this.naturalSize.height - 1,
    );

    this.coordinateTip.textContent = `${pixelX},${pixelY}`;
    this.coordinateTip.classList.add('is-visible');
  }
}

class ComparisonGridView {
  constructor(container, options) {
    this.container = container;
    this.options = options;
    this.panels = [];
  }

  render() {
    this.destroy();
    clearElement(this.container);

    const { methods, image } = this.options;
    if (!methods.length) {
      const emptyState = createElement('div', 'comparison-empty');
      emptyState.innerHTML = `
        <h3>Select at least one method</h3>
        <p>Use the method buttons above to choose up to nine outputs for the current image.</p>
      `;
      this.container.appendChild(emptyState);
      return;
    }

    const layout = getGridLayout(methods.length);
    const grid = createElement('div', 'comparison-grid');
    grid.style.setProperty('--grid-columns', String(layout.columns));
    grid.style.setProperty('--grid-rows', String(layout.rows));
    this.container.appendChild(grid);

    methods.forEach((method) => {
      const imagePath = image.paths[method.id];
      const panel = new ComparisonPanel({
        method,
        imagePath,
        imageLabel: image.label,
        viewport: this.options.viewport,
        onViewportChange: this.options.onViewportChange,
      });
      panel.mount(grid);
      this.panels.push(panel);
    });
  }

  setViewport(viewport) {
    this.options.viewport = viewport;
    this.panels.forEach((panel) => panel.setViewport(viewport));
  }

  destroy() {
    this.panels.forEach((panel) => panel.destroy());
    this.panels = [];
  }
}

class CuteVisualizerApp {
  constructor(root) {
    this.root = root;
    this.gridView = null;
    this.sidebarWidth = this.loadSidebarWidth();
    this.isResizingSidebar = false;
    this.themePresetSelect = null;
    this.themeColorInput = null;
    this.state = {
      manifest: null,
      loading: true,
      error: '',
      selectedImageId: null,
      selectedMethodIds: [],
      imageSearch: '',
      viewport: { ...DEFAULT_VIEWPORT },
      themeColor: this.loadThemeColor(),
    };

    this.handleSidebarResizeStart = this.handleSidebarResizeStart.bind(this);
    this.handleSidebarResizeMove = this.handleSidebarResizeMove.bind(this);
    this.handleSidebarResizeEnd = this.handleSidebarResizeEnd.bind(this);
    this.handleSidebarResizeKeydown = this.handleSidebarResizeKeydown.bind(this);
    this.handleWindowResize = this.handleWindowResize.bind(this);

    this.renderShell();
    this.applyTheme();
    this.reloadManifest();
  }

  renderShell() {
    this.root.innerHTML = `
      <div class="app-shell">
        <section class="method-strip">
          <div class="strip-header">
            <div class="section-title-group">
              <div class="section-label">Methods</div>
              <div class="section-title">Select the methods to visualize. </div>
            </div>
            <div class="section-meta" id="methodSectionMeta"></div>
          </div>
          <div class="methods-list" id="methodsList"></div>
        </section>

        <div class="workspace">
          <aside class="image-sidebar">
            <div class="panel-bar">
              <div class="section-title-group">
                <div class="section-label">Images</div>
                <div class="section-title">Choose an image key</div>
              </div>
              <div class="section-meta" id="imageSectionMeta"></div>
            </div>
            <div class="sidebar-search-row">
              <input
                id="imageSearch"
                class="search-input"
                type="search"
                placeholder="Filter by name or relative path"
                aria-label="Search images"
              />
            </div>
            <div class="image-list" id="imageList"></div>
          </aside>

          <div
            class="sidebar-resizer"
            id="sidebarResizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize image list"
            tabindex="0"
          ></div>

          <main class="visualizer-area">
            <section class="toolbar-bar" id="toolbarCard"></section>
            <section class="comparison-area">
              <div class="comparison-mount" id="comparisonMount"></div>
            </section>
          </main>
        </div>

        <footer class="app-footer">
          <div class="footer-brand" id="footerBrand"></div>
          <div class="footer-status" id="footerStatus"></div>
          <div class="footer-controls" id="footerControls"></div>
        </footer>
      </div>
    `;

    this.methodsList = document.getElementById('methodsList');
    this.methodSectionMeta = document.getElementById('methodSectionMeta');
    this.workspace = this.root.querySelector('.workspace');
    this.imageSidebar = this.root.querySelector('.image-sidebar');
    this.sidebarResizer = document.getElementById('sidebarResizer');
    this.imageSectionMeta = document.getElementById('imageSectionMeta');
    this.imageSearchInput = document.getElementById('imageSearch');
    this.imageList = document.getElementById('imageList');
    this.toolbarCard = document.getElementById('toolbarCard');
    this.comparisonMount = document.getElementById('comparisonMount');
    this.footerBrand = document.getElementById('footerBrand');
    this.footerStatus = document.getElementById('footerStatus');
    this.footerControls = document.getElementById('footerControls');

    this.imageSearchInput.addEventListener('input', (event) => {
      this.state.imageSearch = event.target.value;
      this.updateSidebar();
      this.updateToolbar();
    });

    this.sidebarResizer.addEventListener('mousedown', this.handleSidebarResizeStart);
    this.sidebarResizer.addEventListener('keydown', this.handleSidebarResizeKeydown);
    window.addEventListener('resize', this.handleWindowResize);

    if (this.sidebarWidth !== null) {
      this.applySidebarWidth(this.sidebarWidth);
    } else {
      this.updateSidebarResizeAria(this.getCurrentSidebarWidth());
    }
  }

  async reloadManifest() {
    this.state.loading = true;
    this.state.error = '';
    this.updateAll();

    try {
      const manifest = await loadManifest();
      this.state.manifest = manifest;
      this.state.loading = false;

      if (!manifest.images.length) {
        this.state.selectedImageId = null;
        this.state.selectedMethodIds = [];
      } else {
        const currentImageExists = manifest.images.some(
          (image) => image.id === this.state.selectedImageId,
        );
        this.state.selectedImageId = currentImageExists
          ? this.state.selectedImageId
          : manifest.images[0].id;
        this.ensureValidMethodSelection(true);
      }

      this.updateAll();
    } catch (error) {
      this.state.loading = false;
      this.state.error = error instanceof Error ? error.message : 'Unknown error.';
      this.updateAll();
    }
  }

  loadThemeColor() {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      return stored ? normalizeThemeColor(stored) : DEFAULT_THEME_COLOR;
    } catch (_error) {
      return DEFAULT_THEME_COLOR;
    }
  }

  saveThemeColor(color) {
    const normalized = normalizeThemeColor(color);
    this.state.themeColor = normalized;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
    } catch (_error) {
      // Ignore storage failures in restrictive browser environments.
    }

    this.applyTheme();
    this.syncThemeControls();
  }

  syncThemeControls() {
    const activePreset = THEME_PRESETS.find(
      (preset) => normalizeThemeColor(preset.color) === this.state.themeColor,
    );

    if (this.themePresetSelect) {
      this.themePresetSelect.value = activePreset ? activePreset.id : 'custom';
    }

    if (this.themeColorInput) {
      this.themeColorInput.value = this.state.themeColor;
    }
  }

  loadSidebarWidth() {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      if (stored === null) {
        return null;
      }

      const parsed = Number.parseInt(stored, 10);
      return Number.isFinite(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  getCurrentSidebarWidth() {
    if (this.imageSidebar) {
      return Math.round(this.imageSidebar.getBoundingClientRect().width);
    }

    return DEFAULT_SIDEBAR_WIDTH;
  }

  getSidebarWidthBounds() {
    const workspaceWidth = this.workspace
      ? Math.round(this.workspace.getBoundingClientRect().width)
      : DEFAULT_SIDEBAR_WIDTH + MIN_VIEWER_WIDTH;
    const handleWidth = this.sidebarResizer
      ? Math.round(this.sidebarResizer.getBoundingClientRect().width)
      : 0;

    const maxWidth = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, workspaceWidth - handleWidth - MIN_VIEWER_WIDTH),
    );

    return {
      min: Math.min(MIN_SIDEBAR_WIDTH, maxWidth),
      max: maxWidth,
    };
  }

  updateSidebarResizeAria(width) {
    if (!this.sidebarResizer) {
      return;
    }

    const bounds = this.getSidebarWidthBounds();
    this.sidebarResizer.setAttribute('aria-valuemin', String(bounds.min));
    this.sidebarResizer.setAttribute('aria-valuemax', String(bounds.max));
    this.sidebarResizer.setAttribute('aria-valuenow', String(clamp(width, bounds.min, bounds.max)));
  }

  applySidebarWidth(width, persist = false) {
    const bounds = this.getSidebarWidthBounds();
    const normalized = clamp(Math.round(width), bounds.min, bounds.max);
    this.sidebarWidth = normalized;
    this.root.style.setProperty('--sidebar-width', `${normalized}px`);
    this.updateSidebarResizeAria(normalized);

    if (persist) {
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(normalized));
      } catch (_error) {
        // Ignore storage failures in restrictive browser environments.
      }
    }
  }

  handleSidebarResizeStart(event) {
    event.preventDefault();
    this.isResizingSidebar = true;
    this.root.classList.add('is-resizing-sidebar');
    window.addEventListener('mousemove', this.handleSidebarResizeMove);
    window.addEventListener('mouseup', this.handleSidebarResizeEnd);
  }

  handleSidebarResizeMove(event) {
    if (!this.isResizingSidebar || !this.workspace || !this.sidebarResizer) {
      return;
    }

    const workspaceBounds = this.workspace.getBoundingClientRect();
    const handleWidth = this.sidebarResizer.getBoundingClientRect().width;
    const nextWidth = event.clientX - workspaceBounds.left - handleWidth / 2;
    this.applySidebarWidth(nextWidth);
  }

  handleSidebarResizeEnd() {
    if (!this.isResizingSidebar) {
      return;
    }

    this.isResizingSidebar = false;
    this.root.classList.remove('is-resizing-sidebar');
    window.removeEventListener('mousemove', this.handleSidebarResizeMove);
    window.removeEventListener('mouseup', this.handleSidebarResizeEnd);

    if (this.sidebarWidth !== null) {
      this.applySidebarWidth(this.sidebarWidth, true);
    }
  }

  handleSidebarResizeKeydown(event) {
    const step = event.shiftKey ? SIDEBAR_KEYBOARD_STEP * 2 : SIDEBAR_KEYBOARD_STEP;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const currentWidth = this.sidebarWidth ?? this.getCurrentSidebarWidth();
    const delta = event.key === 'ArrowLeft' ? -step : step;
    this.applySidebarWidth(currentWidth + delta, true);
  }

  handleWindowResize() {
    if (this.sidebarWidth !== null) {
      this.applySidebarWidth(this.sidebarWidth);
    } else {
      this.updateSidebarResizeAria(this.getCurrentSidebarWidth());
    }
  }

  applyTheme() {
    const tokens = buildThemeTokens(this.state.themeColor);
    Object.entries(tokens).forEach(([key, value]) => {
      this.root.style.setProperty(key, value);
    });
  }

  updateAll() {
    this.applyTheme();
    this.updateFooter();
    this.updateMethodSelector();
    this.updateSidebar();
    this.updateToolbar();
    this.renderGrid();
  }

  getCurrentImage() {
    if (!this.state.manifest || !this.state.selectedImageId) {
      return null;
    }

    return (
      this.state.manifest.images.find((image) => image.id === this.state.selectedImageId) ?? null
    );
  }

  getAvailableMethodIds() {
    const image = this.getCurrentImage();
    return new Set(image ? image.availableIn : []);
  }

  getSelectedMethods() {
    if (!this.state.manifest) {
      return [];
    }

    const selectedSet = new Set(this.state.selectedMethodIds);
    return this.state.manifest.methods.filter((method) => selectedSet.has(method.id));
  }

  getFilteredImages() {
    if (!this.state.manifest) {
      return [];
    }

    const query = this.state.imageSearch.trim().toLowerCase();
    if (!query) {
      return this.state.manifest.images;
    }

    return this.state.manifest.images.filter((image) => {
      return (
        image.label.toLowerCase().includes(query) ||
        image.key.toLowerCase().includes(query) ||
        image.sortKey.toLowerCase().includes(query)
      );
    });
  }

  getImageNavigationList() {
    const filtered = this.getFilteredImages();
    if (filtered.some((image) => image.id === this.state.selectedImageId)) {
      return filtered;
    }

    return this.state.manifest ? this.state.manifest.images : [];
  }

  ensureValidMethodSelection(resetViewport) {
    const currentImage = this.getCurrentImage();
    const availableIds = currentImage ? currentImage.availableIn : [];
    const availableSet = new Set(availableIds);
    const cleaned = this.state.selectedMethodIds
      .filter((methodId) => availableSet.has(methodId))
      .slice(0, MAX_SELECTED_METHODS);

    if (!cleaned.length && availableIds.length) {
      this.state.selectedMethodIds = availableIds.slice(
        0,
        Math.min(DEFAULT_SELECTION_COUNT, MAX_SELECTED_METHODS, availableIds.length),
      );
    } else {
      this.state.selectedMethodIds = cleaned;
    }

    if (resetViewport) {
      this.state.viewport = { ...DEFAULT_VIEWPORT };
    }
  }

  setCurrentImage(imageId) {
    if (imageId === this.state.selectedImageId) {
      return;
    }

    this.state.selectedImageId = imageId;
    this.ensureValidMethodSelection(true);
    this.updateSidebar();
    this.updateMethodSelector();
    this.updateToolbar();
    this.renderGrid();
  }

  moveImage(offset) {
    const images = this.getImageNavigationList();
    const currentIndex = images.findIndex((image) => image.id === this.state.selectedImageId);
    if (currentIndex === -1) {
      return;
    }

    const nextIndex = clamp(currentIndex + offset, 0, images.length - 1);
    const nextImage = images[nextIndex];

    if (nextImage) {
      this.setCurrentImage(nextImage.id);
    }
  }

  toggleMethod(methodId) {
    const availableMethods = this.getAvailableMethodIds();
    if (!availableMethods.has(methodId)) {
      return;
    }

    const isSelected = this.state.selectedMethodIds.includes(methodId);
    if (isSelected) {
      this.state.selectedMethodIds = this.state.selectedMethodIds.filter((id) => id !== methodId);
    } else if (this.state.selectedMethodIds.length < MAX_SELECTED_METHODS) {
      this.state.selectedMethodIds = [...this.state.selectedMethodIds, methodId];
    }

    this.updateMethodSelector();
    this.updateToolbar();
    this.renderGrid();
  }

  setViewport(nextViewport) {
    this.state.viewport =
      typeof nextViewport === 'function' ? nextViewport(this.state.viewport) : nextViewport;

    if (this.gridView) {
      this.gridView.setViewport(this.state.viewport);
    }

    this.updateToolbarStats();
  }

  updateFooter() {
    clearElement(this.footerBrand);
    clearElement(this.footerStatus);
    clearElement(this.footerControls);

    const brandName = createElement('span', 'footer-name', 'Image Visualizer');
    const brandMode = createElement('span', 'footer-caption', 'static image comparison');
    this.footerBrand.append(brandName, brandMode);

    let statusText = `Manifest path: ${MANIFEST_PATH}`;
    if (this.state.error) {
      statusText = this.state.error;
    } else if (this.state.loading) {
      statusText = 'Loading manifest...';
    } else if (this.state.manifest) {
      statusText = `${this.state.manifest.methods.length} methods • ${this.state.manifest.images.length} images • Indexed ${formatTimestamp(this.state.manifest.generatedAt)}`;
    }

    this.footerStatus.textContent = statusText;

    const themeLabel = createElement('span', 'footer-label', 'Theme');
    const presetSelect = createElement('select', 'theme-select');
    presetSelect.id = 'themePresetSelect';

    THEME_PRESETS.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      presetSelect.appendChild(option);
    });

    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = 'Custom';
    presetSelect.appendChild(customOption);

    presetSelect.addEventListener('change', (event) => {
      const selectedPreset = THEME_PRESETS.find((preset) => preset.id === event.target.value);
      if (selectedPreset) {
        this.saveThemeColor(selectedPreset.color);
      } else if (this.themeColorInput) {
        this.themeColorInput.focus();
        this.themeColorInput.click();
      }
    });

    const colorPicker = createElement('input', 'theme-color-picker');
    colorPicker.id = 'themePicker';
    colorPicker.type = 'color';
    colorPicker.value = this.state.themeColor;
    colorPicker.addEventListener('input', (event) => this.saveThemeColor(event.target.value));
    colorPicker.addEventListener('change', (event) => this.saveThemeColor(event.target.value));

    const reloadButton = createElement('button', 'footer-button', 'Reload');
    reloadButton.type = 'button';
    reloadButton.addEventListener('click', () => this.reloadManifest());

    this.footerControls.append(themeLabel, presetSelect, colorPicker, reloadButton);
    this.themePresetSelect = presetSelect;
    this.themeColorInput = colorPicker;
    this.syncThemeControls();
  }

  updateMethodSelector() {
    clearElement(this.methodsList);

    const manifest = this.state.manifest;
    if (!manifest || !manifest.methods.length) {
      this.methodsList.appendChild(
        createElement(
          'div',
          'empty-inline',
          'No method folders are indexed yet. Add folders under public/data/methods and regenerate the manifest.',
        ),
      );
      this.methodSectionMeta.textContent = '0 / 0';
      return;
    }

    const availableMethods = this.getAvailableMethodIds();
    const selectedSet = new Set(this.state.selectedMethodIds);
    const selectedCount = this.state.selectedMethodIds.length;
    const availableCount = availableMethods.size;

    this.methodSectionMeta.textContent = `${selectedCount}/${MAX_SELECTED_METHODS} selected • ${availableCount} for this image`;

    manifest.methods.forEach((method) => {
      const isAvailable = availableMethods.has(method.id);
      const isSelected = selectedSet.has(method.id);
      const shouldDisable = !isAvailable || (!isSelected && selectedCount >= MAX_SELECTED_METHODS);

      const button = createElement('button', 'method-option');
      button.type = 'button';
      button.disabled = shouldDisable;
      button.setAttribute('aria-pressed', String(isSelected));
      button.title = method.label;
      button.setAttribute('aria-label', method.label);
      if (isSelected) {
        button.classList.add('is-selected');
      }
      if (!isAvailable) {
        button.classList.add('is-unavailable');
      }
      if (shouldDisable && isAvailable && !isSelected) {
        button.classList.add('is-limit-blocked');
      }

      const title = createElement('span', 'method-option-title', method.label);
      const subtitle = createElement(
        'span',
        'method-option-subtitle',
        isAvailable ? `${method.imageCount} indexed images` : 'No image for current selection',
      );

      button.append(title, subtitle);
      button.addEventListener('click', () => this.toggleMethod(method.id));
      this.methodsList.appendChild(button);
    });
  }

  updateSidebar() {
    clearElement(this.imageList);

    const filteredImages = this.getFilteredImages();
    const manifest = this.state.manifest;
    this.imageSectionMeta.textContent = manifest
      ? `${filteredImages.length}/${manifest.images.length} shown`
      : '0 shown';

    if (!manifest || !manifest.images.length) {
      this.imageList.appendChild(
        createElement(
          'div',
          'empty-inline',
          'No images found. Add method folders, run the manifest builder, then reload the page.',
        ),
      );
      return;
    }

    if (!filteredImages.length) {
      this.imageList.appendChild(
        createElement('div', 'empty-inline', 'No images matched the current search filter.'),
      );
      return;
    }

    filteredImages.forEach((image) => {
      const button = createElement('button', 'image-list-item');
      button.type = 'button';
      const fullImageLabel =
        image.label === image.key ? image.key : `${image.label}\n${image.key}`;
      button.title = fullImageLabel;
      button.setAttribute('aria-label', fullImageLabel.replace('\n', ' - '));
      if (image.id === this.state.selectedImageId) {
        button.classList.add('is-active');
      }

      const thumbnailMethodId = image.availableIn[0];
      const thumbnailPath = thumbnailMethodId ? image.paths[thumbnailMethodId] : '';
      const thumbFrame = createElement('div', 'image-item-thumb-frame');
      const thumb = createElement('img', 'image-item-thumb');
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumb.src = thumbnailPath;
      thumb.title = image.key;
      thumb.addEventListener('error', () => {
        thumbFrame.classList.add('is-empty');
        thumb.remove();
      });
      thumbFrame.appendChild(thumb);

      const copy = createElement('div', 'image-item-copy');
      const title = createElement('span', 'image-item-title', image.label);
      title.title = image.label;
      const key = createElement('span', 'image-item-key', image.key);
      key.title = image.key;
      const meta = createElement(
        'span',
        'image-item-meta',
        `${image.availableIn.length}/${manifest.methods.length} methods`,
      );
      copy.append(title, key, meta);

      button.append(thumbFrame, copy);
      button.addEventListener('click', () => this.setCurrentImage(image.id));
      this.imageList.appendChild(button);
    });
  }

  updateToolbar() {
    clearElement(this.toolbarCard);

    const currentImage = this.getCurrentImage();
    const navList = this.getImageNavigationList();
    const currentIndex = navList.findIndex((image) => image.id === this.state.selectedImageId);
    const currentImageCount = currentImage ? currentImage.availableIn.length : 0;

    const leftCluster = createElement('div', 'toolbar-main');
    const title = createElement(
      'div',
      'toolbar-title',
      currentImage ? currentImage.label : 'No image selected',
    );
    const subtitle = createElement(
      'div',
      'toolbar-subtitle',
      currentImage
        ? `${currentImage.key} • ${currentImageCount} methods available`
        : 'Add data to begin comparing images.',
    );
    leftCluster.append(title, subtitle);

    const rightCluster = createElement('div', 'toolbar-side');

    const actionCluster = createElement('div', 'toolbar-actions');
    const previousButton = createElement('button', 'secondary-button', 'Previous');
    previousButton.type = 'button';
    previousButton.disabled = currentIndex <= 0;
    previousButton.addEventListener('click', () => this.moveImage(-1));

    const nextButton = createElement('button', 'secondary-button', 'Next');
    nextButton.type = 'button';
    nextButton.disabled = currentIndex === -1 || currentIndex >= navList.length - 1;
    nextButton.addEventListener('click', () => this.moveImage(1));

    const resetButton = createElement('button', 'primary-button', 'Reset View');
    resetButton.type = 'button';
    resetButton.addEventListener('click', () => this.setViewport({ ...DEFAULT_VIEWPORT }));

    actionCluster.append(previousButton, nextButton, resetButton);

    const infoCluster = createElement('div', 'toolbar-stats');
    this.toolbarZoomStat = createElement('span', 'toolbar-stat');
    this.toolbarPanelStat = createElement('span', 'toolbar-stat');
    this.toolbarImageStat = createElement('span', 'toolbar-stat');
    infoCluster.append(this.toolbarZoomStat, this.toolbarPanelStat, this.toolbarImageStat);

    rightCluster.append(infoCluster, actionCluster);
    this.toolbarCard.append(leftCluster, rightCluster);
    this.updateToolbarStats();
  }

  updateToolbarStats() {
    if (!this.toolbarZoomStat || !this.toolbarPanelStat || !this.toolbarImageStat) {
      return;
    }

    const navList = this.getImageNavigationList();
    const currentIndex = navList.findIndex((image) => image.id === this.state.selectedImageId);

    this.toolbarZoomStat.textContent = `${Math.round(this.state.viewport.zoom * 100)}% zoom`;
    this.toolbarPanelStat.textContent = `${this.state.selectedMethodIds.length} panel${this.state.selectedMethodIds.length === 1 ? '' : 's'}`;
    this.toolbarImageStat.textContent =
      currentIndex === -1 ? 'Image 0/0' : `Image ${currentIndex + 1}/${navList.length}`;
  }

  renderGrid() {
    if (this.gridView) {
      this.gridView.destroy();
      this.gridView = null;
    }

    clearElement(this.comparisonMount);

    if (this.state.loading) {
      const loading = createElement('div', 'comparison-empty');
      loading.innerHTML = `
        <h3>Indexing your gallery...</h3>
        <p>Loading the manifest and preparing the comparison layout.</p>
      `;
      this.comparisonMount.appendChild(loading);
      return;
    }

    if (this.state.error) {
      const error = createElement('div', 'comparison-empty');
      error.innerHTML = `
        <h3>Manifest could not be loaded</h3>
        <p>${this.state.error}</p>
      `;
      this.comparisonMount.appendChild(error);
      return;
    }

    const currentImage = this.getCurrentImage();
    if (!currentImage) {
      const empty = createElement('div', 'comparison-empty');
      empty.innerHTML = `
        <h3>No indexed images yet</h3>
        <p>Place folders under <code>public/data/methods</code>, build the manifest, and reload this page.</p>
      `;
      this.comparisonMount.appendChild(empty);
      return;
    }

    const selectedMethods = this.getSelectedMethods().filter((method) =>
      currentImage.availableIn.includes(method.id),
    );

    this.gridView = new ComparisonGridView(this.comparisonMount, {
      methods: selectedMethods,
      image: currentImage,
      viewport: this.state.viewport,
      onViewportChange: (nextViewport) => this.setViewport(nextViewport),
    });
    this.gridView.render();
  }
}

const root = document.getElementById('root');
if (root) {
  new CuteVisualizerApp(root);
}
