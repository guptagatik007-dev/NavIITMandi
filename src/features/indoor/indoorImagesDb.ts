/**
 * indoorImagesDb.ts — IndexedDB vault for uploaded floor-plan images.
 *
 * Why: multi-megabyte PNG/JPEG plans base64-encoded in localStorage hit the 5 MB
 * quota after one or two uploads (the exact failure reported in the field). Blobs
 * belong in IndexedDB; localStorage keeps only the small metadata entries.
 *
 * Every public function degrades gracefully to `null` when IndexedDB is
 * unavailable (private mode, old webviews) so callers can fall back to data URLs.
 */

const DB_NAME = 'iitm-nav-indoor';
const STORE = 'plan-images';

interface IdbLike {
  open: boolean;
  db: IDBDatabase | null;
}
const state: IdbLike = { open: false, db: null };

function openDb(): Promise<IDBDatabase | null> {
  if (state.open) return Promise.resolve(state.db);
  if (typeof indexedDB === 'undefined') {
    state.open = true;
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        state.open = true;
        state.db = req.result;
        resolve(state.db);
      };
      req.onerror = () => {
        state.open = true;
        state.db = null;
        resolve(null);
      };
    } catch {
      state.open = true;
      resolve(null);
    }
  });
}

export async function idbAvailable(): Promise<boolean> {
  return (await openDb()) !== null;
}

export async function savePlanImage(key: string, blob: Blob): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function loadPlanImage(key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deletePlanImage(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
