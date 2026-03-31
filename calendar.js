// ==================== CALENDAR RENDERING ====================
let currentView = 'week';
let currentDate = new Date();
let firstDayOfWeek = 1;
let timeFormat = '12h';
let events = [];
let busyBlocks = [];
let overrides = new Map();
let conflicts = [];

async function renderCalendar() {
    const container = document.getElementById('calendarGrid');
    if (!container) return;
    const isMobile = window.innerWidth < 768;
    if (currentView === 'week') {
        if (isMobile) await renderMobileWeekView(container);
        else await renderWeekView(container);
    } else {
        await renderMonthView(container);
    }
    attachCalendarEvents();
    updateNowLine();
    scrollToNow();
    updateDateRangeDisplay();
}

function updateDateRangeDisplay() {
    const display = document.getElementById('dateRangeDisplay');
    if (!display) return;
    if (currentView === 'week') {
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - ((currentDate.getDay() - firstDayOfWeek + 7) % 7));
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        display.innerText = `${startOfWeek.toLocaleDateString()} – ${endOfWeek.toLocaleDateString()}`;
    } else {
        display.innerText = currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
}

async function renderWeekView(container) {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - ((currentDate.getDay() - firstDayOfWeek + 7) % 7));
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        days.push(d);
    }
    // Dynamic time range
    let earliestHour = 24, latestHour = 0;
    for (let d of days) {
        const dayStr = formatDate(d);
        const dayEvents = events.filter(e => formatDate(new Date(e.startDate)) === dayStr);
        for (let ev of dayEvents) {
            const start = toMinutes(ev.startTime);
            const end = toMinutes(ev.endTime);
            earliestHour = Math.min(earliestHour, Math.floor(start / 60));
            latestHour = Math.max(latestHour, Math.ceil(end / 60));
        }
    }
    earliestHour = Math.max(6, earliestHour - 1);
    latestHour = Math.min(22, latestHour + 1);
    if (earliestHour >= latestHour) { earliestHour = 6; latestHour = 22; }

    let html = `<div class="weekdays flex">`;
    for (let i = 0; i < days.length; i++) {
        const d = days[i];
        const isToday = formatDate(d) === formatDate(new Date());
        html += `<div class="day-header flex-1 text-center font-semibold py-2 ${isToday ? 'today-header' : ''}">${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.getDate()}</div>`;
    }
    html += `</div>`;

    for (let hour = earliestHour; hour < latestHour; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
            const currentMin = hour * 60 + minute;
            html += `<div class="timeline-row">`;
            html += `<div class="time-col">${formatTime(currentMin)}</div>`;
            html += `<div class="days-row">`;
            for (let idx = 0; idx < days.length; idx++) {
                const day = days[idx];
                const dayStr = formatDate(day);
                const isToday = dayStr === formatDate(new Date());
                const dayEvents = events.filter(e => formatDate(new Date(e.startDate)) === dayStr);
                const dayBusy = busyBlocks.filter(b => {
                    if (b.recurrence === 'once' && b.date === dayStr) return true;
                    if (b.recurrence === 'weekly' && b.daysOfWeek?.includes(day.getDay())) return true;
                    if (b.recurrence === 'daterange' && b.startDate && b.endDate) {
                        const d = new Date(dayStr);
                        return d >= new Date(b.startDate) && d <= new Date(b.endDate);
                    }
                    return false;
                }).filter(b => {
                    const startMin = toMinutes(b.startTime);
                    const endMin = toMinutes(b.endTime);
                    return endMin > currentMin && startMin < currentMin + 30;
                });
                html += `<div class="day-cell relative ${isToday ? 'today-cell' : ''}" data-day="${day.getDay()}" data-date="${dayStr}">`;
                for (let busy of dayBusy) {
                    const startMin = toMinutes(busy.startTime);
                    const endMin = toMinutes(busy.endTime);
                    const top = ((Math.max(startMin, currentMin) - currentMin) / 30) * 100;
                    const height = ((Math.min(endMin, currentMin + 30) - Math.max(startMin, currentMin)) / 30) * 100;
                    html += `<div class="busy-overlay" style="top:${top}%; height:${height}%;"></div>`;
                }
                for (let ev of dayEvents) {
                    const startMin = toMinutes(ev.startTime);
                    const endMin = toMinutes(ev.endTime);
                    if (endMin > currentMin && startMin < currentMin + 30) {
                        const top = ((Math.max(startMin, currentMin) - currentMin) / 30) * 100;
                        const height = ((Math.min(endMin, currentMin + 30) - Math.max(startMin, currentMin)) / 30) * 100;
                        const isNogo = overrides.has(`${ev.id}_${dayStr}`) && overrides.get(`${ev.id}_${dayStr}`).type === 'nogo';
                        const isLocked = overrides.has(`${ev.id}_${dayStr}`) && overrides.get(`${ev.id}_${dayStr}`).type === 'locked';
                        const hasConflict = conflicts.some(c => c.event === ev);
                        html += `<div class="event-block ${isNogo ? 'nogo' : ''} ${isLocked ? 'locked' : ''} ${hasConflict ? 'conflict' : ''}" data-id="${ev.id}" data-date="${dayStr}" style="top:${top}%; height:${height}%; background-color:${ev.color || '#3b82f6'};" role="button" tabindex="0" aria-label="${ev.name}, ${formatTime(startMin)}–${formatTime(endMin)}">${escapeHtml(ev.name)}<br><span class="text-xs opacity-80">${formatTime(startMin)}–${formatTime(endMin)}</span></div>`;
                        const travelTop = top - 12;
                        if (travelTop >= 0) {
                            html += `<div class="travel-block" style="position:absolute; top:${travelTop}%; height:12px; left:2px; right:2px; background:#9ca3af; border-radius:4px; font-size:0.6rem; text-align:center; color:white;">🚗 ${ev.travelMins || 15} min</div>`;
                        }
                    }
                }
                html += `</div>`;
            }
            html += `</div></div>`;
        }
    }
    container.innerHTML = html;
}

async function renderMobileWeekView(container) {
    const startDate = new Date(currentDate);
    const days = [];
    for (let i = 0; i < 3; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        days.push(d);
    }
    let html = `<div class="weekdays flex">${days.map(d => `<div class="day-header flex-1 text-center font-semibold py-2">${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.getDate()}</div>`).join('')}</div>`;
    const startHour = 6, endHour = 22;
    for (let hour = startHour; hour < endHour; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
            const currentMin = hour * 60 + minute;
            html += `<div class="timeline-row">`;
            html += `<div class="time-col">${formatTime(currentMin)}</div>`;
            html += `<div class="days-row">`;
            for (let idx = 0; idx < days.length; idx++) {
                const day = days[idx];
                const dayStr = formatDate(day);
                const dayEvents = events.filter(e => formatDate(new Date(e.startDate)) === dayStr);
                html += `<div class="day-cell relative" data-day="${day.getDay()}" data-date="${dayStr}">`;
                for (let ev of dayEvents) {
                    const startMin = toMinutes(ev.startTime);
                    const endMin = toMinutes(ev.endTime);
                    if (endMin > currentMin && startMin < currentMin + 30) {
                        const top = ((Math.max(startMin, currentMin) - currentMin) / 30) * 100;
                        const height = ((Math.min(endMin, currentMin + 30) - Math.max(startMin, currentMin)) / 30) * 100;
                        html += `<div class="event-block" data-id="${ev.id}" data-date="${dayStr}" style="top:${top}%; height:${height}%; background-color:${ev.color || '#3b82f6'};">${escapeHtml(ev.name)}</div>`;
                    }
                }
                html += `</div>`;
            }
            html += `</div></div>`;
        }
    }
    container.innerHTML = html;
}

async function renderMonthView(container) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(1 - ((firstDayOfMonth.getDay() - firstDayOfWeek + 7) % 7));
    const weeks = [];
    for (let w = 0; w < 6; w++) {
        const week = [];
        for (let d = 0; d < 7; d++) {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + w*7 + d);
            week.push(date);
        }
        weeks.push(week);
    }
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const orderedDayNames = [...dayNames.slice(firstDayOfWeek), ...dayNames.slice(0, firstDayOfWeek)];
    let html = `<div class="month-view"><div class="weekdays flex">${orderedDayNames.map(d => `<div class="day-header flex-1 text-center py-2">${d}</div>`).join('')}</div>`;
    for (let week of weeks) {
        html += `<div class="flex">`;
        for (let date of week) {
            const dateStr = formatDate(date);
            const dayEvents = events.filter(e => formatDate(new Date(e.startDate)) === dateStr);
            const isCurrentMonth = date.getMonth() === month;
            const isToday = dateStr === formatDate(new Date());
            html += `<div class="day-cell flex-1 border min-h-24 p-1 ${isCurrentMonth ? '' : 'text-gray-400'} ${isToday ? 'today-cell' : ''}" data-date="${dateStr}">
                        <div class="text-right text-sm font-semibold cursor-pointer" data-nav-date="${dateStr}">${date.getDate()}</div>`;
            let displayed = 0;
            for (let ev of dayEvents.slice(0, 3)) {
                const isNogo = overrides.has(`${ev.id}_${dateStr}`) && overrides.get(`${ev.id}_${dateStr}`).type === 'nogo';
                html += `<div class="event-block-month ${isNogo ? 'nogo' : ''} text-xs rounded p-1 mt-1 truncate" data-id="${ev.id}" data-date="${dateStr}" style="background-color:${ev.color || '#3b82f6'};">${escapeHtml(ev.name)}</div>`;
                displayed++;
            }
            if (dayEvents.length > 3) {
                html += `<div class="text-xs text-blue-500 mt-1 cursor-pointer more-events" data-date="${dateStr}">+${dayEvents.length-3} more</div>`;
            }
            html += `</div>`;
        }
        html += `</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
    document.querySelectorAll('.more-events').forEach(el => {
        el.addEventListener('click', (e) => {
            const dateStr = el.dataset.date;
            const dayEvents = events.filter(e => formatDate(new Date(e.startDate)) === dateStr);
            const msg = dayEvents.map(ev => `${ev.name} (${ev.startTime}-${ev.endTime})`).join('\n');
            alert(`Events on ${dateStr}:\n${msg}`);
        });
    });
    document.querySelectorAll('[data-nav-date]').forEach(el => {
        el.addEventListener('click', (e) => {
            const navDate = new Date(el.dataset.date);
            currentDate = navDate;
            currentView = 'week';
            document.getElementById('viewToggleBtn').innerHTML = '<i class="fas fa-calendar-week"></i> Week';
            renderCalendar();
        });
    });
}

function formatTime(min) {
    if (isNaN(min)) min = 0;
    let h = Math.floor(min / 60);
    let m = min % 60;
    if (timeFormat === '12h') {
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
    }
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

let nowLineInterval = null;
function updateNowLine() {
    if (currentView !== 'week') return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startHour = 6;
    const rowIndex = Math.floor((nowMin - startHour * 60) / 30);
    if (rowIndex >= 0) {
        const rows = document.querySelectorAll('.timeline-row');
        if (rows[rowIndex]) {
            const existing = document.querySelector('.now-line');
            if (existing) existing.remove();
            const line = document.createElement('div');
            line.className = 'now-line';
            line.style.top = `${rows[rowIndex].offsetTop + 20}px`;
            const grid = document.querySelector('.calendar-grid');
            if (grid) {
                grid.style.position = 'relative';
                grid.appendChild(line);
            }
        }
    }
}

function scrollToNow() {
    if (currentView !== 'week') return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startHour = 6;
    const rowIndex = Math.floor((nowMin - startHour * 60) / 30);
    if (rowIndex >= 0) {
        const rows = document.querySelectorAll('.timeline-row');
        if (rows[rowIndex]) {
            rows[rowIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

async function detectConflicts() {
    conflicts = [];
    for (let ev of events) {
        const evStart = toMinutes(ev.startTime);
        const evEnd = toMinutes(ev.endTime);
        for (let busy of busyBlocks) {
            const busyStart = toMinutes(busy.startTime);
            const busyEnd = toMinutes(busy.endTime);
            if (evStart < busyEnd && evEnd > busyStart) {
                conflicts.push({ type: 'busy', event: ev, busy });
            }
        }
    }
}