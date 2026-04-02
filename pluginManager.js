/*
 * pluginManager.js – Manages third‑party plugins (Slack, Zoom, Google Calendar, etc.).
 * Provides a registry for plugins and hooks into assistant events.
 * Must be loaded after eventStream.js, conversationLog.js
 */

const PluginManager = (function() {
    // ========== PRIVATE STORAGE ==========
    let plugins = new Map(); // pluginId -> plugin object
    let enabledPlugins = new Set();

    // ========== PRIVATE HELPERS ==========
    async function loadPluginsFromStorage() {
        const stored = await getAll('plugins');
        for (const p of stored) {
            plugins.set(p.id, p);
            if (p.enabled) enabledPlugins.add(p.id);
        }
    }

    async function savePluginToStorage(plugin) {
        await putRecord('plugins', plugin);
    }

    // Execute all plugins for a given hook
    async function runHook(hookName, context) {
        const results = [];
        for (const pluginId of enabledPlugins) {
            const plugin = plugins.get(pluginId);
            if (plugin && plugin.hooks && plugin.hooks[hookName]) {
                try {
                    const result = await plugin.hooks[hookName](context);
                    results.push({ pluginId, result });
                } catch (err) {
                    console.error(`Plugin ${plugin.name} error in hook ${hookName}:`, err);
                }
            }
        }
        return results;
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Register a new plugin.
         * @param {Object} plugin - { id, name, version, hooks, enabled }
         * hooks: { onEventAdded, onScheduleChanged, onDailyBriefing, onConflict, etc. }
         */
        async register(plugin) {
            if (!plugin.id || !plugin.name) throw new Error('Plugin must have id and name');
            plugins.set(plugin.id, plugin);
            if (plugin.enabled !== false) enabledPlugins.add(plugin.id);
            await savePluginToStorage(plugin);
            await ConversationLog.addMessage('assistant', `Plugin "${plugin.name}" registered.`, 'system');
        },

        /**
         * Enable a plugin.
         * @param {string} pluginId
         */
        async enable(pluginId) {
            const plugin = plugins.get(pluginId);
            if (!plugin) return;
            enabledPlugins.add(pluginId);
            plugin.enabled = true;
            await savePluginToStorage(plugin);
            await ConversationLog.addMessage('assistant', `Plugin "${plugin.name}" enabled.`, 'system');
        },

        /**
         * Disable a plugin.
         * @param {string} pluginId
         */
        async disable(pluginId) {
            const plugin = plugins.get(pluginId);
            if (!plugin) return;
            enabledPlugins.delete(pluginId);
            plugin.enabled = false;
            await savePluginToStorage(plugin);
            await ConversationLog.addMessage('assistant', `Plugin "${plugin.name}" disabled.`, 'system');
        },

        /**
         * Get all registered plugins.
         * @returns {Array}
         */
        getAllPlugins() {
            return Array.from(plugins.values());
        },

        /**
         * Trigger hooks (called by the assistant engine).
         * These are internal and not meant for direct UI use.
         */
        hooks: {
            async onEventAdded(event) {
                return await runHook('onEventAdded', { event });
            },
            async onScheduleChanged(schedule) {
                return await runHook('onScheduleChanged', { schedule });
            },
            async onDailyBriefing(briefing) {
                return await runHook('onDailyBriefing', { briefing });
            },
            async onConflict(conflict) {
                return await runHook('onConflict', { conflict });
            },
            async onTodoCompleted(todo) {
                return await runHook('onTodoCompleted', { todo });
            }
        }
    };
})();

// Make globally available
window.PluginManager = PluginManager;