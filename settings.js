// settings.js - Settings panel, places, busy blocks management
// Must be loaded after state.js, utils.js, db.js

// ========== LIVE JSON VISUALIZER ==========
let liveJSONUpdatePending = false;

async function updateLiveJSON() {
    // Debounce updates to avoid excessive DOM manipulation
    if (liveJSONUpdatePending) return;
    liveJSONUpdatePending = true;
    
    // Use requestAnimationFrame to batch updates
    requestAnimationFrame(async () => {
        try {
            const container = document.getElementById('liveJSONContainer');
            if (!container) {
                liveJSONUpdatePending = false;
                return;
            }
            
            // Build a clean representation of current state
            const stateForExport = {
                events: events,
                busyBlocks: busyBlocks,
                places: places,
                overrides: Array.from(overrides.values())
            };
            
            const jsonStr = JSON.stringify(stateForExport, null, 2);
            const pre = container.querySelector('pre');
            if (pre) {
                pre.textContent = jsonStr;
            }
        } catch (err) {
            console.error('Failed to update live JSON:', err);
        } finally {
            liveJSONUpdatePending = false;
        }
    });
}

// Call this when the Data tab becomes visible
function refreshLiveJSON() {
    updateLiveJSON();
}

// Copy JSON to clipboard
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
            
            // Refresh live JSON when Data tab becomes visible
            if (target === 'data') {
                refreshLiveJSON();
            }
        });
    });
    
    // Attach copy button listener if it exists
    const copyBtn = document.getElementById('copyLiveJSONBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyLiveJSON);
    }
    
    // Attach manual refresh button listener
    const refreshBtn = document.getElementById('refreshLiveJSONBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshLiveJSON);
    }
}

// ========== PLACES MANAGEMENT ==========
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
            <div class="place-row">
                <div>
                    <span class="font-medium">${escapeHtml(p.name)}</span>
                    <span class="text-xs text-gray-400 ml-2">${p.lat ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : 'No GPS coordinates'}</span>
                    <span class="text-xs text-gray-400 ml-2">Radius: ${p.radius}m</span>
                </div>
                <div class="flex gap-2">
                    <button class="text-xs text-blue-600 hover:underline" data-id="${p.id}" data-action="rename">Rename</button>
                    <button class="text-xs text-red-500 hover:underline" data-id="${p.id}" data-action="delete">Delete</button>
                </div>
            </div>
        `).join('');
        // Attach event listeners dynamically to avoid global function calls
        container.querySelectorAll('[data-action="rename"]').forEach(btn => {
            btn.onclick = () => renamePlace(parseInt(btn.dataset.id));
        });
        container.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.onclick = () => deletePlace(parseInt(btn.dataset.id));
        });
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
        // Attach event listeners
        container.querySelectorAll('[data-action="edit"]').forEach(btn => {
            btn.onclick = () => editBusyBlock(parseInt(btn.dataset.id));
        });
        container.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.onclick = () => deleteBusyBlock(parseInt(btn.dataset.id));
        });
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

// ========== REDO SETUP BUTTON HANDLER ==========
/**
 * Resets the wizard state and shows the onboarding wizard again.
 * Clears the wizardComplete flag, clears any wizard draft, and displays the wizard overlay.
 */
async function resetAndShowWizard() {
    // Close settings modal first
    ModalManager.close('settingsModal');
    
    // Reset wizard step to 1
    wizardStep = 1;
    
    // Clear wizard draft if draft manager exists
    if (window.wizardDraftManager && typeof wizardDraftManager.clearDraft === 'function') {
        await wizardDraftManager.clearDraft();
    }
    
    // Clear the wizardComplete setting so that on next launch wizard shows
    await setSetting('wizardComplete', false);
    
    // Show the wizard (defined in modals.js)
    if (typeof showWizard === 'function') {
        showWizard();
    } else {
        console.error('showWizard function not found');
        showToast('Could not restart setup. Please refresh the page.', 'error');
    }
}

// Initialize Redo Setup button after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const redoBtn = document.getElementById('redoWizardBtn');
    if (redoBtn) {
        redoBtn.addEventListener('click', resetAndShowWizard);
    }
});
