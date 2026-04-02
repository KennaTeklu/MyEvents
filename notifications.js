/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// notifications.js - Enhanced notification management (events, todos, location, learning)
// Must be loaded after state.js, utils.js, db.js, calendar.js

// ========== NOTIFICATION LOG HELPERS ==========
let notificationSound = null;
let soundEnabled = true;

function addToNotifLog(msg, eventId, todoId, type, key) {
    notificationLog.unshift({
        msg,
        eventId: eventId || null,
        todoId: todoId || null,
        type: type || 'event', // 'event', 'todo', 'location', 'system'
        time: new Date(),
        snoozedUntil: null,
        read: false,
        key
    });
    if (notificationLog.length > 100) notificationLog.pop();
    updateNotifBadge();
    renderNotifPanel();
    // Optionally persist to IndexedDB for long-term history? Not required for now.
}

function updateNotifBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    const count = notificationLog.filter(n => !n.read && (!n.snoozedUntil || n.snoozedUntil <= new Date())).length;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
    // Add bump animation if new notification
    if (count > 0 && !badge.classList.contains('bump')) {
        badge.classList.add('bump');
        setTimeout(() => badge.classList.remove('bump'), 300);
    }
}

function renderNotifPanel() {
    const list = document.getElementById('notifList');
    if (!list) return;
    const now = new Date();
    const activeNotifs = notificationLog.filter(n => !n.snoozedUntil || n.snoozedUntil <= now);
    if (!activeNotifs.length) {
        list.innerHTML = '<div class="text-center text-gray-400 text-sm py-6">No notifications</div>';
        return;
    }
    list.innerHTML = activeNotifs.map((n, idx) => `
        <div class="notif-item ${n.read ? 'opacity-50' : ''}" data-idx="${idx}">
            <div class="notif-item-content">
                <div class="notif-item-msg">${escapeHtml(n.msg)}</div>
                <div class="notif-item-time">${n.time.toLocaleTimeString()} • ${n.type === 'todo' ? '📝' : n.type === 'location' ? '📍' : '📅'}</div>
            </div>
            <div class="flex gap-2">
                <button class="notif-snooze" data-idx="${idx}">Snooze 10m</button>
                <button class="notif-dismiss" data-idx="${idx}">✕</button>
            </div>
        </div>
    `).join('');
    // Attach event handlers
    document.querySelectorAll('.notif-snooze').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(btn.dataset.idx);
            if (!isNaN(idx)) snoozeNotification(idx);
        };
    });
    document.querySelectorAll('.notif-dismiss').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(btn.dataset.idx);
            if (!isNaN(idx)) dismissNotification(idx);
        };
    });
}

function dismissNotification(idx) {
    const notif = notificationLog[idx];
    if (!notif) return;
    notificationLog.splice(idx, 1);
    updateNotifBadge();
    renderNotifPanel();
    showToast('Notification dismissed');
}

function snoozeNotification(idx) {
    const notif = notificationLog[idx];
    if (!notif) return;
    notif.snoozedUntil = new Date(Date.now() + 10 * 60 * 1000);
    notif.read = true;
    // Remove the key from shownNotifications so the notification can fire again later
    if (notif.key) shownNotifications.delete(notif.key);
    showToast(`Snoozed for 10 minutes`);
    updateNotifBadge();
    renderNotifPanel();
}

// ========== SOUND & UI ==========
async function playNotificationSound() {
    if (!soundEnabled) return;
    // If userSettings.notificationSound is set, use that sound
    let soundFile = userSettings.notificationSound || 'default';
    // We'll assume we have a set of preloaded sounds; for now, just a beep via Web Audio
    try {
        const audio = new Audio();
        if (soundFile === 'default') {
            // Use a simple beep
            audio.src = 'data:audio/wav;base64,U3RlYW1lbmNvZGVy...'; // Not practical; use a simple built-in beep
            // Fallback: create a simple oscillator
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            oscillator.connect(gain);
            gain.connect(audioCtx.destination);
            gain.gain.value = 0.2;
            oscillator.frequency.value = 880;
            oscillator.start();
            gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.5);
            oscillator.stop(audioCtx.currentTime + 0.5);
        } else {
            // Assume we have a /sounds/ folder with named files
            audio.src = `/sounds/${soundFile}.mp3`;
            await audio.play().catch(e => console.warn('Sound play failed:', e));
        }
    } catch (e) {
        console.warn('Could not play sound:', e);
    }
}

// ========== NOTIFICATION PERMISSION HELPER ==========
async function requestNotificationPermission() {
    if (!("Notification" in window)) {
        showToast('Notifications not supported in this browser', 'error');
        return 'unsupported';
    }
    if (Notification.permission === "granted") {
        showToast('Notifications already enabled', 'success');
        return 'granted';
    }
    if (Notification.permission === "denied") {
        showToast('Notifications blocked. Please enable in browser settings.', 'error');
        return 'denied';
    }
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            showToast('Notifications enabled!', 'success');
        } else if (permission === 'denied') {
            showToast('Notifications blocked', 'error');
        } else {
            showToast('Notification permission not granted', 'info');
        }
        return permission;
    } catch (err) {
        console.error('Notification permission request failed:', err);
        showToast('Could not request notification permission', 'error');
        return 'error';
    }
}

// ========== QUIET HOURS CHECK ==========
function isQuietHours() {
    if (!userSettings.quietHoursStart && !userSettings.quietHoursEnd) return false;
    const now = new Date();
    const hour = now.getHours();
    const start = userSettings.quietHoursStart ?? 22;
    const end = userSettings.quietHoursEnd ?? 7;
    if (start <= end) {
        return hour >= start && hour < end;
    } else {
        return hour >= start || hour < end;
    }
}

// ========== NOTIFICATION FIRING (with quiet hours) ==========
function fireNotification(msg, context, key, type = 'event') {
    // Check quiet hours
    if (isQuietHours()) {
        // Store for later? For now, just add to log but don't play sound or show OS notif.
        addToNotifLog(msg, context?.id, context?.id, type, key);
        return;
    }
    // In-app toast always
    showToast(msg, 'info');
    // Play sound
    playNotificationSound();
    // OS notification only when not focused
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted" && !document.hasFocus()) {
        let body = '';
        if (context && context.notes) body = context.notes.slice(0, 80);
        const notification = new Notification(msg, {
            body,
            icon: '/favicon.ico',
            tag: `${type}_${context?.id || key}`,
            requireInteraction: false,
            silent: false
        });
        // Add click handler to bring app to front or open modal
        notification.onclick = () => {
            window.focus();
            if (type === 'event' && context) {
                openEventModal(context);
            } else if (type === 'todo' && context) {
                openTodoModal(context);
            }
            notification.close();
        };
    } else if (Notification.permission === "default") {
        // Do nothing, wizard handles request.
    }
    addToNotifLog(msg, context?.id, context?.id, type, key);
}

// ========== EVENT REMINDERS ==========
function checkEventReminders(now) {
    const todayStr = formatDate(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (let ev of events) {
        const eventDate = new Date(ev.startDate + 'T12:00:00');
        const eventDateStr = formatDate(eventDate);
        const eventStartMin = toMinutes(ev.startTime);
        const diffDays = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
        const diffMins = (eventDate.getTime() - now.getTime()) / (1000 * 60);

        // Day-before reminder
        if (diffDays === 1 && notifyDayBefore) {
            const key = `${ev.id}_daybefore_${eventDateStr}`;
            if (!shownNotifications.has(key)) {
                const logEntry = notificationLog.find(n => n.eventId === ev.id && n.snoozedUntil && n.snoozedUntil > now);
                if (!logEntry) {
                    const msg = `Tomorrow: ${ev.name} at ${formatTime(toMinutes(ev.startTime))}`;
                    fireNotification(msg, ev, key, 'event');
                    shownNotifications.add(key);
                }
            }
        }

        // Minutes-before reminder
        if (notifyMinutesBefore > 0 && diffMins <= notifyMinutesBefore && diffMins > 0 && eventDateStr === todayStr) {
            const bucket = Math.floor(diffMins / 10);
            const key = `${ev.id}_pre_${bucket}_${eventDateStr}`;
            if (!shownNotifications.has(key)) {
                const logEntry = notificationLog.find(n => n.eventId === ev.id && n.snoozedUntil && n.snoozedUntil > now);
                if (!logEntry) {
                    const msg = `${ev.name} starts in ${Math.round(diffMins)} min`;
                    fireNotification(msg, ev, key, 'event');
                    shownNotifications.add(key);
                }
            }
        }

        // Leave-now reminder
        const travelTime = getTravelTime(ev.id, currentPlaceId);
        const leaveMin = eventStartMin - travelTime - notifyTravelLead;
        if (eventDateStr === todayStr && nowMin >= leaveMin && nowMin < leaveMin + 2) {
            const key = `${ev.id}_leave_${eventDateStr}`;
            if (!shownNotifications.has(key)) {
                const logEntry = notificationLog.find(n => n.eventId === ev.id && n.snoozedUntil && n.snoozedUntil > now);
                if (!logEntry) {
                    const msg = `Leave now for ${ev.name} (${travelTime} min travel)`;
                    fireNotification(msg, ev, key, 'event');
                    shownNotifications.add(key);
                }
            }
        }
    }
}

// ========== TODO REMINDERS ==========
function checkTodoReminders(now) {
    const todayStr = formatDate(now);
    for (let todo of todos) {
        if (todo.completed) continue;
        if (!todo.dueDate) continue;
        const dueDate = new Date(todo.dueDate + 'T12:00:00');
        const dueDateStr = formatDate(dueDate);
        const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
        const key = `${todo.id}_todo_${dueDateStr}`;
        if (diffDays === 1 && !shownNotifications.has(key)) {
            const msg = `Tomorrow: To‑do "${todo.name}" is due.`;
            fireNotification(msg, todo, key, 'todo');
            shownNotifications.add(key);
        } else if (diffDays === 0 && !shownNotifications.has(key + '_today')) {
            const msg = `Today: To‑do "${todo.name}" is due.`;
            fireNotification(msg, todo, key + '_today', 'todo');
            shownNotifications.add(key + '_today');
        }
    }
}

// ========== LOCATION-BASED REMINDERS ==========
function checkLocationReminders(now) {
    if (!currentLocation.lat || !currentLocation.lon) return;
    for (let ev of events) {
        // Check if event has a place assigned (we need to add placeId to events eventually)
        // For now, we'll just check if any place is near current location and there's an event there today
        const todayStr = formatDate(now);
        const todayEvents = getEventsForDate(todayStr);
        for (let evToday of todayEvents) {
            // If event has a placeId, check if user is near that place
            if (evToday.placeId) {
                const place = places.find(p => p.id === evToday.placeId);
                if (place && place.lat && place.lon) {
                    const dist = getDistance(currentLocation.lat, currentLocation.lon, place.lat, place.lon);
                    if (dist <= place.radius) {
                        const key = `${evToday.id}_location_${todayStr}`;
                        if (!shownNotifications.has(key)) {
                            const eventStartMin = toMinutes(evToday.startTime);
                            const nowMin = now.getHours() * 60 + now.getMinutes();
                            if (nowMin >= eventStartMin - 30 && nowMin <= eventStartMin + 60) {
                                const msg = `You're near ${evToday.name} (${place.name}). Your event starts at ${formatTime(eventStartMin)}.`;
                                fireNotification(msg, evToday, key, 'location');
                                shownNotifications.add(key);
                            }
                        }
                    }
                }
            }
        }
    }
}

// ========== NOTIFICATION SCHEDULER ==========
notificationInterval = null;   // variable is already declared in state.js
let lastMidnightReset = null;

function updateNotifications() {
    if (notificationInterval) clearInterval(notificationInterval);

    const anyEnabled = notifyDayBefore || notifyMinutesBefore > 0 || notifyTravelLead > 0;
    if (!anyEnabled && todos.length === 0) return;

    notificationInterval = setInterval(() => {
        const now = new Date();
        // Check reminders every minute
        checkEventReminders(now);
        checkTodoReminders(now);
        checkLocationReminders(now);

        // Reset shownNotifications at midnight
        if (now.getHours() === 0 && now.getMinutes() === 0 && (!lastMidnightReset || lastMidnightReset < now)) {
            shownNotifications.clear();
            lastMidnightReset = now;
        }
    }, 60000);
}

// ========== EXPORT/IMPORT FOR NOTIFICATION LOG (optional) ==========
async function exportNotificationLog() {
    // For debugging, but not essential
    return notificationLog;
}

async function importNotificationLog(log) {
    notificationLog = log;
    updateNotifBadge();
    renderNotifPanel();
}

// ========== INITIALIZATION OF NOTIFICATION UI ==========
document.addEventListener('DOMContentLoaded', () => {
    const notifBell = document.getElementById('notifBell');
    const notifPanel = document.getElementById('notifPanel');
    if (notifBell && notifPanel) {
        notifBell.addEventListener('click', (e) => {
            e.stopPropagation();
            notifPanel.classList.toggle('hidden');
            // Mark all as read when opened
            notificationLog.forEach(n => n.read = true);
            updateNotifBadge();
            renderNotifPanel();
        });
        document.addEventListener('click', (e) => {
            if (!notifPanel.contains(e.target) && e.target !== notifBell) {
                notifPanel.classList.add('hidden');
            }
        });
        const clearAllBtn = document.getElementById('clearAllNotifs');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                notificationLog.length = 0;
                updateNotifBadge();
                renderNotifPanel();
                notifPanel.classList.add('hidden');
                showToast('All notifications cleared');
            });
        }
    }
});

// ========== HELPER FOR MANUAL NOTIFICATION (from settings or elsewhere) ==========
function sendTestNotification() {
    fireNotification('This is a test notification!', null, 'test', 'system');
}
