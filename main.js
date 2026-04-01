// main.js - Main initialization and orchestration
// Must be loaded last, after all other scripts

// ========== HELPER FUNCTIONS ==========
async function fullRefresh() {
    await loadData();
    await detectConflicts();
    await renderCalendar();
    updateNotifications();
    // Update live JSON visualizer if present
    if (typeof updateLiveJSON === 'function') updateLiveJSON();
}

async function loadData() {
    try {
        events = await getAll('events');
        busyBlocks = await getAll('busyBlocks');
        places = await getAll('places');
        const overridesList = await getAll('overrides');
        overrides.clear();
        for (let ov of overridesList) overrides.set(ov.compositeKey, ov);
        attendanceLog = await getAll('attendanceLog');

        restPolicy = (await getSetting('restPolicy')) ?? 'home';
        farMinutes = (await getSetting('farMinutes')) ?? 10;
        firstDayOfWeek = (await getSetting('firstDayOfWeek')) ?? 1;
        timeFormat = (await getSetting('timeFormat')) ?? '12h';
        darkMode = (await getSetting('darkMode')) ?? false;
        notifyDayBefore = (await getSetting('notifyDayBefore')) ?? true;
        notifyMinutesBefore = (await getSetting('notifyMinutesBefore')) ?? 60;
        notifyTravelLead = (await getSetting('notifyTravelLead')) ?? 5;

        if (darkMode) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');

        if (!places.length) {
            places.push({ id: 1, name: 'Home', lat: null, lon: null, radius: 30, travelToEvent: {} });
            await putRecord('places', places[0]);
        }
        currentPlaceId = places[0]?.id || 1;
        const placeDisplay = document.getElementById('currentPlaceDisplay');
        if (placeDisplay) {
            placeDisplay.innerText = `📍 ${places.find(p => p.id === currentPlaceId)?.name || 'Home'}`;
        }

        syncSettingsToUI();
        console.log('loadData completed successfully');
    } catch (error) {
        console.error('loadData failed:', error);
        showToast('Failed to load data. Please refresh the page.', 'error');
    }
}

// ========== SHOW MAIN APP (hide wizard, show main UI) ==========
async function showMainApp() {
    const wizardOverlay = document.getElementById('wizardOverlay');
    const mainApp = document.getElementById('mainApp');
    const fab = document.getElementById('fab');

    if (wizardOverlay) wizardOverlay.classList.add('hidden');
    if (mainApp) {
        mainApp.classList.remove('hidden');
        // Optional: add a subtle animation
        mainApp.style.animation = 'fadeInUp 0.4s ease';
        setTimeout(() => { mainApp.style.animation = ''; }, 500);
    }
    if (fab) fab.classList.remove('hidden');

    await fullRefresh();
    // Scroll to current time after calendar renders
    if (typeof scrollToNow === 'function') scrollToNow();
    showToast('Ready!', 'success');
}

// ========== CONFLICT DETECTION ==========
async function detectConflicts() {
    conflicts = [];
    // For each day in the visible range (week or month), check event vs busy
    const start = new Date(currentDate);
    let end = new Date(currentDate);
    if (currentView === 'week') {
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - ((currentDate.getDay() - firstDayOfWeek + 7) % 7));
        start.setTime(startOfWeek.getTime());
        end.setTime(startOfWeek.getTime() + 7 * 86400000);
    } else {
        start.setDate(1);
        end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    }
    let cur = new Date(start);
    while (cur <= end) {
        const dateStr = formatDate(cur);
        const dayEvents = getEventsForDate(dateStr);
        const dayBusy = getBusyBlocksForDate(dateStr);
        for (let ev of dayEvents) {
            const evStart = toMinutes(ev.startTime);
            const evEnd = toMinutes(ev.endTime);
            for (let busy of dayBusy) {
                const busyStart = toMinutes(busy.startTime);
                const busyEnd = toMinutes(busy.endTime);
                if (evStart < busyEnd && evEnd > busyStart) {
                    conflicts.push({ type: 'busy', event: ev, busy });
                }
            }
        }
        cur.setDate(cur.getDate() + 1);
    }
}

// ========== TRAVEL TIME ESTIMATION ==========
function getTravelTime(eventId, fromPlaceId = currentPlaceId) {
    const fromPlace = places.find(p => p.id === fromPlaceId);
    const toPlace = places.find(p => p.id === currentPlaceId);
    if (!fromPlace || !toPlace) return 15;
    // If both places have coordinates, compute approximate distance
    if (fromPlace.lat && fromPlace.lon && toPlace.lat && toPlace.lon) {
        const dist = getDistance(fromPlace.lat, fromPlace.lon, toPlace.lat, toPlace.lon);
        // Assume walking speed 5 km/h => 1 km = 12 min
        const walkingMinutes = dist / (5000 / 60);
        return Math.min(60, Math.max(5, Math.round(walkingMinutes)));
    }
    // Fallback: look up custom travel time from place.travelToEvent map
    const custom = fromPlace.travelToEvent?.[eventId] || toPlace.travelToEvent?.[eventId];
    return custom ?? 15;
}

// ========== OPTIMIZER (Greedy Constraint Solver) ==========
async function runOptimizer() {
    // For demonstration, we'll just show a toast that the optimizer is not yet fully integrated.
    showToast('Optimizer running (beta) – this will pack events into your week.', 'info');
    // In a real implementation, you would:
    // - Get all unscheduled tasks (events with no specific date yet)
    // - Iterate over days in the planning range, find free blocks respecting travel+rest
    // - Assign events to slots greedily based on priority
    // - Update the schedule and persist overrides
    // This is a placeholder; the actual logic is complex and will be added later.
}

// ========== UNDO/REDO (Snapshots) ==========
async function pushAction(description, undoFunc, redoFunc) {
    // Store a snapshot of the current state
    const snapshot = {
        events: JSON.parse(JSON.stringify(events)),
        busyBlocks: JSON.parse(JSON.stringify(busyBlocks)),
        places: JSON.parse(JSON.stringify(places)),
        overrides: Array.from(overrides.entries())
    };
    const action = {
        description,
        undo: async () => {
            await restoreSnapshot(snapshot);
            if (undoFunc) await undoFunc();
        },
        redo: async () => {
            if (redoFunc) await redoFunc();
            else await fullRefresh();
        },
        timestamp: Date.now()
    };
    undoStack.push(action);
    redoStack = [];
    updateUndoRedoButtons();
}

async function restoreSnapshot(snapshot) {
    events = snapshot.events;
    busyBlocks = snapshot.busyBlocks;
    places = snapshot.places;
    overrides.clear();
    for (let [k, v] of snapshot.overrides) overrides.set(k, v);
    await fullRefresh();
}

async function undo() {
    if (undoStack.length === 0) return;
    const action = undoStack.pop();
    await action.undo();
    redoStack.push(action);
    updateUndoRedoButtons();
    showToast(`Undo: ${action.description}`);
}
async function redo() {
    if (redoStack.length === 0) return;
    const action = redoStack.pop();
    await action.redo();
    undoStack.push(action);
    updateUndoRedoButtons();
    showToast(`Redo: ${action.description}`);
}
function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// ========== GPS ==========
async function startGPS() {
    if (!navigator.geolocation) {
        showToast('GPS not supported', 'error');
        return;
    }
    if (gpsWatchId) stopGPS();
    gpsWatchId = navigator.geolocation.watchPosition(handleGpsPosition, gpsError, { enableHighAccuracy: true });
    showToast('GPS started');
}
function stopGPS() {
    if (gpsWatchId) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }
}
let lastGpsErrorTime = 0;
function gpsError(err) {
    const now = Date.now();
    if (now - lastGpsErrorTime > 10000) {
        lastGpsErrorTime = now;
        showToast(`GPS error: ${err.message}`, 'error');
    }
}
async function handleGpsPosition(position) {
    if (!position?.coords) return;
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    let matched = null;
    for (let p of places) {
        if (p.lat && p.lon) {
            const dist = getDistance(lat, lon, p.lat, p.lon);
            if (dist <= p.radius) { matched = p; break; }
        }
    }
    if (matched && matched.id !== currentPlaceId) {
        currentPlaceId = matched.id;
        await loadData();
        renderCalendar();
        showToast(`📍 You are at ${matched.name}`);
    } else if (!matched) {
        let closest = null, closestDist = Infinity;
        for (let p of places) {
            if (p.lat && p.lon) {
                const d = getDistance(lat, lon, p.lat, p.lon);
                if (d < closestDist) { closestDist = d; closest = p; }
            }
        }
        if (closest && closestDist < 200) {
            showGPSModal(closest, closestDist, lat, lon);
        }
    }
}

// ========== NUKE ANIMATION ==========
function showNukeAnimation() {
    const mainApp = document.getElementById('mainApp');
    if (!mainApp) return;
    mainApp.classList.add('nuke-flash');
    setTimeout(() => {
        mainApp.classList.remove('nuke-flash');
    }, 500);
}

// ========== MAIN INITIALIZATION ==========
window.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    await loadData();

    // Hide loading overlay
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    // Check if wizard has been completed
    const wizardComplete = await getSetting('wizardComplete');
    if (!wizardComplete) {
        // Show the enhanced wizard (defined in modals.js)
        if (typeof showWizard === 'function') {
            showWizard();
        } else {
            // Fallback in case modals.js not loaded properly
            console.warn('showWizard not available, using fallback');
            document.getElementById('wizardOverlay')?.classList.remove('hidden');
            // Use old renderWizardStep? But we removed it, so fallback to main app
            await showMainApp();
        }
    } else {
        // Wizard already done, show main app
        await showMainApp();
    }

    // ========== UI EVENT LISTENERS ==========
    document.getElementById('undoBtn')?.addEventListener('click', undo);
    document.getElementById('redoBtn')?.addEventListener('click', redo);
    document.getElementById('todayBtn')?.addEventListener('click', () => { currentDate = new Date(); renderCalendar(); });
    document.getElementById('prevBtn')?.addEventListener('click', () => {
        if (currentView === 'week') currentDate.setDate(currentDate.getDate() - 7);
        else currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('nextBtn')?.addEventListener('click', () => {
        if (currentView === 'week') currentDate.setDate(currentDate.getDate() + 7);
        else currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });
    document.getElementById('viewToggleBtn')?.addEventListener('click', () => {
        currentView = currentView === 'week' ? 'month' : 'week';
        const btn = document.getElementById('viewToggleBtn');
        if (btn) btn.innerHTML = currentView === 'week' ? '<i class="fas fa-calendar-week"></i> Week' : '<i class="fas fa-calendar-alt"></i> Month';
        renderCalendar();
    });
    document.getElementById('fab')?.addEventListener('click', () => openEventModal());
    document.getElementById('gpsUpdateBtn')?.addEventListener('click', () => {
        if (gpsWatchId) stopGPS();
        else startGPS();
    });

    // Wizard exit button (close wizard and go to app without completing)
    const wizardExitBtn = document.getElementById('wizardExitBtn');
    if (wizardExitBtn) {
        wizardExitBtn.addEventListener('click', async () => {
            // Mark wizard as complete to prevent showing again
            await setSetting('wizardComplete', true);
            // Close wizard overlay
            const wizardOverlay = document.getElementById('wizardOverlay');
            if (wizardOverlay) wizardOverlay.classList.add('hidden');
            // Show main app
            await showMainApp();
        });
    }

    // ========== MODAL BACKDROP CLOSE ==========
    document.querySelectorAll('.modal-backdrop[data-closeable]').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (modal.id === 'eventModal') {
                    closeEventModalWithCheck();
                } else {
                    ModalManager.close(modal.id);
                }
            }
        });
    });

    // ========== ESC KEY ==========
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (ModalManager.current === 'eventModal') {
                closeEventModalWithCheck();
            } else if (ModalManager.current) {
                ModalManager.close(ModalManager.current);
            }
        }
    });

    // ========== NOTIFICATION BELL ==========
    const notifBell = document.getElementById('notifBell');
    const notifPanel = document.getElementById('notifPanel');
    if (notifBell && notifPanel) {
        notifBell.addEventListener('click', (e) => {
            e.stopPropagation();
            notifPanel.classList.toggle('hidden');
            notificationLog.forEach(n => n.read = true);
            updateNotifBadge();
            renderNotifPanel();
        });
        document.addEventListener('click', (e) => {
            if (!notifPanel.contains(e.target) && e.target !== notifBell) {
                notifPanel.classList.add('hidden');
            }
        });
        document.getElementById('clearAllNotifs')?.addEventListener('click', () => {
            notificationLog.length = 0;
            updateNotifBadge();
            renderNotifPanel();
        });
    }

    // ========== EVENT REPEAT PANEL ==========
    const eventRepeatSelect = document.getElementById('eventRepeat');
    if (eventRepeatSelect) {
        eventRepeatSelect.addEventListener('change', () => {
            const val = eventRepeatSelect.value;
            const weeklyContainer = document.getElementById('weeklyDaysContainer');
            const monthlyContainer = document.getElementById('monthlyDayContainer');
            const repeatEnd = document.getElementById('eventRepeatEnd');
            if (weeklyContainer) weeklyContainer.classList.toggle('hidden', val !== 'weekly');
            if (monthlyContainer) monthlyContainer.classList.toggle('hidden', val !== 'monthly');
            if (repeatEnd) repeatEnd.classList.toggle('hidden', val === 'none');
        });
        eventRepeatSelect.dispatchEvent(new Event('change'));
    }

    // Weekly days container for event modal
    const weeklyContainer = document.getElementById('weeklyDaysContainer');
    if (weeklyContainer && weeklyContainer.children.length === 0) {
        const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        weeklyContainer.innerHTML = days.map((d, i) => `
            <label class="inline-flex items-center gap-1">
                <input type="checkbox" value="${i}" name="event_weekly_day_${i}"> ${d}
            </label>
        `).join('');
    }

    // ========== DARK MODE TOGGLE ==========
    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) {
        darkToggle.addEventListener('change', async (e) => {
            darkMode = e.target.checked;
            document.documentElement.classList.toggle('dark', darkMode);
            await setSetting('darkMode', darkMode);
            syncSettingsToUI();
        });
    }

    // ========== DRAFT MANAGERS ==========
    eventDraftManager = new FormDraft('eventModal', 'eventDraft', {
        priority: {
            read: (modal) => modal.querySelectorAll('#eventPriorityStars .fa-star.selected').length,
            write: (modal, value) => {
                const stars = modal.querySelectorAll('#eventPriorityStars .fa-star');
                stars.forEach((star, idx) => {
                    if (idx < value) star.classList.add('selected');
                    else star.classList.remove('selected');
                });
                const desc = document.getElementById('priorityDesc');
                if (desc) desc.innerText = getPriorityLabel(value);
            }
        },
        weeklyDays: {
            read: (modal) => {
                const checks = modal.querySelectorAll('#weeklyDaysContainer input:checked');
                return Array.from(checks).map(cb => parseInt(cb.value));
            },
            write: (modal, value) => {
                const checks = modal.querySelectorAll('#weeklyDaysContainer input');
                checks.forEach(cb => cb.checked = value.includes(parseInt(cb.value)));
            }
        }
    });

    busyDraftManager = new FormDraft('busyModal', 'busyDraft', {
        weeklyDays: {
            read: (modal) => {
                const checkboxes = modal.querySelectorAll('#busyDaysCheckboxes input:checked');
                return Array.from(checkboxes).map(cb => parseInt(cb.value));
            },
            write: (modal, value) => {
                const checkboxes = modal.querySelectorAll('#busyDaysCheckboxes input');
                checkboxes.forEach(cb => {
                    cb.checked = value.includes(parseInt(cb.value));
                });
            }
        }
    });

    // ========== SETTINGS MODAL ==========
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsX = document.getElementById('closeSettingsModal');
    const settingsDone = document.getElementById('settingsDoneBtn');
    function closeSettings() {
        if (settingsModal) settingsModal.classList.add('hidden');
        showToast('Settings saved', 'success');
    }
    if (closeSettingsX) closeSettingsX.onclick = closeSettings;
    if (settingsDone) settingsDone.onclick = closeSettings;
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) closeSettings();
        });
    }

    // Settings button opens and refreshes lists
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
        if (settingsModal) {
            // Reset to preferences tab
            const prefTab = Array.from(document.querySelectorAll('.settings-tab')).find(t => t.dataset.tab === 'preferences');
            if (prefTab) prefTab.click();
            ModalManager.open('settingsModal');
            renderPlacesList();
            renderBusyBlocksList();
        }
    });

    // Settings tabs
    setupSettingsTabs();

    const nextBtn = document.getElementById('settingsNextBtn');
    let currentTab = 'preferences';

    function updateSettingsButtons() {
        if (currentTab === 'data') {
            nextBtn?.classList.add('hidden');
            settingsDone?.classList.remove('hidden');
        } else {
            nextBtn?.classList.remove('hidden');
            settingsDone?.classList.add('hidden');
        }
    }

    function switchTab(tabId) {
        const tabs = document.querySelectorAll('.settings-tab');
        tabs.forEach(tab => {
            tab.classList.remove('border-blue-600', 'text-blue-600');
            tab.classList.add('text-gray-500');
        });
        const activeTab = Array.from(tabs).find(t => t.dataset.tab === tabId);
        if (activeTab) {
            activeTab.classList.add('border-blue-600', 'text-blue-600');
            activeTab.classList.remove('text-gray-500');
        }
        const panels = {
            preferences: document.getElementById('settings-preferences'),
            scheduling: document.getElementById('settings-scheduling'),
            notifications: document.getElementById('settings-notifications'),
            data: document.getElementById('settings-data')
        };
        Object.values(panels).forEach(panel => panel?.classList.add('hidden'));
        if (panels[tabId]) panels[tabId].classList.remove('hidden');
        currentTab = tabId;
        updateSettingsButtons();
    }

    const tabHeaders = document.querySelectorAll('.settings-tab');
    tabHeaders.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    const tabOrder = ['preferences', 'scheduling', 'notifications', 'data'];
    nextBtn?.addEventListener('click', () => {
        const idx = tabOrder.indexOf(currentTab);
        if (idx < tabOrder.length - 1) switchTab(tabOrder[idx + 1]);
    });
    switchTab('preferences');

    // ========== SAVE EVENT (with validation) ==========
    const saveEventBtn = document.getElementById('saveEventBtn');
    if (saveEventBtn) {
        saveEventBtn.addEventListener('click', async () => {
            const spinner = saveEventBtn.querySelector('.fa-spinner');
            saveEventBtn.disabled = true;
            if (spinner) spinner.classList.remove('hidden');
            try {
                // Validate form before saving
                if (!validateEventForm()) {
                    saveEventBtn.disabled = false;
                    if (spinner) spinner.classList.add('hidden');
                    return;
                }

                const eventName = document.getElementById('eventName').value.trim();
                const eventData = {
                    id: editingEventId || undefined,
                    name: eventName,
                    openTime: document.getElementById('eventOpenTime').value,
                    closeTime: document.getElementById('eventCloseTime').value,
                    minStay: parseInt(document.getElementById('eventMinStay').value),
                    maxStay: parseInt(document.getElementById('eventMaxStay').value),
                    frequency: document.getElementById('eventFrequency').value,
                    scarce: document.getElementById('eventScarce').checked,
                    remindRecency: document.getElementById('eventRemindRecency').checked,
                    repeat: document.getElementById('eventRepeat').value,
                    repeatEnd: document.getElementById('eventRepeatEnd').value,
                    notes: document.getElementById('eventNotes').value,
                    color: document.getElementById('eventColor').value,
                    startDate: editingDateStr || formatDate(new Date()),
                    startTime: document.getElementById('eventOpenTime').value,
                    endTime: fromMinutes(toMinutes(document.getElementById('eventOpenTime').value) + 60),
                    priority: document.querySelectorAll('#eventPriorityStars .fa-star.selected').length,
                    travelMins: 15,
                    weeklyDays: Array.from(document.querySelectorAll('#weeklyDaysContainer input:checked')).map(cb => parseInt(cb.value)),
                    monthlyDay: parseInt(document.getElementById('monthlyDay').value)
                };
                if (editingEventId && editingDateStr) {
                    const key = `${editingEventId}_${editingDateStr}`;
                    await putRecord('overrides', { compositeKey: key, eventId: editingEventId, dateStr: editingDateStr, type: 'exception', newEvent: eventData });
                    showToast(`Updated occurrence of ${eventData.name}`);
                    await pushAction(`Override occurrence of ${eventData.name}`, async () => {}, async () => {});
                } else if (editingEventId) {
                    await putRecord('events', eventData);
                    await pushAction(`Edit event ${eventData.name}`, async () => {}, async () => {});
                } else {
                    await addRecord('events', eventData);
                    await pushAction(`Add event ${eventData.name}`, async () => {}, async () => {});
                }
                if (eventDraftManager) await eventDraftManager.clearDraft();
                await fullRefresh();
                ModalManager.close('eventModal');
            } finally {
                saveEventBtn.disabled = false;
                if (spinner) spinner.classList.add('hidden');
            }
        });
    }

    // ========== SAVE BUSY (shared logic) ==========
    async function saveBusyBlockFromForm() {
        const busy = {
            description: document.getElementById('busyDescription').value,
            hard: document.getElementById('busyHard').checked,
            recurrence: document.getElementById('busyRecurrence').value,
            startTime: document.getElementById('busyStartTime').value,
            endTime: document.getElementById('busyEndTime').value,
            allDay: document.getElementById('busyAllDay').checked,
            tag: document.getElementById('busyTag').value
        };
        if (busy.recurrence === 'once') busy.date = document.getElementById('busyDate').value;
        if (busy.recurrence === 'daterange') {
            busy.startDate = document.getElementById('busyRangeStart').value;
            busy.endDate = document.getElementById('busyRangeEnd').value;
        }
        if (busy.recurrence === 'weekly') {
            busy.daysOfWeek = Array.from(document.querySelectorAll('#busyDaysCheckboxes input:checked')).map(cb => parseInt(cb.value));
        }
        await addRecord('busyBlocks', busy);
        if (busyDraftManager) await busyDraftManager.clearDraft();
        await fullRefresh();
        return busy;
    }

    document.getElementById('saveBusyBtn')?.addEventListener('click', async () => {
        await saveBusyBlockFromForm();
        ModalManager.close('busyModal');
    });

    document.getElementById('saveAddAnotherBusyBtn')?.addEventListener('click', async () => {
        await saveBusyBlockFromForm();
        // Reset form
        document.getElementById('busyDescription').value = '';
        document.getElementById('busyDate').value = '';
        document.getElementById('busyStartTime').value = '09:00';
        document.getElementById('busyEndTime').value = '17:00';
        document.querySelectorAll('#busyDaysCheckboxes input').forEach(cb => cb.checked = false);
        document.getElementById('busyDescription').focus();
        showToast('Saved — add another', 'success');
    });

    // ========== BUSY RECURRENCE CHANGE ==========
    document.getElementById('busyRecurrence')?.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('busyDateSingle').classList.toggle('hidden', val !== 'once');
        document.getElementById('busyDateRange').classList.toggle('hidden', val !== 'daterange');
        document.getElementById('busyWeeklyDays').classList.toggle('hidden', val !== 'weekly');
    });
    document.getElementById('busyRecurrence')?.dispatchEvent(new Event('change'));

    // ========== MODAL CANCEL/CLOSE ==========
    document.getElementById('cancelEventBtn')?.addEventListener('click', closeEventModalWithCheck);
    document.getElementById('closeEventModal')?.addEventListener('click', closeEventModalWithCheck);
    document.getElementById('closeBusyModal')?.addEventListener('click', () => ModalManager.close('busyModal'));
    document.getElementById('cancelBusyBtn')?.addEventListener('click', () => ModalManager.close('busyModal'));
    document.getElementById('clearDraftBtn')?.addEventListener('click', async () => {
        if (eventDraftManager) await eventDraftManager.clearDraft();
        document.getElementById('draftBanner')?.classList.add('hidden');
        showToast('Draft cleared', 'success');
    });

    // ========== SETTINGS LISTENERS ==========
    document.getElementById('restPolicySelect')?.addEventListener('change', async (e) => {
        restPolicy = e.target.value;
        await setSetting('restPolicy', restPolicy);
        syncSettingsToUI();
    });
    document.getElementById('farMinutes')?.addEventListener('change', async (e) => {
        farMinutes = parseInt(e.target.value);
        await setSetting('farMinutes', farMinutes);
        syncSettingsToUI();
    });
    document.getElementById('firstDayOfWeek')?.addEventListener('change', async (e) => {
        firstDayOfWeek = parseInt(e.target.value);
        await setSetting('firstDayOfWeek', firstDayOfWeek);
        syncSettingsToUI();
        renderCalendar();
    });
    document.getElementById('timeFormat')?.addEventListener('change', async (e) => {
        timeFormat = e.target.value;
        await setSetting('timeFormat', timeFormat);
        syncSettingsToUI();
        renderCalendar();
    });
    document.getElementById('notifyDayBefore')?.addEventListener('change', async (e) => {
        notifyDayBefore = e.target.checked;
        await setSetting('notifyDayBefore', notifyDayBefore);
        syncSettingsToUI();
        updateNotifications();
    });
    document.getElementById('notifyMinutesBefore')?.addEventListener('change', async (e) => {
        notifyMinutesBefore = parseInt(e.target.value);
        await setSetting('notifyMinutesBefore', notifyMinutesBefore);
        syncSettingsToUI();
        updateNotifications();
    });
    document.getElementById('notifyTravelLead')?.addEventListener('change', async (e) => {
        notifyTravelLead = parseInt(e.target.value);
        await setSetting('notifyTravelLead', notifyTravelLead);
        syncSettingsToUI();
        updateNotifications();
    });

    // ========== ADVANCED OPTIONS TOGGLE ==========
    const toggleAdvancedBtn = document.getElementById('toggleAdvancedBtn');
    if (toggleAdvancedBtn) {
        toggleAdvancedBtn.addEventListener('click', () => {
            const adv = document.getElementById('advancedOptions');
            if (adv) adv.classList.toggle('hidden');
        });
    }

    // ========== EXPORT/IMPORT/RESET (with nuke animation) ==========
    document.getElementById('exportDataBtn')?.addEventListener('click', async () => {
        const data = { events, busyBlocks, places, overrides: Array.from(overrides.values()) };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const a = document.createElement('a');
        const date = new Date().toISOString().split('T')[0];
        a.href = URL.createObjectURL(blob);
        a.download = `scheduler_backup_${date}.json`;
        a.click();
    });
    document.getElementById('importDataBtn')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!data.events) throw new Error('Invalid format');
                const summary = `File contains ${data.events.length} events, ${data.busyBlocks?.length || 0} busy blocks. Import will replace all current data. Continue?`;
                if (confirm(summary)) {
                    showNukeAnimation(); // Visual feedback before reset
                    for (let s of ['events', 'busyBlocks', 'places', 'overrides']) {
                        const store = await getStore(s, 'readwrite');
                        await clearStore(s);
                    }
                    for (let ev of data.events) await addRecord('events', ev);
                    for (let bb of data.busyBlocks || []) await addRecord('busyBlocks', bb);
                    for (let pl of data.places || []) await addRecord('places', pl);
                    for (let ov of data.overrides || []) await putRecord('overrides', ov);
                    await fullRefresh();
                    showToast('Import successful', 'success');
                }
            } catch (err) {
                showToast('Import failed: ' + err.message, 'error');
            }
        };
        input.click();
    });
    document.getElementById('resetAllDataBtn')?.addEventListener('click', async () => {
        const choice = confirm('Delete ALL data? This cannot be undone. Click OK to reset, Cancel to export first.');
        if (choice) {
            showNukeAnimation(); // Visual flash before clearing
            const stores = ['events', 'busyBlocks', 'places', 'overrides', 'settings', 'attendanceLog', 'drafts'];
            for (let s of stores) { try { await clearStore(s); } catch(e) {} }
            localStorage.clear();
            location.reload();
        } else {
            document.getElementById('exportDataBtn').click();
        }
    });

    // ========== SWIPE NAVIGATION ==========
    let touchStartX = 0;
    let touchEndX = 0;
    const calendarContainer = document.getElementById('calendarContainer');
    if (calendarContainer) {
        calendarContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        });
        calendarContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            if (touchEndX < touchStartX - 50) {
                if (currentView === 'week') currentDate.setDate(currentDate.getDate() + 7);
                else currentDate.setMonth(currentDate.getMonth() + 1);
                renderCalendar();
            } else if (touchEndX > touchStartX + 50) {
                if (currentView === 'week') currentDate.setDate(currentDate.getDate() - 7);
                else currentDate.setMonth(currentDate.getMonth() - 1);
                renderCalendar();
            }
        });
    }

    // ========== NOTIFICATION PERMISSION (fallback) ==========
    // Only request if wizard is complete and permission still default
    const wizardCompleteFlag = await getSetting('wizardComplete');
    if (wizardCompleteFlag && Notification.permission === "default") {
        // Delay a bit to not interrupt the user
        setTimeout(() => {
            Notification.requestPermission();
        }, 3000);
    }
});
