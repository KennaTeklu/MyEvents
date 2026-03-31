// state.js - Shared global state for Smart Scheduler
// This file must be loaded before all other scripts

// Core data
var events = [];
var busyBlocks = [];
var places = [];
var overrides = new Map();
var attendanceLog = [];

// UI state
var currentView = 'week';
var currentDate = new Date();
var firstDayOfWeek = 1;
var timeFormat = '12h';
var darkMode = false;
var conflicts = [];

// Settings
var restPolicy = 'home';
var farMinutes = 10;
var notifyDayBefore = true;
var notifyMinutesBefore = 60;
var notifyTravelLead = 5;
var currentPlaceId = 1;

// GPS
var gpsWatchId = null;

// Editing
var editingEventId = null;
var editingDateStr = null;
var eventDraftManager = null;
var busyDraftManager = null;

// Undo/Redo
var undoStack = [];
var redoStack = [];

// Notifications
var notificationLog = [];
var shownNotifications = new Set();
var notificationInterval = null;

// Wizard
var wizardStep = 1;
var wizardData = {};
