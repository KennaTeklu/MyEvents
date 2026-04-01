/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// db.js - IndexedDB Persistence & Transaction Engine (Enhanced)
// Must be loaded after state.js, but before any modules that read/write data.
// Handles all low-level IndexedDB operations with new stores for todos, schedule, learning, etc.

// Internal state for the database connection
var db = null;
var dbReady = false;
var dbQueue = []; // Resolvers for pending operations while DB is opening

const DB_NAME = 'SmartScheduler';
const DB_VERSION = 10; // Incremented to add new stores: todos, scheduledEvents, learningData, locationHistory, userFeedback

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
            // Resolve any pending queue items
            while (dbQueue.length) dbQueue.shift().resolve();
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // --- Existing stores ---
            if (!db.objectStoreNames.contains('drafts')) {
                db.createObjectStore('drafts', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('events')) {
                const s = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
                s.createIndex('name', 'name');
                s.createIndex('startDate', 'startDate');
            }
            if (!db.objectStoreNames.contains('busyBlocks')) {
                db.createObjectStore('busyBlocks', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('places')) {
                db.createObjectStore('places', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('overrides')) {
                db.createObjectStore('overrides', { keyPath: 'compositeKey' });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains('attendanceLog')) {
                db.createObjectStore('attendanceLog', { keyPath: 'id', autoIncrement: true });
            }

            // --- New stores for the smart scheduler ---
            // 1. To‑do items
            if (!db.objectStoreNames.contains('todos')) {
                const todoStore = db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true });
                todoStore.createIndex('dueDate', 'dueDate');
                todoStore.createIndex('priority', 'priority');
                todoStore.createIndex('completed', 'completed');
                todoStore.createIndex('createdAt', 'createdAt');
            }
            // 2. Scheduled events (optimizer assignments)
            if (!db.objectStoreNames.contains('scheduledEvents')) {
                const schedStore = db.createObjectStore('scheduledEvents', { keyPath: 'id', autoIncrement: true });
                schedStore.createIndex('eventId', 'eventId');
                schedStore.createIndex('dateStr', 'dateStr');
                schedStore.createIndex('startTime', 'startTime');
            }
            // 3. Learning data (actual durations, travel times, preferences)
            if (!db.objectStoreNames.contains('learningData')) {
                const learnStore = db.createObjectStore('learningData', { keyPath: 'id', autoIncrement: true });
                learnStore.createIndex('type', 'type'); // 'duration', 'travel', 'preference'
                learnStore.createIndex('eventId', 'eventId');
                learnStore.createIndex('placeId', 'placeId');
                learnStore.createIndex('date', 'date');
            }
            // 4. Location history (movement patterns)
            if (!db.objectStoreNames.contains('locationHistory')) {
                const locStore = db.createObjectStore('locationHistory', { keyPath: 'id', autoIncrement: true });
                locStore.createIndex('timestamp', 'timestamp');
                locStore.createIndex('placeId', 'placeId');
                locStore.createIndex('lat', 'lat');
                locStore.createIndex('lon', 'lon');
            }
            // 5. User feedback (likes/dislikes)
            if (!db.objectStoreNames.contains('userFeedback')) {
                const feedbackStore = db.createObjectStore('userFeedback', { keyPath: 'id', autoIncrement: true });
                feedbackStore.createIndex('eventId', 'eventId');
                feedbackStore.createIndex('type', 'type'); // 'like', 'dislike', 'comment'
                feedbackStore.createIndex('timestamp', 'timestamp');
            }
        };
    });
}

async function getStore(storeName, mode = 'readonly') {
    if (!dbReady || !db) {
        await new Promise(resolve => dbQueue.push({ resolve }));
    }
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
}

// ========== ATOMIC DATA ACCESS ==========

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

// ========== BATCH OPERATIONS ==========

async function bulkAdd(storeName, records) {
    if (!records || records.length === 0) return [];
    const store = await getStore(storeName, 'readwrite');
    const results = [];
    for (const rec of records) {
        try {
            const id = await idbRequest(store.add(rec));
            results.push(id);
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
        const result = await idbRequest(store.get(key));
        return result ? result.value : null;
    } catch (e) {
        return null;
    }
}

async function setSetting(key, value) {
    const store = await getStore('settings', 'readwrite');
    await idbRequest(store.put({ key, value }));
}

// ========== UTILITY FOR RESET ==========

async function clearAllStores() {
    const stores = [
        'events', 'busyBlocks', 'places', 'overrides', 'settings', 'attendanceLog',
        'drafts', 'todos', 'scheduledEvents', 'learningData', 'locationHistory', 'userFeedback'
    ];
    for (const storeName of stores) {
        try {
            await clearStore(storeName);
        } catch (err) {
            console.warn(`Failed to clear store ${storeName}:`, err);
        }
    }
}

// ========== RETRY HELPER (optional) ==========
async function withRetry(operation, maxRetries = 2, delay = 100) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (err) {
            if (attempt === maxRetries) throw err;
            await new Promise(r => setTimeout(r, delay));
        }
    }
}
