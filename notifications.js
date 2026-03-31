// notifications.js - Notification handling with in-app log and snooze
// Must be loaded after state.js, utils.js, db.js

// ========== NOTIFICATION LOGGING ==========
function addToNotifLog(msg, eventId) {
    notificationLog.unshift({ msg, eventId, time: new Date(), snoozedUntil: null, read: false });
    if (notificationLog.length > 50) notificationLog.pop();
    updateNotifBadge();
    renderNotifPanel();
}

function updateNotifBadge() {
    const badge = document.getElementById('notifBadge');
    const count = notificationLog.filter(n => !n.read).length;
    if (badge) {
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    }
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
            <button class="notif-snooze" onclick="snoozeNotification(${idx})">Snooze 10m</button>
        </div>
    `).join('');
}

function snoozeNotification(idx) {
    const notif = notificationLog[idx];
    if (!notif) return;
    notif.snoozedUntil = new Date(Date.now() + 10 * 60 * 1000);
    notif.read = true;
    showToast(`Snoozed for 10 minutes`);
    updateNotifBadge();
    renderNotifPanel();
}

// ========== OS NOTIFICATION WITH DEDUPLICATION ==========
function fireNotification(msg, ev) {
    // In-app toast always
    showToast(msg, 'info');
    // OS notification only when not focused
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted" && !document.hasFocus()) {
        new Notification(msg, {
            body: ev.notes ? ev.notes.slice(0, 80) : '',
            icon: '/favicon.ico',
            tag: `event_${ev.id}`
        });
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission();
    }
}

// ========== MAIN NOTIFICATION LOOP ==========
function updateNotifications() {
    if (notificationInterval) clearInterval(notificationInterval);
    
    const anyEnabled = notifyDayBefore || notifyMinutesBefore > 0 || notifyTravelLead > 0;
    if (!anyEnabled) return;

    notificationInterval = setInterval(() => {
        const now = new Date();
        const todayStr = formatDate(now);
        const nowMin = now.getHours() * 60 + now.getMinutes();

        for (let ev of events) {
            const eventDate = new Date(ev.startDate);
            const eventDateStr = formatDate(eventDate);
            const eventStartMin = toMinutes(ev.startTime);
            const diffDays = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
            const diffMins = (eventDate.getTime() - now.getTime()) / (1000 * 60);

            // Day-before reminder
            if (diffDays === 1 && notifyDayBefore) {
                const key = `${ev.id}_daybefore_${eventDateStr}`;
                if (!shownNotifications.has(key)) {
                    const msg = `Tomorrow: ${ev.name} at ${formatTime(toMinutes(ev.startTime))}`;
                    fireNotification(msg, ev);
                    shownNotifications.add(key);
                    addToNotifLog(msg, ev.id);
                }
            }

            // Minutes-before reminder
            if (notifyMinutesBefore > 0 && diffMins <= notifyMinutesBefore && diffMins > 0 && eventDateStr === todayStr) {
                const bucket = Math.floor(diffMins / 10);
                const key = `${ev.id}_pre_${bucket}_${eventDateStr}`;
                if (!shownNotifications.has(key)) {
                    // Check if snoozed
                    const logEntry = notificationLog.find(n => n.eventId === ev.id && n.snoozedUntil && n.snoozedUntil > now);
                    if (!logEntry) {
                        const msg = `${ev.name} starts in ${Math.round(diffMins)} min`;
                        fireNotification(msg, ev);
                        shownNotifications.add(key);
                        addToNotifLog(msg, ev.id);
                    }
                }
            }

            // Leave-now reminder
            const travelTime = ev.travelMins || 15;
            const leaveMin = eventStartMin - travelTime - notifyTravelLead;
            if (eventDateStr === todayStr && nowMin >= leaveMin && nowMin < leaveMin + 2) {
                const key = `${ev.id}_leave_${eventDateStr}`;
                if (!shownNotifications.has(key)) {
                    const msg = `Leave now for ${ev.name} (${travelTime} min travel)`;
                    fireNotification(msg, ev);
                    shownNotifications.add(key);
                    addToNotifLog(msg, ev.id);
                }
            }
        }

        // Reset at midnight
        if (now.getHours() === 0 && now.getMinutes() < 2) shownNotifications.clear();
    }, 60000);
}
