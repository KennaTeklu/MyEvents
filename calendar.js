// calendar.js - Calendar rendering logic (Week/Month/Conflict Engine)
// Must be loaded after state.js, utils.js, db.js

// ========== RENDERER ==========
async function renderCalendar() {
    const container = document.getElementById('calendarGrid');
    if (!container) return;
    const isMobile = window.innerWidth < 768;
    
    // Clear existing
    container.innerHTML = '';
    
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

// ========== WEEK VIEW ==========
async function renderWeekView(container) {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - ((currentDate.getDay() - firstDayOfWeek + 7) % 7));
    const days = Array.from({length: 7}, (_, i) => addDays(startOfWeek, i));

    // Build Header
    let html = `<div class="weekdays flex">`;
    days.forEach(d => {
        const isToday = formatDate(d) === formatDate(new Date());
        html += `<div class="day-header flex-1 text-center font-semibold py-2 ${isToday ? 'today-header' : ''}">${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.getDate()}</div>`;
    });
    html += `</div>`;

    // Build Grid (6AM to 10PM)
    for (let hour = 6; hour < 22; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
            const currentMin = hour * 60 + minute;
            html += `<div class="timeline-row"><div class="time-col">${formatTime(currentMin)}</div><div class="days-row">`;
            
            for (let day of days) {
                const dayStr = formatDate(day);
                const dayEvents = getEventsForDate(dayStr);
                const dayBusy = getBusyBlocksForDate(dayStr).filter(b => toMinutes(b.endTime) > currentMin && toMinutes(b.startTime) < currentMin + 30);

                html += `<div class="day-cell relative" data-date="${dayStr}">`;
                
                // 1. Busy Overlays
                for (let busy of dayBusy) {
                    const top = ((Math.max(toMinutes(busy.startTime), currentMin) - currentMin) / 30) * 100;
                    const height = ((Math.min(toMinutes(busy.endTime), currentMin + 30) - Math.max(toMinutes(busy.startTime), currentMin)) / 30) * 100;
                    html += `<div class="busy-overlay" style="top:${top}%; height:${height}%;"></div>`;
                }

                // 2. Events
                for (let ev of dayEvents) {
                    const s = toMinutes(ev.startTime);
                    const e = toMinutes(ev.endTime);
                    if (e > currentMin && s < currentMin + 30) {
                        const top = ((Math.max(s, currentMin) - currentMin) / 30) * 100;
                        const height = ((Math.min(e, currentMin + 30) - Math.max(s, currentMin)) / 30) * 100;
                        
                        // Conflict check: overlaps with any busy block?
                        const hasConflict = dayBusy.some(b => e > toMinutes(b.startTime) && s < toMinutes(b.endTime));
                        
                        html += `<div class="event-block ${ev.isLocked ? 'locked' : ''} ${hasConflict ? 'conflict' : ''}" 
                                   data-id="${ev.id}" data-date="${dayStr}" style="top:${top}%; height:${height}%; background-color:${ev.color || '#3b82f6'};">
                                   ${escapeHtml(ev.name)} <span class="event-time">${formatTime(s)}-${formatTime(e)}</span>
                                 </div>`;
                    }
                }
                html += `</div>`;
            }
            html += `</div></div>`;
        }
    }
    container.innerHTML = html;
}

// ========== MONTH VIEW ==========
async function renderMonthView(container) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const start = new Date(year, month, 1);
    start.setDate(1 - ((start.getDay() - firstDayOfWeek + 7) % 7));
    
    let html = `<div class="month-view"><div class="weekdays flex">${['S','M','T','W','T','F','S'].map(d => `<div class="day-header flex-1 text-center py-2">${d}</div>`).join('')}</div>`;
    
    for (let w = 0; w < 5; w++) {
        html += `<div class="flex">`;
        for (let d = 0; d < 7; d++) {
            const date = addDays(start, w * 7 + d);
            const dateStr = formatDate(date);
            const dayEvents = getEventsForDate(dateStr);
            html += `<div class="day-cell flex-1 border p-1" data-date="${dateStr}">
                        <div class="text-right text-xs">${date.getDate()}</div>`;
            dayEvents.slice(0, 2).forEach(ev => {
                html += `<div class="event-block-month" data-id="${ev.id}" data-date="${dateStr}">${escapeHtml(ev.name)}</div>`;
            });
            if (dayEvents.length > 2) html += `<div class="text-[9px] text-blue-500 text-center">+${dayEvents.length - 2}</div>`;
            html += `</div>`;
        }
        html += `</div>`;
    }
    container.innerHTML = html;
}

// ========== HELPERS ==========
function updateDateRangeDisplay() {
    const display = document.getElementById('dateRangeDisplay');
    if (!display) return;
    display.innerText = currentView === 'week' ? 'Week View' : currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
}

function formatTime(min) {
    let h = Math.floor(min / 60);
    let m = min % 60;
    if (timeFormat === '12h') {
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
    }
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function updateNowLine() {
    if (currentView !== 'week') return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const rows = document.querySelectorAll('.timeline-row');
    const startHour = 6;
    const idx = Math.floor((nowMin - startHour * 60) / 30);
    if (idx >= 0 && rows[idx]) {
        document.querySelector('.now-line')?.remove();
        const line = document.createElement('div');
        line.className = 'now-line';
        line.style.top = `${rows[idx].offsetTop + 20}px`;
        document.querySelector('.calendar-grid').appendChild(line);
    }
}

function scrollToNow() {
    if (currentView !== 'week') return;
    const now = new Date();
    const idx = Math.floor((now.getHours() * 60 + now.getMinutes() - 360) / 30);
    const rows = document.querySelectorAll('.timeline-row');
    if (idx >= 0 && rows[idx]) rows[idx].scrollIntoView({ block: 'center' });
}

function attachCalendarEvents() {
    // Logic for tooltips and clicks moved here as requested
    const container = document.getElementById('calendarGrid');
    container.oncontextmenu = (e) => {
        const block = e.target.closest('.event-block');
        if (block) { e.preventDefault(); showContextMenu(e.clientX, e.clientY, parseInt(block.dataset.id), block.dataset.date); }
    };
}
