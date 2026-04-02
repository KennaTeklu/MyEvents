/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// eventManager.js - Centralized event management
// Handles CRUD operations, recurrence expansion, overrides, and display events.
// Must be loaded after db.js, constants.js, and state.js (for events, overrides, scheduledEvents arrays)

const EventManager = (function() {
    // ========== PRIVATE HELPERS ==========
    
    // Validate an event object before saving
    function validateEvent(event) {
        const errors = [];
        
        // Name is required
        if (!event.name || typeof event.name !== 'string' || event.name.trim() === '') {
            errors.push('Event name is required');
        }
        
        // Open and close times
        const openMin = toMinutes(event.openTime);
        const closeMin = toMinutes(event.closeTime);
        if (openMin >= closeMin) {
            errors.push('Open time must be before close time');
        }
        
        // Min stay must be positive and within window
        const minStay = event.minStay || 30;
        if (minStay < 15) {
            errors.push('Minimum stay must be at least 15 minutes');
        }
        if (minStay > (closeMin - openMin)) {
            errors.push('Minimum stay exceeds available time window');
        }
        
        // Max stay (if present) must be >= min stay and within window
        const maxStay = event.maxStay || minStay;
        if (maxStay < minStay) {
            errors.push('Maximum stay cannot be less than minimum stay');
        }
        if (maxStay > (closeMin - openMin)) {
            errors.push('Maximum stay exceeds available time window');
        }
        
        // Recurrence validation
        if (event.repeat === 'weekly' && (!event.weeklyDays || event.weeklyDays.length === 0)) {
            errors.push('Weekly recurrence requires at least one day selected');
        }
        if (event.repeat === 'monthly' && (!event.monthlyDay || event.monthlyDay < 1 || event.monthlyDay > 31)) {
            errors.push('Monthly recurrence requires a valid day of month (1-31)');
        }
        
        return errors;
    }
    
    // Prepare event data for storage (ensure defaults)
    function sanitizeEvent(event) {
        const now = new Date();
        const sanitized = {
            id: event.id || undefined,
            name: event.name?.trim() || 'Untitled Event',
            openTime: event.openTime || '09:00',
            closeTime: event.closeTime || '17:00',
            minStay: event.minStay || 30,
            maxStay: event.maxStay || (event.minStay || 30),
            startDate: event.startDate || formatDate(now),
            startTime: event.startTime || event.openTime || '09:00',
            endTime: event.endTime || fromMinutes(toMinutes(event.openTime || '09:00') + (event.minStay || 30)),
            color: event.color || DEFAULT_EVENT_COLOR,
            notes: event.notes || '',
            priority: event.priority || PRIORITY.NORMAL,
            travelMins: event.travelMins || 15,
            repeat: event.repeat || RECURRENCE.NONE,
            repeatEnd: event.repeatEnd || '',
            frequency: event.frequency || FREQUENCY.UNLIMITED,
            scarce: event.scarce || false,
            remindRecency: event.remindRecency || false,
            weeklyDays: event.weeklyDays || [],
            monthlyDay: event.monthlyDay || 1,
            // Optional fields
            placeId: event.placeId || null,
            travelToEvent: event.travelToEvent || {}
        };
        return sanitized;
    }
    
    // Refresh global events array from DB (call after mutations)
    async function refreshEvents() {
        const fresh = await getAll(STORES.EVENTS);
        events.length = 0;
        events.push(...fresh);
    }
    
    // ========== PUBLIC API ==========
    return {
        /**
         * Add a new event.
         * @param {Object} eventData - Raw event data from form.
         * @returns {Promise<number>} The new event ID.
         */
        async addEvent(eventData) {
            const sanitized = sanitizeEvent(eventData);
            const errors = validateEvent(sanitized);
            if (errors.length) {
                throw new Error(`Validation failed: ${errors.join(', ')}`);
            }
            const id = await addRecord(STORES.EVENTS, sanitized);
            await refreshEvents();
            return id;
        },
        
        /**
         * Update an existing event.
         * @param {number} eventId - ID of event to update.
         * @param {Object} eventData - Updated event data.
         * @returns {Promise<void>}
         */
        async updateEvent(eventId, eventData) {
            const existing = events.find(e => e.id === eventId);
            if (!existing) throw new Error(`Event with ID ${eventId} not found`);
            const updated = sanitizeEvent({ ...existing, ...eventData, id: eventId });
            const errors = validateEvent(updated);
            if (errors.length) {
                throw new Error(`Validation failed: ${errors.join(', ')}`);
            }
            await putRecord(STORES.EVENTS, updated);
            await refreshEvents();
        },
        
        /**
         * Delete an event and all related overrides and scheduled occurrences.
         * @param {number} eventId - ID of event to delete.
         * @returns {Promise<void>}
         */
        async deleteEvent(eventId) {
            // Remove master event
            await deleteRecord(STORES.EVENTS, eventId);
            
            // Remove all overrides
            const allOverrides = await getAll(STORES.OVERRIDES);
            const toDelete = allOverrides.filter(ov => ov.eventId === eventId);
            for (const ov of toDelete) {
                await deleteRecord(STORES.OVERRIDES, ov.compositeKey);
                overrides.delete(ov.compositeKey);
            }
            
            // Remove all scheduled events for this event
            const allScheduled = await getAll(STORES.SCHEDULED_EVENTS);
            const scheduledToDelete = allScheduled.filter(se => se.eventId === eventId);
            for (const se of scheduledToDelete) {
                await deleteRecord(STORES.SCHEDULED_EVENTS, se.id);
            }
            
            // Refresh global arrays
            await refreshEvents();
            // Also remove from the in-memory scheduledEvents array (all entries)
            for (let i = scheduledEvents.length - 1; i >= 0; i--) {
                if (scheduledEvents[i].eventId === eventId) {
                    scheduledEvents.splice(i, 1);
                }
            }
        },
        
        /**
         * Get an event by ID.
         * @param {number} eventId
         * @returns {Object|null}
         */
        getEventById(eventId) {
            return events.find(e => e.id === eventId) || null;
        },
        
        /**
         * Get all events (master list).
         * @returns {Array}
         */
        getAllEvents() {
            return [...events];
        },
        
        /**
         * Get events for a specific date, including scheduled assignments and overrides.
         * This is the main function used by calendar rendering.
         * @param {string} dateStr - YYYY-MM-DD
         * @returns {Array} Array of event objects ready for display.
         */
        getEventsForDate(dateStr) {
            // Use local date parts for comparison
            const target = new Date(dateStr + 'T12:00:00');
            const dayOfWeek = target.getDay();
            const dateNum = target.getDate();
            
            // Filter master events based on recurrence
            const matches = events.filter(ev => {
                if (dateStr < ev.startDate) return false;
                if (ev.repeatEnd && dateStr > ev.repeatEnd) return false;
                
                if (ev.repeat === RECURRENCE.NONE) {
                    return (ev.startDate === dateStr);
                } else if (ev.repeat === RECURRENCE.DAILY) {
                    return true;
                } else if (ev.repeat === RECURRENCE.WEEKLY) {
                    return ev.weeklyDays && ev.weeklyDays.includes(dayOfWeek);
                } else if (ev.repeat === RECURRENCE.MONTHLY) {
                    return (ev.monthlyDay == dateNum);
                }
                return false;
            });
            
            // Apply overrides (skip/exception)
            const processed = matches
                .map(ev => {
                    const ov = overrides.get(`${ev.id}_${dateStr}`);
                    if (ov && ov.type === 'nogo') return null;
                    if (ov && ov.type === 'exception' && ov.newEvent) {
                        return { ...ev, ...ov.newEvent, id: ev.id, isException: true };
                    }
                    if (ov && ov.type === 'locked') {
                        return { ...ev, isLocked: true };
                    }
                    return ev;
                })
                .filter(ev => ev !== null);
            
            // Merge with scheduled events
            const scheduledForDate = scheduledEvents.filter(se => se.dateStr === dateStr);
            const result = [];
            const processedMasterIds = new Set();
            for (const master of processed) {
                const scheduled = scheduledForDate.find(se => se.eventId === master.id);
                if (scheduled) {
                    result.push({ ...master, ...scheduled, isScheduled: true });
                    processedMasterIds.add(master.id);
                } else {
                    result.push(master);
                }
            }
            for (const scheduled of scheduledForDate) {
                if (!processedMasterIds.has(scheduled.eventId)) {
                    const master = events.find(e => e.id === scheduled.eventId);
                    if (master) result.push({ ...master, ...scheduled, isScheduled: true });
                    else result.push(scheduled);
                }
            }
            return result;
        },
        
        /**
         * Get all occurrences of an event within a date range (Date objects).
         * @param {Object} event - Master event object.
         * @param {Date} startDate
         * @param {Date} endDate
         * @returns {Date[]}
         */
        getOccurrences(event, startDate, endDate) {
            const occurrences = [];
            let cur = new Date(startDate);
            cur.setHours(12, 0, 0);
            while (cur <= endDate) {
                const wd = cur.getDay();
                const dateNum = cur.getDate();
                let include = false;
                if (event.repeat === RECURRENCE.NONE) {
                    include = (event.startDate === formatDate(cur));
                } else if (event.repeat === RECURRENCE.DAILY) {
                    include = true;
                } else if (event.repeat === RECURRENCE.WEEKLY) {
                    include = event.weeklyDays && event.weeklyDays.includes(wd);
                } else if (event.repeat === RECURRENCE.MONTHLY) {
                    include = (event.monthlyDay == dateNum);
                }
                if (include) occurrences.push(new Date(cur));
                cur.setDate(cur.getDate() + 1);
            }
            return occurrences;
        },
        
        /**
         * Apply an override (skip, lock, exception) to an event occurrence.
         * @param {number} eventId
         * @param {string} dateStr - YYYY-MM-DD
         * @param {string} type - 'nogo', 'locked', 'exception'
         * @param {Object|null} newEventData - Only for 'exception', the modified event data.
         * @returns {Promise<void>}
         */
        async applyOverride(eventId, dateStr, type, newEventData = null) {
            const key = `${eventId}_${dateStr}`;
            if (type === 'nogo' || type === 'locked') {
                // Toggle: if already exists with same type, delete; else create
                const existing = overrides.get(key);
                if (existing && existing.type === type) {
                    overrides.delete(key);
                    await deleteRecord(STORES.OVERRIDES, key);
                } else {
                    const override = { compositeKey: key, eventId, dateStr, type };
                    overrides.set(key, override);
                    await putRecord(STORES.OVERRIDES, override);
                }
            } else if (type === 'exception' && newEventData) {
                const override = {
                    compositeKey: key,
                    eventId,
                    dateStr,
                    type: 'exception',
                    newEvent: sanitizeEvent(newEventData)
                };
                overrides.set(key, override);
                await putRecord(STORES.OVERRIDES, override);
            } else {
                throw new Error(`Invalid override type: ${type}`);
            }
        },
        
        /**
         * Validate event data and return array of error messages.
         * @param {Object} eventData
         * @returns {string[]}
         */
        validateEvent(eventData) {
            return validateEvent(sanitizeEvent(eventData));
        },
        
        /**
         * Get human-readable priority label.
         * @param {number} priority
         * @returns {string}
         */
        getPriorityLabel(priority) {
            return PRIORITY_LABELS[priority] || PRIORITY_LABELS[PRIORITY.NORMAL];
        },
        
        /**
         * Convert recurrence string to display text.
         * @param {Object} event
         * @returns {string}
         */
        getRecurrenceText(event) {
            if (event.repeat === RECURRENCE.NONE) return 'Once';
            if (event.repeat === RECURRENCE.DAILY) return 'Daily';
            if (event.repeat === RECURRENCE.WEEKLY) {
                if (!event.weeklyDays || event.weeklyDays.length === 0) return 'Weekly';
                const dayNames = event.weeklyDays.map(d => DAYS_SHORT[d]).join(', ');
                return `Weekly on ${dayNames}`;
            }
            if (event.repeat === RECURRENCE.MONTHLY) {
                return `Monthly on day ${event.monthlyDay}`;
            }
            return '';
        }
    };
})();

// Make EventManager globally available
window.EventManager = EventManager;
