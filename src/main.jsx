import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initializePlatform } from './platform/initialize.js'
import { createSyncEngine } from './platform/sync-setup.js'

const root = createRoot(document.getElementById('root'))

initializePlatform().then(async () => {
  window.mydeskSyncEngine = await createSyncEngine(window.mydesk)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}).catch(error => {
  console.error('MyDesk could not initialize its local platform services.', error)
  root.render(
    <main role="alert" style={{ maxWidth: 560, margin: '12vh auto', padding: 24 }}>
      <h1>MyDesk could not open local storage</h1>
      <p>Your data has not been deleted. Close and reopen the app, then try again.</p>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
    </main>,
  )
})
