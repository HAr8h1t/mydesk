import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const projectRoot = process.cwd()
const server = await createServer({
  configFile: path.join(projectRoot, 'vite.config.js'),
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: true,
  },
})

await server.listen()

const address = server.httpServer.address()
if (!address || typeof address === 'string') {
  await server.close()
  throw new Error('Vite did not provide a local development server address.')
}

const electronProcess = spawn(
  process.execPath,
  [require.resolve('electron/cli.js'), '.'],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}`,
    },
    stdio: 'inherit',
  },
)

let closing = false

async function closeServer(signal) {
  if (closing) return
  closing = true
  if (signal && !electronProcess.killed) electronProcess.kill(signal)
  await server.close()
}

process.once('SIGINT', () => { void closeServer('SIGINT') })
process.once('SIGTERM', () => { void closeServer('SIGTERM') })

electronProcess.once('error', error => {
  console.error('Unable to start the MyDesk desktop window.', error)
  void closeServer().finally(() => { process.exitCode = 1 })
})

electronProcess.once('exit', (code, signal) => {
  void closeServer().finally(() => {
    process.exitCode = signal ? 1 : (code ?? 1)
  })
})
