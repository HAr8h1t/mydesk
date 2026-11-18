const path = require('node:path')
const { fileURLToPath } = require('node:url')

function isTrustedRendererUrl(rawUrl, { isPackaged, devServerUrl, appPath }) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (!isPackaged) {
    if (!devServerUrl) return false
    try {
      return url.origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }

  if (url.protocol !== 'file:') return false
  try {
    return path.resolve(fileURLToPath(url)) === path.resolve(appPath, 'dist', 'index.html')
  } catch {
    return false
  }
}

function isTrustedIpcSender(event, mainWindow, options) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false
  return isTrustedRendererUrl(event.senderFrame.url, options)
}

module.exports = { isTrustedIpcSender, isTrustedRendererUrl }
