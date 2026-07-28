const {
  contextBridge,
  ipcRenderer
} = require('electron')

contextBridge.exposeInMainWorld('fabSQLDesktop', {
  runtime: 'electron',
  platform: process.platform,
  storage: {
    getItem: (key) =>
      ipcRenderer.invoke('fabsql:storage:get-item', key),
    removeItem: (key) =>
      ipcRenderer.invoke('fabsql:storage:remove-item', key),
    setItem: (key, value) =>
      ipcRenderer.invoke('fabsql:storage:set-item', key, value)
  },
  onCloseRequested: (callback) => {
    const listener = () => callback()

    ipcRenderer.on('fabsql:prepare-to-close', listener)

    return () => {
      ipcRenderer.removeListener('fabsql:prepare-to-close', listener)
    }
  },
  completeClose: () => {
    ipcRenderer.send('fabsql:close-ready')
  }
})
