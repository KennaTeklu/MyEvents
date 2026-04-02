/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
/*
 * travelBuddy.js – Real-time transit assistant.
 * Monitors upcoming events, current GPS, and traffic to suggest leaving times.
 * Must be loaded after locationManager.js
 */

const TravelBuddy = (function() {
    let trackingInterval = null;

    async function evaluateNextTrip() {
        if (!currentLocation.lat || !currentLocation.lon) return;
        
        const now = new Date();
        const todayStr = formatDate(now);
        const upcomingEvents = getDisplayEventsForDate(todayStr).filter(e => {
            const startMin = toMinutes(e.startTime);
            const nowMin = now.getHours() * 60 + now.getMinutes();
            return startMin > nowMin && startMin < nowMin + 120; // Within next 2 hours
        });

        if (upcomingEvents.length === 0) return;
        const nextEvent = upcomingEvents[0];
        if (!nextEvent.placeId) return;
        
        const travelMins = await LocationManager.getTravelTime(currentPlaceId, nextEvent.placeId, userSettings.travelSpeed);
        const startMin = toMinutes(nextEvent.startTime);
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const bufferMins = userSettings.notifyTravelLead || 5;

        if (nowMin >= (startMin - travelMins - bufferMins) && nowMin < startMin) {
            const key = `travel_${nextEvent.id}_${todayStr}`;
            if (!shownNotifications.has(key)) {
                const msg = `Time to leave for ${nextEvent.name}! Travel takes ~${travelMins} mins (${userSettings.travelSpeed}).`;
                if (typeof fireNotification === 'function') {
                    fireNotification(msg, nextEvent, key, 'location');
                }
                if (typeof ConversationLog !== 'undefined') {
                    await ConversationLog.addMessage('assistant', `🚗 **Travel Alert:** ${msg}`, 'alert');
                }
                shownNotifications.add(key);
            }
        }
    }

    return {
        start() {
            if (trackingInterval) clearInterval(trackingInterval);
            trackingInterval = setInterval(evaluateNextTrip, 120000);
            console.log('TravelBuddy started');
        },
        stop() {
            if (trackingInterval) clearInterval(trackingInterval);
        }
    };
})();

window.TravelBuddy = TravelBuddy;