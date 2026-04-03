/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2026 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// busyManager.js - Centralized busy block management
// Handles CRUD operations, recurrence expansion, splitting/merging, and conflict detection.
// Must be loaded after db.js, constants.js, and state.js (for busyBlocks array)

const BusyManager = (function() {
    // ========== PRIVATE HELPERS ==========
    
    // Validate busy block data
    function validateBusyBlock(block) {
        const errors = [];
        
        if (!block.description || typeof block.description !== 'string') {
            block.description = '';
        }
        
        const startMin = toMinutes(block.startTime);
        const endMin = toMinutes(block.endTime);
        if (startMin >= endMin) {
            errors.push('Start time must be before end time');
        }
        
        if (block.recurrence === 'once' && !block.date) {
            errors.push('Date is required for once-off busy block');
        }
        if (block.recurrence === 'daterange' && (!block.startDate || !block.endDate)) {
            errors.push('Start and end dates are required for date range');
        }
        if (block.recurrence === 'weekly' && (!block.daysOfWeek || block.daysOfWeek.length === 0)) {
            errors.push('At least one day of week is required for weekly recurrence');
        }
        
        return errors;
    }
    
    // Sanitize busy block for storage
    function sanitizeBusyBlock(block) {
        return {
            id: block.id || undefined,
            description: block.description?.trim() || '',
            hard: block.hard || false,
            recurrence: block.recurrence || 'once',
            date: block.date || null,
            startDate: block.startDate || null,
            endDate: block.endDate || null,
            daysOfWeek: block.daysOfWeek || [],
            startTime: block.startTime || '09:00',
            endTime: block.endTime || '17:00',
            allDay: block.allDay || false,
            tag: block.tag?.trim() || null
        };
    }
    
    // Refresh global busyBlocks array from DB
    async function refreshBusyBlocks() {
        const fresh = await getAll(STORES.BUSY_BLOCKS);
        busyBlocks.length = 0;
        busyBlocks.push(...fresh);
    }
    
    // ========== PUBLIC API ==========
    return {
        /**
         * Add a new busy block.
         * @param {Object} blockData - Raw busy block data.
         * @returns {Promise<number>} New block ID.
         */
        async addBusyBlock(blockData) {
            const sanitized = sanitizeBusyBlock(blockData);
            const errors = validateBusyBlock(sanitized);
            if (errors.length) {
                throw new Error(`Validation failed: ${errors.join(', ')}`);
            }
            const id = await addRecord(STORES.BUSY_BLOCKS, sanitized);
            await refreshBusyBlocks();
            return id;
        },
        
        /**
         * Update an existing busy block.
         * @param {number} blockId
         * @param {Object} blockData
         * @returns {Promise<void>}
         */
        async updateBusyBlock(blockId, blockData) {
            const existing = busyBlocks.find(b => b.id === blockId);
            if (!existing) throw new Error(`Busy block with ID ${blockId} not found`);
            const updated = sanitizeBusyBlock({ ...existing, ...blockData, id: blockId });
            const errors = validateBusyBlock(updated);
            if (errors.length) {
                throw new Error(`Validation failed: ${errors.join(', ')}`);
            }
            await putRecord(STORES.BUSY_BLOCKS, updated);
            await refreshBusyBlocks();
        },
        
        /**
         * Delete a busy block.
         * @param {number} blockId
         * @returns {Promise<void>}
         */
        async deleteBusyBlock(blockId) {
            await deleteRecord(STORES.BUSY_BLOCKS, blockId);
            await refreshBusyBlocks();
        },
        
        /**
         * Get busy blocks for a specific date (expanded from recurrence rules).
         * @param {string} dateStr - YYYY-MM-DD
         * @returns {Array} Array of busy blocks (each with startTime, endTime, etc.)
         */
        getBusyBlocksForDate(dateStr) {
            const target = new Date(dateStr + 'T12:00:00');
            const day = target.getDay();
            
            return busyBlocks.filter(b => {
                if (b.recurrence === 'once') return b.date === dateStr;
                if (b.recurrence === 'weekly') return b.daysOfWeek && b.daysOfWeek.includes(day);
                if (b.recurrence === 'daterange') return dateStr >= b.startDate && dateStr <= b.endDate;
                return false;
            });
        },
        
        /**
         * Expand all busy blocks over a date range.
         * @param {Date} rangeStart
         * @param {Date} rangeEnd
         * @returns {Array} Array of { dateStr, startTime, endTime, hard, tag }
         */
        expandBusyBlocks(rangeStart, rangeEnd) {
            const expanded = [];
            let cur = new Date(rangeStart);
            cur.setHours(12, 0, 0);
            
            while (cur <= rangeEnd) {
                const dateStr = formatDate(cur);
                const wd = cur.getDay();
                for (const b of busyBlocks) {
                    if (b.recurrence === 'weekly' && b.daysOfWeek && b.daysOfWeek.includes(wd)) {
                        expanded.push({
                            dateStr,
                            startTime: b.startTime,
                            endTime: b.endTime,
                            hard: b.hard,
                            tag: b.tag,
                            id: b.id
                        });
                    } else if (b.recurrence === 'daterange') {
                        const start = new Date(b.startDate + 'T12:00:00');
                        const end = new Date(b.endDate + 'T12:00:00');
                        if (cur >= start && cur <= end) {
                            expanded.push({
                                dateStr,
                                startTime: b.startTime,
                                endTime: b.endTime,
                                hard: b.hard,
                                tag: b.tag,
                                id: b.id
                            });
                        }
                    }
                }
                cur.setDate(cur.getDate() + 1);
            }
            return expanded;
        },
        
        /**
         * Split a busy block into two parts around a free interval.
         * Useful for carving out free time within a block.
         * @param {number} blockId
         * @param {string} splitDate - Date string of the occurrence (only relevant for recurrence? We'll handle by editing the master block)
         * @param {string} splitTime - Time string where the split occurs (e.g., "12:00").
         * @param {boolean} keepFirst - If true, keep first part; second part becomes new block. If false, keep second part; first becomes new.
         * @returns {Promise<void>}
         */
        async splitBusyBlock(blockId, splitDate, splitTime, keepFirst = true) {
            const block = busyBlocks.find(b => b.id === blockId);
            if (!block) throw new Error('Busy block not found');
            // We'll handle splitting only for once-off or date-range blocks? For weekly it's more complex.
            // For simplicity, we'll support splitting for once-off blocks. For weekly, we can convert to a once-off exception? Not needed now.
            if (block.recurrence !== 'once') {
                throw new Error('Splitting currently only supported for once-off busy blocks');
            }
            const splitMin = toMinutes(splitTime);
            const startMin = toMinutes(block.startTime);
            const endMin = toMinutes(block.endTime);
            if (splitMin <= startMin || splitMin >= endMin) {
                throw new Error('Split time must be within the block');
            }
            
            // Create two new blocks
            const firstBlock = {
                ...block,
                startTime: fromMinutes(startMin),
                endTime: fromMinutes(splitMin)
            };
            const secondBlock = {
                ...block,
                startTime: fromMinutes(splitMin),
                endTime: fromMinutes(endMin)
            };
            
            // Delete original block
            await this.deleteBusyBlock(blockId);
            // Add both new blocks
            await this.addBusyBlock(firstBlock);
            await this.addBusyBlock(secondBlock);
        },

        /**
         * Carve a hole out of a busy block to perfectly fit an event.
         */
        async carveBusyBlock(blockId, carveStartStr, carveEndStr) {
            const block = busyBlocks.find(b => b.id === blockId);
            if (!block) throw new Error('Busy block not found');
            if (block.recurrence !== 'once') {
                throw new Error('Splitting currently only supported for once-off busy blocks');
            }
            
            const bStart = toMinutes(block.startTime);
            const bEnd = toMinutes(block.endTime);
            const cStart = toMinutes(carveStartStr);
            const cEnd = toMinutes(carveEndStr);
            
            // Delete the original overarching block
            await this.deleteBusyBlock(blockId);
            
            // Create the block BEFORE the event (if there is space)
            if (cStart > bStart) {
                await this.addBusyBlock({
                    ...block,
                    startTime: fromMinutes(bStart),
                    endTime: fromMinutes(cStart)
                });
            }
            
            // Create the block AFTER the event (if there is space)
            if (cEnd < bEnd) {
                await this.addBusyBlock({
                    ...block,
                    startTime: fromMinutes(cEnd),
                    endTime: fromMinutes(bEnd)
                });
            }
        },
        
        /**
         * Merge two busy blocks (if they are adjacent or overlapping on the same day).
         * @param {number} blockIdA
         * @param {number} blockIdB
         * @returns {Promise<void>}
         */
        async mergeBusyBlocks(blockIdA, blockIdB) {
            const blockA = busyBlocks.find(b => b.id === blockIdA);
            const blockB = busyBlocks.find(b => b.id === blockIdB);
            if (!blockA || !blockB) throw new Error('One or both blocks not found');
            if (blockA.recurrence !== 'once' || blockB.recurrence !== 'once') {
                throw new Error('Merging currently only supported for once-off blocks');
            }
            if (blockA.date !== blockB.date) {
                throw new Error('Blocks must be on the same date to merge');
            }
            
            const startMin = Math.min(toMinutes(blockA.startTime), toMinutes(blockB.startTime));
            const endMin = Math.max(toMinutes(blockA.endTime), toMinutes(blockB.endTime));
            
            const merged = {
                ...blockA,
                startTime: fromMinutes(startMin),
                endTime: fromMinutes(endMin)
            };
            // Delete both originals
            await this.deleteBusyBlock(blockIdA);
            await this.deleteBusyBlock(blockIdB);
            // Add merged
            await this.addBusyBlock(merged);
        },
        
        /**
         * Check if a time slot is free (no busy blocks covering it).
         * @param {string} dateStr
         * @param {number} startMin - Minutes since midnight.
         * @param {number} endMin
         * @param {boolean} ignoreHard - If true, ignore hard blocks (treat them as soft).
         * @returns {boolean} True if free.
         */
        isTimeSlotFree(dateStr, startMin, endMin, ignoreHard = false) {
            const blocks = this.getBusyBlocksForDate(dateStr);
            for (const b of blocks) {
                if (ignoreHard && b.hard) continue;
                const bStart = toMinutes(b.startTime);
                const bEnd = toMinutes(b.endTime);
                if (startMin < bEnd && endMin > bStart) return false;
            }
            return true;
        },
        
        /**
         * Find free slots in a given day within a time window.
         * @param {string} dateStr
         * @param {number} windowStartMin
         * @param {number} windowEndMin
         * @param {number} minDuration - Minimum free slot length in minutes.
         * @returns {Array} Array of { startMin, endMin } free intervals.
         */
        getFreeSlots(dateStr, windowStartMin, windowEndMin, minDuration = 30) {
            const blocks = this.getBusyBlocksForDate(dateStr);
            // Sort blocks by start time
            const sorted = blocks.map(b => ({
                start: toMinutes(b.startTime),
                end: toMinutes(b.endTime)
            })).sort((a, b) => a.start - b.start);
            
            const freeSlots = [];
            let currentStart = windowStartMin;
            for (const block of sorted) {
                if (block.start > currentStart) {
                    const freeEnd = Math.min(block.start, windowEndMin);
                    if (freeEnd - currentStart >= minDuration) {
                        freeSlots.push({ startMin: currentStart, endMin: freeEnd });
                    }
                }
                currentStart = Math.max(currentStart, block.end);
                if (currentStart >= windowEndMin) break;
            }
            if (currentStart < windowEndMin) {
                if (windowEndMin - currentStart >= minDuration) {
                    freeSlots.push({ startMin: currentStart, endMin: windowEndMin });
                }
            }
            return freeSlots;
        },
        
        /**
         * Check if any busy block conflicts with an event.
         * @param {Object} event
         * @param {string} dateStr
         * @returns {boolean}
         */
        hasConflict(event, dateStr) {
            const eventStart = toMinutes(event.startTime);
            const eventEnd = toMinutes(event.endTime);
            const blocks = this.getBusyBlocksForDate(dateStr);
            return blocks.some(b => {
                const bStart = toMinutes(b.startTime);
                const bEnd = toMinutes(b.endTime);
                return eventStart < bEnd && eventEnd > bStart;
            });
        }
    };
})();

// Make BusyManager globally available
window.BusyManager = BusyManager;
