/*
 * whatIfRoom.js – Allows users to test hypothetical changes before committing.
 * Creates a shadow copy of relevant stores, runs the scheduler, and shows a diff.
 * Must be loaded after scheduler.js, eventManager.js, busyManager.js, todoManager.js
 */

const WhatIfRoom = (function() {
    // ========== PRIVATE VARIABLES ==========
    let shadowStores = null; // in-memory shadow copy

    // ========== PRIVATE HELPERS ==========
    async function createShadowCopy() {
        // Fetch current state from IndexedDB
        const shadow = {
            events: await getAll(STORES.EVENTS),
            busyBlocks: await getAll(STORES.BUSY_BLOCKS),
            places: await getAll(STORES.PLACES),
            overrides: await getAll(STORES.OVERRIDES),
            todos: await getAll(STORES.TODOS),
            scheduledEvents: await getAll(STORES.SCHEDULED_EVENTS)
        };
        return shadow;
    }

    async function applyChangeToShadow(shadow, change) {
        // change: { type, data }
        // type: 'addEvent', 'editEvent', 'deleteEvent', 'addBusy', 'editBusy', 'deleteBusy', 'addTodo', etc.
        const { type, data } = change;
        if (type === 'addEvent') {
            const newEvent = { ...data, id: Math.max(...shadow.events.map(e => e.id), 0) + 1 };
            shadow.events.push(newEvent);
        } else if (type === 'editEvent') {
            const idx = shadow.events.findIndex(e => e.id === data.id);
            if (idx !== -1) shadow.events[idx] = { ...shadow.events[idx], ...data };
        } else if (type === 'deleteEvent') {
            shadow.events = shadow.events.filter(e => e.id !== data.id);
        } else if (type === 'addBusy') {
            const newBusy = { ...data, id: Math.max(...shadow.busyBlocks.map(b => b.id), 0) + 1 };
            shadow.busyBlocks.push(newBusy);
        } else if (type === 'editBusy') {
            const idx = shadow.busyBlocks.findIndex(b => b.id === data.id);
            if (idx !== -1) shadow.busyBlocks[idx] = { ...shadow.busyBlocks[idx], ...data };
        } else if (type === 'deleteBusy') {
            shadow.busyBlocks = shadow.busyBlocks.filter(b => b.id !== data.id);
        } else if (type === 'addTodo') {
            const newTodo = { ...data, id: Math.max(...shadow.todos.map(t => t.id), 0) + 1 };
            shadow.todos.push(newTodo);
        }
        return shadow;
    }

    function computeDiff(originalScheduled, newScheduled) {
        // Find added, removed, modified events
        const added = newScheduled.filter(ns => !originalScheduled.some(os => os.id === ns.id && os.dateStr === ns.dateStr && os.startMin === ns.startMin));
        const removed = originalScheduled.filter(os => !newScheduled.some(ns => ns.id === os.id && ns.dateStr === os.dateStr && ns.startMin === os.startMin));
        const modified = [];
        for (const ns of newScheduled) {
            const os = originalScheduled.find(o => o.id === ns.id && o.dateStr === ns.dateStr);
            if (os && (os.startMin !== ns.startMin || os.endMin !== ns.endMin)) {
                modified.push({ old: os, new: ns });
            }
        }
        return { added, removed, modified };
    }

    async function runSchedulerOnShadow(shadow, startDate, endDate) {
        // Temporarily replace global arrays with shadow
        const originalEvents = events;
        const originalBusyBlocks = busyBlocks;
        const originalPlaces = places;
        const originalOverrides = overrides;
        const originalTodos = todos;
        const originalScheduledEvents = scheduledEvents;
        
        events = shadow.events;
        busyBlocks = shadow.busyBlocks;
        places = shadow.places;
        overrides = new Map(shadow.overrides.map(o => [o.compositeKey, o]));
        todos = shadow.todos;
        scheduledEvents = shadow.scheduledEvents;
        
        // Run scheduler (full run on the shadow data)
        let result = [];
        if (typeof Scheduler !== 'undefined' && Scheduler.scheduleFull) {
            result = await Scheduler.scheduleFull(startDate, endDate);
        } else {
            // Fallback: use the existing run method (which writes to stores, but we'll capture)
            // This is messy – we'll implement a simple scheduler run that returns schedule without persisting
            result = await runTemporaryScheduler(shadow, startDate, endDate);
        }
        
        // Restore globals
        events = originalEvents;
        busyBlocks = originalBusyBlocks;
        places = originalPlaces;
        overrides = originalOverrides;
        todos = originalTodos;
        scheduledEvents = originalScheduledEvents;
        
        return result;
    }

    async function runTemporaryScheduler(shadow, startDate, endDate) {
        // Simplified scheduler for shadow – returns scheduled events
        // For full complexity, we'd need to copy scheduler logic. Here we'll approximate.
        // In a real implementation, you'd extract the scheduling engine to a pure function.
        // For now, we'll just return a copy of shadow.scheduledEvents (but that's not re-run)
        // This is a placeholder – the full implementation would require refactoring scheduler.js
        // to expose a `generateSchedule(data, start, end)` function.
        console.warn('WhatIfRoom: Full scheduler simulation not yet implemented; returning existing schedule.');
        return shadow.scheduledEvents;
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Run a what‑if scenario.
         * @param {Object} change - { type, data } describing the hypothetical change.
         * @param {Date} startDate - Planning start.
         * @param {Date} endDate - Planning end.
         * @returns {Promise<Object>} Diff object with added, removed, modified events.
         */
        async simulate(change, startDate = new Date(), endDate = null) {
            if (!endDate) {
                endDate = new Date();
                endDate.setDate(endDate.getDate() + (planningHorizonWeeks || 4) * 7);
            }
            // Create shadow copy of current state
            let shadow = await createShadowCopy();
            // Apply the hypothetical change
            shadow = await applyChangeToShadow(shadow, change);
            // Store original scheduled events for diff
            const originalScheduled = [...shadow.scheduledEvents];
            // Run scheduler on shadow
            const newScheduled = await runSchedulerOnShadow(shadow, startDate, endDate);
            // Compute diff
            const diff = computeDiff(originalScheduled, newScheduled);
            return diff;
        },

        /**
         * Generate a human-readable summary of the diff for chat.
         * @param {Object} diff
         * @returns {string}
         */
        formatDiffForChat(diff) {
            const parts = [];
            if (diff.added.length) {
                parts.push(`➕ Added ${diff.added.length} event(s): ${diff.added.map(e => e.eventName || e.name).join(', ')}`);
            }
            if (diff.removed.length) {
                parts.push(`➖ Removed ${diff.removed.length} event(s): ${diff.removed.map(e => e.eventName || e.name).join(', ')}`);
            }
            if (diff.modified.length) {
                parts.push(`🔄 Modified ${diff.modified.length} event(s): ${diff.modified.map(m => `${m.old.eventName || m.old.name} from ${formatTime(m.old.startMin)} to ${formatTime(m.new.startMin)}`).join(', ')}`);
            }
            if (parts.length === 0) {
                return 'No changes to your schedule.';
            }
            return parts.join('\n');
        }
    };
})();

// Make globally available
window.WhatIfRoom = WhatIfRoom;