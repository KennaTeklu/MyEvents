/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
/*
 * chatUI.js – Intelligent Chip-Based Conversational Interface
 * Pre-filled choices avoid NLP parsing errors and guide the user intuitively.
 */

const ChatUI = (function() {
    let chatModal = null;
    let messageContainer = null;
    let chipContainer = null;
    let isOpen = false;

    // Chat State Machine Dictionary
    const CHAT_TREE = {
        home: {
            msg: "Hi! How can I help you manage your time today?",
            options: [
                { label: "What's my next event?", action: "next_event" },
                { label: "I need to reschedule something", action: "reschedule_menu" },
                { label: "I have some free time now", action: "free_time" },
                { label: "Optimize my schedule", action: "run_optimizer" }
            ]
        },
        next_event: {
            action: async () => {
                const now = new Date();
                const todayStr = formatDate(now);
                const nowMin = now.getHours() * 60 + now.getMinutes();
                const upcoming = getDisplayEventsForDate(todayStr).filter(e => toMinutes(e.startTime) >= nowMin);
                if (upcoming.length > 0) {
                    const ev = upcoming[0];
                    return { 
                        msg: `Your next event is **${ev.name}** at ${formatTime(toMinutes(ev.startTime))}.`,
                        options: [
                            { label: "I need to skip this", action: "skip_next", data: ev },
                            { label: "Great, thanks!", action: "home" }
                        ]
                    };
                } else {
                    return { msg: "You have no more events today. Time to relax!", options: [{ label: "Back to Home", action: "home" }] };
                }
            }
        },
        skip_next: {
            action: async (ev) => {
                await EventManager.applyOverride(ev.id, formatDate(new Date()), 'nogo');
                if(typeof runOptimizer === 'function') runOptimizer();
                return {
                    msg: `Got it. I've skipped "${ev.name}" for today and adjusting the rest of your schedule.`,
                    options: [{ label: "Awesome", action: "home" }]
                };
            }
        },
        free_time: {
            action: async () => {
                const todosList = todos.filter(t => !t.completed).slice(0,3);
                if(todosList.length > 0) {
                    const opts = todosList.map(t => ({ label: `Do: ${t.name}`, action: "do_todo", data: t.id }));
                    opts.push({ label: "I just want to rest", action: "home" });
                    return {
                        msg: "Perfect! You can knock out a quick To-Do. Which one?",
                        options: opts
                    };
                }
                return { msg: "Enjoy your free time! Your to-do list is clear.", options: [{ label: "Back to Home", action: "home" }] };
            }
        },
        do_todo: {
            action: async (todoId) => {
                await TodoManager.completeTodo(todoId);
                return {
                    msg: "Done! Marked that task as complete. Great job being productive.",
                    options: [{ label: "What else?", action: "free_time" }, { label: "I'm done", action: "home" }]
                };
            }
        },
        run_optimizer: {
            action: async () => {
                if(typeof runOptimizer === 'function') {
                    showToast('Running Optimizer...', 'info');
                    await runOptimizer();
                    return { msg: "I've re-optimized your schedule based on your priorities and constraints!", options: [{ label: "Thanks!", action: "home" }] };
                }
                return { msg: "Optimizer is unavailable right now.", options: [{ label: "Okay", action: "home" }] };
            }
        },
        reschedule_menu: {
            msg: "Which type of item do you need to adjust?",
            options: [
                { label: "An Event", action: "trigger_ui", data: "eventList" },
                { label: "A Busy Block", action: "trigger_ui", data: "settings" },
                { label: "Nevermind", action: "home" }
            ]
        },
        trigger_ui: {
            action: async (uiTarget) => {
                setTimeout(() => {
                    ChatUI.close();
                    if(uiTarget === 'eventList') showEventListModal();
                    if(uiTarget === 'settings' && typeof document.getElementById('settingsBtn')?.click === 'function') document.getElementById('settingsBtn').click();
                }, 300);
                return { msg: "Opening that for you right now.", options: [{ label: "Home", action: "home" }] };
            }
        }
    };

    function ensureModalExists() {
        if (document.getElementById('chatModal')) return;
        const modalHtml = `
            <div id="chatModal" class="modal-backdrop hidden" data-closeable="true" style="z-index: 9000;">
                <div class="modal-card bg-gray-50 dark:bg-gray-900" style="max-width: 500px; height: 85vh; display: flex; flex-direction: column; padding: 0;">
                    
                    <div class="bg-blue-600 text-white p-4 flex justify-between items-center rounded-t-xl shrink-0 shadow-md z-10">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 bg-white rounded-full flex items-center justify-center text-blue-600 text-xl shadow-inner">
                                <i class="fas fa-robot"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-lg leading-tight">Piper Assistant</h3>
                                <p class="text-xs text-blue-200">Always ready to help</p>
                            </div>
                        </div>
                        <button class="modal-close w-8 h-8 flex items-center justify-center rounded-full bg-blue-700 hover:bg-blue-800 transition" id="closeChatModal"><i class="fas fa-times"></i></button>
                    </div>

                    <div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-4" style="scroll-behavior: smooth;">
                        <!-- Messages go here -->
                    </div>

                    <div class="bg-white dark:bg-gray-800 p-4 border-t border-gray-200 dark:border-gray-700 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] rounded-b-xl">
                        <p class="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-3">Suggested Responses</p>
                        <div id="chatChips" class="flex flex-wrap gap-2">
                            <!-- Chips go here -->
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    async function appendMessage(sender, text) {
        if (!messageContainer) return;
        const isUser = sender === 'user';
        const msgDiv = document.createElement('div');
        msgDiv.className = `flex w-full ${isUser ? 'justify-end' : 'justify-start'}`;
        
        // Simple markdown parsing for bolding
        const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        msgDiv.innerHTML = `
            <div class="max-w-[85%] p-3 rounded-2xl text-sm shadow-sm ${
                isUser 
                ? 'bg-blue-600 text-white rounded-br-sm' 
                : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-bl-sm'
            }">
                ${formattedText}
            </div>
        `;
        messageContainer.appendChild(msgDiv);
        messageContainer.scrollTop = messageContainer.scrollHeight;
    }

    async function loadNode(nodeKey, actionData = null) {
        if (!chipContainer) return;
        chipContainer.innerHTML = ''; // clear old chips
        
        const node = CHAT_TREE[nodeKey];
        if (!node) return;

        let msgText = node.msg;
        let options = node.options || [];

        if (node.action) {
            // It's a dynamic node
            const result = await node.action(actionData);
            msgText = result.msg;
            options = result.options || [];
        }

        if (msgText) await appendMessage('assistant', msgText);

        // Render chips
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-full text-sm font-medium transition-all transform active:scale-95 shadow-sm';
            btn.innerText = opt.label;
            btn.onclick = async () => {
                await appendMessage('user', opt.label);
                chipContainer.innerHTML = '<div class="text-xs text-gray-400 italic py-2"><i class="fas fa-circle-notch fa-spin"></i> Piper is thinking...</div>';
                setTimeout(() => loadNode(opt.action, opt.data), 400); // Artificial delay for natural feel
            };
            chipContainer.appendChild(btn);
        });
    }

    return {
        init() {
            ensureModalExists();
            chatModal = document.getElementById('chatModal');
            messageContainer = document.getElementById('chatMessages');
            chipContainer = document.getElementById('chatChips');
            
            // Initialize with root node
            messageContainer.innerHTML = '';
            loadNode('home');
        },
        open() {
            if (!chatModal) this.init();
            chatModal.classList.remove('hidden');
            isOpen = true;
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

window.ChatUI = ChatUI;