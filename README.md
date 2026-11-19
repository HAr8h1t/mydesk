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
> alarm and notes modules backed by SQLite and Electron IPC. Focus tracking,
> selectable themes, and backup/export are also available. The Password Vault,
> Android support, and database migrations remain future work.

## Overview

MyDesk is a personal productivity and PC companion application being
built around a simple idea: everyday productivity tools should be
useful, responsive and keep the user's information under their control.

The project starts with a Windows desktop application and is being
architected with future Android support in mind. The goal is to share
application logic where practical while using the right native
capabilities for each platform.

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

  Settings                            Themes, preferences, notifications,
                                      backup and data export
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

### Planned Android support

  Area                         Technology
  ---------------------------- -------------------------------------------
  UI                           React, adapted for mobile
  Native application runtime   Capacitor
  Native capabilities          Capacitor APIs and maintained plugins
  Local database               SQLite through a compatible mobile plugin
  Android build tooling        Android Studio / Gradle

Electron is for desktop and does not run as the Android runtime. The
intended approach is to reuse suitable React UI and platform-independent
application logic, while implementing Android-specific storage,
notifications, lifecycle behaviour and mobile layouts separately.

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

### Package the Windows application

``` bash
npm run dist
```

The installer/build output is configured to go into the `release/`
directory. Packaging should be tested as the project evolves, especially
after Electron or the bundled Node.js runtime is upgraded.

## Repository structure

The current project is intentionally small. The architecture will be
introduced incrementally rather than creating every planned folder in
advance.

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
-   [ ] Integrate Capacitor and implement Android support

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

Smart Schedule is a local, rule-based assistant for the next seven days. It
detects overlaps between timed events and scheduled tasks, highlights days with
six or more scheduled hours, shows free windows during a 9–5 planning day, and
suggests duration- and deadline-aware task scheduling or rescheduling while
respecting priority and completed dependencies. It does not require AI or a
cloud service.

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
