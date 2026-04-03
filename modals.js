/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
/*
 * modals.js - Core modal handling (Events, Busy, Todos, Feedback, Bottom Sheet, Conflict)
 * Must be loaded after state.js, utils.js, db.js, calendar.js
 *
 * All wizard and event list code has been moved to their respective modules.
 */

// ========== GLOBAL CLOSE BUTTON HANDLER ==========
document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.modal-close');
    if (closeBtn) {
        const modal = closeBtn.closest('.modal-backdrop');
        if (modal) {
            if (modal.id === 'eventModal') {
                closeEventModalWithCheck();
            } else {
                ModalManager.close(modal.id);
            }
        }
    }
});

// ========== UNIVERSAL CANCEL BUTTON HANDLER ==========
document.addEventListener('click', (e) => {
    // Select any button that contains "Cancel" text or has a cancel-themed ID
    if (e.target.id?.toLowerCase().includes('cancel') || e.target.innerText?.trim() === 'Cancel') {
        const modal = e.target.closest('.modal-backdrop');
        if (modal) {
            e.preventDefault();
            if (modal.id === 'eventModal') {
                closeEventModalWithCheck();
            } else {
                ModalManager.close(modal.id);
            }
        }
    }
});

// ========== MODAL MANAGER (Global Focus Trap) ==========
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

// ========== EVENT MODAL ==========
let eventFormSnapshot = {};

function openEventModal(event = null, dateStr = null) {
    const modal = document.getElementById('eventModal');
    if (!modal) return;

    const titleEl = modal.querySelector('h3');
    if (titleEl) titleEl.textContent = event ? 'Edit event' : 'Add event';

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

        // Populate location dropdown
        const placeSelect = document.getElementById('eventPlaceId');
        if (placeSelect) {
            while (placeSelect.options.length > 1) placeSelect.remove(1);
            for (const place of places) {
                const option = document.createElement('option');
                option.value = place.id;
                option.textContent = place.name;
                placeSelect.appendChild(option);
            }
            placeSelect.value = data.placeId || '';
        }

        buildColorPalette(data.color || '#3b82f6');

        const stars = document.querySelectorAll('#eventPriorityStars .fa-star');
        const priority = data.priority ?? 3;
        stars.forEach((star, idx) => {
            star.classList.toggle('selected', idx < priority);
            const newStar = star.cloneNode(true);
            star.parentNode.replaceChild(newStar, star);
        });
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

        document.querySelectorAll('#weeklyDaysContainer input').forEach(cb => {
            cb.checked = !!(data.weeklyDays && data.weeklyDays.includes(parseInt(cb.value)));
        });
        document.getElementById('monthlyDay').value = data.monthlyDay ?? 1;

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

    editingEventId = null;
    editingDateStr = dateStr || null;

    // Populate default empty form immediately to ensure DOM is ready
    populateForm({});

    if (eventDraftManager) {
        eventDraftManager.loadDraft().then(() => {
            const draftRaw = localStorage.getItem(`draft_${eventDraftManager.key}`);
            let draft = null;
            if (draftRaw) {
                try {
                    draft = JSON.parse(draftRaw);
                } catch(e) {}
            }
            if (draft && Object.keys(draft).length > 0) {
                if (draftBanner) draftBanner.classList.remove('hidden');
                buildColorPalette(document.getElementById('eventColor')?.value || '#3b82f6');
                eventDraftManager.restore(draft);
            }
            ModalManager.open('eventModal');
            document.getElementById('eventRepeat')?.dispatchEvent(new Event('change'));
        }).catch(() => {
            ModalManager.open('eventModal');
            document.getElementById('eventRepeat')?.dispatchEvent(new Event('change'));
        });
    } else {
        ModalManager.open('eventModal');
        document.getElementById('eventRepeat')?.dispatchEvent(new Event('change'));
    }
}

function closeEventModalWithCheck() {
    if (isFormDirty('eventModal', eventFormSnapshot)) {
        const existing = document.getElementById('dirtyWarning');
        if (existing) return; // already showing
        
        const modal = document.getElementById('eventModal');
        const header = modal.querySelector('.modal-header');
        
        const warning = document.createElement('div');
        warning.id = 'dirtyWarning';
        warning.className = 'bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4 rounded shadow-md flex justify-between items-center';
        warning.innerHTML = `
            <div>
                <strong class="block font-bold"><i class="fas fa-exclamation-triangle"></i> Unsaved Changes</strong>
                <span class="text-sm">Are you sure you want to discard your changes?</span>
            </div>
            <div class="flex gap-2">
                <button id="keepEditingBtn" class="bg-white text-gray-700 border border-gray-300 px-3 py-1 rounded shadow-sm text-sm font-bold hover:bg-gray-50">Keep Editing</button>
                <button id="discardChangesBtn" class="bg-red-600 text-white px-3 py-1 rounded shadow-sm text-sm font-bold hover:bg-red-700">Discard</button>
            </div>
        `;
        
        // Insert right below the header
        header.insertAdjacentElement('afterend', warning);
        
        document.getElementById('discardChangesBtn').onclick = async () => {
            warning.remove();
            if (eventDraftManager) await eventDraftManager.clearDraft();
            ModalManager.close('eventModal');
        };
        document.getElementById('keepEditingBtn').onclick = () => warning.remove();
    } else {
        ModalManager.close('eventModal');
    }
}

function validateEventForm() {
    document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
    document.querySelectorAll('.field-error-msg').forEach(el => el.remove());

    let isValid = true;

    const nameInput = document.getElementById('eventName');
    if (!nameInput.value.trim()) {
        showFieldError(nameInput, 'Event name is required');
        isValid = false;
    }

    const openTime = document.getElementById('eventOpenTime').value;
    const closeTime = document.getElementById('eventCloseTime').value;
    if (openTime && closeTime) {
        const openMin = toMinutes(openTime);
        const closeMin = toMinutes(closeTime);
        if (closeMin <= openMin) {
            showFieldError(document.getElementById('eventCloseTime'), 'Close time must be after open time');
            isValid = false;
        }

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
        editingBusyId = busy.id; // FIX: set the ID for editing
        populate(busy);
        if (busyDraftManager) busyDraftManager.clearDraft();
        ModalManager.open('busyModal');
        document.getElementById('busyRecurrence')?.dispatchEvent(new Event('change'));
        return;
    }

    // New busy block: populate empty form
    editingBusyId = null; // FIX: clear editing ID for new block
    populate({ date: dateStr || formatDate(new Date()) });
    if (busyDraftManager) {
        busyDraftManager.loadDraft().then(() => {
            ModalManager.open('busyModal');
            document.getElementById('busyRecurrence')?.dispatchEvent(new Event('change'));
        });
    } else {
        ModalManager.open('busyModal');
        document.getElementById('busyRecurrence')?.dispatchEvent(new Event('change'));
    }
}

// ========== TODO MODAL ==========
let editingTodoId = null;

function openTodoModal(todo = null) {
    const modal = document.getElementById('todoModal');
    if (!modal) return;

    const titleEl = modal.querySelector('h3');
    if (titleEl) titleEl.textContent = todo ? 'Edit to‑do' : 'Add to‑do';

    function populate(data) {
        document.getElementById('todoName').value = data.name || '';
        document.getElementById('todoDueDate').value = data.dueDate || '';
        document.getElementById('todoPriority').value = data.priority || 3;
        document.getElementById('todoNotes').value = data.notes || '';
        document.getElementById('todoRecurrence').value = data.recurrence || 'none';
        document.getElementById('todoCompleted').checked = data.completed || false;
    }

    if (todo) {
        populate(todo);
        editingTodoId = todo.id;
        if (todoDraftManager) todoDraftManager.clearDraft();
        ModalManager.open('todoModal');
        return;
    }

    editingTodoId = null;
    populate({});
    if (todoDraftManager) {
        todoDraftManager.loadDraft().then(() => {
            ModalManager.open('todoModal');
        }).catch(() => {
            ModalManager.open('todoModal');
        });
    } else {
        ModalManager.open('todoModal');
    }
}

async function saveTodoModal() {
    const todoData = {
        id: editingTodoId || undefined,
        name: document.getElementById('todoName').value.trim(),
        dueDate: document.getElementById('todoDueDate').value,
        priority: parseInt(document.getElementById('todoPriority').value),
        notes: document.getElementById('todoNotes').value,
        recurrence: document.getElementById('todoRecurrence').value,
        completed: document.getElementById('todoCompleted').checked,
        createdAt: new Date().toISOString()
    };
    if (!todoData.name) {
        showToast('Please enter a to‑do name', 'error');
        return;
    }
    if (editingTodoId) {
        await putRecord('todos', todoData);
        showToast('To‑do updated', 'success');
    } else {
        await addRecord('todos', todoData);
        showToast('To‑do added', 'success');
    }
    if (todoDraftManager) await todoDraftManager.clearDraft();
    await fullRefresh();
    ModalManager.close('todoModal');
}

// ========== FEEDBACK MODAL ==========
function showFeedbackModal(event, dateStr) {
    const modal = document.getElementById('feedbackModal');
    if (!modal) return;

    const eventNameSpan = modal.querySelector('.event-name');
    if (eventNameSpan) eventNameSpan.textContent = event.name;

    const likeBtn = modal.querySelector('#feedbackLike');
    const dislikeBtn = modal.querySelector('#feedbackDislike');
    const commentInput = modal.querySelector('#feedbackComment');
    const submitBtn = modal.querySelector('#submitFeedbackBtn');
    const cancelBtn = modal.querySelector('#cancelFeedbackBtn');

    let feedbackType = null;

    likeBtn.onclick = () => {
        feedbackType = 'like';
        likeBtn.classList.add('bg-green-100', 'border-green-500');
        dislikeBtn.classList.remove('bg-red-100', 'border-red-500');
    };
    dislikeBtn.onclick = () => {
        feedbackType = 'dislike';
        dislikeBtn.classList.add('bg-red-100', 'border-red-500');
        likeBtn.classList.remove('bg-green-100', 'border-green-500');
    };
    submitBtn.onclick = async () => {
        if (!feedbackType) {
            showToast('Please select like or dislike', 'error');
            return;
        }
        const comment = commentInput ? commentInput.value.trim() : '';
        const feedbackRecord = {
            eventId: event.id,
            dateStr: dateStr,
            type: feedbackType,
            comment: comment || null,
            timestamp: new Date().toISOString()
        };
        await addRecord('userFeedback', feedbackRecord);
        await addRecord('learningData', {
            type: 'preference',
            eventId: event.id,
            dateStr: dateStr,
            preference: feedbackType,
            comment: comment,
            timestamp: new Date()
        });
        showToast('Thanks for your feedback!', 'success');
        ModalManager.close('feedbackModal');
        if (typeof runOptimizer === 'function') runOptimizer();
    };
    cancelBtn.onclick = () => ModalManager.close('feedbackModal');

    ModalManager.open('feedbackModal');
}

// ========== CONFLICT RESOLUTION MODAL ==========
function showConflictModal(conflictInfo) {
    const modal = document.getElementById('conflictModal');
    if (!modal) return;

    const messageEl = modal.querySelector('.conflict-message');
    if (messageEl) messageEl.textContent = conflictInfo.message;

    const resolveBtn = modal.querySelector('#resolveConflictBtn');
    const ignoreBtn = modal.querySelector('#ignoreConflictBtn');
    const overlapBtn = modal.querySelector('#overlapConflictBtn');
    const splitBtn = modal.querySelector('#splitConflictBtn');

    // Remove existing listeners by cloning
    const newResolve = resolveBtn.cloneNode(true);
    const newIgnore = ignoreBtn.cloneNode(true);
    const newOverlap = overlapBtn.cloneNode(true);
    const newSplit = splitBtn.cloneNode(true);
    resolveBtn.parentNode.replaceChild(newResolve, resolveBtn);
    ignoreBtn.parentNode.replaceChild(newIgnore, ignoreBtn);
    overlapBtn.parentNode.replaceChild(newOverlap, overlapBtn);
    splitBtn.parentNode.replaceChild(newSplit, splitBtn);

    // Return a Promise that resolves with the user's action string
    return new Promise((resolve) => {
        newResolve.onclick = () => {
            ModalManager.close('conflictModal');
            resolve('reschedule');
        };
        newIgnore.onclick = () => {
            ModalManager.close('conflictModal');
            resolve('ignore');
        };
        newOverlap.onclick = () => {
            ModalManager.close('conflictModal');
            resolve('overlap');
        };
        newSplit.onclick = async () => {
            if (conflictInfo.busyObj && conflictInfo.eventObj) {
                try {
                    await BusyManager.splitBusyBlock(
                        conflictInfo.busyObj.id,
                        conflictInfo.busyObj.date,
                        conflictInfo.eventObj.startTime,
                        true
                    );
                    showToast('Busy block split', 'success');
                    resolve('split');
                } catch (e) {
                    showToast('Cannot split this busy block', 'error');
                    resolve('ignore');
                }
            } else {
                resolve('ignore');
            }
            ModalManager.close('conflictModal');
        };
    });
}

// ========== BOTTOM SHEET CONTEXT MENU ==========
function showBottomSheet(eventId, dateStr) {
    const ev = events.find(e => e.id === eventId);
    if (!ev) return;

    const sheet = document.getElementById('bottomSheet');
    if (!sheet) return;

    const key = `${eventId}_${dateStr}`;
    const isNogo = overrides.has(key) && overrides.get(key).type === 'nogo';
    const isLocked = overrides.has(key) && overrides.get(key).type === 'locked';
    const isAttended = attendanceLog.some(log => log.eventId === eventId && log.dateStr === dateStr);

    sheet.querySelector('.sheet-title').textContent = ev.name;
    sheet.querySelector('.sheet-desc').textContent = `${formatDateDisplay(dateStr)} • ${formatTime(toMinutes(ev.startTime))} – ${formatTime(toMinutes(ev.endTime))}`;

    const editBtn = sheet.querySelector('#sheetEdit');
    const skipBtn = sheet.querySelector('#sheetSkip');
    const attendedBtn = sheet.querySelector('#sheetAttended');
    const lockBtn = sheet.querySelector('#sheetLock');
    const deleteBtn = sheet.querySelector('#sheetDelete');
    const feedbackBtn = sheet.querySelector('#sheetFeedback');

    // Edit
    editBtn.onclick = () => { closeBottomSheet(); openEventModal(ev, dateStr); };

    // Skip
    skipBtn.innerHTML = isNogo ? '<span class="action-icon"><i class="fas fa-undo"></i></span> Unskip' : '<span class="action-icon"><i class="fas fa-ban"></i></span> Skip (No Go)';
    skipBtn.onclick = async () => {
        await EventManager.applyOverride(eventId, dateStr, 'nogo');
        closeBottomSheet();
        await fullRefresh();
    };

    // Attend
    attendedBtn.innerHTML = isAttended ? '<span class="action-icon"><i class="fas fa-check-double"></i></span> Attended' : '<span class="action-icon"><i class="fas fa-check"></i></span> Mark Attended';
    attendedBtn.onclick = async () => {
        if (!isAttended) {
            const plannedMinutes = (toMinutes(ev.endTime) - toMinutes(ev.startTime));
            let actualMinutes = null;
            if (typeof UserLearning !== 'undefined' && userSettings.autoLearn) {
                const userInput = prompt(`How many minutes did you actually spend? (Planned: ${plannedMinutes} min)`, plannedMinutes);
                if (userInput !== null) {
                    const parsed = parseInt(userInput);
                    if (!isNaN(parsed) && parsed > 0) actualMinutes = parsed;
                }
            }
            await addRecord(STORES.ATTENDANCE_LOG, { eventId, dateStr, timestamp: new Date() });
            if (actualMinutes !== null && typeof UserLearning !== 'undefined') {
                await UserLearning.recordEventDuration(eventId, dateStr, actualMinutes);
                showToast(`Marked as attended (actual: ${actualMinutes} min)`, 'success');
            } else {
                showToast('Marked as attended', 'success');
            }
        } else {
            showToast('Already marked as attended', 'info');
        }
        closeBottomSheet();
        await fullRefresh();
    };

    // Lock
    lockBtn.innerHTML = isLocked ? '<span class="action-icon"><i class="fas fa-unlock"></i></span> Unlock' : '<span class="action-icon"><i class="fas fa-lock"></i></span> Don\'t move';
    lockBtn.onclick = async () => {
        await EventManager.applyOverride(eventId, dateStr, 'locked');
        closeBottomSheet();
        await fullRefresh();
    };

    // Delete
    deleteBtn.onclick = async () => {
        if (confirm(`Delete "${ev.name}" on ${dateStr}? This cannot be undone.`)) {
            if (typeof EventManager !== 'undefined' && EventManager.deleteEvent) {
                await EventManager.deleteEvent(eventId);
            } else {
                await deleteRecord('events', eventId);
            }
            await fullRefresh();
            closeBottomSheet();
            showUndoToast('Delete', { eventId, dateStr });
        }
    };

    // Feedback
    feedbackBtn.onclick = () => {
        closeBottomSheet();
        showFeedbackModal(ev, dateStr);
    };

    // Show sheet
    sheet.classList.add('open');
    const backdrop = document.getElementById('bottomSheetBackdrop');
    backdrop.classList.add('active');
    backdrop.onclick = closeBottomSheet;
    document.addEventListener('keydown', bottomSheetKeyHandler);
}

function closeBottomSheet() {
    const sheet = document.getElementById('bottomSheet');
    if (sheet) sheet.classList.remove('open');
    const backdrop = document.getElementById('bottomSheetBackdrop');
    if (backdrop) backdrop.classList.remove('active');
    document.removeEventListener('keydown', bottomSheetKeyHandler);
}

function bottomSheetKeyHandler(e) {
    if (e.key === 'Escape') closeBottomSheet();
}

window.showContextMenu = function(x, y, eventId, dateStr) {
    showBottomSheet(eventId, dateStr);
};

// ========== GPS DISAMBIGUATION MODAL ==========
function showGPSModal(place, distance, lat, lon) {
    const modal = document.getElementById('gpsDisambigModal');
    if (!modal) return;

    modal.querySelector('.place-name').textContent = place.name;
    modal.querySelector('.distance').textContent = Math.round(distance);
    const widenBtn = modal.querySelector('#gpsWidenRadius');
    const createBtn = modal.querySelector('#gpsCreatePlace');
    const sublocationBtn = modal.querySelector('#gpsCreateSublocation');

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

    if (sublocationBtn) {
        sublocationBtn.onclick = () => {
            ModalManager.close('gpsDisambigModal');
            showSublocationModal(place, lat, lon, async (updatedPlace, subName) => {
                if (updatedPlace && subName) {
                    await loadData();
                    showToast(`Added sublocation: ${subName}`, 'success');
                }
            });
        };
    }

    ModalManager.open('gpsDisambigModal');
}

// ========== SUBLOCATION MODAL ==========
function showSublocationModal(place, lat, lon, onConfirm) {
    const modal = document.getElementById('sublocationModal');
    if (!modal) return;

    const placeNameSpan = modal.querySelector('.place-name');
    if (placeNameSpan) placeNameSpan.textContent = place.name;

    const input = modal.querySelector('#sublocationName');
    const saveBtn = modal.querySelector('#saveSublocationBtn');
    const cancelBtn = modal.querySelector('#cancelSublocationBtn');

    if (input) input.value = '';

    const saveHandler = async () => {
        const name = input ? input.value.trim() : '';
        if (!name) {
            showToast('Please enter a name for this spot', 'error');
            return;
        }
        if (!place.sublocations) place.sublocations = [];
        place.sublocations.push({ name, lat, lon });
        await putRecord('places', place);
        if (onConfirm) onConfirm(place, name);
        ModalManager.close('sublocationModal');
    };
    const cancelHandler = () => {
        if (onConfirm) onConfirm(null, null);
        ModalManager.close('sublocationModal');
    };

    saveBtn.onclick = saveHandler;
    cancelBtn.onclick = cancelHandler;

    ModalManager.open('sublocationModal');
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
        await undo();
        toast.remove();
        showToast('Undone', 'success');
    };
    setTimeout(() => toast.remove(), 5000);
}