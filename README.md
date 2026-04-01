```markdown
# Smart Scheduler – Ultimate Time Manager

**Smart Scheduler** is an offline‑first, location‑aware web application that automatically schedules your events around your busy times, learns your preferences, and helps you stay on top of to‑dos.  
It uses a constraint solver to balance priorities, travel times, rest policies, and user feedback—all while working entirely in your browser with IndexedDB storage.

![Screenshot](https://via.placeholder.com/800x400?text=Smart+Scheduler+Preview)

## ✨ Features

- **Smart Event Scheduling** – Define events with open/close windows, min/max stay, and recurrence (daily/weekly/monthly). The built‑in optimizer places them into free slots while respecting busy blocks, travel times, and your rest preferences.
- **Busy Blocks** – Mark fixed commitments (work, school, etc.) as hard or soft blocks. The scheduler works around them.
- **To‑do List** – Keep track of tasks with due dates, priorities, and recurrence. Optional calendar integration shows badge counts.
- **Location Awareness** – Define places (Home, Work, Gym) with GPS coordinates and radii. The app estimates travel times (walking/driving) between them using real routing (OSRM) or fallback distance‑based math.
- **Learning Engine** – Records how long you actually spend at events and which time slots you prefer. Over time, the scheduler adapts to your habits.
- **Undo/Redo** – Full history with snapshot‑based undo/redo for any action.
- **Dark Mode** – Toggle between light and dark themes.
- **Offline First** – All data is stored locally in IndexedDB. No internet required after initial load (except for routing API, if used).
- **Import/Export** – Backup or transfer your data with JSON files.
- **Drag‑and‑Drop** – Manually move events on the calendar to override the optimizer’s suggestion.
- **Interactive Notifications** – In‑app toasts, sound alerts, and push notifications (with service worker, planned).
- **GPS Proximity Detection** – Know when you arrive at a place and optionally add sub‑locations (e.g., “Cafeteria” inside “School”).

## 🚀 Quick Start

1. **Clone or download** this repository.
2. **Serve the files** using any static web server (e.g., `python -m http.server 8000` or just open `index.html` directly – some browsers restrict IndexedDB from `file://`, so a local server is recommended).
3. **Open** `index.html` in a modern browser (Chrome, Firefox, Edge, Safari).
4. **Complete the wizard** – set your home location, first event, rest policy, and notification preferences.
5. **Start adding events** – click the blue **+** button to create events, busy blocks, or to‑dos.
6. **Watch the magic** – the optimizer will automatically schedule events into free slots. Use drag‑and‑drop to fine‑tune.

## 📖 How to Use

### Adding an Event
- Click the **+** floating button.
- Fill in the name, time window, duration, recurrence, and optional location (choose from your saved places).
- Advanced options let you set frequency limits (once per week, etc.), priority (1‑5), and mark the event as scarce (high importance).
- Save – the event will appear on the calendar. The optimizer will try to place it optimally.

### Managing Busy Blocks
- Right‑click or long‑press on any day cell and choose **Add busy time**.
- Describe the block, set its recurrence (once, weekly, date range), and choose if it’s a **hard** block (cannot be overlapped) or soft.
- The scheduler will avoid placing events during busy times.

### To‑dos
- Click the **To‑dos** button in the top bar to open the to‑do panel.
- Add tasks with due dates, priority, and optional recurrence.
- When a to‑do is completed, it will automatically create a new instance if recurrence is set.

### Location & GPS
- The app will ask for your location. Once granted, it tracks your position and updates the current place display.
- If you are near an existing place, it shows a toast; if you’re near an unknown spot, you’ll be prompted to widen the radius or create a new place/sublocation.
- Travel times are calculated using real‑world routing (OSRM) when internet is available; otherwise, it falls back to straight‑line distance.

### Optimizer & Manual Overrides
- The optimizer runs automatically after changes (debounced) and suggests a schedule. It tries to maximize high‑priority events while respecting all constraints.
- If you disagree with a placement, **drag the event** to a different time slot or day. This creates an override (exception) that the optimizer will respect in future runs.
- You can also mark an occurrence as **Skip (No Go)** or **Lock** from the context menu (right‑click / long‑press). Locked events will not be moved by the optimizer.

### Feedback & Learning
- Hover over an event (desktop) to see a tooltip with a **Like/Dislike** button. Your feedback influences future scheduling.
- When you mark an event as attended (from the context menu), you’ll be prompted to enter the actual duration. This helps the learning engine adjust future estimates.

### Settings
- Open the **Settings** (gear icon) to customise:
  - First day of week, time format, dark mode.
  - Rest policy (always go home, only if far, never).
  - Notification lead times and quiet hours.
  - Manage your places, busy blocks, to‑dos, and view learning data.
  - Import/Export your entire database or reset everything.

## 🏗 Architecture

Smart Scheduler is built as a modular JavaScript application. The main components are:

| Module | Responsibility |
|--------|----------------|
| `constants.js` | Central constants (days, colours, defaults). |
| `db.js` | IndexedDB wrapper with all store definitions. |
| `state.js` | Global state variables. |
| `utils.js` | Helper functions (time math, distance, etc.). |
| `eventManager.js` | CRUD for events, recurrence expansion, overrides. |
| `busyManager.js` | Busy blocks management, splitting/merging. |
| `todoManager.js` | To‑do operations, due date handling, search. |
| `locationManager.js` | GPS, places, sublocations, travel time estimation. |
| `userLearning.js` | Records actual durations, preferences, preferred times. |
| `scheduler.js` | Constraint solver that assigns events to slots. |
| `scheduleStore.js` | Persistence for scheduled events. |
| `calendar.js` | Rendering of week/month/day views, drag‑and‑drop. |
| `modals.js` | All modal dialogs (event, busy, todo, feedback, etc.). |
| `settings.js` | Settings panel and management of lists. |
| `notifications.js` | In‑app notification system (toasts, sound, reminders). |
| `todoPanel.js` | Sidebar for to‑do list. |
| `eventList.js` | Searchable modal for all events. |
| `wizard.js` | First‑run onboarding wizard. |
| `undoRedo.js` | Undo/redo history with snapshots. |
| `formDraft.js` | Auto‑save form drafts to IndexedDB/localStorage. |
| `main.js` | Main orchestration, event listeners, and initialisation. |
| `style.css` | All custom styles (tailwind is also used). |
| `index.html` | The main HTML structure. |

### Data Flow
1. User interacts with UI (add event, drag event, etc.).
2. The corresponding manager updates IndexedDB and the global state.
3. A debounced call to `runOptimizer()` triggers the scheduler.
4. The scheduler reads all events, busy blocks, locations, and learning data.
5. It generates a new schedule (array of `scheduledEvents`).
6. `scheduleStore` persists the schedule and refreshes the global `scheduledEvents` array.
7. `calendar.js` rerenders using `getDisplayEventsForDate()`, which merges master events with scheduled ones.
8. The calendar shows the updated schedule.

## 🧪 Development

### Prerequisites
- Node.js (for live server, optional).
- A modern web browser (Chrome 80+, Firefox 75+, Edge 80+, Safari 14+).

### Running Locally
1. Clone the repository.
2. Start a local HTTP server. For example:
   ```bash
   npx serve
   # or
   python -m http.server 8000
   ```
3. Open `http://localhost:8000` in your browser.

### File Structure
```
.
├── index.html          # Main entry point
├── style.css           # Custom styles
├── constants.js        # Global constants
├── db.js               # IndexedDB interface
├── state.js            # Global state
├── utils.js            # Helper functions
├── eventManager.js
├── busyManager.js
├── todoManager.js
├── locationManager.js
├── userLearning.js
├── scheduler.js
├── scheduleStore.js
├── calendar.js
├── modals.js
├── settings.js
├── notifications.js
├── todoPanel.js
├── eventList.js
├── wizard.js
├── undoRedo.js
├── formDraft.js
├── main.js
└── README.md
```

### Extending the Scheduler
The scheduler (`scheduler.js`) uses a greedy algorithm with backtracking fallback. The scoring function `scoreSlot` can be tweaked to add more factors (e.g., weather, day of week preferences). The constraint solver is designed to be modular; you can replace it with a more advanced CSP if desired.

## ❓ Troubleshooting

- **Events not appearing?** Check the console for errors. Ensure IndexedDB is enabled. Try clearing the database via the Data tab in Settings.
- **GPS not working?** Browsers require HTTPS for geolocation; use a local server with `https` or `localhost`. Also, ensure permission is granted.
- **Optimizer runs too often?** The debounce delay is set to 2 seconds, and a minimum interval of 5 seconds prevents excessive runs. You can adjust these in `main.js`.
- **Travel times inaccurate?** Make sure your places have correct coordinates. If you have internet, the app uses OSRM routing; otherwise it falls back to straight‑line distance.
- **Notifications not playing?** Browsers block autoplay audio without user interaction. Sound is only played after the user has clicked something.

## 🤝 Contributing

Contributions are welcome! Please follow these steps:
1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes.
4. Push to the branch.
5. Open a pull request.

## 📄 License

This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

- Tailwind CSS for rapid styling.
- Font Awesome for icons.
- OSRM for open‑source routing.
- IndexedDB for client‑side storage.

---

**Smart Scheduler** – Because your time is too valuable to waste.
```