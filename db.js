// ==================== INDEXEDDB HELPERS ====================
let db = null;
let dbReady = false;
let dbQueue = [];
const DB_NAME = 'SmartScheduler';
const DB_VERSION = 8;

function idbRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function initDB() {
    if (dbReady && db) return db;
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => {
            console.error('IndexedDB error:', request.error);
            showToast('Database error – using in‑memory fallback', 'error');
            dbReady = false;
            reject(request.error);
        };
        request.onsuccess = () => {
            db = request.result;
            dbReady = true;
            while (dbQueue.length) dbQueue.shift().resolve();
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('drafts')) {
                db.createObjectStore('drafts', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('events')) {
                const eventStore = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
                eventStore.createIndex('name', 'name');
                eventStore.createIndex('startDate', 'startDate');
            }
            if (!db.objectStoreNames.contains('busyBlocks')) {
                db.createObjectStore('busyBlocks', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('places')) {
                const placeStore = db.createObjectStore('places', { keyPath: 'id', autoIncrement: true });
                placeStore.createIndex('name', 'name');
            }
            if (!db.objectStoreNames.contains('overrides')) {
                db.createObjectStore('overrides', { keyPath: 'compositeKey' });
            }
            if (!db.objectStoreNames.contains('actionHistory')) {
                db.createObjectStore('actionHistory', { keyPath: 'timestamp', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains('attendanceLog')) {
                db.createObjectStore('attendanceLog', { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

async function getStore(storeName, mode = 'readonly') {
    if (!dbReady || !db) {
        await new Promise(resolve => dbQueue.push({ resolve }));
    }
    return db.transaction(storeName, mode).objectStore(storeName);
}

async function getAll(storeName) {
    try {
        const store = await getStore(storeName);
        const result = await idbRequest(store.getAll());
        return Array.isArray(result) ? result : [];
    } catch (e) {
        console.error(`getAll failed for ${storeName}:`, e);
        return [];
    }
}

async function saveDraft(type, data) {
    try {
        const store = await getStore('drafts', 'readwrite');
        await idbRequest(store.put({ id: type, data }));
    } catch (err) {
        console.error('saveDraft failed:', err);
        throw err;
    }
}

async function loadDraft(type) {
    try {
        const store = await getStore('drafts');
        const result = await idbRequest(store.get(type));
        return result ? result.data : null;
    } catch { return null; }
}

async function clearDraft(type) {
    try {
        const store = await getStore('drafts', 'readwrite');
        await idbRequest(store.delete(type));
    } catch (err) {
        console.error('clearDraft failed:', err);
    }
}

async function addRecord(storeName, record) {
    const store = await getStore(storeName, 'readwrite');
    return await idbRequest(store.add(record));
}

async function putRecord(storeName, record) {
    const store = await getStore(storeName, 'readwrite');
    return await idbRequest(store.put(record));
}

async function deleteRecord(storeName, key) {
    const store = await getStore(storeName, 'readwrite');
    return await idbRequest(store.delete(key));
}

async function clearStore(storeName) {
    const store = await getStore(storeName, 'readwrite');
    return await idbRequest(store.clear());
}

async function getSetting(key) {
    try {
        const store = await getStore('settings');
        const result = await idbRequest(store.get(key));
        return result ? result.value : null;
    } catch { return null; }
}

async function setSetting(key, value) {
    try {
        const store = await getStore('settings', 'readwrite');
        const request = store.put({ key, value });
        await new Promise((resolve, reject) => {
            request.onsuccess = () => {
                request.transaction.oncomplete = resolve;
                request.transaction.onerror = (e) => reject(e.target.error);
            };
            request.onerror = (e) => reject(e.target.error);
        });
        console.log(`setSetting: ${key} saved`);
    } catch (err) {
        console.warn(`setSetting fallback to localStorage: ${err}`);
        localStorage.setItem(`setting_${key}`, JSON.stringify(value));
    }
}