import type {
  QueryParameterValue,
  QueryResultCell
} from '@sql-builder/shared'
import { Buffer } from 'node:buffer'
import type {
  Pool,
  RowsWithMeta
} from 'mariadb'

export interface QueryExecutionData {
  columns: string[]
  rows: QueryResultCell[][]
}

export interface QueryExecutor {
  execute(
    schemaName: string,
    sql: string,
    parameters: QueryParameterValue[]
  ): Promise<QueryExecutionData>
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``
}

function normalizeCell(value: unknown): QueryResultCell {
  if (value === null || value === undefined) {
    return null
  }

  if (
    typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value)
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Buffer.isBuffer(value)) {
    return `base64:${value.toString('base64')}`
  }

  const serialized = JSON.stringify(value)
  return serialized ?? String(value)
}

export class MariaDbQueryExecutor implements QueryExecutor {
  public constructor(private readonly pool: Pool) {}

  public async execute(
    schemaName: string,
    sql: string,
    parameters: QueryParameterValue[]
  ): Promise<QueryExecutionData> {
    const connection = await this.pool.getConnection()
    let transactionStarted = false

    try {
      await connection.query(`USE ${quoteIdentifier(schemaName)}`)
      await connection.query('START TRANSACTION READ ONLY')
      transactionStarted = true

      const rows = await connection.query<RowsWithMeta<unknown[]>>({
        sql,
        rowsAsArray: true,
        dateStrings: true,
        bigIntAsNumber: false,
        timeout: 5000
      }, parameters)

      return {
        columns: rows.meta.map((column) => column.name()),
        rows: rows.map((row) => row.map(normalizeCell))
      }
    } finally {
      if (transactionStarted) {
        await connection.rollback().catch(() => undefined)
      }

      await connection.release()
    }
  }
}
