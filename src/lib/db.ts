export interface SOSRecord {
  id?: number;
  timestamp: string;
  prompt: string;
  flags: string[];
  synced: boolean;
}

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AtlasBridgeDB', 1);

    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending_sos')) {
        db.createObjectStore('pending_sos', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (e: any) => {
      resolve(e.target.result);
    };

    request.onerror = (e: any) => {
      reject(e.target.error || new Error('Failed to open database'));
    };
  });
}

export function getUnsyncedLogs(db: IDBDatabase): Promise<SOSRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_sos', 'readonly');
    const store = tx.objectStore('pending_sos');
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
    const tx = db.transaction('pending_sos', 'readonly');
    const store = tx.objectStore('pending_sos');
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

export function markLogAsSynced(db: IDBDatabase, id: number | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (id === undefined) return resolve();

    const tx = db.transaction('pending_sos', 'readwrite');
    const store = tx.objectStore('pending_sos');
    
    // Get record first
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        record.synced = true;
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(new Error('Failed to update record'));
      } else {
        resolve();
      }
    };
    getReq.onerror = () => reject(new Error('Failed to fetch record to sync'));
  });
}

export function clearSyncedLogs(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending_sos', 'readwrite');
    const store = tx.objectStore('pending_sos');
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
