// state.js - The Chronos Engine Global State
// This file acts as the Single Source of Truth for the entire application.
// MUST be loaded before all other modules.

// ========== DATA STORE (Module 1: SSOT) ==========
var events = [];           // Master rules for recurring and single events
var busyBlocks = [];       // Hard/Soft constraints (e.g., "Work 9-5", "Vacation")
var places = [];           // Geofenced location objects with lat, lon, radius, name
var overrides = new Map(); // Exceptions/Skips: Key format "eventID_YYYY-MM-DD"
var attendanceLog = [];    // Historical record for recency-based reminders

// ========== NEW DATA STORES (Module 2: Smart Features) ==========
var todos = [];            // To‑do items with due dates, priorities, recurrence, completion
var scheduledEvents = [];  // Optimizer assignments that persist (override master recurrence for specific dates)
var learningData = {       // User behavior patterns for personalization
    eventDurations: [],    // Actual time spent at events (eventId, dateStr, duration, timestamp)
    travelTimes: [],       // Actual travel times between places (fromPlaceId, toPlaceId, minutes, timestamp)
    preferences: [],       // User likes/dislikes (eventId, dateStr, type, timestamp)
    preferredTimeSlots: {} // Map: eventId -> array of hour-minute scores (0-23, 0-59)
};
var locationHistory = [];  // Movement patterns (timestamp, lat, lon, placeId, sublocationId)
var userFeedback = [];     // Explicit feedback (like, dislike, comment) on events or suggestions

// ========== UI & VIEW STATE (Module 6: Interactive Rendering) ==========
var currentView = 'week';  // 'week' | 'month'
var currentDate = new Date(); // The "Anchor Date" for the current view (e.g., week start)
var firstDayOfWeek = 1;    // 0=Sun, 1=Mon (persisted setting)
var timeFormat = '12h';    // '12h' | '24h'
var darkMode = false;      // Persistent preference (dark mode toggle)

// ========== OPTIMIZER & LOGIC STATE (Module 5: Autonomous Optimizer) ==========
var conflicts = [];        // Transient conflict list (populated by detectConflicts)
var restPolicy = 'home';   // 'home' | 'far' | 'none' (travel/rest behavior)
var farMinutes = 10;       // Threshold (in minutes) for 'far' rest policy
var currentSchedule = [];  // Holds the optimized schedule after running the optimizer
var scheduleRangeStart = new Date(); // Start date for optimizer planning range
var weeksTotal = 1;        // Number of weeks to plan ahead in optimizer

// ========== ENHANCED OPTIMIZER STATE ==========
var optimizerLock = false;         // Prevent concurrent optimization runs
var planningHorizonWeeks = 4;      // Default planning horizon (user-adjustable)
var lastOptimizerRun = null;       // Timestamp of last optimizer run

// ========== NOTIFICATION ENGINE (Module 8: Distance-Based Notifications) ==========
var notifyDayBefore = true;
var notifyMinutesBefore = 60;
var notifyTravelLead = 5;
var notificationLog = [];       // Persisted notification history (in‑memory)
var shownNotifications = new Set(); // deduplication key-set (e.g., "eventID_2025-03-31_pre")
var notificationInterval = null;

// ========== GPS & LOCATION ENGINE (Module 4: Geospatial Sensor) ==========
var currentPlaceId = 1;    // ID of the place the user is currently at
var gpsWatchId = null;     // ID of the active geolocation watcher
var currentLocation = {     // More detailed location info
    lat: null,
    lon: null,
    placeId: null,
    sublocationId: null,
    sublocationName: null,
    timestamp: null
};

// ========== EDITOR & MODAL STATE (Module 7: Indestructible Form Drafts) ==========
var editingEventId = null; // ID of event currently being edited (null = new event)
var editingDateStr = null; // Specific occurrence date being overridden
var eventDraftManager = null; // Instance of FormDraft class (event modal)
var busyDraftManager = null;  // Instance of FormDraft class (busy modal)
var todoDraftManager = null;  // Instance of FormDraft class (todo modal)

// ========== UNDO / REDO COMMAND PATTERN (Module 9: Immutable Action History) ==========
var undoStack = []; // Stores JSON snapshots of state (for undoing actions)
var redoStack = []; // Stores JSON snapshots for forward travel (redo)

// ========== WIZARD STATE (Enhanced 7‑step onboarding) ==========
var WIZARD_TOTAL_STEPS = 7;     // Total number of wizard steps
var wizardStep = 1;             // Current step (1‑based)
var wizardData = {
    // Step 1: Location (GPS)
    homeLat: null,              // Latitude of home place (if acquired)
    homeLon: null,              // Longitude of home place
    homeName: 'Home',           // Name of the home place
    homeRadius: 30,             // Geofencing radius (meters)

    // Step 2: First recurring activity
    eventName: '',              // Name of first event

    // Step 3: Weekly recurrence days (0=Sun ... 6=Sat)
    weeklyDays: [],             // e.g., [1,2,3,4,5] for weekdays

    // Step 4: Time window & duration
    openTime: '09:00',          // Start time of event window
    closeTime: '17:00',         // End time of event window
    stay: 60,                   // Duration in minutes

    // Step 5: Rest policy
    restPolicy: 'home',         // 'home' | 'far' | 'none'
    farMinutes: 10,             // Threshold for "only if far" (only used if restPolicy === 'far')

    // Step 6: Notifications
    notificationsGranted: false, // Whether user granted permission
    notifyDayBefore: true,      // Day‑before reminder
    notifyMinutesBefore: 60      // Minutes‑before reminder
};

// ========== NO‑GO BLOCKS (Derived from overrides for performance, but may be stored separately) ==========
// The optimizer uses noGoBlocks as an expanded list for quick access.
var noGoBlocks = []; // This will be populated by expandNoGoBlocks when needed.

// ========== USER SETTINGS GROUP (Easier access) ==========
var userSettings = {
    // General
    firstDayOfWeek: 1,
    timeFormat: '12h',
    darkMode: false,
    
    // Scheduling
    restPolicy: 'home',
    farMinutes: 10,
    planningHorizonWeeks: 4,
    travelSpeed: 'walking',     // 'walking' or 'driving'
    
    // Notifications
    notifyDayBefore: true,
    notifyMinutesBefore: 60,
    notifyTravelLead: 5,
    notificationSound: 'default',
    quietHoursStart: 22,        // 10 PM
    quietHoursEnd: 7,           // 7 AM
    
    // To‑dos
    showTodosInCalendar: false,
    defaultTodoDueOffset: 1,    // days from creation
    
    // Learning
    autoLearn: true,
    adaptToUserBehavior: true
};
