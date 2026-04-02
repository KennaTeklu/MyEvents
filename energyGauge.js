/*
 * energyGauge.js – Learns which hours of the day the user is most productive/focused.
 * Uses historical task completion speed and event acceptance rates to assign energy scores.
 * Must be loaded after db.js, attendanceLog.js, todoManager.js
 */

const EnergyGauge = (function() {
    // ========== PRIVATE STORAGE ==========
    // Energy scores stored in learningData with type 'energyScore'
    // Structure: { hour, score, sampleCount, lastUpdated }

    // ========== PRIVATE HELPERS ==========
    async function loadEnergyScores() {
        const all = await getAll(STORES.LEARNING_DATA);
        return all.filter(l => l.type === 'energyScore');
    }

    async function saveEnergyScore(hour, score, sampleCount) {
        const existingScores = await loadEnergyScores();
        const existing = existingScores.find(s => s.hour === hour);
        if (existing) {
            existing.score = score;
            existing.sampleCount = sampleCount;
            existing.lastUpdated = new Date().toISOString();
            await putRecord(STORES.LEARNING_DATA, existing);
        } else {
            await addRecord(STORES.LEARNING_DATA, {
                type: 'energyScore',
                hour,
                score,
                sampleCount,
                lastUpdated: new Date().toISOString()
            });
        }
    }

    // Update global learningData.energyScores for quick access
    async function refreshGlobalScores() {
        const scores = await loadEnergyScores();
        if (!window.learningData) window.learningData = {};
        window.learningData.energyScores = scores;
    }

    // Calculate score based on task completion speed (compared to estimated duration)
    // Returns a value from 0 (low energy) to 10 (high energy)
    function computeEnergyFromTask(todo, actualMinutes, estimatedMinutes) {
        const ratio = actualMinutes / estimatedMinutes;
        if (ratio <= 0.5) return 10; // twice as fast – very high energy
        if (ratio <= 0.75) return 8;
        if (ratio <= 1.0) return 6;
        if (ratio <= 1.25) return 4;
        if (ratio <= 1.5) return 2;
        return 0; // took too long – low energy
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Record energy level based on a completed to-do or event.
         * @param {number} hour (0-23)
         * @param {number} actualMinutes - Actual time spent
         * @param {number} estimatedMinutes - Planned duration
         */
        async recordTaskCompletion(hour, actualMinutes, estimatedMinutes) {
            const energyScore = computeEnergyFromTask(null, actualMinutes, estimatedMinutes);
            const scores = await loadEnergyScores();
            const existing = scores.find(s => s.hour === hour);
            let newScore, newCount;
            if (existing) {
                // Weighted average: existing score * existing count + new score, then divide by new count
                newCount = existing.sampleCount + 1;
                newScore = (existing.score * existing.sampleCount + energyScore) / newCount;
            } else {
                newCount = 1;
                newScore = energyScore;
            }
            await saveEnergyScore(hour, newScore, newCount);
            await refreshGlobalScores();
        },

        /**
         * Record energy level based on user accepting a suggested event time.
         * Acceptance implies high energy for that hour.
         * @param {number} hour
         */
        async recordAcceptance(hour) {
            const scores = await loadEnergyScores();
            const existing = scores.find(s => s.hour === hour);
            let newScore, newCount;
            const acceptanceScore = 8; // accepting suggestion indicates good energy
            if (existing) {
                newCount = existing.sampleCount + 1;
                newScore = (existing.score * existing.sampleCount + acceptanceScore) / newCount;
            } else {
                newCount = 1;
                newScore = acceptanceScore;
            }
            await saveEnergyScore(hour, newScore, newCount);
            await refreshGlobalScores();
        },

        /**
         * Get energy score for a specific hour.
         * @param {number} hour
         * @returns {Promise<number>} Score from 0 to 10 (default 5 if unknown)
         */
        async getEnergyScore(hour) {
            const scores = await loadEnergyScores();
            const existing = scores.find(s => s.hour === hour);
            return existing ? existing.score : 5;
        },

        /**
         * Get all energy scores (for visualization in settings).
         * @returns {Promise<Array>}
         */
        async getAllScores() {
            return await loadEnergyScores();
        },

        /**
         * Apply energy score bonus to scheduler scoring.
         * This function is meant to be called by the scheduler when scoring a slot.
         * @param {number} hour
         * @returns {Promise<number>} Bonus value (0 to 20) based on energy score
         */
        async getSchedulerBonus(hour) {
            const score = await this.getEnergyScore(hour);
            // Map energy score (0-10) to bonus (0-20)
            return score * 2;
        },

        /**
         * Reset all energy scores (clear learning data).
         */
        async reset() {
            const all = await getAll(STORES.LEARNING_DATA);
            const toDelete = all.filter(l => l.type === 'energyScore');
            for (const entry of toDelete) {
                await deleteRecord(STORES.LEARNING_DATA, entry.id);
            }
            await refreshGlobalScores();
        }
    };
})();

// Make globally available
window.EnergyGauge = EnergyGauge;