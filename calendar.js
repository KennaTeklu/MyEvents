// calendar.js - Enhanced Calendar Rendering with scheduled events, todos, travel blocks, feedback
// Must be loaded after state.js, utils.js, db.js, modals.js

// Use global constant from constants.js
const PIXELS_PER_MIN = PIXELS_PER_MINUTE;

// ========== GLOBAL RENDER FUNCTION ==========
async function renderCalendar() {
    const container = document.getElementById('calendarGrid');
    if (!container) return;
    const isMobile = window.innerWidth < 768;

    container.innerHTML = ''; // clear

    if (currentView === 'week') {
        if (isMobile) await renderMobileWeekView(container);
        else await renderWeekView(container);
    } else if (currentView === 'month') {
        await renderMonthView(container);
    } else if (currentView === 'day') {
        await renderDayView(container);
    }

    attachCalendarEvents();
    updateNowLine();
    scrollToNow();
    updateDateRangeDisplay();
}

// ========== HELPER: GET DISPLAY EVENTS (master + scheduled) ==========
// getDisplayEventsForDate is now defined in utils.js; use that version.

// ========== HELPER: GET DISPLAY BUSY (for conflict detection) ==========
function getDisplayBusyForDate(dateStr) {
    return getBusyBlocksForDate(dateStr);
}

// ========== WEEK VIEW (desktop) ==========
async function renderWeekView(container) {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - ((currentDate.getDay() - firstDayOfWeek + 7) % 7));
    const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek, i));

    let earliestHour = 24, latestHour = 0;
    for (const day of days) {
        const dateStr = formatDate(day);
        const dayEvents = getDisplayEventsForDate(dateStr);
        for (const ev of dayEvents) {
            const startMin = toMinutes(ev.startTime);
            const endMin = toMinutes(ev.endTime);
            earliestHour = Math.min(earliestHour, Math.floor(startMin / 60));
            latestHour = Math.max(latestHour, Math.ceil(endMin / 60));
        }
        const dayBusy = getDisplayBusyForDate(dateStr);
        for (const busy of dayBusy) {
            const startMin = toMinutes(busy.startTime);
            const endMin = toMinutes(busy.endTime);
            earliestHour = Math.min(earliestHour, Math.floor(startMin / 60));
            latestHour = Math.max(latestHour, Math.ceil(endMin / 60));
        }
    }
    earliestHour = Math.max(6, earliestHour - 1);
    latestHour = Math.min(22, latestHour + 1);
    if (earliestHour >= latestHour) { earliestHour = 6; latestHour = 22; }

    const totalMinutes = (latestHour - earliestHour) * 60;
    const dayHeight = totalMinutes * PIXELS_PER_MIN;

    let html = `<div class="weekdays flex">`;
    days.forEach(d => {
        const isToday = formatDate(d) === formatDate(new Date());
        html += `<div class="day-header flex-1 text-center font-semibold py-2 ${isToday ? 'today-header' : ''}">
                    ${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.getDate()}
                 </div>`;
    });
    html += `</div>`;
    html += `<div class="timeline-container" style="display: flex;">`;

    // Time labels column
    html += `<div class="time-col" style="width: 70px; flex-shrink: 0;">`;
    for (let minute = earliestHour * 60; minute <= latestHour * 60; minute += 30) {
        html += `<div style="height: ${30 * PIXELS_PER_MIN}px; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; font-size: 0.7rem;">${formatTime(minute)}</div>`;
    }
    html += `</div>`;

    html += `<div class="days-row" style="display: flex; flex: 1; overflow-x: auto;">`;

    for (const day of days) {
        const dayStr = formatDate(day);
        const dayEvents = getDisplayEventsForDate(dayStr);
        const dayBusy = getDisplayBusyForDate(dayStr);
        const isToday = dayStr === formatDate(new Date());

        html += `<div class="day-cell relative" data-date="${dayStr}" style="flex: 1; min-width: 100px; height: ${dayHeight}px; position: relative; background: ${isToday ? '#eff6ff' : 'white'}; border-right: 1px solid #e5e7eb;">`;

        // Busy overlays
        for (const busy of dayBusy) {
            const startMin = toMinutes(busy.startTime);
            const endMin = toMinutes(busy.endTime);
            if (endMin > earliestHour * 60 && startMin < latestHour * 60) {
                const startOffset = Math.max(startMin, earliestHour * 60);
                const endOffset = Math.min(endMin, latestHour * 60);
                const top = (startOffset - earliestHour * 60) * PIXELS_PER_MIN;
                const height = (endOffset - startOffset) * PIXELS_PER_MIN;
                html += `<div class="busy-overlay ${busy.hard ? 'hard' : ''}" style="position: absolute; top: ${top}px; height: ${height}px; left: 0; right: 0; pointer-events: auto; cursor: pointer;"></div>`;
            }
        }

        // Events
        const eventsToRender = dayEvents;
        // Also show todos if setting enabled (as small icons)
        if (userSettings.showTodosInCalendar) {
            const todosDue = todos.filter(t => !t.completed && t.dueDate === dayStr);
            // Show todo count as a badge in top right corner of day cell
            if (todosDue.length > 0) {
                html += `<div class="todo-badge" style="position: absolute; top: 2px; right: 2px; background: #f59e0b; color: white; border-radius: 12px; padding: 0px 6px; font-size: 10px; font-weight: bold;">📝${todosDue.length}</div>`;
            }
        }

        for (const ev of eventsToRender) {
            const startMin = toMinutes(ev.startTime);
            const endMin = toMinutes(ev.endTime);
            if (endMin > earliestHour * 60 && startMin < latestHour * 60) {
                const startOffset = Math.max(startMin, earliestHour * 60);
                const endOffset = Math.min(endMin, latestHour * 60);
                const top = (startOffset - earliestHour * 60) * PIXELS_PER_MIN;
                const height = (endOffset - startOffset) * PIXELS_PER_MIN;

                const isNogo = overrides.has(`${ev.id}_${dayStr}`) && overrides.get(`${ev.id}_${dayStr}`).type === 'nogo';
                const isLocked = overrides.has(`${ev.id}_${dayStr}`) && overrides.get(`${ev.id}_${dayStr}`).type === 'locked';
                const hasConflict = dayBusy.some(b => endMin > toMinutes(b.startTime) && startMin < toMinutes(b.endTime)) ||
                                   eventsToRender.some(other => other.id !== ev.id && endMin > toMinutes(other.startTime) && startMin < toMinutes(other.endTime));
                const isScheduled = ev.isScheduled || false;
                const duration = endMin - startMin;
                const isShort = duration < 30;

                let extraClasses = '';
                if (isNogo) extraClasses += ' nogo';
                if (isLocked) extraClasses += ' locked';
                if (hasConflict) extraClasses += ' conflict-pulse';
                if (isScheduled) extraClasses += ' scheduled';

                html += `<div class="event-block${extraClasses} ${isShort ? 'short-block' : ''}"
                            data-id="${ev.id}" data-date="${dayStr}"
                            style="position: absolute; top: ${top}px; height: ${height}px; left: 2px; right: 2px; background-color: ${ev.color || '#3b82f6'}; border-radius: 6px; padding: 2px 4px; font-size: 0.7rem; font-weight: 600; color: white; cursor: pointer; overflow: hidden; white-space: normal; z-index: 10;"
                            role="button" tabindex="0"
                            aria-label="${escapeHtml(ev.name)}, ${formatTime(startMin)} to ${formatTime(endMin)}">
                            ${escapeHtml(ev.name)}
                            <span class="event-time" style="font-size: 0.6rem; font-weight: normal; display: block;">${formatTime(startMin)}–${formatTime(endMin)}</span>
                            ${hasConflict ? '<span class="conflict-label" style="position: absolute; top: 2px; right: 2px; background: red; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; text-align: center;">⚠️</span>' : ''}
                            ${isScheduled ? '<span class="scheduled-label" style="position: absolute; bottom: 2px; right: 2px; font-size: 8px; background: rgba(0,0,0,0.4); padding: 0px 2px; border-radius: 3px;">⚙️</span>' : ''}
                        </div>`;
                // Travel block (only if event has travel time and it's the first event of the day? We'll show above event)
                const travelMins = ev.travelMins || (ev.travelTimeFromPrev || 0);
                if (travelMins > 0 && startOffset > earliestHour * 60) {
                    const travelTop = top - (travelMins * PIXELS_PER_MIN);
                    if (travelTop >= 0) {
                        html += `<div class="travel-block" style="position: absolute; top: ${travelTop}px; height: ${travelMins * PIXELS_PER_MIN}px; left: 2px; right: 2px; background: #9ca3af; border-radius: 4px; font-size: 0.6rem; text-align: center; color: white; line-height: 1.2; z-index: 9;">🚗 ${travelMins} min</div>`;
                    }
                }
            }
        }

        html += `</div>`;
    }

    html += `</div></div>`;
    container.innerHTML = html;

    const totalEventsThisWeek = days.reduce((acc, day) => acc + getDisplayEventsForDate(formatDate(day)).length, 0);
    if (totalEventsThisWeek === 0 && (!userSettings.showTodosInCalendar || todos.filter(t => !t.completed).length === 0)) {
        renderEmptyState(container);
    }
}

// ========== MOBILE WEEK VIEW ==========
async function renderMobileWeekView(container) {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - ((currentDate.getDay() - firstDayOfWeek + 7) % 7));
    const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek, i));

    let earliestHour = 24, latestHour = 0;
    for (const day of days) {
        const dateStr = formatDate(day);
        const dayEvents = getDisplayEventsForDate(dateStr);
        for (const ev of dayEvents) {
            const startMin = toMinutes(ev.startTime);
            const endMin = toMinutes(ev.endTime);
            earliestHour = Math.min(earliestHour, Math.floor(startMin / 60));
            latestHour = Math.max(latestHour, Math.ceil(endMin / 60));
        }
        const dayBusy = getDisplayBusyForDate(dateStr);
        for (const busy of dayBusy) {
            const startMin = toMinutes(busy.startTime);
            const endMin = toMinutes(busy.endTime);
            earliestHour = Math.min(earliestHour, Math.floor(startMin / 60));
            latestHour = Math.max(latestHour, Math.ceil(endMin / 60));
        }
    }
    earliestHour = Math.max(6, earliestHour - 1);
    latestHour = Math.min(22, latestHour + 1);
    if (earliestHour >= latestHour) { earliestHour = 6; latestHour = 22; }

    const totalMinutes = (latestHour - earliestHour) * 60;
    const dayHeight = totalMinutes * PIXELS_PER_MIN;

    let html = `<div class="weekdays flex overflow-x-auto">`;
    days.forEach(d => {
        const isToday = formatDate(d) === formatDate(new Date());
        html += `<div class="day-header text-center font-semibold py-2 ${isToday ? 'today-header' : ''}" style="min-width: 80px; flex-shrink: 0;">
                    ${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.getDate()}
                 </div>`;
    });
    html += `</div>`;
    html += `<div class="timeline-container" style="display: flex;">`;
    html += `<div class="time-col" style="width: 70px; flex-shrink: 0;">`;
    for (let minute = earliestHour * 60; minute <= latestHour * 60; minute += 30) {
        html += `<div style="height: ${30 * PIXELS_PER_MIN}px; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; font-size: 0.7rem;">${formatTime(minute)}</div>`;
    }
    html += `</div>`;
    html += `<div class="days-row" style="display: flex; flex: 1; overflow-x: auto;">`;

    for (const day of days) {
        const dayStr = formatDate(day);
        const dayEvents = getDisplayEventsForDate(dayStr);
        const dayBusy = getDisplayBusyForDate(dayStr);
        const isToday = dayStr === formatDate(new Date());

        html += `<div class="day-cell relative" data-date="${dayStr}" style="flex: 0 0 90px; min-width: 90px; height: ${dayHeight}px; position: relative; background: ${isToday ? '#eff6ff' : 'white'}; border-right: 1px solid #e5e7eb;">`;
        for (const busy of dayBusy) {
            const startMin = toMinutes(busy.startTime);
            const endMin = toMinutes(busy.endTime);
            if (endMin > earliestHour * 60 && startMin < latestHour * 60) {
                const startOffset = Math.max(startMin, earliestHour * 60);
                const endOffset = Math.min(endMin, latestHour * 60);
                const top = (startOffset - earliestHour * 60) * PIXELS_PER_MIN;
                const height = (endOffset - startOffset) * PIXELS_PER_MIN;
                html += `<div class="busy-overlay ${busy.hard ? 'hard' : ''}" style="position: absolute; top: ${top}px; height: ${height}px; left: 0; right: 0;"></div>`;
            }
        }
        if (userSettings.showTodosInCalendar) {
            const todosDue = todos.filter(t => !t.completed && t.dueDate === dayStr);
            if (todosDue.length > 0) {
                html += `<div class="todo-badge" style="position: absolute; top: 2px; right: 2px; background: #f59e0b; color: white; border-radius: 12px; padding: 0px 6px; font-size: 10px; font-weight: bold;">📝${todosDue.length}</div>`;
            }
        }
        for (const ev of dayEvents) {
            const startMin = toMinutes(ev.startTime);
            const endMin = toMinutes(ev.endTime);
            if (endMin > earliestHour * 60 && startMin < latestHour * 60) {
                const startOffset = Math.max(startMin, earliestHour * 60);
                const endOffset = Math.min(endMin, latestHour * 60);
                const top = (startOffset - earliestHour * 60) * PIXELS_PER_MIN;
                const height = (endOffset - startOffset) * PIXELS_PER_MIN;

                const isNogo = overrides.has(`${ev.id}_${dayStr}`) && overrides.get(`${ev.id}_${dayStr}`).type === 'nogo';
                const isLocked = overrides.has(`${ev.id}_${dayStr}`) && overrides.get(`${ev.id}_${dayStr}`).type === 'locked';
                const hasConflict = dayBusy.some(b => endMin > toMinutes(b.startTime) && startMin < toMinutes(b.endTime)) ||
                                   dayEvents.some(other => other.id !== ev.id && endMin > toMinutes(other.startTime) && startMin < toMinutes(other.endTime));
                const isScheduled = ev.isScheduled || false;

                let extraClasses = '';
                if (isNogo) extraClasses += ' nogo';
                if (isLocked) extraClasses += ' locked';
                if (hasConflict) extraClasses += ' conflict-pulse';
                if (isScheduled) extraClasses += ' scheduled';

                html += `<div class="event-block${extraClasses}"
                            data-id="${ev.id}" data-date="${dayStr}"
                            style="position: absolute; top: ${top}px; height: ${height}px; left: 2px; right: 2px; background-color: ${ev.color || '#3b82f6'}; border-radius: 6px; padding: 2px 4px; font-size: 0.7rem; font-weight: 600; color: white; cursor: pointer; overflow: hidden; white-space: normal; z-index: 10;">
                            ${escapeHtml(ev.name)}
                            <span class="event-time" style="font-size: 0.6rem; font-weight: normal; display: block;">${formatTime(startMin)}–${formatTime(endMin)}</span>
                            ${hasConflict ? '<span class="conflict-label" style="position: absolute; top: 2px; right: 2px; background: red; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; text-align: center;">⚠️</span>' : ''}
                            ${isScheduled ? '<span class="scheduled-label" style="position: absolute; bottom: 2px; right: 2px; font-size: 8px; background: rgba(0,0,0,0.4); padding: 0px 2px; border-radius: 3px;">⚙️</span>' : ''}
                        </div>`;
            }
        }
        html += `</div>`;
    }

    html += `</div></div>`;
    container.innerHTML = html;
}

// ========== MONTH VIEW (with scheduled events and todo badges) ==========
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
            const date = addDays(startDate, w * 7 + d);
            week.push(date);
        }
        weeks.push(week);
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const orderedDayNames = [...dayNames.slice(firstDayOfWeek), ...dayNames.slice(0, firstDayOfWeek)];
    let html = `<div class="month-view"><div class="weekdays flex">${orderedDayNames.map(d => `<div class="day-header flex-1 text-center py-2">${d}</div>`).join('')}</div>`;

    for (const week of weeks) {
        html += `<div class="flex">`;
        for (const date of week) {
            const dateStr = formatDate(date);
            const dayEvents = getDisplayEventsForDate(dateStr);
            const isCurrentMonth = date.getMonth() === month;
            const isToday = dateStr === formatDate(new Date());

            html += `<div class="day-cell flex-1 border min-h-24 p-1 ${isCurrentMonth ? '' : 'text-gray-400'} ${isToday ? 'today-cell' : ''}" data-date="${dateStr}">
                        <div class="text-right text-sm font-semibold cursor-pointer" data-nav-date="${dateStr}">${date.getDate()}</div>`;
            // Show up to 3 events
            const maxDisplay = 3;
            let eventCount = 0;
            for (let i = 0; i < Math.min(dayEvents.length, maxDisplay); i++) {
                const ev = dayEvents[i];
                const isNogo = overrides.has(`${ev.id}_${dateStr}`) && overrides.get(`${ev.id}_${dateStr}`).type === 'nogo';
                const hasConflict = getDisplayBusyForDate(dateStr).some(b => toMinutes(ev.endTime) > toMinutes(b.startTime) && toMinutes(ev.startTime) < toMinutes(b.endTime)) ||
                                   dayEvents.some(other => other.id !== ev.id && toMinutes(ev.endTime) > toMinutes(other.startTime) && toMinutes(ev.startTime) < toMinutes(other.endTime));
                const isScheduled = ev.isScheduled || false;
                html += `<div class="event-block-month ${isNogo ? 'nogo' : ''} ${hasConflict ? 'conflict-pulse' : ''} ${isScheduled ? 'scheduled' : ''} text-xs rounded p-1 mt-1 truncate"
                            data-id="${ev.id}" data-date="${dateStr}" style="background-color:${ev.color || '#3b82f6'};">
                            ${escapeHtml(ev.name)}
                            ${isScheduled ? '⚙️' : ''}
                         </div>`;
                eventCount++;
            }
            if (dayEvents.length > maxDisplay) {
                html += `<div class="text-xs text-blue-500 mt-1 cursor-pointer more-events" data-date="${dateStr}">+${dayEvents.length - maxDisplay} more</div>`;
            }
            // Show todo badge
            if (userSettings.showTodosInCalendar) {
                const todosDue = todos.filter(t => !t.completed && t.dueDate === dateStr);
                if (todosDue.length > 0) {
                    html += `<div class="todo-badge text-xs text-gray-500 mt-1">📝 ${todosDue.length}</div>`;
                }
            }
            html += `</div>`;
        }
        html += `</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;

    // Attach "more events" click handlers
    container.querySelectorAll('.more-events').forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            const dateStr = el.dataset.date;
            const dayEvents = getDisplayEventsForDate(dateStr);
            const existing = document.getElementById('moreEventsPopup');
            if (existing) existing.remove();
            const popup = document.createElement('div');
            popup.id = 'moreEventsPopup';
            popup.className = 'event-tooltip';
            popup.style.pointerEvents = 'auto';
            popup.style.left = e.clientX + 'px';
            popup.style.top = e.clientY + 'px';
            popup.innerHTML = `<div class="font-semibold mb-2">${formatDateDisplay(dateStr)}</div>` +
                dayEvents.map(ev => `<div class="py-1 border-b border-gray-100 dark:border-slate-700 text-xs">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${ev.color || '#3b82f6'}; margin-right:4px;"></span>
                    ${formatTime(toMinutes(ev.startTime))} ${escapeHtml(ev.name)} ${ev.isScheduled ? '⚙️' : ''}
                </div>`).join('') +
                `<button class="mt-2 text-xs text-gray-400 w-full text-right">Close</button>`;
            document.body.appendChild(popup);
            popup.querySelector('button').onclick = () => popup.remove();
            document.addEventListener('click', () => popup.remove(), { once: true });
        };
    });

    container.querySelectorAll('[data-nav-date]').forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            currentDate = new Date(el.dataset.navDate + 'T12:00:00');
            currentView = 'week';
            document.getElementById('viewToggleBtn').innerHTML = '<i class="fas fa-calendar-week"></i> Week';
            renderCalendar();
        };
    });
}

// ========== DAY VIEW (new) ==========
async function renderDayView(container) {
    const date = currentDate;
    const dateStr = formatDate(date);
    const dayEvents = getDisplayEventsForDate(dateStr);
    const dayBusy = getDisplayBusyForDate(dateStr);

    let earliestHour = 24, latestHour = 0;
    for (const ev of dayEvents) {
        const startMin = toMinutes(ev.startTime);
        const endMin = toMinutes(ev.endTime);
        earliestHour = Math.min(earliestHour, Math.floor(startMin / 60));
        latestHour = Math.max(latestHour, Math.ceil(endMin / 60));
    }
    for (const busy of dayBusy) {
        const startMin = toMinutes(busy.startTime);
        const endMin = toMinutes(busy.endTime);
        earliestHour = Math.min(earliestHour, Math.floor(startMin / 60));
        latestHour = Math.max(latestHour, Math.ceil(endMin / 60));
    }
    earliestHour = Math.max(6, earliestHour - 1);
    latestHour = Math.min(22, latestHour + 1);
    if (earliestHour >= latestHour) { earliestHour = 6; latestHour = 22; }

    const totalMinutes = (latestHour - earliestHour) * 60;
    const containerHeight = totalMinutes * PIXELS_PER_MIN;

    let html = `<div class="day-view">
                    <div class="day-header text-center font-semibold py-2">${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                    <div class="timeline-container" style="display: flex;">
                        <div class="time-col" style="width: 70px; flex-shrink: 0;">`;
    for (let minute = earliestHour * 60; minute <= latestHour * 60; minute += 30) {
        html += `<div style="height: ${30 * PIXELS_PER_MIN}px; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; font-size: 0.7rem;">${formatTime(minute)}</div>`;
    }
    html += `</div><div class="day-cell" style="flex:1; position: relative; height: ${containerHeight}px; background: white; border-left: 1px solid #e5e7eb;">`;

    for (const busy of dayBusy) {
        const startMin = toMinutes(busy.startTime);
        const endMin = toMinutes(busy.endTime);
        if (endMin > earliestHour * 60 && startMin < latestHour * 60) {
            const startOffset = Math.max(startMin, earliestHour * 60);
            const endOffset = Math.min(endMin, latestHour * 60);
            const top = (startOffset - earliestHour * 60) * PIXELS_PER_MIN;
            const height = (endOffset - startOffset) * PIXELS_PER_MIN;
            html += `<div class="busy-overlay ${busy.hard ? 'hard' : ''}" style="position: absolute; top: ${top}px; height: ${height}px; left: 0; right: 0;"></div>`;
        }
    }

    for (const ev of dayEvents) {
        const startMin = toMinutes(ev.startTime);
        const endMin = toMinutes(ev.endTime);
        if (endMin > earliestHour * 60 && startMin < latestHour * 60) {
            const startOffset = Math.max(startMin, earliestHour * 60);
            const endOffset = Math.min(endMin, latestHour * 60);
            const top = (startOffset - earliestHour * 60) * PIXELS_PER_MIN;
            const height = (endOffset - startOffset) * PIXELS_PER_MIN;

            const isNogo = overrides.has(`${ev.id}_${dateStr}`) && overrides.get(`${ev.id}_${dateStr}`).type === 'nogo';
            const isLocked = overrides.has(`${ev.id}_${dateStr}`) && overrides.get(`${ev.id}_${dateStr}`).type === 'locked';
            const hasConflict = dayBusy.some(b => endMin > toMinutes(b.startTime) && startMin < toMinutes(b.endTime)) ||
                               dayEvents.some(other => other.id !== ev.id && endMin > toMinutes(other.startTime) && startMin < toMinutes(other.endTime));
            const isScheduled = ev.isScheduled || false;

            let extraClasses = '';
            if (isNogo) extraClasses += ' nogo';
            if (isLocked) extraClasses += ' locked';
            if (hasConflict) extraClasses += ' conflict-pulse';
            if (isScheduled) extraClasses += ' scheduled';

            html += `<div class="event-block${extraClasses}"
                        data-id="${ev.id}" data-date="${dateStr}"
                        style="position: absolute; top: ${top}px; height: ${height}px; left: 2px; right: 2px; background-color: ${ev.color || '#3b82f6'}; border-radius: 6px; padding: 2px 4px; font-size: 0.7rem; font-weight: 600; color: white; cursor: pointer; overflow: hidden; white-space: normal; z-index: 10;">
                        ${escapeHtml(ev.name)}
                        <span class="event-time" style="font-size: 0.6rem; font-weight: normal; display: block;">${formatTime(startMin)}–${formatTime(endMin)}</span>
                        ${hasConflict ? '<span class="conflict-label" style="position: absolute; top: 2px; right: 2px; background: red; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; text-align: center;">⚠️</span>' : ''}
                        ${isScheduled ? '<span class="scheduled-label" style="position: absolute; bottom: 2px; right: 2px; font-size: 8px; background: rgba(0,0,0,0.4); padding: 0px 2px; border-radius: 3px;">⚙️</span>' : ''}
                    </div>`;
        }
    }

    html += `</div></div>`;
    container.innerHTML = html;
    if (dayEvents.length === 0 && (!userSettings.showTodosInCalendar || todos.filter(t => !t.completed && t.dueDate === dateStr).length === 0)) {
        renderEmptyState(container);
    }
}

// ========== EMPTY STATE ==========
function renderEmptyState(container) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-state';
    emptyDiv.innerHTML = `
        <i class="fas fa-calendar-plus"></i>
        <div class="text-lg font-medium mb-1">No events</div>
        <div class="text-sm">Tap <strong>+</strong> to add your first event</div>
    `;
    container.style.position = 'relative';
    container.appendChild(emptyDiv);
}

// ========== EVENT TOOLTIP (with like/dislike) ==========
let tooltipEl = null;

function showEventTooltip(ev, x, y) {
    hideEventTooltip();
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'event-tooltip';
    const stars = '★'.repeat(ev.priority || 3) + '☆'.repeat(5 - (ev.priority || 3));
    tooltipEl.innerHTML = `
        <div class="tooltip-title">${escapeHtml(ev.name)}</div>
        <div class="tooltip-time">${formatTime(toMinutes(ev.startTime))} – ${formatTime(toMinutes(ev.endTime))}</div>
        <div style="font-size:0.75rem; color:#f59e0b;">${stars}</div>
        ${ev.travelMins ? `<div style="color:#9ca3af; font-size:0.7rem;">🚗 ${ev.travelMins} min travel</div>` : ''}
        ${ev.notes ? `<div class="tooltip-notes">${escapeHtml(ev.notes.slice(0, 80))}${ev.notes.length > 80 ? '…' : ''}</div>` : ''}
        <div style="display: flex; gap: 8px; margin-top: 8px;">
            <button class="feedback-like" data-id="${ev.id}" style="background: none; border: none; cursor: pointer; font-size: 0.8rem;">👍 Like</button>
            <button class="feedback-dislike" data-id="${ev.id}" style="background: none; border: none; cursor: pointer; font-size: 0.8rem;">👎 Dislike</button>
        </div>
        <div style="font-size:0.65rem; color:#9ca3af; margin-top:0.25rem;">Right‑click for options</div>
    `;
    tooltipEl.style.left = (x + 12) + 'px';
    tooltipEl.style.top = (y - 10) + 'px';
    document.body.appendChild(tooltipEl);
    const rect = tooltipEl.getBoundingClientRect();
    if (rect.right > window.innerWidth - 10) {
        tooltipEl.style.left = (x - rect.width - 12) + 'px';
    }
    if (rect.bottom > window.innerHeight - 10) {
        tooltipEl.style.top = (y - rect.height + 10) + 'px';
    }

    // Attach feedback handlers
    const likeBtn = tooltipEl.querySelector('.feedback-like');
    const dislikeBtn = tooltipEl.querySelector('.feedback-dislike');
    if (likeBtn) likeBtn.onclick = () => { submitFeedback(ev.id, 'like'); hideEventTooltip(); };
    if (dislikeBtn) dislikeBtn.onclick = () => { submitFeedback(ev.id, 'dislike'); hideEventTooltip(); };
}

function hideEventTooltip() {
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
}

async function submitFeedback(eventId, type) {
    const feedback = {
        eventId,
        type,
        timestamp: new Date().toISOString()
    };
    await addRecord('userFeedback', feedback);
    await addRecord('learningData', { type: 'preference', eventId, preference: type, timestamp: new Date() });
    showToast(`Thanks for your feedback!`, 'success');
    // Optionally re-run optimizer
    if (typeof runOptimizer === 'function') runOptimizer();
}

// ========== ATTACH ALL CALENDAR INTERACTIONS ==========
function attachCalendarEvents() {
    const container = document.getElementById('calendarGrid');
    if (!container) return;

    container.onclick = (e) => {
        const block = e.target.closest('.event-block, .event-block-month');
        if (block) {
            e.stopPropagation();
            hideEventTooltip();
            const id = parseInt(block.dataset.id);
            const dateStr = block.dataset.date;
            const ev = events.find(ev => ev.id === id);
            if (ev) openEventModal(ev, dateStr);
        }
    };

    container.oncontextmenu = (e) => {
        const block = e.target.closest('.event-block, .event-block-month');
        const cell = e.target.closest('.day-cell');
        if (block) {
            e.preventDefault();
            hideEventTooltip();
            showContextMenu(e.clientX, e.clientY, parseInt(block.dataset.id), block.dataset.date);
        } else if (cell && cell.dataset.date) {
            e.preventDefault();
            openBusyModal(null, cell.dataset.date);
        }
    };

    if (window.matchMedia('(hover: hover)').matches) {
        container.addEventListener('mouseover', (e) => {
            const block = e.target.closest('.event-block, .event-block-month');
            if (block) {
                const id = parseInt(block.dataset.id);
                const ev = events.find(ev => ev.id === id);
                if (ev) showEventTooltip(ev, e.clientX, e.clientY);
            }
        });
        container.addEventListener('mouseout', (e) => {
            if (!e.target.closest('.event-block, .event-block-month')) hideEventTooltip();
        });
        container.addEventListener('mousemove', (e) => {
            if (tooltipEl) {
                tooltipEl.style.left = (e.clientX + 12) + 'px';
                tooltipEl.style.top = (e.clientY - 10) + 'px';
            }
        });
    }

    container.querySelectorAll('.event-block').forEach(block => {
        block.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const id = parseInt(block.dataset.id);
                const dateStr = block.dataset.date;
                const ev = events.find(ev => ev.id === id);
                if (ev) openEventModal(ev, dateStr);
            }
            if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                e.preventDefault();
                const rect = block.getBoundingClientRect();
                showContextMenu(rect.left, rect.bottom, parseInt(block.dataset.id), block.dataset.date);
            }
        });
    });

    container.querySelectorAll('.busy-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            const cell = overlay.closest('.day-cell');
            if (cell) openBusyModal(null, cell.dataset.date);
        });
    });

    let pressTimer = null;
    container.addEventListener('touchstart', (e) => {
        const block = e.target.closest('.event-block, .event-block-month');
        const cell = e.target.closest('.day-cell');
        pressTimer = setTimeout(() => {
            if (block) {
                showContextMenu(
                    e.touches[0].clientX,
                    e.touches[0].clientY,
                    parseInt(block.dataset.id),
                    block.dataset.date
                );
            } else if (cell && cell.dataset.date) {
                openBusyModal(null, cell.dataset.date);
            }
            e.preventDefault();
        }, 500);
    }, { passive: false });
    container.addEventListener('touchend', () => { if (pressTimer) clearTimeout(pressTimer); });
    container.addEventListener('touchmove', () => { if (pressTimer) clearTimeout(pressTimer); });
}

// ========== UI HELPERS ==========
function updateDateRangeDisplay() {
    const display = document.getElementById('dateRangeDisplay');
    if (!display) return;
    if (currentView === 'week') {
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - ((currentDate.getDay() - firstDayOfWeek + 7) % 7));
        const endOfWeek = addDays(startOfWeek, 6);
        display.innerText = `${startOfWeek.toLocaleDateString()} – ${endOfWeek.toLocaleDateString()}`;
    } else if (currentView === 'month') {
        display.innerText = currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    } else if (currentView === 'day') {
        display.innerText = currentDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    }
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
    if (currentView !== 'week' && currentView !== 'day') return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const timeLabels = document.querySelectorAll('.time-col > div');
    if (!timeLabels.length) return;
    const firstTime = parseTime(timeLabels[0].innerText.trim());
    if (firstTime === null) return;
    const earliestHour = Math.floor(firstTime / 60);
    const latestHour = earliestHour + (timeLabels.length * 0.5);

    const totalMinutesRange = (latestHour - earliestHour) * 60;
    const nowOffset = nowMin - earliestHour * 60;
    if (nowOffset >= 0 && nowOffset <= totalMinutesRange) {
        const top = nowOffset * PIXELS_PER_MIN;
        const existing = document.querySelector('.now-line');
        if (existing) existing.remove();
        const line = document.createElement('div');
        line.className = 'now-line';
        line.style.position = 'absolute';
        line.style.top = `${top}px`;
        line.style.left = '70px';
        line.style.right = '0';
        line.style.borderTop = '3px solid #ef4444';
        line.style.zIndex = '20';
        line.style.pointerEvents = 'none';
        document.querySelector('.timeline-container')?.appendChild(line);
    }
}

function parseTime(timeStr) {
    if (timeFormat === '12h') {
        const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (match) {
            let h = parseInt(match[1]);
            const m = parseInt(match[2]);
            const ampm = match[3].toUpperCase();
            if (ampm === 'PM' && h !== 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            return h * 60 + m;
        }
    } else {
        const [h, m] = timeStr.split(':');
        if (h && m) return parseInt(h) * 60 + parseInt(m);
    }
    return null;
}

function scrollToNow() {
    if (currentView !== 'week' && currentView !== 'day') return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const timeLabels = document.querySelectorAll('.time-col > div');
    if (!timeLabels.length) return;
    const firstTime = parseTime(timeLabels[0].innerText.trim());
    if (firstTime === null) return;
    const earliestHour = Math.floor(firstTime / 60);

    const nowOffset = nowMin - earliestHour * 60;
    if (nowOffset >= 0) {
        const top = nowOffset * PIXELS_PER_MIN;
        const timelineContainer = document.querySelector('.timeline-container');
        if (timelineContainer) {
            timelineContainer.scrollTop = Math.max(0, top - 100);
        }
    }
}
