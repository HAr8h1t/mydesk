import { Capacitor } from '@capacitor/core'

async function initializeAndroidApi() {
  const [
    { SQLiteConnection, CapacitorSQLite },
    { Filesystem, Directory },
    { Share },
    { LocalNotifications },
    { SecureStorage },
    { createMobileApi },
  ] = await Promise.all([
    import('@capacitor-community/sqlite'),
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
    import('@capacitor/local-notifications'),
    import('@aparajita/capacitor-secure-storage'),
    import('./mobile-api.js'),
  ])
  const connectionName = 'mydesk'
  const sqlite = new SQLiteConnection(CapacitorSQLite)
  const existing = await sqlite.isConnection(connectionName, false)
  const database = existing.result
    ? await sqlite.retrieveConnection(connectionName, false)
    : await sqlite.createConnection(connectionName, false, 'no-encryption', 1, false)
  const opened = await database.isDBOpen()
  if (!opened.result) await database.open()

  const api = createMobileApi({
    database,
    files: {
      writeFile: options => Filesystem.writeFile({
        ...options,
        directory: options.directory === 'DOCUMENTS' ? Directory.Documents : Directory.Data,
      }),
      readFile: options => Filesystem.readFile({
        ...options,
        directory: options.directory === 'DOCUMENTS' ? Directory.Documents : Directory.Data,
      }),
      deleteFile: options => Filesystem.deleteFile({
        ...options,
        directory: options.directory === 'DOCUMENTS' ? Directory.Documents : Directory.Data,
      }),
    },
    share: Share,
    notifications: LocalNotifications,
  })
  await api.initialize()
  let credentialStorage
  try {
    await SecureStorage.setKeyPrefix('mydesk-auth-v1')
    credentialStorage = {
      get: key => SecureStorage.get(key),
      set: (key, value) => SecureStorage.set(key, value),
      remove: key => SecureStorage.remove(key),
    }
  } catch (error) {
    console.error('Encrypted Android credential storage is unavailable:', error)
    credentialStorage = {
      get: async () => { throw error },
      set: async () => { throw error },
      remove: async () => { throw error },
    }
  }
  const [{ AuthClient }] = await Promise.all([import('./auth-client.js')])
  const authClient = new AuthClient({
    store: api,
    secureStorage: credentialStorage,
    initialApiUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001',
  })
  api.auth.attach(authClient)
  await authClient.initialize()
  const handleNotification = notificationId => {
    api.notifications.handleReceived(notificationId).catch(error => {
      console.error(`Unable to process local notification ${notificationId}:`, error)
    })
  }
  await LocalNotifications.addListener('localNotificationReceived', notification => {
    handleNotification(notification.id)
  })
  await LocalNotifications.addListener('localNotificationActionPerformed', action => {
    handleNotification(action.notification.id)
  })
  window.mydesk = api
}

async function initializePlatform() {
  if (!Capacitor.isNativePlatform()) return
  await initializeAndroidApi()
}

export { initializePlatform }
