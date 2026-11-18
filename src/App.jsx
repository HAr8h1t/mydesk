import { useState } from 'react'
import heroImg from './assets/hero.png'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import './App.css'

function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">

      <aside className="fixed left-0 top-0 h-screen w-64
        border-r border-slate-800 bg-slate-900 p-6">

        <h1 className="text-2xl font-bold tracking-tight">
          MyDesk<span className="text-blue-500">.</span>
        </h1>

        <p className="mt-2 text-xs text-slate-500">
          Your personal workspace
        </p>

        <nav className="mt-12 space-y-2">
          {['Dashboard', 'Calendar', 'Tasks',
            'Reminders', 'Alarms', 'Notes',
            'Password Vault'].map(item => (
            <button
              key={item}
              className="w-full rounded-lg px-4 py-3
                text-left text-sm text-slate-400
                transition hover:bg-slate-800
                hover:text-white"
            >
              {item}
            </button>
          ))}
        </nav>

      </aside>

      <main className="ml-64 p-10">

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">
              PERSONAL WORKSPACE
            </p>

            <h2 className="mt-2 text-3xl font-bold">
              Welcome to MyDesk
            </h2>
          </div>

          <div className="rounded-lg bg-slate-900
            px-4 py-2 text-sm text-green-400">
            Offline mode
          </div>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-5">

          {[
            ['Calendar', 'Manage your schedule'],
            ['Tasks', 'Organize your day'],
            ['Reminders', 'Never forget important things']
          ].map(([title, description]) => (
            <div
              key={title}
              className="rounded-xl border border-slate-800
                bg-slate-900 p-6 transition
                hover:border-blue-500"
            >
              <h3 className="text-lg font-semibold">
                {title}
              </h3>

              <p className="mt-2 text-sm text-slate-400">
                {description}
              </p>
            </div>
          ))}

        </div>

        <p className="mt-10 text-xs text-slate-600">
          Running on {window.mydesk.platform}
        </p>

      </main>
    </div>
  )
}

export default App