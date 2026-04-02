/*
 * templateEngine.js – Generates natural language messages from templates and data.
 * Uses a combinatorial grammar system with slots, synonyms, and tone variants.
 * Must be loaded after constants.js, conversationLog.js
 */

const TemplateEngine = (function() {
    // ========== TEMPLATE LIBRARY ==========
    const TEMPLATES = {
        // When an event is moved due to conflict
        move_event: {
            formal: [
                "I have moved your {event} from {oldTime} to {newTime} because {reason}.",
                "Due to {reason}, your {event} has been rescheduled from {oldTime} to {newTime}."
            ],
            casual: [
                "Hey, I moved your {event} from {oldTime} to {newTime} because {reason}.",
                "Your {event} is now at {newTime} instead of {oldTime} – {reason}."
            ],
            friendly: [
                "I've shifted your {event} from {oldTime} to {newTime} – hope that works! Reason: {reason}.",
                "To make room, I moved your {event} to {newTime}. (Originally {oldTime} because {reason})"
            ]
        },
        // Suggest filling a free slot with a to‑do
        suggest_task: {
            formal: [
                "You have a {duration}-minute free slot at {time}. Would you like to schedule {task} there?",
                "I noticed a free period of {duration} minutes at {time}. Shall I place your {task} there?"
            ],
            casual: [
                "Free for {duration} minutes at {time}. Want to do {task} then?",
                "Hey, you've got {duration} free at {time}. Should I add {task}?"
            ],
            friendly: [
                "Looks like you have a {duration}-minute gap at {time}. Fancy knocking out {task}?",
                "You're free at {time} for {duration} minutes. Perfect time for {task} – want me to schedule it?"
            ]
        },
        // Daily briefing
        daily_briefing: {
            formal: [
                "Good morning. Here is your schedule for {date}:\n{events}\n{changes}\n{suggestions}",
                "Your briefing for {date}:\n{events}\nAutomatic changes:\n{changes}\nRecommendations:\n{suggestions}"
            ],
            casual: [
                "Morning! Today's plan:\n{events}\nChanges:\n{changes}\nIdeas:\n{suggestions}",
                "Hey, here's what's happening today:\n{events}\nI made some changes:\n{changes}\nAlso:\n{suggestions}"
            ],
            friendly: [
                "Good morning! Ready for {date}?\n\nYour events:\n{events}\n\nI adjusted a few things:\n{changes}\n\nBy the way:\n{suggestions}",
                "Rise and shine! Here's your {date} schedule:\n{events}\n\nChanges I made:\n{changes}\n\nSuggestions:\n{suggestions}"
            ]
        },
        // Conflict resolution
        conflict_resolution: {
            formal: [
                "Your {eventA} conflicts with {eventB}. I have moved {lowerPriorityEvent} to {newTime}. Is that acceptable?",
                "A conflict has been resolved: {lowerPriorityEvent} moved to {newTime} to accommodate {higherPriorityEvent}."
            ],
            casual: [
                "Oops, {eventA} and {eventB} overlapped. I shifted {lowerPriorityEvent} to {newTime}. Okay?",
                "Moved {lowerPriorityEvent} to {newTime} because {eventA} and {eventB} clashed."
            ],
            friendly: [
                "Heads up – your {eventA} and {eventB} were at the same time. I've moved {lowerPriorityEvent} to {newTime}. Sound good?",
                "To avoid a clash, I rescheduled {lowerPriorityEvent} to {newTime}. Let me know if that works!"
            ]
        },
        // Free moment found
        free_moment: {
            formal: [
                "You have {duration} minutes of unexpected free time at {time}. Would you like to {action}?",
                "An opening has appeared: {duration} minutes at {time}. Suggest using it for {action}."
            ],
            casual: [
                "Hey, you've got {duration} free right now at {time}. Want to {action}?",
                "Free for {duration} minutes at {time}. How about {action}?"
            ],
            friendly: [
                "You've got a {duration}-minute gap at {time}. Perfect chance to {action} – want me to schedule it?",
                "Surprise! You're free at {time} for {duration} minutes. Fancy {action}?"
            ]
        }
    };

    // Synonyms for common words (to add variety)
    const SYNONYMS = {
        moved: ['rescheduled', 'shifted', 'adjusted', 'relocated', 'moved'],
        because: ['since', 'as', 'due to', 'because of'],
        free: ['available', 'open', 'empty'],
        schedule: ['plan', 'arrange', 'set', 'book'],
        task: ['to‑do', 'item', 'activity', 'chore']
    };

    // ========== PRIVATE HELPERS ==========
    function substituteSynonyms(text, tone) {
        // Randomly replace some words with synonyms (30% chance per word)
        let result = text;
        for (const [word, syns] of Object.entries(SYNONYMS)) {
            if (Math.random() < 0.3 && result.includes(word)) {
                const synonym = syns[Math.floor(Math.random() * syns.length)];
                result = result.replace(new RegExp(`\\b${word}\\b`, 'g'), synonym);
            }
        }
        return result;
    }

    function fillTemplate(template, slots) {
        let result = template;
        for (const [key, value] of Object.entries(slots)) {
            result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }
        return result;
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Generate a message for a given intention.
         * @param {string} intention - One of the keys in TEMPLATES.
         * @param {Object} slots - Key-value pairs to fill in the template.
         * @param {string} tone - 'formal', 'casual', or 'friendly'. Defaults to userSettings.assistantTone or 'casual'.
         * @returns {string} Generated message.
         */
        generate(intention, slots, tone = null) {
            const selectedTone = tone || userSettings.assistantTone || 'casual';
            const templates = TEMPLATES[intention];
            if (!templates) {
                console.warn(`No template for intention: ${intention}`);
                return `I wanted to tell you about ${intention}, but I couldn't find the words.`;
            }
            const toneTemplates = templates[selectedTone];
            if (!toneTemplates) {
                // fallback to formal if tone missing
                const fallback = templates.formal;
                if (!fallback) return `No template for intention: ${intention} with tone ${selectedTone}`;
                let template = fallback[Math.floor(Math.random() * fallback.length)];
                template = fillTemplate(template, slots);
                return substituteSynonyms(template, selectedTone);
            }
            let template = toneTemplates[Math.floor(Math.random() * toneTemplates.length)];
            template = fillTemplate(template, slots);
            return substituteSynonyms(template, selectedTone);
        },

        /**
         * Add a custom template (for plugins or user-defined).
         * @param {string} intention
         * @param {string} tone
         * @param {string} template
         */
        addTemplate(intention, tone, template) {
            if (!TEMPLATES[intention]) TEMPLATES[intention] = {};
            if (!TEMPLATES[intention][tone]) TEMPLATES[intention][tone] = [];
            TEMPLATES[intention][tone].push(template);
        },

        /**
         * Get all available intentions.
         */
        getIntentions() {
            return Object.keys(TEMPLATES);
        }
    };
})();

// Make globally available
window.TemplateEngine = TemplateEngine;