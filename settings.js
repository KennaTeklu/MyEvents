/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// settings.js - Settings panel, places, busy blocks, todos, learning data management
// Must be loaded after state.js, utils.js, db.js

// ========== LIVE JSON VISUALIZER ==========
let liveJSONUpdatePending = false;

async function updateLiveJSON() {
    if (liveJSONUpdatePending) return;
    liveJSONUpdatePending = true;
    
    // Use setTimeout instead of requestAnimationFrame to ensure DOM is ready
    setTimeout(async () => {
        try {
            const container = document.getElementById('jsonVisualizerContainer');
            if (!container) {
                liveJSONUpdatePending = false;
                return;
            }
            
            // Build a complete state representation
            const stateForExport = {
                events: events || [],
                busyBlocks: busyBlocks || [],
                places: places || [],
                overrides: Array.from(overrides?.values() || []),
                todos: todos || [],
                scheduledEvents: scheduledEvents || [],
                learningData: {
                    eventDurations: learningData?.eventDurations || [],
                    travelTimes: learningData?.travelTimes || [],
                    preferences: learningData?.preferences || []
                }
            };
            
            const jsonStr = JSON.stringify(stateForExport, null, 2);
            const pre = document.getElementById('jsonVisualizerPre');
            if (pre) {
                pre.textContent = jsonStr;
            } else {
                // Fallback: try to find pre inside container
                const preInside = container.querySelector('pre');
                if (preInside) preInside.textContent = jsonStr;
            }
        } catch (err) {
            console.error('Failed to update live JSON:', err);
            const pre = document.getElementById('jsonVisualizerPre');
            if (pre) pre.textContent = 'Error: ' + err.message;
        } finally {
            liveJSONUpdatePending = false;
        }
    }, 10);
}

function refreshLiveJSON() {
    liveJSONUpdatePending = false; // reset flag to force update
    updateLiveJSON();
}

async function copyLiveJSON() {
    const container = document.getElementById('liveJSONContainer');
    if (!container) return;
    const pre = container.querySelector('pre');
    if (!pre || !pre.textContent) return;
    try {
        await navigator.clipboard.writeText(pre.textContent);
        showToast('JSON copied to clipboard', 'success');
    } catch (err) {
        console.error('Copy failed:', err);
        showToast('Failed to copy', 'error');
    }
}

// ========== SYNC UI WITH GLOBAL SETTINGS ==========
function syncSettingsToUI() {
    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) darkToggle.checked = darkMode;

    const firstDaySelect = document.getElementById('firstDayOfWeek');
    if (firstDaySelect) firstDaySelect.value = firstDayOfWeek;

    const timeFormatSelect = document.getElementById('timeFormat');
    if (timeFormatSelect) timeFormatSelect.value = timeFormat;

    const restSelect = document.getElementById('restPolicySelect');
    if (restSelect) restSelect.value = restPolicy;

    const farMinutesInput = document.getElementById('farMinutes');
    if (farMinutesInput) farMinutesInput.value = farMinutes;

    const farDiv = document.getElementById('farMinutesDiv');
    if (farDiv) farDiv.classList.toggle('hidden', restPolicy !== 'far');

    const notifyDayCheck = document.getElementById('notifyDayBefore');
    if (notifyDayCheck) notifyDayCheck.checked = notifyDayBefore;

    const notifyMinutesInput = document.getElementById('notifyMinutesBefore');
    if (notifyMinutesInput) notifyMinutesInput.value = notifyMinutesBefore;

    const notifyTravelInput = document.getElementById('notifyTravelLead');
    if (notifyTravelInput) notifyTravelInput.value = notifyTravelLead;

    // New settings
    const horizonSelect = document.getElementById('planningHorizonWeeks');
    if (horizonSelect) horizonSelect.value = planningHorizonWeeks;

    const travelSpeedSelect = document.getElementById('travelSpeed');
    if (travelSpeedSelect) travelSpeedSelect.value = userSettings.travelSpeed || 'walking';

    const soundSelect = document.getElementById('notificationSound');
    if (soundSelect) soundSelect.value = userSettings.notificationSound || 'default';

    const quietStart = document.getElementById('quietHoursStart');
    if (quietStart) quietStart.value = userSettings.quietHoursStart ?? 22;

    const quietEnd = document.getElementById('quietHoursEnd');
    if (quietEnd) quietEnd.value = userSettings.quietHoursEnd ?? 7;

    const showTodosCheck = document.getElementById('showTodosInCalendar');
    if (showTodosCheck) showTodosCheck.checked = userSettings.showTodosInCalendar ?? false;

    const autoLearnCheck = document.getElementById('autoLearn');
    if (autoLearnCheck) autoLearnCheck.checked = userSettings.autoLearn ?? true;

    const adaptBehaviorCheck = document.getElementById('adaptToUserBehavior');
    if (adaptBehaviorCheck) adaptBehaviorCheck.checked = userSettings.adaptToUserBehavior ?? true;
}

// ========== SETTINGS TABS ==========
function setupSettingsTabs() {
    const tabs = document.querySelectorAll('.settings-tab');
    const panels = document.querySelectorAll('.settings-panel');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('border-blue-600', 'text-blue-600'));
            tab.classList.add('border-blue-600', 'text-blue-600');
            panels.forEach(panel => panel.classList.add('hidden'));
            const targetPanel = document.getElementById(`settings-${target}`);
            if (targetPanel) targetPanel.classList.remove('hidden');
            
            if (target === 'data') refreshLiveJSON();
            if (target === 'places') renderPlacesList();
            if (target === 'busyBlocks') renderBusyBlocksList();
            if (target === 'todos') renderTodosList();
            if (target === 'learning') renderLearningDataPanel();
        });
    });
    
    const copyBtn = document.getElementById('copyLiveJSONBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyLiveJSON);
    
    const refreshBtn = document.getElementById('refreshLiveJSONBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshLiveJSON);
}

// ========== PLACES MANAGEMENT (with sublocations) ==========
async function renderPlacesList() {
    const container = document.getElementById('placesListContainer');
    if (!container) return;
    try {
        const allPlaces = await getAll('places');
        if (!allPlaces.length) {
            container.innerHTML = '<div class="text-sm text-gray-400">No places saved yet. Use GPS to detect your location.</div>';
            return;
        }
        container.innerHTML = allPlaces.map(p => `
            <div class="place-row" data-id="${p.id}">
                <div>
                    <span class="font-medium">${escapeHtml(p.name)}</span>
                    <span class="text-xs text-gray-400 ml-2">${p.lat ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : 'No GPS'}</span>
                    <span class="text-xs text-gray-400 ml-2">Radius: ${p.radius}m</span>
                    ${p.sublocations ? `<span class="text-xs text-gray-400 ml-2">📍 ${p.sublocations.length} sub‑locations</span>` : ''}
                </div>
                <div class="flex gap-2">
                    <button class="text-xs text-blue-600 hover:underline" data-id="${p.id}" data-action="rename">Rename</button>
                    <button class="text-xs text-green-600 hover:underline" data-id="${p.id}" data-action="sublocations">Sublocations</button>
                    <button class="text-xs text-red-500 hover:underline" data-id="${p.id}" data-action="delete">Delete</button>
                </div>
            </div>
        `).join('');
        container.querySelectorAll('[data-action="rename"]').forEach(btn => btn.onclick = () => renamePlace(parseInt(btn.dataset.id)));
        container.querySelectorAll('[data-action="delete"]').forEach(btn => btn.onclick = () => deletePlace(parseInt(btn.dataset.id)));
        container.querySelectorAll('[data-action="sublocations"]').forEach(btn => btn.onclick = () => manageSublocations(parseInt(btn.dataset.id)));
    } catch (error) {
        console.error('Failed to render places list:', error);
        container.innerHTML = '<div class="text-sm text-red-500">Failed to load places.</div>';
    }
}

async function renamePlace(id) {
    try {
        const allPlaces = await getAll('places');
        const place = allPlaces.find(p => p.id === id);
        if (!place) return;
        const newName = prompt('Rename place:', place.name);
        if (newName && newName.trim()) {
            place.name = newName.trim();
            await putRecord('places', place);
            await renderPlacesList();
            showToast('Place renamed', 'success');
        }
    } catch (error) {
        console.error('Failed to rename place:', error);
        showToast('Failed to rename place', 'error');
    }
}

async function deletePlace(id) {
    if (!confirm('Delete this place?')) return;
    try {
        await deleteRecord('places', id);
        await renderPlacesList();
        showToast('Place deleted');
    } catch (error) {
        console.error('Failed to delete place:', error);
        showToast('Failed to delete place', 'error');
    }
}

async function manageSublocations(placeId) {
    const allPlaces = await getAll('places');
    const place = allPlaces.find(p => p.id === placeId);
    if (!place) return;
    const sublocations = place.sublocations || [];
    let msg = 'Current sublocations:\n';
    sublocations.forEach((sl, idx) => { msg += `${idx+1}. ${sl.name} (${sl.lat?.toFixed(4) || 'no GPS'}, ${sl.lon?.toFixed(4) || 'no GPS'})\n`; });
    msg += '\nOptions:\n1. Add new sublocation\n2. Remove a sublocation';
    const choice = prompt(msg, '1');
    if (choice === '1') {
        const name = prompt('Enter sublocation name (e.g., "Cafeteria"):');
        if (name && name.trim()) {
            // Use current location if available, else ask
            let lat = null, lon = null;
            if (currentLocation.lat && currentLocation.lon) {
                if (confirm(`Use current location (${currentLocation.lat.toFixed(4)}, ${currentLocation.lon.toFixed(4)})?`)) {
                    lat = currentLocation.lat;
                    lon = currentLocation.lon;
                }
            }
            if (lat === null) {
                const coords = prompt('Enter coordinates (lat,lon) or leave empty to skip GPS:');
                if (coords) {
                    const parts = coords.split(',').map(Number);
                    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                        lat = parts[0];
                        lon = parts[1];
                    }
                }
            }
            place.sublocations = place.sublocations || [];
            place.sublocations.push({ name: name.trim(), lat, lon });
            await putRecord('places', place);
            showToast(`Sublocation "${name}" added`, 'success');
            await renderPlacesList();
        }
    } else if (choice === '2') {
        const idx = prompt('Enter number of sublocation to remove:', '1');
        const num = parseInt(idx);
        if (!isNaN(num) && num >= 1 && num <= sublocations.length) {
            place.sublocations.splice(num-1, 1);
            await putRecord('places', place);
            showToast('Sublocation removed', 'success');
            await renderPlacesList();
        } else {
            showToast('Invalid number', 'error');
        }
    }
}

// ========== BUSY BLOCKS MANAGEMENT ==========
async function renderBusyBlocksList() {
    const container = document.getElementById('busyBlocksListContainer');
    if (!container) return;
    try {
        const all = await getAll('busyBlocks');
        if (!all.length) {
            container.innerHTML = '<div class="text-sm text-gray-400">No busy blocks saved yet.</div>';
            return;
        }
        container.innerHTML = all.map(b => {
            const recurrenceLabel = b.recurrence === 'once' ? `on ${b.date}` :
                b.recurrence === 'weekly' ? `weekly (${(b.daysOfWeek||[]).map(d=>['Su','Mo','Tu','We','Th','Fr','Sa'][d]).join(', ')})` :
                b.recurrence === 'daterange' ? `${b.startDate} – ${b.endDate}` : '';
            return `
                <div class="place-row" data-id="${b.id}">
                    <div>
                        <span class="font-medium">${escapeHtml(b.description || 'Busy block')}</span>
                        ${b.hard ? '<span class="text-xs bg-red-100 text-red-600 px-1 rounded ml-1">Hard</span>' : ''}
                        <span class="text-xs text-gray-400 ml-2">${recurrenceLabel}</span>
                        <span class="text-xs text-gray-400 ml-2">${b.startTime}–${b.endTime}</span>
                    </div>
                    <div class="flex gap-2">
                        <button class="text-xs text-blue-600 hover:underline" data-id="${b.id}" data-action="edit">Edit</button>
                        <button class="text-xs text-red-500 hover:underline" data-id="${b.id}" data-action="delete">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
        container.querySelectorAll('[data-action="edit"]').forEach(btn => btn.onclick = () => editBusyBlock(parseInt(btn.dataset.id)));
        container.querySelectorAll('[data-action="delete"]').forEach(btn => btn.onclick = () => deleteBusyBlock(parseInt(btn.dataset.id)));
    } catch (error) {
        console.error('Failed to render busy blocks list:', error);
        container.innerHTML = '<div class="text-sm text-red-500">Failed to load busy blocks.</div>';
    }
}

async function editBusyBlock(id) {
    try {
        const all = await getAll('busyBlocks');
        const block = all.find(b => b.id === id);
        if (block) {
            ModalManager.close('settingsModal');
            openBusyModal(block);
        }
    } catch (error) {
        console.error('Failed to edit busy block:', error);
        showToast('Failed to edit busy block', 'error');
    }
}

async function deleteBusyBlock(id) {
    if (!confirm('Delete this busy block?')) return;
    try {
        await deleteRecord('busyBlocks', id);
        await fullRefresh();
        await renderBusyBlocksList();
        showToast('Busy block deleted');
    } catch (error) {
        console.error('Failed to delete busy block:', error);
        showToast('Failed to delete busy block', 'error');
    }
}

// ========== TODOS MANAGEMENT ==========
async function renderTodosList() {
    const container = document.getElementById('todosListContainer');
    if (!container) return;
    try {
        const allTodos = await getAll('todos');
        if (!allTodos.length) {
            container.innerHTML = '<div class="text-sm text-gray-400">No to‑dos yet. Add one from the to‑do panel.</div>';
            return;
        }
        container.innerHTML = allTodos.map(t => `
            <div class="place-row" data-id="${t.id}">
                <div>
                    <span class="font-medium ${t.completed ? 'line-through text-gray-400' : ''}">${escapeHtml(t.name)}</span>
                    ${t.priority ? `<span class="text-xs ml-2 bg-yellow-100 text-yellow-800 px-1 rounded">Prio ${t.priority}</span>` : ''}
                    <span class="text-xs text-gray-400 ml-2">Due: ${t.dueDate ? formatDateDisplay(t.dueDate) : 'No due'}</span>
                </div>
                <div class="flex gap-2">
                    ${!t.completed ? `<button class="text-xs text-green-600 hover:underline" data-id="${t.id}" data-action="complete">Complete</button>` : ''}
                    <button class="text-xs text-blue-600 hover:underline" data-id="${t.id}" data-action="edit">Edit</button>
                    <button class="text-xs text-red-500 hover:underline" data-id="${t.id}" data-action="delete">Delete</button>
                </div>
            </div>
        `).join('');
        container.querySelectorAll('[data-action="complete"]').forEach(btn => btn.onclick = () => completeTodo(parseInt(btn.dataset.id)));
        container.querySelectorAll('[data-action="edit"]').forEach(btn => btn.onclick = () => editTodo(parseInt(btn.dataset.id)));
        container.querySelectorAll('[data-action="delete"]').forEach(btn => btn.onclick = () => deleteTodo(parseInt(btn.dataset.id)));
    } catch (error) {
        console.error('Failed to render todos list:', error);
        container.innerHTML = '<div class="text-sm text-red-500">Failed to load to‑dos.</div>';
    }
}

async function completeTodo(id) {
    try {
        const all = await getAll('todos');
        const todo = all.find(t => t.id === id);
        if (todo && !todo.completed) {
            todo.completed = true;
            todo.completedAt = new Date().toISOString();
            await putRecord('todos', todo);
            await renderTodosList();
            showToast('To‑do completed!', 'success');
        }
    } catch (error) {
        console.error('Failed to complete todo:', error);
        showToast('Failed to complete to‑do', 'error');
    }
}

async function editTodo(id) {
    try {
        const all = await getAll('todos');
        const todo = all.find(t => t.id === id);
        if (todo) {
            ModalManager.close('settingsModal');
            openTodoModal(todo);
        }
    } catch (error) {
        console.error('Failed to edit todo:', error);
        showToast('Failed to edit to‑do', 'error');
    }
}

async function deleteTodo(id) {
    if (!confirm('Delete this to‑do?')) return;
    try {
        await deleteRecord('todos', id);
        await renderTodosList();
        showToast('To‑do deleted');
    } catch (error) {
        console.error('Failed to delete todo:', error);
        showToast('Failed to delete to‑do', 'error');
    }
}

// ========== LEARNING DATA PANEL ==========
async function renderLearningDataPanel() {
    const container = document.getElementById('learningDataContainer');
    if (!container) return;
    try {
        const allLearning = await getAll('learningData');
        const eventDurations = allLearning.filter(l => l.type === 'duration');
        const travelTimes = allLearning.filter(l => l.type === 'travel');
        const preferences = allLearning.filter(l => l.type === 'preference');
        
        container.innerHTML = `
            <div class="space-y-3">
                <div>
                    <h4 class="font-semibold">Event Durations (${eventDurations.length})</h4>
                    <div class="text-xs text-gray-500 max-h-40 overflow-y-auto">
                        ${eventDurations.slice(-5).map(d => `<div>${formatDateDisplay(d.date)}: ${d.eventId} – ${d.duration} min</div>`).join('') || 'No data yet'}
                    </div>
                </div>
                <div>
                    <h4 class="font-semibold">Travel Times (${travelTimes.length})</h4>
                    <div class="text-xs text-gray-500 max-h-40 overflow-y-auto">
                        ${travelTimes.slice(-5).map(t => `<div>${t.fromPlaceId} → ${t.toPlaceId}: ${t.minutes} min</div>`).join('') || 'No data yet'}
                    </div>
                </div>
                <div>
                    <h4 class="font-semibold">User Feedback (${preferences.length})</h4>
                    <div class="text-xs text-gray-500 max-h-40 overflow-y-auto">
                        ${preferences.slice(-5).map(p => `<div>${p.eventId}: ${p.type} – ${p.comment || ''}</div>`).join('') || 'No data yet'}
                    </div>
                </div>
                <button id="clearLearningDataBtn" class="text-sm text-red-500 hover:underline">Clear all learning data</button>
            </div>
        `;
        document.getElementById('clearLearningDataBtn')?.addEventListener('click', async () => {
            if (confirm('Delete all learning data? This cannot be undone.')) {
                await clearStore('learningData');
                await renderLearningDataPanel();
                showToast('Learning data cleared', 'success');
            }
        });
    } catch (error) {
        console.error('Failed to render learning data:', error);
        container.innerHTML = '<div class="text-sm text-red-500">Failed to load learning data.</div>';
    }
}

// ========== EXPORT/IMPORT ==========
async function exportAllData() {
    const data = {
        events, busyBlocks, places, overrides: Array.from(overrides.values()),
        todos, scheduledEvents, learningData, locationHistory, userFeedback,
        settings: {
            restPolicy, farMinutes, firstDayOfWeek, timeFormat, darkMode,
            notifyDayBefore, notifyMinutesBefore, notifyTravelLead,
            planningHorizonWeeks, userSettings
        }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scheduler_full_backup_${formatDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

async function importAllData(file) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        // Validate basic structure
        if (!data.events) throw new Error('Invalid backup file');
        // Clear all stores (use clearAllStores from db.js)
        await clearAllStores();
        // Restore each store
        for (let ev of data.events) await addRecord('events', ev);
        for (let bb of data.busyBlocks || []) await addRecord('busyBlocks', bb);
        for (let pl of data.places || []) await addRecord('places', pl);
        for (let ov of data.overrides || []) await putRecord('overrides', ov);
        for (let td of data.todos || []) await addRecord('todos', td);
        for (let se of data.scheduledEvents || []) await addRecord('scheduledEvents', se);
        for (let ld of data.learningData || []) await addRecord('learningData', ld);
        for (let lh of data.locationHistory || []) await addRecord('locationHistory', lh);
        for (let uf of data.userFeedback || []) await addRecord('userFeedback', uf);
        // Restore settings (if present)
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
            // userSettings is an object, store each key individually or as one setting? For simplicity, store as JSON string.
            if (data.settings.userSettings) {
                await setSetting('userSettings', data.settings.userSettings);
            }
        }
        await fullRefresh();
        showToast('Import successful', 'success');
    } catch (err) {
        console.error('Import failed:', err);
        showToast('Import failed: ' + err.message, 'error');
    }
}

// ========== REDO SETUP BUTTON HANDLER ==========
async function resetAndShowWizard() {
    ModalManager.close('settingsModal');
    wizardStep = 1;
    if (typeof wizardDraftManager !== 'undefined' && wizardDraftManager && typeof wizardDraftManager.clearDraft === 'function') {
        await wizardDraftManager.clearDraft();
    }
    await setSetting('wizardComplete', false);
    if (typeof showWizard === 'function') showWizard();
    else { console.error('showWizard function not found'); showToast('Could not restart setup. Please refresh the page.', 'error'); }
}

// ========== INITIALIZE SETTINGS UI AFTER DOM READY ==========
document.addEventListener('DOMContentLoaded', () => {
    const redoBtn = document.getElementById('redoWizardBtn');
    if (redoBtn) redoBtn.addEventListener('click', resetAndShowWizard);

    // Export/Import buttons
    const exportBtn = document.getElementById('exportDataBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportAllData);
    const importBtn = document.getElementById('importDataBtn');
    if (importBtn) {
        importBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) await importAllData(file);
            };
            input.click();
        });
    }
    const resetBtn = document.getElementById('resetAllDataBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            if (confirm('Delete ALL data? This cannot be undone. Click OK to reset.')) {
                await clearAllStores();
                localStorage.clear();
                location.reload();
            }
        });
    }

    // New settings listeners
    const horizonSelect = document.getElementById('planningHorizonWeeks');
    if (horizonSelect) horizonSelect.addEventListener('change', async (e) => {
        planningHorizonWeeks = parseInt(e.target.value) || 4;
        await setSetting('planningHorizonWeeks', planningHorizonWeeks);
        userSettings.planningHorizonWeeks = planningHorizonWeeks;
        await setSetting('userSettings', userSettings);
        if (typeof runOptimizer === 'function') runOptimizer();
    });

    const quietStart = document.getElementById('quietHoursStart');
    if (quietStart) quietStart.addEventListener('change', async (e) => {
        userSettings.quietHoursStart = parseInt(e.target.value) || 22;
        await setSetting('userSettings', userSettings);
    });

    const quietEnd = document.getElementById('quietHoursEnd');
    if (quietEnd) quietEnd.addEventListener('change', async (e) => {
        userSettings.quietHoursEnd = parseInt(e.target.value) || 7;
        await setSetting('userSettings', userSettings);
    });
    const travelSpeedSelect = document.getElementById('travelSpeed');
    if (travelSpeedSelect) travelSpeedSelect.addEventListener('change', async (e) => {
        userSettings.travelSpeed = e.target.value;
        await setSetting('userSettings', userSettings);
    });
    const soundSelect = document.getElementById('notificationSound');
    if (soundSelect) soundSelect.addEventListener('change', async (e) => {
        userSettings.notificationSound = e.target.value;
        await setSetting('userSettings', userSettings);
        if (typeof updateNotifications === 'function') updateNotifications();
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
});
