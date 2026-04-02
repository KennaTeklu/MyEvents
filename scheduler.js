/*
 * scheduler.js – Constraint solver with incremental rescheduling
 * Must be loaded after state.js, constants.js, eventManager.js, busyManager.js, locationManager.js, userLearning.js
 */

const Scheduler = (function() {
    // ========== PRIVATE VARIABLES ==========
    let lastScheduleHash = null;
    let currentPlanningStart = null;
    let currentPlanningEnd = null;

    // ========== HELPER: GET PLANNING RANGE ==========
    function getPlanningRange(startDate = null, endDate = null) {
        if (startDate && endDate) return { start: startDate, end: endDate };
        const start = new Date();
        const end = new Date();
        end.setDate(end.getDate() + (planningHorizonWeeks || 4) * 7);
        return { start, end };
    }

    // ========== EXISTING HELPER FUNCTIONS (from original) ==========
    function isSlotBlocked(dateStr, startMin, endMin, priority) {
        const blocks = BusyManager.getBusyBlocksForDate(dateStr);
        for (const b of blocks) {
            const bStart = toMinutes(b.startTime);
            const bEnd = toMinutes(b.endTime);
            if (startMin < bEnd && endMin > bStart) {
                if (b.hard) return true;
                if (priority < 4) return true;
            }
        }
        return false;
    }

    function isLocked(eventId, dateStr) {
        const ov = overrides.get(`${eventId}_${dateStr}`);
        return ov && ov.type === 'locked';
    }

    function isSkipped(eventId, dateStr) {
        const ov = overrides.get(`${eventId}_${dateStr}`);
        return ov && ov.type === 'nogo';
    }

    async function getTravelTimeBetweenEvents(prevEvent, prevDateStr, nextEvent, nextDateStr) {
        if (!prevEvent || !nextEvent) return 0;
        const prevPlaceId = prevEvent.placeId || currentPlaceId;
        const nextPlaceId = nextEvent.placeId || currentPlaceId;
        if (prevPlaceId === nextPlaceId) return 0;
        return await LocationManager.getTravelTime(prevPlaceId, nextPlaceId);
    }

    function getRestMinutes(event, nextEventTravelMins, restPolicy, farMinutes) {
        if (restPolicy === 'home') return 15;
        if (restPolicy === 'far') return nextEventTravelMins > farMinutes ? 15 : 0;
        return 0;
    }

    function generateSlotsForOccurrence(event, dateStr) {
        const openMin = toMinutes(event.openTime);
        const closeMin = toMinutes(event.closeTime);
        const minStay = event.minStay;
        const maxStay = event.maxStay;
        const slots = [];
        for (let start = openMin; start <= closeMin - minStay; start += TIME_SLOT_INTERVAL) {
            for (let duration = minStay; duration <= maxStay; duration += TIME_SLOT_INTERVAL) {
                const end = start + duration;
                if (end > closeMin) break;
                slots.push({ dateStr, startMin: start, endMin: end, duration });
            }
        }
        return slots;
    }

    function scoreSlot(event, slot, travelTimeFromPrev, travelTimeToNext, restNeededAfterPrev) {
        let score = (event.priority || 3) * 100;
        if (event.scarce) score += 50;
        if (travelTimeFromPrev) score -= travelTimeFromPrev;
        if (travelTimeToNext) score -= travelTimeToNext;
        if (restNeededAfterPrev) score -= restNeededAfterPrev;
        const hour = Math.floor(slot.startMin / 60);
        const minute = slot.startMin % 60;
        const prefScore = UserLearning.getTimePreferenceScore(event.id, hour, minute);
        score += prefScore;
        const recencyBonus = UserLearning.getRecencyBonus(event.id);
        score += recencyBonus;
        if (hour < 6 || hour > 22) score -= 20;
        return score;
    }

    function canFitAfter(prevSlot, currentSlot, travelMins, restMins) {
        if (!prevSlot) return true;
        const requiredStart = prevSlot.endMin + travelMins + restMins;
        return currentSlot.startMin >= requiredStart;
    }

    // ========== CORE SCHEDULING ALGORITHM (Full & Incremental) ==========
    async function schedule(startDate, endDate, incremental = false, affectedEventId = null) {
        // 1. Get all events to schedule (respecting incremental mode)
        let eventsToSchedule = events;
        if (incremental && affectedEventId) {
            // Only consider the affected event plus any events that overlap its date range
            const target = events.find(e => e.id === affectedEventId);
            if (!target) return [];
            // For incremental, we'll just reschedule the whole day(s) around the event
            // Simpler: run full scheduler but limit date range to ±2 days of the event
            const mid = new Date(target.startDate);
            startDate = new Date(mid);
            startDate.setDate(mid.getDate() - 2);
            endDate = new Date(mid);
            endDate.setDate(mid.getDate() + 2);
            eventsToSchedule = events.filter(e => {
                const occ = EventManager.getOccurrences(e, startDate, endDate);
                return occ.length > 0;
            });
        }

        // 2. Generate all slots for all occurrences
        const allSlots = [];
        for (const event of eventsToSchedule) {
            const occurrences = EventManager.getOccurrences(event, startDate, endDate);
            for (const occDate of occurrences) {
                const dateStr = formatDate(occDate);
                if (isSkipped(event.id, dateStr)) continue;
                if (isLocked(event.id, dateStr)) {
                    allSlots.push({
                        eventId: event.id,
                        eventObj: event,
                        dateStr,
                        startMin: toMinutes(event.startTime),
                        endMin: toMinutes(event.endTime),
                        duration: toMinutes(event.endTime) - toMinutes(event.startTime),
                        isLocked: true,
                        score: Infinity
                    });
                    continue;
                }
                const slots = generateSlotsForOccurrence(event, dateStr);
                for (const slot of slots) {
                    allSlots.push({
                        eventId: event.id,
                        eventObj: event,
                        dateStr: slot.dateStr,
                        startMin: slot.startMin,
                        endMin: slot.endMin,
                        duration: slot.duration,
                        isLocked: false,
                        score: 0
                    });
                }
            }
        }

        // Precompute scores (without travel)
        for (const slot of allSlots) {
            if (slot.isLocked) continue;
            slot.score = scoreSlot(slot.eventObj, slot, 0, 0, 0);
        }

        // Sort by score descending
        allSlots.sort((a, b) => b.score - a.score);

        const lastEventPerDay = new Map();
        const assigned = [];
        const frequencyCounts = new Map();

        function getWeekKey(eventId, dateStr) {
            const date = new Date(dateStr + 'T12:00:00');
            const week = getWeekNumber(date);
            return `${eventId}_${date.getFullYear()}_${week}`;
        }
        function getMonthKey(eventId, dateStr) {
            const date = new Date(dateStr + 'T12:00:00');
            return `${eventId}_${date.getFullYear()}_${date.getMonth()}`;
        }

        // Greedy assignment
        for (const slot of allSlots) {
            if (assigned.some(a => a.eventId === slot.eventId && a.dateStr === slot.dateStr)) continue;

            const event = slot.eventObj;
            let freqOk = true;
            if (event.frequency === FREQUENCY.ONCE_PER_WEEK) {
                const key = getWeekKey(event.id, slot.dateStr);
                const count = frequencyCounts.get(key) || 0;
                if (count >= 1) freqOk = false;
            } else if (event.frequency === FREQUENCY.TWICE_PER_WEEK) {
                const key = getWeekKey(event.id, slot.dateStr);
                const count = frequencyCounts.get(key) || 0;
                if (count >= 2) freqOk = false;
            } else if (event.frequency === FREQUENCY.ONCE_PER_MONTH) {
                const key = getMonthKey(event.id, slot.dateStr);
                const count = frequencyCounts.get(key) || 0;
                if (count >= 1) freqOk = false;
            }
            if (!freqOk) continue;

            if (isSlotBlocked(slot.dateStr, slot.startMin, slot.endMin, event.priority)) continue;

            const last = lastEventPerDay.get(slot.dateStr);
            let travelMins = 0, restMins = 0;
            if (last) {
                travelMins = await getTravelTimeBetweenEvents(last.eventObj, last.dateStr, event, slot.dateStr);
                restMins = getRestMinutes(last.eventObj, travelMins, restPolicy, farMinutes);
                if (!canFitAfter(last, slot, travelMins, restMins)) continue;
            }

            const sameDayAssigned = assigned.filter(a => a.dateStr === slot.dateStr);
            let overlap = false;
            for (const other of sameDayAssigned) {
                if (slot.startMin < other.endMin && slot.endMin > other.startMin) {
                    overlap = true;
                    break;
                }
            }
            if (overlap) continue;

            const scheduledEvent = {
                eventId: event.id,
                eventName: event.name,
                dateStr: slot.dateStr,
                startMin: slot.startMin,
                endMin: slot.endMin,
                duration: slot.duration,
                color: event.color,
                priority: event.priority,
                travelTimeFromPrev: travelMins,
                restTimeAfterPrev: restMins,
                isScheduled: true
            };
            assigned.push(scheduledEvent);
            lastEventPerDay.set(slot.dateStr, {
                eventObj: event,
                dateStr: slot.dateStr,
                endMin: slot.endMin,
                travelToNext: travelMins
            });

            if (event.frequency === FREQUENCY.ONCE_PER_WEEK || event.frequency === FREQUENCY.TWICE_PER_WEEK) {
                const key = getWeekKey(event.id, slot.dateStr);
                frequencyCounts.set(key, (frequencyCounts.get(key) || 0) + 1);
            } else if (event.frequency === FREQUENCY.ONCE_PER_MONTH) {
                const key = getMonthKey(event.id, slot.dateStr);
                frequencyCounts.set(key, (frequencyCounts.get(key) || 0) + 1);
            }
        }

        // 3. Persist schedule
        if (!incremental) {
            // Full schedule: replace all scheduledEvents
            await clearStore(STORES.SCHEDULED_EVENTS);
        } else {
            // Incremental: only remove scheduled events for the affected date range
            const existing = await getAll(STORES.SCHEDULED_EVENTS);
            const toKeep = existing.filter(se => {
                const seDate = new Date(se.dateStr);
                return seDate < startDate || seDate > endDate;
            });
            await clearStore(STORES.SCHEDULED_EVENTS);
            for (const keep of toKeep) {
                await addRecord(STORES.SCHEDULED_EVENTS, keep);
            }
        }
        for (const se of assigned) {
            await addRecord(STORES.SCHEDULED_EVENTS, se);
        }

        // Refresh global array
        const fresh = await getAll(STORES.SCHEDULED_EVENTS);
        scheduledEvents.length = 0;
        scheduledEvents.push(...fresh);
        return assigned;
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Full schedule run for the planning horizon.
         */
        async run() {
            const { start, end } = getPlanningRange();
            const result = await schedule(start, end, false);
            if (result.length > 0) {
                showToast(`Scheduled ${result.length} events`, 'success');
            }
            return result;
        },

        /**
         * Incremental schedule for a specific date range and affected event.
         * @param {Date} startDate - Start of range.
         * @param {Date} endDate - End of range.
         * @param {number} affectedEventId - ID of the event that changed.
         */
        async runIncremental(startDate, endDate, affectedEventId) {
            const result = await schedule(startDate, endDate, true, affectedEventId);
            if (result.length > 0) {
                console.log(`Incremental schedule updated ${result.length} events`);
            }
            // Refresh calendar
            if (typeof renderCalendar === 'function') renderCalendar();
            return result;
        },

        /**
         * Clear the current schedule (remove all scheduled events).
         */
        async clearSchedule() {
            await clearStore(STORES.SCHEDULED_EVENTS);
            scheduledEvents.length = 0;
            if (typeof renderCalendar === 'function') renderCalendar();
        }
    };
})();

// Make Scheduler globally available
window.Scheduler = Scheduler;