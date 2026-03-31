// settings.js - Settings panel, places, busy blocks management
// Must be loaded after state.js, utils.js, db.js

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
        });
    });
}

// ========== PLACES MANAGEMENT ==========
async function renderPlacesList() {
    const container = document.getElementById('placesListContainer');
    if (!container) return;
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
                <button class="text-xs text-blue-600 hover:underline" onclick="renamePlace(${p.id})">Rename</button>
                <button class="text-xs text-red-500 hover:underline" onclick="deletePlace(${p.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

async function renamePlace(id) {
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
}

async function deletePlace(id) {
    if (!confirm('Delete this place?')) return;
    await deleteRecord('places', id);
    await renderPlacesList();
    showToast('Place deleted');
}

// ========== BUSY BLOCKS MANAGEMENT ==========
async function renderBusyBlocksList() {
    const container = document.getElementById('busyBlocksListContainer');
    if (!container) return;
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
            <div class="place-row">
                <div>
                    <span class="font-medium">${escapeHtml(b.description || 'Busy block')}</span>
                    ${b.hard ? '<span class="text-xs bg-red-100 text-red-600 px-1 rounded ml-1">Hard</span>' : ''}
                    <span class="text-xs text-gray-400 ml-2">${recurrenceLabel}</span>
                    <span class="text-xs text-gray-400 ml-2">${b.startTime}–${b.endTime}</span>
                </div>
                <div class="flex gap-2">
                    <button class="text-xs text-blue-600 hover:underline" onclick="editBusyBlock(${b.id})">Edit</button>
                    <button class="text-xs text-red-500 hover:underline" onclick="deleteBusyBlock(${b.id})">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

async function editBusyBlock(id) {
    const all = await getAll('busyBlocks');
    const block = all.find(b => b.id === id);
    if (block) {
        ModalManager.close('settingsModal');
        openBusyModal(block);
    }
}

async function deleteBusyBlock(id) {
    if (!confirm('Delete this busy block?')) return;
    await deleteRecord('busyBlocks', id);
    await fullRefresh();
    await renderBusyBlocksList();
    showToast('Busy block deleted');
}
