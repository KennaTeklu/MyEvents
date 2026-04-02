/*
 * goalTracker.js – Decomposes user-defined goals into actionable tasks.
 * Stores goals and their sub-tasks in IndexedDB, schedules tasks as low-priority events.
 * Must be loaded after todoManager.js, eventManager.js, scheduler.js
 */

const GoalTracker = (function() {
    // ========== PRIVATE STORES ==========
    // Goals stored in a separate store 'goals'
    // Structure: { id, name, targetDate, priority, progress, createdAt, updatedAt }
    // Task templates stored with each goal

    // ========== PRIVATE HELPERS ==========
    async function ensureGoalStore() {
        // Note: The store 'goals' should be created in db.js on upgrade.
        // For safety, we'll check and create if missing (though db.js handles it).
        const db = await initDB();
        if (!db.objectStoreNames.contains('goals')) {
            // This should not happen if DB_VERSION is updated, but just in case
            console.warn('Goals store missing – please upgrade IndexedDB version');
        }
    }

    // Default task templates for common goal types
    const TASK_TEMPLATES = {
        'learn': [
            { name: 'Research learning resources', estimatedMinutes: 60, frequency: 'once' },
            { name: 'Practice for 30 minutes', estimatedMinutes: 30, frequency: 'daily' },
            { name: 'Review progress weekly', estimatedMinutes: 15, frequency: 'weekly' }
        ],
        'fitness': [
            { name: 'Workout session', estimatedMinutes: 45, frequency: 'daily' },
            { name: 'Track meals', estimatedMinutes: 10, frequency: 'daily' },
            { name: 'Weekly weigh-in', estimatedMinutes: 5, frequency: 'weekly' }
        ],
        'work': [
            { name: 'Plan next week', estimatedMinutes: 30, frequency: 'weekly' },
            { name: 'Review goals', estimatedMinutes: 15, frequency: 'daily' },
            { name: 'Deep work session', estimatedMinutes: 90, frequency: 'daily' }
        ]
    };

    // Parse goal text to detect category
    function detectGoalCategory(goalName) {
        const lower = goalName.toLowerCase();
        if (lower.includes('learn') || lower.includes('study') || lower.includes('course')) return 'learn';
        if (lower.includes('gym') || lower.includes('workout') || lower.includes('run') || lower.includes('fitness')) return 'fitness';
        if (lower.includes('work') || lower.includes('project') || lower.includes('deadline')) return 'work';
        return 'work'; // default
    }

    // Generate tasks based on goal
    function generateTasks(goalName, targetDate) {
        const category = detectGoalCategory(goalName);
        const templates = TASK_TEMPLATES[category] || TASK_TEMPLATES.work;
        const tasks = [];
        const now = new Date();
        const daysUntilTarget = Math.max(1, Math.ceil((targetDate - now) / (1000 * 60 * 60 * 24)));

        for (const tmpl of templates) {
            let dueDate = null;
            if (tmpl.frequency === 'once') {
                // Schedule one week before target, or halfway
                const offset = Math.min(7, Math.floor(daysUntilTarget / 2));
                const taskDate = new Date(targetDate);
                taskDate.setDate(targetDate.getDate() - offset);
                dueDate = taskDate;
            } else if (tmpl.frequency === 'daily') {
                // Create a recurring to-do with no fixed due date (scheduler will place daily)
                dueDate = null;
            } else if (tmpl.frequency === 'weekly') {
                // Schedule every week on the same weekday as target
                dueDate = null; // handled by recurrence
            }
            tasks.push({
                name: tmpl.name,
                estimatedMinutes: tmpl.estimatedMinutes,
                frequency: tmpl.frequency,
                dueDate: dueDate ? formatDate(dueDate) : null
            });
        }
        return tasks;
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Create a new goal.
         * @param {string} name - Goal description.
         * @param {Date|string} targetDate - Target completion date.
         * @param {number} priority - 1-5 (default 3).
         * @returns {Promise<number>} Goal ID.
         */
        async addGoal(name, targetDate, priority = 3) {
            await ensureGoalStore();
            const target = typeof targetDate === 'string' ? new Date(targetDate + 'T12:00:00') : targetDate;
            const goal = {
                name: name.trim(),
                targetDate: formatDate(target),
                priority: priority,
                progress: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            const goalId = await addRecord('goals', goal);
            
            // Generate tasks and add to to-dos
            const tasks = generateTasks(name, target);
            for (const task of tasks) {
                const todoData = {
                    name: task.name,
                    dueDate: task.dueDate,
                    priority: priority,
                    notes: `Part of goal: ${name}`,
                    recurrence: task.frequency === 'daily' ? 'daily' : (task.frequency === 'weekly' ? 'weekly' : 'none'),
                    estimatedMinutes: task.estimatedMinutes
                };
                await TodoManager.addTodo(todoData);
            }
            
            // Schedule a reminder for the goal deadline
            const reminderDate = new Date(target);
            reminderDate.setDate(reminderDate.getDate() - 1);
            const reminderEvent = {
                name: `Goal deadline: ${name}`,
                startTime: '09:00',
                endTime: '10:00',
                minStay: 60,
                maxStay: 60,
                startDate: formatDate(reminderDate),
                color: '#f59e0b',
                repeat: 'none',
                priority: 4
            };
            await EventManager.addEvent(reminderEvent);
            
            await ConversationLog.addMessage('assistant', `Goal "${name}" created with target date ${formatDateDisplay(formatDate(target))}. I've added tasks to your to‑do list and set a reminder.`, 'system');
            return goalId;
        },

        /**
         * Update goal progress.
         * @param {number} goalId
         * @param {number} progress - 0 to 100.
         */
        async updateProgress(goalId, progress) {
            const allGoals = await getAll('goals');
            const goal = allGoals.find(g => g.id === goalId);
            if (!goal) return;
            goal.progress = Math.min(100, Math.max(0, progress));
            goal.updatedAt = new Date().toISOString();
            await putRecord('goals', goal);
            
            if (progress >= 100) {
                await ConversationLog.addMessage('assistant', `Congratulations! You've completed your goal "${goal.name}". Well done!`, 'system');
            }
        },

        /**
         * Get all goals.
         * @returns {Promise<Array>}
         */
        async getAllGoals() {
            return await getAll('goals');
        },

        /**
         * Delete a goal (and optionally its associated tasks).
         * @param {number} goalId
         * @param {boolean} deleteTasks
         */
        async deleteGoal(goalId, deleteTasks = false) {
            const allGoals = await getAll('goals');
            const goal = allGoals.find(g => g.id === goalId);
            if (!goal) return;
            await deleteRecord('goals', goalId);
            if (deleteTasks) {
                const todos = TodoManager.getAllTodos();
                for (const todo of todos) {
                    if (todo.notes && todo.notes.includes(`Part of goal: ${goal.name}`)) {
                        await TodoManager.deleteTodo(todo.id);
                    }
                }
            }
            await ConversationLog.addMessage('assistant', `Goal "${goal.name}" has been deleted.`, 'system');
        },

        /**
         * Get suggested tasks for a goal without creating it (preview).
         * @param {string} goalName
         * @param {Date} targetDate
         * @returns {Array}
         */
        previewTasks(goalName, targetDate) {
            return generateTasks(goalName, targetDate);
        }
    };
})();

// Make globally available
window.GoalTracker = GoalTracker;