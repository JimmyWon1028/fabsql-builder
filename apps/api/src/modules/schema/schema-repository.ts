import type {
  SchemaColumn,
  SchemaTable,
  SchemaTableType
} from '@sql-builder/shared'
import type { Pool } from 'mariadb'

interface TableMetadataRow {
  tableName: string
  tableType: SchemaTableType
}

interface ColumnMetadataRow {
  columnName: string
  ordinalPosition: number
  dataType: string
  columnType: string
  isNullable: 'YES' | 'NO'
  columnKey: '' | 'PRI' | 'UNI' | 'MUL'
  extra: string
  comment: string
}

interface VersionRow {
  version: string
}

interface DatabaseMetadataRow {
  schemaName: string
}

export interface SchemaDataSource {
  getVersion(): Promise<string>
  listDatabases(): Promise<string[]>
  listTables(schemaName?: string): Promise<SchemaTable[]>
  listColumns(
    tableName: string,
    schemaName?: string
  ): Promise<SchemaColumn[]>
}

export class SchemaRepository implements SchemaDataSource {
  public constructor(
    private readonly pool: Pool,
    private readonly defaultSchemaName: string
  ) {}

  public async getVersion(): Promise<string> {
    const rows = await this.pool.query<VersionRow[]>(
      'SELECT VERSION() AS version'
    )

    return rows[0]?.version ?? 'unknown'
  }

  public async listDatabases(): Promise<string[]> {
    const metadataRows = await this.pool.query<DatabaseMetadataRow[]>(
      `
        SELECT SCHEMA_NAME AS schemaName
        FROM INFORMATION_SCHEMA.SCHEMATA
        WHERE SCHEMA_NAME NOT IN (
          'information_schema',
          'mysql',
          'performance_schema',
          'sys'
        )
        ORDER BY SCHEMA_NAME
      `
    )

    return metadataRows.map((row) => row.schemaName)
  }

  public async listTables(
    schemaName = this.defaultSchemaName
  ): Promise<SchemaTable[]> {
    const metadataRows = await this.pool.query<TableMetadataRow[]>(
      `
        SELECT
          TABLE_NAME AS tableName,
          TABLE_TYPE AS tableType
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME
      `,
      [schemaName]
    )

    return metadataRows.map((row) => ({
      name: row.tableName,
      type: row.tableType
    }))
  }

  public async listColumns(
    tableName: string,
    schemaName = this.defaultSchemaName
  ): Promise<SchemaColumn[]> {
    const metadataRows = await this.pool.query<ColumnMetadataRow[]>(
      `
        SELECT
          COLUMN_NAME AS columnName,
          ORDINAL_POSITION AS ordinalPosition,
          DATA_TYPE AS dataType,
          COLUMN_TYPE AS columnType,
          IS_NULLABLE AS isNullable,
          COLUMN_KEY AS columnKey,
          EXTRA AS extra,
          COLUMN_COMMENT AS comment
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `,
      [schemaName, tableName]
    )

    return metadataRows.map((row) => ({
      name: row.columnName,
      ordinalPosition: Number(row.ordinalPosition),
      dataType: row.dataType,
      columnType: row.columnType,
      nullable: row.isNullable === 'YES',
      primaryKey: row.columnKey === 'PRI',
      indexed: row.columnKey !== '',
      extra: row.extra,
      comment: row.comment
    }))
  }
}
