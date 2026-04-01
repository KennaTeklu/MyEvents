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

// ========== WIZARD FUNCTIONS ==========
let wizardDraftManager = null;

function showWizard() {
    const wizardOverlay = document.getElementById('wizardOverlay');
    const mainApp = document.getElementById('mainApp');
    const fab = document.getElementById('fab');
    if (wizardOverlay) {
        wizardOverlay.classList.remove('hidden');
        mainApp?.classList.add('hidden');
        fab?.classList.add('hidden');
        renderWizardStep();
    }
    // Create draft manager if not exists
    if (!wizardDraftManager) {
        wizardDraftManager = new FormDraft('wizardOverlay', 'wizardDraft', {
            homeLat: { read: () => wizardData.homeLat, write: (_, v) => { wizardData.homeLat = v; } },
            homeLon: { read: () => wizardData.homeLon, write: (_, v) => { wizardData.homeLon = v; } },
            homeName: { read: () => wizardData.homeName, write: (_, v) => { wizardData.homeName = v; } },
            homeRadius: { read: () => wizardData.homeRadius, write: (_, v) => { wizardData.homeRadius = v; } },
            eventName: { read: () => wizardData.eventName, write: (_, v) => { wizardData.eventName = v; } },
            weeklyDays: { read: () => wizardData.weeklyDays, write: (_, v) => { wizardData.weeklyDays = v; } },
            openTime: { read: () => wizardData.openTime, write: (_, v) => { wizardData.openTime = v; } },
            closeTime: { read: () => wizardData.closeTime, write: (_, v) => { wizardData.closeTime = v; } },
            stay: { read: () => wizardData.stay, write: (_, v) => { wizardData.stay = v; } },
            restPolicy: { read: () => wizardData.restPolicy, write: (_, v) => { wizardData.restPolicy = v; } },
            farMinutes: { read: () => wizardData.farMinutes, write: (_, v) => { wizardData.farMinutes = v; } },
            notifyDayBefore: { read: () => wizardData.notifyDayBefore, write: (_, v) => { wizardData.notifyDayBefore = v; } },
            notifyMinutesBefore: { read: () => wizardData.notifyMinutesBefore, write: (_, v) => { wizardData.notifyMinutesBefore = v; } }
        });
    }
}

async function finishWizard() {
    // Save all wizard data to settings and create default place and event
    try {
        // 1. Create home place
        const homePlace = {
            name: wizardData.homeName || 'Home',
            lat: wizardData.homeLat,
            lon: wizardData.homeLon,
            radius: wizardData.homeRadius || 30,
            travelToEvent: {}
        };
        const placeId = await addRecord('places', homePlace);
        places.push({ ...homePlace, id: placeId });
        currentPlaceId = placeId;

        // 2. Create first event if name provided
        if (wizardData.eventName) {
            const startMin = toMinutes(wizardData.openTime);
            const endMin = startMin + wizardData.stay;
            const eventData = {
                name: wizardData.eventName,
                openTime: wizardData.openTime,
                closeTime: wizardData.closeTime,
                minStay: wizardData.stay,
                maxStay: wizardData.stay,
                startDate: formatDate(new Date()),
                startTime: wizardData.openTime,
                endTime: fromMinutes(endMin),
                color: '#3b82f6',
                repeat: wizardData.weeklyDays.length ? 'weekly' : 'none',
                weeklyDays: wizardData.weeklyDays,
                priority: 3,
                travelMins: 15,
                notes: ''
            };
            await addRecord('events', eventData);
        }

        // 3. Save settings
        await setSetting('restPolicy', wizardData.restPolicy);
        await setSetting('farMinutes', wizardData.farMinutes);
        await setSetting('notifyDayBefore', wizardData.notifyDayBefore);
        await setSetting('notifyMinutesBefore', wizardData.notifyMinutesBefore);
        await setSetting('wizardComplete', true);

        // 4. Request notification permission if not already
        if (wizardData.notificationsGranted && Notification.permission === 'default') {
            await Notification.requestPermission();
        }

        // 5. Clear wizard draft
        if (wizardDraftManager) await wizardDraftManager.clearDraft();

        // 6. Show main app with animation
        const wizardOverlay = document.getElementById('wizardOverlay');
        const mainApp = document.getElementById('mainApp');
        const fab = document.getElementById('fab');
        if (wizardOverlay) wizardOverlay.classList.add('hidden');
        if (mainApp) {
            mainApp.classList.remove('hidden');
            mainApp.style.animation = 'fadeInUp 0.4s ease';
        }
        if (fab) fab.classList.remove('hidden');

        // 7. Refresh data and scroll to now
        await fullRefresh();
        if (typeof scrollToNow === 'function') scrollToNow();
        showToast('Setup complete! 🎉', 'success');
    } catch (err) {
        console.error('Finish wizard error:', err);
        showToast('Setup failed: ' + err.message, 'error');
    }
}

function renderWizardStep() {
    const container = document.getElementById('wizardStepsContainer');
    const backBtn = document.getElementById('wizardBackBtn');
    const nextBtn = document.getElementById('wizardNextBtn');
    const finishBtn = document.getElementById('wizardFinishBtn');
    const stepLabel = document.getElementById('wizardStepLabel');
    const progressFill = document.getElementById('wizardProgressFill');

    if (!container) return;

    // Update progress bar and label
    const percent = (wizardStep / WIZARD_TOTAL_STEPS) * 100;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (stepLabel) stepLabel.textContent = `Step ${wizardStep} of ${WIZARD_TOTAL_STEPS}`;

    // Apply slide-in animation
    container.style.opacity = '0';
    setTimeout(() => {
        container.style.opacity = '1';
        container.classList.add('wizard-step-enter');
        setTimeout(() => container.classList.remove('wizard-step-enter'), 200);
    }, 10);

    // Render content based on step
    let html = '';
    switch (wizardStep) {
        case 1:
            html = `
                <p class="mb-3 text-gray-600 dark:text-gray-300">Let's set your home location so I know where you start from.</p>
                <div id="gpsStatus" class="mb-3 text-sm"></div>
                <button id="wizardUseGps" class="w-full bg-blue-600 text-white px-4 py-3 rounded-xl mb-2 flex items-center justify-center gap-2 hover:bg-blue-700 transition">
                    <i class="fas fa-location-arrow"></i> Use my current location
                </button>
                <div id="gpsResult" class="mt-3 hidden">
                    <label class="block text-sm font-medium mb-1">Place name</label>
                    <input type="text" id="wizardHomeName" value="${escapeHtml(wizardData.homeName)}" class="w-full border rounded-xl p-2 mb-2">
                    <label class="block text-sm font-medium mb-1">Radius (meters)</label>
                    <input type="range" id="wizardHomeRadius" min="10" max="200" step="5" value="${wizardData.homeRadius}" class="w-full">
                    <div class="text-xs text-gray-500 mt-1">Radius: <span id="radiusValue">${wizardData.homeRadius}</span> m</div>
                </div>
                <button id="wizardSkipGps" class="w-full bg-gray-100 text-gray-600 px-4 py-2 rounded-xl hover:bg-gray-200 transition">Skip for now</button>
            `;
            break;
        case 2:
            html = `
                <p class="mb-2 font-medium">What is your first recurring activity?</p>
                <input type="text" id="wizardEventName" placeholder="e.g. Gym, Library, Office" value="${escapeHtml(wizardData.eventName)}" class="w-full border rounded-xl p-3 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none">
            `;
            break;
        case 3:
            const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const weeklySelected = wizardData.weeklyDays || [];
            html = `
                <p class="mb-2 font-medium">Which days does it happen?</p>
                <div class="flex flex-wrap gap-2 mb-4">
                    ${days.map((d, i) => `
                        <label class="inline-flex items-center gap-1 cursor-pointer px-3 py-2 rounded-full border ${weeklySelected.includes(i) ? 'bg-blue-100 border-blue-500' : 'bg-gray-100 border-gray-300'}" data-day="${i}">
                            <input type="checkbox" value="${i}" ${weeklySelected.includes(i) ? 'checked' : ''} class="hidden day-checkbox"> ${d}
                        </label>
                    `).join('')}
                </div>
                <div class="flex gap-2">
                    <button id="selectWeekdays" class="text-xs bg-gray-200 px-3 py-1 rounded-full">Weekdays</button>
                    <button id="selectWeekends" class="text-xs bg-gray-200 px-3 py-1 rounded-full">Weekends</button>
                    <button id="selectAllDays" class="text-xs bg-gray-200 px-3 py-1 rounded-full">All</button>
                </div>
            `;
            break;
        case 4:
            const endTime = fromMinutes(toMinutes(wizardData.openTime) + wizardData.stay);
            html = `
                <p class="mb-2 font-medium">When are you usually there?</p>
                <div class="flex gap-2 mb-3">
                    <div class="w-1/2"><label class="text-xs text-gray-500">Opens</label><input type="time" id="wizardOpen" value="${wizardData.openTime}" class="w-full border rounded-xl p-2"></div>
                    <div class="w-1/2"><label class="text-xs text-gray-500">Closes</label><input type="time" id="wizardClose" value="${wizardData.closeTime}" class="w-full border rounded-xl p-2"></div>
                </div>
                <label class="block text-sm font-medium mb-1">How many minutes do you stay? (${wizardData.stay} min)</label>
                <input type="range" id="wizardStay" min="15" max="240" step="15" value="${wizardData.stay}" class="w-full">
                <div class="text-xs text-gray-500 mt-1">Ends at: <span id="dynamicEndTime">${endTime}</span></div>
            `;
            break;
        case 5:
            html = `
                <p class="mb-3 font-medium">Do you go home to rest between events?</p>
                <div class="space-y-2">
                    <div id="choiceHome" class="p-3 border rounded-xl cursor-pointer hover:bg-blue-50 transition flex items-center gap-3 ${wizardData.restPolicy === 'home' ? 'border-blue-600 bg-blue-50' : ''}">
                        <i class="fas fa-home text-blue-600"></i> <span>Yes, rest at home (15m)</span>
                    </div>
                    <div id="choiceFar" class="p-3 border rounded-xl cursor-pointer hover:bg-blue-50 transition flex items-center gap-3 ${wizardData.restPolicy === 'far' ? 'border-blue-600 bg-blue-50' : ''}">
                        <i class="fas fa-map-marker-alt text-orange-500"></i> <span>Only if the next event is far</span>
                    </div>
                    <div id="choiceNone" class="p-3 border rounded-xl cursor-pointer hover:bg-blue-50 transition flex items-center gap-3 ${wizardData.restPolicy === 'none' ? 'border-blue-600 bg-blue-50' : ''}">
                        <i class="fas fa-arrow-right text-gray-600"></i> <span>No, go directly to next</span>
                    </div>
                </div>
                <div id="farMinutesDiv" class="mt-3 ${wizardData.restPolicy !== 'far' ? 'hidden' : ''}">
                    <label class="block text-sm">Far means more than (minutes walk)</label>
                    <input type="number" id="wizardFarMinutes" value="${wizardData.farMinutes}" class="border rounded-xl p-2 w-full">
                </div>
            `;
            break;
        case 6:
            html = `
                <p class="mb-3 font-medium">Stay informed with reminders</p>
                <div class="space-y-3">
                    <button id="requestNotifPerm" class="w-full bg-gray-200 dark:bg-gray-700 px-4 py-2 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-300 transition">
                        <i class="fas fa-bell"></i> Allow notifications
                    </button>
                    <div class="flex items-center gap-2">
                        <input type="checkbox" id="wizardNotifyDayBefore" ${wizardData.notifyDayBefore ? 'checked' : ''}>
                        <label>Remind me the day before an event</label>
                    </div>
                    <div>
                        <label class="block text-sm">Remind me ___ minutes before an event</label>
                        <input type="number" id="wizardNotifyMinutesBefore" value="${wizardData.notifyMinutesBefore}" class="border rounded-xl p-2 w-32">
                    </div>
                </div>
            `;
            break;
        case 7:
            const summaryEndTime = fromMinutes(toMinutes(wizardData.openTime) + wizardData.stay);
            const restDesc = wizardData.restPolicy === 'home' ? 'Always rest at home' : (wizardData.restPolicy === 'far' ? `Rest only if far (>${wizardData.farMinutes} min)` : 'No rest');
            html = `
                <div class="space-y-3 text-sm">
                    <p class="font-medium mb-2">Review your setup:</p>
                    <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <div><strong>🏠 Home:</strong> ${escapeHtml(wizardData.homeName)} (radius ${wizardData.homeRadius}m)</div>
                        <div><strong>📅 First event:</strong> ${escapeHtml(wizardData.eventName)}</div>
                        <div><strong>⏰ Time:</strong> ${wizardData.openTime} – ${summaryEndTime}</div>
                        <div><strong>📆 Repeats:</strong> ${wizardData.weeklyDays.length ? `Weekly on ${wizardData.weeklyDays.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}` : 'Once'}</div>
                        <div><strong>🛌 Rest policy:</strong> ${restDesc}</div>
                        <div><strong>🔔 Notifications:</strong> ${wizardData.notifyDayBefore ? 'Day before, ' : ''}${wizardData.notifyMinutesBefore} min before</div>
                    </div>
                    <p class="text-center text-xs text-gray-400 mt-2">Click Finish to start using Smart Scheduler!</p>
                </div>
            `;
            break;
    }

    container.innerHTML = html;

    // Attach event listeners based on step
    attachWizardStepListeners();

    // Show/hide navigation buttons
    backBtn.classList.toggle('hidden', wizardStep === 1);
    nextBtn.classList.toggle('hidden', wizardStep === WIZARD_TOTAL_STEPS);
    finishBtn.classList.toggle('hidden', wizardStep !== WIZARD_TOTAL_STEPS);

    // Set button actions
    backBtn.onclick = () => {
        if (wizardStep > 1) {
            wizardStep--;
            renderWizardStep();
        }
    };
    nextBtn.onclick = async () => {
        if (!validateWizardStep()) return;
        if (wizardStep < WIZARD_TOTAL_STEPS) {
            wizardStep++;
            renderWizardStep();
        }
    };
    finishBtn.onclick = finishWizard;

    // Save draft after step render (debounced)
    if (wizardDraftManager) wizardDraftManager.saveDraft();
}

function attachWizardStepListeners() {
    // Step 1: GPS
    if (wizardStep === 1) {
        const useGpsBtn = document.getElementById('wizardUseGps');
        const skipGpsBtn = document.getElementById('wizardSkipGps');
        const gpsStatus = document.getElementById('gpsStatus');
        const gpsResultDiv = document.getElementById('gpsResult');
        const homeNameInput = document.getElementById('wizardHomeName');
        const radiusSlider = document.getElementById('wizardHomeRadius');
        const radiusValue = document.getElementById('radiusValue');

        if (useGpsBtn) {
            useGpsBtn.onclick = () => {
                if (!navigator.geolocation) {
                    showToast('GPS not supported', 'error');
                    return;
                }
                gpsStatus.textContent = 'Getting location...';
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        wizardData.homeLat = pos.coords.latitude;
                        wizardData.homeLon = pos.coords.longitude;
                        gpsStatus.innerHTML = `<i class="fas fa-check-circle text-green-500"></i> Location acquired: ${wizardData.homeLat.toFixed(4)}, ${wizardData.homeLon.toFixed(4)}`;
                        gpsResultDiv.classList.remove('hidden');
                        if (homeNameInput) homeNameInput.value = wizardData.homeName;
                        if (radiusSlider) radiusSlider.value = wizardData.homeRadius;
                        if (radiusValue) radiusValue.textContent = wizardData.homeRadius;
                        if (wizardDraftManager) wizardDraftManager.saveDraft();
                    },
                    (err) => {
                        gpsStatus.innerHTML = `<i class="fas fa-exclamation-triangle text-red-500"></i> Error: ${err.message}. Using default.`;
                        gpsResultDiv.classList.remove('hidden');
                    }
                );
            };
        }
        if (skipGpsBtn) {
            skipGpsBtn.onclick = () => {
                wizardStep = 2;
                renderWizardStep();
            };
        }
        if (homeNameInput) {
            homeNameInput.oninput = (e) => {
                wizardData.homeName = e.target.value;
                if (wizardDraftManager) wizardDraftManager.saveDraft();
            };
        }
        if (radiusSlider) {
            radiusSlider.oninput = (e) => {
                wizardData.homeRadius = parseInt(e.target.value);
                if (radiusValue) radiusValue.textContent = wizardData.homeRadius;
                if (wizardDraftManager) wizardDraftManager.saveDraft();
            };
        }
    }

    // Step 2: Event name
    if (wizardStep === 2) {
        const nameInput = document.getElementById('wizardEventName');
        if (nameInput) {
            nameInput.oninput = (e) => {
                wizardData.eventName = e.target.value;
                if (wizardDraftManager) wizardDraftManager.saveDraft();
            };
        }
    }

    // Step 3: Weekly days
    if (wizardStep === 3) {
        const dayLabels = document.querySelectorAll('[data-day]');
        const checkboxes = document.querySelectorAll('.day-checkbox');
        const selectWeekdays = document.getElementById('selectWeekdays');
        const selectWeekends = document.getElementById('selectWeekends');
        const selectAllDays = document.getElementById('selectAllDays');

        function updateSelected() {
            wizardData.weeklyDays = Array.from(checkboxes)
                .filter(cb => cb.checked)
                .map(cb => parseInt(cb.value));
            dayLabels.forEach(label => {
                const dayVal = parseInt(label.dataset.day);
                if (wizardData.weeklyDays.includes(dayVal)) {
                    label.classList.add('bg-blue-100', 'border-blue-500');
                    label.classList.remove('bg-gray-100', 'border-gray-300');
                } else {
                    label.classList.remove('bg-blue-100', 'border-blue-500');
                    label.classList.add('bg-gray-100', 'border-gray-300');
                }
            });
            if (wizardDraftManager) wizardDraftManager.saveDraft();
        }

        dayLabels.forEach(label => {
            label.addEventListener('click', () => {
                const cb = label.querySelector('.day-checkbox');
                if (cb) {
                    cb.checked = !cb.checked;
                    updateSelected();
                }
            });
        });
        if (selectWeekdays) {
            selectWeekdays.onclick = () => {
                checkboxes.forEach(cb => cb.checked = [1,2,3,4,5].includes(parseInt(cb.value)));
                updateSelected();
            };
        }
        if (selectWeekends) {
            selectWeekends.onclick = () => {
                checkboxes.forEach(cb => cb.checked = [0,6].includes(parseInt(cb.value)));
                updateSelected();
            };
        }
        if (selectAllDays) {
            selectAllDays.onclick = () => {
                checkboxes.forEach(cb => cb.checked = true);
                updateSelected();
            };
        }
        updateSelected(); // initial sync
    }

    // Step 4: Time & stay
    if (wizardStep === 4) {
        const openInput = document.getElementById('wizardOpen');
        const closeInput = document.getElementById('wizardClose');
        const staySlider = document.getElementById('wizardStay');
        const endTimeSpan = document.getElementById('dynamicEndTime');

        function updateEndTime() {
            const openMin = toMinutes(openInput.value);
            const stay = parseInt(staySlider.value);
            const endMin = openMin + stay;
            const endTime = fromMinutes(endMin);
            if (endTimeSpan) endTimeSpan.textContent = endTime;
            wizardData.openTime = openInput.value;
            wizardData.closeTime = closeInput.value;
            wizardData.stay = stay;
            if (wizardDraftManager) wizardDraftManager.saveDraft();
        }

        if (openInput) openInput.onchange = updateEndTime;
        if (closeInput) closeInput.onchange = () => {
            wizardData.closeTime = closeInput.value;
            if (wizardDraftManager) wizardDraftManager.saveDraft();
        };
        if (staySlider) staySlider.oninput = (e) => {
            const val = e.target.value;
            document.querySelector('#wizardStay')?.parentNode?.querySelector('label')?.setAttribute('data-stay', val);
            updateEndTime();
        };
        updateEndTime();
    }

    // Step 5: Rest policy
    if (wizardStep === 5) {
        const homeChoice = document.getElementById('choiceHome');
        const farChoice = document.getElementById('choiceFar');
        const noneChoice = document.getElementById('choiceNone');
        const farDiv = document.getElementById('farMinutesDiv');
        const farInput = document.getElementById('wizardFarMinutes');

        function setPolicy(policy) {
            wizardData.restPolicy = policy;
            if (farDiv) farDiv.classList.toggle('hidden', policy !== 'far');
            if (homeChoice) homeChoice.classList.toggle('border-blue-600', policy === 'home');
            if (farChoice) farChoice.classList.toggle('border-blue-600', policy === 'far');
            if (noneChoice) noneChoice.classList.toggle('border-blue-600', policy === 'none');
            if (wizardDraftManager) wizardDraftManager.saveDraft();
        }

        if (homeChoice) homeChoice.onclick = () => setPolicy('home');
        if (farChoice) farChoice.onclick = () => setPolicy('far');
        if (noneChoice) noneChoice.onclick = () => setPolicy('none');
        if (farInput) {
            farInput.value = wizardData.farMinutes;
            farInput.oninput = (e) => {
                wizardData.farMinutes = parseInt(e.target.value);
                if (wizardDraftManager) wizardDraftManager.saveDraft();
            };
        }
        setPolicy(wizardData.restPolicy);
    }

    // Step 6: Notifications
    if (wizardStep === 6) {
        const reqPermBtn = document.getElementById('requestNotifPerm');
        const dayBeforeCheck = document.getElementById('wizardNotifyDayBefore');
        const minutesBeforeInput = document.getElementById('wizardNotifyMinutesBefore');

        if (reqPermBtn) {
            reqPermBtn.onclick = async () => {
                if (Notification.permission === 'granted') {
                    showToast('Notifications already allowed', 'info');
                } else if (Notification.permission === 'denied') {
                    showToast('Permission denied. Please enable in browser settings.', 'error');
                } else {
                    const result = await Notification.requestPermission();
                    wizardData.notificationsGranted = (result === 'granted');
                    if (wizardData.notificationsGranted) {
                        showToast('Notifications enabled!', 'success');
                        reqPermBtn.textContent = '✓ Notifications enabled';
                        reqPermBtn.disabled = true;
                    } else {
                        showToast('Notifications not allowed', 'warning');
                    }
                    if (wizardDraftManager) wizardDraftManager.saveDraft();
                }
            };
        }
        if (dayBeforeCheck) {
            dayBeforeCheck.checked = wizardData.notifyDayBefore;
            dayBeforeCheck.onchange = (e) => {
                wizardData.notifyDayBefore = e.target.checked;
                if (wizardDraftManager) wizardDraftManager.saveDraft();
            };
        }
        if (minutesBeforeInput) {
            minutesBeforeInput.value = wizardData.notifyMinutesBefore;
            minutesBeforeInput.onchange = (e) => {
                wizardData.notifyMinutesBefore = parseInt(e.target.value);
                if (wizardDraftManager) wizardDraftManager.saveDraft();
            };
        }
    }
}

function validateWizardStep() {
    if (wizardStep === 2 && !wizardData.eventName.trim()) {
        showToast('Please enter an event name', 'error');
        return false;
    }
    if (wizardStep === 4) {
        const openMin = toMinutes(wizardData.openTime);
        const closeMin = toMinutes(wizardData.closeTime);
        if (openMin >= closeMin) {
            showToast('Open time must be before close time', 'error');
            return false;
        }
        if (wizardData.stay > (closeMin - openMin)) {
            showToast('Stay duration exceeds time window', 'error');
            return false;
        }
    }
    return true;
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
