export interface SOSRecord {
  id?: number;
  timestamp: string;
  prompt: string;
  flags: string[];
  synced: boolean;
}

export const DB_NAME = 'AtlasBridgeDB';

/**
 * Bump when a store is added. Every opener must agree: IndexedDB rejects an
 * open at a lower version than the one on disk, so a worker still asking for
 * v1 after the page upgraded to v2 would fail outright. All openers go through
 * `applyUpgrade` for that reason.
 */
export const DB_VERSION = 2;

export const SOS_STORE = 'pending_sos';
export const BUNDLE_STORE = 'bundles';

/** Idempotent: creates only stores that are missing, so existing rows survive. */
export function applyUpgrade(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(SOS_STORE)) {
    db.createObjectStore(SOS_STORE, { keyPath: 'id', autoIncrement: true });
  }
  if (!db.objectStoreNames.contains(BUNDLE_STORE)) {
    db.createObjectStore(BUNDLE_STORE, { keyPath: 'id' });
  }
}

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e: any) => {
      applyUpgrade(e.target.result);
    };

    request.onsuccess = (e: any) => {
      resolve(e.target.result);
    };

    request.onerror = (e: any) => {
      reject(e.target.error || new Error('Failed to open database'));
    };

    request.onblocked = () => {
      reject(new Error('Database upgrade blocked by another open tab'));
    };
  });
}

export function getUnsyncedLogs(db: IDBDatabase): Promise<SOSRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOS_STORE, 'readonly');
    const store = tx.objectStore(SOS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const allRecords = request.result as SOSRecord[];
      const unsynced = allRecords.filter(r => !r.synced);
      resolve(unsynced);
    };

    request.onerror = (e: any) => {
      reject(e.target.error || new Error('Failed to retrieve logs'));
    };
  });
}

export function getAllLogs(db: IDBDatabase): Promise<SOSRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOS_STORE, 'readonly');
    const store = tx.objectStore(SOS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = request.result as SOSRecord[];
      // Sort newest first
      records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      resolve(records);
    };

    request.onerror = (e: any) => {
      reject(e.target.error || new Error('Failed to retrieve all logs'));
    };
  });
}

export function clearSyncedLogs(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOS_STORE, 'readwrite');
    const store = tx.objectStore(SOS_STORE);
    const getReq = store.getAll();

    getReq.onsuccess = () => {
      const records = getReq.result as SOSRecord[];
      const deletePromises = records
        .filter(r => r.synced)
        .map(r => {
          return new Promise<void>((res) => {
            const delReq = store.delete(r.id!);
            delReq.onsuccess = () => res();
            delReq.onerror = () => res(); // ignore single failure
          });
        });

      Promise.all(deletePromises)
        .then(() => resolve())
        .catch(err => reject(err));
    };

    getReq.onerror = () => reject(new Error('Failed to fetch for clearing'));
  });
}
