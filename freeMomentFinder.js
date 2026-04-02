/*
 * freeMomentFinder.js – Detects when events end early and suggests filling the unexpected free time.
 * Listens to event completion (attendance log) and real-time clock.
 * Must be loaded after eventStream.js, suggestionGenerator.js, todoManager.js
 */

const FreeMomentFinder = (function() {
    // ========== PRIVATE VARIABLES ==========
    let lastCheckTime = null;
    let activeTimers = new Map(); // eventId -> timeout

    // ========== PRIVATE HELPERS ==========
    async function getUnexpectedFreeTime(event, actualEndMinutes) {
        const scheduledEndMin = toMinutes(event.endTime);
        const freeMinutes = scheduledEndMin - actualEndMinutes;
        if (freeMinutes < 15) return null; // too short to be useful
        // Find if there's any other event after this one on the same day
        const dateStr = event.dateStr || event.startDate;
        const laterEvents = getDisplayEventsForDate(dateStr).filter(e => {
            const startMin = toMinutes(e.startTime);
            return startMin > actualEndMinutes;
        });
        const nextEventStart = laterEvents.length ? toMinutes(laterEvents[0].startTime) : (22 * 60);
        const gapUntilNext = nextEventStart - actualEndMinutes;
        const usableGap = Math.min(freeMinutes, gapUntilNext);
        if (usableGap < 15) return null;
        return { startMin: actualEndMinutes, endMin: actualEndMinutes + usableGap, duration: usableGap };
    }

    async function suggestTaskForFreeSlot(freeSlot, dateStr) {
        // Find a pending to‑do that fits
        const todos = TodoManager.getAllTodos().filter(t => !t.completed);
        if (todos.length === 0) return null;
        // Pick highest priority to‑do that has estimated duration <= free slot
        const bestTodo = todos.sort((a, b) => (b.priority || 0) - (a.priority || 0))
            .find(t => (t.estimatedMinutes || 15) <= freeSlot.duration);
        if (!bestTodo) return null;
        return {
            todoId: bestTodo.id,
            todoName: bestTodo.name,
            duration: freeSlot.duration,
            startMin: freeSlot.startMin,
            endMin: freeSlot.endMin
        };
    }

    async function handleEarlyEnd(eventId, dateStr, actualEndMinutes) {
        const event = events.find(e => e.id === eventId);
        if (!event) return;
        const freeSlot = await getUnexpectedFreeTime(event, actualEndMinutes);
        if (!freeSlot) return;
        const suggestion = await suggestTaskForFreeSlot(freeSlot, dateStr);
        if (!suggestion) return;
        const timeStr = formatTime(freeSlot.startMin);
        const durationStr = freeSlot.duration;
        // Generate message using template engine
        let message;
        if (typeof TemplateEngine !== 'undefined') {
            message = TemplateEngine.generate('free_moment', {
                duration: durationStr,
                time: timeStr,
                action: suggestion.todoName
            }, userSettings.assistantTone);
        } else {
            message = `You have ${durationStr} free minutes at ${timeStr}. Want to do "${suggestion.todoName}"?`;
        }
        // Add to conversation log as a suggestion
        if (typeof ConversationLog !== 'undefined') {
            await ConversationLog.addMessage('assistant', message, 'suggestion', {
                type: 'free_moment',
                todoId: suggestion.todoId,
                dateStr: dateStr,
                slot: freeSlot
            });
        } else {
            showToast(message, 'info');
        }
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Start listening to attendance events and real-time clock.
         */
        start() {
            // Listen to attendance log additions (when user marks event as attended)
            if (typeof onEvent === 'function') {
                onEvent('record:added', async (payload) => {
                    if (payload.storeName === STORES.ATTENDANCE_LOG && payload.record) {
                        const { eventId, dateStr, timestamp } = payload.record;
                        const attendedTime = new Date(timestamp);
                        const actualEndMinutes = attendedTime.getHours() * 60 + attendedTime.getMinutes();
                        await handleEarlyEnd(eventId, dateStr, actualEndMinutes);
                    }
                });
            }
            // Also periodically check for events that are past their end time but not marked attended? (optional)
            console.log('FreeMomentFinder started');
        },

        /**
         * Manually check for free moments (e.g., after a meeting ends early).
         * @param {number} eventId
         * @param {string} dateStr
         * @param {number} actualEndMinutes
         */
        async checkEventEnd(eventId, dateStr, actualEndMinutes) {
            await handleEarlyEnd(eventId, dateStr, actualEndMinutes);
        }
    };
})();

// Make globally available
window.FreeMomentFinder = FreeMomentFinder;