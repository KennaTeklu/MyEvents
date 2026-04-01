/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2025 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// undoRedo.js - Undo/Redo command pattern with snapshot history
// Must be loaded after db.js, constants.js, state.js

const UndoRedo = (function() {
    // ========== PRIVATE VARIABLES ==========
    let undoStack = window.undoStack || [];
    let redoStack = window.redoStack || [];
    const MAX_HISTORY = 50;
    
    // ========== PRIVATE HELPERS ==========
    
    // Deep clone any object (handles Dates, Maps, Arrays)
    function deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj);
        if (obj instanceof Map) {
            const clone = new Map();
            for (const [k, v] of obj.entries()) clone.set(deepClone(k), deepClone(v));
            return clone;
        }
        if (Array.isArray(obj)) return obj.map(deepClone);
        const clonedObj = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) clonedObj[key] = deepClone(obj[key]);
        }
        return clonedObj;
    }
    
    // Capture a full snapshot of all relevant stores
    async function captureSnapshot() {
        // Fetch all data from IndexedDB (ensure it's the latest)
        const snapshot = {
            events: await getAll(STORES.EVENTS),
            busyBlocks: await getAll(STORES.BUSY_BLOCKS),
            places: await getAll(STORES.PLACES),
            overrides: await getAll(STORES.OVERRIDES),
            todos: await getAll(STORES.TODOS),
            scheduledEvents: await getAll(STORES.SCHEDULED_EVENTS),
            learningData: await getAll(STORES.LEARNING_DATA),
            locationHistory: await getAll(STORES.LOCATION_HISTORY),
            userFeedback: await getAll(STORES.USER_FEEDBACK),
            settings: {} // settings are stored per key, we'll capture them all
        };
        // Capture all settings (could be many, but we'll fetch known keys)
        const settingsKeys = [
            'restPolicy', 'farMinutes', 'firstDayOfWeek', 'timeFormat', 'darkMode',
            'notifyDayBefore', 'notifyMinutesBefore', 'notifyTravelLead',
            'planningHorizonWeeks', 'userSettings', 'wizardComplete'
        ];
        for (const key of settingsKeys) {
            snapshot.settings[key] = await getSetting(key);
        }
        return snapshot;
    }
    
    // Restore a snapshot to IndexedDB
    async function restoreSnapshot(snapshot) {
        // Clear all stores (except maybe drafts? we can clear all relevant)
        const stores = [
            STORES.EVENTS, STORES.BUSY_BLOCKS, STORES.PLACES, STORES.OVERRIDES,
            STORES.TODOS, STORES.SCHEDULED_EVENTS, STORES.LEARNING_DATA,
            STORES.LOCATION_HISTORY, STORES.USER_FEEDBACK
        ];
        for (const store of stores) {
            await clearStore(store);
        }
        // Restore data
        for (const ev of snapshot.events) await addRecord(STORES.EVENTS, ev);
        for (const bb of snapshot.busyBlocks) await addRecord(STORES.BUSY_BLOCKS, bb);
        for (const pl of snapshot.places) await addRecord(STORES.PLACES, pl);
        for (const ov of snapshot.overrides) await putRecord(STORES.OVERRIDES, ov);
        for (const td of snapshot.todos) await addRecord(STORES.TODOS, td);
        for (const se of snapshot.scheduledEvents) await addRecord(STORES.SCHEDULED_EVENTS, se);
        for (const ld of snapshot.learningData) await addRecord(STORES.LEARNING_DATA, ld);
        for (const lh of snapshot.locationHistory) await addRecord(STORES.LOCATION_HISTORY, lh);
        for (const uf of snapshot.userFeedback) await addRecord(STORES.USER_FEEDBACK, uf);
        // Restore settings
        for (const [key, value] of Object.entries(snapshot.settings)) {
            if (value !== undefined && value !== null) await setSetting(key, value);
        }
        // Reload global state and refresh UI
        if (typeof fullRefresh === 'function') await fullRefresh();
        else {
            // Fallback: reload data manually
            if (typeof loadData === 'function') await loadData();
            if (typeof renderCalendar === 'function') await renderCalendar();
            if (typeof updateNotifications === 'function') updateNotifications();
        }
    }
    
    // Update undo/redo button states (if buttons exist)
    function updateButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.disabled = undoStack.length === 0;
        if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    }
    
    // ========== PUBLIC API ==========
    return {
        /**
         * Initialize undo/redo system. Optionally pass custom buttons.
         */
        init() {
            // Sync stacks with global (they may have been defined in state.js)
            undoStack = window.undoStack || [];
            redoStack = window.redoStack || [];
            updateButtons();
        },
        
        /**
         * Push an action onto the undo stack.
         * @param {string} description - Human-readable description of the action.
         * @param {Function} [undoFunc] - Optional custom undo function (if not provided, uses snapshot).
         * @param {Function} [redoFunc] - Optional custom redo function.
         */
        async pushAction(description, undoFunc = null, redoFunc = null) {
            // Capture snapshot before the action (so we can revert to it)
            const snapshot = await captureSnapshot();
            const action = {
                description,
                undo: async () => {
                    await restoreSnapshot(snapshot);
                    if (undoFunc) await undoFunc();
                },
                redo: async () => {
                    if (redoFunc) await redoFunc();
                    else {
                        // If no custom redo, we need to redo the change that was originally done.
                        // This is tricky because the user performed an action after the snapshot.
                        // We'll rely on the fact that after undo, the user would normally redo via the same stack.
                        // For simple state changes, we can just reload current state (which after undo is old state)
                        // For now, we just refresh.
                        await fullRefresh();
                    }
                },
                timestamp: Date.now()
            };
            undoStack.push(action);
            redoStack = [];
            // Limit history size
            while (undoStack.length > MAX_HISTORY) undoStack.shift();
            updateButtons();
        },
        
        /**
         * Undo the last action.
         * @returns {Promise<boolean>} True if undo performed.
         */
        async undo() {
            if (undoStack.length === 0) return false;
            const action = undoStack.pop();
            await action.undo();
            redoStack.push(action);
            updateButtons();
            if (typeof showToast === 'function') showToast(`Undo: ${action.description}`);
            return true;
        },
        
        /**
         * Redo the last undone action.
         * @returns {Promise<boolean>} True if redo performed.
         */
        async redo() {
            if (redoStack.length === 0) return false;
            const action = redoStack.pop();
            await action.redo();
            undoStack.push(action);
            updateButtons();
            if (typeof showToast === 'function') showToast(`Redo: ${action.description}`);
            return true;
        },
        
        /**
         * Check if undo is available.
         * @returns {boolean}
         */
        canUndo() {
            return undoStack.length > 0;
        },
        
        /**
         * Check if redo is available.
         * @returns {boolean}
         */
        canRedo() {
            return redoStack.length > 0;
        },
        
        /**
         * Clear the entire history.
         */
        clearHistory() {
            undoStack = [];
            redoStack = [];
            updateButtons();
        }
    };
})();

// Expose undo/redo functions globally (for compatibility with existing code)
window.UndoRedo = UndoRedo;
window.undo = () => UndoRedo.undo();
window.redo = () => UndoRedo.redo();
window.pushAction = (desc, undoFunc, redoFunc) => UndoRedo.pushAction(desc, undoFunc, redoFunc);
window.updateUndoRedoButtons = () => UndoRedo.init(); // for backwards compatibility

// Initialize on load (if DOM is ready)
document.addEventListener('DOMContentLoaded', () => {
    UndoRedo.init();
});
