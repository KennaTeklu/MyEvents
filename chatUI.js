/*
 * chatUI.js – Renders the chat panel and handles user interactions.
 * Must be loaded after conversationLog.js, suggestionGenerator.js, templateEngine.js
 */

const ChatUI = (function() {
    // ========== PRIVATE VARIABLES ==========
    let chatModal = null;
    let messageContainer = null;
    let inputField = null;
    let isOpen = false;

    // ========== INJECT MODAL HTML ==========
    function ensureModalExists() {
        if (document.getElementById('chatModal')) return;
        const modalHtml = `
            <div id="chatModal" class="modal-backdrop hidden" data-closeable="true">
                <div class="modal-card" style="max-width: 700px; height: 80vh; display: flex; flex-direction: column;">
                    <div class="modal-header">
                        <h3 class="modal-title">💬 Piper Assistant</h3>
                        <button class="modal-close" id="closeChatModal">&times;</button>
                    </div>
                    <div id="chatMessages" style="flex: 1; overflow-y: auto; padding: 1rem; border-bottom: 1px solid var(--color-border);">
                        <div class="text-center text-gray-400 text-sm py-6">Loading conversation...</div>
                    </div>
                    <div style="padding: 1rem; display: flex; gap: 0.5rem;">
                        <input type="text" id="chatInput" placeholder="Type a message or command..." class="form-input flex-1">
                        <button id="chatSendBtn" class="px-4 py-2 bg-blue-600 text-white rounded-full">Send</button>
                    </div>
                    <div class="text-xs text-gray-400 text-center py-2">
                        Try: "move gym to tomorrow 7 AM", "add meeting with John at 2 PM", "what's my schedule?"
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        const closeBtn = document.getElementById('closeChatModal');
        if (closeBtn) closeBtn.addEventListener('click', () => ChatUI.close());
        const modal = document.getElementById('chatModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) ChatUI.close();
            });
        }
        const sendBtn = document.getElementById('chatSendBtn');
        if (sendBtn) sendBtn.addEventListener('click', () => sendMessage());
        inputField = document.getElementById('chatInput');
        if (inputField) inputField.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    }

    async function sendMessage() {
        if (!inputField) return;
        const text = inputField.value.trim();
        if (!text) return;
        inputField.value = '';
        
        // Add user message to log
        await ConversationLog.addMessage('user', text, 'command');
        renderMessages();
        
        // Process command (simple parser)
        if (typeof CommandParser !== 'undefined') {
            await CommandParser.parse(text);
        } else {
            // Fallback: just echo
            await ConversationLog.addMessage('assistant', `I heard: "${text}". Command parser not loaded.`, 'system');
            renderMessages();
        }
    }

    async function renderMessages() {
        if (!messageContainer) return;
        const messages = await ConversationLog.getMessages(200);
        if (messages.length === 0) {
            messageContainer.innerHTML = '<div class="text-center text-gray-400 text-sm py-6">No messages yet. Start a conversation!</div>';
            return;
        }
        messageContainer.innerHTML = messages.map(msg => {
            const isUser = msg.role === 'user';
            const time = new Date(msg.timestamp).toLocaleTimeString();
            let actionButtons = '';
            if (msg.role === 'assistant' && msg.status === 'delivered' && msg.type === 'suggestion') {
                const suggestionKey = msg.metadata?.suggestionId;
                if (suggestionKey) {
                    actionButtons = `
                        <div class="flex gap-2 mt-2">
                            <button class="suggest-accept text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full" data-key="${suggestionKey}">Accept</button>
                            <button class="suggest-reject text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full" data-key="${suggestionKey}">Reject</button>
                        </div>
                    `;
                }
            }
            return `
                <div class="chat-message ${isUser ? 'user' : 'assistant'} mb-3 ${isUser ? 'text-right' : 'text-left'}">
                    <div class="inline-block max-w-[80%] p-3 rounded-lg ${isUser ? 'bg-blue-100 dark:bg-blue-900' : 'bg-gray-100 dark:bg-gray-700'}">
                        <div class="text-sm">${escapeHtml(msg.text)}</div>
                        <div class="text-xs text-gray-400 mt-1">${time}</div>
                        ${actionButtons}
                    </div>
                </div>
            `;
        }).join('');
        
        // Attach event listeners for accept/reject buttons
        messageContainer.querySelectorAll('.suggest-accept').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const key = btn.dataset.key;
                if (key && typeof SuggestionGenerator !== 'undefined') {
                    await SuggestionGenerator.respondToSuggestion(key, true);
                    await renderMessages();
                }
            });
        });
        messageContainer.querySelectorAll('.suggest-reject').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const key = btn.dataset.key;
                if (key && typeof SuggestionGenerator !== 'undefined') {
                    await SuggestionGenerator.respondToSuggestion(key, false);
                    await renderMessages();
                }
            });
        });
        
        // Scroll to bottom
        messageContainer.scrollTop = messageContainer.scrollHeight;
    }

    // ========== PUBLIC API ==========
    return {
        init() {
            ensureModalExists();
            chatModal = document.getElementById('chatModal');
            messageContainer = document.getElementById('chatMessages');
            inputField = document.getElementById('chatInput');
            if (messageContainer) renderMessages();
            
            // Listen for new conversation events
            if (typeof onEvent === 'function') {
                onEvent('conversation:new', () => renderMessages());
                onEvent('suggestions:updated', () => {
                    // Update badge on chat button
                    const badge = document.getElementById('chatBadge');
                    if (badge) {
                        const count = SuggestionGenerator?.getPendingSuggestions().length || 0;
                        badge.textContent = count;
                        badge.classList.toggle('hidden', count === 0);
                    }
                });
            }
        },
        open() {
            if (!chatModal) this.init();
            chatModal.classList.remove('hidden');
            isOpen = true;
            renderMessages();
        },
        close() {
            if (chatModal) chatModal.classList.add('hidden');
            isOpen = false;
        },
        toggle() {
            if (isOpen) this.close();
            else this.open();
        }
    };
})();

// Make globally available
window.ChatUI = ChatUI;