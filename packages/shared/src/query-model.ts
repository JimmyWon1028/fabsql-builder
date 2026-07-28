export type SqlDialect = 'mariadb'

export interface CanvasPosition {
  x: number
  y: number
}

export interface QueryTable {
  id: string
  name: string
  alias: string
  position: CanvasPosition
}

export interface FieldReference {
  tableId: string
  columnName: string
}

export type AggregateFunction =
  | 'none'
  | 'COUNT'
  | 'SUM'
  | 'AVG'
  | 'MIN'
  | 'MAX'

export interface SelectedField {
  id: string
  field: FieldReference
  alias: string
  aggregate: AggregateFunction
  distinct: boolean
}

export type JoinType = 'JOIN' | 'INNER' | 'LEFT' | 'RIGHT'

export interface QueryJoin {
  id: string
  type: JoinType
  left: FieldReference
  right: FieldReference
}

export type FilterConjunction = 'AND' | 'OR'

export type FilterOperator =
  | '='
  | '<>'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'LIKE'
  | 'NOT LIKE'
  | 'IN'
  | 'NOT IN'
  | 'BETWEEN'
  | 'IS NULL'
  | 'IS NOT NULL'

export type QueryParameterValue = string | number | boolean | null

export interface FilterCondition {
  id: string
  kind: 'condition'
  field: FieldReference
  operator: FilterOperator
  value?: QueryParameterValue | QueryParameterValue[]
  secondValue?: QueryParameterValue
}

export interface FilterGroup {
  id: string
  kind: 'group'
  conjunction: FilterConjunction
  children: FilterNode[]
}

export type FilterNode = FilterCondition | FilterGroup

export interface GroupingField {
  id: string
  field: FieldReference
}

export type SortDirection = 'ASC' | 'DESC'

export interface SortingField {
  id: string
  field: FieldReference
  direction: SortDirection
}

export interface QueryPagination {
  limit: number | null
  offset: number
}

export interface QueryModel {
  version: 1
  dialect: SqlDialect
  tables: QueryTable[]
  selectedFields: SelectedField[]
  joins: QueryJoin[]
  filters: FilterGroup
  grouping: GroupingField[]
  sorting: SortingField[]
  pagination: QueryPagination
}

const aggregateFunctions: ReadonlySet<unknown> = new Set([
  'none',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX'
])

const joinTypes: ReadonlySet<unknown> = new Set([
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT'
])

const filterConjunctions: ReadonlySet<unknown> = new Set([
  'AND',
  'OR'
])

const filterOperators: ReadonlySet<unknown> = new Set([
  '=',
  '<>',
  '>',
  '>=',
  '<',
  '<=',
  'LIKE',
  'NOT LIKE',
  'IN',
  'NOT IN',
  'BETWEEN',
  'IS NULL',
  'IS NOT NULL'
])

const sortDirections: ReadonlySet<unknown> = new Set([
  'ASC',
  'DESC'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isFieldReference(value: unknown): value is FieldReference {
  return isRecord(value)
    && typeof value.tableId === 'string'
    && typeof value.columnName === 'string'
}

function isParameterValue(value: unknown): value is QueryParameterValue {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || isFiniteNumber(value)
}

function isFilterNode(value: unknown, depth = 0): value is FilterNode {
  if (!isRecord(value) || depth > 20 || typeof value.id !== 'string') {
    return false
  }

  if (value.kind === 'group') {
    return filterConjunctions.has(value.conjunction)
      && Array.isArray(value.children)
      && value.children.every((child) => isFilterNode(child, depth + 1))
  }

  if (value.kind !== 'condition') {
    return false
  }

  const filterValue = value.value

  return isFieldReference(value.field)
    && filterOperators.has(value.operator)
    && (
      filterValue === undefined
      || isParameterValue(filterValue)
      || (
        Array.isArray(filterValue)
        && filterValue.every(isParameterValue)
      )
    )
    && (
      value.secondValue === undefined
      || isParameterValue(value.secondValue)
    )
}

function isFilterGroup(value: unknown): value is FilterGroup {
  return isRecord(value)
    && value.kind === 'group'
    && isFilterNode(value)
}

export function isQueryModel(value: unknown): value is QueryModel {
  if (
    !isRecord(value)
    || value.version !== 1
    || value.dialect !== 'mariadb'
    || !Array.isArray(value.tables)
    || !Array.isArray(value.selectedFields)
    || !Array.isArray(value.joins)
    || !Array.isArray(value.grouping)
    || !Array.isArray(value.sorting)
    || !isRecord(value.pagination)
  ) {
    return false
  }

  return value.tables.every((table) =>
    isRecord(table)
    && typeof table.id === 'string'
    && typeof table.name === 'string'
    && typeof table.alias === 'string'
    && isRecord(table.position)
    && isFiniteNumber(table.position.x)
    && isFiniteNumber(table.position.y)
  )
    && value.selectedFields.every((field) =>
      isRecord(field)
      && typeof field.id === 'string'
      && isFieldReference(field.field)
      && typeof field.alias === 'string'
      && aggregateFunctions.has(field.aggregate)
      && typeof field.distinct === 'boolean'
    )
    && value.joins.every((join) =>
      isRecord(join)
      && typeof join.id === 'string'
      && joinTypes.has(join.type)
      && isFieldReference(join.left)
      && isFieldReference(join.right)
    )
    && isFilterGroup(value.filters)
    && value.grouping.every((grouping) =>
      isRecord(grouping)
      && typeof grouping.id === 'string'
      && isFieldReference(grouping.field)
    )
    && value.sorting.every((sorting) =>
      isRecord(sorting)
      && typeof sorting.id === 'string'
      && isFieldReference(sorting.field)
      && sortDirections.has(sorting.direction)
    )
    && (
      value.pagination.limit === null
      || isFiniteNumber(value.pagination.limit)
    )
    && isFiniteNumber(value.pagination.offset)
}

export function createEmptyQueryModel(): QueryModel {
  return {
    version: 1,
    dialect: 'mariadb',
    tables: [],
    selectedFields: [],
    joins: [],
    filters: {
      id: 'filter-root',
      kind: 'group',
      conjunction: 'AND',
      children: []
    },
    grouping: [],
    sorting: [],
    pagination: {
      limit: null,
      offset: 0
    }
  }
}

function cloneQueryDataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneQueryDataValue)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneQueryDataValue(item)
      ])
    )
  }

  return value
}

export function cloneQueryData<Value>(value: Value): Value {
  return cloneQueryDataValue(value) as Value
}

export function cloneQueryModel(model: QueryModel): QueryModel {
  return cloneQueryData(model)
}

export function serializeQueryModel(model: QueryModel): string {
  return JSON.stringify(model, null, 2)
}

export function deserializeQueryModel(serialized: string): QueryModel {
  const value: unknown = JSON.parse(serialized)

  if (!isQueryModel(value)) {
    throw new Error('Unsupported or invalid Query Model.')
  }

  return value
}
