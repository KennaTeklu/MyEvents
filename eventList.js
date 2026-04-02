/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// eventList.js - Modal for searching, filtering, and marking attendance on events
// Must be loaded after eventManager.js, db.js, constants.js

const EventList = (function() {
    // ========== PRIVATE VARIABLES ==========
    let modal = null;
    let container = null;
    let searchInput = null;
    let filterSelect = null;
    let listContainer = null;
    let currentEvents = [];
    
    // ========== PRIVATE HELPERS ==========
    
    // Inject modal HTML if not already in the DOM
    function ensureModalExists() {
        if (document.getElementById('eventListModal')) return;
        
        const modalHtml = `
            <div id="eventListModal" class="modal-backdrop hidden" data-closeable="true">
                <div class="modal-card" style="max-width: 600px;">
                    <div class="modal-header">
                        <h3 class="modal-title">📋 All Events</h3>
                        <button class="modal-close" id="closeEventListModal">&times;</button>
                    </div>
                    <div class="space-y-3">
                        <div class="flex gap-2">
                            <input type="text" id="eventListSearch" placeholder="Search events..." class="form-input flex-1">
                            <select id="eventListFilter" class="form-select w-40">
                                <option value="all">All events</option>
                                <option value="recurring">Recurring</option>
                                <option value="once">Once</option>
                                <option value="attended">Attended</option>
                                <option value="upcoming">Upcoming</option>
                                <option value="past">Past</option>
                            </select>
                        </div>
                        <div id="eventListItems" class="max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                            <div class="text-center text-gray-400 text-sm py-6">Loading events...</div>
                        </div>
                        <div class="text-xs text-gray-500 text-center mt-2">
                            Click on an event to edit, or use the "Mark attended" button.
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Attach close button handler
        const closeBtn = document.getElementById('closeEventListModal');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => ModalManager.close('eventListModal'));
        }
        
        // Backdrop click close (via data-closeable already)
        const modalEl = document.getElementById('eventListModal');
        if (modalEl) {
            modalEl.addEventListener('click', (e) => {
                if (e.target === modalEl) ModalManager.close('eventListModal');
            });
        }
    }
    
    // Filter events based on search and filter type
    function getFilteredEvents() {
        let eventsList = EventManager.getAllEvents();
        const searchTerm = searchInput?.value?.toLowerCase() || '';
        const filter = filterSelect?.value || 'all';
        
        // Search by name
        if (searchTerm) {
            eventsList = eventsList.filter(ev => ev.name.toLowerCase().includes(searchTerm));
        }
        
        // Filter by recurrence type
        if (filter === 'recurring') {
            eventsList = eventsList.filter(ev => ev.repeat !== RECURRENCE.NONE);
        } else if (filter === 'once') {
            eventsList = eventsList.filter(ev => ev.repeat === RECURRENCE.NONE);
        } else if (filter === 'attended') {
            // Marked attended at least once (any date)
            eventsList = eventsList.filter(ev => attendanceLog.some(log => log.eventId === ev.id));
        } else if (filter === 'upcoming') {
            const today = formatDate(new Date());
            eventsList = eventsList.filter(ev => ev.startDate >= today);
        } else if (filter === 'past') {
            const today = formatDate(new Date());
            eventsList = eventsList.filter(ev => ev.startDate < today);
        }
        
        return eventsList;
    }
    
    // Render the event list
    async function render() {
        if (!listContainer) return;
        
        const eventsList = getFilteredEvents();
        currentEvents = eventsList;
        
        if (eventsList.length === 0) {
            listContainer.innerHTML = `
                <div class="text-center text-gray-400 text-sm py-6">
                    <i class="fas fa-calendar-alt mb-2 text-2xl"></i>
                    <p>No events found</p>
                </div>
            `;
            return;
        }
        
        listContainer.innerHTML = eventsList.map(ev => {
            const recurrenceText = EventManager.getRecurrenceText(ev);
            const priorityLabel = EventManager.getPriorityLabel(ev.priority || 3);
            const hasAttended = attendanceLog.some(log => log.eventId === ev.id);
            
            return `
                <div class="event-list-item p-3 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer" data-id="${ev.id}">
                    <div class="flex justify-between items-start">
                        <div class="flex-1">
                            <div class="font-semibold text-gray-900 dark:text-white">${escapeHtml(ev.name)}</div>
                            <div class="text-xs text-gray-500 mt-1">
                                <span class="inline-block px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 mr-2">${recurrenceText}</span>
                                <span class="inline-block px-2 py-0.5 rounded-full ${ev.priority >= 4 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}">${priorityLabel}</span>
                                ${hasAttended ? '<span class="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-700 ml-2">✓ Attended</span>' : ''}
                            </div>
                            ${ev.notes ? `<div class="text-xs text-gray-400 mt-1 truncate">${escapeHtml(ev.notes)}</div>` : ''}
                        </div>
                        <button class="mark-attended-btn text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full hover:bg-green-200 transition ml-2" data-id="${ev.id}" data-action="attend">
                            Mark attended
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        // Attach click handlers for event items (edit)
        listContainer.querySelectorAll('.event-list-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Don't trigger if clicking the attend button
                if (e.target.closest('.mark-attended-btn')) return;
                const id = parseInt(item.dataset.id);
                const ev = EventManager.getEventById(id);
                if (ev && typeof openEventModal === 'function') {
                    ModalManager.close('eventListModal');
                    openEventModal(ev);
                }
            });
        });
        
        // Attach attend button handlers
        listContainer.querySelectorAll('.mark-attended-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                const ev = EventManager.getEventById(id);
                if (!ev) return;
                const todayStr = formatDate(new Date());
                // Check if already attended today
                const already = attendanceLog.some(log => log.eventId === id && log.dateStr === todayStr);
                if (!already) {
                    await addRecord(STORES.ATTENDANCE_LOG, {
                        eventId: id,
                        dateStr: todayStr,
                        timestamp: new Date().toISOString()
                    });
                    // Also record for learning
                    if (typeof UserLearning !== 'undefined' && userSettings.autoLearn) {
                        await UserLearning.recordPreference(id, todayStr, 'like', 'Marked attended from event list');
                    }
                    showToast(`Marked as attended today: ${ev.name}`, 'success');
                    // Refresh the list and also update calendar if open
                    await render();
                    if (typeof fullRefresh === 'function') fullRefresh();
                } else {
                    showToast(`Already marked attended today`, 'info');
                }
            });
        });
    }
    
    // ========== PUBLIC API ==========
    return {
        /**
         * Initialize the event list modal (ensure HTML exists, set up listeners).
         */
        init() {
            ensureModalExists();
            modal = document.getElementById('eventListModal');
            if (!modal) return;
            
            container = modal.querySelector('.modal-card');
            listContainer = document.getElementById('eventListItems');
            searchInput = document.getElementById('eventListSearch');
            filterSelect = document.getElementById('eventListFilter');
            
            if (searchInput) {
                searchInput.addEventListener('input', () => render());
            }
            if (filterSelect) {
                filterSelect.addEventListener('change', () => render());
            }
        },
        
        /**
         * Show the event list modal, refreshing the content.
         */
        show() {
            if (!modal) this.init();
            render();
            ModalManager.open('eventListModal');
        },
        
        /**
         * Refresh the event list (call after data changes).
         */
        refresh() {
            render();
        }
    };
})();

// Make EventList globally available
window.EventList = EventList;

// Also provide a global function for convenience (used in main.js)
window.showEventListModal = function() {
    EventList.show();
};

// Auto-initialize on DOM ready (if needed, but main.js may call init)
document.addEventListener('DOMContentLoaded', () => {
    EventList.init();
});
