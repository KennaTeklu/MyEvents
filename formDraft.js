/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// formDraft.js - Auto-save form data to IndexedDB and localStorage
// Must be loaded after db.js

/**
 * FormDraft - Automatically saves form data as user types.
 * Supports custom handlers for complex fields (like priority stars, checkboxes groups).
 */
class FormDraft {
    /**
     * Create a new FormDraft instance.
     * @param {string} modalId - ID of the modal element containing the form.
     * @param {string} key - Unique key for storing the draft (e.g., 'eventDraft', 'busyDraft').
     * @param {Object} customHandlers - Optional handlers for non‑standard fields.
     *   Each handler: { read: function(modal) -> value, write: function(modal, value) }
     */
    constructor(modalId, key, customHandlers = {}) {
        this.modal = document.getElementById(modalId);
        this.key = key;
        this.customHandlers = customHandlers;
        this.saveTimer = null;
        
        if (!this.modal) {
            console.warn(`FormDraft: Modal with id "${modalId}" not found.`);
            return;
        }
        
        this.setupListeners();
        this.loadDraft(); // async, but we don't await – it will restore when ready
        
        // Keep a global registry for flushing on beforeunload
        if (!window._draftManagers) window._draftManagers = [];
        window._draftManagers.push(this);
    }

    /**
     * Capture current form state.
     * @returns {Object} Form data.
     */
    capture() {
        const formData = {};
        const inputs = this.modal.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            const id = input.id || input.name;
            if (!id) return;
            if (input.type === 'checkbox' || input.type === 'radio') {
                formData[id] = input.checked;
            } else {
                formData[id] = input.value;
            }
        });
        // Apply custom handlers
        for (const [key, handler] of Object.entries(this.customHandlers)) {
            if (handler.read) formData[key] = handler.read(this.modal);
        }
        return formData;
    }

    /**
     * Restore form state from data object.
     * @param {Object} data - Previously captured form data.
     */
    restore(data) {
        if (!data) return;
        const inputs = this.modal.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            const id = input.id || input.name;
            if (!id || !(id in data)) return;
            if (input.type === 'checkbox' || input.type === 'radio') {
                input.checked = data[id];
            } else {
                input.value = data[id];
            }
        });
        for (const [key, handler] of Object.entries(this.customHandlers)) {
            if (handler.write && data[key] !== undefined) handler.write(this.modal, data[key]);
        }
    }

    /**
     * Save draft to IndexedDB and localStorage.
     */
    async saveDraft() {
        const draft = this.capture();
        try {
            await saveDraft(this.key, draft);
        } catch (err) {
            console.warn('Failed to save draft to IndexedDB:', err);
        }
        this.saveToLocalStorage(draft);
    }

    /**
     * Save draft to localStorage (fallback and sync).
     * @param {Object} draft
     */
    saveToLocalStorage(draft) {
        try {
            localStorage.setItem(`draft_${this.key}`, JSON.stringify(draft));
        } catch (err) {
            console.warn('Failed to save draft to localStorage:', err);
        }
    }

    /**
     * Load draft from IndexedDB or localStorage.
     * @returns {Promise<Object|null>} The restored draft, or null.
     */
    async loadDraft() {
        let draft = null;
        try {
            draft = await loadDraft(this.key); // from db.js
        } catch (err) {
            console.warn('Failed to load draft from IndexedDB:', err);
        }
        
        if (!draft) {
            const local = localStorage.getItem(`draft_${this.key}`);
            if (local) {
                try {
                    const parsed = JSON.parse(local);
                    // Ensure it's not just an empty object "{}"
                    if (Object.keys(parsed).length > 0) draft = parsed;
                } catch (e) {}
            }
        }
        
        if (draft) this.restore(draft);
        return draft; // Crucial: return the draft to the caller!
    }

    /**
     * Clear the draft (remove from both storages).
     */
    async clearDraft() {
        try {
            await clearDraft(this.key);
        } catch (err) {
            console.warn('Failed to clear draft from IndexedDB:', err);
        }
        localStorage.removeItem(`draft_${this.key}`);
    }

    /**
     * Force immediate flush of current state to localStorage (used before page unload).
     */
    flushSync() {
        const draft = this.capture();
        this.saveToLocalStorage(draft);
    }

    /**
     * Setup event listeners for auto-save.
     */
    setupListeners() {
        const debouncedSave = () => {
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => this.saveDraft(), 300);
        };
        this.modal.addEventListener('input', debouncedSave);
        this.modal.addEventListener('change', debouncedSave);
        
        // Special handling for priority stars (if present)
        const stars = this.modal.querySelectorAll('#eventPriorityStars .fa-star');
        stars.forEach(star => star.addEventListener('click', debouncedSave));
    }
}

// Make FormDraft globally available
window.FormDraft = FormDraft;

// Before unload, flush all drafts to localStorage for quick recovery
window.addEventListener('beforeunload', () => {
    if (window._draftManagers) {
        window._draftManagers.forEach(manager => {
            if (manager && manager.flushSync) manager.flushSync();
        });
    }
});