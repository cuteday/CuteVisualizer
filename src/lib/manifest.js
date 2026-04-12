const MANIFEST_PATH = './public/data/manifest.json';

export async function loadManifest() {
  const response = await fetch(MANIFEST_PATH, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to load manifest from ${MANIFEST_PATH}.`);
  }

  return response.json();
}

export { MANIFEST_PATH };
