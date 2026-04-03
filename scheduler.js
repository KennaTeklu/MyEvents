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
        let eventsToSchedule = [...events];
        
        // --- SMART TODO INJECTION ---
        // Inject high-priority incomplete todos as flexible 30-min events
        const highPrioTodos = todos.filter(t => !t.completed && t.priority >= 4);
        highPrioTodos.forEach(todo => {
            eventsToSchedule.push({
                id: `todo_${todo.id}`, // Unique ID prefix
                name: `📝 ${todo.name}`,
                openTime: "08:00",
                closeTime: "21:00",
                minStay: 30,
                maxStay: 30,
                priority: todo.priority,
                color: "#10b981", // Success green for todos
                repeat: "none",
                startDate: todo.dueDate || formatDate(new Date()),
                isTodo: true
            });
        });

        const startStr = formatDate(startDate);
        const endStr = formatDate(endDate);

        if (incremental && affectedEventId) {
            const target = events.find(e => e.id === affectedEventId);
            if (!target) return [];
            const mid = new Date(target.startDate);
            startDate = new Date(mid);
            startDate.setDate(mid.getDate() - 2);
            endDate = new Date(mid);
            endDate.setDate(mid.getDate() + 2);
            eventsToSchedule = events.filter(e => EventManager.getOccurrences(e, startDate, endDate).length > 0);
        }

        const allSlots = [];
        
        // 1. Load normal occurrences
        for (const event of eventsToSchedule) {
            const occurrences = EventManager.getOccurrences(event, startDate, endDate);
            for (const occDate of occurrences) {
                const dateStr = formatDate(occDate);
                if (isSkipped(event.id, dateStr)) continue;
                if (isLocked(event.id, dateStr)) {
                    allSlots.push({
                        eventId: event.id, eventObj: event, dateStr,
                        startMin: toMinutes(event.startTime), endMin: toMinutes(event.endTime),
                        duration: toMinutes(event.endTime) - toMinutes(event.startTime),
                        isLocked: true, score: Infinity
                    });
                    continue;
                }
                const slots = generateSlotsForOccurrence(event, dateStr);
                for (const slot of slots) {
                    allSlots.push({
                        eventId: event.id, eventObj: event, dateStr: slot.dateStr,
                        startMin: slot.startMin, endMin: slot.endMin, duration: slot.duration,
                        isLocked: false, score: scoreSlot(event, slot, 0, 0, 0)
                    });
                }
            }
        }

        // 2. FIX: Inject Drag-and-Drop Exceptions so they don't vanish!
        for (const ov of overrides.values()) {
            if (ov.type === 'exception' && ov.dateStr >= startStr && ov.dateStr <= endStr) {
                // Remove any generated slots for this master event on this date to prevent duplicates
                for (let i = allSlots.length - 1; i >= 0; i--) {
                    if (allSlots[i].eventId === ov.eventId && allSlots[i].dateStr === ov.dateStr) allSlots.splice(i, 1);
                }
                const masterEvent = events.find(e => e.id === ov.eventId);
                if (masterEvent) {
                    allSlots.push({
                        eventId: masterEvent.id, eventObj: { ...masterEvent, ...ov.newEvent }, dateStr: ov.dateStr,
                        startMin: toMinutes(ov.newEvent.startTime), endMin: toMinutes(ov.newEvent.endTime),
                        duration: toMinutes(ov.newEvent.endTime) - toMinutes(ov.newEvent.startTime),
                        isLocked: true, score: Infinity // Exceptions act as locked
                    });
                }
            }
        }

        allSlots.sort((a, b) => b.score - a.score); // Highest priority processed first
        const assigned = [];
        const frequencyCounts = new Map();

        // 3. FIX: Chronological Greedy Assignment
        for (const slot of allSlots) {
            if (assigned.some(a => a.eventId === slot.eventId && a.dateStr === slot.dateStr)) continue;

            const event = slot.eventObj;
            if (isSlotBlocked(slot.dateStr, slot.startMin, slot.endMin, event.priority)) continue;

            const sameDayAssigned = assigned.filter(a => a.dateStr === slot.dateStr);
            
            // Check direct overlap
            let overlap = false;
            for (const other of sameDayAssigned) {
                if (slot.startMin < other.endMin && slot.endMin > other.startMin) { overlap = true; break; }
            }
            if (overlap) continue;

            // Find chronologically adjacent events to accurately calculate travel & rest limits
            let prevEvent = null, nextEvent = null;
            for (const other of sameDayAssigned) {
                if (other.endMin <= slot.startMin && (!prevEvent || other.endMin > prevEvent.endMin)) prevEvent = other;
                if (other.startMin >= slot.endMin && (!nextEvent || other.startMin < nextEvent.startMin)) nextEvent = other;
            }

            let travelMinsFromPrev = 0, restMinsFromPrev = 0, travelMinsToNext = 0;
            
            if (prevEvent) {
                // Handle To-do virtual IDs vs real Event IDs
                const prevObj = prevEvent.eventId.toString().startsWith('todo_') 
                    ? eventsToSchedule.find(e => e.id === prevEvent.eventId)
                    : events.find(e => e.id === prevEvent.eventId);
                
                travelMinsFromPrev = await getTravelTimeBetweenEvents(prevObj, prevEvent.dateStr, event, slot.dateStr);
                restMinsFromPrev = getRestMinutes(event, travelMinsFromPrev, restPolicy, farMinutes);
                if (slot.startMin < prevEvent.endMin + travelMinsFromPrev + restMinsFromPrev) continue; // Cannot fit after previous!
            }
            if (nextEvent) {
                travelMinsToNext = await getTravelTimeBetweenEvents(event, slot.dateStr, events.find(e=>e.id===nextEvent.eventId), nextEvent.dateStr);
                if (slot.endMin + travelMinsToNext > nextEvent.startMin) continue; // Cannot fit before next!
            }

            assigned.push({
                eventId: event.id, eventName: event.name, dateStr: slot.dateStr,
                startMin: slot.startMin, endMin: slot.endMin, duration: slot.duration,
                color: event.color, priority: event.priority,
                travelTimeFromPrev: travelMinsFromPrev, restTimeAfterPrev: restMinsFromPrev,
                isScheduled: true
            });
        }

        // 4. FIX: Timezone-safe Incremental Wipeout
        if (!incremental) {
            await clearStore(STORES.SCHEDULED_EVENTS);
        } else {
            const existing = await getAll(STORES.SCHEDULED_EVENTS);
            const toKeep = existing.filter(se => se.dateStr < startStr || se.dateStr > endStr);
            await clearStore(STORES.SCHEDULED_EVENTS);
            for (const keep of toKeep) await addRecord(STORES.SCHEDULED_EVENTS, keep);
        }
        
        for (const se of assigned) await addRecord(STORES.SCHEDULED_EVENTS, se);

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