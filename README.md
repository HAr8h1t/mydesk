::: {align="center"}
# MyDesk

### Your PC. Your Data. Your Productivity.

A local-first productivity workspace for desktop, with a path toward
Android.

[Overview](#overview) · [Features](#planned-features) ·
[Technology](#technology-stack) · [Architecture](#architecture) ·
[Development](#getting-started) · [Roadmap](#roadmap)
:::

------------------------------------------------------------------------

> **Project status: Active development**
>
> The Windows desktop build has working task, calendar, timeline, reminder,
> alarm, focus and notes modules backed by SQLite and Electron IPC. A Capacitor
> Android project now has independent local SQLite storage and local
> notifications. Optional account synchronization and a PostgreSQL API are
> available as an incremental implementation; Android Studio/device and
> PostgreSQL deployment verification are still required.

## Overview

MyDesk is a personal productivity workspace built around a simple idea:
everyday productivity tools should be useful, responsive and keep the user's
information under their control.

MyDesk supports Windows desktop and has a Capacitor Android application.
The platforms share React UI and business rules where practical while
adapting local storage, notifications, authentication and lifecycle handling
to each platform.

### Core principles

-   **Local-first:** Core functionality should work without an internet
    connection.
-   **User-controlled data:** Store information locally by default and
    provide backup, restore and export capabilities.
-   **No mandatory account:** The core application should not require
    registration.
-   **Privacy-conscious:** Avoid unnecessary tracking, telemetry and
    cloud dependencies.
-   **Desktop-native behaviour:** Integrate with the operating system
    through controlled platform-specific code.
-   **Maintainable architecture:** Keep UI, application logic,
    persistence and platform integrations separate.
-   **Extensible:** Make it possible to add features without turning the
    application into one tightly coupled codebase.

## Planned features

The desktop application currently includes the core modules below. Platform
support and some advanced capabilities remain under development.

  -----------------------------------------------------------------------
  Module                              Planned capabilities
  ----------------------------------- -----------------------------------
  Dashboard                           Today's tasks, upcoming events,
                                      reminders, quick actions and
                                      productivity overview

  Calendar                            Month, week and day views; local
                                      events; date navigation; tasks and
                                      recurring events

  Daily Timeline                     Tasks, events, reminders, alarms,
                                      notes, focus sessions and schedule
                                      history for a selected date

  Tasks                               Create, edit, complete, categorize,
                                      prioritize and schedule tasks

  Reminders                           One-time and recurring reminders
                                      with local notifications

  Alarms                              Repeat schedules, custom sounds and
                                      platform-aware scheduling

  Notes                               Create, edit, search and organize
                                      notes with automatic saving

  Focus                               Focus and break timers, manual time
                                      entry, task-linked sessions and totals

  Password Vault                      Secure local credential storage
                                      using established cryptographic
                                      libraries

  Settings                            Themes, sound effects and personal
                                      alarm tones, notifications, backups
                                      and data export
  -----------------------------------------------------------------------

### Future possibilities

After the core application is stable, MyDesk may expand into a broader
PC companion with ideas such as:

-   Application launcher
-   System information and resource overview
-   Desktop widgets
-   Local automation and scheduled actions
-   File-management helpers
-   Productivity statistics
-   Custom themes and shortcuts
-   Optional scripting integrations

These are exploratory ideas, not current commitments.

## Technology stack

### Windows desktop

  Area                       Technology
  -------------------------- --------------------------
  UI                         React
  Language                   JavaScript
  Styling                    Tailwind CSS
  Frontend tooling           Vite
  Desktop runtime            Electron
  Main-process runtime       Node.js through Electron
  Local database             SQLite in the Electron main process
  SQLite API                 Node.js built-in node:sqlite
  Packaging                  Electron Builder

### Android application

  Area                         Technology
  ---------------------------- -------------------------------------------
  UI                           React, adapted for mobile
  Native application runtime   Capacitor
  Native capabilities          Capacitor APIs and maintained plugins
  Local database               SQLite through a compatible mobile plugin
  Android build tooling        Android Studio / Gradle

Electron is for desktop and does not run as the Android runtime. The
Android application reuses React UI and implements Android-specific storage,
notifications, lifecycle behaviour and mobile layouts through Capacitor.

The Android project is generated under `android/`. Build it with Android
Studio or `npm run android:sync`; a compatible JDK and Android SDK are
required. Each Android installation has its own local SQLite database. Local
tasks, notes, events, reminders and alarms remain available without an account
or network connection.

### Optional cross-device synchronization

The local database remains the source used by the UI. When an account is
configured in Settings, the persistent sync queue uploads changes to the
optional Node.js/PostgreSQL API and applies account-scoped remote changes.
Conflicting edits are kept for explicit resolution. Desktop credentials use
Electron encrypted storage; Android credentials use Android Keystore-backed
storage. Notifications are scheduled locally on each device.

To run the backend and configure PostgreSQL, see
[`server/README.md`](server/README.md). The API URL can be set in Settings;
local application use does not depend on the API being available. Automatic
sync currently runs while the app is active, retries with backoff, and is
triggered on reconnect and resume; it is not guaranteed by an OS background
worker after the app is closed. File attachments remain device-local and are
not uploaded by the sync API.

## Architecture

MyDesk is being designed around clear boundaries:

``` text
                       MYDESK
                          |
              +-----------+-----------+
              |                       |
         Shared core             Platform apps
              |                       |
      Models and rules         +-------+-------+
      Use cases                |               |
      Contracts             Windows         Android
              |             Electron       Capacitor
              |                |               |
              +----------------+---------------+
                               |
                     Platform adapters
                               |
                  Local storage and OS APIs
```

### Desktop request flow

``` text
React UI
   |
   v
Feature hook / application action
   |
   v
Desktop API adapter
   |
   v
Preload bridge (allowlisted methods)
   |
   v
Validated Electron IPC
   |
   v
Electron main process
   |
   v
Services and repositories
   |
   v
SQLite / Windows APIs
```

### Security boundaries

The renderer is responsible for presentation and user interaction. It
should not directly access Node.js, the filesystem, SQLite,
operating-system commands or unrestricted IPC.

The intended desktop security model includes:

-   `contextIsolation: true`
-   `nodeIntegration: false`
-   `sandbox: true`
-   A preload bridge exposing only specific application operations
-   Main-process validation of IPC inputs
-   Explicit IPC handlers and allowlisted channels
-   No direct database access from React

The Electron window enables context isolation and sandboxing, disables Node
integration and webviews, and only allows navigation within the app origin.
The preload exposes feature-specific methods rather than generic IPC. Main
process handlers reject calls from other windows, subframes, and untrusted
origins.

For the detailed architecture, folder responsibilities, security rules,
database plan and development sequence, see
**[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## Getting started

### Prerequisites

-   Windows
-   Node.js and npm
-   Git
-   A code editor such as Visual Studio Code

### Clone the repository

``` bash
git clone <your-repository-url>
cd mydesk
```

Replace `<your-repository-url>` with the URL of your GitHub repository.

### Install dependencies

``` bash
npm install
```

### Run in development

``` bash
npm run dev
```

The development launcher starts the Vite server and then launches the
Electron desktop application.

### Build the frontend

``` bash
npm run build
```

Run unit tests:

``` bash
npm test
```

### Build/sync Android

Install Android Studio, a supported JDK and the Android SDK, then run:

``` bash
npm run android:sync
```

Open the generated project with `npm run android:open`. This repository's
environment does not currently include Android build tools, so validate the
Gradle build and notifications on a real or emulated device before release.

### Package the Windows application

``` bash
npm run dist
```

The installer/build output is configured to go into the `release/`
directory. Packaging should be tested as the project evolves, especially
after Electron or the bundled Node.js runtime is upgraded.

## Repository structure

The project keeps the existing feature structure and adds platform and
service modules incrementally.

``` text
mydesk/
├── electron/
│   ├── dev.mjs
│   ├── main.cjs
│   └── preload.cjs
├── public/
├── src/
│   ├── assets/
│   ├── App.css
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── android/
├── server/
│   ├── index.cjs
│   └── migrations/
├── docs/
│   └── ARCHITECTURE.md
├── package.json
├── vite.config.js
└── README.md
```

As the application grows, the codebase is expected to gain dedicated
areas for:

-   Feature modules and reusable UI components
-   Shared application models, validation and use cases
-   Electron IPC handlers and validators
-   SQLite connection management and migrations
-   Repositories and application services
-   Desktop and Android platform adapters

See the architecture document before introducing new layers or moving
existing files.

## Roadmap

Development is planned in stages so that the foundation is tested before
feature work expands.

-   [x] Create the Vite + React application
-   [x] Set up Electron and the desktop window
-   [x] Configure Tailwind CSS
-   [x] Add a basic MyDesk dashboard and navigation
-   [x] Configure the initial Electron security preferences
-   [ ] Review and stabilize the application structure
-   [x] Implement a narrow, validated IPC API
-   [x] Integrate SQLite in the Electron main process
-   [ ] Add versioned database migrations
-   [ ] Add repositories and application use cases
-   [x] Implement persistent settings and color themes
-   [ ] Establish reusable UI components and design tokens
-   [x] Implement tasks, notes, calendar, reminders and alarms
-   [x] Add backup, restore and JSON export
-   [ ] Design and review the Password Vault security model
-   [ ] Test and package Windows releases
-   [ ] Prepare shared platform contracts for mobile
-   [x] Integrate Capacitor Android SQLite and local notifications
-   [x] Add persistent sync metadata, outbox, authentication and REST API
-   [ ] Verify PostgreSQL integration and Android device/background behavior

Checkboxes describe project progress at the time this README was written
and should be updated as work is completed.

## Development approach

MyDesk is being developed incrementally:

1.  Understand and review the existing implementation.
2.  Make one architectural change at a time.
3.  Keep privileged operations behind platform boundaries.
4.  Test each layer before building on top of it.
5.  Preserve working code unless there is a clear reason to change it.
6.  Document important technical decisions.

The project is also a learning exercise in desktop application
engineering, process isolation, IPC, databases, operating-system
integration and cross-platform architecture.

## Contributing

The project is in an early stage, so its structure and APIs may change.
If you want to contribute, open an issue first to discuss substantial
changes. Small fixes, documentation improvements and focused suggestions
are welcome.

Please avoid introducing a new dependency or architectural pattern
without explaining the problem it solves.

## Current desktop implementation

Tasks, reminders, alarms, notes, focus sessions, settings and calendar events
are stored in SQLite and accessed through the allowlisted Electron preload API.
Calendar task entries are derived from task dates rather than stored as
duplicate events. The Daily Timeline combines task, event, reminder, alarm,
note, focus-session and task-history activity for a selected day.

The dashboard opens first and summarizes today's tasks, events, reminders,
task-linked goals, notes, alarms and a scrollable daily timeline. The calendar
supports month, week, day and agenda views, touch swipes, reminder entries and
opening the full historical timeline for a selected date. Focus plans can be
saved as future date-and-time blocks in SQLite and later started, edited or
deleted. Alarm cards provide explicit Set/Turn off, Edit and Delete actions.

Focus sessions support a timer, manual time entry, task links, session history,
daily and weekly totals, and updating task actual-time totals. Themes include
warm, dark, ocean and forest palettes.

Manual backups create a validated SQLite snapshot and a companion folder for
note attachments. Scheduled backups run daily while MyDesk is open and retain
30 days. Restore validates the database and attachments and creates a
pre-restore safety backup. JSON exports are available for notes, tasks,
calendar events and the complete supported dataset. Alarm and reminder
scheduling also require MyDesk to be running; Windows cannot guarantee
notifications while the PC is asleep or powered off.

Notes support Markdown writing and preview, autosave, categories, tags, pinning,
archiving, daily dates, links to tasks and events, FTS5 search, version history,
and managed file attachments. Existing notes and calendar events in local
storage are imported into SQLite on first launch.

## License

The project license will be documented here once it has been finalized.
