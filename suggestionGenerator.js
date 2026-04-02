/*
 * suggestionGenerator.js – Generates proactive suggestions for the user.
 * Analyzes schedule, busy blocks, to-dos, and preferences to produce helpful messages.
 * Must be loaded after conversationLog.js, templateEngine.js, and all managers.
 */

const SuggestionGenerator = (function() {
    // ========== PRIVATE VARIABLES ==========
    let lastRunTime = null;
    let pendingSuggestions = new Map(); // key: suggestion type + date, value: suggestion object
    const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes between suggestion runs

    // ========== HELPER: FREE SLOT DETECTION ==========
    async function findFreeSlots(dateStr, windowStartMin, windowEndMin, minDuration = 15) {
        return BusyManager.getFreeSlots(dateStr, windowStartMin, windowEndMin, minDuration);
    }

    // ========== SUGGESTION TYPES ==========
    async function suggestTaskForFreeSlot() {
        // Get all to-dos that are not completed and have no due date or due today/soon
        const todos = TodoManager.getAllTodos().filter(t => !t.completed);
        if (todos.length === 0) return [];

        const suggestions = [];
        const today = formatDate(new Date());
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = formatDate(tomorrow);

        // Check today and tomorrow for free slots
        for (const dateStr of [today, tomorrowStr]) {
            const freeSlots = await findFreeSlots(dateStr, 8 * 60, 22 * 60, 15);
            if (freeSlots.length === 0) continue;

            // Pick the best to-do (highest priority) and best free slot (longest)
            const bestTodo = todos.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
            const bestSlot = freeSlots.sort((a, b) => (b.endMin - b.startMin) - (a.endMin - a.startMin))[0];
            const duration = bestSlot.endMin - bestSlot.startMin;
            const timeStr = formatTime(bestSlot.startMin);

            const message = TemplateEngine.generate('suggest_task', {
                duration: duration,
                time: timeStr,
                task: bestTodo.name
            }, userSettings.assistantTone);
            suggestions.push({
                type: 'suggest_task',
                dateStr: dateStr,
                slot: bestSlot,
                todoId: bestTodo.id,
                message: message,
                priority: bestTodo.priority || 3
            });
        }
        return suggestions;
    }

    async function suggestConflictResolution() {
        // Find any conflicts that have not been resolved
        // Conflicts are already in global `conflicts` array, but we need to check if a suggestion was already made
        const suggestions = [];
        for (const conflict of conflicts) {
            const key = `${conflict.event.id}_${conflict.busy.date}_conflict`;
            if (pendingSuggestions.has(key)) continue;

            // Determine lower priority event
            const eventPriority = conflict.event.priority || 3;
            const busyPriority = conflict.busy.hard ? 5 : 2; // hard blocks treated as high priority
            let lowerEvent = null;
            let higherEvent = null;
            if (eventPriority < busyPriority) {
                lowerEvent = conflict.event;
                higherEvent = conflict.busy;
            } else {
                lowerEvent = conflict.busy;
                higherEvent = conflict.event;
            }

            // Find alternative time for lower-priority event
            const dateStr = conflict.busy.date || conflict.event.startDate;
            const freeSlots = await findFreeSlots(dateStr, 8 * 60, 22 * 60, 30);
            if (freeSlots.length === 0) continue;

            const bestSlot = freeSlots[0];
            const newTime = formatTime(bestSlot.startMin);

            const message = TemplateEngine.generate('conflict_resolution', {
                eventA: conflict.event.name,
                eventB: conflict.busy.description || 'busy block',
                lowerPriorityEvent: lowerEvent.name || lowerEvent.description,
                higherPriorityEvent: higherEvent.name || higherEvent.description,
                newTime: newTime
            }, userSettings.assistantTone);

            suggestions.push({
                type: 'resolve_conflict',
                dateStr: dateStr,
                conflict: conflict,
                newSlot: bestSlot,
                message: message,
                priority: 4
            });
        }
        return suggestions;
    }

    async function suggestDailyBriefing() {
        // Only run once per day (at first load of the day)
        const today = formatDate(new Date());
        const lastBriefingDate = localStorage.getItem('lastBriefingDate');
        if (lastBriefingDate === today) return [];

        // Gather today's events
        const todayEvents = getDisplayEventsForDate(today);
        const eventsList = todayEvents.map(ev => `${formatTime(toMinutes(ev.startTime))} – ${ev.name}`).join('\n');
        
        // Gather changes (from scheduled events vs master? we can check overrides)
        const changes = [];
        const overridesList = Array.from(overrides.values());
        for (const ov of overridesList) {
            if (ov.dateStr === today && ov.type === 'exception') {
                const ev = events.find(e => e.id === ov.eventId);
                if (ev) changes.push(`${ev.name} moved to ${formatTime(toMinutes(ov.newEvent.startTime))}`);
            }
        }
        const changesText = changes.length ? changes.join('\n') : 'No automatic changes.';
        
        // Gather suggestions (already generated)
        const suggestions = await suggestTaskForFreeSlot();
        const suggestionsText = suggestions.length ? suggestions.map(s => s.message).join('\n') : 'No new suggestions.';

        const message = TemplateEngine.generate('daily_briefing', {
            date: today,
            events: eventsList || 'No events scheduled.',
            changes: changesText,
            suggestions: suggestionsText
        }, userSettings.assistantTone);

        localStorage.setItem('lastBriefingDate', today);
        return [{
            type: 'daily_briefing',
            dateStr: today,
            message: message,
            priority: 1
        }];
    }

    async function suggestFreeMoment() {
        // This is for real-time unexpected free time, triggered by event end detection.
        // We'll implement a separate listener in eventStream.js later.
        return [];
    }

    // ========== MAIN SUGGESTION GENERATION ==========
    async function generateAllSuggestions() {
        const now = Date.now();
        if (lastRunTime && now - lastRunTime < COOLDOWN_MS) {
            console.log('Suggestion generator cooldown active');
            return [];
        }
        lastRunTime = now;

        const allSuggestions = [];
        const taskSuggestions = await suggestTaskForFreeSlot();
        const conflictSuggestions = await suggestConflictResolution();
        const briefingSuggestions = await suggestDailyBriefing();

        allSuggestions.push(...taskSuggestions, ...conflictSuggestions, ...briefingSuggestions);
        
        // Sort by priority (higher first)
        allSuggestions.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        
        // Store pending suggestions (limit to 5 most important)
        for (const sug of allSuggestions.slice(0, 5)) {
            const key = `${sug.type}_${sug.dateStr}_${Date.now()}`;
            pendingSuggestions.set(key, sug);
            // Add to conversation log
            await ConversationLog.addMessage('assistant', sug.message, 'suggestion', {
                type: sug.type,
                suggestionId: key,
                data: sug
            });
        }
        
        // Emit event for UI to refresh chat badge
        if (typeof emitEvent === 'function') {
            emitEvent('suggestions:updated', { count: pendingSuggestions.size });
        }
        
        return allSuggestions;
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Run the suggestion generator and return new suggestions.
         */
        async run() {
            return await generateAllSuggestions();
        },
        
        /**
         * Get all pending suggestions (not yet acted upon).
         */
        getPendingSuggestions() {
            return Array.from(pendingSuggestions.values());
        },
        
        /**
         * Mark a suggestion as accepted (and optionally perform its action).
         * @param {string} suggestionKey
         * @param {boolean} accept
         */
        async respondToSuggestion(suggestionKey, accept) {
            const sug = pendingSuggestions.get(suggestionKey);
            if (!sug) return;
            
            if (accept) {
                // Perform the suggested action
                if (sug.type === 'suggest_task' && sug.todoId) {
                    // Schedule the to-do into the free slot
                    const todo = TodoManager.getTodoById(sug.todoId);
                    if (todo) {
                        // Create a temporary event for the to-do
                        const eventData = {
                            name: todo.name,
                            startTime: formatTime(sug.slot.startMin),
                            endTime: formatTime(sug.slot.endMin),
                            minStay: sug.slot.endMin - sug.slot.startMin,
                            maxStay: sug.slot.endMin - sug.slot.startMin,
                            startDate: sug.dateStr,
                            color: '#10b981',
                            repeat: 'none',
                            priority: todo.priority,
                            notes: todo.notes
                        };
                        await EventManager.addEvent(eventData);
                    }
                } else if (sug.type === 'resolve_conflict' && sug.conflict) {
                    // Move the conflicting event
                    const event = sug.conflict.event;
                    const newDateStr = sug.dateStr;
                    const newStartTime = formatTime(sug.newSlot.startMin);
                    const newEndTime = formatTime(sug.newSlot.endMin);
                    const override = {
                        compositeKey: `${event.id}_${newDateStr}`,
                        eventId: event.id,
                        dateStr: newDateStr,
                        type: 'exception',
                        newEvent: {
                            ...event,
                            startDate: newDateStr,
                            startTime: newStartTime,
                            endTime: newEndTime
                        }
                    };
                    await putRecord(STORES.OVERRIDES, override);
                    overrides.set(override.compositeKey, override);
                }
                await ConversationLog.addMessage('assistant', `Accepted: ${sug.message}`, 'system', { accepted: true });
            } else {
                await ConversationLog.addMessage('assistant', `Rejected: ${sug.message}`, 'system', { accepted: false });
            }
            pendingSuggestions.delete(suggestionKey);
            
            // Re-run scheduler after action
            if (typeof runOptimizer === 'function') runOptimizer();
        },
        
        /**
         * Clear all pending suggestions.
         */
        clearPending() {
            pendingSuggestions.clear();
        }
    };
})();

// Make globally available
window.SuggestionGenerator = SuggestionGenerator;