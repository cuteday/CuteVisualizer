const DB_NAME = 'cutevisualizer-runtime-thumbnails';
const STORE_NAME = 'thumbs';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type, quality });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to encode thumbnail blob.'));
      }
    }, type, quality);
  });
}

function loadHtmlImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image blob.'));
    };
    image.src = url;
  });
}

function createCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(size, size);
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

export class RuntimeThumbnailCache {
  constructor({ targetSize = 96, maxConcurrency = 3 } = {}) {
    this.targetSize = targetSize;
    this.maxConcurrency = maxConcurrency;
    this.memoryUrls = new Map();
    this.pending = new Map();
    this.queue = [];
    this.activeCount = 0;
    this.dbPromise = null;
  }

  async getThumbnailUrl(cacheKey, sourceUrl) {
    if (!cacheKey || !sourceUrl) {
      throw new Error('Thumbnail cache requires both cacheKey and sourceUrl.');
    }

    if (this.memoryUrls.has(cacheKey)) {
      return this.memoryUrls.get(cacheKey);
    }

    if (this.pending.has(cacheKey)) {
      return this.pending.get(cacheKey);
    }

    const promise = this.enqueue(async () => {
      const existingBlob = await this.getBlob(cacheKey);
      if (existingBlob) {
        return this.memoizeObjectUrl(cacheKey, existingBlob);
      }

      const generatedBlob = await this.generateThumbnailBlob(sourceUrl);
      await this.putBlob(cacheKey, generatedBlob);
      return this.memoizeObjectUrl(cacheKey, generatedBlob);
    });

    this.pending.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      this.pending.delete(cacheKey);
    }
  }

  memoizeObjectUrl(cacheKey, blob) {
    const objectUrl = URL.createObjectURL(blob);
    this.memoryUrls.set(cacheKey, objectUrl);
    return objectUrl;
  }

  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.pumpQueue();
    });
  }

  pumpQueue() {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      this.activeCount += 1;

      next.task()
        .then((result) => next.resolve(result))
        .catch((error) => next.reject(error))
        .finally(() => {
          this.activeCount -= 1;
          this.pumpQueue();
        });
    }
  }

  async openDb() {
    if (!('indexedDB' in window)) {
      return null;
    }

    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }).catch(() => null);
    }

    return this.dbPromise;
  }

  async getBlob(cacheKey) {
    const db = await this.openDb();
    if (!db) {
      return null;
    }

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    return requestToPromise(store.get(cacheKey));
  }

  async putBlob(cacheKey, blob) {
    const db = await this.openDb();
    if (!db) {
      return;
    }

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(blob, cacheKey);
    await transactionDone(transaction);
  }

  async generateThumbnailBlob(sourceUrl) {
    const response = await fetch(sourceUrl, { cache: 'force-cache' });
    if (!response.ok) {
      throw new Error(`Failed to fetch image for thumbnail: ${sourceUrl}`);
    }

    const sourceBlob = await response.blob();
    let drawable = null;
    let bitmap = null;

    try {
      if (typeof createImageBitmap === 'function') {
        bitmap = await createImageBitmap(sourceBlob);
        drawable = bitmap;
      } else {
        drawable = await loadHtmlImageFromBlob(sourceBlob);
      }

      const width = drawable.width || drawable.naturalWidth;
      const height = drawable.height || drawable.naturalHeight;
      const cropSize = Math.min(width, height);
      const sx = (width - cropSize) / 2;
      const sy = (height - cropSize) / 2;

      const canvas = createCanvas(this.targetSize);
      const context = canvas.getContext('2d', { alpha: false });
      context.drawImage(
        drawable,
        sx,
        sy,
        cropSize,
        cropSize,
        0,
        0,
        this.targetSize,
        this.targetSize,
      );

      return await canvasToBlob(canvas, 'image/webp', 0.82);
    } finally {
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }
  }
}
