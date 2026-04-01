/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2025 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// utils.js - Core logic engine, time math, recurrence expansion, and helpers
// Must be loaded after state.js and db.js

// ========== TIME MATH (Timezone‑safe) ==========
function toMinutes(timeStr) {
    if (!timeStr) return 0;
    let [h, m] = timeStr.split(':').map(Number);
    return (isNaN(h) || isNaN(m)) ? 0 : h * 60 + m;
}

function fromMinutes(min) {
    let h = Math.floor(min / 60);
    let m = min % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    // Force midday to avoid timezone shifts
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return weekNo;
}

function getMonthNumber(date) {
    return date.getMonth() + 1; // 1-12
}

function getYear(date) {
    return date.getFullYear();
}

function isSameDay(date1, date2) {
    return formatDate(date1) === formatDate(date2);
}

function isSameWeek(date1, date2) {
    return getWeekNumber(date1) === getWeekNumber(date2) && date1.getFullYear() === date2.getFullYear();
}

function isSameMonth(date1, date2) {
    return date1.getMonth() === date2.getMonth() && date1.getFullYear() === date2.getFullYear();
}

function formatTimeWithSeconds(min) {
    let h = Math.floor(min / 60);
    let m = min % 60;
    let s = Math.floor((min - Math.floor(min)) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatRelativeTime(targetDate, now = new Date()) {
    const diffMs = targetDate - now;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 0) return 'overdue';
    if (diffMins < 60) return `${diffMins} min`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''}`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
    const diffWeeks = Math.floor(diffDays / 7);
    return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''}`;
}

// ========== RECURRENCE ENGINE ==========
// Resolves master rule + exceptions for a specific date (local date string YYYY-MM-DD)
function getEventsForDate(dateStr) {
    // Use local date parts for comparison
    const target = new Date(dateStr + 'T12:00:00');
    const dayOfWeek = target.getDay();     // 0=Sun, 1=Mon, ...
    const dateNum = target.getDate();      // 1–31

    // Filter master events
    const matches = events.filter(ev => {
        // Date range check using string compare (YYYY-MM-DD) is safe
        if (dateStr < ev.startDate) return false;
        if (ev.repeatEnd && dateStr > ev.repeatEnd) return false;

        let recurrenceMatch = false;
        if (ev.repeat === 'none') {
            recurrenceMatch = (ev.startDate === dateStr);
        } else if (ev.repeat === 'daily') {
            recurrenceMatch = true;
        } else if (ev.repeat === 'weekly') {
            recurrenceMatch = ev.weeklyDays && ev.weeklyDays.includes(dayOfWeek);
        } else if (ev.repeat === 'monthly') {
            recurrenceMatch = (ev.monthlyDay == dateNum);
        }
        return recurrenceMatch;
    });

    // Apply overrides (skip/exception)
    return matches
        .map(ev => {
            const ov = overrides.get(`${ev.id}_${dateStr}`);
            if (ov && ov.type === 'nogo') return null;                     // skip
            if (ov && ov.type === 'exception' && ov.newEvent) {
                // Deep merge: keep original id, override any properties from newEvent
                return { ...ev, ...ov.newEvent, id: ev.id, isException: true };
            }
            if (ov && ov.type === 'locked') {
                return { ...ev, isLocked: true };
            }
            return ev;
        })
        .filter(ev => ev !== null);
}

// Busy block expansion for conflict checks on a specific date
function getBusyBlocksForDate(dateStr) {
    const target = new Date(dateStr + 'T12:00:00');
    const day = target.getDay();

    return busyBlocks.filter(b => {
        if (b.recurrence === 'once') return b.date === dateStr;
        if (b.recurrence === 'weekly') return b.daysOfWeek && b.daysOfWeek.includes(day);
        if (b.recurrence === 'daterange') return dateStr >= b.startDate && dateStr <= b.endDate;
        return false;
    });
}

// ========== OPTIMIZER HELPERS ==========
// Expands busy blocks over a date range (returns array of { dateStr, startTime, endTime })
function expandBusyBlocks(busyBlocks, rangeStart, rangeEnd) {
    const expanded = [];
    let cur = new Date(rangeStart);
    cur.setHours(12, 0, 0); // avoid timezone issues

    while (cur <= rangeEnd) {
        const dateStr = formatDate(cur);
        const wd = cur.getDay();
        for (let b of busyBlocks) {
            if (b.recurrence === 'weekly' && b.daysOfWeek && b.daysOfWeek.includes(wd)) {
                expanded.push({ dateStr, startTime: b.startTime, endTime: b.endTime });
            } else if (b.recurrence === 'daterange') {
                const start = new Date(b.startDate + 'T12:00:00');
                const end = new Date(b.endDate + 'T12:00:00');
                if (cur >= start && cur <= end) {
                    expanded.push({ dateStr, startTime: b.startTime, endTime: b.endTime });
                }
            }
        }
        cur.setDate(cur.getDate() + 1);
    }
    return expanded;
}

// Expand occurrences of an event within a date range (returns array of Date objects)
function getOccurrences(event, rangeStart, rangeEnd) {
    const occurrences = [];
    let cur = new Date(rangeStart);
    cur.setHours(12, 0, 0);

    while (cur <= rangeEnd) {
        const wd = cur.getDay();
        const dateNum = cur.getDate();
        let include = false;

        if (event.repeat === 'none') {
            include = (event.startDate === formatDate(cur));
        } else if (event.repeat === 'daily') {
            include = true;
        } else if (event.repeat === 'weekly') {
            include = event.weeklyDays && event.weeklyDays.includes(wd);
        } else if (event.repeat === 'monthly') {
            include = (event.monthlyDay == dateNum);
        }

        if (include) occurrences.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return occurrences;
}

// ========== PRIORITY LABEL ==========
function getPriorityLabel(p) {
    const labels = ['', 'Lowest priority', 'Low priority', 'Normal priority', 'High priority', 'Highest priority'];
    return labels[p] || 'Normal priority';
}

// ========== FORM VALIDATION ==========
function validateForm(rules) {
    // rules: [{ id, test, message }]
    let valid = true;
    // Clear previous errors
    document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
    document.querySelectorAll('.field-error-msg').forEach(el => el.remove());

    for (let rule of rules) {
        const el = document.getElementById(rule.id);
        if (!el) continue;
        if (!rule.test(el.value, el)) {
            valid = false;
            el.classList.add('field-error');
            const msg = document.createElement('span');
            msg.className = 'field-error-msg';
            msg.innerText = rule.message;
            el.parentNode.insertBefore(msg, el.nextSibling);
        }
    }
    return valid;
}

// ========== DIRTY FORM CHECK ==========
function isFormDirty(formId, originalData) {
    const form = document.getElementById(formId);
    if (!form) return false;
    const inputs = form.querySelectorAll('input, select, textarea');
    for (let input of inputs) {
        const id = input.id || input.name;
        if (!id || !(id in originalData)) continue;
        const current = input.type === 'checkbox' ? input.checked : input.value;
        if (String(current) !== String(originalData[id])) return true;
    }
    return false;
}

// ========== MODAL MANAGER (Global focus trap) ==========
// This is a simple version; the full implementation lives in modals.js.
// We keep it here for completeness, but modals.js will override it.
// If not already defined, define a fallback.
if (typeof ModalManager === 'undefined') {
    window.ModalManager = {
        current: null,
        open: (modalId) => {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.remove('hidden');
                ModalManager.current = modalId;
                modal.scrollTop = 0;
            }
        },
        close: (modalId) => {
            const modal = document.getElementById(modalId || ModalManager.current);
            if (modal) {
                modal.classList.add('hidden');
                if (!modalId || modalId === ModalManager.current) ModalManager.current = null;
            }
        }
    };
}

// ========== UI & MISC ==========
function showToast(msg, type = 'info') {
    let toastArea = document.getElementById('toastArea');
    if (!toastArea) {
        toastArea = document.createElement('div');
        toastArea.id = 'toastArea';
        document.body.appendChild(toastArea);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    toastArea.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ========== NEW HELPER FUNCTIONS ==========

// Travel time estimation based on distance and speed (walking ~5 km/h, driving ~50 km/h)
function estimateTravelTime(distanceMeters, mode = 'walking') {
    const speedKmPerHour = mode === 'walking' ? 5 : 50;
    const distanceKm = distanceMeters / 1000;
    const hours = distanceKm / speedKmPerHour;
    return Math.round(hours * 60); // minutes
}

// Generate a UUID (v4)
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Deep clone for state snapshots
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Map) {
        const clone = new Map();
        for (const [k, v] of obj.entries()) clone.set(deepClone(k), deepClone(v));
        return clone;
    }
    if (Array.isArray(obj)) return obj.map(deepClone);
    const clonedObj = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) clonedObj[key] = deepClone(obj[key]);
    }
    return clonedObj;
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Slugify a string (for safe IDs)
function slugify(str) {
    return str.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Simple email validation
function isValidEmail(email) {
    return /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/.test(email);
}

// Simple phone validation (basic)
function isValidPhone(phone) {
    return /^[\d\s\-\+\(\)]{8,}$/.test(phone);
}

// ========== ENHANCED RECURRENCE HELPERS (for scheduled events) ==========
// Generate all occurrences of an event within a date range, respecting the event's recurrence rule
function getAllOccurrences(event, startDate, endDate) {
    const occurrences = [];
    let cur = new Date(startDate);
    cur.setHours(12, 0, 0);
    while (cur <= endDate) {
        const wd = cur.getDay();
        const dateNum = cur.getDate();
        let include = false;
        if (event.repeat === 'none') {
            include = (event.startDate === formatDate(cur));
        } else if (event.repeat === 'daily') {
            include = true;
        } else if (event.repeat === 'weekly') {
            include = event.weeklyDays && event.weeklyDays.includes(wd);
        } else if (event.repeat === 'monthly') {
            include = (event.monthlyDay == dateNum);
        }
        if (include) {
            occurrences.push(new Date(cur));
        }
        cur.setDate(cur.getDate() + 1);
    }
    return occurrences;
}

// Get scheduled event (from scheduledEvents) for a specific event and date
function getScheduledEvent(eventId, dateStr) {
    return scheduledEvents.find(se => se.eventId === eventId && se.dateStr === dateStr);
}

// Merge master events with scheduled assignments for display
function getDisplayEventsForDate(dateStr) {
    const masterEvents = getEventsForDate(dateStr);
    const scheduledForDate = scheduledEvents.filter(se => se.dateStr === dateStr);
    const result = [];
    const processedMasterIds = new Set();
    
    for (const master of masterEvents) {
        const scheduled = scheduledForDate.find(se => se.eventId === master.id);
        if (scheduled) {
            // Preserve master.id and convert numeric times to strings
            result.push({
                ...master,
                ...scheduled,
                id: master.id,                     // keep master id
                scheduledId: scheduled.id,         // store scheduled id separately
                startTime: fromMinutes(scheduled.startMin),
                endTime: fromMinutes(scheduled.endMin),
                isScheduled: true
            });
            processedMasterIds.add(master.id);
        } else {
            result.push(master);
        }
    }
    
    for (const scheduled of scheduledForDate) {
        if (!processedMasterIds.has(scheduled.eventId)) {
            const master = events.find(e => e.id === scheduled.eventId);
            if (master) {
                result.push({
                    ...master,
                    ...scheduled,
                    id: master.id,
                    scheduledId: scheduled.id,
                    startTime: fromMinutes(scheduled.startMin),
                    endTime: fromMinutes(scheduled.endMin),
                    isScheduled: true
                });
            } else {
                // No master – create a standalone scheduled event (should not happen)
                result.push({
                    ...scheduled,
                    startTime: fromMinutes(scheduled.startMin),
                    endTime: fromMinutes(scheduled.endMin)
                });
            }
        }
    }
    return result;
}
