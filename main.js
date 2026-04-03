/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// main.js - Main initialization and orchestration (enhanced with event stream, fixed save, chat button)
// Must be loaded last, after all other scripts

// ========== HELPER FUNCTIONS ==========
async function fullRefresh() {
    await loadData();
    await detectConflicts();
    await renderCalendar();
    updateNotifications();
    if (typeof updateLiveJSON === 'function') updateLiveJSON();
    // Optimizer is now triggered by event stream; no manual call here
}

// ========== LOAD DATA ==========
async function loadData() {
    try {
        if (!dbReady) await initDB();
        
        events = await getAll(STORES.EVENTS).catch(e => { console.error('Failed to load events:', e); return []; });
        busyBlocks = await getAll(STORES.BUSY_BLOCKS).catch(e => { console.error('Failed to load busyBlocks:', e); return []; });
        places = await getAll(STORES.PLACES).catch(e => { console.error('Failed to load places:', e); return []; });
        
        const overridesList = await getAll(STORES.OVERRIDES).catch(e => { console.error('Failed to load overrides:', e); return []; });
        overrides.clear();
        for (let ov of overridesList) overrides.set(ov.compositeKey, ov);
        
        attendanceLog = await getAll(STORES.ATTENDANCE_LOG).catch(e => { console.error('Failed to load attendanceLog:', e); return []; });
        todos = await getAll(STORES.TODOS).catch(e => { console.error('Failed to load todos:', e); return []; });
        scheduledEvents = await getAll(STORES.SCHEDULED_EVENTS).catch(e => { console.error('Failed to load scheduledEvents:', e); return []; });
        
        const allLearning = await getAll(STORES.LEARNING_DATA).catch(e => { console.error('Failed to load learningData:', e); return []; });
        learningData = {
            eventDurations: allLearning.filter(l => l.type === 'duration'),
            travelTimes: allLearning.filter(l => l.type === 'travel'),
            preferences: allLearning.filter(l => l.type === 'preference'),
            preferredTimeSlots: {}
        };
        const preferred = allLearning.filter(l => l.type === 'preferredTime');
        for (const p of preferred) {
            if (!learningData.preferredTimeSlots[p.eventId]) learningData.preferredTimeSlots[p.eventId] = {};
            const key = `${p.hour}:${p.minute}`;
            learningData.preferredTimeSlots[p.eventId][key] = (learningData.preferredTimeSlots[p.eventId][key] || 0) + (p.weight || 1);
        }
        
        locationHistory = await getAll(STORES.LOCATION_HISTORY).catch(e => { console.error('Failed to load locationHistory:', e); return []; });
        userFeedback = await getAll(STORES.USER_FEEDBACK).catch(e => { console.error('Failed to load userFeedback:', e); return []; });

        restPolicy = (await getSetting('restPolicy')) ?? 'home';
        farMinutes = (await getSetting('farMinutes')) ?? 10;
        firstDayOfWeek = (await getSetting('firstDayOfWeek')) ?? 1;
        timeFormat = (await getSetting('timeFormat')) ?? '12h';
        darkMode = (await getSetting('darkMode')) ?? false;
        notifyDayBefore = (await getSetting('notifyDayBefore')) ?? true;
        notifyMinutesBefore = (await getSetting('notifyMinutesBefore')) ?? 60;
        notifyTravelLead = (await getSetting('notifyTravelLead')) ?? 5;

        const storedUserSettings = await getSetting('userSettings');
        if (storedUserSettings) Object.assign(userSettings, storedUserSettings);
        planningHorizonWeeks = userSettings.planningHorizonWeeks ?? 4;

        if (darkMode) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');

        if (!places.length) {
            const defaultPlace = { name: 'Home', lat: null, lon: null, radius: 30, travelToEvent: {} };
            const id = await addRecord(STORES.PLACES, defaultPlace);
            places.push({ ...defaultPlace, id });
        }
        currentPlaceId = places[0]?.id || 1;
        const placeDisplay = document.getElementById('currentPlaceDisplay');
        if (placeDisplay) placeDisplay.innerText = `📍 ${places.find(p => p.id === currentPlaceId)?.name || 'Home'}`;

        syncSettingsToUI();
        console.log('loadData completed successfully. Events:', events.length, 'BusyBlocks:', busyBlocks.length, 'Places:', places.length);
        return true;
    } catch (error) {
        console.error('loadData failed:', error);
        showToast('Failed to load data. Please refresh the page.', 'error');
        return false;
    }
}

// Helper to update currentPlaceId from currentLocation
function updateCurrentPlaceFromLocation() {
    if (!currentLocation.lat || !currentLocation.lon) return;
    let matched = null;
    for (let p of places) {
        if (p.lat && p.lon) {
            const dist = getDistance(currentLocation.lat, currentLocation.lon, p.lat, p.lon);
            if (dist <= p.radius) { matched = p; break; }
        }
    }
    if (matched && matched.id !== currentPlaceId) {
        currentPlaceId = matched.id;
        if (matched.sublocations) {
            for (let sub of matched.sublocations) {
                if (sub.lat && sub.lon) {
                    const dist = getDistance(currentLocation.lat, currentLocation.lon, sub.lat, sub.lon);
                    if (dist <= 30) {
                        currentLocation.sublocationId = sub.id || sub.name;
                        currentLocation.sublocationName = sub.name;
                        break;
                    }
                }
            }
        }
        const placeDisplay = document.getElementById('currentPlaceDisplay');
        if (placeDisplay) {
            let displayName = matched.name;
            if (currentLocation.sublocationName) displayName += ` (${currentLocation.sublocationName})`;
            placeDisplay.innerText = `📍 ${displayName}`;
        }
    }
}

// ========== SHOW MAIN APP ==========
async function showMainApp() {
    const wizardOverlay = document.getElementById('wizardOverlay');
    const mainApp = document.getElementById('mainApp');
    const fabWrapper = document.getElementById('fabWrapper');
    if (wizardOverlay) wizardOverlay.classList.add('hidden');
    if (mainApp) {
        mainApp.classList.remove('hidden');
        mainApp.style.animation = 'fadeInUp 0.4s ease';
        setTimeout(() => { mainApp.style.animation = ''; }, 500);
    }
    if (fabWrapper) fabWrapper.classList.remove('hidden');
    await fullRefresh();
    if (typeof scrollToNow === 'function') scrollToNow();
    showToast('Ready!', 'success');
    // Run initial optimizer once (event stream will handle subsequent)
    if (typeof runOptimizer === 'function') runOptimizer();
}

// ========== CONFLICT DETECTION ==========
async function detectConflicts() {
    conflicts = [];
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
        const dayEvents = getDisplayEventsForDate(dateStr);
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
    const learned = learningData.travelTimes.find(t => t.fromPlaceId === fromPlaceId && t.toPlaceId === currentPlaceId);
    if (learned && learned.minutes) return Math.round(learned.minutes);
    if (fromPlace.lat && fromPlace.lon && toPlace.lat && toPlace.lon) {
        const dist = getDistance(fromPlace.lat, fromPlace.lon, toPlace.lat, toPlace.lon);
        const speed = userSettings.travelSpeed === 'driving' ? 50 : 5;
        const minutes = dist / (speed * 1000 / 60);
        return Math.min(120, Math.max(5, Math.round(minutes)));
    }
    const custom = fromPlace.travelToEvent?.[eventId] || toPlace.travelToEvent?.[eventId];
    return custom ?? 15;
}

// ========== OPTIMIZER (uses Scheduler) ==========
async function runOptimizer() {
    if (optimizerLock) return;
    optimizerLock = true;
    try {
        if (typeof Scheduler !== 'undefined' && Scheduler.run) {
            showToast('Optimizing schedule...', 'info');
            await Scheduler.run();
            showToast('Schedule optimized!', 'success');
        } else {
            console.warn('Scheduler module not loaded');
            showToast('Optimizer not available', 'error');
        }
    } catch (err) {
        console.error('Optimizer failed:', err);
        showToast('Optimization failed: ' + err.message, 'error');
    } finally {
        optimizerLock = false;
        lastOptimizerRun = new Date();
        if (typeof fullRefresh === 'function') fullRefresh();
        else if (typeof renderCalendar === 'function') renderCalendar();
    }
}

// Undo/Redo is provided by undoRedo.js
// The global undo() and redo() functions are defined there.

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
    currentLocation.lat = lat;
    currentLocation.lon = lon;
    currentLocation.timestamp = new Date();

    let matched = null;
    for (let p of places) {
        if (p.lat && p.lon) {
            const dist = getDistance(lat, lon, p.lat, p.lon);
            if (dist <= p.radius) { matched = p; break; }
        }
    }
    if (matched && matched.id !== currentPlaceId) {
        currentPlaceId = matched.id;
        if (matched.sublocations) {
            for (let sub of matched.sublocations) {
                if (sub.lat && sub.lon) {
                    const dist = getDistance(lat, lon, sub.lat, sub.lon);
                    if (dist <= 30) {
                        currentLocation.sublocationId = sub.id || sub.name;
                        currentLocation.sublocationName = sub.name;
                        break;
                    }
                }
            }
        }
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
    if (userSettings.autoLearn) {
        await addRecord('locationHistory', {
            lat, lon, placeId: matched?.id || null, sublocationId: currentLocation.sublocationId,
            timestamp: new Date()
        });
    }
}

// ========== NUKE ANIMATION ==========
function showNukeAnimation() {
    const mainApp = document.getElementById('mainApp');
    if (!mainApp) return;
    mainApp.classList.add('nuke-flash');
    setTimeout(() => mainApp.classList.remove('nuke-flash'), 500);
}

// ========== DRAG AND DROP HANDLERS ==========
window.dragstart_handler = function(ev) {
    const block = ev.target.closest('.event-block');
    if (!block) { ev.preventDefault(); return; }
    const eventId = block.dataset.id;
    const dateStr = block.dataset.date;
    if (!eventId || !dateStr) { ev.preventDefault(); return; }
    ev.dataTransfer.setData("text/plain", JSON.stringify({
        eventId: parseInt(eventId),
        dateStr: dateStr
    }));
    ev.dataTransfer.effectAllowed = "move";
};
window.dragover_handler = function(ev) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
};
window.drop_handler = async function(ev) {
    ev.preventDefault();
    const targetCell = ev.target.closest('.day-cell');
    if (!targetCell) return;
    
    let data;
    try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } 
    catch (e) { return; }
    
    const eventId = data.eventId;
    const oldDateStr = data.dateStr;
    const targetDateStr = targetCell.dataset.date;
    
    if (!eventId || !oldDateStr || !targetDateStr || oldDateStr === targetDateStr) return;

    const originalEvent = events.find(e => e.id === eventId);
    if (!originalEvent) {
        showToast('Event not found', 'error');
        return;
    }

    // Create the new occurrence (exception) on the target date
    const overrideEvent = { ...originalEvent, startDate: targetDateStr };
    
    // 1. Skip the original occurrence (mark as nogo)
    await EventManager.applyOverride(eventId, oldDateStr, 'nogo');
    
    // 2. Create the exception on the new date
    await EventManager.applyOverride(eventId, targetDateStr, 'exception', overrideEvent);
    
    await fullRefresh();
    showToast(`Moved to ${formatDateDisplay(targetDateStr)}`, 'success');
};

// ========== MAIN INITIALIZATION ==========
window.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    await loadData();

    // Start The Instant Responder (event stream) – MUST be after initDB
    if (typeof initEventStream === 'function') {
        initEventStream();
        console.log('Event stream (Instant Responder) started');
    } else {
        console.warn('initEventStream not available – event reactivity disabled');
    }

    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    const wizardComplete = await getSetting('wizardComplete');
    if (!wizardComplete) {
        if (typeof showWizard === 'function') showWizard();
        else {
            console.warn('showWizard not available, using fallback');
            document.getElementById('wizardOverlay')?.classList.remove('hidden');
            await showMainApp();
        }
    } else {
        await showMainApp();
    }

    // ========== UI EVENT LISTENERS ==========
    document.getElementById('undoBtn')?.addEventListener('click', undo);
    document.getElementById('redoBtn')?.addEventListener('click', redo);
    document.getElementById('todayBtn')?.addEventListener('click', () => { currentDate = new Date(); renderCalendar(); });
    document.getElementById('prevBtn')?.addEventListener('click', () => {
        if (currentView === 'week') currentDate.setDate(currentDate.getDate() - 7);
        else if (currentView === 'month') currentDate.setMonth(currentDate.getMonth() - 1);
        else if (currentView === 'day') currentDate.setDate(currentDate.getDate() - 1);
        renderCalendar();
    });
    document.getElementById('nextBtn')?.addEventListener('click', () => {
        if (currentView === 'week') currentDate.setDate(currentDate.getDate() + 7);
        else if (currentView === 'month') currentDate.setMonth(currentDate.getMonth() + 1);
        else if (currentView === 'day') currentDate.setDate(currentDate.getDate() + 1);
        renderCalendar();
    });
    document.getElementById('viewToggleBtn')?.addEventListener('click', () => {
        const views = ['week', 'month', 'day'];
        let idx = views.indexOf(currentView);
        idx = (idx + 1) % views.length;
        currentView = views[idx];
        const btn = document.getElementById('viewToggleBtn');
        if (btn) {
            if (currentView === 'week') btn.innerHTML = '<i class="fas fa-calendar-week"></i> Week';
            else if (currentView === 'month') btn.innerHTML = '<i class="fas fa-calendar-alt"></i> Month';
            else if (currentView === 'day') btn.innerHTML = '<i class="fas fa-calendar-day"></i> Day';
        }
        renderCalendar();
    });
    // --- NEW FAB MENU LOGIC ---
    const fabButton = document.getElementById('fab');
    const fabMenu = document.getElementById('fabMenu');
    const fabIcon = document.getElementById('fabIcon');
    
    if (fabButton && fabMenu) {
        fabButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = !fabMenu.classList.contains('scale-0');
            if (isOpen) {
                fabMenu.classList.add('scale-0', 'opacity-0', 'pointer-events-none');
                fabIcon.style.transform = 'rotate(0deg)';
            } else {
                fabMenu.classList.remove('scale-0', 'opacity-0', 'pointer-events-none');
                fabIcon.style.transform = 'rotate(45deg)';
            }
        });
        
        // Close FAB menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!fabButton.contains(e.target) && !fabMenu.contains(e.target)) {
                fabMenu.classList.add('scale-0', 'opacity-0', 'pointer-events-none');
                fabIcon.style.transform = 'rotate(0deg)';
            }
        });

        // FAB Actions
        document.getElementById('fabAddEvent')?.addEventListener('click', () => {
            fabMenu.classList.add('scale-0', 'opacity-0', 'pointer-events-none');
            fabIcon.style.transform = 'rotate(0deg)';
            if (typeof openEventModal === 'function') openEventModal();
        });
        document.getElementById('fabAddBusy')?.addEventListener('click', () => {
            fabMenu.classList.add('scale-0', 'opacity-0', 'pointer-events-none');
            fabIcon.style.transform = 'rotate(0deg)';
            if (typeof openBusyModal === 'function') openBusyModal();
        });
        document.getElementById('fabAddTodo')?.addEventListener('click', () => {
            fabMenu.classList.add('scale-0', 'opacity-0', 'pointer-events-none');
            fabIcon.style.transform = 'rotate(0deg)';
            if (typeof openTodoModal === 'function') openTodoModal();
        });
        document.getElementById('fabViewTodos')?.addEventListener('click', () => {
            fabMenu.classList.add('scale-0', 'opacity-0', 'pointer-events-none');
            fabIcon.style.transform = 'rotate(0deg)';
            if (typeof TodoPanel !== 'undefined') TodoPanel.toggle();
        });
        document.getElementById('fabViewEvents')?.addEventListener('click', () => {
            fabMenu.classList.add('scale-0', 'opacity-0', 'pointer-events-none');
            fabIcon.style.transform = 'rotate(0deg)';
            if (typeof showEventListModal === 'function') showEventListModal();
        });
    }

    document.getElementById('gpsUpdateBtn')?.addEventListener('click', () => {
        if (gpsWatchId) stopGPS();
        else startGPS();
    });

    // Chat button wiring
    const chatBtn = document.getElementById('chatBtn');
    if (chatBtn) {
        chatBtn.addEventListener('click', () => {
            if (typeof ChatUI !== 'undefined') ChatUI.toggle();
            else showToast('Chat module not loaded', 'error');
        });
    }

    const todoPanelToggle = document.getElementById('todoPanelToggle');
    if (todoPanelToggle) todoPanelToggle.addEventListener('click', () => TodoPanel.toggle());
    const eventListBtn = document.getElementById('eventListBtn');
    if (eventListBtn) eventListBtn.addEventListener('click', showEventListModal);

    const wizardExitBtn = document.getElementById('wizardExitBtn');
    if (wizardExitBtn) {
        wizardExitBtn.addEventListener('click', async () => {
            await setSetting('wizardComplete', true);
            const wizardOverlay = document.getElementById('wizardOverlay');
            if (wizardOverlay) wizardOverlay.classList.add('hidden');
            await showMainApp();
        });
    }

    // Modal click-outside handler
    document.querySelectorAll('.modal-backdrop[data-closeable]').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (modal.id === 'eventModal') closeEventModalWithCheck();
                else ModalManager.close(modal.id);
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (ModalManager.current === 'eventModal') closeEventModalWithCheck();
            else if (ModalManager.current) ModalManager.close(ModalManager.current);
        }
    });

    // NOTE: Duplicate notification bell listener removed from here.
    // notifications.js already handles opening/closing the notification panel.

    const eventRepeatSelect = document.getElementById('eventRepeat');
    if (eventRepeatSelect) {
        eventRepeatSelect.addEventListener('change', () => {
            const val = eventRepeatSelect.value;
            document.getElementById('weeklyDaysContainer')?.classList.toggle('hidden', val !== 'weekly');
            document.getElementById('monthlyDayContainer')?.classList.toggle('hidden', val !== 'monthly');
            document.getElementById('eventRepeatEnd')?.classList.toggle('hidden', val === 'none');
        });
        eventRepeatSelect.dispatchEvent(new Event('change'));
    }

    const weeklyContainer = document.getElementById('weeklyDaysContainer');
    if (weeklyContainer && weeklyContainer.children.length === 0) {
        const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        weeklyContainer.innerHTML = days.map((d, i) => `
            <label class="inline-flex items-center gap-1">
                <input type="checkbox" value="${i}" name="event_weekly_day_${i}"> ${d}
            </label>
        `).join('');
    }

    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) {
        darkToggle.addEventListener('change', async (e) => {
            darkMode = e.target.checked;
            document.documentElement.classList.toggle('dark', darkMode);
            await setSetting('darkMode', darkMode);
            syncSettingsToUI();
        });
    }

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
            read: (modal) => Array.from(modal.querySelectorAll('#weeklyDaysContainer input:checked')).map(cb => parseInt(cb.value)),
            write: (modal, value) => {
                const checks = modal.querySelectorAll('#weeklyDaysContainer input');
                checks.forEach(cb => cb.checked = value.includes(parseInt(cb.value)));
            }
        }
    });
    busyDraftManager = new FormDraft('busyModal', 'busyDraft', {
        weeklyDays: {
            read: (modal) => Array.from(modal.querySelectorAll('#busyDaysCheckboxes input:checked')).map(cb => parseInt(cb.value)),
            write: (modal, value) => {
                const checks = modal.querySelectorAll('#busyDaysCheckboxes input');
                checks.forEach(cb => cb.checked = value.includes(parseInt(cb.value)));
            }
        }
    });
    todoDraftManager = new FormDraft('todoModal', 'todoDraft', {});

    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsX = document.getElementById('closeSettingsModal');
    const settingsDone = document.getElementById('settingsDoneBtn');
    function closeSettings() {
        if (settingsModal) settingsModal.classList.add('hidden');
        showToast('Settings saved', 'success');
    }
    if (closeSettingsX) closeSettingsX.onclick = closeSettings;
    if (settingsDone) settingsDone.onclick = closeSettings;
    if (settingsModal) settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });

    document.getElementById('settingsBtn')?.addEventListener('click', () => {
        if (settingsModal) {
            const prefTab = Array.from(document.querySelectorAll('.settings-tab')).find(t => t.dataset.tab === 'preferences');
            if (prefTab) prefTab.click();
            ModalManager.open('settingsModal');
            renderPlacesList();
            renderBusyBlocksList();
            renderTodosList();
        }
    });

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
            data: document.getElementById('settings-data'),
            places: document.getElementById('settings-places'),
            busy: document.getElementById('settings-busy'),
            todos: document.getElementById('settings-todos'),
            learning: document.getElementById('settings-learning')
        };
        Object.values(panels).forEach(panel => panel?.classList.add('hidden'));
        if (panels[tabId]) panels[tabId].classList.remove('hidden');
        currentTab = tabId;
        updateSettingsButtons();
        if (tabId === 'places') renderPlacesList();
        if (tabId === 'busy') renderBusyBlocksList();
        if (tabId === 'todos') renderTodosList();
        if (tabId === 'learning') renderLearningDataPanel();
    }
    const tabHeaders = document.querySelectorAll('.settings-tab');
    tabHeaders.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
    const tabOrder = ['preferences', 'scheduling', 'notifications', 'places', 'busy', 'todos', 'learning', 'data'];
    nextBtn?.addEventListener('click', () => {
        const idx = tabOrder.indexOf(currentTab);
        if (idx < tabOrder.length - 1) switchTab(tabOrder[idx + 1]);
    });
    switchTab('preferences');

    // ========== CLEAN SAVE EVENT LOGIC (uses EventManager) ==========
    const saveEventBtn = document.getElementById('saveEventBtn');
    if (saveEventBtn) {
        // Replace with fresh clone to avoid duplicate listeners
        const newSaveBtn = saveEventBtn.cloneNode(true);
        saveEventBtn.parentNode.replaceChild(newSaveBtn, saveEventBtn);

        newSaveBtn.addEventListener('click', async () => {
            if (!validateEventForm()) return;
            
            const spinner = newSaveBtn.querySelector('.fa-spinner');
            newSaveBtn.disabled = true;
            if (spinner) spinner.classList.remove('hidden');

            try {
                const eventData = {
                    id: editingEventId || undefined,
                    name: document.getElementById('eventName').value.trim(),
                    openTime: document.getElementById('eventOpenTime').value,
                    closeTime: document.getElementById('eventCloseTime').value,
                    minStay: parseInt(document.getElementById('eventMinStay').value) || 30,
                    maxStay: parseInt(document.getElementById('eventMaxStay').value) || 120,
                    frequency: document.getElementById('eventFrequency').value,
                    scarce: document.getElementById('eventScarce').checked,
                    remindRecency: document.getElementById('eventRemindRecency').checked,
                    repeat: document.getElementById('eventRepeat').value,
                    repeatEnd: document.getElementById('eventRepeatEnd').value,
                    notes: document.getElementById('eventNotes').value,
                    color: document.getElementById('eventColor').value,
                    startDate: editingDateStr || formatDate(new Date()),
                    priority: document.querySelectorAll('#eventPriorityStars .fa-star.selected').length || 3,
                    weeklyDays: Array.from(document.querySelectorAll('#weeklyDaysContainer input:checked')).map(cb => parseInt(cb.value)),
                    monthlyDay: parseInt(document.getElementById('monthlyDay').value) || 1,
                    placeId: document.getElementById('eventPlaceId').value ? parseInt(document.getElementById('eventPlaceId').value) : null
                };
                eventData.startTime = eventData.openTime;
                eventData.endTime = fromMinutes(toMinutes(eventData.openTime) + eventData.minStay);

                // Conflict detection
                const dayBusy = getBusyBlocksForDate(eventData.startDate);
                let hasConflict = false, conflictMsg = '', conflictBusyObj = null;
                for (const busy of dayBusy) {
                    if (toMinutes(eventData.startTime) < toMinutes(busy.endTime) && toMinutes(eventData.endTime) > toMinutes(busy.startTime)) {
                        hasConflict = true;
                        conflictMsg = `Conflicts with busy block "${busy.description}"`;
                        conflictBusyObj = busy;
                        break;
                    }
                }

                if (hasConflict) {
                    // Use the promise-based modal (returns 'reschedule', 'ignore', 'overlap', 'split', or 'cancel')
                    let userAction = 'ignore';
                    if (typeof showConflictModal === 'function') {
                        userAction = await showConflictModal({
                            message: conflictMsg,
                            busyObj: conflictBusyObj,
                            eventObj: eventData
                        });
                    } else {
                        const result = confirm(conflictMsg + '\n\nSave anyway?');
                        userAction = result ? 'ignore' : 'cancel';
                    }

                    if (userAction === 'cancel') {
                        throw new Error("Conflict check aborted save");
                    }

                    // Save the event first (so it exists for overrides)
                    let savedEventId;
                    if (editingEventId && editingDateStr) {
                        await EventManager.applyOverride(editingEventId, editingDateStr, 'exception', eventData);
                        savedEventId = editingEventId;
                    } else if (editingEventId) {
                        await EventManager.updateEvent(editingEventId, eventData);
                        savedEventId = editingEventId;
                    } else {
                        savedEventId = await EventManager.addEvent(eventData);
                    }

                    // Handle specific resolutions after saving
                    if (userAction === 'overlap') {
                        // Lock the event so optimizer doesn't auto-move it
                        await EventManager.applyOverride(savedEventId, eventData.startDate, 'locked');
                        showToast('Event forced to overlap', 'warning');
                    } else if (userAction === 'split' && conflictBusyObj) {
                        // Carve a hole in the busy block (using splitBusyBlock)
                        if (typeof BusyManager !== 'undefined' && BusyManager.splitBusyBlock) {
                            await BusyManager.splitBusyBlock(
                                conflictBusyObj.id,
                                eventData.startDate,
                                eventData.startTime,
                                true
                            );
                            showToast('Busy block split to fit event', 'success');
                        } else {
                            showToast('Split not available', 'error');
                        }
                    } else if (userAction === 'reschedule') {
                        showToast('Event saved. Optimizer will reschedule it.', 'info');
                    }
                } else {
                    // Normal save (No Conflict)
                    if (editingEventId && editingDateStr) {
                        await EventManager.applyOverride(editingEventId, editingDateStr, 'exception', eventData);
                    } else if (editingEventId) {
                        await EventManager.updateEvent(editingEventId, eventData);
                    } else {
                        await EventManager.addEvent(eventData);
                    }
                }

                if (eventDraftManager) await eventDraftManager.clearDraft();
                ModalManager.close('eventModal');
                await fullRefresh();
            } catch (err) {
                if (err.message !== "Conflict check aborted save") {
                    console.error(err);
                    showToast(err.message, 'error');
                }
            } finally {
                newSaveBtn.disabled = false;
                if (spinner) spinner.classList.add('hidden');
            }
        });
    }

    // Save todo
    const saveTodoBtn = document.getElementById('saveTodoBtn');
    if (saveTodoBtn) {
        const newTodoBtn = saveTodoBtn.cloneNode(true);
        saveTodoBtn.parentNode.replaceChild(newTodoBtn, saveTodoBtn);
        newTodoBtn.addEventListener('click', async () => { await saveTodoModal(); });
    }

    // Save busy
      async function saveBusyBlockFromForm() {
        const startDate = document.getElementById('busyRangeStart').value;
        const endDate = document.getElementById('busyRangeEnd').value;
        const daysOfWeek = Array.from(document.querySelectorAll('#busyDaysCheckboxes input:checked')).map(cb => parseInt(cb.value));
        
        // Determine Recurrence Type implicitly for backward compatibility with busyManager.js
        let recurrenceType = 'once';
        if (endDate) recurrenceType = 'daterange';
        if (daysOfWeek.length > 0) recurrenceType = 'weekly';

        const busy = {
            description: document.getElementById('busyDescription').value || 'Busy',
            hard: document.getElementById('busyHard').checked,
            recurrence: recurrenceType,
            date: startDate, // For 'once' backwards compatibility
            startDate: startDate,
            endDate: endDate || startDate,
            daysOfWeek: daysOfWeek,
            startTime: document.getElementById('busyStartTime').value || '00:00',
            endTime: document.getElementById('busyEndTime').value || '23:59',
            allDay: document.getElementById('busyAllDay').checked,
            tag: document.getElementById('busyTag').value
        };

        // Check if we are editing an existing busy block
        if (window.editingBusyId && window.editingBusyId !== null) {
            // Update existing record
            busy.id = window.editingBusyId;
            await putRecord('busyBlocks', busy);
            showToast('Busy block updated', 'success');
            window.editingBusyId = null; // Reset after update
        } else {
            // Create new record
            await addRecord('busyBlocks', busy);
            showToast('Busy block added', 'success');
        }

        if (busyDraftManager) await busyDraftManager.clearDraft();
        await fullRefresh();
        return busy;
    }
    const saveBusyBtn = document.getElementById('saveBusyBtn');
    if (saveBusyBtn) {
        const newBusyBtn = saveBusyBtn.cloneNode(true);
        saveBusyBtn.parentNode.replaceChild(newBusyBtn, saveBusyBtn);
        newBusyBtn.addEventListener('click', async () => {
            await saveBusyBlockFromForm();
            ModalManager.close('busyModal');
        });
    }
    const saveAddAnotherBtn = document.getElementById('saveAddAnotherBusyBtn');
    if (saveAddAnotherBtn) {
        const newAddAnother = saveAddAnotherBtn.cloneNode(true);
        saveAddAnotherBtn.parentNode.replaceChild(newAddAnother, saveAddAnotherBtn);
        newAddAnother.addEventListener('click', async () => {
            await saveBusyBlockFromForm();
            document.getElementById('busyDescription').value = '';
            document.getElementById('busyDate').value = '';
            document.getElementById('busyStartTime').value = '09:00';
            document.getElementById('busyEndTime').value = '17:00';
            document.querySelectorAll('#busyDaysCheckboxes input').forEach(cb => cb.checked = false);
            document.getElementById('busyDescription').focus();
            showToast('Saved — add another', 'success');
        });
    }

    document.getElementById('busyRecurrence')?.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('busyDateSingle').classList.toggle('hidden', val !== 'once');
        document.getElementById('busyDateRange').classList.toggle('hidden', val !== 'daterange');
        document.getElementById('busyWeeklyDays').classList.toggle('hidden', val !== 'weekly');
    });
    document.getElementById('busyRecurrence')?.dispatchEvent(new Event('change'));

    // Modal close/cancel
    const cancelEventBtn = document.getElementById('cancelEventBtn');
    const closeEventModalBtn = document.getElementById('closeEventModal');
    if (cancelEventBtn) cancelEventBtn.addEventListener('click', (e) => { e.preventDefault(); closeEventModalWithCheck(); });
    if (closeEventModalBtn) closeEventModalBtn.addEventListener('click', (e) => { e.preventDefault(); closeEventModalWithCheck(); });

    const closeBusyModalBtn = document.getElementById('closeBusyModal');
    const cancelBusyBtn = document.getElementById('cancelBusyBtn');
    if (closeBusyModalBtn) closeBusyModalBtn.addEventListener('click', (e) => { e.preventDefault(); ModalManager.close('busyModal'); });
    if (cancelBusyBtn) cancelBusyBtn.addEventListener('click', (e) => { e.preventDefault(); ModalManager.close('busyModal'); });

    const clearDraftBtn = document.getElementById('clearDraftBtn');
    if (clearDraftBtn) clearDraftBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (eventDraftManager) await eventDraftManager.clearDraft();
        document.getElementById('draftBanner')?.classList.add('hidden');
        showToast('Draft cleared', 'success');
    });

    // Settings listeners
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

    const planningHorizonSelect = document.getElementById('planningHorizonWeeks');
    if (planningHorizonSelect) planningHorizonSelect.addEventListener('change', async (e) => {
        planningHorizonWeeks = parseInt(e.target.value);
        userSettings.planningHorizonWeeks = planningHorizonWeeks;
        await setSetting('userSettings', userSettings);
    });
    const travelSpeedSelect = document.getElementById('travelSpeed');
    if (travelSpeedSelect) travelSpeedSelect.addEventListener('change', async (e) => {
        userSettings.travelSpeed = e.target.value;
        await setSetting('userSettings', userSettings);
    });
    const notificationSoundSelect = document.getElementById('notificationSound');
    if (notificationSoundSelect) notificationSoundSelect.addEventListener('change', async (e) => {
        userSettings.notificationSound = e.target.value;
        await setSetting('userSettings', userSettings);
    });
    const quietStartInput = document.getElementById('quietHoursStart');
    if (quietStartInput) quietStartInput.addEventListener('change', async (e) => {
        userSettings.quietHoursStart = parseInt(e.target.value);
        await setSetting('userSettings', userSettings);
    });
    const quietEndInput = document.getElementById('quietHoursEnd');
    if (quietEndInput) quietEndInput.addEventListener('change', async (e) => {
        userSettings.quietHoursEnd = parseInt(e.target.value);
        await setSetting('userSettings', userSettings);
    });
    const showTodosCheck = document.getElementById('showTodosInCalendar');
    if (showTodosCheck) showTodosCheck.addEventListener('change', async (e) => {
        userSettings.showTodosInCalendar = e.target.checked;
        await setSetting('userSettings', userSettings);
        renderCalendar();
    });
    const autoLearnCheck = document.getElementById('autoLearn');
    if (autoLearnCheck) autoLearnCheck.addEventListener('change', async (e) => {
        userSettings.autoLearn = e.target.checked;
        await setSetting('userSettings', userSettings);
    });
    const adaptBehaviorCheck = document.getElementById('adaptToUserBehavior');
    if (adaptBehaviorCheck) adaptBehaviorCheck.addEventListener('change', async (e) => {
        userSettings.adaptToUserBehavior = e.target.checked;
        await setSetting('userSettings', userSettings);
    });

    const toggleAdvancedBtn = document.getElementById('toggleAdvancedBtn');
    if (toggleAdvancedBtn) toggleAdvancedBtn.addEventListener('click', () => {
        document.getElementById('advancedOptions')?.classList.toggle('hidden');
    });

    document.getElementById('exportDataBtn')?.addEventListener('click', async () => {
        const data = {
            events, busyBlocks, places, overrides: Array.from(overrides.values()),
            todos, scheduledEvents, learningData, locationHistory, userFeedback,
            settings: {
                restPolicy, farMinutes, firstDayOfWeek, timeFormat, darkMode,
                notifyDayBefore, notifyMinutesBefore, notifyTravelLead,
                planningHorizonWeeks, userSettings
            }
        };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const a = document.createElement('a');
        const date = new Date().toISOString().split('T')[0];
        a.href = URL.createObjectURL(blob);
        a.download = `scheduler_full_backup_${date}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
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
                if (confirm(`File contains ${data.events.length} events, ${data.busyBlocks?.length || 0} busy blocks, ${data.todos?.length || 0} to‑dos. Import will replace all current data. Continue?`)) {
                    showNukeAnimation();
                    await clearAllStores();
                    for (let ev of data.events) await addRecord('events', ev);
                    for (let bb of data.busyBlocks || []) await addRecord('busyBlocks', bb);
                    for (let pl of data.places || []) await addRecord('places', pl);
                    for (let ov of data.overrides || []) await putRecord('overrides', ov);
                    for (let td of data.todos || []) await addRecord('todos', td);
                    for (let se of data.scheduledEvents || []) await addRecord('scheduledEvents', se);
                    for (let ld of data.learningData?.eventDurations || []) await addRecord('learningData', ld);
                    for (let lt of data.learningData?.travelTimes || []) await addRecord('learningData', lt);
                    for (let lp of data.learningData?.preferences || []) await addRecord('learningData', lp);
                    for (let lh of data.locationHistory || []) await addRecord('locationHistory', lh);
                    for (let uf of data.userFeedback || []) await addRecord('userFeedback', uf);
                    if (data.settings) {
                        await setSetting('restPolicy', data.settings.restPolicy);
                        await setSetting('farMinutes', data.settings.farMinutes);
                        await setSetting('firstDayOfWeek', data.settings.firstDayOfWeek);
                        await setSetting('timeFormat', data.settings.timeFormat);
                        await setSetting('darkMode', data.settings.darkMode);
                        await setSetting('notifyDayBefore', data.settings.notifyDayBefore);
                        await setSetting('notifyMinutesBefore', data.settings.notifyMinutesBefore);
                        await setSetting('notifyTravelLead', data.settings.notifyTravelLead);
                        await setSetting('planningHorizonWeeks', data.settings.planningHorizonWeeks);
                        if (data.settings.userSettings) await setSetting('userSettings', data.settings.userSettings);
                    }
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
            showNukeAnimation();
            await clearAllStores();
            localStorage.clear();
            location.reload();
        } else {
            document.getElementById('exportDataBtn').click();
        }
    });

    let touchStartX = 0, touchEndX = 0;
    const calendarContainer = document.getElementById('calendarContainer');
    if (calendarContainer) {
        calendarContainer.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; });
        calendarContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            if (touchEndX < touchStartX - 50) {
                if (currentView === 'week') currentDate.setDate(currentDate.getDate() + 7);
                else if (currentView === 'month') currentDate.setMonth(currentDate.getMonth() + 1);
                else if (currentView === 'day') currentDate.setDate(currentDate.getDate() + 1);
                renderCalendar();
            } else if (touchEndX > touchStartX + 50) {
                if (currentView === 'week') currentDate.setDate(currentDate.getDate() - 7);
                else if (currentView === 'month') currentDate.setMonth(currentDate.getMonth() - 1);
                else if (currentView === 'day') currentDate.setDate(currentDate.getDate() - 1);
                renderCalendar();
            }
        });
    }

    const wizardCompleteFlag = await getSetting('wizardComplete');
    if (wizardCompleteFlag && Notification.permission === "default") {
        setTimeout(() => Notification.requestPermission(), 3000);
    }
});