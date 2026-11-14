// Keeps imported audio files in IndexedDB so playback survives a reload.
// localStorage only holds strings and about 5 MB, so it can't hold audio;
// IndexedDB stores File/Blob objects directly and has a much larger quota.
// One record per track: { id, blob, wave, name, size, savedAt }.

const DB_NAME = "setflow-audio",
  STORE = "files";

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Run one request inside a transaction and resolve when the transaction
// commits, so a successful put is actually on disk before we report it.
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode),
      req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || req?.error);
  });
}

export const audioStoreAvailable = typeof indexedDB !== "undefined";

export function saveAudio(id, file, wave) {
  return run("readwrite", (s) =>
    s.put({
      id,
      blob: file,
      wave,
      name: file.name,
      size: file.size,
      savedAt: new Date().toISOString(),
    }),
  );
}
export function loadAllAudio() {
  return run("readonly", (s) => s.getAll());
}
export function deleteAudio(id) {
  return run("readwrite", (s) => s.delete(id));
}
export function clearAudio() {
  return run("readwrite", (s) => s.clear());
}
