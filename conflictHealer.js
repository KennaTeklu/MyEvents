/*
 * conflictHealer.js – Automatically resolves scheduling conflicts by moving lower‑priority events.
 * Uses the scheduler to find alternative slots and applies overrides.
 * Must be loaded after scheduler.js, eventManager.js, busyManager.js
 */

const ConflictHealer = (function() {
    // ========== PRIVATE HELPERS ==========
    async function findAlternativeSlot(event, dateStr, preferredStartMin = null, preferredEndMin = null) {
        // Generate possible slots for this event on the given date
        const openMin = toMinutes(event.openTime);
        const closeMin = toMinutes(event.closeTime);
        const minStay = event.minStay;
        const maxStay = event.maxStay;
        const slots = [];
        for (let start = openMin; start <= closeMin - minStay; start += TIME_SLOT_INTERVAL) {
            for (let duration = minStay; duration <= maxStay; duration += TIME_SLOT_INTERVAL) {
                const end = start + duration;
                if (end > closeMin) break;
                slots.push({ startMin: start, endMin: end, duration });
            }
        }
        // Filter slots that conflict with busy blocks
        const dayBusy = BusyManager.getBusyBlocksForDate(dateStr);
        const validSlots = slots.filter(slot => {
            for (const busy of dayBusy) {
                const busyStart = toMinutes(busy.startTime);
                const busyEnd = toMinutes(busy.endTime);
                if (slot.startMin < busyEnd && slot.endMin > busyStart) {
                    if (busy.hard) return false;
                    if (event.priority < 4) return false;
                }
            }
            return true;
        });
        if (validSlots.length === 0) return null;
        // Sort by closeness to preferred time (if given) or by earliest
        if (preferredStartMin !== null) {
            validSlots.sort((a, b) => Math.abs(a.startMin - preferredStartMin) - Math.abs(b.startMin - preferredStartMin));
        } else {
            validSlots.sort((a, b) => a.startMin - b.startMin);
        }
        return validSlots[0];
    }

    async function resolveEventConflict(event, dateStr, conflictingBusyOrEvent) {
        const alternative = await findAlternativeSlot(event, dateStr, toMinutes(event.startTime));
        if (!alternative) return false;
        // Apply override to move the event
        const override = {
            compositeKey: `${event.id}_${dateStr}`,
            eventId: event.id,
            dateStr: dateStr,
            type: 'exception',
            newEvent: {
                ...event,
                startTime: fromMinutes(alternative.startMin),
                endTime: fromMinutes(alternative.endMin),
                startDate: dateStr
            }
        };
        await putRecord(STORES.OVERRIDES, override);
        overrides.set(override.compositeKey, override);
        return true;
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Check for conflicts and resolve them automatically.
         * @param {string} dateStr - Optional date to limit scope.
         * @returns {Promise<number>} Number of conflicts resolved.
         */
        async healConflicts(dateStr = null) {
            let resolved = 0;
            const start = dateStr ? new Date(dateStr + 'T12:00:00') : new Date(currentDate);
            let end = dateStr ? new Date(dateStr + 'T12:00:00') : new Date(currentDate);
            if (!dateStr) {
                if (currentView === 'week') {
                    const startOfWeek = new Date(currentDate);
                    startOfWeek.setDate(currentDate.getDate() - ((currentDate.getDay() - firstDayOfWeek + 7) % 7));
                    start.setTime(startOfWeek.getTime());
                    end.setTime(startOfWeek.getTime() + 7 * 86400000);
                } else {
                    start.setDate(1);
                    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
                }
            }
            let cur = new Date(start);
            while (cur <= end) {
                const curDateStr = formatDate(cur);
                const dayEvents = getDisplayEventsForDate(curDateStr);
                const dayBusy = BusyManager.getBusyBlocksForDate(curDateStr);
                // Check busy conflicts
                for (const ev of dayEvents) {
                    const evStart = toMinutes(ev.startTime);
                    const evEnd = toMinutes(ev.endTime);
                    for (const busy of dayBusy) {
                        const busyStart = toMinutes(busy.startTime);
                        const busyEnd = toMinutes(busy.endTime);
                        if (evStart < busyEnd && evEnd > busyStart) {
                            // Conflict found – try to move the event
                            const success = await resolveEventConflict(ev, curDateStr, busy);
                            if (success) resolved++;
                            break;
                        }
                    }
                }
                cur.setDate(cur.getDate() + 1);
            }
            if (resolved > 0) {
                await ConversationLog.addMessage('assistant', `Resolved ${resolved} conflict(s) automatically.`, 'system');
                if (typeof runOptimizer === 'function') runOptimizer();
            }
            return resolved;
        },

        /**
         * Attempt to resolve a single specific conflict.
         * @param {Object} event
         * @param {string} dateStr
         * @returns {Promise<boolean>}
         */
        async resolveOne(event, dateStr) {
            return await resolveEventConflict(event, dateStr);
        }
    };
})();

// Make globally available
window.ConflictHealer = ConflictHealer;