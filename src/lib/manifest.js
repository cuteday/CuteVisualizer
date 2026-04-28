const DEFAULT_MANIFEST_PATH = './public/data/manifest.json';
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
export { DEFAULT_MANIFEST_PATH };
