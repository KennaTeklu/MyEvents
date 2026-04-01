// modals.js - Modal handling for events, busy blocks, and context menu
// Must be loaded after state.js, utils.js, db.js, calendar.js

// ========== MODAL MANAGER (Fallback if not defined in utils.js) ==========
if (typeof ModalManager === 'undefined') {
    window.ModalManager = {
        current: null,
        _focusReturn: null,
        open(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;
            if (this.current && this.current !== modalId) this.close(this.current);
            modal.classList.remove('hidden');
            modal.scrollTop = 0;
            this.current = modalId;
            this.trapFocus(modal);
        },
        close(modalId) {
            const modal = document.getElementById(modalId || this.current);
            if (modal) {
                modal.classList.add('hidden');
                if (this._focusReturn) {
                    this._focusReturn.focus();
                    this._focusReturn = null;
                }
                if (!modalId || modalId === this.current) this.current = null;
            }
        },
        closeAll() {
            document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => {
                m.classList.add('hidden');
            });
            this.current = null;
        },
        trapFocus(modal) {
            const focusable = modal.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (!focusable.length) return;
            this._focusReturn = document.activeElement;
            focusable[0].focus();
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            modal._trapHandler = (e) => {
                if (e.key !== 'Tab') return;
                if (e.shiftKey) {
                    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
                } else {
                    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
                }
            };
            modal.addEventListener('keydown', modal._trapHandler);
        }
    };
}

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

// ========== EVENT FORM VALIDATION ==========
function validateEventForm() {
    // Clear previous errors
    document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
    document.querySelectorAll('.field-error-msg').forEach(el => el.remove());

    let isValid = true;

    // 1. Name required
    const nameInput = document.getElementById('eventName');
    if (!nameInput.value.trim()) {
        showFieldError(nameInput, 'Event name is required');
        isValid = false;
    }

    // 2. Time logic: close time must be after open time
    const openTime = document.getElementById('eventOpenTime').value;
    const closeTime = document.getElementById('eventCloseTime').value;
    if (openTime && closeTime) {
        const openMin = toMinutes(openTime);
        const closeMin = toMinutes(closeTime);
        if (closeMin <= openMin) {
            showFieldError(document.getElementById('eventCloseTime'), 'Close time must be after open time');
            isValid = false;
        }

        // 3. Min stay must fit within open-close window
        const minStay = parseInt(document.getElementById('eventMinStay').value);
        if (!isNaN(minStay) && minStay > (closeMin - openMin)) {
            showFieldError(document.getElementById('eventMinStay'), `Minimum stay (${minStay} min) exceeds event window (${closeMin - openMin} min)`);
            isValid = false;
        }
    }

    return isValid;
}

function showFieldError(inputEl, message) {
    inputEl.classList.add('field-error');
    const msgSpan = document.createElement('span');
    msgSpan.className = 'field-error-msg';
    msgSpan.innerText = message;
    inputEl.parentNode.insertBefore(msgSpan, inputEl.nextSibling);
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

// ========== BOTTOM SHEET CONTEXT MENU ==========
let currentBottomSheetEventId = null;
let currentBottomSheetDateStr = null;

function showBottomSheet(eventId, dateStr) {
    currentBottomSheetEventId = eventId;
    currentBottomSheetDateStr = dateStr;

    const ev = events.find(e => e.id === eventId);
    if (!ev) return;

    const sheet = document.getElementById('bottomSheet');
    if (!sheet) {
        console.warn('Bottom sheet element not found in DOM');
        return;
    }

    const key = `${eventId}_${dateStr}`;
    const isNogo = overrides.has(key) && overrides.get(key).type === 'nogo';
    const isLocked = overrides.has(key) && overrides.get(key).type === 'locked';
    const isAttended = attendanceLog.some(log => log.eventId === eventId && log.dateStr === dateStr);

    // Update sheet content
    const title = sheet.querySelector('.sheet-title');
    if (title) title.textContent = ev.name;
    const desc = sheet.querySelector('.sheet-desc');
    if (desc) desc.textContent = `${formatDateDisplay(dateStr)} • ${formatTime(toMinutes(ev.startTime))} – ${formatTime(toMinutes(ev.endTime))}`;

    const editBtn = sheet.querySelector('#sheetEdit');
    const skipBtn = sheet.querySelector('#sheetSkip');
    const attendedBtn = sheet.querySelector('#sheetAttended');
    const lockBtn = sheet.querySelector('#sheetLock');
    const deleteBtn = sheet.querySelector('#sheetDelete');

    if (editBtn) editBtn.onclick = () => { closeBottomSheet(); openEventModal(ev, dateStr); };
    if (skipBtn) {
        skipBtn.innerHTML = isNogo ? '<i class="fas fa-check-circle"></i> Unskip' : '<i class="fas fa-ban"></i> Skip (No Go)';
        skipBtn.onclick = async () => {
            const key = `${eventId}_${dateStr}`;
            if (isNogo) overrides.delete(key);
            else overrides.set(key, { compositeKey: key, eventId, dateStr, type: 'nogo' });
            await putRecord('overrides', { compositeKey: key, eventId, dateStr, type: 'nogo' });
            await fullRefresh();
            closeBottomSheet();
            showUndoToast('Skip', { eventId, dateStr, type: 'nogo' });
        };
    }
    if (attendedBtn) {
        attendedBtn.innerHTML = isAttended ? '<i class="fas fa-check-double"></i> Attended' : '<i class="fas fa-check"></i> Mark Attended';
        attendedBtn.onclick = async () => {
            if (!isAttended) {
                await addRecord('attendanceLog', { eventId, dateStr, timestamp: new Date() });
                showToast('Marked as attended', 'success');
            } else {
                // Optionally remove attendance? We'll keep it simple.
                showToast('Already marked as attended', 'info');
            }
            closeBottomSheet();
            await fullRefresh();
        };
    }
    if (lockBtn) {
        lockBtn.innerHTML = isLocked ? '<i class="fas fa-unlock"></i> Unlock' : '<i class="fas fa-lock"></i> Don\'t move';
        lockBtn.onclick = async () => {
            const key = `${eventId}_${dateStr}`;
            if (isLocked) overrides.delete(key);
            else overrides.set(key, { compositeKey: key, eventId, dateStr, type: 'locked' });
            await putRecord('overrides', { compositeKey: key, eventId, dateStr, type: 'locked' });
            await fullRefresh();
            closeBottomSheet();
            showUndoToast('Lock', { eventId, dateStr, type: 'locked' });
        };
    }
    if (deleteBtn) deleteBtn.onclick = async () => {
        if (confirm(`Delete "${ev.name}" on ${dateStr}? This cannot be undone.`)) {
            await deleteRecord('events', eventId);
            await fullRefresh();
            closeBottomSheet();
            showUndoToast('Delete', { eventId, dateStr });
        }
    };

    sheet.classList.remove('hidden');
    // Add backdrop click to close
    const backdrop = sheet.querySelector('.sheet-backdrop') || sheet;
    backdrop.onclick = (e) => {
        if (e.target === backdrop) closeBottomSheet();
    };
    // Add ESC key listener
    document.addEventListener('keydown', bottomSheetKeyHandler);
}

function closeBottomSheet() {
    const sheet = document.getElementById('bottomSheet');
    if (sheet) sheet.classList.add('hidden');
    document.removeEventListener('keydown', bottomSheetKeyHandler);
    currentBottomSheetEventId = null;
    currentBottomSheetDateStr = null;
}

function bottomSheetKeyHandler(e) {
    if (e.key === 'Escape') closeBottomSheet();
}

// ========== GPS DISAMBIGUATION MODAL ==========
function showGPSModal(place, distance, lat, lon) {
    const modal = document.getElementById('gpsDisambigModal');
    if (!modal) return;

    modal.querySelector('.place-name').textContent = place.name;
    modal.querySelector('.distance').textContent = Math.round(distance);
    const widenBtn = modal.querySelector('#gpsWidenRadius');
    const createBtn = modal.querySelector('#gpsCreatePlace');

    widenBtn.onclick = async () => {
        place.radius = Math.max(place.radius, distance + 10);
        await putRecord('places', place);
        await loadData();
        showToast(`Radius of ${place.name} expanded to ${Math.round(place.radius)}m`, 'success');
        ModalManager.close('gpsDisambigModal');
    };

    createBtn.onclick = async () => {
        const newName = prompt('Enter name for new place:', 'New Place');
        if (newName && newName.trim()) {
            const newPlace = { name: newName.trim(), lat, lon, radius: 30, travelToEvent: {} };
            const id = await addRecord('places', newPlace);
            places.push({ ...newPlace, id });
            await loadData();
            showToast(`Created new place: ${newName}`, 'success');
        }
        ModalManager.close('gpsDisambigModal');
    };

    ModalManager.open('gpsDisambigModal');
}

// ========== ORIGINAL CONTEXT MENU (replaced by bottom sheet, kept for reference) ==========
// The old showContextMenu is replaced; we now call showBottomSheet directly from calendar.js.
// We'll keep the function name for compatibility.
function showContextMenu(x, y, eventId, dateStr) {
    // Ignore x,y and show bottom sheet
    showBottomSheet(eventId, dateStr);
}

// ========== UNDO TOAST HELPER ==========
function showUndoToast(action, data) {
    const toastArea = document.getElementById('toastArea');
    if (!toastArea) return;
    const toast = document.createElement('div');
    toast.className = 'toast info';
    toast.innerHTML = `
        <span>${action} action performed</span>
        <button class="undo-btn ml-2 underline" style="color:white;">Undo</button>
    `;
    toastArea.appendChild(toast);
    const undoBtn = toast.querySelector('.undo-btn');
    undoBtn.onclick = async () => {
        // Undo logic: we need to know what to revert.
        // For simplicity, we can push a generic undo onto the stack that reverts the last change.
        // The actual implementation would need to store the previous state.
        // This is a placeholder; you can extend it as needed.
        await undo();
        toast.remove();
        showToast('Undone', 'success');
    };
    setTimeout(() => toast.remove(), 5000);
}
