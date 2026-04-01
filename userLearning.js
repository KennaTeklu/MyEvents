/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2025 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// userLearning.js - Learning engine for user behavior
// Tracks actual event durations, travel times, preferences, and preferred time slots.
// Must be loaded after db.js, constants.js, and state.js (for learningData, events, places)

const UserLearning = (function() {
    // ========== PRIVATE HELPERS ==========
    
    // Refresh learningData from DB (kept in sync by state, but we might need to update after recording)
    async function refreshLearningData() {
        const allLearning = await getAll(STORES.LEARNING_DATA);
        learningData.eventDurations = allLearning.filter(l => l.type === 'duration');
        learningData.travelTimes = allLearning.filter(l => l.type === 'travel');
        learningData.preferences = allLearning.filter(l => l.type === 'preference');
        learningData.preferredTimeSlots = {};
        const preferred = allLearning.filter(l => l.type === 'preferredTime');
        for (const p of preferred) {
            if (!learningData.preferredTimeSlots[p.eventId]) learningData.preferredTimeSlots[p.eventId] = {};
            const key = `${p.hour}:${p.minute}`;
            learningData.preferredTimeSlots[p.eventId][key] = (learningData.preferredTimeSlots[p.eventId][key] || 0) + (p.weight || 1);
        }
    }
    
    // Record a learning data entry
    async function recordLearning(entry) {
        if (!userSettings.autoLearn) return;
        await addRecord(STORES.LEARNING_DATA, entry);
        await refreshLearningData();
    }
    
    // ========== PUBLIC API ==========
    return {
        /**
         * Record the actual duration spent at an event.
         * @param {number} eventId
         * @param {string} dateStr - YYYY-MM-DD
         * @param {number} durationMinutes - Actual time spent (positive)
         */
        async recordEventDuration(eventId, dateStr, durationMinutes) {
            if (!userSettings.autoLearn) return;
            await recordLearning({
                type: 'duration',
                eventId,
                date: dateStr,
                duration: durationMinutes,
                timestamp: new Date().toISOString()
            });
        },
        
        /**
         * Record actual travel time between two places.
         * @param {number} fromPlaceId
         * @param {number} toPlaceId
         * @param {number} minutes - Actual travel time
         */
        async recordTravelTime(fromPlaceId, toPlaceId, minutes) {
            if (!userSettings.autoLearn) return;
            await recordLearning({
                type: 'travel',
                fromPlaceId,
                toPlaceId,
                minutes,
                timestamp: new Date().toISOString()
            });
        },
        
        /**
         * Record user preference (like/dislike) for an event on a specific date.
         * @param {number} eventId
         * @param {string} dateStr
         * @param {string} type - 'like' or 'dislike'
         * @param {string} comment - Optional comment
         */
        async recordPreference(eventId, dateStr, type, comment = '') {
            if (!userSettings.autoLearn) return;
            await recordLearning({
                type: 'preference',
                eventId,
                date: dateStr,
                preference: type,
                comment,
                timestamp: new Date().toISOString()
            });
        },
        
        /**
         * Record that the user liked a specific time slot for an event.
         * @param {number} eventId
         * @param {number} hour (0-23)
         * @param {number} minute (0-59)
         * @param {number} weight - Incremental weight (default 1)
         */
        async recordPreferredTime(eventId, hour, minute, weight = 1) {
            if (!userSettings.autoLearn) return;
            await recordLearning({
                type: 'preferredTime',
                eventId,
                hour,
                minute,
                weight,
                timestamp: new Date().toISOString()
            });
        },
        
        /**
         * Get the average actual duration for an event (from past records).
         * @param {number} eventId
         * @returns {number|null} Average duration in minutes, or null if no data.
         */
        getAverageDuration(eventId) {
            const durations = learningData.eventDurations.filter(d => d.eventId === eventId);
            if (durations.length === 0) return null;
            const sum = durations.reduce((acc, d) => acc + d.duration, 0);
            return Math.round(sum / durations.length);
        },
        
        /**
         * Get the average actual travel time between two places.
         * @param {number} fromPlaceId
         * @param {number} toPlaceId
         * @returns {number|null} Average minutes, or null if no data.
         */
        getAverageTravelTime(fromPlaceId, toPlaceId) {
            const travels = learningData.travelTimes.filter(t => 
                (t.fromPlaceId === fromPlaceId && t.toPlaceId === toPlaceId) ||
                (t.fromPlaceId === toPlaceId && t.toPlaceId === fromPlaceId)
            );
            if (travels.length === 0) return null;
            const sum = travels.reduce((acc, t) => acc + t.minutes, 0);
            return Math.round(sum / travels.length);
        },
        
        /**
         * Get the most preferred time slot for an event (by weight).
         * @param {number} eventId
         * @returns {Object|null} { hour, minute, weight } or null.
         */
        getPreferredTimeSlot(eventId) {
            const slots = learningData.preferredTimeSlots[eventId];
            if (!slots) return null;
            let best = null;
            let bestWeight = 0;
            for (const [timeStr, weight] of Object.entries(slots)) {
                if (weight > bestWeight) {
                    bestWeight = weight;
                    const [hour, minute] = timeStr.split(':').map(Number);
                    best = { hour, minute, weight };
                }
            }
            return best;
        },
        
        /**
         * Get a score adjustment for scheduling an event at a given time.
         * Positive score means user likely prefers this time.
         * @param {number} eventId
         * @param {number} hour
         * @param {number} minute
         * @returns {number} Adjustment (positive or zero).
         */
        getTimePreferenceScore(eventId, hour, minute) {
            const slots = learningData.preferredTimeSlots[eventId];
            if (!slots) return 0;
            const key = `${hour}:${minute}`;
            const weight = slots[key] || 0;
            // Scale weight to a reasonable score (e.g., up to 50)
            return Math.min(50, weight * 5);
        },
        
        /**
         * Get recency penalty: events not attended for a while get a boost.
         * For now, simple: if last attendance was > 14 days, add bonus.
         * @param {number} eventId
         * @returns {number} Bonus score (0-20).
         */
        getRecencyBonus(eventId) {
            const attendances = attendanceLog.filter(a => a.eventId === eventId);
            if (attendances.length === 0) return 20; // never attended: high bonus
            const last = new Date(Math.max(...attendances.map(a => new Date(a.timestamp).getTime())));
            const daysSince = (Date.now() - last.getTime()) / (1000 * 3600 * 24);
            if (daysSince > 30) return 20;
            if (daysSince > 14) return 10;
            if (daysSince > 7) return 5;
            return 0;
        },
        
        /**
         * Analyze user behavior and return suggestions for scheduler.
         * This can be used by the optimizer to adjust weights.
         * @param {number} eventId
         * @returns {Object} { preferredHour, durationAdjustment, travelAdjustment, recencyBonus }
         */
        getEventLearningData(eventId) {
            const avgDuration = this.getAverageDuration(eventId);
            const preferredSlot = this.getPreferredTimeSlot(eventId);
            const recencyBonus = this.getRecencyBonus(eventId);
            return {
                preferredHour: preferredSlot ? preferredSlot.hour : null,
                preferredMinute: preferredSlot ? preferredSlot.minute : null,
                durationAdjustment: avgDuration ? (avgDuration - (events.find(e => e.id === eventId)?.minStay || 30)) : 0,
                recencyBonus
            };
        },
        
        /**
         * Clean up old learning data (older than 6 months) to keep database lean.
         * Call periodically or on demand.
         */
        async pruneOldData(olderThanDays = 180) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - olderThanDays);
            const all = await getAll(STORES.LEARNING_DATA);
            const toDelete = all.filter(entry => new Date(entry.timestamp) < cutoff);
            for (const entry of toDelete) {
                await deleteRecord(STORES.LEARNING_DATA, entry.id);
            }
            await refreshLearningData();
        }
    };
})();

// Make UserLearning globally available
window.UserLearning = UserLearning;
