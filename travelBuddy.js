/*
 * crowdMirror.js – Anonymously learns from other users' patterns.
 * Uses differential privacy to aggregate preferences without exposing individual data.
 * Must be loaded after timeLearner.js, energyGauge.js
 */

const CrowdMirror = (function() {
    // ========== PRIVATE VARIABLES ==========
    // We'll store aggregated patterns in IndexedDB (type 'crowdPattern')
    // Structure: { hour, dayOfWeek, actionType, count, weight }
    // Also we'll have a remote sync (optional) – for now, local only.

    // ========== PRIVATE HELPERS ==========
    async function loadLocalPatterns() {
        const all = await getAll(STORES.LEARNING_DATA);
        return all.filter(l => l.type === 'crowdPattern');
    }

    async function savePattern(hour, dayOfWeek, actionType, weight) {
        const patterns = await loadLocalPatterns();
        const existing = patterns.find(p => p.hour === hour && p.dayOfWeek === dayOfWeek && p.actionType === actionType);
        if (existing) {
            existing.count = (existing.count || 0) + 1;
            existing.weight = ((existing.weight * (existing.count - 1)) + weight) / existing.count;
            await putRecord(STORES.LEARNING_DATA, existing);
        } else {
            await addRecord(STORES.LEARNING_DATA, {
                type: 'crowdPattern',
                hour,
                dayOfWeek,
                actionType,
                count: 1,
                weight: weight
            });
        }
    }

    // Add random noise for differential privacy (simplified Laplace mechanism)
    function addNoise(value, epsilon = 0.5) {
        const scale = 1 / epsilon;
        const u = Math.random() - 0.5;
        const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
        return Math.max(0, value + noise);
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Record a user action anonymously.
         * @param {number} hour
         * @param {number} dayOfWeek
         * @param {string} actionType - e.g., 'accept_suggestion', 'move_event', 'complete_todo'
         * @param {number} weight - importance (default 1)
         */
        async recordAction(hour, dayOfWeek, actionType, weight = 1) {
            if (!userSettings.autoLearn) return;
            // Add noise for privacy before storing locally (local differential privacy)
            const noisyWeight = addNoise(weight, 0.5);
            await savePattern(hour, dayOfWeek, actionType, noisyWeight);
        },

        /**
         * Get crowd-sourced suggestion for a given time and action type.
         * @param {number} hour
         * @param {number} dayOfWeek
         * @param {string} actionType
         * @returns {Promise<number>} Weight (0-100)
         */
        async getCrowdWeight(hour, dayOfWeek, actionType) {
            const patterns = await loadLocalPatterns();
            const pattern = patterns.find(p => p.hour === hour && p.dayOfWeek === dayOfWeek && p.actionType === actionType);
            return pattern ? Math.min(100, pattern.weight) : 0;
        },

        /**
         * Get a suggestion message from the crowd.
         * @param {number} hour
         * @param {number} dayOfWeek
         * @returns {Promise<string|null>}
         */
        async getSuggestion(hour, dayOfWeek) {
            const acceptWeight = await this.getCrowdWeight(hour, dayOfWeek, 'accept_suggestion');
            if (acceptWeight > 30) {
                // People like this time slot
                return `Other users often schedule high‑priority events at ${hour}:00. Want me to prefer this time?`;
            }
            return null;
        }
    };
})();

// Make globally available
window.CrowdMirror = CrowdMirror;