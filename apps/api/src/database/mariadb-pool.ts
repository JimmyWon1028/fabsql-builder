import mariadb, { type Pool, type PoolConfig } from 'mariadb'

import type { ApplicationConfig } from '../config/environment.js'

export function createDatabasePool(config: ApplicationConfig['database']): Pool {
  const poolConfig: PoolConfig = {
    ...config,
    acquireTimeout: 5000,
    connectionLimit: 5,
    idleTimeout: 60
  }

  return mariadb.createPool(poolConfig)
}
