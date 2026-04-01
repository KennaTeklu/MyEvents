/*
 * Smart Scheduler – Intelligent Time Manager
 * Copyright (c) 2025 Kenna Teklu. All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, distribution, or use of this file, via any medium,
 * is strictly prohibited. See the LICENSE file for full terms.
 */
// constants.js - Global constants for the Smart Scheduler
// This file must be loaded before any other modules that reference these constants.
// It provides central definitions for days, time slots, colors, recurrence types, etc.

// ========== TIME & CALENDAR ==========
const MINUTES_IN_HOUR = 60;
const HOURS_IN_DAY = 24;
const DAYS_IN_WEEK = 7;
const DEFAULT_PLANNING_WEEKS = 4;              // Default horizon for optimizer
const PIXELS_PER_MINUTE = 1.5;                 // Vertical scaling in week/day view
const TIME_SLOT_INTERVAL = 15;                 // Minutes between possible start times

// ========== DAY NAMES ==========
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// ========== MONTH NAMES ==========
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ========== RECURRENCE TYPES ==========
const RECURRENCE = {
    NONE: 'none',
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    YEARLY: 'yearly'
};

// ========== FREQUENCY LIMITS ==========
const FREQUENCY = {
    UNLIMITED: 'unlimited',
    ONCE_PER_WEEK: '1perWeek',
    TWICE_PER_WEEK: '2perWeek',
    ONCE_PER_MONTH: '1perMonth',
    ONCE_PER_DAY: '1perDay'          // future
};

// ========== EVENT PRIORITIES ==========
const PRIORITY = {
    LOWEST: 1,
    LOW: 2,
    NORMAL: 3,
    HIGH: 4,
    HIGHEST: 5
};
const PRIORITY_LABELS = {
    1: 'Lowest priority',
    2: 'Low priority',
    3: 'Normal priority',
    4: 'High priority',
    5: 'Highest priority'
};

// ========== COLOR PALETTE (for events) ==========
const DEFAULT_COLORS = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#f97316', // orange
    '#64748b'  // slate
];
const DEFAULT_EVENT_COLOR = DEFAULT_COLORS[0];

// ========== NOTIFICATION TYPES ==========
const NOTIFICATION_TYPE = {
    EVENT: 'event',
    TODO: 'todo',
    LOCATION: 'location',
    SYSTEM: 'system'
};

// ========== INDEXEDDB STORE NAMES ==========
const STORES = {
    EVENTS: 'events',
    BUSY_BLOCKS: 'busyBlocks',
    PLACES: 'places',
    OVERRIDES: 'overrides',
    SETTINGS: 'settings',
    ATTENDANCE_LOG: 'attendanceLog',
    DRAFTS: 'drafts',
    TODOS: 'todos',
    SCHEDULED_EVENTS: 'scheduledEvents',
    LEARNING_DATA: 'learningData',
    LOCATION_HISTORY: 'locationHistory',
    USER_FEEDBACK: 'userFeedback'
};

// ========== USER SETTINGS DEFAULTS ==========
const DEFAULT_USER_SETTINGS = {
    // General
    firstDayOfWeek: 1,                // 0 = Sunday, 1 = Monday
    timeFormat: '12h',               // '12h' or '24h'
    darkMode: false,
    // Scheduling
    restPolicy: 'home',              // 'home', 'far', 'none'
    farMinutes: 10,
    planningHorizonWeeks: 4,
    travelSpeed: 'walking',          // 'walking' or 'driving'
    // Notifications
    notifyDayBefore: true,
    notifyMinutesBefore: 60,
    notifyTravelLead: 5,
    notificationSound: 'default',
    quietHoursStart: 22,             // 10 PM
    quietHoursEnd: 7,                // 7 AM
    // To‑dos
    showTodosInCalendar: false,
    defaultTodoDueOffset: 1,         // days from creation
    // Learning
    autoLearn: true,
    adaptToUserBehavior: true,
    autoOptimizeOnChange: true
};

// ========== OPTIMIZER CONSTANTS ==========
const OPTIMIZER = {
    MIN_DURATION: 15,                // minutes
    MAX_DURATION: 240,               // minutes
    MAX_TRAVEL_TIME: 120,            // minutes
    DEFAULT_TRAVEL_TIME: 15,
    PLANNING_HORIZON_WEEKS: 4,
    BACKTRACK_LIMIT: 10000,          // safety for recursion
    SCORE_WEIGHTS: {
        priority: 100,
        scarcity: 50,
        travelTime: -1,              // penalty per minute
        userPreference: 20,
        recency: 30
    }
};

// ========== GPS & LOCATION ==========
const LOCATION = {
    DEFAULT_RADIUS: 30,              // meters
    NEARBY_THRESHOLD: 200,           // meters to suggest expansion
    SUBLOCATION_RADIUS: 30,          // meters for sublocations
    MAX_PLACES: 50
};

// ========== UI MESSAGES (simple English, easy to translate) ==========
const UI_MESSAGES = {
    // Toasts
    EVENT_SAVED: 'Event saved',
    EVENT_DELETED: 'Event deleted',
    BUSY_SAVED: 'Busy block saved',
    BUSY_DELETED: 'Busy block deleted',
    TODO_SAVED: 'To‑do saved',
    TODO_COMPLETED: 'To‑do completed!',
    SETTINGS_SAVED: 'Settings saved',
    DATA_IMPORTED: 'Data imported',
    DATA_EXPORTED: 'Data exported',
    DATA_RESET: 'All data reset',
    OPTIMIZER_RUNNING: 'Optimizing schedule...',
    OPTIMIZER_DONE: 'Schedule optimized!',
    // Confirmations
    CONFIRM_DELETE_EVENT: 'Delete this event?',
    CONFIRM_DELETE_BUSY: 'Delete this busy block?',
    CONFIRM_DELETE_PLACE: 'Delete this place?',
    CONFIRM_RESET_ALL: 'Delete ALL data? This cannot be undone.',
    // Wizard
    WIZARD_WELCOME: 'Let’s set your home location so I know where you start from.',
    WIZARD_FIRST_EVENT: 'What is your first recurring activity?',
    WIZARD_DAYS: 'Which days does it happen?',
    WIZARD_TIME: 'When are you usually there?',
    WIZARD_STAY: 'How many minutes do you stay?',
    WIZARD_REST: 'Do you go home to rest between events?',
    WIZARD_NOTIFICATIONS: 'Stay informed with reminders',
    WIZARD_FINISH: 'Click Finish to start using Smart Scheduler!'
};

// ========== EXPORT (global) ==========
// This file is loaded via <script> tag, so these constants become global.
// No explicit export needed; they are declared with `const` and will be
// accessible in the global scope because they are not inside a function.
