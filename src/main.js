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
const COMPARISON_MODES = {
  GRIDS: 'grids',
  SWITCH: 'switch',
};

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

function getImageMethodIds(image) {
  if (!image || typeof image !== 'object') {
    return [];
  }

  if (image.methods && typeof image.methods === 'object') {
    return Object.keys(image.methods);
  }

  if (Array.isArray(image.availableIn)) {
    return image.availableIn;
  }

  if (image.paths && typeof image.paths === 'object') {
    return Object.keys(image.paths);
  }

  return [];
}

function getImageMethodRecord(image, methodId) {
  if (!image || typeof image !== 'object' || !methodId) {
    return null;
  }

  if (image.methods && typeof image.methods === 'object') {
    const methodRecord = image.methods[methodId];
    if (methodRecord && typeof methodRecord === 'object') {
      return {
        path: typeof methodRecord.path === 'string' ? methodRecord.path : '',
        metadata:
          methodRecord.metadata && typeof methodRecord.metadata === 'object'
            ? methodRecord.metadata
            : {},
      };
    }
  }

  if (image.paths && typeof image.paths[methodId] === 'string') {
    const legacyMetadata =
      image.metadata &&
      typeof image.metadata === 'object' &&
      image.metadata[methodId] &&
      typeof image.metadata[methodId] === 'object'
        ? image.metadata[methodId]
        : {};

    return {
      path: image.paths[methodId],
      metadata: legacyMetadata,
    };
  }

  return null;
}

class ComparisonPanel {
  constructor({
    method,
    imageId,
    imagePath,
    imageLabel,
    viewport,
    onViewportChange,
    onInfoRequest = null,
    showSwitchHint = false,
  }) {
    this.method = method;
    this.imageId = imageId;
    this.imagePath = imagePath;
    this.imageLabel = imageLabel;
    this.viewport = viewport;
    this.onViewportChange = onViewportChange;
    this.onInfoRequest = onInfoRequest;
    this.naturalSize = null;
    this.isDragging = false;
    this.lastPointer = { x: 0, y: 0 };
    this.hoverPoint = null;
    this.image = null;
    this.imageLoadToken = 0;

    this.handleWheel = this.handleWheel.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleStageMouseMove = this.handleStageMouseMove.bind(this);
    this.handleStageMouseLeave = this.handleStageMouseLeave.bind(this);
    this.handleMethodTagClick = this.handleMethodTagClick.bind(this);
    this.handleResize = this.handleResize.bind(this);

    this.element = createElement('article', 'comparison-panel');
    this.header = createElement('div', 'panel-header');
    this.methodTag = createElement('button', 'method-tag method-tag-button', method.label);
    this.methodTag.type = 'button';
    this.methodTag.title = `Show info for ${method.label}`;
    this.metaCluster = createElement('div', 'panel-meta-cluster');
    this.metaTag = createElement('span', 'panel-meta-tag', 'Loading...');
    this.switchHintTag = createElement('span', 'panel-shortcut-tag', 'Switch: SPACE');
    this.switchHintTag.title = 'Press Space to cycle to the next selected model';
    if (!showSwitchHint) {
      this.switchHintTag.classList.add('is-hidden');
    }
    this.metaCluster.append(this.metaTag, this.switchHintTag);
    this.header.append(this.methodTag, this.metaCluster);

    this.stage = createElement('div', 'panel-stage');
    this.canvas = createElement('canvas', 'panel-canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `${method.label}: ${imageLabel}`);
    this.canvasContext = this.canvas.getContext('2d');

    this.overlay = createElement('div', 'panel-overlay');
    this.overlay.textContent = 'Scroll to zoom. Drag with left mouse button to pan.';
    this.coordinateTip = createElement('div', 'panel-coordinate-tip');

    this.stage.append(this.canvas, this.overlay, this.coordinateTip);
    this.element.append(this.header, this.stage);

    this.methodTag.addEventListener('click', this.handleMethodTagClick);
    this.stage.addEventListener('wheel', this.handleWheel, { passive: false });
    this.stage.addEventListener('mousedown', this.handleMouseDown);
    this.stage.addEventListener('mousemove', this.handleStageMouseMove);
    this.stage.addEventListener('mouseleave', this.handleStageMouseLeave);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.stage);
    } else {
      window.addEventListener('resize', this.handleResize);
    }

    this.updateSource({ method, imageId, imagePath, imageLabel, onInfoRequest, showSwitchHint });
  }

  mount(parent) {
    parent.appendChild(this.element);
  }

  destroy() {
    this.methodTag.removeEventListener('click', this.handleMethodTagClick);
    this.stage.removeEventListener('wheel', this.handleWheel);
    this.stage.removeEventListener('mousedown', this.handleMouseDown);
    this.stage.removeEventListener('mousemove', this.handleStageMouseMove);
    this.stage.removeEventListener('mouseleave', this.handleStageMouseLeave);
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

  handleMethodTagClick() {
    if (typeof this.onInfoRequest === 'function') {
      this.onInfoRequest(this.imageId, this.method.id);
    }
  }

  applyLoadedImage(image, imagePath, imageLabel) {
    this.image = image;
    this.imagePath = imagePath;
    this.imageLabel = imageLabel;
    this.naturalSize = {
      width: image.naturalWidth,
      height: image.naturalHeight,
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

  loadImageSource(imagePath, imageLabel) {
    const loadToken = ++this.imageLoadToken;
    const nextImage = new Image();
    nextImage.draggable = false;
    nextImage.decoding = 'async';
    nextImage.addEventListener('load', () => {
      if (loadToken !== this.imageLoadToken) {
        return;
      }
      this.applyLoadedImage(nextImage, imagePath, imageLabel);
    });
    nextImage.addEventListener('error', () => {
      if (loadToken !== this.imageLoadToken) {
        return;
      }
      this.handleImageError();
    });
    nextImage.src = imagePath;
  }

  updateSource({
    method,
    imageId,
    imagePath,
    imageLabel,
    onInfoRequest = null,
    showSwitchHint = false,
  }) {
    const sourceChanged = imagePath !== this.imagePath;

    this.method = method;
    this.imageId = imageId;
    this.imageLabel = imageLabel;
    this.onInfoRequest = onInfoRequest;
    this.methodTag.textContent = method.label;
    this.methodTag.title = `Show info for ${method.label}`;
    this.canvas.setAttribute('aria-label', `${method.label}: ${imageLabel}`);
    this.switchHintTag.classList.toggle('is-hidden', !showSwitchHint);
    this.element.classList.remove('is-error');

    if (!sourceChanged && this.image) {
      this.refreshLayout();
      return;
    }

    this.metaTag.textContent = 'Loading...';
    this.hoverPoint = null;
    this.hideCoordinateTip();
    this.loadImageSource(imagePath, imageLabel);
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
    if (!this.image) {
      return;
    }

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
    this.gridElement = null;
  }

  render() {
    this.destroy();
    clearElement(this.container);

    const { methods, image, showSwitchHint = false } = this.options;
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
    this.gridElement = grid;
    grid.style.setProperty('--grid-columns', String(layout.columns));
    grid.style.setProperty('--grid-rows', String(layout.rows));
    this.container.appendChild(grid);

    methods.forEach((method) => {
      const methodRecord = getImageMethodRecord(image, method.id);
      if (!methodRecord || !methodRecord.path) {
        return;
      }

      const panel = new ComparisonPanel({
        method,
        imageId: image.id,
        imagePath: methodRecord.path,
        imageLabel: image.label,
        viewport: this.options.viewport,
        onViewportChange: this.options.onViewportChange,
        onInfoRequest: this.options.onInfoRequest,
        showSwitchHint,
      });
      panel.mount(grid);
      this.panels.push(panel);
    });
  }

  setViewport(viewport) {
    this.options.viewport = viewport;
    this.panels.forEach((panel) => panel.setViewport(viewport));
  }

  canReuseSinglePanel(options) {
    return Boolean(this.gridElement) && this.panels.length === 1 && options.methods.length === 1;
  }

  updateSinglePanel(options) {
    this.options = options;
    if (!this.canReuseSinglePanel(options)) {
      this.render();
      return;
    }

    const [method] = options.methods;
    const panel = this.panels[0];
    const methodRecord = getImageMethodRecord(options.image, method.id);
    if (!methodRecord || !methodRecord.path) {
      this.render();
      return;
    }

    panel.updateSource({
      method,
      imageId: options.image.id,
      imagePath: methodRecord.path,
      imageLabel: options.image.label,
      onInfoRequest: options.onInfoRequest,
      showSwitchHint: options.showSwitchHint,
    });
    panel.setViewport(options.viewport);
  }

  destroy() {
    this.panels.forEach((panel) => panel.destroy());
    this.panels = [];
    this.gridElement = null;
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
    this.sidebarItems = new Map();
    this.sidebarOrderKey = '';
    this.sidebarScrollTop = 0;
    this.state = {
      manifest: null,
      loading: true,
      error: '',
      selectedImageId: null,
      selectedMethodIds: [],
      comparisonMode: COMPARISON_MODES.GRIDS,
      activeSwitchIndex: 0,
      infoDrawerOpen: false,
      infoDrawerImageId: null,
      infoDrawerMethodId: null,
      imageSearch: '',
      viewport: { ...DEFAULT_VIEWPORT },
      themeColor: this.loadThemeColor(),
    };

    this.handleSidebarResizeStart = this.handleSidebarResizeStart.bind(this);
    this.handleSidebarResizeMove = this.handleSidebarResizeMove.bind(this);
    this.handleSidebarResizeEnd = this.handleSidebarResizeEnd.bind(this);
    this.handleSidebarResizeKeydown = this.handleSidebarResizeKeydown.bind(this);
    this.handleWindowResize = this.handleWindowResize.bind(this);
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this);

    this.renderShell();
    this.applyTheme();
    document.addEventListener('keydown', this.handleGlobalKeydown);
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
            <div class="strip-header-side">
              <div class="section-meta" id="methodSectionMeta"></div>
              <div class="mode-toggle-mount" id="modeToggleMount"></div>
            </div>
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
              <div class="info-drawer-backdrop" id="infoDrawerBackdrop"></div>
              <aside class="info-drawer" id="infoDrawer" aria-hidden="true"></aside>
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
    this.modeToggleMount = document.getElementById('modeToggleMount');
    this.workspace = this.root.querySelector('.workspace');
    this.imageSidebar = this.root.querySelector('.image-sidebar');
    this.sidebarResizer = document.getElementById('sidebarResizer');
    this.imageSectionMeta = document.getElementById('imageSectionMeta');
    this.imageSearchInput = document.getElementById('imageSearch');
    this.imageList = document.getElementById('imageList');
    this.toolbarCard = document.getElementById('toolbarCard');
    this.comparisonMount = document.getElementById('comparisonMount');
    this.infoDrawer = document.getElementById('infoDrawer');
    this.infoDrawerBackdrop = document.getElementById('infoDrawerBackdrop');
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
    this.infoDrawerBackdrop.addEventListener('click', () => this.closeInfoDrawer());
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
    this.updateModeToggle();
    this.updateMethodSelector();
    this.updateSidebar();
    this.updateToolbar();
    this.renderGrid();
    this.renderInfoDrawer();
  }

  getCurrentImage() {
    if (!this.state.manifest || !this.state.selectedImageId) {
      return null;
    }

    return (
      this.state.manifest.images.find((image) => image.id === this.state.selectedImageId) ?? null
    );
  }

  getMethodById(methodId) {
    if (!this.state.manifest) {
      return null;
    }

    return this.state.manifest.methods.find((method) => method.id === methodId) ?? null;
  }

  getAvailableMethodIds() {
    const image = this.getCurrentImage();
    return new Set(getImageMethodIds(image));
  }

  getSelectedMethods() {
    if (!this.state.manifest) {
      return [];
    }

    const selectedSet = new Set(this.state.selectedMethodIds);
    return this.state.manifest.methods.filter((method) => selectedSet.has(method.id));
  }

  getAvailableSelectedMethods() {
    const currentImage = this.getCurrentImage();
    if (!this.state.manifest || !currentImage) {
      return [];
    }

    const selectedSet = new Set(this.state.selectedMethodIds);
    return this.state.manifest.methods.filter(
      (method) => selectedSet.has(method.id) && getImageMethodIds(currentImage).includes(method.id),
    );
  }

  getInfoDrawerMethodIds(image = this.getCurrentImage()) {
    if (!image) {
      return [];
    }

    const selectedAvailable = this.getAvailableSelectedMethods().map((method) => method.id);
    return selectedAvailable.length ? selectedAvailable : getImageMethodIds(image);
  }

  normalizeInfoDrawerState() {
    if (!this.state.infoDrawerOpen) {
      return;
    }

    const currentImage = this.getCurrentImage();
    if (!currentImage || currentImage.id !== this.state.infoDrawerImageId) {
      this.closeInfoDrawer();
      return;
    }

    const methodIds = this.getInfoDrawerMethodIds(currentImage);
    if (!methodIds.length || !methodIds.includes(this.state.infoDrawerMethodId)) {
      this.closeInfoDrawer();
    }
  }

  normalizeSwitchState({ resetIndex = false } = {}) {
    const availableMethods = this.getAvailableSelectedMethods();
    if (!availableMethods.length) {
      this.state.activeSwitchIndex = 0;
      return;
    }

    if (resetIndex) {
      this.state.activeSwitchIndex = 0;
      return;
    }

    this.state.activeSwitchIndex = clamp(
      this.state.activeSwitchIndex,
      0,
      availableMethods.length - 1,
    );
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

  getSidebarOrderKey(images) {
    return images.map((image) => image.id).join('|');
  }

  updateSidebarActiveState(previousImageId = null) {
    if (previousImageId && this.sidebarItems.has(previousImageId)) {
      this.sidebarItems.get(previousImageId).classList.remove('is-active');
    }

    if (this.state.selectedImageId && this.sidebarItems.has(this.state.selectedImageId)) {
      this.sidebarItems.get(this.state.selectedImageId).classList.add('is-active');
    }
  }

  buildSidebarItem(image, manifest) {
    const button = createElement('button', 'image-list-item');
    button.type = 'button';
    const fullImageLabel =
      image.label === image.key ? image.key : `${image.label}\n${image.key}`;
    button.title = fullImageLabel;
    button.setAttribute('aria-label', fullImageLabel.replace('\n', ' - '));
    if (image.id === this.state.selectedImageId) {
      button.classList.add('is-active');
    }

    const thumbnailMethodId = getImageMethodIds(image)[0];
    const thumbnailPath = thumbnailMethodId
      ? getImageMethodRecord(image, thumbnailMethodId)?.path ?? ''
      : '';
    const thumbFrame = createElement('div', 'image-item-thumb-frame');
    const thumb = createElement('img', 'image-item-thumb');
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    thumb.fetchPriority = 'low';
    thumb.draggable = false;
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
      `${getImageMethodIds(image).length}/${manifest.methods.length} methods`,
    );
    copy.append(title, key, meta);

    button.append(thumbFrame, copy);
    button.addEventListener('click', () => this.setCurrentImage(image.id));
    this.sidebarItems.set(image.id, button);
    return button;
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
    const availableIds = currentImage ? getImageMethodIds(currentImage) : [];
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

    this.normalizeSwitchState({ resetIndex: resetViewport });
    this.normalizeInfoDrawerState();
  }

  setCurrentImage(imageId) {
    if (imageId === this.state.selectedImageId) {
      return;
    }

    const previousImageId = this.state.selectedImageId;
    this.state.selectedImageId = imageId;
    this.ensureValidMethodSelection(true);
    this.closeInfoDrawer();
    this.updateSidebar({ previousImageId });
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

    this.normalizeSwitchState({ resetIndex: this.state.comparisonMode === COMPARISON_MODES.SWITCH });
    this.normalizeInfoDrawerState();
    this.updateMethodSelector();
    this.updateToolbar();
    this.renderGrid();
  }

  setComparisonMode(mode) {
    if (!Object.values(COMPARISON_MODES).includes(mode) || this.state.comparisonMode === mode) {
      return;
    }

    this.state.comparisonMode = mode;
    this.normalizeSwitchState();
    this.updateModeToggle();
    this.updateToolbar();
    this.renderGrid();
  }

  updateModeToggle() {
    if (!this.modeToggleMount) {
      return;
    }

    clearElement(this.modeToggleMount);

    const modeCluster = createElement('div', 'toolbar-mode-toggle');
    [
      { id: COMPARISON_MODES.GRIDS, label: 'Grids' },
      { id: COMPARISON_MODES.SWITCH, label: 'Switch' },
    ].forEach((mode) => {
      const modeButton = createElement('button', 'toolbar-mode-button', mode.label);
      modeButton.type = 'button';
      modeButton.setAttribute('aria-pressed', String(this.state.comparisonMode === mode.id));
      modeButton.title =
        mode.id === COMPARISON_MODES.GRIDS
          ? 'Show all selected methods in a comparison grid'
          : 'Show one selected method at a time and cycle with Space';
      if (this.state.comparisonMode === mode.id) {
        modeButton.classList.add('is-active');
      }
      modeButton.addEventListener('click', () => this.setComparisonMode(mode.id));
      modeCluster.appendChild(modeButton);
    });

    this.modeToggleMount.appendChild(modeCluster);
  }

  cycleSwitchMethod(step = 1) {
    const availableMethods = this.getAvailableSelectedMethods();
    if (
      this.state.comparisonMode !== COMPARISON_MODES.SWITCH ||
      availableMethods.length < 2
    ) {
      return;
    }

    const count = availableMethods.length;
    this.state.activeSwitchIndex = (this.state.activeSwitchIndex + step + count) % count;
    if (this.state.infoDrawerOpen) {
      this.state.infoDrawerMethodId = availableMethods[this.state.activeSwitchIndex].id;
      this.renderInfoDrawer();
    }
    this.updateToolbarStats();
    this.renderGrid();
  }

  openInfoDrawer(imageId, methodId) {
    const currentImage = this.getCurrentImage();
    if (!currentImage || currentImage.id !== imageId) {
      return;
    }

    if (!getImageMethodRecord(currentImage, methodId)) {
      return;
    }

    this.state.infoDrawerOpen = true;
    this.state.infoDrawerImageId = imageId;
    this.state.infoDrawerMethodId = methodId;
    this.renderInfoDrawer();
  }

  closeInfoDrawer() {
    this.state.infoDrawerOpen = false;
    this.state.infoDrawerImageId = null;
    this.state.infoDrawerMethodId = null;
    this.renderInfoDrawer();
  }

  cycleInfoDrawerMethod(step = 1) {
    if (!this.state.infoDrawerOpen) {
      return;
    }

    const currentImage = this.getCurrentImage();
    const methodIds = this.getInfoDrawerMethodIds(currentImage);
    const currentIndex = methodIds.indexOf(this.state.infoDrawerMethodId);
    if (currentIndex === -1 || methodIds.length < 2) {
      return;
    }

    const nextIndex = (currentIndex + step + methodIds.length) % methodIds.length;
    const nextMethodId = methodIds[nextIndex];

    if (this.state.comparisonMode === COMPARISON_MODES.SWITCH) {
      this.state.activeSwitchIndex = nextIndex;
      this.state.infoDrawerMethodId = nextMethodId;
      this.updateToolbarStats();
      this.renderGrid();
      this.renderInfoDrawer();
    } else {
      this.state.infoDrawerMethodId = nextMethodId;
      this.renderInfoDrawer();
    }
  }

  handleGlobalKeydown(event) {
    if (event.code === 'Escape' && this.state.infoDrawerOpen) {
      event.preventDefault();
      this.closeInfoDrawer();
      return;
    }

    if (
      event.defaultPrevented ||
      event.code !== 'Space' ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      this.state.comparisonMode !== COMPARISON_MODES.SWITCH
    ) {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      if (
        activeElement === this.sidebarResizer ||
        activeElement.isContentEditable ||
        activeElement.matches('input, textarea, select, button, option')
      ) {
        return;
      }
    }

    if (this.getAvailableSelectedMethods().length < 2) {
      return;
    }

    event.preventDefault();
    this.cycleSwitchMethod(1);
  }

  renderInfoValue(key, value) {
    const row = createElement('div', 'info-drawer-row');
    const keyLabel = createElement('div', 'info-drawer-key', key);
    row.appendChild(keyLabel);

    if (value !== null && typeof value === 'object') {
      const pre = createElement('pre', 'info-drawer-json');
      pre.textContent = JSON.stringify(value, null, 2);
      row.appendChild(pre);
      return row;
    }

    const valueLabel = createElement('div', 'info-drawer-value', String(value));
    valueLabel.title = String(value);
    row.appendChild(valueLabel);
    return row;
  }

  renderInfoDrawer() {
    if (!this.infoDrawer || !this.infoDrawerBackdrop) {
      return;
    }

    clearElement(this.infoDrawer);

    const isOpen = this.state.infoDrawerOpen;
    this.infoDrawer.classList.toggle('is-open', isOpen);
    this.infoDrawerBackdrop.classList.toggle('is-open', isOpen);
    this.infoDrawer.setAttribute('aria-hidden', String(!isOpen));

    if (!isOpen) {
      return;
    }

    const currentImage = this.getCurrentImage();
    const method = this.getMethodById(this.state.infoDrawerMethodId);
    const methodRecord =
      currentImage && method ? getImageMethodRecord(currentImage, method.id) : null;

    if (!currentImage || !method || !methodRecord) {
      this.closeInfoDrawer();
      return;
    }

    const drawerHeader = createElement('div', 'info-drawer-header');
    const drawerTitle = createElement('div', 'info-drawer-title', 'Info');
    const actions = createElement('div', 'info-drawer-actions');
    const methodIds = this.getInfoDrawerMethodIds(currentImage);
    if (methodIds.length > 1) {
      const nextButton = createElement('button', 'info-drawer-button', 'Next method');
      nextButton.type = 'button';
      nextButton.addEventListener('click', () => this.cycleInfoDrawerMethod(1));
      actions.appendChild(nextButton);
    }
    const closeButton = createElement('button', 'info-drawer-button', 'Close');
    closeButton.type = 'button';
    closeButton.addEventListener('click', () => this.closeInfoDrawer());
    actions.appendChild(closeButton);

    drawerHeader.append(drawerTitle, actions);

    const drawerIdentity = createElement('div', 'info-drawer-identity');
    const drawerMethod = createElement('div', 'info-drawer-method', method.label);
    drawerMethod.title = method.label;
    const drawerImage = createElement('div', 'info-drawer-image', currentImage.label);
    drawerImage.title = currentImage.label;
    drawerIdentity.append(drawerMethod, drawerImage);

    const drawerBody = createElement('div', 'info-drawer-body');
    const recordList = createElement('div', 'info-drawer-list');
    recordList.appendChild(this.renderInfoValue('path', methodRecord.path));

    const metadata =
      methodRecord.metadata && typeof methodRecord.metadata === 'object'
        ? methodRecord.metadata
        : {};
    const metadataKeys = Object.keys(metadata);
    if (!metadataKeys.length) {
      recordList.appendChild(
        createElement(
          'div',
          'info-drawer-empty',
          'No custom metadata for this method-image pair.',
        ),
      );
    } else {
      metadataKeys.forEach((key) => {
        recordList.appendChild(this.renderInfoValue(key, metadata[key]));
      });
    }

    drawerBody.appendChild(recordList);
    this.infoDrawer.append(drawerHeader, drawerIdentity, drawerBody);
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

  updateSidebar({ previousImageId = null } = {}) {
    const filteredImages = this.getFilteredImages();
    const manifest = this.state.manifest;
    this.imageSectionMeta.textContent = manifest
      ? `${filteredImages.length}/${manifest.images.length} shown`
      : '0 shown';

    if (!manifest || !manifest.images.length) {
      clearElement(this.imageList);
      this.sidebarItems.clear();
      this.sidebarOrderKey = '';
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
      clearElement(this.imageList);
      this.sidebarItems.clear();
      this.sidebarOrderKey = '';
      this.imageList.appendChild(
        createElement('div', 'empty-inline', 'No images matched the current search filter.'),
      );
      return;
    }

    const nextOrderKey = this.getSidebarOrderKey(filteredImages);
    const canPatchSelectionOnly =
      this.sidebarItems.size > 0 &&
      this.sidebarOrderKey === nextOrderKey &&
      this.imageList.children.length === filteredImages.length;

    if (canPatchSelectionOnly) {
      this.updateSidebarActiveState(previousImageId);
      return;
    }

    const previousScrollTop = this.imageList.scrollTop;
    clearElement(this.imageList);
    this.sidebarItems.clear();

    filteredImages.forEach((image) => {
      this.imageList.appendChild(this.buildSidebarItem(image, manifest));
    });

    this.sidebarOrderKey = nextOrderKey;
    this.imageList.scrollTop = previousScrollTop;
    this.updateSidebarActiveState(previousImageId);
  }

  updateToolbar() {
    clearElement(this.toolbarCard);

    const currentImage = this.getCurrentImage();
    const navList = this.getImageNavigationList();
    const currentIndex = navList.findIndex((image) => image.id === this.state.selectedImageId);
    const currentImageCount = currentImage ? getImageMethodIds(currentImage).length : 0;

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
    const availableSelectedMethods = this.getAvailableSelectedMethods();

    this.toolbarZoomStat.textContent = `${Math.round(this.state.viewport.zoom * 100)}% zoom`;
    this.toolbarPanelStat.textContent =
      this.state.comparisonMode === COMPARISON_MODES.SWITCH
        ? `Model ${availableSelectedMethods.length ? this.state.activeSwitchIndex + 1 : 0}/${availableSelectedMethods.length}`
        : `${availableSelectedMethods.length} panel${availableSelectedMethods.length === 1 ? '' : 's'}`;
    this.toolbarImageStat.textContent =
      currentIndex === -1 ? 'Image 0/0' : `Image ${currentIndex + 1}/${navList.length}`;
  }

  renderGrid() {
    if (this.state.loading) {
      if (this.gridView) {
        this.gridView.destroy();
        this.gridView = null;
      }
      clearElement(this.comparisonMount);
      const loading = createElement('div', 'comparison-empty');
      loading.innerHTML = `
        <h3>Indexing your gallery...</h3>
        <p>Loading the manifest and preparing the comparison layout.</p>
      `;
      this.comparisonMount.appendChild(loading);
      return;
    }

    if (this.state.error) {
      if (this.gridView) {
        this.gridView.destroy();
        this.gridView = null;
      }
      clearElement(this.comparisonMount);
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
      if (this.gridView) {
        this.gridView.destroy();
        this.gridView = null;
      }
      clearElement(this.comparisonMount);
      const empty = createElement('div', 'comparison-empty');
      empty.innerHTML = `
        <h3>No indexed images yet</h3>
        <p>Place folders under <code>public/data/methods</code>, build the manifest, and reload this page.</p>
      `;
      this.comparisonMount.appendChild(empty);
      return;
    }

    const selectedMethods = this.getAvailableSelectedMethods();
    const isSwitchMode = this.state.comparisonMode === COMPARISON_MODES.SWITCH;
    const renderedMethods =
      isSwitchMode && selectedMethods.length
        ? [selectedMethods[clamp(this.state.activeSwitchIndex, 0, selectedMethods.length - 1)]]
        : selectedMethods;

    const nextOptions = {
      methods: renderedMethods,
      image: currentImage,
      viewport: this.state.viewport,
      onViewportChange: (nextViewport) => this.setViewport(nextViewport),
      onInfoRequest: (imageId, methodId) => this.openInfoDrawer(imageId, methodId),
      showSwitchHint: isSwitchMode && selectedMethods.length > 1,
    };

    if (isSwitchMode && this.gridView && this.gridView.canReuseSinglePanel(nextOptions)) {
      this.gridView.updateSinglePanel(nextOptions);
      return;
    }

    if (this.gridView) {
      this.gridView.destroy();
      this.gridView = null;
    }

    clearElement(this.comparisonMount);

    this.gridView = new ComparisonGridView(this.comparisonMount, nextOptions);
    this.gridView.render();
  }
}

const root = document.getElementById('root');
if (root) {
  new CuteVisualizerApp(root);
}
