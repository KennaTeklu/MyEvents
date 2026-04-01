// scheduleStore.js - Persistence and query helpers for scheduled events
// Must be loaded after db.js, constants.js

const ScheduleStore = (function() {
    // ========== PRIVATE HELPERS ==========
    
    // Refresh the global scheduledEvents array (maintained in state.js)
    async function refreshGlobal() {
        const fresh = await getAll(STORES.SCHEDULED_EVENTS);
        scheduledEvents.length = 0;
        scheduledEvents.push(...fresh);
    }
    
    // Validate a scheduled event object
    function validateScheduledEvent(se) {
        if (!se.eventId || typeof se.eventId !== 'number') {
            throw new Error('Scheduled event must have a numeric eventId');
        }
        if (!se.dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(se.dateStr)) {
            throw new Error('Scheduled event must have a valid dateStr (YYYY-MM-DD)');
        }
        if (se.startMin === undefined || se.endMin === undefined || se.startMin >= se.endMin) {
            throw new Error('Scheduled event must have valid startMin and endMin');
        }
        if (se.duration !== se.endMin - se.startMin) {
            // Auto-correct duration if not set correctly
            se.duration = se.endMin - se.startMin;
        }
        return true;
    }
    
    // ========== PUBLIC API ==========
    return {
        /**
         * Replace all scheduled events with a new schedule.
         * @param {Array} scheduleArray - Array of scheduled event objects.
         * @returns {Promise<void>}
         */
        async saveSchedule(scheduleArray) {
            if (!Array.isArray(scheduleArray)) {
                throw new Error('Schedule must be an array');
            }
            // Clear existing schedule
            await this.clearSchedule();
            // Add new schedule
            for (const se of scheduleArray) {
                await this.addScheduledEvent(se);
            }
            await refreshGlobal();
        },
        
        /**
         * Add a single scheduled event (e.g., during optimization).
         * @param {Object} se - Scheduled event object.
         * @returns {Promise<number>} ID of the new record.
         */
        async addScheduledEvent(se) {
            validateScheduledEvent(se);
            // Ensure no duplicate for same event+date (optional: we could overwrite, but we'll add and let caller handle duplicates)
            const id = await addRecord(STORES.SCHEDULED_EVENTS, se);
            await refreshGlobal();
            return id;
        },
        
        /**
         * Load all scheduled events.
         * @returns {Promise<Array>}
         */
        async loadSchedule() {
            return await getAll(STORES.SCHEDULED_EVENTS);
        },
        
        /**
         * Get scheduled events for a specific date.
         * @param {string} dateStr - YYYY-MM-DD
         * @returns {Promise<Array>}
         */
        async getScheduleForDate(dateStr) {
            const all = await getAll(STORES.SCHEDULED_EVENTS);
            return all.filter(se => se.dateStr === dateStr);
        },
        
        /**
         * Get scheduled events for a specific event ID.
         * @param {number} eventId
         * @returns {Promise<Array>}
         */
        async getScheduleForEvent(eventId) {
            const all = await getAll(STORES.SCHEDULED_EVENTS);
            return all.filter(se => se.eventId === eventId);
        },
        
        /**
         * Remove all scheduled events for a specific event (e.g., when event is deleted).
         * @param {number} eventId
         * @returns {Promise<void>}
         */
        async removeScheduleForEvent(eventId) {
            const all = await getAll(STORES.SCHEDULED_EVENTS);
            const toDelete = all.filter(se => se.eventId === eventId);
            for (const se of toDelete) {
                await deleteRecord(STORES.SCHEDULED_EVENTS, se.id);
            }
            await refreshGlobal();
        },
        
        /**
         * Delete a specific scheduled occurrence.
         * @param {number} id - Record ID of the scheduled event.
         * @returns {Promise<void>}
         */
        async deleteScheduledEvent(id) {
            await deleteRecord(STORES.SCHEDULED_EVENTS, id);
            await refreshGlobal();
        },
        
        /**
         * Clear all scheduled events.
         * @returns {Promise<void>}
         */
        async clearSchedule() {
            await clearStore(STORES.SCHEDULED_EVENTS);
            await refreshGlobal();
        },
        
        /**
         * Export the current schedule as a JSON string.
         * @returns {Promise<string>}
         */
        async exportSchedule() {
            const schedule = await this.loadSchedule();
            return JSON.stringify(schedule, null, 2);
        },
        
        /**
         * Import a schedule from JSON string, replacing existing schedule.
         * @param {string} jsonString
         * @returns {Promise<void>}
         */
        async importSchedule(jsonString) {
            let schedule;
            try {
                schedule = JSON.parse(jsonString);
            } catch (e) {
                throw new Error('Invalid JSON');
            }
            if (!Array.isArray(schedule)) {
                throw new Error('Schedule must be an array');
            }
            await this.clearSchedule();
            for (const se of schedule) {
                await this.addScheduledEvent(se);
            }
        },
        
        /**
         * Get version info (for future upgrades). Currently just returns current count.
         * @returns {Promise<Object>}
         */
        async getInfo() {
            const all = await this.loadSchedule();
            return {
                count: all.length,
                version: 1,
                lastUpdated: new Date().toISOString()
            };
        }
    };
})();

// Make ScheduleStore globally available
window.ScheduleStore = ScheduleStore;
