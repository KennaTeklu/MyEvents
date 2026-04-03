/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
/*
 * calendar.js - Enhanced Calendar Rendering with scheduled events, todos, travel blocks, feedback
 * Must be loaded after state.js, utils.js, db.js, modals.js
 */

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
    // Adjust start of week based on user setting (0 = Sun, 1 = Mon)
    startOfWeek.setDate(currentDate.getDate() - ((currentDate.getDay() - firstDayOfWeek + 7) % 7));
    const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek, i));

    // 1. Calculate dynamic hour range to minimize vertical scrolling
    let earliestHour = 24, latestHour = 0;
    for (const day of days) {
        const dateStr = formatDate(day);
        const dayEvents = getDisplayEventsForDate(dateStr);
        dayEvents.forEach(ev => {
            const startMin = toMinutes(ev.startTime);
            const endMin = toMinutes(ev.endTime);
            earliestHour = Math.min(earliestHour, Math.floor(startMin / 60));
            latestHour = Math.max(latestHour, Math.ceil(endMin / 60));
        });
        const dayBusy = getDisplayBusyForDate(dateStr);
        dayBusy.forEach(busy => {
            const startMin = toMinutes(busy.startTime);
            const endMin = toMinutes(busy.endTime);
            earliestHour = Math.min(earliestHour, Math.floor(startMin / 60));
            latestHour = Math.max(latestHour, Math.ceil(endMin / 60));
        });
    }
    // Buffer the range or use defaults if day is empty
    earliestHour = Math.max(0, Math.min(earliestHour - 1, 8)); // Usually start at 8 AM
    latestHour = Math.min(24, Math.max(latestHour + 1, 20));   // Usually end at 8 PM
    
    const totalMinutes = (latestHour - earliestHour) * 60;
    const dayHeight = totalMinutes * PIXELS_PER_MIN;

    // 2. Build the 2D Sticky Scroll Container
    let html = `<div class="timeline-container" style="display: flex; flex-direction: column; flex: 1; overflow: auto; position: relative; height: 100%; background: var(--color-bg);">`;
    
    // Header Row (Sticky to top)
    html += `<div class="weekdays flex" style="position: sticky; top: 0; z-index: 30; background: var(--color-bg); border-bottom: 1px solid var(--color-border); width: 100%; min-width: max-content;">`;
    // Top-left corner spacer (Sticky to left AND top)
    html += `<div style="width: 70px; flex-shrink: 0; position: sticky; left: 0; z-index: 40; background: var(--color-surface); border-right: 1px solid var(--color-border);"></div>`;
    
    days.forEach(d => {
        const isToday = formatDate(d) === formatDate(new Date());
        html += `<div class="day-header flex-1 text-center font-semibold py-2 ${isToday ? 'today-header' : ''}" style="min-width: 120px;">
                    <span class="day-name" style="font-size: 0.7rem; color: var(--color-text-secondary); text-transform: uppercase;">${d.toLocaleDateString(undefined, { weekday: 'short' })}</span><br>
                    <span class="day-number" style="font-size: 1.1rem;">${d.getDate()}</span>
                 </div>`;
    });
    html += `</div>`;

    // 3. Main Grid Body
    html += `<div style="display: flex; flex: 1; width: 100%; min-width: max-content;">`;
    
    // Time Column (Sticky to left)
    html += `<div class="time-col" style="width: 70px; flex-shrink: 0; background: var(--color-surface); position: sticky; left: 0; z-index: 20; border-right: 1px solid var(--color-border);">`;
    for (let minute = earliestHour * 60; minute <= latestHour * 60; minute += 30) {
        html += `<div style="height: ${30 * PIXELS_PER_MIN}px; display: flex; align-items: flex-start; justify-content: flex-end; padding-right: 8px; padding-top: 4px; font-size: 0.7rem; color: var(--color-text-muted); box-sizing: border-box;">${formatTime(minute)}</div>`;
    }
    html += `</div>`;

    // Day Columns
    html += `<div class="days-row" style="display: flex; flex: 1;">`;

    for (const day of days) {
        const dayStr = formatDate(day);
        const dayEvents = getDisplayEventsForDate(dayStr);
        const dayBusy = getDisplayBusyForDate(dayStr);
        const isToday = dayStr === formatDate(new Date());

        html += `<div class="day-cell relative" data-date="${dayStr}" 
            ondragover="dragover_handler(event)"
            ondrop="drop_handler(event)"
            style="flex: 1; min-width: 120px; height: ${dayHeight}px; position: relative; background: ${isToday ? 'var(--color-today-bg)' : 'transparent'}; border-right: 1px solid var(--color-border);">`;

        // 4. Busy overlays (Visual constraints)
        for (const busy of dayBusy) {
            const startMin = toMinutes(busy.startTime);
            const endMin = toMinutes(busy.endTime);
            if (endMin > earliestHour * 60 && startMin < latestHour * 60) {
                const startOffset = Math.max(startMin, earliestHour * 60);
                const endOffset = Math.min(endMin, latestHour * 60);
                const top = (startOffset - earliestHour * 60) * PIXELS_PER_MIN;
                const height = (endOffset - startOffset) * PIXELS_PER_MIN;
                html += `<div class="busy-overlay ${busy.hard ? 'hard' : ''}" data-busy-id="${busy.id}" style="position: absolute; top: ${top}px; height: ${height}px; left: 0; right: 0;"></div>`;
            }
        }

        // 5. Todo badge
        if (userSettings.showTodosInCalendar) {
            const todosDue = todos.filter(t => !t.completed && t.dueDate === dayStr);
            if (todosDue.length > 0) {
                html += `<div class="todo-badge" style="position: absolute; top: 4px; right: 4px; background: var(--color-warning); color: white; border-radius: 12px; padding: 1px 7px; font-size: 10px; font-weight: bold; z-index: 15; box-shadow: var(--shadow-sm);">📝 ${todosDue.length}</div>`;
            }
        }

        // 6. Events (Render with travel blocks and conflicts)
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
                
                // Detailed Conflict Detection
                const hasConflict = dayBusy.some(b => endMin > toMinutes(b.startTime) && startMin < toMinutes(b.endTime)) ||
                                   dayEvents.some(other => other.id !== ev.id && endMin > toMinutes(other.startTime) && startMin < toMinutes(other.endTime));
                
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
                            draggable="true"
                            ondragstart="dragstart_handler(event)"
                            style="position: absolute; top: ${top}px; height: ${height}px; background-color: ${ev.color || 'var(--color-primary)'};"
                            role="button" tabindex="0"
                            aria-label="${escapeHtml(ev.name)}, ${formatTime(startMin)} to ${formatTime(endMin)}">
                            <span class="event-name">${escapeHtml(ev.name)}</span>
                            <span class="event-time">${formatTime(startMin)}–${formatTime(endMin)}</span>
                            ${hasConflict ? '<span class="conflict-label" style="position: absolute; top: 2px; right: 2px; background: var(--color-danger); color: white; border-radius: 50%; width: 18px; height: 18px; font-size: 11px; display: flex; align-items: center; justify-content: center;">⚠️</span>' : ''}
                            ${isScheduled ? '<span class="scheduled-label" style="position: absolute; bottom: 2px; right: 2px; font-size: 9px; background: rgba(0,0,0,0.4); padding: 0px 4px; border-radius: 3px;">⚙️</span>' : ''}
                        </div>`;

                // Travel block (Visual indicator for transit)
                const travelMins = ev.travelMins || (ev.travelTimeFromPrev || 0);
                if (travelMins > 0 && startOffset > earliestHour * 60) {
                    const travelTop = top - (travelMins * PIXELS_PER_MIN);
                    if (travelTop >= 0) {
                        html += `<div class="travel-block" style="position: absolute; top: ${travelTop}px; height: ${travelMins * PIXELS_PER_MIN}px; left: 4px; right: 4px; background: #9ca3af; border-radius: 4px; font-size: 0.65rem; text-align: center; color: white; line-height: 1.2; z-index: 9;">🚗 ${travelMins} min travel</div>`;
                    }
                }
            }
        }
        html += `</div>`;
    }

    html += `</div></div></div>`; // Close days-row, body-row, and timeline-container
    container.innerHTML = html;

    // Show empty state if nothing is planned
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

    let html = `<div class="timeline-container" style="display: flex; flex-direction: column; flex: 1; overflow: auto; position: relative; height: 100%; background: var(--color-bg);">`;
    
    // Header Row (Sticky to top)
    html += `<div class="weekdays flex" style="position: sticky; top: 0; z-index: 30; background: var(--color-bg); border-bottom: 1px solid var(--color-border); width: max-content; min-width: 100%;">`;
    html += `<div style="width: 60px; flex-shrink: 0; position: sticky; left: 0; z-index: 40; background: var(--color-surface); border-right: 1px solid var(--color-border);"></div>`;
    days.forEach(d => {
        const isToday = formatDate(d) === formatDate(new Date());
        html += `<div class="day-header text-center font-semibold py-2 ${isToday ? 'today-header' : ''}" style="width: 90px; flex-shrink: 0;">
                    ${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.getDate()}
                 </div>`;
    });
    html += `</div>`;

    // Body Row
    html += `<div style="display: flex; width: max-content; min-width: 100%;">`;
    
    // Time Column (Sticky to left)
    html += `<div class="time-col" style="width: 60px; flex-shrink: 0; background: var(--color-surface); position: sticky; left: 0; z-index: 20; border-right: 1px solid var(--color-border);">`;
    for (let minute = earliestHour * 60; minute <= latestHour * 60; minute += 30) {
        html += `<div style="height: ${30 * PIXELS_PER_MIN}px; display: flex; align-items: flex-start; justify-content: flex-end; padding-right: 8px; padding-top: 4px; font-size: 0.65rem; color: var(--color-text-muted); box-sizing: border-box;">${formatTime(minute)}</div>`;
    }
    html += `</div>`;
    
    // Grid Array
    html += `<div class="days-row" style="display: flex; flex: 1;">`;

    for (const day of days) {
        const dayStr = formatDate(day);
        const dayEvents = getDisplayEventsForDate(dayStr);
        const dayBusy = getDisplayBusyForDate(dayStr);
        const isToday = dayStr === formatDate(new Date());

        html += `<div class="day-cell relative" data-date="${dayStr}" 
            ondragover="dragover_handler(event)"
            ondrop="drop_handler(event)"
            style="flex: 0 0 90px; width: 90px; height: ${dayHeight}px; position: relative; background: ${isToday ? 'var(--color-today-bg)' : 'transparent'}; border-right: 1px solid var(--color-border);">`;

        // Busy overlays
        for (const busy of dayBusy) {
            const startMin = toMinutes(busy.startTime);
            const endMin = toMinutes(busy.endTime);
            if (endMin > earliestHour * 60 && startMin < latestHour * 60) {
                const startOffset = Math.max(startMin, earliestHour * 60);
                const endOffset = Math.min(endMin, latestHour * 60);
                const top = (startOffset - earliestHour * 60) * PIXELS_PER_MIN;
                const height = (endOffset - startOffset) * PIXELS_PER_MIN;
                html += `<div class="busy-overlay ${busy.hard ? 'hard' : ''}" data-busy-id="${busy.id}" style="position: absolute; top: ${top}px; height: ${height}px; left: 0; right: 0;"></div>`;
            }
        }

        // Todo badge
        if (userSettings.showTodosInCalendar) {
            const todosDue = todos.filter(t => !t.completed && t.dueDate === dayStr);
            if (todosDue.length > 0) {
                html += `<div class="todo-badge" style="position: absolute; top: 2px; right: 2px; background: var(--color-warning); color: white; border-radius: var(--radius-pill); padding: 0px 6px; font-size: 10px; font-weight: bold; z-index: 15;">📝${todosDue.length}</div>`;
            }
        }

        // Events
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
                const duration = endMin - startMin;
                const isShort = duration < 30;

                let extraClasses = '';
                if (isNogo) extraClasses += ' nogo';
                if (isLocked) extraClasses += ' locked';
                if (hasConflict) extraClasses += ' conflict-pulse';
                if (isScheduled) extraClasses += ' scheduled';

                html += `<div class="event-block${extraClasses} ${isShort ? 'short-block' : ''}"
                            data-id="${ev.id}" data-date="${dayStr}"
                            draggable="true"
                            ondragstart="dragstart_handler(event)"
                            style="top: ${top}px; height: ${height}px; background-color: ${ev.color || 'var(--color-primary)'};"
                            role="button" tabindex="0"
                            aria-label="${escapeHtml(ev.name)}, ${formatTime(startMin)} to ${formatTime(endMin)}">
                            <span class="event-name">${escapeHtml(ev.name)}</span>
                            <span class="event-time">${formatTime(startMin)}–${formatTime(endMin)}</span>
                            ${hasConflict ? '<span class="conflict-label" style="position: absolute; top: 2px; right: 2px; background: var(--color-danger); color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; text-align: center; display: flex; align-items: center; justify-content: center;">⚠️</span>' : ''}
                            ${isScheduled ? '<span class="scheduled-label" style="position: absolute; bottom: 2px; right: 2px; font-size: 8px; background: rgba(0,0,0,0.4); padding: 0px 3px; border-radius: 3px;">⚙️</span>' : ''}
                        </div>`;
            }
        }
        html += `</div>`;
    }

    html += `</div></div></div>`; // Close days-row, body-row, and timeline-container
    container.innerHTML = html;
}

// ========== MONTH VIEW ==========
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
    let html = `<div class="month-view" style="display: flex; flex-direction: column; height: 100%;">
                  <div class="weekdays flex shrink-0 bg-white dark:bg-gray-800 z-10 sticky top-0 border-b border-gray-200 dark:border-gray-700">
                    ${orderedDayNames.map(d => `<div class="day-header flex-1 text-center py-2">${d}</div>`).join('')}
                  </div>
                  <div class="month-grid">`;

    for (const week of weeks) {
        html += `<div class="flex" style="width: 100%;">`;
        for (const date of week) {
            const dateStr = formatDate(date);
            const dayEvents = getDisplayEventsForDate(dateStr);
            const isCurrentMonth = date.getMonth() === month;
            const isToday = dateStr === formatDate(new Date());

            html += `<div class="month-cell flex-1 ${isCurrentMonth ? '' : 'opacity-50'} ${isToday ? 'today' : ''}" data-date="${dateStr}">
                        <div class="date-number cursor-pointer" data-nav-date="${dateStr}">${date.getDate()}</div>
                        <div class="month-events">`;
            const maxDisplay = 3;
            for (let i = 0; i < Math.min(dayEvents.length, maxDisplay); i++) {
                const ev = dayEvents[i];
                const isNogo = overrides.has(`${ev.id}_${dateStr}`) && overrides.get(`${ev.id}_${dateStr}`).type === 'nogo';
                const hasConflict = getDisplayBusyForDate(dateStr).some(b => toMinutes(ev.endTime) > toMinutes(b.startTime) && toMinutes(ev.startTime) < toMinutes(b.endTime)) ||
                                   dayEvents.some(other => other.id !== ev.id && toMinutes(ev.endTime) > toMinutes(other.startTime) && toMinutes(ev.startTime) < toMinutes(other.endTime));
                const isScheduled = ev.isScheduled || false;
                
                let extraClasses = '';
                if (isNogo) extraClasses += ' nogo';
                if (hasConflict) extraClasses += ' conflict';
                if (isScheduled) extraClasses += ' scheduled';

                html += `<div class="event-block-month${extraClasses}"
                            data-id="${ev.id}" data-date="${dateStr}" style="background-color:${ev.color || 'var(--color-primary)'};">
                            ${escapeHtml(ev.name)}
                         </div>`;
            }
            html += `</div>`; // Close month-events

            if (dayEvents.length > maxDisplay) {
                html += `<div class="month-overflow-indicator more-events" data-date="${dateStr}">+${dayEvents.length - maxDisplay} more</div>`;
            }
            if (userSettings.showTodosInCalendar) {
                const todosDue = todos.filter(t => !t.completed && t.dueDate === dateStr);
                if (todosDue.length > 0) {
                    html += `<div class="text-xs text-gray-500 font-semibold mt-1">📝 ${todosDue.length}</div>`;
                }
            }
            html += `</div>`; // Close month-cell
        }
        html += `</div>`; // Close week flex row
    }
    html += `</div></div>`;
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
                dayEvents.map(ev => `<div class="py-1 border-b border-gray-100 dark:border-slate-700 text-xs flex items-center gap-2">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${ev.color || 'var(--color-primary)'}; flex-shrink:0;"></span>
                    <span class="font-medium text-gray-500 w-10">${formatTime(toMinutes(ev.startTime))}</span>
                    <span class="truncate flex-1">${escapeHtml(ev.name)}</span>
                </div>`).join('') +
                `<button class="mt-3 text-xs text-gray-500 hover:text-gray-800 w-full text-right font-semibold uppercase">Close</button>`;
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

// ========== DAY VIEW ==========
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

    let html = `<div class="day-view" style="display: flex; flex-direction: column; height: 100%;">
                    <div class="day-header text-center font-semibold py-2 shrink-0 bg-white dark:bg-gray-800 z-10 sticky top-0 border-b border-gray-200 dark:border-gray-700">
                        ${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                    </div>
                    <div class="timeline-container" style="display: flex; flex: 1; overflow: auto; position: relative;">
                        <div class="time-col" style="width: 60px; flex-shrink: 0; background: var(--color-surface); position: sticky; left: 0; z-index: 20; border-right: 1px solid var(--color-border);">`;
    for (let minute = earliestHour * 60; minute <= latestHour * 60; minute += 30) {
        html += `<div style="height: ${30 * PIXELS_PER_MIN}px; display: flex; align-items: flex-start; justify-content: flex-end; padding-right: 8px; padding-top: 4px; font-size: 0.65rem; color: var(--color-text-muted); box-sizing: border-box;">${formatTime(minute)}</div>`;
    }
    html += `</div><div class="day-cell" style="flex:1; position: relative; height: ${containerHeight}px; background: var(--color-bg);">`;

    for (const busy of dayBusy) {
        const startMin = toMinutes(busy.startTime);
        const endMin = toMinutes(busy.endTime);
        if (endMin > earliestHour * 60 && startMin < latestHour * 60) {
            const startOffset = Math.max(startMin, earliestHour * 60);
            const endOffset = Math.min(endMin, latestHour * 60);
            const top = (startOffset - earliestHour * 60) * PIXELS_PER_MIN;
            const height = (endOffset - startOffset) * PIXELS_PER_MIN;
            html += `<div class="busy-overlay ${busy.hard ? 'hard' : ''}" data-busy-id="${busy.id}" style="position: absolute; top: ${top}px; height: ${height}px; left: 0; right: 0;"></div>`;
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
                        style="top: ${top}px; height: ${height}px; background-color: ${ev.color || 'var(--color-primary)'};"
                        role="button" tabindex="0"
                        aria-label="${escapeHtml(ev.name)}, ${formatTime(startMin)} to ${formatTime(endMin)}">
                        <span class="event-name">${escapeHtml(ev.name)}</span>
                        <span class="event-time">${formatTime(startMin)}–${formatTime(endMin)}</span>
                        ${hasConflict ? '<span class="conflict-label" style="position: absolute; top: 2px; right: 2px; background: var(--color-danger); color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; text-align: center; display: flex; align-items: center; justify-content: center;">⚠️</span>' : ''}
                        ${isScheduled ? '<span class="scheduled-label" style="position: absolute; bottom: 2px; right: 2px; font-size: 8px; background: rgba(0,0,0,0.4); padding: 0px 3px; border-radius: 3px;">⚙️</span>' : ''}
                    </div>`;
        }
    }

    html += `</div></div></div>`;
    container.innerHTML = html;
    if (dayEvents.length === 0 && (!userSettings.showTodosInCalendar || todos.filter(t => !t.completed && t.dueDate === dateStr).length === 0)) {
        renderEmptyState(container);
    }
}

// ========== CALENDAR CLICK HANDLER (Empty Space) ==========
document.addEventListener('click', (e) => {
    // Only trigger if clicking directly on the day-cell, not on an event block inside it
    if (e.target.classList.contains('day-cell')) {
        const dateStr = e.target.dataset.date;
        if (!dateStr) return;

        // Calculate clicked time based on Y offset
        const rect = e.target.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        
        // Based on rendering logic: top = (startMin - earliestHour*60) * PIXELS_PER_MIN
        // We need to reverse engineer earliestHour. Look at time-col first child.
        const timeCol = document.querySelector('.time-col > div');
        let earliestHour = 0;
        if (timeCol) {
            const timeText = timeCol.textContent.trim();
            const parsed = parseTime(timeText); // Utility function
            if (parsed !== null) earliestHour = Math.floor(parsed / 60);
        }

        // Calculate raw minutes, round to nearest 15 mins for neatness
        let rawMin = (offsetY / PIXELS_PER_MIN) + (earliestHour * 60);
        let roundedMin = Math.round(rawMin / 15) * 15;
        
        // Show Bottom Sheet Custom Choice Menu
        showCreationBottomSheet(dateStr, roundedMin);
    }
});

// Modified Bottom Sheet for Creation Choices
function showCreationBottomSheet(dateStr, startMin) {
    const sheet = document.getElementById('bottomSheet');
    if (!sheet) return;

    const timeStr = formatTime(startMin);
    const endStr = formatTime(startMin + 60); // Default 1 hr

    sheet.querySelector('.sheet-title').textContent = `New Activity`;
    sheet.querySelector('.sheet-desc').textContent = `${formatDateDisplay(dateStr)} at ${timeStr}`;

    // Inject Creation Buttons dynamically
    const actionsContainer = sheet.querySelector('.sheet-actions');
    actionsContainer.innerHTML = `
        <button id="sheetAddEvent" class="sheet-action"><span class="action-icon text-blue-600 bg-blue-100"><i class="fas fa-magic"></i></span> Schedule Event (Optimized)</button>
        <button id="sheetAddBusy" class="sheet-action"><span class="action-icon text-red-600 bg-red-100"><i class="fas fa-ban"></i></span> Block Busy Time</button>
        <button id="sheetAddTodo" class="sheet-action"><span class="action-icon text-green-600 bg-green-100"><i class="fas fa-check-square"></i></span> Add To-do Here</button>
    `;

    document.getElementById('sheetAddEvent').onclick = () => {
        closeBottomSheet();
        if (typeof openEventModal === 'function') {
            // Set global temporary vars to prefill the modal
            window._prefillEventDate = dateStr;
            window._prefillEventStart = fromMinutes(startMin);
            window._prefillEventEnd = fromMinutes(startMin + 60);
            openEventModal();
            // Actually apply them (since openEventModal reconstructs the form)
            setTimeout(() => {
                document.getElementById('eventOpenTime').value = window._prefillEventStart;
                document.getElementById('eventCloseTime').value = window._prefillEventEnd;
            }, 50);
        }
    };

    document.getElementById('sheetAddBusy').onclick = () => {
        closeBottomSheet();
        if (typeof openBusyModal === 'function') {
            openBusyModal(null, dateStr);
            setTimeout(() => {
                document.getElementById('busyStartTime').value = fromMinutes(startMin);
                document.getElementById('busyEndTime').value = fromMinutes(startMin + 60);
            }, 50);
        }
    };

    document.getElementById('sheetAddTodo').onclick = () => {
        closeBottomSheet();
        if (typeof openTodoModal === 'function') {
            openTodoModal({ dueDate: dateStr });
        }
    };

    // Show sheet
    sheet.classList.add('open');
    const backdrop = document.getElementById('bottomSheetBackdrop');
    backdrop.classList.add('active');
    backdrop.onclick = closeBottomSheet;
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

// ========== EVENT TOOLTIP ==========
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

    // Busy overlay click handler – now uses data-busy-id to edit existing block
    container.querySelectorAll('.busy-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            const cell = overlay.closest('.day-cell');
            if (!cell) return;
            const dateStr = cell.dataset.date;
            const busyId = parseInt(overlay.dataset.busyId);
            if (busyId && typeof openBusyModal === 'function') {
                const busyObj = busyBlocks.find(b => b.id === busyId);
                openBusyModal(busyObj, dateStr);
            } else if (dateStr && typeof openBusyModal === 'function') {
                openBusyModal(null, dateStr);
            }
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