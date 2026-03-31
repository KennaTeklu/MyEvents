// modals.js - Modal handling for events, busy blocks, and context menu
// Must be loaded after state.js, utils.js, db.js, calendar.js

// ========== FORM DRAFT CLASS ==========
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

// ========== EVENT MODAL ==========
let eventFormSnapshot = {};

function openEventModal(event = null, dateStr = null) {
    const modal = document.getElementById('eventModal');
    if (!modal) return;

    // Update title
    const titleEl = modal.querySelector('h3');
    if (titleEl) titleEl.textContent = event ? 'Edit event' : 'Add event';

    // Hide draft banner until we know
    const draftBanner = document.getElementById('draftBanner');
    if (draftBanner) draftBanner.classList.add('hidden');

    function buildColorPalette(selectedColor) {
        const palette = document.getElementById('colorPalette');
        if (!palette) return;
        const colors = [
            '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
            '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
            '#f97316', '#64748b'
        ];
        palette.innerHTML = colors.map(c =>
            `<div class="color-swatch ${c === selectedColor ? 'selected' : ''}" 
                style="background:${c};" 
                data-color="${c}" 
                role="radio" 
                aria-label="Color ${c}" 
                tabindex="0"></div>`
        ).join('');
        palette.querySelectorAll('.color-swatch').forEach(swatch => {
            const select = () => {
                palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');
                const hidden = document.getElementById('eventColor');
                if (hidden) hidden.value = swatch.dataset.color;
                if (eventDraftManager) eventDraftManager.saveDraft();
            };
            swatch.addEventListener('click', select);
            swatch.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
            });
        });
    }

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
        document.getElementById('eventColor').value = data.color || '#3b82f6';

        buildColorPalette(data.color || '#3b82f6');

        const stars = document.querySelectorAll('#eventPriorityStars .fa-star');
        const priority = data.priority ?? 3;
        stars.forEach((star, idx) => {
            star.classList.toggle('selected', idx < priority);
            // Remove previous listener to avoid stacking
            const newStar = star.cloneNode(true);
            star.parentNode.replaceChild(newStar, star);
        });
        // Re-attach star listeners
        document.querySelectorAll('#eventPriorityStars .fa-star').forEach((star, idx) => {
            star.addEventListener('click', () => {
                const prio = idx + 1;
                document.querySelectorAll('#eventPriorityStars .fa-star').forEach((s, i) => {
                    s.classList.toggle('selected', i < prio);
                });
                const desc = document.getElementById('priorityDesc');
                if (desc) desc.innerText = getPriorityLabel(prio);
                if (eventDraftManager) eventDraftManager.saveDraft();
            });
        });
        const desc = document.getElementById('priorityDesc');
        if (desc) desc.innerText = getPriorityLabel(priority);

        // Weekly days
        document.querySelectorAll('#weeklyDaysContainer input').forEach(cb => {
            cb.checked = !!(data.weeklyDays && data.weeklyDays.includes(parseInt(cb.value)));
        });
        document.getElementById('monthlyDay').value = data.monthlyDay ?? 1;

        // Collapse advanced if empty form, keep open if editing
        const adv = document.getElementById('advancedOptions');
        const advBtn = document.getElementById('toggleAdvancedBtn');
        if (adv && advBtn) {
            if (event && (data.frequency !== 'unlimited' || data.scarce || data.remindRecency || data.priority !== 3)) {
                adv.classList.remove('hidden');
                advBtn.textContent = 'Hide advanced options';
            } else {
                adv.classList.add('hidden');
                advBtn.textContent = 'Show advanced options';
            }
        }

        // Snapshot for dirty detection
        eventFormSnapshot = {
            eventName: data.name || '',
            eventOpenTime: data.openTime || '09:00',
            eventCloseTime: data.closeTime || '17:00',
            eventMinStay: String(data.minStay ?? 30),
            eventNotes: data.notes || ''
        };
    }

    if (event) {
        populateForm(event);
        editingEventId = event.id;
        editingDateStr = dateStr || null;
        if (eventDraftManager) eventDraftManager.clearDraft();
        ModalManager.open('eventModal');
        document.getElementById('eventRepeat')?.dispatchEvent(new Event('change'));
        return;
    }

    // New event path — load draft
    editingEventId = null;
    editingDateStr = dateStr || null;

    if (eventDraftManager) {
        eventDraftManager.loadDraft().then(() => {
            const draft = localStorage.getItem(`draft_${eventDraftManager.key}`);
            if (draft) {
                if (draftBanner) draftBanner.classList.remove('hidden');
                buildColorPalette(document.getElementById('eventColor')?.value || '#3b82f6');
            } else {
                populateForm({});
            }
            ModalManager.open('eventModal');
            document.getElementById('eventRepeat')?.dispatchEvent(new Event('change'));
        }).catch(() => {
            populateForm({});
            ModalManager.open('eventModal');
            document.getElementById('eventRepeat')?.dispatchEvent(new Event('change'));
        });
    } else {
        populateForm({});
        ModalManager.open('eventModal');
        document.getElementById('eventRepeat')?.dispatchEvent(new Event('change'));
    }
}

function closeEventModalWithCheck() {
    if (isFormDirty('eventModal', eventFormSnapshot)) {
        // Show inline confirmation inside the modal instead of browser confirm
        const existing = document.getElementById('dirtyWarning');
        if (existing) { existing.remove(); return; }
        const modal = document.getElementById('eventModal');
        const footer = modal.querySelector('.flex.gap-2.justify-end');
        const warning = document.createElement('div');
        warning.id = 'dirtyWarning';
        warning.className = 'modal-dirty-warning mt-2';
        warning.innerHTML = `
            <span>You have unsaved changes.</span>
            <div class="flex gap-2">
                <button id="discardChangesBtn" class="text-xs bg-red-100 text-red-700 px-3 py-1 rounded-full">Discard</button>
                <button id="keepEditingBtn" class="text-xs bg-gray-200 px-3 py-1 rounded-full">Keep editing</button>
            </div>
        `;
        footer.insertAdjacentElement('afterend', warning);
        document.getElementById('discardChangesBtn').onclick = () => {
            warning.remove();
            ModalManager.close('eventModal');
        };
        document.getElementById('keepEditingBtn').onclick = () => warning.remove();
    } else {
        ModalManager.close('eventModal');
    }
}

// ========== BUSY MODAL ==========
function openBusyModal(busy = null, dateStr = null) {
    const modal = document.getElementById('busyModal');
    if (!modal) return;

    // Always rebuild checkboxes with weekday shortcuts
    const busyDaysDiv = document.getElementById('busyDaysCheckboxes');
    if (busyDaysDiv) {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        busyDaysDiv.innerHTML = `
            <div class="flex gap-2 mb-2 flex-wrap">
                <button type="button" class="weekday-selectall" id="selectWeekdays">Weekdays</button>
                <button type="button" class="weekday-selectall" id="selectWeekends">Weekends</button>
                <button type="button" class="weekday-selectall" id="selectAllDays">All</button>
                <button type="button" class="weekday-selectall" id="clearAllDays">Clear</button>
            </div>
            <div class="flex flex-wrap gap-2">
                ${days.map((d, i) => `
                    <label class="inline-flex items-center gap-1 cursor-pointer select-none">
                        <input type="checkbox" value="${i}" name="busy_weekly_day_${i}" class="cursor-pointer"> ${d}
                    </label>
                `).join('')}
            </div>
        `;
        document.getElementById('selectWeekdays').onclick = () => {
            document.querySelectorAll('#busyDaysCheckboxes input').forEach(cb => {
                cb.checked = [1,2,3,4,5].includes(parseInt(cb.value));
            });
        };
        document.getElementById('selectWeekends').onclick = () => {
            document.querySelectorAll('#busyDaysCheckboxes input').forEach(cb => {
                cb.checked = [0,6].includes(parseInt(cb.value));
            });
        };
        document.getElementById('selectAllDays').onclick = () => {
            document.querySelectorAll('#busyDaysCheckboxes input').forEach(cb => cb.checked = true);
        };
        document.getElementById('clearAllDays').onclick = () => {
            document.querySelectorAll('#busyDaysCheckboxes input').forEach(cb => cb.checked = false);
        };
    }

    function populate(data) {
        document.getElementById('busyDescription').value = data.description || '';
        document.getElementById('busyHard').checked = data.hard || false;
        document.getElementById('busyRecurrence').value = data.recurrence || 'once';
        document.getElementById('busyDate').value = data.date || dateStr || formatDate(new Date());
        document.getElementById('busyRangeStart').value = data.startDate || '';
        document.getElementById('busyRangeEnd').value = data.endDate || '';
        document.getElementById('busyStartTime').value = data.startTime || '09:00';
        document.getElementById('busyEndTime').value = data.endTime || '17:00';
        document.getElementById('busyAllDay').checked = data.allDay || false;
        document.getElementById('busyTag').value = data.tag || '';
        if (data.daysOfWeek) {
            document.querySelectorAll('#busyDaysCheckboxes input').forEach(cb => {
                cb.checked = data.daysOfWeek.includes(parseInt(cb.value));
            });
        }
    }

    if (busy) {
        populate(busy);
        if (busyDraftManager) busyDraftManager.clearDraft();
    } else if (busyDraftManager) {
        busyDraftManager.loadDraft().then(draft => {
            if (draft) busyDraftManager.restore(draft);
            else populate({ date: dateStr || formatDate(new Date()) });
        }).catch(() => populate({ date: dateStr || formatDate(new Date()) }));
    } else {
        populate({ date: dateStr || formatDate(new Date()) });
    }

    ModalManager.open('busyModal');
    document.getElementById('busyRecurrence')?.dispatchEvent(new Event('change'));
}

// ========== CONTEXT MENU (with boundary) ==========
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
    
    // Adjust position to stay within viewport
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (left + rect.width > viewportWidth) left = viewportWidth - rect.width - 10;
    if (top + rect.height > viewportHeight) top = viewportHeight - rect.height - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
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
