// ==================== SETTINGS ====================
let restPolicy = 'home';
let farMinutes = 10;
let darkMode = false;
let notifyDayBefore = true;
let notifyMinutesBefore = 60;
let notifyTravelLead = 5;

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

function setupSettingsTabs() {
    const tabs = document.querySelectorAll('.settings-tab');
    const panels = document.querySelectorAll('.settings-panel');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('border-blue-600', 'text-blue-600'));
            tab.classList.add('border-blue-600', 'text-blue-600');
            panels.forEach(panel => panel.classList.add('hidden'));
            document.getElementById(`settings-${target}`)?.classList.remove('hidden');
        });
    });
}