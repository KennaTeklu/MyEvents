// locationManager.js - Centralized location, places, and travel time management
// Handles GPS, places, sublocations, travel time estimation, and location history.
// Must be loaded after db.js, constants.js, state.js, and userLearning.js (for travel time learning)

const LocationManager = (function() {
    // ========== PRIVATE VARIABLES ==========
    let gpsWatchId = null;
    let lastLocationUpdate = null;
    let locationUpdateDebounceTimer = null;
    
    // ========== PRIVATE HELPERS ==========
    
    // Refresh global places array from DB
    async function refreshPlaces() {
        const fresh = await getAll(STORES.PLACES);
        places.length = 0;
        places.push(...fresh);
    }
    
    // Get distance between two points in meters
    function getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    
    // Estimate travel time based on distance and mode
    function estimateTravelTime(distanceMeters, mode = 'walking') {
        const speedKmPerHour = mode === 'walking' ? 5 : 50;
        const distanceKm = distanceMeters / 1000;
        const hours = distanceKm / speedKmPerHour;
        return Math.round(hours * 60); // minutes
    }
    
    // Get learned travel time between two places from learningData
    function getLearnedTravelTime(fromPlaceId, toPlaceId) {
        if (!userSettings.autoLearn) return null;
        const learned = learningData.travelTimes?.find(t => 
            t.fromPlaceId === fromPlaceId && t.toPlaceId === toPlaceId
        );
        return learned ? learned.minutes : null;
    }
    
    // Record travel time (for learning)
    async function recordTravelTime(fromPlaceId, toPlaceId, minutes) {
        if (!userSettings.autoLearn) return;
        await addRecord(STORES.LEARNING_DATA, {
            type: 'travel',
            fromPlaceId,
            toPlaceId,
            minutes,
            timestamp: new Date().toISOString()
        });
        // Refresh learningData in state
        const allLearning = await getAll(STORES.LEARNING_DATA);
        learningData.travelTimes = allLearning.filter(l => l.type === 'travel');
    }
    
    // ========== PUBLIC API ==========
    return {
        // ========== PLACE MANAGEMENT ==========
        
        /**
         * Add a new place.
         * @param {Object} placeData - { name, lat, lon, radius, travelToEvent }
         * @returns {Promise<number>} Place ID.
         */
        async addPlace(placeData) {
            const newPlace = {
                name: placeData.name?.trim() || 'Unnamed Place',
                lat: placeData.lat || null,
                lon: placeData.lon || null,
                radius: placeData.radius || LOCATION.DEFAULT_RADIUS,
                travelToEvent: placeData.travelToEvent || {},
                sublocations: placeData.sublocations || []
            };
            const id = await addRecord(STORES.PLACES, newPlace);
            await refreshPlaces();
            return id;
        },
        
        /**
         * Update an existing place.
         * @param {number} placeId
         * @param {Object} placeData
         * @returns {Promise<void>}
         */
        async updatePlace(placeId, placeData) {
            const existing = places.find(p => p.id === placeId);
            if (!existing) throw new Error(`Place with ID ${placeId} not found`);
            const updated = { ...existing, ...placeData, id: placeId };
            await putRecord(STORES.PLACES, updated);
            await refreshPlaces();
            if (currentPlaceId === placeId) {
                // Update current place display
                const display = document.getElementById('currentPlaceDisplay');
                if (display) display.innerText = `📍 ${updated.name}`;
            }
        },
        
        /**
         * Delete a place.
         * @param {number} placeId
         * @returns {Promise<void>}
         */
        async deletePlace(placeId) {
            await deleteRecord(STORES.PLACES, placeId);
            await refreshPlaces();
            if (currentPlaceId === placeId) {
                currentPlaceId = places[0]?.id || null;
                if (currentPlaceId) {
                    const display = document.getElementById('currentPlaceDisplay');
                    if (display) display.innerText = `📍 ${places.find(p => p.id === currentPlaceId)?.name || 'Home'}`;
                }
            }
        },
        
        // ========== SUBLOCATION MANAGEMENT ==========
        
        /**
         * Add a sublocation to a place.
         * @param {number} placeId
         * @param {string} name
         * @param {number} lat
         * @param {number} lon
         * @returns {Promise<void>}
         */
        async addSublocation(placeId, name, lat, lon) {
            const place = places.find(p => p.id === placeId);
            if (!place) throw new Error('Place not found');
            if (!place.sublocations) place.sublocations = [];
            place.sublocations.push({
                id: generateUUID(),
                name: name.trim(),
                lat: lat || null,
                lon: lon || null
            });
            await this.updatePlace(placeId, place);
        },
        
        /**
         * Remove a sublocation from a place.
         * @param {number} placeId
         * @param {string} sublocationId
         * @returns {Promise<void>}
         */
        async removeSublocation(placeId, sublocationId) {
            const place = places.find(p => p.id === placeId);
            if (!place) throw new Error('Place not found');
            if (!place.sublocations) return;
            place.sublocations = place.sublocations.filter(s => s.id !== sublocationId);
            await this.updatePlace(placeId, place);
        },
        
        // ========== GPS & LOCATION TRACKING ==========
        
        /**
         * Start watching GPS position.
         */
        startGPS() {
            if (!navigator.geolocation) {
                showToast('GPS not supported', 'error');
                return;
            }
            if (gpsWatchId) this.stopGPS();
            gpsWatchId = navigator.geolocation.watchPosition(
                (position) => this.handlePosition(position),
                (err) => this.handleGpsError(err),
                { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
            );
            showToast('GPS started');
        },
        
        /**
         * Stop watching GPS position.
         */
        stopGPS() {
            if (gpsWatchId) {
                navigator.geolocation.clearWatch(gpsWatchId);
                gpsWatchId = null;
                showToast('GPS stopped');
            }
        },
        
        /**
         * Handle new GPS position.
         * @param {GeolocationPosition} position
         */
        async handlePosition(position) {
            if (!position?.coords) return;
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const now = new Date();
            
            // Update currentLocation global
            currentLocation.lat = lat;
            currentLocation.lon = lon;
            currentLocation.timestamp = now;
            
            // Debounce updates to avoid excessive UI refreshes
            if (locationUpdateDebounceTimer) clearTimeout(locationUpdateDebounceTimer);
            locationUpdateDebounceTimer = setTimeout(async () => {
                // Check if we are in any known place
                let matchedPlace = null;
                let matchedSublocation = null;
                for (const place of places) {
                    if (place.lat && place.lon) {
                        const dist = getDistance(lat, lon, place.lat, place.lon);
                        if (dist <= place.radius) {
                            matchedPlace = place;
                            // Check sublocations
                            if (place.sublocations) {
                                for (const sub of place.sublocations) {
                                    if (sub.lat && sub.lon) {
                                        const subDist = getDistance(lat, lon, sub.lat, sub.lon);
                                        if (subDist <= LOCATION.SUBLOCATION_RADIUS) {
                                            matchedSublocation = sub;
                                            break;
                                        }
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
                
                // Update current place and sublocation
                if (matchedPlace) {
                    if (matchedPlace.id !== currentPlaceId) {
                        currentPlaceId = matchedPlace.id;
                        const display = document.getElementById('currentPlaceDisplay');
                        if (display) {
                            let name = matchedPlace.name;
                            if (matchedSublocation) name += ` (${matchedSublocation.name})`;
                            display.innerText = `📍 ${name}`;
                        }
                        showToast(`📍 You are at ${matchedPlace.name}`);
                    } else if (matchedSublocation && matchedSublocation.id !== currentLocation.sublocationId) {
                        currentLocation.sublocationId = matchedSublocation.id;
                        currentLocation.sublocationName = matchedSublocation.name;
                        const display = document.getElementById('currentPlaceDisplay');
                        if (display) display.innerText = `📍 ${matchedPlace.name} (${matchedSublocation.name})`;
                    }
                } else {
                    // Not in any known place: find closest place
                    let closest = null;
                    let closestDist = Infinity;
                    for (const place of places) {
                        if (place.lat && place.lon) {
                            const d = getDistance(lat, lon, place.lat, place.lon);
                            if (d < closestDist) {
                                closestDist = d;
                                closest = place;
                            }
                        }
                    }
                    if (closest && closestDist < LOCATION.NEARBY_THRESHOLD) {
                        // Show GPS modal to ask user what to do
                        if (typeof showGPSModal === 'function') {
                            showGPSModal(closest, closestDist, lat, lon);
                        } else {
                            console.warn('showGPSModal not available');
                        }
                    }
                }
                
                // Record location history if auto-learn enabled
                if (userSettings.autoLearn) {
                    await addRecord(STORES.LOCATION_HISTORY, {
                        lat,
                        lon,
                        placeId: matchedPlace?.id || null,
                        sublocationId: matchedSublocation?.id || null,
                        timestamp: now.toISOString()
                    });
                    // Trim history to reasonable size (keep last 1000)
                    const allHistory = await getAll(STORES.LOCATION_HISTORY);
                    if (allHistory.length > 1000) {
                        const toDelete = allHistory.slice(0, allHistory.length - 1000);
                        for (const h of toDelete) await deleteRecord(STORES.LOCATION_HISTORY, h.id);
                    }
                }
            }, 500);
        },
        
        /**
         * Handle GPS error.
         * @param {GeolocationPositionError} err
         */
        handleGpsError(err) {
            const now = Date.now();
            if (!lastLocationUpdate || now - lastLocationUpdate > 10000) {
                lastLocationUpdate = now;
                showToast(`GPS error: ${err.message}`, 'error');
            }
        },
        
        // ========== TRAVEL TIME ESTIMATION ==========
        
        /**
         * Get travel time between two places.
         * @param {number} fromPlaceId
         * @param {number} toPlaceId
         * @param {string} mode - 'walking' or 'driving'
         * @returns {Promise<number>} Travel time in minutes.
         */
        async getTravelTime(fromPlaceId, toPlaceId, mode = userSettings.travelSpeed) {
            if (fromPlaceId === toPlaceId) return 0;
            
            // First check learned travel times
            const learned = getLearnedTravelTime(fromPlaceId, toPlaceId);
            if (learned !== null) return learned;
            
            // Fallback to distance-based
            const fromPlace = places.find(p => p.id === fromPlaceId);
            const toPlace = places.find(p => p.id === toPlaceId);
            if (!fromPlace || !toPlace) return OPTIMIZER.DEFAULT_TRAVEL_TIME;
            
            if (fromPlace.lat && fromPlace.lon && toPlace.lat && toPlace.lon) {
                const dist = getDistance(fromPlace.lat, fromPlace.lon, toPlace.lat, toPlace.lon);
                const time = estimateTravelTime(dist, mode);
                return Math.min(OPTIMIZER.MAX_TRAVEL_TIME, Math.max(5, time));
            }
            
            // Check custom travelToEvent map
            const custom = fromPlace.travelToEvent?.[toPlaceId] || toPlace.travelToEvent?.[fromPlaceId];
            return custom ?? OPTIMIZER.DEFAULT_TRAVEL_TIME;
        },
        
        /**
         * Record actual travel time for learning.
         * @param {number} fromPlaceId
         * @param {number} toPlaceId
         * @param {number} actualMinutes
         * @returns {Promise<void>}
         */
        async recordActualTravelTime(fromPlaceId, toPlaceId, actualMinutes) {
            await recordTravelTime(fromPlaceId, toPlaceId, actualMinutes);
        },
        
        // ========== PLACE UTILITIES ==========
        
        /**
         * Get nearest place to a point.
         * @param {number} lat
         * @param {number} lon
         * @returns {Object|null} { place, distance }
         */
        getNearestPlace(lat, lon) {
            let closest = null;
            let closestDist = Infinity;
            for (const place of places) {
                if (place.lat && place.lon) {
                    const d = getDistance(lat, lon, place.lat, place.lon);
                    if (d < closestDist) {
                        closestDist = d;
                        closest = place;
                    }
                }
            }
            return closest ? { place: closest, distance: closestDist } : null;
        },
        
        /**
         * Get all places.
         * @returns {Array}
         */
        getAllPlaces() {
            return [...places];
        },
        
        /**
         * Get a place by ID.
         * @param {number} placeId
         * @returns {Object|null}
         */
        getPlaceById(placeId) {
            return places.find(p => p.id === placeId) || null;
        },
        
        // ========== LOCATION-BASED NOTIFICATIONS ==========
        
        /**
         * Check if user is near a given place.
         * @param {number} placeId
         * @param {number} thresholdMeters - Optional override.
         * @returns {boolean}
         */
        isNearPlace(placeId, thresholdMeters = null) {
            if (!currentLocation.lat || !currentLocation.lon) return false;
            const place = places.find(p => p.id === placeId);
            if (!place || !place.lat || !place.lon) return false;
            const dist = getDistance(currentLocation.lat, currentLocation.lon, place.lat, place.lon);
            const radius = thresholdMeters !== null ? thresholdMeters : (place.radius || LOCATION.DEFAULT_RADIUS);
            return dist <= radius;
        },
        
        /**
         * Get sublocation the user is currently in (if any).
         * @returns {Object|null}
         */
        getCurrentSublocation() {
            if (!currentLocation.sublocationId) return null;
            const place = places.find(p => p.id === currentPlaceId);
            if (!place || !place.sublocations) return null;
            return place.sublocations.find(s => s.id === currentLocation.sublocationId) || null;
        }
    };
})();

// Make LocationManager globally available
window.LocationManager = LocationManager;
