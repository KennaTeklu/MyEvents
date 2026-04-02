/*
 * connectionMarket.js – Provides a marketplace for discovering and installing third‑party plugins.
 * Fetches a curated list of plugins from a CDN and allows one‑click installation.
 * Must be loaded after pluginManager.js
 */

const ConnectionMarket = (function() {
    // ========== PRIVATE CONSTANTS ==========
    // URL for the plugin registry (can be a JSON file on GitHub or your own server)
    const PLUGIN_REGISTRY_URL = 'https://cdn.jsdelivr.net/gh/your-org/smart-scheduler-plugins/registry.json';
    // Fallback built‑in plugins list
    const FALLBACK_PLUGINS = [
        {
            id: 'slack',
            name: 'Slack Notifier',
            version: '1.0.0',
            description: 'Sends daily schedule and reminders to your Slack channel.',
            author: 'Smart Scheduler Team',
            icon: 'https://cdn.jsdelivr.net/gh/your-org/smart-scheduler-plugins/icons/slack.svg',
            scriptUrl: 'https://cdn.jsdelivr.net/gh/your-org/smart-scheduler-plugins/slack-plugin.js',
            enabled: false
        },
        {
            id: 'zoom',
            name: 'Zoom Meeting Link',
            version: '1.0.0',
            description: 'Automatically creates Zoom meeting links for scheduled events.',
            author: 'Smart Scheduler Team',
            icon: 'https://cdn.jsdelivr.net/gh/your-org/smart-scheduler-plugins/icons/zoom.svg',
            scriptUrl: 'https://cdn.jsdelivr.net/gh/your-org/smart-scheduler-plugins/zoom-plugin.js',
            enabled: false
        },
        {
            id: 'google-calendar',
            name: 'Google Calendar Sync',
            version: '1.0.0',
            description: 'Two‑way sync with Google Calendar (requires OAuth).',
            author: 'Smart Scheduler Team',
            icon: 'https://cdn.jsdelivr.net/gh/your-org/smart-scheduler-plugins/icons/google-calendar.svg',
            scriptUrl: 'https://cdn.jsdelivr.net/gh/your-org/smart-scheduler-plugins/google-calendar-plugin.js',
            enabled: false
        }
    ];

    // ========== PRIVATE HELPERS ==========
    async function fetchAvailablePlugins() {
        try {
            const response = await fetch(PLUGIN_REGISTRY_URL);
            if (!response.ok) throw new Error('Failed to fetch registry');
            const plugins = await response.json();
            return plugins;
        } catch (err) {
            console.warn('Could not fetch plugin registry, using fallback:', err);
            return FALLBACK_PLUGINS;
        }
    }

    async function loadPluginScript(scriptUrl) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = scriptUrl;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load script: ${scriptUrl}`));
            document.head.appendChild(script);
        });
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Get list of available plugins from the marketplace.
         * @returns {Promise<Array>}
         */
        async getAvailablePlugins() {
            return await fetchAvailablePlugins();
        },

        /**
         * Install a plugin from the marketplace.
         * @param {Object} pluginInfo - Plugin metadata from the registry.
         * @returns {Promise<boolean>}
         */
        async installPlugin(pluginInfo) {
            try {
                // Load the plugin script
                await loadPluginScript(pluginInfo.scriptUrl);
                // The plugin script should call PluginManager.register with its definition
                // Wait a moment for registration to complete
                await new Promise(resolve => setTimeout(resolve, 500));
                const allPlugins = PluginManager.getAllPlugins();
                const installed = allPlugins.find(p => p.id === pluginInfo.id);
                if (installed) {
                    await ConversationLog.addMessage('assistant', `Plugin "${pluginInfo.name}" installed successfully.`, 'system');
                    return true;
                }
                return false;
            } catch (err) {
                console.error('Plugin installation failed:', err);
                await ConversationLog.addMessage('assistant', `Failed to install plugin "${pluginInfo.name}": ${err.message}`, 'system');
                return false;
            }
        },

        /**
         * Uninstall a plugin (remove it from storage and disable).
         * @param {string} pluginId
         */
        async uninstallPlugin(pluginId) {
            const plugin = PluginManager.getAllPlugins().find(p => p.id === pluginId);
            if (!plugin) return;
            await PluginManager.disable(pluginId);
            // Remove from storage
            await deleteRecord('plugins', pluginId);
            await ConversationLog.addMessage('assistant', `Plugin "${plugin.name}" uninstalled.`, 'system');
        },

        /**
         * Open the marketplace UI (modal). Called from settings.
         */
        async openMarketplace() {
            const plugins = await this.getAvailablePlugins();
            const installedPlugins = PluginManager.getAllPlugins();
            const installedIds = new Set(installedPlugins.map(p => p.id));
            // Create modal dynamically (or inject HTML)
            let modal = document.getElementById('marketplaceModal');
            if (!modal) {
                const modalHtml = `
                    <div id="marketplaceModal" class="modal-backdrop hidden" data-closeable="true">
                        <div class="modal-card" style="max-width: 700px;">
                            <div class="modal-header">
                                <h3 class="modal-title">🔌 Connection Market – Plugins</h3>
                                <button class="modal-close" id="closeMarketplaceModal">&times;</button>
                            </div>
                            <div id="marketplaceList" class="space-y-3 max-h-96 overflow-y-auto">
                                <div class="text-center text-gray-400 py-6">Loading plugins...</div>
                            </div>
                            <div class="mt-4 text-xs text-gray-500 text-center">
                                Plugins extend the assistant. Install at your own risk.
                            </div>
                        </div>
                    </div>
                `;
                document.body.insertAdjacentHTML('beforeend', modalHtml);
                modal = document.getElementById('marketplaceModal');
                const closeBtn = document.getElementById('closeMarketplaceModal');
                if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
                modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
            }
            const listContainer = document.getElementById('marketplaceList');
            if (listContainer) {
                listContainer.innerHTML = plugins.map(p => `
                    <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex justify-between items-center">
                        <div>
                            <div class="font-semibold">${escapeHtml(p.name)}</div>
                            <div class="text-xs text-gray-500">${escapeHtml(p.description)} by ${escapeHtml(p.author)}</div>
                        </div>
                        <div>
                            ${installedIds.has(p.id) 
                                ? `<button class="installed-btn text-green-600 text-sm px-3 py-1 rounded-full bg-green-100" disabled>Installed</button>
                                   <button class="uninstall-btn text-red-600 text-sm px-3 py-1 rounded-full bg-red-100 ml-2" data-id="${p.id}">Uninstall</button>`
                                : `<button class="install-btn text-blue-600 text-sm px-3 py-1 rounded-full bg-blue-100" data-id="${p.id}" data-name="${p.name}" data-script="${p.scriptUrl}">Install</button>`
                            }
                        </div>
                    </div>
                `).join('');
                // Attach event listeners
                listContainer.querySelectorAll('.install-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const pluginId = btn.dataset.id;
                        const pluginName = btn.dataset.name;
                        const scriptUrl = btn.dataset.script;
                        const pluginInfo = plugins.find(p => p.id === pluginId);
                        if (pluginInfo) {
                            await this.installPlugin(pluginInfo);
                            modal.classList.add('hidden');
                            // Refresh settings UI
                            if (typeof renderPluginsList === 'function') renderPluginsList();
                        }
                    });
                });
                listContainer.querySelectorAll('.uninstall-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const pluginId = btn.dataset.id;
                        await this.uninstallPlugin(pluginId);
                        modal.classList.add('hidden');
                        if (typeof renderPluginsList === 'function') renderPluginsList();
                    });
                });
            }
            modal.classList.remove('hidden');
        }
    };
})();

// Make globally available
window.ConnectionMarket = ConnectionMarket;