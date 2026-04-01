// wizard.js - Enhanced 7‑step onboarding wizard
// Must be loaded after state.js, constants.js, eventManager.js, locationManager.js, settings.js

const Wizard = (function() {
    // ========== PRIVATE VARIABLES ==========
    let wizardDraftManager = null;
    let wizardOverlay = null;
    let mainApp = null;
    let fab = null;

    // ========== PRIVATE HELPERS ==========
    
    // Update progress bar and step label
    function updateProgress() {
        const stepLabel = document.getElementById('wizardStepLabel');
        const progressFill = document.getElementById('wizardProgressFill');
        if (stepLabel) stepLabel.textContent = `Step ${wizardStep} of ${WIZARD_TOTAL_STEPS}`;
        if (progressFill) {
            const percent = (wizardStep / WIZARD_TOTAL_STEPS) * 100;
            progressFill.style.width = `${percent}%`;
        }
    }
    
    // Apply slide-in animation to step container
    function animateStep(container) {
        container.style.opacity = '0';
        setTimeout(() => {
            container.style.opacity = '1';
            container.classList.add('wizard-step-enter');
            setTimeout(() => container.classList.remove('wizard-step-enter'), 200);
        }, 10);
    }
    
    // Validate current step before advancing
    function validateCurrentStep() {
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
    
    // Save draft after step changes
    function saveDraft() {
        if (wizardDraftManager) wizardDraftManager.saveDraft();
    }
    
    // ========== STEP RENDERING ==========
    
    function renderStep1(container) {
        container.innerHTML = `
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
        
        // GPS logic
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
                        saveDraft();
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
                saveDraft();
            };
        }
        if (radiusSlider) {
            radiusSlider.oninput = (e) => {
                wizardData.homeRadius = parseInt(e.target.value);
                if (radiusValue) radiusValue.textContent = wizardData.homeRadius;
                saveDraft();
            };
        }
    }
    
    function renderStep2(container) {
        container.innerHTML = `
            <p class="mb-2 font-medium">What is your first recurring activity?</p>
            <input type="text" id="wizardEventName" placeholder="e.g. Gym, Library, Office" value="${escapeHtml(wizardData.eventName)}" class="w-full border rounded-xl p-3 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none">
        `;
        const nameInput = document.getElementById('wizardEventName');
        if (nameInput) {
            nameInput.oninput = (e) => {
                wizardData.eventName = e.target.value;
                saveDraft();
            };
        }
    }
    
    function renderStep3(container) {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const weeklySelected = wizardData.weeklyDays || [];
        container.innerHTML = `
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
            saveDraft();
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
        if (selectWeekdays) selectWeekdays.onclick = () => {
            checkboxes.forEach(cb => cb.checked = [1,2,3,4,5].includes(parseInt(cb.value)));
            updateSelected();
        };
        if (selectWeekends) selectWeekends.onclick = () => {
            checkboxes.forEach(cb => cb.checked = [0,6].includes(parseInt(cb.value)));
            updateSelected();
        };
        if (selectAllDays) selectAllDays.onclick = () => {
            checkboxes.forEach(cb => cb.checked = true);
            updateSelected();
        };
        updateSelected();
    }
    
    function renderStep4(container) {
        const endTime = fromMinutes(toMinutes(wizardData.openTime) + wizardData.stay);
        container.innerHTML = `
            <p class="mb-2 font-medium">When are you usually there?</p>
            <div class="flex gap-2 mb-3">
                <div class="w-1/2"><label class="text-xs text-gray-500">Opens</label><input type="time" id="wizardOpen" value="${wizardData.openTime}" class="w-full border rounded-xl p-2"></div>
                <div class="w-1/2"><label class="text-xs text-gray-500">Closes</label><input type="time" id="wizardClose" value="${wizardData.closeTime}" class="w-full border rounded-xl p-2"></div>
            </div>
            <label class="block text-sm font-medium mb-1">How many minutes do you stay? (${wizardData.stay} min)</label>
            <input type="range" id="wizardStay" min="15" max="240" step="15" value="${wizardData.stay}" class="w-full">
            <div class="text-xs text-gray-500 mt-1">Ends at: <span id="dynamicEndTime">${endTime}</span></div>
        `;
        
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
            saveDraft();
        }
        
        if (openInput) openInput.onchange = updateEndTime;
        if (closeInput) closeInput.onchange = () => {
            wizardData.closeTime = closeInput.value;
            saveDraft();
        };
        if (staySlider) staySlider.oninput = (e) => {
            updateEndTime();
        };
        updateEndTime();
    }
    
    function renderStep5(container) {
        container.innerHTML = `
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
            saveDraft();
        }
        
        if (homeChoice) homeChoice.onclick = () => setPolicy('home');
        if (farChoice) farChoice.onclick = () => setPolicy('far');
        if (noneChoice) noneChoice.onclick = () => setPolicy('none');
        if (farInput) {
            farInput.value = wizardData.farMinutes;
            farInput.oninput = (e) => {
                wizardData.farMinutes = parseInt(e.target.value);
                saveDraft();
            };
        }
        setPolicy(wizardData.restPolicy);
    }
    
    function renderStep6(container) {
        container.innerHTML = `
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
                    saveDraft();
                }
            };
        }
        if (dayBeforeCheck) {
            dayBeforeCheck.checked = wizardData.notifyDayBefore;
            dayBeforeCheck.onchange = (e) => {
                wizardData.notifyDayBefore = e.target.checked;
                saveDraft();
            };
        }
        if (minutesBeforeInput) {
            minutesBeforeInput.value = wizardData.notifyMinutesBefore;
            minutesBeforeInput.onchange = (e) => {
                wizardData.notifyMinutesBefore = parseInt(e.target.value);
                saveDraft();
            };
        }
    }
    
    function renderStep7(container) {
        const summaryEndTime = fromMinutes(toMinutes(wizardData.openTime) + wizardData.stay);
        const restDesc = wizardData.restPolicy === 'home' ? 'Always rest at home' : (wizardData.restPolicy === 'far' ? `Rest only if far (>${wizardData.farMinutes} min)` : 'No rest');
        container.innerHTML = `
            <div class="space-y-3 text-sm">
                <p class="font-medium mb-2">Review your setup:</p>
                <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                    <div><strong>🏠 Home:</strong> ${escapeHtml(wizardData.homeName)} (radius ${wizardData.homeRadius}m)</div>
                    <div><strong>📅 First event:</strong> ${escapeHtml(wizardData.eventName)}</div>
                    <div><strong>⏰ Time:</strong> ${wizardData.openTime} – ${summaryEndTime}</div>
                    <div><strong>📆 Repeats:</strong> ${wizardData.weeklyDays.length ? `Weekly on ${wizardData.weeklyDays.map(d => DAYS_SHORT[d]).join(', ')}` : 'Once'}</div>
                    <div><strong>🛌 Rest policy:</strong> ${restDesc}</div>
                    <div><strong>🔔 Notifications:</strong> ${wizardData.notifyDayBefore ? 'Day before, ' : ''}${wizardData.notifyMinutesBefore} min before</div>
                </div>
                <p class="text-center text-xs text-gray-400 mt-2">Click Finish to start using Smart Scheduler!</p>
            </div>
        `;
    }
    
    // Main step renderer
    function renderWizardStep() {
        const container = document.getElementById('wizardStepsContainer');
        if (!container) return;
        
        updateProgress();
        animateStep(container);
        
        // Render content based on current step
        switch (wizardStep) {
            case 1: renderStep1(container); break;
            case 2: renderStep2(container); break;
            case 3: renderStep3(container); break;
            case 4: renderStep4(container); break;
            case 5: renderStep5(container); break;
            case 6: renderStep6(container); break;
            case 7: renderStep7(container); break;
            default: break;
        }
        
        // Setup navigation buttons
        const backBtn = document.getElementById('wizardBackBtn');
        const nextBtn = document.getElementById('wizardNextBtn');
        const finishBtn = document.getElementById('wizardFinishBtn');
        
        backBtn.classList.toggle('hidden', wizardStep === 1);
        nextBtn.classList.toggle('hidden', wizardStep === WIZARD_TOTAL_STEPS);
        finishBtn.classList.toggle('hidden', wizardStep !== WIZARD_TOTAL_STEPS);
        
        backBtn.onclick = () => {
            if (wizardStep > 1) {
                wizardStep--;
                renderWizardStep();
            }
        };
        nextBtn.onclick = async () => {
            if (!validateCurrentStep()) return;
            if (wizardStep < WIZARD_TOTAL_STEPS) {
                wizardStep++;
                renderWizardStep();
            }
        };
        finishBtn.onclick = finishWizard;
        
        saveDraft();
    }
    
    // ========== FINISH WIZARD ==========
    async function finishWizard() {
        try {
            // 1. Create home place using LocationManager if available, else direct
            const homePlace = {
                name: wizardData.homeName || 'Home',
                lat: wizardData.homeLat || null,
                lon: wizardData.homeLon || null,
                radius: wizardData.homeRadius || 30,
                travelToEvent: {}
            };
            let placeId;
            if (typeof LocationManager !== 'undefined' && LocationManager.addPlace) {
                placeId = await LocationManager.addPlace(homePlace);
            } else {
                placeId = await addRecord(STORES.PLACES, homePlace);
                await refreshPlaces?.();
            }
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
                    color: DEFAULT_EVENT_COLOR,
                    repeat: wizardData.weeklyDays.length ? RECURRENCE.WEEKLY : RECURRENCE.NONE,
                    weeklyDays: wizardData.weeklyDays,
                    priority: PRIORITY.NORMAL,
                    travelMins: 15,
                    notes: ''
                };
                if (typeof EventManager !== 'undefined' && EventManager.addEvent) {
                    await EventManager.addEvent(eventData);
                } else {
                    await addRecord(STORES.EVENTS, eventData);
                    await refreshEvents?.();
                }
            }
            
            // 3. Save settings
            await setSetting('restPolicy', wizardData.restPolicy);
            await setSetting('farMinutes', wizardData.farMinutes);
            await setSetting('notifyDayBefore', wizardData.notifyDayBefore);
            await setSetting('notifyMinutesBefore', wizardData.notifyMinutesBefore);
            await setSetting('wizardComplete', true);
            
            // 4. Request notification permission if not already and user agreed
            if (wizardData.notificationsGranted && Notification.permission === 'default') {
                await Notification.requestPermission();
            }
            
            // 5. Clear wizard draft
            if (wizardDraftManager) await wizardDraftManager.clearDraft();
            
            // 6. Show main app
            const wizardOverlay = document.getElementById('wizardOverlay');
            const mainApp = document.getElementById('mainApp');
            const fab = document.getElementById('fab');
            if (wizardOverlay) wizardOverlay.classList.add('hidden');
            if (mainApp) {
                mainApp.classList.remove('hidden');
                mainApp.style.animation = 'fadeInUp 0.4s ease';
                setTimeout(() => mainApp.style.animation = '', 500);
            }
            if (fab) fab.classList.remove('hidden');
            
            // 7. Refresh data and scroll to now
            if (typeof fullRefresh === 'function') await fullRefresh();
            if (typeof scrollToNow === 'function') scrollToNow();
            showToast('Setup complete! 🎉', 'success');
            
            // Optional: run initial optimizer
            if (typeof Scheduler !== 'undefined' && Scheduler.run) {
                setTimeout(() => Scheduler.run(), 500);
            }
        } catch (err) {
            console.error('Finish wizard error:', err);
            showToast('Setup failed: ' + err.message, 'error');
        }
    }
    
    // ========== PUBLIC API ==========
    return {
        /**
         * Show the wizard overlay, hide main app, reset step to 1, and render.
         */
        show() {
            wizardOverlay = document.getElementById('wizardOverlay');
            mainApp = document.getElementById('mainApp');
            fab = document.getElementById('fab');
            if (!wizardOverlay) return;
            wizardOverlay.classList.remove('hidden');
            if (mainApp) mainApp.classList.add('hidden');
            if (fab) fab.classList.add('hidden');
            wizardStep = 1;
            renderWizardStep();
            
            // Create draft manager if not exists
            if (!wizardDraftManager && typeof FormDraft !== 'undefined') {
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
    };
})();

// Make Wizard globally available (keeping the original showWizard function for compatibility)
window.Wizard = Wizard;
window.showWizard = function() {
    Wizard.show();
};
