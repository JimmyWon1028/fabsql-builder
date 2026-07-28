const path = require('node:path')
const { pathToFileURL } = require('node:url')

const {
  app: electronApplication,
  BrowserWindow,
  dialog,
  ipcMain,
  session
} = require('electron')
const {
  createPersistentStorage
} = require('./persistent-storage.cjs')

let mainWindow
let webApplication
let applicationClosing = false
let desktopStorage
let mainWindowCloseAllowed = false
let mainWindowClosePending = false
let mainWindowCloseTimer

function getDistributionDirectory() {
  if (electronApplication.isPackaged) {
    return path.join(process.resourcesPath, 'dist')
  }

  return path.join(__dirname, '..', 'dist')
}

async function startWebApplication() {
  const distributionDirectory = getDistributionDirectory()
  const applicationModuleUrl = pathToFileURL(
    path.join(
      distributionDirectory,
      'api',
      'production-application.js'
    )
  ).href
  const {
    createProductionApplication
  } = await import(applicationModuleUrl)
  const productionApplication = await createProductionApplication(
    path.join(distributionDirectory, 'web')
  )

  webApplication = productionApplication.app

  return webApplication.listen({
    host: '127.0.0.1',
    port: 0
  })
}

function focusMainWindow() {
  if (!mainWindow) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

async function createMainWindow(applicationUrl) {
  const applicationOrigin = new URL(applicationUrl).origin

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) => (
      permission === 'clipboard-sanitized-write'
      && requestingOrigin === applicationOrigin
    )
  )

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const requestingOrigin = new URL(webContents.getURL()).origin

      callback(
        permission === 'clipboard-sanitized-write'
        && requestingOrigin === applicationOrigin
      )
    }
  )

  mainWindow = new BrowserWindow({
    backgroundColor: '#f5f7fb',
    height: 900,
    minHeight: 720,
    minWidth: 1100,
    show: false,
    title: 'FabSQL Builder',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true
    },
    width: 1440
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }))

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== applicationOrigin) {
      event.preventDefault()
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (mainWindowCloseAllowed || mainWindowClosePending) {
      return
    }

    event.preventDefault()
    mainWindowClosePending = true
    mainWindow?.webContents.send('fabsql:prepare-to-close')
    mainWindowCloseTimer = setTimeout(() => {
      allowMainWindowToClose()
    }, 3000)
  })

  mainWindow.on('closed', () => {
    if (mainWindowCloseTimer) {
      clearTimeout(mainWindowCloseTimer)
      mainWindowCloseTimer = undefined
    }

    mainWindow = undefined
  })

  await mainWindow.loadURL(applicationUrl)
}

async function launchApplication() {
  registerDesktopIpc()
  const applicationUrl = await startWebApplication()
  await createMainWindow(applicationUrl)
}

function isTrustedRenderer(event) {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && event.sender.id === mainWindow.webContents.id
  )
}

function requireTrustedRenderer(event) {
  if (!isTrustedRenderer(event)) {
    throw new Error('Untrusted renderer request.')
  }
}

function allowMainWindowToClose() {
  if (mainWindowCloseTimer) {
    clearTimeout(mainWindowCloseTimer)
    mainWindowCloseTimer = undefined
  }

  mainWindowClosePending = false
  mainWindowCloseAllowed = true

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
  }
}

function registerDesktopIpc() {
  desktopStorage = createPersistentStorage(
    path.join(
      electronApplication.getPath('userData'),
      'persistent-state'
    )
  )

  ipcMain.handle(
    'fabsql:storage:get-item',
    async (event, key) => {
      requireTrustedRenderer(event)
      return desktopStorage.getItem(key)
    }
  )
  ipcMain.handle(
    'fabsql:storage:remove-item',
    async (event, key) => {
      requireTrustedRenderer(event)
      await desktopStorage.removeItem(key)
    }
  )
  ipcMain.handle(
    'fabsql:storage:set-item',
    async (event, key, value) => {
      requireTrustedRenderer(event)
      await desktopStorage.setItem(key, value)
    }
  )
  ipcMain.on('fabsql:close-ready', (event) => {
    if (isTrustedRenderer(event) && mainWindowClosePending) {
      allowMainWindowToClose()
    }
  })
}

async function closeWebApplication() {
  if (!webApplication) {
    return
  }

  const runningApplication = webApplication
  webApplication = undefined
  await runningApplication.close()
}

const hasSingleInstanceLock = electronApplication.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  electronApplication.quit()
} else {
  electronApplication.on('second-instance', () => {
    focusMainWindow()
  })

  electronApplication.on('window-all-closed', () => {
    electronApplication.quit()
  })

  electronApplication.on('before-quit', (event) => {
    if (!webApplication || applicationClosing) {
      return
    }

    event.preventDefault()
    applicationClosing = true

    void closeWebApplication().finally(() => {
      electronApplication.quit()
    })
  })

  electronApplication.whenReady()
    .then(launchApplication)
    .catch(async (error) => {
      console.error(error)
      dialog.showErrorBox(
        'FabSQL Builder failed to start',
        error instanceof Error ? error.message : String(error)
      )
      await closeWebApplication()
      electronApplication.exit(1)
    })
}
