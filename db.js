// db.js - IndexedDB Persistence & Transaction Engine
// Must be loaded after state.js

const DB_NAME = 'SmartScheduler';
const DB_VERSION = 9; // Incremented to accommodate the 'overrides' store properly

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
            showToast('Database error – using in-memory fallback', 'error');
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
            // Schema Initialization
            if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('events')) {
                const s = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
                s.createIndex('name', 'name');
            }
            if (!db.objectStoreNames.contains('busyBlocks')) db.createObjectStore('busyBlocks', { keyPath: 'id', autoIncrement: true });
            if (!db.objectStoreNames.contains('places')) db.createObjectStore('places', { keyPath: 'id', autoIncrement: true });
            
            // Critical Exception Store: compositeKey is "eventId_YYYY-MM-DD"
            if (!db.objectStoreNames.contains('overrides')) db.createObjectStore('overrides', { keyPath: 'compositeKey' });
            
            if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
            if (!db.objectStoreNames.contains('attendanceLog')) db.createObjectStore('attendanceLog', { keyPath: 'id', autoIncrement: true });
        };
    });
}

async function getStore(storeName, mode = 'readonly') {
    if (!dbReady || !db) await new Promise(resolve => dbQueue.push({ resolve }));
    return db.transaction(storeName, mode).objectStore(storeName);
}

// ========== ATOMIC DATA ACCESS ==========

async function getAll(storeName) {
    const store = await getStore(storeName);
    const result = await idbRequest(store.getAll());
    return result || [];
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

// Essential for Import/Reset
async function clearStore(storeName) {
    const store = await getStore(storeName, 'readwrite');
    return await idbRequest(store.clear());
}

// ========== DRAFT PERSISTENCE ==========

async function saveDraft(type, data) {
    const store = await getStore('drafts', 'readwrite');
    await idbRequest(store.put({ id: type, data }));
}

async function loadDraft(type) {
    const store = await getStore('drafts');
    const result = await idbRequest(store.get(type));
    return result ? result.data : null;
}

async function clearDraft(type) {
    const store = await getStore('drafts', 'readwrite');
    await idbRequest(store.delete(type));
}

// ========== SETTINGS PERSISTENCE ==========

async function getSetting(key) {
    try {
        const store = await getStore('settings');
        const res = await idbRequest(store.get(key));
        return res ? res.value : null;
    } catch { return null; }
}

async function setSetting(key, value) {
    const store = await getStore('settings', 'readwrite');
    await idbRequest(store.put({ key, value }));
}
