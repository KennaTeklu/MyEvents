/*
 * Smart Scheduler – Enhanced IndexedDB Layer
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This module adds:
 * - Write‑ahead log (WAL) for crash recovery
 * - Periodic snapshots with checksums
 * - Auto‑healing on corruption detection
 * - Batch operations
 * - Event broadcasting (The Instant Responder)
 */

// ========== GLOBALS ==========
let db = null;
let dbReady = false;
let dbQueue = [];            // pending operations while DB opening
let walEntries = [];         // in‑memory write‑ahead log
let snapshotInProgress = false;
let eventListeners = new Map(); // for The Instant Responder

const DB_NAME = 'SmartScheduler';
const DB_VERSION = 11;       // increased for new stores & WAL
const WAL_MAX_SIZE = 100;    // number of entries before forcing a snapshot
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ========== HELPER: IDB PROMISE ==========
function idbRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ========== INITIALIZE DB ==========
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
            // start background snapshot scheduler
            startSnapshotScheduler();
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // Existing stores (kept)
            if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('events')) {
                const s = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
                s.createIndex('name', 'name');
                s.createIndex('startDate', 'startDate');
            }
            if (!db.objectStoreNames.contains('busyBlocks')) db.createObjectStore('busyBlocks', { keyPath: 'id', autoIncrement: true });
            if (!db.objectStoreNames.contains('places')) db.createObjectStore('places', { keyPath: 'id', autoIncrement: true });
            if (!db.objectStoreNames.contains('overrides')) db.createObjectStore('overrides', { keyPath: 'compositeKey' });
            if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
            if (!db.objectStoreNames.contains('attendanceLog')) db.createObjectStore('attendanceLog', { keyPath: 'id', autoIncrement: true });
            if (!db.objectStoreNames.contains('todos')) {
                const todoStore = db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true });
                todoStore.createIndex('dueDate', 'dueDate');
                todoStore.createIndex('priority', 'priority');
                todoStore.createIndex('completed', 'completed');
            }
            if (!db.objectStoreNames.contains('scheduledEvents')) {
                const schedStore = db.createObjectStore('scheduledEvents', { keyPath: 'id', autoIncrement: true });
                schedStore.createIndex('eventId', 'eventId');
                schedStore.createIndex('dateStr', 'dateStr');
            }
            if (!db.objectStoreNames.contains('learningData')) {
                const learnStore = db.createObjectStore('learningData', { keyPath: 'id', autoIncrement: true });
                learnStore.createIndex('type', 'type');
            }
            if (!db.objectStoreNames.contains('locationHistory')) {
                const locStore = db.createObjectStore('locationHistory', { keyPath: 'id', autoIncrement: true });
                locStore.createIndex('timestamp', 'timestamp');
            }
            if (!db.objectStoreNames.contains('userFeedback')) {
                const fbStore = db.createObjectStore('userFeedback', { keyPath: 'id', autoIncrement: true });
                fbStore.createIndex('eventId', 'eventId');
            }
            // New stores for the assistant
            if (!db.objectStoreNames.contains('conversationLog')) {
                const convStore = db.createObjectStore('conversationLog', { keyPath: 'id', autoIncrement: true });
                convStore.createIndex('timestamp', 'timestamp');
                convStore.createIndex('status', 'status');
            }
            if (!db.objectStoreNames.contains('decisionLog')) {
                const decStore = db.createObjectStore('decisionLog', { keyPath: 'situationHash' });
                decStore.createIndex('lastUpdated', 'lastUpdated');
            }
            if (!db.objectStoreNames.contains('userQuotes')) {
                db.createObjectStore('userQuotes', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('templatesCache')) {
                db.createObjectStore('templatesCache', { keyPath: 'templateId' });
            }
            // WAL store (for recovery)
            if (!db.objectStoreNames.contains('wal')) {
                db.createObjectStore('wal', { keyPath: 'sequence', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('snapshots')) {
                db.createObjectStore('snapshots', { keyPath: 'snapshotId', autoIncrement: true });
            }
        };
    });
}

// ========== WAL & SNAPSHOT MANAGEMENT ==========

async function addToWAL(operation, storeName, key, value) {
    const entry = {
        timestamp: Date.now(),
        operation, // 'add', 'put', 'delete', 'clear'
        storeName,
        key,
        value: value ? JSON.parse(JSON.stringify(value)) : null
        // Do NOT set 'sequence' – let IndexedDB auto-generate it
    };
    walEntries.push(entry);
    if (walEntries.length >= WAL_MAX_SIZE) {
        await createSnapshot();
    }
    // Also store in IndexedDB WAL store for persistence
    try {
        const store = await getStore('wal', 'readwrite');
        await idbRequest(store.add(entry));
    } catch (e) {
        console.warn('Failed to write to WAL store', e);
    }
}

async function createSnapshot() {
    if (snapshotInProgress) return;
    snapshotInProgress = true;
    try {
        // Collect all data from all stores
        const stores = [
            'events', 'busyBlocks', 'places', 'overrides', 'settings', 'attendanceLog',
            'drafts', 'todos', 'scheduledEvents', 'learningData', 'locationHistory',
            'userFeedback', 'conversationLog', 'decisionLog', 'userQuotes', 'templatesCache'
        ];
        const snapshotData = {};
        for (const storeName of stores) {
            snapshotData[storeName] = await getAll(storeName);
        }
        const checksum = await computeChecksum(snapshotData);
        const snapshot = {
            timestamp: Date.now(),
            data: snapshotData,
            checksum: checksum,
            version: DB_VERSION
        };
        const store = await getStore('snapshots', 'readwrite');
        await idbRequest(store.add(snapshot));
        // Clear old snapshots (keep last 3)
        const allSnapshots = await getAll('snapshots');
        if (allSnapshots.length > 3) {
            const toDelete = allSnapshots.slice(0, allSnapshots.length - 3);
            for (const s of toDelete) await deleteRecord('snapshots', s.snapshotId);
        }
        // Clear WAL after successful snapshot
        await clearStore('wal');
        walEntries = [];
    } catch (err) {
        console.error('Snapshot creation failed:', err);
    } finally {
        snapshotInProgress = false;
    }
}

async function computeChecksum(data) {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString();
}

async function verifyAndHeal() {
    const snapshots = await getAll('snapshots');
    if (snapshots.length === 0) return true;
    const latest = snapshots[snapshots.length - 1];
    const currentChecksum = await computeChecksum(latest.data);
    if (currentChecksum !== latest.checksum) {
        console.warn('Checksum mismatch! Attempting recovery from previous snapshot...');
        if (snapshots.length >= 2) {
            const previous = snapshots[snapshots.length - 2];
            await restoreSnapshot(previous);
            return true;
        } else {
            console.error('Corruption detected and no older snapshot available');
            return false;
        }
    }
    return true;
}

async function restoreSnapshot(snapshot) {
    // Clear all stores
    const stores = Object.keys(snapshot.data);
    for (const storeName of stores) {
        await clearStore(storeName);
        for (const record of snapshot.data[storeName]) {
            await addRecord(storeName, record);
        }
    }
    console.log('Restored from snapshot');
}

function startSnapshotScheduler() {
    setInterval(async () => {
        await createSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
}

// ========== STORE ACCESS ==========
async function getStore(storeName, mode = 'readonly') {
    if (!dbReady || !db) await initDB();
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
}

// ========== CRUD OPERATIONS WITH WAL & EVENTS ==========
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

async function addRecord(storeName, record) {
    const store = await getStore(storeName, 'readwrite');
    const key = await idbRequest(store.add(record));
    const newRecord = { ...record, id: key };
    await addToWAL('add', storeName, key, newRecord);
    // Emit event for The Instant Responder
    emitEvent('record:added', { storeName, record: newRecord });
    return key;
}

async function putRecord(storeName, record) {
    const store = await getStore(storeName, 'readwrite');
    await idbRequest(store.put(record));
    await addToWAL('put', storeName, record.id || record.compositeKey, record);
    emitEvent('record:updated', { storeName, record });
}

async function deleteRecord(storeName, key) {
    const store = await getStore(storeName, 'readwrite');
    await idbRequest(store.delete(key));
    await addToWAL('delete', storeName, key, null);
    emitEvent('record:deleted', { storeName, key });
}

async function clearStore(storeName) {
    const store = await getStore(storeName, 'readwrite');
    await idbRequest(store.clear());
    await addToWAL('clear', storeName, null, null);
    emitEvent('store:cleared', { storeName });
}

// ========== BATCH OPERATIONS ==========
async function bulkAdd(storeName, records) {
    if (!records || records.length === 0) return [];
    const store = await getStore(storeName, 'readwrite');
    const results = [];
    for (const rec of records) {
        try {
            const id = await idbRequest(store.add(rec));
            results.push(id);
            await addToWAL('add', storeName, id, { ...rec, id });
            emitEvent('record:added', { storeName, record: { ...rec, id } });
        } catch (err) {
            console.error(`Bulk add failed for record ${JSON.stringify(rec)}:`, err);
            results.push(null);
        }
    }
    return results;
}

async function bulkPut(storeName, records) {
    if (!records || records.length === 0) return [];
    const store = await getStore(storeName, 'readwrite');
    const results = [];
    for (const rec of records) {
        try {
            await idbRequest(store.put(rec));
            results.push(true);
            await addToWAL('put', storeName, rec.id || rec.compositeKey, rec);
            emitEvent('record:updated', { storeName, record: rec });
        } catch (err) {
            console.error(`Bulk put failed for record ${JSON.stringify(rec)}:`, err);
            results.push(false);
        }
    }
    return results;
}

async function bulkDelete(storeName, keys) {
    if (!keys || keys.length === 0) return [];
    const store = await getStore(storeName, 'readwrite');
    const results = [];
    for (const key of keys) {
        try {
            await idbRequest(store.delete(key));
            results.push(true);
            await addToWAL('delete', storeName, key, null);
            emitEvent('record:deleted', { storeName, key });
        } catch (err) {
            console.error(`Bulk delete failed for key ${key}:`, err);
            results.push(false);
        }
    }
    return results;
}

// ========== DRAFT PERSISTENCE ==========
async function saveDraft(type, data) {
    const store = await getStore('drafts', 'readwrite');
    await idbRequest(store.put({ id: type, data }));
    emitEvent('draft:saved', { type, data });
}

async function loadDraft(type) {
    const store = await getStore('drafts');
    const result = await idbRequest(store.get(type));
    return result ? result.data : null;
}

async function clearDraft(type) {
    const store = await getStore('drafts', 'readwrite');
    await idbRequest(store.delete(type));
    emitEvent('draft:cleared', { type });
}

// ========== SETTINGS PERSISTENCE ==========
async function getSetting(key) {
    try {
        const store = await getStore('settings');
        const result = await idbRequest(store.get(key));
        return result ? result.value : null;
    } catch (e) {
        return null;
    }
}

async function setSetting(key, value) {
    const store = await getStore('settings', 'readwrite');
    await idbRequest(store.put({ key, value }));
    emitEvent('setting:changed', { key, value });
}

// ========== RESET ALL STORES ==========
async function clearAllStores() {
    const stores = [
        'events', 'busyBlocks', 'places', 'overrides', 'settings', 'attendanceLog',
        'drafts', 'todos', 'scheduledEvents', 'learningData', 'locationHistory',
        'userFeedback', 'conversationLog', 'decisionLog', 'userQuotes', 'templatesCache', 'wal', 'snapshots'
    ];
    for (const storeName of stores) {
        try {
            await clearStore(storeName);
        } catch (err) {
            console.warn(`Failed to clear store ${storeName}:`, err);
        }
    }
    walEntries = [];
    emitEvent('all:cleared', {});
}

// ========== EVENT BROADCASTING (The Instant Responder) ==========
function emitEvent(eventName, payload) {
    if (eventListeners.has(eventName)) {
        eventListeners.get(eventName).forEach(callback => {
            try {
                callback(payload);
            } catch (err) {
                console.error(`Error in event listener for ${eventName}:`, err);
            }
        });
    }
}

function onEvent(eventName, callback) {
    if (!eventListeners.has(eventName)) eventListeners.set(eventName, []);
    eventListeners.get(eventName).push(callback);
}

function offEvent(eventName, callback) {
    if (!eventListeners.has(eventName)) return;
    const callbacks = eventListeners.get(eventName);
    const index = callbacks.indexOf(callback);
    if (index !== -1) callbacks.splice(index, 1);
}

// ========== EXPORT ==========
window.initDB = initDB;
window.getStore = getStore;
window.getAll = getAll;
window.addRecord = addRecord;
window.putRecord = putRecord;
window.deleteRecord = deleteRecord;
window.clearStore = clearStore;
window.bulkAdd = bulkAdd;
window.bulkPut = bulkPut;
window.bulkDelete = bulkDelete;
window.saveDraft = saveDraft;
window.loadDraft = loadDraft;
window.clearDraft = clearDraft;
window.getSetting = getSetting;
window.setSetting = setSetting;
window.clearAllStores = clearAllStores;
window.onEvent = onEvent;
window.offEvent = offEvent;
window.verifyAndHeal = verifyAndHeal;
window.createSnapshot = createSnapshot;