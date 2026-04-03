/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// todoPanel.js - Sidebar/drawer component for to‑do list management
// Must be loaded after todoManager.js, constants.js, and the DOM elements exist.

const TodoPanel = (function() {
    // ========== PRIVATE VARIABLES ==========
    let panelElement = null;
    let isOpen = false;
    let currentFilter = 'all'; // 'all', 'active', 'completed', 'overdue', 'upcoming'
    let searchQuery = '';
    let currentSort = 'due'; // 'due', 'priority', 'name'
    
    // Cache DOM elements
    let todoListContainer = null;
    let searchInput = null;
    let filterSelect = null;
    let sortSelect = null;
    
    // ========== PRIVATE HELPERS ==========
    
    // Escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);
    }
    
    // Get priority class
    function getPriorityClass(priority) {
        if (priority >= 4) return 'todo-priority-high';
        if (priority >= 3) return 'todo-priority-medium';
        return 'todo-priority-low';
    }
    
    // Format due date for display
    function formatDueDate(dueDate) {
        if (!dueDate) return 'No due date';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(dueDate + 'T12:00:00');
        const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) return 'Overdue';
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Tomorrow';
        if (diffDays <= 7) return `${diffDays} days`;
        return formatDateDisplay(dueDate);
    }
    
    // Filter and sort todos
    function getFilteredAndSortedTodos() {
        let todos = TodoManager.getAllTodos();
        
        // Apply filter
        if (currentFilter === 'active') {
            todos = todos.filter(t => !t.completed);
        } else if (currentFilter === 'completed') {
            todos = todos.filter(t => t.completed);
        } else if (currentFilter === 'overdue') {
            const today = formatDate(new Date());
            todos = todos.filter(t => !t.completed && t.dueDate && t.dueDate < today);
        } else if (currentFilter === 'upcoming') {
            const today = formatDate(new Date());
            todos = todos.filter(t => !t.completed && t.dueDate && t.dueDate >= today);
        }
        
        // Apply search
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            todos = todos.filter(t => 
                t.name.toLowerCase().includes(query) ||
                (t.notes && t.notes.toLowerCase().includes(query))
            );
        }
        
        // Apply sort
        if (currentSort === 'due') {
            todos.sort((a, b) => {
                if (!a.dueDate && !b.dueDate) return 0;
                if (!a.dueDate) return 1;
                if (!b.dueDate) return -1;
                return a.dueDate.localeCompare(b.dueDate);
            });
        } else if (currentSort === 'priority') {
            todos.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        } else if (currentSort === 'name') {
            todos.sort((a, b) => a.name.localeCompare(b.name));
        }
        
        return todos;
    }
    
    // Render the todo list
    async function render() {
        if (!todoListContainer) return;
        
        const todos = getFilteredAndSortedTodos();
        
        if (todos.length === 0) {
            todoListContainer.innerHTML = `
                <div class="text-center text-gray-400 text-sm py-6">
                    <i class="fas fa-check-circle mb-2 text-2xl"></i>
                    <p>No to‑dos found</p>
                    <p class="text-xs mt-1">Add one using the + button</p>
                </div>
            `;
            return;
        }
        
        todoListContainer.innerHTML = todos.map(todo => {
            const isOverdue = todo.dueDate && todo.dueDate < formatDate(new Date()) && !todo.completed;
            const dueDateClass = isOverdue ? 'overdue' : '';
            return `
                <div class="todo-item" data-id="${todo.id}">
                    <div class="todo-checkbox ${todo.completed ? 'checked' : ''}" data-id="${todo.id}" data-action="toggle">
                        ${todo.completed ? '<i class="fas fa-check text-white text-xs"></i>' : ''}
                    </div>
                    <div class="todo-content">
                        <div class="todo-name ${todo.completed ? 'completed' : ''}">${escapeHtml(todo.name)}</div>
                        ${todo.dueDate ? `<div class="todo-due ${dueDateClass}">📅 ${formatDueDate(todo.dueDate)}</div>` : ''}
                        ${todo.priority ? `<div class="todo-priority ${getPriorityClass(todo.priority)}">Priority ${todo.priority}</div>` : ''}
                    </div>
                    <div class="todo-actions">
                        <button class="todo-edit" data-id="${todo.id}" data-action="edit" title="Edit">✏️</button>
                        <button class="todo-delete" data-id="${todo.id}" data-action="delete" title="Delete">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');
        
        // Attach event listeners
        todoListContainer.querySelectorAll('[data-action="toggle"]').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = parseInt(el.dataset.id);
                await TodoManager.toggleTodoCompletion(id);
                await render();
                if (userSettings.showTodosInCalendar && typeof renderCalendar === 'function') renderCalendar();
            });
        });
        
        todoListContainer.querySelectorAll('[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                const todo = TodoManager.getTodoById(id);
                if (todo && typeof openTodoModal === 'function') {
                    openTodoModal(todo);
                }
            });
        });
        
        todoListContainer.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                if (confirm('Delete this to‑do?')) {
                    await TodoManager.deleteTodo(id);
                    await render();
                    if (userSettings.showTodosInCalendar && typeof renderCalendar === 'function') renderCalendar();
                }
            });
        });
    }
    
    // ========== PUBLIC API ==========
    return {
        /**
         * Initialize the todo panel: create DOM elements, attach to body, set up events.
         */
        init() {
            // Check if panel already exists
            if (panelElement) return;
            
            // Create panel HTML if not present
            let existing = document.getElementById('todoPanel');
            if (!existing) {
                const panelHtml = `
                    <div id="todoPanel" class="todo-panel hidden">
                        <div class="todo-panel-header">
                            <h3 class="font-bold">📝 To‑dos</h3>
                            <button class="todo-panel-close" id="todoPanelClose">×</button>
                        </div>
                        <div class="todo-panel-search">
                            <input type="text" id="todoSearch" placeholder="Search to‑dos..." class="w-full">
                        </div>
                        <div class="todo-panel-filters flex gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                            <select id="todoFilter" class="text-xs bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-1">
                                <option value="all">All</option>
                                <option value="active">Active</option>
                                <option value="completed">Completed</option>
                                <option value="overdue">Overdue</option>
                                <option value="upcoming">Upcoming</option>
                            </select>
                            <select id="todoSort" class="text-xs bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-1">
                                <option value="due">Sort by due date</option>
                                <option value="priority">Sort by priority</option>
                                <option value="name">Sort by name</option>
                            </select>
                        </div>
                        <div id="todoList" class="todo-list">
                            <div class="text-center text-gray-400 text-sm py-6">Loading...</div>
                        </div>
                        <div class="todo-add-btn" id="todoAddBtn">
                            <i class="fas fa-plus mr-1"></i> Add to‑do
                        </div>
                    </div>
                `;
                document.body.insertAdjacentHTML('beforeend', panelHtml);
                existing = document.getElementById('todoPanel');
            }
            
            panelElement = existing;
            todoListContainer = document.getElementById('todoList');
            searchInput = document.getElementById('todoSearch');
            filterSelect = document.getElementById('todoFilter');
            sortSelect = document.getElementById('todoSort');
            
            // Set up event listeners
            const closeBtn = document.getElementById('todoPanelClose');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.close());
            }
            
            const addBtn = document.getElementById('todoAddBtn');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    if (typeof openTodoModal === 'function') openTodoModal();
                });
            }
            
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    searchQuery = e.target.value;
                    render();
                });
            }
            
            if (filterSelect) {
                filterSelect.addEventListener('change', (e) => {
                    currentFilter = e.target.value;
                    render();
                });
            }
            
            if (sortSelect) {
                sortSelect.addEventListener('change', (e) => {
                    currentSort = e.target.value;
                    render();
                });
            }
            
            // Initial render
            render();
        },
        
        /**
         * Open the panel (slide in).
         */
        open() {
            if (!panelElement) this.init();
            panelElement.classList.remove('hidden');
            panelElement.classList.add('open');
            isOpen = true;
            render(); // refresh on open
        },
        
        /**
         * Close the panel.
         */
        close() {
            if (panelElement) {
                panelElement.classList.add('hidden');
                panelElement.classList.remove('open');
                isOpen = false;
            }
        },
        
        /**
         * Toggle panel visibility.
         */
        toggle() {
            if (isOpen) this.close();
            else this.open();
        },
        
        /**
         * Refresh the todo list (call after data changes).
         */
        refresh() {
            render();
        },
        
        /**
         * Check if panel is open.
         */
        isOpen() {
            return isOpen;
        }
    };
})();

// Make TodoPanel globally available
window.TodoPanel = TodoPanel;
