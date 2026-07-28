import type { QueryModel } from './query-model.js'

export type SchemaTableType = 'BASE TABLE' | 'VIEW'

export interface SchemaTable {
  name: string
  type: SchemaTableType
}

export interface SchemaColumn {
  name: string
  ordinalPosition: number
  dataType: string
  columnType: string
  nullable: boolean
  primaryKey: boolean
  indexed: boolean
  extra: string
  comment: string
}

export interface SchemaTablesResponse {
  schema: string
  tables: SchemaTable[]
  total: number
}

export interface SchemaDatabasesResponse {
  databases: string[]
  defaultDatabase: string
}

export interface SchemaColumnsResponse {
  schema: string
  table: string
  columns: SchemaColumn[]
}

export interface HealthResponse {
  status: 'ok'
  database: {
    name: string
    version: string
  }
}

export type DatabaseConnectionMode = 'socket' | 'network'

export interface DatabaseConnectionSettings {
  mode: DatabaseConnectionMode
  database: string
  user: string
  host: string
  port: number
  socketPath: string
  passwordConfigured: boolean
}

export interface DatabaseConnectionInput {
  mode: DatabaseConnectionMode
  database: string
  user: string
  host: string
  port: number
  socketPath: string
  password?: string
  clearPassword?: boolean
}

export interface DatabaseConnectionTestResponse {
  status: 'ok'
  version: string
  databases: string[]
}

export interface DatabaseConnectionApplyResponse
  extends DatabaseConnectionTestResponse {
  settings: DatabaseConnectionSettings
}

export interface ApiErrorResponse {
  message: string
}

export type QueryResultCell = string | number | boolean | null

export interface ExecuteQueryRequest {
  schema: string
  model: QueryModel
}

export interface ExecuteQueryResponse {
  columns: string[]
  rows: QueryResultCell[][]
  rowCount: number
  truncated: boolean
  durationMs: number
}

export * from './query-model.js'
export * from './query-compiler.js'
export * from './query-history.js'
export * from './query-validation.js'
