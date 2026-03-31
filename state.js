// state.js - The Chronos Engine Global State
// This file acts as the Single Source of Truth for the entire application.
// MUST be loaded before all other modules.

// ========== DATA STORE ==========
var events = [];           // Master rules for recurring and single events
var busyBlocks = [];       // Hard/Soft constraints
var places = [];           // Geofenced location objects
var overrides = new Map(); // Exceptions/Skips: Key format "eventID_YYYY-MM-DD"
var attendanceLog = [];    // Historical record for recency-based reminders

// ========== UI & VIEW STATE ==========
var currentView = 'week';  // 'week' | 'month'
var currentDate = new Date(); // The "Anchor Date" for the current view
var firstDayOfWeek = 1;    // 0=Sun, 1=Mon
var timeFormat = '12h';    // '12h' | '24h'
var darkMode = false;      // Persistent preference

// ========== OPTIMIZER & LOGIC STATE ==========
var conflicts = [];        // Transient conflict list
var restPolicy = 'home';   // 'home' | 'far' | 'none'
var farMinutes = 10;       // Threshold for 'far' rest policy
var notifyDayBefore = true;
var notifyMinutesBefore = 60;
var notifyTravelLead = 5;

// ========== GPS & LOCATION ENGINE ==========
var currentPlaceId = 1;
var gpsWatchId = null;

// ========== EDITOR & MODAL STATE ==========
var editingEventId = null; // ID of event currently being edited
var editingDateStr = null; // Specific occurrence date being overridden
var eventDraftManager = null; // Instance of FormDraft class
var busyDraftManager = null;  // Instance of FormDraft class

// ========== UNDO / REDO COMMAND PATTERN ==========
var undoStack = []; // Stores JSON snapshots of state
var redoStack = []; // Stores JSON snapshots for forward travel

// ========== NOTIFICATION ENGINE ==========
var notificationLog = [];       // Persisted notification history
var shownNotifications = new Set(); // deduplication key-set
var notificationInterval = null;

// ========== WIZARD STATE ==========
var wizardStep = 1;
var wizardData = {
    home: null,
    eventName: '',
    openTime: '09:00',
    closeTime: '17:00',
    stay: 60,
    restPolicy: 'home'
};
