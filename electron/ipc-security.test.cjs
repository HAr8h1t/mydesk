const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { isTrustedIpcSender, isTrustedRendererUrl } = require('./ipc-security.cjs')

test('allows only the configured development origin', () => {
  const options = { isPackaged: false, devServerUrl: 'http://127.0.0.1:4173/' }
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:4173/src/main.jsx', options), true)
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:4174/', options), false)
  assert.equal(isTrustedRendererUrl('https://127.0.0.1:4173/', options), false)
  assert.equal(isTrustedRendererUrl('not a url', options), false)
})

test('allows only the packaged application entry point', () => {
  const appPath = path.resolve('C:\\Program Files\\MyDesk\\resources\\app.asar')
  const entryPoint = path.join(appPath, 'dist', 'index.html')
  const options = { isPackaged: true, appPath }
  assert.equal(isTrustedRendererUrl(require('node:url').pathToFileURL(entryPoint).href, options), true)
  assert.equal(isTrustedRendererUrl(require('node:url').pathToFileURL(path.join(appPath, 'secret.html')).href, options), false)
  assert.equal(isTrustedRendererUrl('https://example.com/', options), false)
})

test('requires the current window and its main frame for IPC', () => {
  const mainFrame = { url: 'http://127.0.0.1:4173/' }
  const webContents = { mainFrame }
  const window = { webContents, isDestroyed: () => false }
  const options = { isPackaged: false, devServerUrl: 'http://127.0.0.1:4173/' }
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, window, options), true)
  assert.equal(isTrustedIpcSender({ sender: {}, senderFrame: mainFrame }, window, options), false)
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: { url: mainFrame.url } }, window, options), false)
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, { ...window, isDestroyed: () => true }, options), false)
})
