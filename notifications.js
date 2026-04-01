// notifications.js - In-app notification management
// Must be loaded after state.js, utils.js, db.js, calendar.js (for formatTime)

// ========== NOTIFICATION LOG HELPERS ==========
function addToNotifLog(msg, eventId, key) {
    notificationLog.unshift({ msg, eventId, time: new Date(), snoozedUntil: null, read: false, key });
    if (notificationLog.length > 50) notificationLog.pop();
    updateNotifBadge();
    renderNotifPanel();
}

function updateNotifBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    const count = notificationLog.filter(n => !n.read).length;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
}

function renderNotifPanel() {
    const list = document.getElementById('notifList');
    if (!list) return;
    if (!notificationLog.length) {
        list.innerHTML = '<div class="text-center text-gray-400 text-sm py-6">No notifications</div>';
        return;
    }
    list.innerHTML = notificationLog.map((n, idx) => `
        <div class="notif-item ${n.read ? 'opacity-50' : ''}">
            <div>
                <div class="font-medium">${escapeHtml(n.msg)}</div>
                <div class="text-gray-400" style="font-size:0.7rem;">${n.time.toLocaleTimeString()}</div>
            </div>
            <div class="flex gap-2">
                <button class="notif-snooze" data-idx="${idx}">Snooze 10m</button>
                <button class="notif-dismiss" data-idx="${idx}" style="color:#9ca3af;">✕</button>
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

function fireNotification(msg, ev, key) {
    // In-app toast always
    showToast(msg, 'info');
    // OS notification only when not focused
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted" && !document.hasFocus()) {
        new Notification(msg, {
            body: ev.notes ? ev.notes.slice(0, 80) : '',
            icon: '/favicon.ico',
            tag: `event_${ev.id}` // prevents duplicate OS notifications
        });
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission();
    }
    addToNotifLog(msg, ev.id, key);
}

// ========== NOTIFICATION SCHEDULER ==========
function updateNotifications() {
    if (notificationInterval) clearInterval(notificationInterval);
    
    const anyEnabled = notifyDayBefore || notifyMinutesBefore > 0 || notifyTravelLead > 0;
    if (!anyEnabled) return;

    notificationInterval = setInterval(() => {
        const now = new Date();
        const todayStr = formatDate(now);
        const nowMin = now.getHours() * 60 + now.getMinutes();

        for (let ev of events) {
            const eventDate = new Date(ev.startDate + 'T12:00:00'); // Force midday for date comparison
            const eventDateStr = formatDate(eventDate);
            const eventStartMin = toMinutes(ev.startTime);
            const diffDays = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
            const diffMins = (eventDate.getTime() - now.getTime()) / (1000 * 60);

            // Day-before reminder
            if (diffDays === 1 && notifyDayBefore) {
                const key = `${ev.id}_daybefore_${eventDateStr}`;
                if (!shownNotifications.has(key)) {
                    // Check if snoozed
                    const logEntry = notificationLog.find(n => n.eventId === ev.id && n.snoozedUntil && n.snoozedUntil > now);
                    if (!logEntry) {
                        const msg = `Tomorrow: ${ev.name} at ${formatTime(toMinutes(ev.startTime))}`;
                        fireNotification(msg, ev, key);
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
                        fireNotification(msg, ev, key);
                        shownNotifications.add(key);
                    }
                }
            }

            // Leave-now reminder
            const travelTime = ev.travelMins || 15;
            const leaveMin = eventStartMin - travelTime - notifyTravelLead;
            if (eventDateStr === todayStr && nowMin >= leaveMin && nowMin < leaveMin + 2) {
                const key = `${ev.id}_leave_${eventDateStr}`;
                if (!shownNotifications.has(key)) {
                    const logEntry = notificationLog.find(n => n.eventId === ev.id && n.snoozedUntil && n.snoozedUntil > now);
                    if (!logEntry) {
                        const msg = `Leave now for ${ev.name} (${travelTime} min travel)`;
                        fireNotification(msg, ev, key);
                        shownNotifications.add(key);
                    }
                }
            }
        }

        // Reset shown notifications at midnight
        if (now.getHours() === 0 && now.getMinutes() < 2) shownNotifications.clear();
    }, 60000);
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
