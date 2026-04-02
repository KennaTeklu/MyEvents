/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// todoManager.js - Centralized to‑do management
// Handles CRUD operations, due date handling, recurrence, completion, and search.
// Must be loaded after db.js, constants.js, and state.js (for todos array)

const TodoManager = (function() {
    // ========== PRIVATE HELPERS ==========
    
    // Validate to‑do data
    function validateTodo(todo) {
        const errors = [];
        if (!todo.name || typeof todo.name !== 'string' || todo.name.trim() === '') {
            errors.push('To‑do name is required');
        }
        if (todo.priority && (todo.priority < 1 || todo.priority > 5)) {
            errors.push('Priority must be between 1 and 5');
        }
        if (todo.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(todo.dueDate)) {
            errors.push('Due date must be in YYYY-MM-DD format');
        }
        if (todo.recurrence && !['none', 'daily', 'weekly', 'monthly'].includes(todo.recurrence)) {
            errors.push('Invalid recurrence type');
        }
        return errors;
    }
    
    // Sanitize to‑do for storage
    function sanitizeTodo(todo) {
        return {
            id: todo.id || undefined,
            name: todo.name?.trim() || '',
            dueDate: todo.dueDate || null,
            priority: todo.priority || 3,
            notes: todo.notes || '',
            recurrence: todo.recurrence || 'none',
            completed: todo.completed || false,
            completedAt: todo.completedAt || null,
            createdAt: todo.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }
    
    // Refresh global todos array from DB
    async function refreshTodos() {
        const fresh = await getAll(STORES.TODOS);
        todos.length = 0;
        todos.push(...fresh);
    }
    
    // Helper to get next occurrence date for recurring todos
    function getNextOccurrence(currentDueDate, recurrence, fromDate = new Date()) {
        if (!currentDueDate) return null;
        const due = new Date(currentDueDate + 'T12:00:00');
        if (due > fromDate) return due;
        const from = new Date(fromDate);
        from.setHours(12, 0, 0);
        
        if (recurrence === 'daily') {
            const next = new Date(due);
            while (next <= from) next.setDate(next.getDate() + 1);
            return next;
        } else if (recurrence === 'weekly') {
            const next = new Date(due);
            while (next <= from) next.setDate(next.getDate() + 7);
            return next;
        } else if (recurrence === 'monthly') {
            const next = new Date(due);
            while (next <= from) next.setMonth(next.getMonth() + 1);
            return next;
        }
        return null;
    }
    
    // ========== PUBLIC API ==========
    return {
        /**
         * Add a new to‑do.
         * @param {Object} todoData
         * @returns {Promise<number>} New to‑do ID.
         */
        async addTodo(todoData) {
            const sanitized = sanitizeTodo(todoData);
            const errors = validateTodo(sanitized);
            if (errors.length) {
                throw new Error(`Validation failed: ${errors.join(', ')}`);
            }
            const id = await addRecord(STORES.TODOS, sanitized);
            await refreshTodos();
            return id;
        },
        
        /**
         * Update an existing to‑do.
         * @param {number} todoId
         * @param {Object} todoData
         * @returns {Promise<void>}
         */
        async updateTodo(todoId, todoData) {
            const existing = todos.find(t => t.id === todoId);
            if (!existing) throw new Error(`To‑do with ID ${todoId} not found`);
            const updated = sanitizeTodo({ ...existing, ...todoData, id: todoId });
            const errors = validateTodo(updated);
            if (errors.length) {
                throw new Error(`Validation failed: ${errors.join(', ')}`);
            }
            await putRecord(STORES.TODOS, updated);
            await refreshTodos();
        },
        
        /**
         * Delete a to‑do.
         * @param {number} todoId
         * @returns {Promise<void>}
         */
        async deleteTodo(todoId) {
            await deleteRecord(STORES.TODOS, todoId);
            await refreshTodos();
        },
        
        /**
         * Mark a to‑do as completed.
         * @param {number} todoId
         * @returns {Promise<void>}
         */
        async completeTodo(todoId) {
            const todo = todos.find(t => t.id === todoId);
            if (!todo) throw new Error(`To‑do with ID ${todoId} not found`);
            if (todo.completed) return;
            const updated = {
                ...todo,
                completed: true,
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            await putRecord(STORES.TODOS, updated);
            await refreshTodos();
            
            // If the todo has recurrence, create a new instance
            if (todo.recurrence !== 'none') {
                const nextDue = getNextOccurrence(todo.dueDate, todo.recurrence);
                if (nextDue) {
                    const newTodo = {
                        name: todo.name,
                        dueDate: formatDate(nextDue),
                        priority: todo.priority,
                        notes: todo.notes,
                        recurrence: todo.recurrence,
                        completed: false,
                        createdAt: new Date().toISOString()
                    };
                    await this.addTodo(newTodo);
                }
            }
        },
        
        /**
         * Get a to‑do by ID.
         * @param {number} todoId
         * @returns {Object|null}
         */
        getTodoById(todoId) {
            return todos.find(t => t.id === todoId) || null;
        },
        
        /**
         * Get all to‑dos.
         * @returns {Array}
         */
        getAllTodos() {
            return [...todos];
        },
        
        /**
         * Get to‑dos due on a specific date.
         * @param {string} dateStr YYYY-MM-DD
         * @param {boolean} includeCompleted
         * @returns {Array}
         */
        getTodosForDate(dateStr, includeCompleted = false) {
            return todos.filter(t => {
                if (!t.dueDate) return false;
                if (!includeCompleted && t.completed) return false;
                return t.dueDate === dateStr;
            });
        },
        
        /**
         * Get to‑dos due within the next `daysAhead` days.
         * @param {number} daysAhead
         * @param {boolean} includeCompleted
         * @returns {Array}
         */
        getTodosDueSoon(daysAhead = 3, includeCompleted = false) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const future = new Date(today);
            future.setDate(today.getDate() + daysAhead);
            
            return todos.filter(t => {
                if (!t.dueDate) return false;
                if (!includeCompleted && t.completed) return false;
                const due = new Date(t.dueDate + 'T12:00:00');
                return due >= today && due <= future;
            }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        },
        
        /**
         * Get overdue to‑dos (due before today).
         * @param {boolean} includeCompleted
         * @returns {Array}
         */
        getOverdueTodos(includeCompleted = false) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return todos.filter(t => {
                if (!t.dueDate) return false;
                if (!includeCompleted && t.completed) return false;
                const due = new Date(t.dueDate + 'T12:00:00');
                return due < today;
            }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        },
        
        /**
         * Search to‑dos by name, notes, or tags.
         * @param {string} query
         * @param {Object} filters - { priority, completed, dueBefore, dueAfter }
         * @returns {Array}
         */
        searchTodos(query, filters = {}) {
            let results = [...todos];
            
            if (query && query.trim()) {
                const q = query.toLowerCase().trim();
                results = results.filter(t => 
                    t.name.toLowerCase().includes(q) ||
                    (t.notes && t.notes.toLowerCase().includes(q))
                );
            }
            
            if (filters.priority !== undefined) {
                results = results.filter(t => t.priority === filters.priority);
            }
            if (filters.completed !== undefined) {
                results = results.filter(t => t.completed === filters.completed);
            }
            if (filters.dueBefore) {
                const dueBefore = new Date(filters.dueBefore + 'T12:00:00');
                results = results.filter(t => t.dueDate && new Date(t.dueDate + 'T12:00:00') <= dueBefore);
            }
            if (filters.dueAfter) {
                const dueAfter = new Date(filters.dueAfter + 'T12:00:00');
                results = results.filter(t => t.dueDate && new Date(t.dueDate + 'T12:00:00') >= dueAfter);
            }
            
            return results;
        },
        
        /**
         * Get count of incomplete to‑dos (for badge).
         * @returns {number}
         */
        getIncompleteCount() {
            return todos.filter(t => !t.completed).length;
        },
        
        /**
         * Validate to‑do data.
         * @param {Object} todoData
         * @returns {string[]}
         */
        validateTodo(todoData) {
            return validateTodo(sanitizeTodo(todoData));
        }
    };
})();

// Make TodoManager globally available
window.TodoManager = TodoManager;
