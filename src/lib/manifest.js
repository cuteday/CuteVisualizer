const DEFAULT_MANIFEST_PATH = './public/data/manifest.json';
const PUBLIC_ROOT_PATH = './public/';
const DATASET_CONFIG_PATH = './public/datasets.json';
const DEFAULT_DATASET_NAME = 'data';
const URL_PARAM_MANIFEST = 'manifest';
const URL_PARAM_DATASET = 'dataset';

function isSafePublicManifestPath(path) {
  return (
    typeof path === 'string' &&
    path.startsWith('./public/') &&
    path.endsWith('.json') &&
    !path.includes('..')
  );
}

function isSafeDatasetName(dataset) {
  return typeof dataset === 'string' && /^[A-Za-z0-9._-]+$/.test(dataset);
}

export function getManifestPath() {
  const url = new URL(window.location.href);
  const manifestOverride = url.searchParams.get(URL_PARAM_MANIFEST);
  if (manifestOverride) {
    if (isSafePublicManifestPath(manifestOverride)) {
      return manifestOverride;
    }
    console.warn(
      `Ignoring invalid manifest override "${manifestOverride}". Falling back to dataset/default manifest.`,
    );
  }

  const dataset = url.searchParams.get(URL_PARAM_DATASET);
  if (dataset) {
    if (isSafeDatasetName(dataset)) {
      return `./public/${dataset}/manifest.json`;
    }
    console.warn(
      `Ignoring invalid dataset alias "${dataset}". Falling back to default manifest.`,
    );
  }

  return DEFAULT_MANIFEST_PATH;
}

export async function loadManifest() {
  const manifestPath = getManifestPath();
  const response = await fetch(manifestPath, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to load manifest from ${manifestPath}.`);
  }

  return response.json();
}

export function getDefaultDatasetName() {
  return DEFAULT_DATASET_NAME;
}

export function getCurrentDatasetName() {
  const manifestPath = getManifestPath();
  const match = manifestPath.match(/^\.\/public\/([^/]+)\/manifest\.json$/);
  return match ? match[1] : DEFAULT_DATASET_NAME;
}

function normalizeDatasetEntry(entry) {
  if (typeof entry === 'string') {
    const name = entry.trim();
    return isSafeDatasetName(name) ? { name, label: name } : null;
  }

  if (entry && typeof entry === 'object') {
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!isSafeDatasetName(name)) {
      return null;
    }
    const label =
      typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : name;
    return { name, label };
  }

  return null;
}

export async function loadDatasetConfig() {
  try {
    const response = await fetch(DATASET_CONFIG_PATH, { cache: 'no-store' });
    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const rawList = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.datasets)
        ? payload.datasets
        : [];

    return rawList.map(normalizeDatasetEntry).filter(Boolean);
  } catch (_error) {
    return [];
  }
}

export function parseAutoindexFolders(html) {
  if (typeof html !== 'string' || !html) {
    return [];
  }

  const folders = [];
  const seen = new Set();
  const anchorPattern = /href\s*=\s*["']([^"']+)["']/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1];
    if (!href || !href.endsWith('/') || href.startsWith('..') || href.startsWith('/') || href.includes('://')) {
      continue;
    }

    const name = decodeURIComponent(href.slice(0, -1));
    if (!isSafeDatasetName(name) || seen.has(name)) {
      continue;
    }

    seen.add(name);
    folders.push(name);
  }

  return folders;
}

async function fetchAutoindexFolders() {
  try {
    const response = await fetch(PUBLIC_ROOT_PATH, { cache: 'no-store' });
    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    return parseAutoindexFolders(html);
  } catch (_error) {
    return [];
  }
}

async function hasManifest(datasetName) {
  try {
    const response = await fetch(`./public/${datasetName}/manifest.json`, { cache: 'no-store' });
    return response.ok;
  } catch (_error) {
    return false;
  }
}

export async function listDatasets() {
  const config = await loadDatasetConfig();
  const datasets = [];
  const seen = new Set();

  config.forEach((dataset) => {
    if (!seen.has(dataset.name)) {
      seen.add(dataset.name);
      datasets.push(dataset);
    }
  });

  const autoindexFolders = await fetchAutoindexFolders();
  const candidates = autoindexFolders.filter((name) => !seen.has(name));
  const validations = await Promise.all(candidates.map((name) => hasManifest(name)));
  candidates.forEach((name, index) => {
    if (validations[index]) {
      seen.add(name);
      datasets.push({ name, label: name });
    }
  });

  const currentDataset = getCurrentDatasetName();
  if (!seen.has(currentDataset)) {
    seen.add(currentDataset);
    datasets.push({ name: currentDataset, label: currentDataset });
  }

  return datasets;
}

export { DEFAULT_MANIFEST_PATH };
