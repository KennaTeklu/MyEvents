/*
 * eventStream.js – The Instant Responder
 * Central event bus that listens to all changes from db.js
 * and triggers reactive actions (e.g., incremental scheduling, conflict detection).
 */

// ========== PRIVATE VARIABLES ==========
let debounceTimers = new Map();
const DEBOUNCE_MS = 300;

// ========== LISTEN TO DB EVENTS ==========
function initEventStream() {
    // Listen to record changes
    onEvent('record:added', handleRecordAdded);
    onEvent('record:updated', handleRecordUpdated);
    onEvent('record:deleted', handleRecordDeleted);
    onEvent('store:cleared', handleStoreCleared);
    onEvent('setting:changed', handleSettingChanged);
    onEvent('all:cleared', handleAllCleared);
    
    console.log('The Instant Responder is now active');
}

// ========== HANDLERS ==========
function handleRecordAdded(payload) {
    const { storeName, record } = payload;
    console.log(`[EventStream] Added to ${storeName}:`, record);
    
    // Debounce to avoid rapid consecutive triggers
    const key = `${storeName}:added`;
    debounceAction(key, () => {
        switch (storeName) {
            case 'events':
            case 'busyBlocks':
            case 'todos':
            case 'overrides':
                triggerRescheduling(record);
                break;
            case 'places':
                triggerLocationUpdate(record);
                break;
            case 'scheduledEvents':
                triggerCalendarRefresh();
                break;
            case 'conversationLog':
                if (record.role === 'user') triggerCommandParsing(record);
                break;
        }
    });
}

function handleRecordUpdated(payload) {
    const { storeName, record } = payload;
    console.log(`[EventStream] Updated in ${storeName}:`, record);
    
    const key = `${storeName}:updated`;
    debounceAction(key, () => {
        switch (storeName) {
            case 'events':
            case 'busyBlocks':
            case 'todos':
            case 'overrides':
                triggerRescheduling(record);
                break;
            case 'places':
                triggerLocationUpdate(record);
                break;
            case 'settings':
                if (record.key === 'restPolicy' || record.key === 'travelSpeed') {
                    triggerRescheduling();
                }
                break;
        }
    });
}

function handleRecordDeleted(payload) {
    const { storeName, key: recordKey } = payload;
    console.log(`[EventStream] Deleted from ${storeName}: key=${recordKey}`);
    
    const debKey = `${storeName}:deleted`;
    debounceAction(debKey, () => {
        if (storeName === 'events' || storeName === 'busyBlocks' || storeName === 'todos') {
            triggerRescheduling();
        } else if (storeName === 'scheduledEvents') {
            triggerCalendarRefresh();
        }
    });
}

function handleStoreCleared(payload) {
    const { storeName } = payload;
    console.log(`[EventStream] Cleared entire store: ${storeName}`);
    if (storeName === 'events' || storeName === 'busyBlocks' || storeName === 'todos') {
        triggerRescheduling();
    }
}

function handleSettingChanged(payload) {
    const { key, value } = payload;
    if (key === 'planningHorizonWeeks') {
        triggerRescheduling();
    }
}

function handleAllCleared() {
    console.log('[EventStream] All data cleared – resetting state');
    triggerRescheduling();
}

// ========== ACTIONS ==========
function triggerRescheduling(affectedRecord = null) {
    // Determine date range for incremental rescheduling
    let startDate, endDate;
    if (affectedRecord && (affectedRecord.startDate || affectedRecord.date)) {
        const dateStr = affectedRecord.startDate || affectedRecord.date;
        if (dateStr) {
            const date = new Date(dateStr);
            startDate = new Date(date);
            startDate.setDate(date.getDate() - 2);
            endDate = new Date(date);
            endDate.setDate(date.getDate() + 2);
        }
    }
    if (!startDate || !endDate) {
        // full reschedule
        startDate = new Date();
        endDate = new Date();
        endDate.setDate(endDate.getDate() + (planningHorizonWeeks || 4) * 7);
    }
    
    // Call the scheduler (defined in scheduler.js)
    if (typeof Scheduler !== 'undefined' && Scheduler.runIncremental) {
        Scheduler.runIncremental(startDate, endDate);
    } else {
        // Fallback to full run
        if (typeof runOptimizer === 'function') runOptimizer();
    }
}

function triggerLocationUpdate(place) {
    // If a place was added/updated, clear travel time cache
    if (typeof LocationManager !== 'undefined' && LocationManager.clearTravelCache) {
        LocationManager.clearTravelCache();
    }
    // Recalculate any events that depend on this place
    triggerRescheduling();
}

function triggerCalendarRefresh() {
    if (typeof renderCalendar === 'function') renderCalendar();
}

function triggerCommandParsing(message) {
    // If the user sent a message in chat, try to parse as command
    if (message.text && message.role === 'user') {
        if (typeof CommandParser !== 'undefined') {
            CommandParser.parse(message.text);
        }
    }
}

// ========== DEBOUNCE HELPER ==========
function debounceAction(key, callback) {
    if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
    debounceTimers.set(key, setTimeout(() => {
        debounceTimers.delete(key);
        callback();
    }, DEBOUNCE_MS));
}

// ========== EXPORT ==========
window.initEventStream = initEventStream;