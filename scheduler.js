// scheduler.js - Constraint solver for event scheduling
// Must be loaded after state.js, constants.js, eventManager.js, busyManager.js, locationManager.js, userLearning.js

const Scheduler = (function() {
    // ========== PRIVATE HELPERS ==========
    
    // Check if a time slot conflicts with any busy block
    function isSlotBlocked(dateStr, startMin, endMin, priority) {
        const blocks = BusyManager.getBusyBlocksForDate(dateStr);
        for (const b of blocks) {
            const bStart = toMinutes(b.startTime);
            const bEnd = toMinutes(b.endTime);
            if (startMin < bEnd && endMin > bStart) {
                // Hard blocks always block; soft blocks can be overlapped by high priority events (>=4)
                if (b.hard) return true;
                if (priority < 4) return true; // priority 1-3 cannot overlap soft blocks
                // priority 4-5 can overlap soft blocks
            }
        }
        return false;
    }
    
    // Check if an event is locked on a specific date (cannot be moved)
    function isLocked(eventId, dateStr) {
        const ov = overrides.get(`${eventId}_${dateStr}`);
        return ov && ov.type === 'locked';
    }
    
    // Check if an event is skipped on a specific date
    function isSkipped(eventId, dateStr) {
        const ov = overrides.get(`${eventId}_${dateStr}`);
        return ov && ov.type === 'nogo';
    }
    
    // Get travel time between events (using LocationManager)
    async function getTravelTimeBetweenEvents(prevEvent, prevDateStr, nextEvent, nextDateStr) {
        if (!prevEvent || !nextEvent) return 0;
        // If same day and consecutive, need travel time from prev place to next place
        // For now, assume each event has a placeId; if not, use currentPlaceId or home.
        const prevPlaceId = prevEvent.placeId || currentPlaceId;
        const nextPlaceId = nextEvent.placeId || currentPlaceId;
        if (prevPlaceId === nextPlaceId) return 0;
        return await LocationManager.getTravelTime(prevPlaceId, nextPlaceId);
    }
    
    // Determine if a rest period is needed after an event
    function getRestMinutes(event, nextEventTravelMins, restPolicy, farMinutes) {
        if (restPolicy === 'home') return 15;
        if (restPolicy === 'far') {
            // If travel time to next event (plus rest) is far, we need to return home? Actually rest policy:
            // "Only if the next event is far" means we need to go home if distance > farMinutes.
            // But "far" is defined by travel time? The setting "farMinutes" is walk time threshold.
            // So if travelMins > farMinutes, we rest at home (15 min). Otherwise, no rest.
            return nextEventTravelMins > farMinutes ? 15 : 0;
        }
        return 0;
    }
    
    // Generate all possible slots for an event occurrence
    function generateSlotsForOccurrence(event, dateStr) {
        const openMin = toMinutes(event.openTime);
        const closeMin = toMinutes(event.closeTime);
        const minStay = event.minStay;
        const maxStay = event.maxStay;
        const slots = [];
        
        // Start times at 15-min intervals
        for (let start = openMin; start <= closeMin - minStay; start += TIME_SLOT_INTERVAL) {
            // Durations in 15-min steps between minStay and maxStay
            for (let duration = minStay; duration <= maxStay; duration += TIME_SLOT_INTERVAL) {
                const end = start + duration;
                if (end > closeMin) break;
                slots.push({
                    dateStr,
                    startMin: start,
                    endMin: end,
                    duration: duration
                });
            }
        }
        return slots;
    }
    
    // Score a slot for an event, considering various factors
    function scoreSlot(event, slot, travelTimeFromPrev, travelTimeToNext, restNeededAfterPrev) {
        let score = 0;
        
        // Base: priority * 100
        score += (event.priority || 3) * 100;
        
        // Scarcity: if event has few possible slots (scarce flag), add bonus
        // We'll compute scarcity later; for now, add fixed bonus if scarce flag set
        if (event.scarce) score += 50;
        
        // Travel time penalty: longer travel reduces score
        if (travelTimeFromPrev) score -= travelTimeFromPrev;
        if (travelTimeToNext) score -= travelTimeToNext;
        
        // Rest time penalty: rest time is "wasted", reduce score
        if (restNeededAfterPrev) score -= restNeededAfterPrev;
        
        // User preference for time of day (from learning)
        const hour = Math.floor(slot.startMin / 60);
        const minute = slot.startMin % 60;
        const prefScore = UserLearning.getTimePreferenceScore(event.id, hour, minute);
        score += prefScore;
        
        // Recency bonus: if event not attended for a while, boost
        const recencyBonus = UserLearning.getRecencyBonus(event.id);
        score += recencyBonus;
        
        // Avoid scheduling very early or very late? Not needed, but can add penalty for hours outside preferred range.
        if (hour < 6 || hour > 22) score -= 20;
        
        return score;
    }
    
    // Check if a slot fits after a previous event (travel + rest constraints)
    function canFitAfter(prevSlot, currentSlot, travelMins, restMins) {
        if (!prevSlot) return true;
        // Current slot must start after prev ends + travel + rest
        const requiredStart = prevSlot.endMin + travelMins + restMins;
        return currentSlot.startMin >= requiredStart;
    }
    
    // ========== MAIN SCHEDULING ALGORITHM ==========
    
    /**
     * Generate an optimized schedule for the planning horizon.
     * @param {Date} startDate - Start of planning period.
     * @param {Date} endDate - End of planning period.
     * @returns {Promise<Array>} Array of scheduled events.
     */
    async function schedule(startDate, endDate) {
        // 1. Prepare all potential slots for all event occurrences
        const allSlots = [];
        const eventOccurrences = []; // keep track of which event each slot belongs to
        
        for (const event of events) {
            // Skip if event is locked for all dates? Not needed.
            const occurrences = EventManager.getOccurrences(event, startDate, endDate);
            for (const occDate of occurrences) {
                const dateStr = formatDate(occDate);
                // Skip if this occurrence is marked as nogo (skipped)
                if (isSkipped(event.id, dateStr)) continue;
                // Skip if locked (can't move)
                if (isLocked(event.id, dateStr)) {
                    // This event is locked, we should schedule it at its existing time (from event data? Actually locked means it's fixed but may have a startTime; we need to add a slot with that exact time)
                    const startMin = toMinutes(event.startTime);
                    const endMin = toMinutes(event.endTime);
                    allSlots.push({
                        eventId: event.id,
                        eventObj: event,
                        dateStr,
                        startMin,
                        endMin,
                        duration: endMin - startMin,
                        isLocked: true,
                        score: Infinity // locked always gets scheduled
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
                        score: 0 // will compute later
                    });
                }
            }
        }
        
        // 2. Compute score for each slot (needs travel times, which depend on adjacent slots; we'll compute after sorting? This is tricky.
        // For simplicity, we'll compute scores without travel first, then during assignment we'll adjust for travel conflicts.
        // Alternatively, we can precompute scores assuming no previous event (travel=0).
        // We'll use a greedy approach: sort all slots by initial score (no travel), then iterate, checking constraints that depend on previous assignments.
        // This is a heuristic but works for many cases.
        
        // Precompute initial scores (without travel)
        for (const slot of allSlots) {
            if (slot.isLocked) continue;
            slot.score = scoreSlot(slot.eventObj, slot, 0, 0, 0);
        }
        
        // Sort by score descending (higher better)
        allSlots.sort((a, b) => b.score - a.score);
        
        // 3. Track assignments per day for travel/rest constraints
        // We'll keep a map of last event per day: dateStr -> { endMin, travelToNext, eventObj }
        const lastEventPerDay = new Map();
        const assigned = []; // array of scheduled events (objects)
        const frequencyCounts = new Map(); // key: `${eventId}_week_${weekNum}` or `${eventId}_month_${yearMonth}`
        
        // Helper to get week number (ISO)
        function getWeekKey(eventId, dateStr) {
            const date = new Date(dateStr + 'T12:00:00');
            const week = getWeekNumber(date);
            const year = date.getFullYear();
            return `${eventId}_${year}_${week}`;
        }
        
        function getMonthKey(eventId, dateStr) {
            const date = new Date(dateStr + 'T12:00:00');
            const year = date.getFullYear();
            const month = date.getMonth();
            return `${eventId}_${year}_${month}`;
        }
        
        // 4. Greedy assignment
        for (const slot of allSlots) {
            if (assigned.some(a => a.eventId === slot.eventId && a.dateStr === slot.dateStr)) continue;
            
            // Check frequency limits
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
            
            // Check busy block conflict
            if (isSlotBlocked(slot.dateStr, slot.startMin, slot.endMin, event.priority)) continue;
            
            // Check travel/rest constraints with previous event on same day
            const last = lastEventPerDay.get(slot.dateStr);
            let travelMins = 0;
            let restMins = 0;
            if (last) {
                travelMins = await getTravelTimeBetweenEvents(last.eventObj, last.dateStr, event, slot.dateStr);
                restMins = getRestMinutes(last.eventObj, travelMins, restPolicy, farMinutes);
                if (!canFitAfter(last, slot, travelMins, restMins)) continue;
            }
            
            // Check that slot doesn't conflict with other events already assigned on same day (overlap)
            const sameDayAssigned = assigned.filter(a => a.dateStr === slot.dateStr);
            let overlap = false;
            for (const other of sameDayAssigned) {
                if (slot.startMin < other.endMin && slot.endMin > other.startMin) {
                    overlap = true;
                    break;
                }
            }
            if (overlap) continue;
            
            // All checks passed: assign this slot
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
            
            // Update last event for this day
            lastEventPerDay.set(slot.dateStr, {
                eventObj: event,
                dateStr: slot.dateStr,
                endMin: slot.endMin,
                travelToNext: travelMins // will be used for next event
            });
            
            // Update frequency count
            if (event.frequency === FREQUENCY.ONCE_PER_WEEK) {
                const key = getWeekKey(event.id, slot.dateStr);
                frequencyCounts.set(key, (frequencyCounts.get(key) || 0) + 1);
            } else if (event.frequency === FREQUENCY.TWICE_PER_WEEK) {
                const key = getWeekKey(event.id, slot.dateStr);
                frequencyCounts.set(key, (frequencyCounts.get(key) || 0) + 1);
            } else if (event.frequency === FREQUENCY.ONCE_PER_MONTH) {
                const key = getMonthKey(event.id, slot.dateStr);
                frequencyCounts.set(key, (frequencyCounts.get(key) || 0) + 1);
            }
        }
        
        // 5. For locked events, ensure they are included (already added as slots with isLocked=true)
        // They are already in assigned.
        
        // 6. Remove any existing scheduled events from the store and save new ones
        await clearStore(STORES.SCHEDULED_EVENTS);
        for (const se of assigned) {
            await addRecord(STORES.SCHEDULED_EVENTS, se);
        }
        
        // Refresh global scheduledEvents array
        const fresh = await getAll(STORES.SCHEDULED_EVENTS);
        scheduledEvents.length = 0;
        scheduledEvents.push(...fresh);
        
        return assigned;
    }
    
    // ========== PUBLIC API ==========
    return {
        /**
         * Run the optimizer for the current planning horizon.
         * @returns {Promise<Array>} The new scheduled events.
         */
        async run() {
            const start = new Date();
            const end = new Date();
            end.setDate(end.getDate() + (planningHorizonWeeks * 7));
            const result = await schedule(start, end);
            if (result.length > 0) {
                showToast(`Scheduled ${result.length} events`, 'success');
            } else {
                // Optionally show a less intrusive message only if something changed? For now, silent.
                // If you still want to show occasional info, you could check if there were any events to schedule.
                // But to stop spam, we'll only show when there's a change.
                console.log('Scheduler: no events to schedule');
            }
            return result;
        }
    };
})();

// Make Scheduler globally available
window.Scheduler = Scheduler;
