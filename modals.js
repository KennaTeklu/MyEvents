// ==================== MODALS ====================
let editingEventId = null;
let editingDateStr = null;
let eventDraftManager = null;
let busyDraftManager = null;

// FormDraft class
class FormDraft {
    constructor(modalId, key, customHandlers = {}) {
        this.modal = document.getElementById(modalId);
        this.key = key;
        this.customHandlers = customHandlers;
        this.saveTimer = null;
        if (!this.modal) return;
        this.setupListeners();
        this.loadDraft();
        if (!window._draftManagers) window._draftManagers = [];
        window._draftManagers.push(this);
    }
    capture() {
        const formData = {};
        const inputs = this.modal.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            const id = input.id || input.name;
            if (!id) return;
            if (input.type === 'checkbox' || input.type === 'radio') {
                formData[id] = input.checked;
            } else {
                formData[id] = input.value;
            }
        });
        for (const [key, handler] of Object.entries(this.customHandlers)) {
            if (handler.read) formData[key] = handler.read(this.modal);
        }
        return formData;
    }
    restore(data) {
        if (!data) return;
        const inputs = this.modal.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            const id = input.id || input.name;
            if (!id || !(id in data)) return;
            if (input.type === 'checkbox' || input.type === 'radio') {
                input.checked = data[id];
            } else {
                input.value = data[id];
            }
        });
        for (const [key, handler] of Object.entries(this.customHandlers)) {
            if (handler.write && data[key] !== undefined) handler.write(this.modal, data[key]);
        }
    }
    async saveDraft() {
        const draft = this.capture();
        await saveDraft(this.key, draft);
        this.saveToLocalStorage(draft);
    }
    saveToLocalStorage(draft) {
        localStorage.setItem(`draft_${this.key}`, JSON.stringify(draft));
    }
    async loadDraft() {
        let draft = await loadDraft(this.key);
        if (!draft) {
            const local = localStorage.getItem(`draft_${this.key}`);
            if (local) {
                try {
                    draft = JSON.parse(local);
                } catch (e) {}
            }
        }
        if (draft) this.restore(draft);
    }
    async clearDraft() {
        await clearDraft(this.key);
        localStorage.removeItem(`draft_${this.key}`);
    }
    flushSync() {
        const draft = this.capture();
        this.saveToLocalStorage(draft);
    }
    setupListeners() {
        const debouncedSave = () => {
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => this.saveDraft(), 300);
        };
        this.modal.addEventListener('input', debouncedSave);
        this.modal.addEventListener('change', debouncedSave);
        const stars = this.modal.querySelectorAll('#eventPriorityStars .fa-star');
        stars.forEach(star => star.addEventListener('click', debouncedSave));
    }
}

function openEventModal(event = null, dateStr = null) {
    const modal = document.getElementById('eventModal');
    if (!modal) return;

    function populateForm(data) {
        document.getElementById('eventName').value = data.name || '';
        document.getElementById('eventOpenTime').value = data.openTime || '09:00';
        document.getElementById('eventCloseTime').value = data.closeTime || '17:00';
        document.getElementById('eventMinStay').value = data.minStay ?? 30;
        document.getElementById('eventMaxStay').value = data.maxStay ?? 120;
        document.getElementById('eventRepeat').value = data.repeat || 'none';
        document.getElementById('eventRepeatEnd').value = data.repeatEnd || '';
        document.getElementById('eventNotes').value = data.notes || '';
        document.getElementById('eventFrequency').value = data.frequency || 'unlimited';
        document.getElementById('eventScarce').checked = !!data.scarce;
        document.getElementById('eventRemindRecency').checked = !!data.remindRecency;

        const colorPalette = document.getElementById('colorPalette');
        if (colorPalette) {
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec489a', '#06b6d4', '#84cc16'];
            colorPalette.innerHTML = colors.map(c => `<div class="w-6 h-6 rounded-full cursor-pointer border-2 ${c === data.color ? 'border-black dark:border-white' : 'border-transparent'}" style="background-color:${c};" data-color="${c}"></div>`).join('');
            colorPalette.querySelectorAll('[data-color]').forEach(swatch => {
                swatch.addEventListener('click', () => {
                    document.getElementById('eventColor').value = swatch.dataset.color;
                    colorPalette.querySelectorAll('[data-color]').forEach(s => s.classList.remove('border-black', 'dark:border-white'));
                    swatch.classList.add('border-black', 'dark:border-white');
                });
            });
        }
        document.getElementById('eventColor').value = data.color || '#3b82f6';

        const stars = document.querySelectorAll('#eventPriorityStars .fa-star');
        const priority = data.priority ?? 3;
        stars.forEach((star, idx) => {
            if (idx < priority) star.classList.add('selected');
            else star.classList.remove('selected');
        });
        document.getElementById('priorityDesc').innerText = priority === 1 ? 'Lowest priority' : priority === 2 ? 'Low priority' : priority === 3 ? 'Normal priority' : priority === 4 ? 'High priority' : 'Highest priority';

        if (data.weeklyDays && data.weeklyDays.length) {
            const weeklyChecks = document.querySelectorAll('#weeklyDaysContainer input');
            weeklyChecks.forEach(cb => {
                cb.checked = data.weeklyDays.includes(parseInt(cb.value));
            });
        } else {
            document.querySelectorAll('#weeklyDaysContainer input').forEach(cb => cb.checked = false);
        }
        document.getElementById('monthlyDay').value = data.monthlyDay ?? 1;
    }

    if (event) {
        populateForm(event);
        editingEventId = event.id;
        editingDateStr = dateStr || null;
        if (eventDraftManager) eventDraftManager.clearDraft();
        modal.classList.remove('hidden');
        const repeatSelect = document.getElementById('eventRepeat');
        if (repeatSelect) repeatSelect.dispatchEvent(new Event('change'));
        modal.scrollTop = 0;
        return;
    }

    if (eventDraftManager) {
        eventDraftManager.loadDraft().then(() => {
            editingEventId = null;
            editingDateStr = dateStr || null;
            modal.classList.remove('hidden');
            const repeatSelect = document.getElementById('eventRepeat');
            if (repeatSelect) repeatSelect.dispatchEvent(new Event('change'));
            modal.scrollTop = 0;
            const draftBanner = document.getElementById('draftBanner');
            if (draftBanner) draftBanner.classList.remove('hidden');
        }).catch(() => {
            populateForm({});
            editingEventId = null;
            editingDateStr = dateStr || null;
            modal.classList.remove('hidden');
            const repeatSelect = document.getElementById('eventRepeat');
            if (repeatSelect) repeatSelect.dispatchEvent(new Event('change'));
            modal.scrollTop = 0;
        });
    } else {
        populateForm({});
        editingEventId = null;
        editingDateStr = dateStr || null;
        modal.classList.remove('hidden');
        const repeatSelect = document.getElementById('eventRepeat');
        if (repeatSelect) repeatSelect.dispatchEvent(new Event('change'));
        modal.scrollTop = 0;
    }
}

function openBusyModal(busy = null, dateStr = null) {
    const modal = document.getElementById('busyModal');
    if (!modal) return;

    const busyDaysDiv = document.getElementById('busyDaysCheckboxes');
    if (busyDaysDiv) {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        busyDaysDiv.innerHTML = days.map((d, i) => `
            <label class="inline-flex items-center gap-1">
                <input type="checkbox" value="${i}" name="busy_weekly_day_${i}"> ${d}
            </label>
        `).join('');
    }
    if (busy) {
        document.getElementById('busyDescription').value = busy.description || '';
        document.getElementById('busyHard').checked = busy.hard || false;
        document.getElementById('busyRecurrence').value = busy.recurrence || 'once';
        document.getElementById('busyDate').value = busy.date || dateStr || '';
        document.getElementById('busyRangeStart').value = busy.startDate || '';
        document.getElementById('busyRangeEnd').value = busy.endDate || '';
        document.getElementById('busyStartTime').value = busy.startTime || '09:00';
        document.getElementById('busyEndTime').value = busy.endTime || '17:00';
        document.getElementById('busyAllDay').checked = busy.allDay || false;
        document.getElementById('busyTag').value = busy.tag || '';

        if (busy.recurrence === 'weekly' && busy.daysOfWeek) {
            const checkboxes = document.querySelectorAll('#busyDaysCheckboxes input');
            checkboxes.forEach(cb => {
                cb.checked = busy.daysOfWeek.includes(parseInt(cb.value));
            });
        } else {
            document.querySelectorAll('#busyDaysCheckboxes input').forEach(cb => cb.checked = false);
        }

        if (busyDraftManager) busyDraftManager.clearDraft();
        modal.classList.remove('hidden');
        const recurSelect = document.getElementById('busyRecurrence');
        const weeklyDiv = document.getElementById('busyWeeklyDays');
        if (recurSelect && weeklyDiv) {
            if (recurSelect.value === 'weekly') {
                weeklyDiv.classList.remove('hidden');
            } else {
                weeklyDiv.classList.add('hidden');
            }
        }
        if (recurSelect) recurSelect.dispatchEvent(new Event('change'));
        modal.scrollTop = 0;
        return;
    }

    if (busyDraftManager) {
        busyDraftManager.loadDraft().then(() => {
            modal.classList.remove('hidden');
            const recurSelect = document.getElementById('busyRecurrence');
            if (recurSelect) recurSelect.dispatchEvent(new Event('change'));
            modal.scrollTop = 0;
        }).catch(() => {
            document.getElementById('busyDescription').value = '';
            document.getElementById('busyHard').checked = false;
            document.getElementById('busyRecurrence').value = 'once';
            document.getElementById('busyDate').value = '';
            document.getElementById('busyRangeStart').value = '';
            document.getElementById('busyRangeEnd').value = '';
            document.getElementById('busyStartTime').value = '09:00';
            document.getElementById('busyEndTime').value = '17:00';
            document.getElementById('busyAllDay').checked = false;
            document.getElementById('busyTag').value = '';
            document.querySelectorAll('#busyDaysCheckboxes input').forEach(cb => cb.checked = false);
            modal.classList.remove('hidden');
            const recurSelect = document.getElementById('busyRecurrence');
            if (recurSelect) recurSelect.dispatchEvent(new Event('change'));
            modal.scrollTop = 0;
        });
    } else {
        modal.classList.remove('hidden');
    }
}

function showContextMenu(x, y, eventId, dateStr) {
    const menu = document.getElementById('contextMenu');
    if (!menu) return;
    const ev = events.find(e => e.id === eventId);
    if (!ev) return;
    const key = `${eventId}_${dateStr}`;
    const isNogo = overrides.has(key) && overrides.get(key).type === 'nogo';
    const isLocked = overrides.has(key) && overrides.get(key).type === 'locked';
    document.getElementById('ctxEdit').innerHTML = `<i class="fas fa-edit"></i> Edit`;
    document.getElementById('ctxNoGo').innerHTML = isNogo ? `<i class="fas fa-check-circle"></i> Unskip` : `<i class="fas fa-ban"></i> Skip (No Go)`;
    document.getElementById('ctxLock').innerHTML = isLocked ? `<i class="fas fa-unlock"></i> Unlock` : `<i class="fas fa-lock"></i> Don't move`;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.remove('hidden');
    const close = () => {
        menu.classList.add('hidden');
        document.removeEventListener('click', close);
    };
    document.getElementById('ctxEdit').onclick = () => {
        const ev = events.find(e => e.id === eventId);
        if (ev) openEventModal(ev, dateStr);
        close();
    };
    document.getElementById('ctxNoGo').onclick = async () => {
        const key = `${eventId}_${dateStr}`;
        if (overrides.has(key)) overrides.delete(key);
        else overrides.set(key, { compositeKey: key, eventId, dateStr, type: 'nogo' });
        await putRecord('overrides', { compositeKey: key, eventId, dateStr, type: 'nogo' });
        await fullRefresh();
        close();
    };
    document.getElementById('ctxLock').onclick = async () => {
        const key = `${eventId}_${dateStr}`;
        if (overrides.has(key)) overrides.delete(key);
        else overrides.set(key, { compositeKey: key, eventId, dateStr, type: 'locked' });
        await putRecord('overrides', { compositeKey: key, eventId, dateStr, type: 'locked' });
        await fullRefresh();
        close();
    };
    document.getElementById('ctxDelete').onclick = async () => {
        if (confirm(`Delete "${ev.name}" on ${dateStr}? This cannot be undone.`)) {
            await deleteRecord('events', eventId);
            await fullRefresh();
        }
        close();
    };
    setTimeout(() => document.addEventListener('click', close), 10);
}

function attachCalendarEvents() {
    const container = document.getElementById('calendarGrid');
    if (!container) return;
    const clickHandler = (e) => {
        const eventBlock = e.target.closest('.event-block, .event-block-month');
        if (eventBlock) {
            e.stopPropagation();
            const id = parseInt(eventBlock.dataset.id);
            const dateStr = eventBlock.dataset.date;
            const ev = events.find(e => e.id === id);
            if (ev) openEventModal(ev, dateStr);
        }
    };
    container.addEventListener('click', clickHandler);
    const contextHandler = (e) => {
        const eventBlock = e.target.closest('.event-block, .event-block-month');
        if (eventBlock) {
            e.preventDefault();
            const id = parseInt(eventBlock.dataset.id);
            const dateStr = eventBlock.dataset.date;
            showContextMenu(e.clientX, e.clientY, id, dateStr);
        }
        const dayCell = e.target.closest('.day-cell');
        if (dayCell && !eventBlock) {
            e.preventDefault();
            openBusyModal(null, dayCell.dataset.date);
        }
    };
    container.addEventListener('contextmenu', contextHandler);
    let pressTimer = null;
    const attachLongPress = (element, callback) => {
        element.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                callback(e);
                e.preventDefault();
            }, 500);
        });
        element.addEventListener('touchend', () => {
            if (pressTimer) clearTimeout(pressTimer);
        });
        element.addEventListener('touchmove', () => {
            if (pressTimer) clearTimeout(pressTimer);
        });
    };
    document.querySelectorAll('.event-block, .event-block-month').forEach(block => {
        attachLongPress(block, (e) => {
            const id = parseInt(block.dataset.id);
            const dateStr = block.dataset.date;
            showContextMenu(e.touches[0].clientX, e.touches[0].clientY, id, dateStr);
        });
    });
    document.querySelectorAll('.day-cell').forEach(cell => {
        attachLongPress(cell, (e) => {
            openBusyModal(null, cell.dataset.date);
        });
    });
}