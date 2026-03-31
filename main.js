// main.js - Main initialization and orchestration
// Must be loaded last, after all other scripts

// ========== HELPER FUNCTIONS ==========
async function fullRefresh() {
    await loadData();
    await detectConflicts();
    await renderCalendar();
    updateNotifications();
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

// ========== UNDO/REDO ==========
async function pushAction(description, undoFunc, redoFunc) {
    const action = { description, undo: undoFunc, redo: redoFunc, timestamp: Date.now() };
    undoStack.push(action);
    redoStack = [];
    updateUndoRedoButtons();
}
async function undo() {
    if (undoStack.length === 0) return;
    const action = undoStack.pop();
    await action.undo();
    redoStack.push(action);
    updateUndoRedoButtons();
    await fullRefresh();
    showToast(`Undo: ${action.description}`);
}
async function redo() {
    if (redoStack.length === 0) return;
    const action = redoStack.pop();
    await action.redo();
    undoStack.push(action);
    updateUndoRedoButtons();
    await fullRefresh();
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
            if (confirm(`You are ${Math.round(closestDist)}m from "${closest.name}". Make its radius larger?`)) {
                closest.radius = Math.max(closest.radius, closestDist + 10);
                await putRecord('places', closest);
                await loadData();
                showToast(`Radius of ${closest.name} expanded to ${Math.round(closest.radius)}m`);
            } else {
                const newName = prompt(`Create a new place? Enter name:`);
                if (newName) {
                    const newPlace = { name: newName, lat, lon, radius: 30, travelToEvent: {} };
                    const id = await addRecord('places', newPlace);
                    places.push({ ...newPlace, id });
                    await loadData();
                    showToast(`Created new place: ${newName}`);
                }
            }
        }
    }
}

// ========== WIZARD ==========
function renderWizardStep() {
    const container = document.getElementById('wizardStepsContainer');
    const backBtn = document.getElementById('wizardBackBtn');
    const nextBtn = document.getElementById('wizardNextBtn');
    const finishBtn = document.getElementById('wizardFinishBtn');

    if (wizardStep === 1) {
        container.innerHTML = `
            <p class="mb-4 text-gray-600">Let's set your home location so I know where you start from.</p>
            <button id="wizardUseGps" class="w-full bg-blue-600 text-white px-4 py-3 rounded-xl mb-2 flex items-center justify-center gap-2 hover:bg-blue-700 transition">
                <i class="fas fa-location-arrow"></i> Use my current location
            </button>
            <button id="wizardSkipGps" class="w-full bg-gray-100 text-gray-600 px-4 py-2 rounded-xl hover:bg-gray-200 transition">Skip for now</button>
        `;
        document.getElementById('wizardUseGps').onclick = () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(pos => {
                    wizardData.home = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                    wizardStep = 2; renderWizardStep();
                }, () => { wizardStep = 2; renderWizardStep(); });
            } else { wizardStep = 2; renderWizardStep(); }
        };
        document.getElementById('wizardSkipGps').onclick = () => { wizardStep = 2; renderWizardStep(); };
    } 
    else if (wizardStep === 2) {
        container.innerHTML = `
            <p class="mb-2 font-medium">What is your first recurring activity?</p>
            <input type="text" id="wizardEventName" placeholder="e.g. Gym, Library, Office" class="w-full border rounded-xl p-3 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none">
        `;
        const input = document.getElementById('wizardEventName');
        input.value = wizardData.eventName || '';
        input.oninput = (e) => { wizardData.eventName = e.target.value; };
    } 
    else if (wizardStep === 3) {
        container.innerHTML = `
            <p class="mb-2 font-medium">When is it usually open?</p>
            <div class="flex gap-2">
                <div class="w-1/2"><label class="text-xs text-gray-500 ml-1">Opens</label><input type="time" id="wizardOpen" value="${wizardData.openTime || '09:00'}" class="w-full border rounded-xl p-2"></div>
                <div class="w-1/2"><label class="text-xs text-gray-500 ml-1">Closes</label><input type="time" id="wizardClose" value="${wizardData.closeTime || '17:00'}" class="w-full border rounded-xl p-2"></div>
            </div>
        `;
        document.getElementById('wizardOpen').onchange = (e) => wizardData.openTime = e.target.value;
        document.getElementById('wizardClose').onchange = (e) => wizardData.closeTime = e.target.value;
    } 
    else if (wizardStep === 4) {
        container.innerHTML = `
            <p class="mb-2 font-medium">How many minutes do you usually stay?</p>
            <input type="number" id="wizardStay" value="${wizardData.stay || 60}" class="w-full border rounded-xl p-3 shadow-sm">
        `;
        document.getElementById('wizardStay').oninput = (e) => wizardData.stay = parseInt(e.target.value);
    } 
    else if (wizardStep === 5) {
        container.innerHTML = `
            <p class="mb-3 font-medium">Do you go home to rest between events?</p>
            <div class="space-y-2">
                <div id="choiceHome" class="p-3 border rounded-xl cursor-pointer hover:bg-blue-50 transition flex items-center gap-3 ${wizardData.restPolicy !== 'none' ? 'border-blue-600 bg-blue-50' : ''}">
                    <i class="fas fa-home text-blue-600"></i> <span>Yes, rest at home (15m)</span>
                </div>
                <div id="choiceNone" class="p-3 border rounded-xl cursor-pointer hover:bg-blue-50 transition flex items-center gap-3 ${wizardData.restPolicy === 'none' ? 'border-blue-600 bg-blue-50' : ''}">
                    <i class="fas fa-direction text-gray-600"></i> <span>No, go directly to next</span>
                </div>
            </div>
        `;
        const select = (policy) => {
            wizardData.restPolicy = policy;
            renderWizardStep();
        };
        document.getElementById('choiceHome').onclick = () => select('home');
        document.getElementById('choiceNone').onclick = () => select('none');
    }

    backBtn.classList.toggle('hidden', wizardStep === 1);
    nextBtn.classList.toggle('hidden', wizardStep === 5);
    finishBtn.classList.toggle('hidden', wizardStep !== 5);

    backBtn.onclick = () => { if (wizardStep > 1) { wizardStep--; renderWizardStep(); } };
    nextBtn.onclick = () => {
        if (wizardStep === 2 && !wizardData.eventName) return showToast('Enter an event name', 'error');
        if (wizardStep < 5) { wizardStep++; renderWizardStep(); }
    };

    finishBtn.onclick = async () => {
        const finalEvent = {
            name: wizardData.eventName || 'First Activity',
            openTime: wizardData.openTime || '09:00',
            closeTime: wizardData.closeTime || '17:00',
            minStay: wizardData.stay || 60,
            maxStay: (wizardData.stay || 60) + 60,
            startDate: formatDate(new Date()),
            startTime: wizardData.openTime || '09:00',
            endTime: fromMinutes(toMinutes(wizardData.openTime || '09:00') + (wizardData.stay || 60)),
            color: '#3b82f6',
            repeat: 'none',
            priority: 3,
            travelMins: 15
        };
        await addRecord('events', finalEvent);
        await setSetting('restPolicy', wizardData.restPolicy || 'home');
        await setSetting('wizardComplete', true);
        document.getElementById('wizardOverlay').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        document.getElementById('fab').classList.remove('hidden');
        await fullRefresh();
        showToast('Setup complete!', 'success');
    };
}

// ========== MAIN INITIALIZATION ==========
window.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    await loadData();

    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    const wizardOverlay = document.getElementById('wizardOverlay');
    const mainApp = document.getElementById('mainApp');
    const fab = document.getElementById('fab');

    const wizardComplete = await getSetting('wizardComplete');
    if (events.length === 0 && !wizardComplete) {
        wizardOverlay?.classList.remove('hidden');
        renderWizardStep();
    } else {
        wizardOverlay?.classList.add('hidden');
        mainApp?.classList.remove('hidden');
        fab?.classList.remove('hidden');
        await fullRefresh();
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
    document.getElementById('wizardExitBtn')?.addEventListener('click', async () => {
        await setSetting('wizardComplete', true);
        wizardOverlay?.classList.add('hidden');
        mainApp?.classList.remove('hidden');
        fab?.classList.remove('hidden');
        await fullRefresh();
    });
    document.getElementById('gpsUpdateBtn')?.addEventListener('click', () => {
        if (gpsWatchId) stopGPS();
        else startGPS();
    });

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

    // ========== SAVE EVENT ==========
    const saveEventBtn = document.getElementById('saveEventBtn');
    if (saveEventBtn) {
        saveEventBtn.addEventListener('click', async () => {
            const spinner = saveEventBtn.querySelector('.fa-spinner');
            saveEventBtn.disabled = true;
            if (spinner) spinner.classList.remove('hidden');
            try {
                const eventName = document.getElementById('eventName').value.trim();
                if (!eventName) {
                    showToast('Event name is required', 'error');
                    return;
                }
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
        await detectConflicts();
        await renderCalendar();
        return busy;
    }

    document.getElementById('saveBusyBtn')?.addEventListener('click', async () => {
        await saveBusyBlockFromForm();
        ModalManager.close('busyModal');
        await fullRefresh();
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

    // ========== EXPORT/IMPORT/RESET ==========
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

    // ========== NOTIFICATION PERMISSION ==========
    if (Notification.permission === "default") Notification.requestPermission();
});
