// state.js - The Chronos Engine Global State
// This file acts as the Single Source of Truth for the entire application.
// MUST be loaded before all other modules.

// ========== DATA STORE (Module 1: SSOT) ==========
var events = [];           // Master rules for recurring and single events
var busyBlocks = [];       // Hard/Soft constraints (e.g., "Work 9-5", "Vacation")
var places = [];           // Geofenced location objects with lat, lon, radius, name
var overrides = new Map(); // Exceptions/Skips: Key format "eventID_YYYY-MM-DD"
var attendanceLog = [];    // Historical record for recency-based reminders

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

// ========== EDITOR & MODAL STATE (Module 7: Indestructible Form Drafts) ==========
var editingEventId = null; // ID of event currently being edited (null = new event)
var editingDateStr = null; // Specific occurrence date being overridden
var eventDraftManager = null; // Instance of FormDraft class (event modal)
var busyDraftManager = null;  // Instance of FormDraft class (busy modal)

// ========== UNDO / REDO COMMAND PATTERN (Module 9: Immutable Action History) ==========
var undoStack = []; // Stores JSON snapshots of state (for undoing actions)
var redoStack = []; // Stores JSON snapshots for forward travel (redo)

// ========== WIZARD STATE (First‑run wizard) ==========
var wizardStep = 1;
var wizardData = {
    home: null,
    eventName: '',
    openTime: '09:00',
    closeTime: '17:00',
    stay: 60,
    restPolicy: 'home'
};

// ========== NO‑GO BLOCKS (Derived from overrides for performance, but may be stored separately) ==========
// The optimizer uses noGoBlocks as an expanded list for quick access.
var noGoBlocks = []; // This will be populated by expandNoGoBlocks when needed.
