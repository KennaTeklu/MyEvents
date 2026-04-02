/*
 * notificationDigest.js – Generates daily digests (email or push) with schedule summary,
 * changes, and suggestions. Sends via email if Cloudflare Worker or AWS SES is configured.
 * Must be loaded after conversationLog.js, suggestionGenerator.js, travelBuddy.js
 */

const NotificationDigest = (function() {
    // ========== PRIVATE VARIABLES ==========
    let lastDigestDate = null;
    let digestTimer = null;
    const DIGEST_HOUR = 7; // 7 AM local time

    // ========== PRIVATE HELPERS ==========
    async function generateDigestContent() {
        const today = formatDate(new Date());
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = formatDate(tomorrow);
        
        // Today's events
        const todayEvents = getDisplayEventsForDate(today);
        const todayList = todayEvents.map(ev => `- ${formatTime(toMinutes(ev.startTime))} – ${ev.name}`).join('\n');
        
        // Tomorrow's events (brief preview)
        const tomorrowEvents = getDisplayEventsForDate(tomorrowStr);
        const tomorrowList = tomorrowEvents.slice(0, 3).map(ev => `- ${formatTime(toMinutes(ev.startTime))} – ${ev.name}`).join('\n');
        const moreTomorrow = tomorrowEvents.length > 3 ? `\n  +${tomorrowEvents.length - 3} more` : '';
        
        // Changes in the last 24 hours
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const recentOverrides = Array.from(overrides.values()).filter(ov => {
            const ovDate = new Date(ov.dateStr);
            return ovDate >= yesterday;
        });
        const changes = recentOverrides.map(ov => {
            const ev = events.find(e => e.id === ov.eventId);
            return ev ? `- ${ev.name} on ${formatDateDisplay(ov.dateStr)} moved to ${formatTime(toMinutes(ov.newEvent?.startTime || ev.startTime))}` : '';
        }).filter(Boolean).join('\n');
        const changesText = changes || 'No automatic changes.';
        
        // Pending suggestions
        const pendingSuggestions = typeof SuggestionGenerator !== 'undefined' ? SuggestionGenerator.getPendingSuggestions() : [];
        const suggestionsText = pendingSuggestions.map(s => `- ${s.message}`).join('\n') || 'No pending suggestions.';
        
        // Goals progress
        let goalsText = '';
        if (typeof GoalTracker !== 'undefined') {
            const goals = await GoalTracker.getAllGoals();
            if (goals.length) {
                goalsText = goals.map(g => `- ${g.name}: ${g.progress}% complete (due ${formatDateDisplay(g.targetDate)})`).join('\n');
            } else {
                goalsText = 'No active goals.';
            }
        }
        
        const digest = {
            subject: `Piper Digest – ${formatDateDisplay(today)}`,
            body: `Good morning,

Here is your schedule for today:
${todayList || 'No events scheduled.'}

Preview of tomorrow:
${tomorrowList || 'No events scheduled.'}${moreTomorrow}

Changes I made automatically:
${changesText}

Suggestions waiting for you:
${suggestionsText}

Goals progress:
${goalsText}

Have a productive day!
– Your Piper Assistant`
        };
        return digest;
    }

    async function sendEmailDigest(toEmail, digest) {
        // Use configured email method (Cloudflare Worker URL or AWS SES)
        const emailSettings = await getSetting('emailSettings');
        if (!emailSettings || !emailSettings.enabled) return false;
        if (emailSettings.method === 'cloudflare' && emailSettings.workerUrl) {
            try {
                const response = await fetch(emailSettings.workerUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: toEmail,
                        subject: digest.subject,
                        body: digest.body
                    })
                });
                return response.ok;
            } catch (err) {
                console.error('Cloudflare email failed:', err);
                return false;
            }
        } else if (emailSettings.method === 'ses' && emailSettings.apiEndpoint) {
            // AWS SES via shared worker – similar implementation
            try {
                const response = await fetch(emailSettings.apiEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: toEmail,
                        subject: digest.subject,
                        body: digest.body
                    })
                });
                return response.ok;
            } catch (err) {
                console.error('AWS SES email failed:', err);
                return false;
            }
        }
        return false;
    }

    async function sendPushDigest(digest) {
        // Add to conversation log as a special message
        if (typeof ConversationLog !== 'undefined') {
            await ConversationLog.addMessage('assistant', `📅 **Daily Digest**\n\n${digest.body}`, 'digest');
        }
        // Also show as toast if app is open
        showToast('New daily digest available. Check chat.', 'info');
    }

    async function runDigest() {
        const now = new Date();
        const todayStr = formatDate(now);
        if (lastDigestDate === todayStr) return;
        lastDigestDate = todayStr;
        
        const digest = await generateDigestContent();
        const emailAddress = await getSetting('userEmail');
        let emailSent = false;
        if (emailAddress) {
            emailSent = await sendEmailDigest(emailAddress, digest);
        }
        await sendPushDigest(digest);
        if (emailSent) {
            await ConversationLog.addMessage('assistant', `Daily digest also sent to ${emailAddress}.`, 'system');
        }
    }

    function scheduleDigest() {
        const now = new Date();
        const nextDigest = new Date();
        nextDigest.setHours(DIGEST_HOUR, 0, 0, 0);
        if (now >= nextDigest) nextDigest.setDate(nextDigest.getDate() + 1);
        const delay = nextDigest - now;
        if (digestTimer) clearTimeout(digestTimer);
        digestTimer = setTimeout(() => {
            runDigest();
            scheduleDigest(); // re-schedule for next day
        }, delay);
    }

    // ========== PUBLIC API ==========
    return {
        /**
         * Start the digest scheduler.
         */
        start() {
            scheduleDigest();
            console.log('NotificationDigest started');
        },
        
        /**
         * Manually trigger a digest (for testing).
         */
        async sendNow() {
            await runDigest();
        },
        
        /**
         * Update email settings.
         * @param {Object} settings - { enabled, method, workerUrl, apiEndpoint, userEmail }
         */
        async updateEmailSettings(settings) {
            await setSetting('emailSettings', settings);
            if (settings.userEmail) await setSetting('userEmail', settings.userEmail);
        }
    };
})();

// Make globally available
window.NotificationDigest = NotificationDigest;