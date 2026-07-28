import { userInfo } from 'node:os'

export interface ApplicationConfig {
  api: {
    host: string
    port: number
  }
  database: {
    database: string
    user: string
    password?: string
    socketPath?: string
    host?: string
    port?: number
  }
}

function readPort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`)
  }

  return port
}

export function loadApplicationConfig(): ApplicationConfig {
  const databaseHost = process.env.DB_HOST
  const databasePassword = process.env.DB_PASSWORD
  const database = {
    database: process.env.DB_NAME ?? 'lysm',
    user: process.env.DB_USER ?? userInfo().username,
    ...(databasePassword ? { password: databasePassword } : {}),
    ...(databaseHost
      ? {
          host: databaseHost,
          port: readPort(process.env.DB_PORT, 3306)
        }
      : {
          socketPath: process.env.DB_SOCKET ?? '/tmp/mysql.sock'
        })
  }

  return {
    api: {
      host: process.env.API_HOST ?? '127.0.0.1',
      port: readPort(process.env.API_PORT, 3100)
    },
    database
  }
}
