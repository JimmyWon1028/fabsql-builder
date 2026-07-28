interface DesktopStorage {
  getItem(key: string): Promise<string | null>
  removeItem(key: string): Promise<void>
  setItem(key: string, value: string): Promise<void>
}

interface FabSQLDesktopBridge {
  runtime: 'electron'
  platform: string
  storage: DesktopStorage
  onCloseRequested(callback: () => void): () => void
  completeClose(): void
}

declare global {
  interface Window {
    fabSQLDesktop?: FabSQLDesktopBridge
  }
}

function desktopBridge(): FabSQLDesktopBridge | undefined {
  return window.fabSQLDesktop?.runtime === 'electron'
    ? window.fabSQLDesktop
    : undefined
}

export function isElectronRuntime(): boolean {
  return Boolean(desktopBridge())
}

export async function getPersistentItem(
  key: string
): Promise<string | null> {
  const bridge = desktopBridge()

  if (bridge) {
    return bridge.storage.getItem(key)
  }

  return localStorage.getItem(key)
}

export async function removePersistentItem(
  key: string
): Promise<void> {
  const bridge = desktopBridge()

  if (bridge) {
    await bridge.storage.removeItem(key)
    return
  }

  localStorage.removeItem(key)
}

export async function setPersistentItem(
  key: string,
  value: string
): Promise<void> {
  const bridge = desktopBridge()

  if (bridge) {
    await bridge.storage.setItem(key, value)
    return
  }

  localStorage.setItem(key, value)
}

export function onElectronCloseRequested(
  saveState: () => Promise<void>
): () => void {
  const bridge = desktopBridge()

  if (!bridge) {
    return () => undefined
  }

  return bridge.onCloseRequested(() => {
    void saveState().finally(() => {
      bridge.completeClose()
    })
  })
}
