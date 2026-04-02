/*
 * timeLearner.js – Learns which hours and days the user prefers for each event.
 * Uses reinforcement learning (multi-armed bandit) to adjust weights over time.
 * Must be loaded after db.js, eventManager.js, attendanceLog.js
 */

const TimeLearner = (function() {
    // ========== PRIVATE STORAGE ==========
    // We'll store preferences in learningData store with type 'timePreference'
    // Structure: { eventId, hour, dayOfWeek, weight, count }

    // ========== PRIVATE HELPERS ==========
    async function loadPreferences() {
        const all = await getAll(STORES.LEARNING_DATA);
        return all.filter(l => l.type === 'timePreference');
    }

    async function savePreference(eventId, hour, dayOfWeek, weight, count) {
        // Find existing or create new
        const all = await loadPreferences();
        const existing = all.find(p => p.eventId === eventId && p.hour === hour && p.dayOfWeek === dayOfWeek);
        if (existing) {
            existing.weight = weight;
            existing.count = count;
            existing.lastUpdated = new Date().toISOString();
            await putRecord(STORES.LEARNING_DATA, existing);
        } else {
            const newPref = {
                type: 'timePreference',
                eventId,
                hour,
                dayOfWeek,
                weight,
                count,
                lastUpdated: new Date().toISOString()
            };
            await addRecord(STORES.LEARNING_DATA, newPref);
        }
        // Refresh global learningData
        const allLearning = await getAll(STORES.LEARNING_DATA);
        learningData.preferredTimeSlots = {};
        const preferred = allLearning.filter(l => l.type === 'preferredTime');
        for (const p of preferred) {
            if (!learningData.preferredTimeSlots[p.eventId]) learningData.preferredTimeSlots[p.eventId] = {};
            const key = `${p.hour}:${p.minute}`;
            learningData.preferredTimeSlots[p.eventId][key] = (learningData.preferredTimeSlots[p.eventId][key] || 0) + (p.weight || 1);
        }
        // Also update time preferences into the same structure for compatibility
        const timePrefs = allLearning.filter(l => l.type === 'timePreference');
        for (const tp of timePrefs) {
            if (!learningData.preferredTimeSlots[tp.eventId]) learningData.preferredTimeSlots[tp.eventId] = {};
            const key = `${tp.hour}:0`; // minute not stored, default to 0
            learningData.preferredTimeSlots[tp.eventId][key] = (learningData.preferredTimeSlots[tp.eventId][key] || 0) + tp.weight;
        }
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Record a positive or negative feedback for an event at a specific time.
         * @param {number} eventId
         * @param {number} hour (0-23)
         * @param {number} dayOfWeek (0-6, 0=Sunday)
         * @param {number} delta - positive (like) or negative (dislike) adjustment.
         */
        async recordFeedback(eventId, hour, dayOfWeek, delta) {
            const prefs = await loadPreferences();
            const existing = prefs.find(p => p.eventId === eventId && p.hour === hour && p.dayOfWeek === dayOfWeek);
            let weight = existing ? existing.weight : 0;
            let count = existing ? existing.count : 0;
            weight += delta;
            count++;
            // Keep weight within reasonable bounds (-50 to +200)
            weight = Math.min(200, Math.max(-50, weight));
            await savePreference(eventId, hour, dayOfWeek, weight, count);
        },

        /**
         * Record an implicit positive feedback (user accepted an event at this time).
         * @param {number} eventId
         * @param {number} hour
         * @param {number} dayOfWeek
         */
        async acceptTime(eventId, hour, dayOfWeek) {
            await this.recordFeedback(eventId, hour, dayOfWeek, 5);
        },

        /**
         * Record an implicit negative feedback (user rejected or moved event).
         * @param {number} eventId
         * @param {number} hour
         * @param {number} dayOfWeek
         */
        async rejectTime(eventId, hour, dayOfWeek) {
            await this.recordFeedback(eventId, hour, dayOfWeek, -10);
        },

        /**
         * Get the weight for a specific event at a specific time.
         * @param {number} eventId
         * @param {number} hour
         * @param {number} dayOfWeek
         * @returns {Promise<number>}
         */
        async getWeight(eventId, hour, dayOfWeek) {
            const prefs = await loadPreferences();
            const existing = prefs.find(p => p.eventId === eventId && p.hour === hour && p.dayOfWeek === dayOfWeek);
            return existing ? existing.weight : 0;
        },

        /**
         * Get the best time slot for an event (highest weight).
         * @param {number} eventId
         * @returns {Promise<{hour: number, dayOfWeek: number, weight: number}|null>}
         */
        async getBestTime(eventId) {
            const prefs = await loadPreferences();
            const eventPrefs = prefs.filter(p => p.eventId === eventId);
            if (eventPrefs.length === 0) return null;
            let best = eventPrefs[0];
            for (const p of eventPrefs) {
                if (p.weight > best.weight) best = p;
            }
            return { hour: best.hour, dayOfWeek: best.dayOfWeek, weight: best.weight };
        },

        /**
         * Apply learning from attendance log (when user marks event as attended).
         * This increases weight for the time slot of that occurrence.
         * @param {number} eventId
         * @param {string} dateStr
         */
        async learnFromAttendance(eventId, dateStr) {
            const date = new Date(dateStr + 'T12:00:00');
            const hour = date.getHours();
            const dayOfWeek = date.getDay();
            await this.acceptTime(eventId, hour, dayOfWeek);
        },

        /**
         * Apply learning from manual override (user moved event to different time).
         * Increases weight for new time, decreases for old time.
         * @param {number} eventId
         * @param {string} oldDateStr
         * @param {string} newDateStr
         */
        async learnFromMove(eventId, oldDateStr, newDateStr) {
            const oldDate = new Date(oldDateStr + 'T12:00:00');
            const newDate = new Date(newDateStr + 'T12:00:00');
            const oldHour = oldDate.getHours();
            const oldDay = oldDate.getDay();
            const newHour = newDate.getHours();
            const newDay = newDate.getDay();
            await this.rejectTime(eventId, oldHour, oldDay);
            await this.acceptTime(eventId, newHour, newDay);
        }
    };
})();

// Make globally available
window.TimeLearner = TimeLearner;