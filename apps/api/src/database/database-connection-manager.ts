import type {
  DatabaseConnectionApplyResponse,
  DatabaseConnectionInput,
  DatabaseConnectionSettings,
  DatabaseConnectionTestResponse,
  QueryParameterValue,
  QueryResultCell,
  SchemaColumn,
  SchemaTable
} from '@sql-builder/shared'
import type { Pool } from 'mariadb'

import type { ApplicationConfig } from '../config/environment.js'
import {
  MariaDbQueryExecutor,
  type QueryExecutor
} from '../modules/query/query-executor.js'
import {
  SchemaRepository,
  type SchemaDataSource
} from '../modules/schema/schema-repository.js'
import { createDatabasePool } from './mariadb-pool.js'

type DatabaseConfig = ApplicationConfig['database']

interface DatabaseRuntime {
  pool: Pool
  repository: SchemaRepository
  queryExecutor: MariaDbQueryExecutor
}

export interface DatabaseConnectionController {
  getSettings(): DatabaseConnectionSettings
  test(
    input: DatabaseConnectionInput
  ): Promise<DatabaseConnectionTestResponse>
  apply(
    input: DatabaseConnectionInput
  ): Promise<DatabaseConnectionApplyResponse>
}

function createRuntime(config: DatabaseConfig): DatabaseRuntime {
  const pool = createDatabasePool(config)

  return {
    pool,
    repository: new SchemaRepository(pool, config.database),
    queryExecutor: new MariaDbQueryExecutor(pool)
  }
}

function publicSettings(config: DatabaseConfig): DatabaseConnectionSettings {
  return {
    mode: config.socketPath ? 'socket' : 'network',
    database: config.database,
    user: config.user,
    host: config.host ?? '127.0.0.1',
    port: config.port ?? 3306,
    socketPath: config.socketPath ?? '/tmp/mysql.sock',
    passwordConfigured: Boolean(config.password)
  }
}

export class DatabaseConnectionManager
  implements SchemaDataSource, QueryExecutor, DatabaseConnectionController {
  private currentConfig: DatabaseConfig
  private runtime: DatabaseRuntime

  public constructor(config: DatabaseConfig) {
    this.currentConfig = { ...config }
    this.runtime = createRuntime(this.currentConfig)
  }

  public get databaseName(): string {
    return this.currentConfig.database
  }

  public getSettings(): DatabaseConnectionSettings {
    return publicSettings(this.currentConfig)
  }

  public async test(
    input: DatabaseConnectionInput
  ): Promise<DatabaseConnectionTestResponse> {
    const config = this.resolveConfig(input)
    const candidate = createRuntime(config)

    try {
      return await this.inspect(candidate.repository)
    } finally {
      await candidate.pool.end()
    }
  }

  public async apply(
    input: DatabaseConnectionInput
  ): Promise<DatabaseConnectionApplyResponse> {
    const config = this.resolveConfig(input)
    const candidate = createRuntime(config)
    let connection: DatabaseConnectionTestResponse

    try {
      connection = await this.inspect(candidate.repository)
    } catch (error) {
      await candidate.pool.end()
      throw error
    }

    const previousRuntime = this.runtime
    this.currentConfig = config
    this.runtime = candidate
    await previousRuntime.pool.end().catch(() => undefined)

    return {
      ...connection,
      settings: publicSettings(config)
    }
  }

  public getVersion(): Promise<string> {
    return this.runtime.repository.getVersion()
  }

  public listDatabases(): Promise<string[]> {
    return this.runtime.repository.listDatabases()
  }

  public listTables(schemaName?: string): Promise<SchemaTable[]> {
    return this.runtime.repository.listTables(schemaName)
  }

  public listColumns(
    tableName: string,
    schemaName?: string
  ): Promise<SchemaColumn[]> {
    return this.runtime.repository.listColumns(tableName, schemaName)
  }

  public execute(
    schemaName: string,
    sql: string,
    parameters: QueryParameterValue[]
  ): Promise<{
    columns: string[]
    rows: QueryResultCell[][]
  }> {
    return this.runtime.queryExecutor.execute(
      schemaName,
      sql,
      parameters
    )
  }

  public async close(): Promise<void> {
    await this.runtime.pool.end()
  }

  private resolveConfig(input: DatabaseConnectionInput): DatabaseConfig {
    const password = input.clearPassword
      ? undefined
      : input.password || this.currentConfig.password
    const sharedConfig = {
      database: input.database.trim(),
      user: input.user.trim(),
      ...(password ? { password } : {})
    }

    if (input.mode === 'socket') {
      return {
        ...sharedConfig,
        socketPath: input.socketPath.trim()
      }
    }

    return {
      ...sharedConfig,
      host: input.host.trim(),
      port: input.port
    }
  }

  private async inspect(
    repository: SchemaRepository
  ): Promise<DatabaseConnectionTestResponse> {
    const [version, databases] = await Promise.all([
      repository.getVersion(),
      repository.listDatabases()
    ])

    return {
      status: 'ok',
      version,
      databases
    }
  }
}
