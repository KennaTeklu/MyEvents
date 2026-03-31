// ==================== UTILITIES ====================
function toMinutes(timeStr) {
    if (!timeStr) return 0;
    let [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    return h * 60 + m;
}
function fromMinutes(min) {
    if (isNaN(min)) min = 0;
    let h = Math.floor(min / 60);
    let m = min % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) date = new Date();
    return date.toISOString().split('T')[0];
}
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
function showToast(msg, type = 'info') {
    let toastArea = document.getElementById('toastArea');
    if (!toastArea) {
        toastArea = document.createElement('div');
        toastArea.id = 'toastArea';
        document.body.appendChild(toastArea);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
    toast.innerText = msg;
    toastArea.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return weekNo;
}
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}