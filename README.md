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

> **Project status: Early development**
>
> The initial Windows desktop shell is running with React, Vite and
> Electron. Most productivity features and the persistence layer are
> still being designed or implemented. This repository is under active
> development; expect changes.

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

The following describes the product direction. These features are not
all implemented yet.

  -----------------------------------------------------------------------
  Module                              Planned capabilities
  ----------------------------------- -----------------------------------
  Dashboard                           Today's tasks, upcoming events,
                                      reminders, quick actions and
                                      productivity overview

  Calendar                            Month, week and day views; local
                                      events; date navigation

  Tasks                               Create, edit, complete, categorize,
                                      prioritize and schedule tasks

  Reminders                           One-time and recurring reminders
                                      with local notifications

  Alarms                              Repeat schedules, custom sounds and
                                      platform-aware scheduling

  Notes                               Create, edit, search and organize
                                      notes with automatic saving

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
  Local database (planned)   SQLite
  SQLite driver (planned)    better-sqlite3
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

The current Electron window already has context isolation enabled, Node
integration disabled and sandboxing enabled. Feature-specific IPC and
the database layer are not yet implemented.

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

<<<<<<< HEAD
The installer/build output is configured to go into the `release/`
directory. Packaging should be tested as the project evolves, especially
after native Node.js modules such as `better-sqlite3` are introduced.

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
-   [ ] Implement a narrow, validated IPC API
-   [ ] Integrate SQLite in the Electron main process
-   [ ] Add versioned database migrations
-   [ ] Add repositories and application use cases
-   [ ] Implement persistent settings
-   [ ] Establish reusable UI components and design tokens
-   [ ] Implement tasks, notes, calendar, reminders and alarms
-   [ ] Add backup, restore and export
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

## License

The project license will be documented here once it has been finalized.
=======
Desktop tasks are stored in SQLite and managed through Electron IPC. Task
subtasks, dependencies, attachments, and activity history are stored with the
task record. Notes and calendar events use local storage. Calendar task entries
are derived from task dates, so rescheduling a task updates its calendar entry.

Tasks support dates, priorities, categories, tags, checklists, recurrence,
dependencies, estimates, time spent, notes, attachments, status, and history.
Smart scheduling suggests a task that fits a free hour tomorrow. The calendar
includes month, week, day, and agenda views, recurring events, event categories,
and drag-and-drop rescheduling.
>>>>>>> ee9f33d (Added Core Productivity System & Task managment system)
