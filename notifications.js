// ==================== NOTIFICATIONS ====================
let notificationInterval = null;
let shownNotifications = new Set();

function updateNotifications() {
    if (notificationInterval) clearInterval(notificationInterval);
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
            if (diffDays === 1 && notifyDayBefore && eventDateStr !== todayStr) {
                const key = `${ev.id}_daybefore`;
                if (!shownNotifications.has(key)) {
                    showNotification(`Tomorrow: ${ev.name} at ${ev.startTime}`, ev);
                    shownNotifications.add(key);
                }
            }
            if (diffMins <= notifyMinutesBefore && diffMins > 0 && eventDateStr === todayStr) {
                const key = `${ev.id}_pre_${Math.floor(diffMins/10)}`;
                if (!shownNotifications.has(key)) {
                    showNotification(`Starts in ${Math.round(diffMins)} minutes: ${ev.name}`, ev);
                    shownNotifications.add(key);
                }
            }
            const travelTime = ev.travelMins || 15;
            const leaveMin = eventStartMin - travelTime - notifyTravelLead;
            const currentMin = now.getHours() * 60 + now.getMinutes();
            if (eventDateStr === todayStr && currentMin >= leaveMin && currentMin < eventStartMin) {
                const key = `${ev.id}_leave`;
                if (!shownNotifications.has(key)) {
                    showNotification(`Leave now for ${ev.name} (travel ${travelTime} min)`, ev);
                    shownNotifications.add(key);
                }
            }
        }
        if (now.getHours() === 0 && now.getMinutes() === 0) shownNotifications.clear();
    }, 60000);
}

function showNotification(msg, event) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
        if (!document.hasFocus()) {
            new Notification(msg, { body: event.notes || "", icon: "/favicon.ico" });
        }
        showToast(msg, 'info');
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(perm => {
            if (perm === "granted") new Notification(msg);
        });
    }
}