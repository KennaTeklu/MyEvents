/*
 * commandParser.js – Parses natural language commands from chat input.
 * Converts user messages into structured actions (add, move, delete, query).
 * Must be loaded after eventManager.js, todoManager.js, conversationLog.js
 */

const CommandParser = (function() {
    // ========== PRIVATE PATTERNS ==========
    // Patterns for different command types
    const PATTERNS = {
        // Move event: "move gym to tomorrow 7 AM", "reschedule meeting to Friday at 3 PM"
        move: [
            /move\s+(.+?)\s+to\s+(.+)/i,
            /reschedule\s+(.+?)\s+to\s+(.+)/i,
            /shift\s+(.+?)\s+to\s+(.+)/i
        ],
        // Add event: "add meeting with John at 2 PM tomorrow", "create gym session at 7 AM"
        add: [
            /add\s+(.+?)\s+at\s+(.+)/i,
            /create\s+(.+?)\s+at\s+(.+)/i,
            /schedule\s+(.+?)\s+at\s+(.+)/i,
            /new event\s+(.+?)\s+at\s+(.+)/i
        ],
        // Delete event: "delete gym", "remove meeting"
        delete: [
            /delete\s+(.+)/i,
            /remove\s+(.+)/i,
            /cancel\s+(.+)/i
        ],
        // Query schedule: "what's my schedule", "show today", "what do I have at 2 PM"
        query: [
            /what'?s my schedule/i,
            /show (?:today|tomorrow)/i,
            /what do I have (?:at|on)\s+(.+)/i,
            /when is (.+)/i
        ],
        // Complete to-do: "complete buy milk", "done with email"
        complete: [
            /complete\s+(.+)/i,
            /done with\s+(.+)/i,
            /finish\s+(.+)/i
        ]
    };

    // Time/date parsing helpers
    function parseDateTime(input) {
        const lower = input.toLowerCase();
        const now = new Date();
        let targetDate = new Date();
        let targetTime = null;
        
        // Date keywords
        if (lower.includes('tomorrow')) {
            targetDate.setDate(now.getDate() + 1);
        } else if (lower.includes('today')) {
            targetDate = now;
        } else if (lower.includes('monday')) targetDate.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7));
        else if (lower.includes('tuesday')) targetDate.setDate(now.getDate() + ((2 + 7 - now.getDay()) % 7));
        else if (lower.includes('wednesday')) targetDate.setDate(now.getDate() + ((3 + 7 - now.getDay()) % 7));
        else if (lower.includes('thursday')) targetDate.setDate(now.getDate() + ((4 + 7 - now.getDay()) % 7));
        else if (lower.includes('friday')) targetDate.setDate(now.getDate() + ((5 + 7 - now.getDay()) % 7));
        else if (lower.includes('saturday')) targetDate.setDate(now.getDate() + ((6 + 7 - now.getDay()) % 7));
        else if (lower.includes('sunday')) targetDate.setDate(now.getDate() + ((0 + 7 - now.getDay()) % 7));
        
        // Time patterns
        const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
        if (timeMatch) {
            let hour = parseInt(timeMatch[1]);
            const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            const ampm = timeMatch[3];
            if (ampm === 'pm' && hour !== 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;
            targetTime = hour * 60 + minute;
        }
        
        return { date: targetDate, timeMin: targetTime };
    }

    // Find event by name (partial match)
    function findEventByName(name) {
        const lowerName = name.toLowerCase();
        return events.find(e => e.name.toLowerCase().includes(lowerName));
    }

    // ========== COMMAND HANDLERS ==========
    async function handleMove(command) {
        for (const pattern of PATTERNS.move) {
            const match = command.match(pattern);
            if (match) {
                const eventName = match[1].trim();
                const targetSpec = match[2].trim();
                const { date, timeMin } = parseDateTime(targetSpec);
                const event = findEventByName(eventName);
                if (!event) {
                    await ConversationLog.addMessage('assistant', `I couldn't find an event named "${eventName}".`, 'system');
                    return false;
                }
                const dateStr = formatDate(date);
                let newStartTime = event.startTime;
                let newEndTime = event.endTime;
                if (timeMin !== null) {
                    const duration = toMinutes(event.endTime) - toMinutes(event.startTime);
                    newStartTime = fromMinutes(timeMin);
                    newEndTime = fromMinutes(timeMin + duration);
                }
                // Create override
                const override = {
                    compositeKey: `${event.id}_${dateStr}`,
                    eventId: event.id,
                    dateStr: dateStr,
                    type: 'exception',
                    newEvent: { ...event, startDate: dateStr, startTime: newStartTime, endTime: newEndTime }
                };
                await putRecord(STORES.OVERRIDES, override);
                overrides.set(override.compositeKey, override);
                await ConversationLog.addMessage('assistant', `Moved "${event.name}" to ${formatDateDisplay(dateStr)} at ${newStartTime}.`, 'system');
                if (typeof runOptimizer === 'function') runOptimizer();
                return true;
            }
        }
        return false;
    }

    async function handleAdd(command) {
        for (const pattern of PATTERNS.add) {
            const match = command.match(pattern);
            if (match) {
                const eventName = match[1].trim();
                const timeSpec = match[2].trim();
                const { date, timeMin } = parseDateTime(timeSpec);
                if (timeMin === null) {
                    await ConversationLog.addMessage('assistant', `I couldn't understand the time. Please specify like "at 2 PM".`, 'system');
                    return false;
                }
                const dateStr = formatDate(date);
                const duration = 60; // default 1 hour
                const startTime = fromMinutes(timeMin);
                const endTime = fromMinutes(timeMin + duration);
                const eventData = {
                    name: eventName,
                    openTime: startTime,
                    closeTime: endTime,
                    minStay: duration,
                    maxStay: duration,
                    startDate: dateStr,
                    startTime: startTime,
                    endTime: endTime,
                    color: DEFAULT_EVENT_COLOR,
                    repeat: 'none',
                    priority: 3,
                    notes: ''
                };
                await EventManager.addEvent(eventData);
                await ConversationLog.addMessage('assistant', `Added "${eventName}" on ${formatDateDisplay(dateStr)} at ${startTime}.`, 'system');
                if (typeof runOptimizer === 'function') runOptimizer();
                return true;
            }
        }
        return false;
    }

    async function handleDelete(command) {
        for (const pattern of PATTERNS.delete) {
            const match = command.match(pattern);
            if (match) {
                const eventName = match[1].trim();
                const event = findEventByName(eventName);
                if (!event) {
                    await ConversationLog.addMessage('assistant', `I couldn't find an event named "${eventName}".`, 'system');
                    return false;
                }
                await EventManager.deleteEvent(event.id);
                await ConversationLog.addMessage('assistant', `Deleted "${event.name}".`, 'system');
                if (typeof runOptimizer === 'function') runOptimizer();
                return true;
            }
        }
        return false;
    }

    async function handleQuery(command) {
        for (const pattern of PATTERNS.query) {
            const match = command.match(pattern);
            if (match) {
                // Determine date
                let targetDate = new Date();
                if (command.toLowerCase().includes('tomorrow')) targetDate.setDate(targetDate.getDate() + 1);
                const dateStr = formatDate(targetDate);
                const eventsOnDate = getDisplayEventsForDate(dateStr);
                if (eventsOnDate.length === 0) {
                    await ConversationLog.addMessage('assistant', `You have no events on ${formatDateDisplay(dateStr)}.`, 'system');
                } else {
                    const eventList = eventsOnDate.map(ev => `${formatTime(toMinutes(ev.startTime))} – ${ev.name}`).join('\n');
                    await ConversationLog.addMessage('assistant', `On ${formatDateDisplay(dateStr)}:\n${eventList}`, 'system');
                }
                return true;
            }
        }
        // Check for specific event query: "when is gym"
        const whenMatch = command.match(/when is (.+)/i);
        if (whenMatch) {
            const eventName = whenMatch[1].trim();
            const event = findEventByName(eventName);
            if (!event) {
                await ConversationLog.addMessage('assistant', `I couldn't find an event named "${eventName}".`, 'system');
                return true;
            }
            // Find next occurrence
            const today = new Date();
            const occurrences = EventManager.getOccurrences(event, today, new Date(today.getTime() + 14 * 86400000));
            if (occurrences.length === 0) {
                await ConversationLog.addMessage('assistant', `No upcoming occurrences of "${event.name}" found.`, 'system');
            } else {
                const next = occurrences[0];
                const scheduled = scheduledEvents.find(se => se.eventId === event.id && se.dateStr === formatDate(next));
                if (scheduled) {
                    await ConversationLog.addMessage('assistant', `Next "${event.name}" is on ${formatDateDisplay(formatDate(next))} at ${formatTime(scheduled.startMin)}.`, 'system');
                } else {
                    await ConversationLog.addMessage('assistant', `Next "${event.name}" is on ${formatDateDisplay(formatDate(next))} at ${formatTime(toMinutes(event.startTime))}.`, 'system');
                }
            }
            return true;
        }
        return false;
    }

    async function handleComplete(command) {
        for (const pattern of PATTERNS.complete) {
            const match = command.match(pattern);
            if (match) {
                const todoName = match[1].trim();
                const todos = TodoManager.getAllTodos().filter(t => !t.completed && t.name.toLowerCase().includes(todoName.toLowerCase()));
                if (todos.length === 0) {
                    await ConversationLog.addMessage('assistant', `I couldn't find an incomplete to‑do matching "${todoName}".`, 'system');
                    return false;
                }
                const todo = todos[0];
                await TodoManager.completeTodo(todo.id);
                await ConversationLog.addMessage('assistant', `Completed "${todo.name}". Good job!`, 'system');
                return true;
            }
        }
        return false;
    }

    // ========== MAIN PARSE FUNCTION ==========
    async function parse(commandText) {
        const trimmed = commandText.trim();
        if (trimmed === '') return false;
        
        // Try each handler in order
        if (await handleMove(trimmed)) return true;
        if (await handleAdd(trimmed)) return true;
        if (await handleDelete(trimmed)) return true;
        if (await handleQuery(trimmed)) return true;
        if (await handleComplete(trimmed)) return true;
        
        // No command recognized
        await ConversationLog.addMessage('assistant', `I didn't understand that command. Try something like "move gym to tomorrow 7 AM" or "add meeting at 2 PM".`, 'system');
        return false;
    }

    // ========== PUBLIC API ==========
    return {
        parse: parse
    };
})();

// Make globally available
window.CommandParser = CommandParser;