// utils.js - Core logic engine, time math, and recurrence expansion
// Must be loaded after state.js and db.js

// ========== TIME MATH ==========
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

// Fixed Timezone Bug: Uses local time methods
function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00'); // Force midday to avoid timezone edge cases
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ========== RECURRENCE ENGINE ==========
// This resolves the master rule + any exceptions (skips/edits)
function getEventsForDate(dateStr) {
    const target = new Date(dateStr + 'T12:00:00');
    const dayOfWeek = target.getDay(); // 0=Sun, 1=Mon
    const dateNum = target.getDate();

    // 1. Expand recurring rules into daily instances
    const dailyInstances = events.filter(ev => {
        if (dateStr < ev.startDate) return false;
        if (ev.repeatEnd && dateStr > ev.repeatEnd) return false;

        let matches = false;
        if (ev.repeat === 'none') matches = (ev.startDate === dateStr);
        else if (ev.repeat === 'daily') matches = true;
        else if (ev.repeat === 'weekly') matches = ev.weeklyDays && ev.weeklyDays.includes(dayOfWeek);
        else if (ev.repeat === 'monthly') matches = (ev.monthlyDay == dateNum);
        
        return matches;
    });

    // 2. Map through instances and apply Overrides (Exceptions/Skips)
    return dailyInstances
        .map(ev => {
            const ov = overrides.get(`${ev.id}_${dateStr}`);
            if (ov && ov.type === 'nogo') return null; // Logic: Return null to filter out skipped items
            if (ov && ov.type === 'exception' && ov.newEvent) return { ...ev, ...ov.newEvent, id: ev.id, isException: true };
            if (ov && ov.type === 'locked') return { ...ev, isLocked: true };
            return ev;
        })
        .filter(ev => ev !== null);
}

// Busy block expansion for conflict checks
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

// ========== UI & MISC ==========
function showToast(msg, type = 'info') {
    let toastArea = document.getElementById('toastArea') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toastArea' }));
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    toastArea.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(str) { 
    return String(str).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); 
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
