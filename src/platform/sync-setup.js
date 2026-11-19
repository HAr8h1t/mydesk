import { SyncEngine } from './sync-engine.js'

async function createSyncEngine(api) {
  let connectivity
  if (api.platform === 'android') {
    const [{ Network }, { App }] = await Promise.all([
      import('@capacitor/network'),
      import('@capacitor/app'),
    ])
    connectivity = {
      isOnline: async () => {
        try {
          return (await Network.getStatus()).connected
        } catch (error) {
          console.error('Android connectivity status is unavailable:', error)
          return typeof navigator === 'undefined' || navigator.onLine !== false
        }
      },
      onChange: callback => {
        let networkListener
        let lifecycleListener
        let active = true
        Network.addListener('networkStatusChange', callback)
          .then(handle => {
            if (active) networkListener = handle
            else handle.remove()
          })
          .catch(error => console.error('Android connectivity listener could not start:', error))
        App.addListener('appStateChange', state => {
          if (state.isActive) callback()
        }).then(handle => {
          if (active) lifecycleListener = handle
          else handle.remove()
        })
          .catch(error => console.error('Android lifecycle listener could not start:', error))
        return () => {
          active = false
          networkListener?.remove()
          lifecycleListener?.remove()
        }
      },
    }
  }
  return new SyncEngine({
    store: api,
    transport: api.sync,
    connectivity,
    onStatus: status => window.dispatchEvent(new CustomEvent('mydesk:sync-status', { detail: status })),
    onError: error => {
      console.error('MyDesk synchronization failed:', error)
      window.dispatchEvent(new CustomEvent('mydesk:sync-error', { detail: error.message }))
    },
  })
}

export { createSyncEngine }
