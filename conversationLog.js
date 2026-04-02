/*
 * conversationLog.js – Persistent storage for assistant-user chat history
 * Provides CRUD operations for conversation messages, with status tracking.
 * Must be loaded after db.js, constants.js
 */

const ConversationLog = (function() {
    // ========== PRIVATE HELPERS ==========
    async function refreshLog() {
        // Not used globally; we'll fetch on demand.
        // But we could keep an in-memory cache if needed.
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Add a new message to the conversation log.
         * @param {string} role - 'user' or 'assistant'
         * @param {string} text - Message content
         * @param {string} type - 'suggestion', 'alert', 'digest', 'command', 'reply'
         * @param {Object} metadata - Optional: eventId, suggestionId, action, etc.
         * @returns {Promise<number>} Message ID
         */
        async addMessage(role, text, type = 'reply', metadata = {}) {
            const message = {
                role,
                text,
                type,
                timestamp: new Date().toISOString(),
                status: 'delivered', // delivered, read, pending, snoozed
                metadata: metadata || {},
                read: false
            };
            const id = await addRecord(STORES.CONVERSATION_LOG, message);
            // Emit event for UI update
            if (typeof emitEvent === 'function') {
                emitEvent('conversation:new', { id, message });
            }
            return id;
        },

        /**
         * Get all conversation messages, sorted by timestamp (oldest first).
         * @param {number} limit - Max number of messages (default 100)
         * @param {number} offset - Pagination offset
         * @returns {Promise<Array>}
         */
        async getMessages(limit = 100, offset = 0) {
            const all = await getAll(STORES.CONVERSATION_LOG);
            const sorted = all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            return sorted.slice(offset, offset + limit);
        },

        /**
         * Get only unread messages.
         * @returns {Promise<Array>}
         */
        async getUnreadMessages() {
            const all = await getAll(STORES.CONVERSATION_LOG);
            return all.filter(m => !m.read).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        },

        /**
         * Mark a message as read.
         * @param {number} messageId
         */
        async markRead(messageId) {
            const all = await getAll(STORES.CONVERSATION_LOG);
            const msg = all.find(m => m.id === messageId);
            if (msg && !msg.read) {
                msg.read = true;
                await putRecord(STORES.CONVERSATION_LOG, msg);
                if (typeof emitEvent === 'function') emitEvent('conversation:read', { id: messageId });
            }
        },

        /**
         * Mark all messages as read.
         */
        async markAllRead() {
            const all = await getAll(STORES.CONVERSATION_LOG);
            for (const msg of all) {
                if (!msg.read) {
                    msg.read = true;
                    await putRecord(STORES.CONVERSATION_LOG, msg);
                }
            }
            if (typeof emitEvent === 'function') emitEvent('conversation:allRead', {});
        },

        /**
         * Update message status (e.g., 'pending', 'accepted', 'rejected', 'snoozed').
         * @param {number} messageId
         * @param {string} status
         */
        async updateStatus(messageId, status) {
            const all = await getAll(STORES.CONVERSATION_LOG);
            const msg = all.find(m => m.id === messageId);
            if (msg) {
                msg.status = status;
                await putRecord(STORES.CONVERSATION_LOG, msg);
                if (typeof emitEvent === 'function') emitEvent('conversation:statusChanged', { id: messageId, status });
            }
        },

        /**
         * Delete a message.
         * @param {number} messageId
         */
        async deleteMessage(messageId) {
            await deleteRecord(STORES.CONVERSATION_LOG, messageId);
            if (typeof emitEvent === 'function') emitEvent('conversation:deleted', { id: messageId });
        },

        /**
         * Clear entire conversation history.
         */
        async clearHistory() {
            await clearStore(STORES.CONVERSATION_LOG);
            if (typeof emitEvent === 'function') emitEvent('conversation:cleared', {});
        },

        /**
         * Get count of unread messages (for badge).
         * @returns {Promise<number>}
         */
        async getUnreadCount() {
            const all = await getAll(STORES.CONVERSATION_LOG);
            return all.filter(m => !m.read).length;
        }
    };
})();

// Make globally available
window.ConversationLog = ConversationLog;