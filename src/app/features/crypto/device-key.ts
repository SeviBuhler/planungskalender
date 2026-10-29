// Keeps the unlocked private key on this device (IndexedDB can store CryptoKey objects),
// so the recovery code is only needed once per device. Removed again on logout.

const DB_NAME = 'fortwo-keys';
const STORE = 'keys';

export interface DeviceKey {
  userId: string;
  publicKey: string; // to notice a reset on another device
  privateKey: CryptoKey;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'userId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function loadDeviceKey(userId: string): Promise<DeviceKey | null> {
  try {
    return (await run<DeviceKey | undefined>('readonly', (s) => s.get(userId))) ?? null;
  } catch {
    return null; // private mode or storage blocked: ask for the code again
  }
}

export async function saveDeviceKey(key: DeviceKey): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(key));
  } catch {
    // Without storage the key only lives until the page is closed
  }
}

export async function clearDeviceKeys(): Promise<void> {
  try {
    await run('readwrite', (s) => s.clear());
  } catch {
    // nothing stored
  }
}
