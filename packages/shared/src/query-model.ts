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
  source?: QueryDerivedTableSource
}

export interface QueryDerivedTableSource {
  kind: 'subquery'
  query: QueryModel
}

export interface FieldReference {
  tableId: string
  columnName: string
}

export interface QueryFieldExpression {
  kind: 'field'
  field: FieldReference
}

export interface QueryLiteralExpression {
  kind: 'literal'
  value: QueryParameterValue
}

export interface QueryNamedParameter {
  kind: 'parameter'
  name: string
}

export interface QueryFunctionExpression {
  kind: 'function'
  name: string
  arguments: QueryExpression[]
}

export interface QueryBinaryExpression {
  kind: 'binary'
  operator:
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '='
    | '<>'
    | '>'
    | '>='
    | '<'
    | '<='
  left: QueryExpression
  right: QueryExpression
}

export interface QueryUnaryExpression {
  kind: 'unary'
  operator: '+' | '-'
  operand: QueryExpression
}

export interface QueryAggregateExpression {
  kind: 'aggregate'
  name: string
  argument: QueryExpression
  distinct: boolean
  ordering?: QueryExpressionOrdering[]
}

export interface QueryExpressionOrdering {
  expression: QueryExpression
  direction: SortDirection
}

export interface QuerySubqueryExpression {
  kind: 'subquery'
  query: QueryModel
}

export interface QueryCaseBranch {
  when: QueryExpression
  then: QueryExpression
}

export interface QueryCaseExpression {
  kind: 'case'
  operand?: QueryExpression
  branches: QueryCaseBranch[]
  elseExpression?: QueryExpression
}

export type QueryExpression =
  | QueryFieldExpression
  | QueryLiteralExpression
  | QueryNamedParameter
  | QueryFunctionExpression
  | QueryBinaryExpression
  | QueryUnaryExpression
  | QueryAggregateExpression
  | QuerySubqueryExpression
  | QueryCaseExpression

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
  expression?: QueryExpression
  alias: string
  aggregate: AggregateFunction
  distinct: boolean
}

export type JoinType = 'JOIN' | 'INNER' | 'LEFT' | 'RIGHT'

export interface QueryJoin {
  id: string
  type: JoinType
  joinedTableId?: string
  left: FieldReference
  right: FieldReference
  conditions?: FilterGroup
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
export type QueryFilterValue = QueryParameterValue | QueryNamedParameter

export interface FilterCondition {
  id: string
  kind: 'condition'
  field: FieldReference
  expression?: QueryExpression
  rightExpression?: QueryExpression
  operator: FilterOperator
  value?: QueryFilterValue | QueryFilterValue[]
  secondValue?: QueryFilterValue
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
  expression?: QueryExpression
  outputReference?: string
  direction: SortDirection
}

export interface QueryPagination {
  limit: number | null
  offset: number
}

export type QuerySetOperator = 'UNION' | 'UNION ALL'

export interface QuerySetOperation {
  id: string
  operator: QuerySetOperator
  query: QueryModel
}

export interface QueryModel {
  version: 1
  dialect: SqlDialect
  distinct?: boolean
  sourceSql?: string
  externalTables?: QueryExternalTableReference[]
  tables: QueryTable[]
  selectedFields: SelectedField[]
  joins: QueryJoin[]
  filters: FilterGroup
  grouping: GroupingField[]
  sorting: SortingField[]
  pagination: QueryPagination
  setOperations?: QuerySetOperation[]
}

export interface QueryExternalTableReference {
  id: string
  alias: string
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

const setOperators: ReadonlySet<unknown> = new Set([
  'UNION',
  'UNION ALL'
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

function isNamedParameter(value: unknown): value is QueryNamedParameter {
  return isRecord(value)
    && value.kind === 'parameter'
    && typeof value.name === 'string'
    && value.name.trim().length > 0
}

function isQueryExpression(
  value: unknown,
  depth = 0
): value is QueryExpression {
  if (!isRecord(value) || depth > 30 || typeof value.kind !== 'string') {
    return false
  }

  switch (value.kind) {
    case 'field':
      return isFieldReference(value.field)
    case 'literal':
      return isParameterValue(value.value)
    case 'parameter':
      return isNamedParameter(value)
    case 'function':
      return typeof value.name === 'string'
        && value.name.trim().length > 0
        && Array.isArray(value.arguments)
        && value.arguments.every((argument) =>
          isQueryExpression(argument, depth + 1)
        )
    case 'binary':
      return (
        value.operator === '+'
        || value.operator === '-'
        || value.operator === '*'
        || value.operator === '/'
        || value.operator === '%'
        || value.operator === '='
        || value.operator === '<>'
        || value.operator === '>'
        || value.operator === '>='
        || value.operator === '<'
        || value.operator === '<='
      )
        && isQueryExpression(value.left, depth + 1)
        && isQueryExpression(value.right, depth + 1)
    case 'unary':
      return (value.operator === '+' || value.operator === '-')
        && isQueryExpression(value.operand, depth + 1)
    case 'aggregate':
      return typeof value.name === 'string'
        && value.name.trim().length > 0
        && typeof value.distinct === 'boolean'
        && isQueryExpression(value.argument, depth + 1)
        && (
          value.ordering === undefined
          || (
            Array.isArray(value.ordering)
            && value.ordering.every((ordering) =>
              isRecord(ordering)
              && sortDirections.has(ordering.direction)
              && isQueryExpression(ordering.expression, depth + 1)
            )
          )
        )
    case 'subquery':
      return isQueryModelValue(value.query, depth + 1)
    case 'case':
      return (
        value.operand === undefined
        || isQueryExpression(value.operand, depth + 1)
      )
        && Array.isArray(value.branches)
        && value.branches.length > 0
        && value.branches.every((branch) =>
          isRecord(branch)
          && isQueryExpression(branch.when, depth + 1)
          && isQueryExpression(branch.then, depth + 1)
        )
        && (
          value.elseExpression === undefined
          || isQueryExpression(value.elseExpression, depth + 1)
        )
    default:
      return false
  }
}

function isFilterValue(value: unknown): value is QueryFilterValue {
  return isParameterValue(value) || isNamedParameter(value)
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
    && (
      value.expression === undefined
      || isQueryExpression(value.expression, depth + 1)
    )
    && (
      value.rightExpression === undefined
      || isQueryExpression(value.rightExpression, depth + 1)
    )
    && filterOperators.has(value.operator)
    && (
      filterValue === undefined
      || isFilterValue(filterValue)
      || (
        Array.isArray(filterValue)
        && filterValue.every(isFilterValue)
      )
    )
    && (
      value.secondValue === undefined
      || isFilterValue(value.secondValue)
    )
}

function isFilterGroup(value: unknown): value is FilterGroup {
  return isRecord(value)
    && value.kind === 'group'
    && isFilterNode(value)
}

function isQueryModelValue(
  value: unknown,
  depth: number
): value is QueryModel {
  if (
    !isRecord(value)
    || depth > 10
    || value.version !== 1
    || value.dialect !== 'mariadb'
    || (
      value.distinct !== undefined
      && typeof value.distinct !== 'boolean'
    )
    || (
      value.sourceSql !== undefined
      && typeof value.sourceSql !== 'string'
    )
    || !Array.isArray(value.tables)
    || !Array.isArray(value.selectedFields)
    || !Array.isArray(value.joins)
    || !Array.isArray(value.grouping)
    || !Array.isArray(value.sorting)
    || !isRecord(value.pagination)
  ) {
    return false
  }

  return (
    value.externalTables === undefined
    || (
      Array.isArray(value.externalTables)
      && value.externalTables.every((table) =>
        isRecord(table)
        && typeof table.id === 'string'
        && typeof table.alias === 'string'
      )
    )
  )
    && value.tables.every((table) =>
    isRecord(table)
    && typeof table.id === 'string'
    && typeof table.name === 'string'
    && typeof table.alias === 'string'
    && isRecord(table.position)
    && isFiniteNumber(table.position.x)
    && isFiniteNumber(table.position.y)
    && (
      table.source === undefined
      || (
        isRecord(table.source)
        && table.source.kind === 'subquery'
        && isQueryModelValue(table.source.query, depth + 1)
      )
    )
  )
    && value.selectedFields.every((field) =>
      isRecord(field)
      && typeof field.id === 'string'
      && isFieldReference(field.field)
      && (
        field.expression === undefined
        || isQueryExpression(field.expression)
      )
      && typeof field.alias === 'string'
      && aggregateFunctions.has(field.aggregate)
      && typeof field.distinct === 'boolean'
    )
    && value.joins.every((join) =>
      isRecord(join)
      && typeof join.id === 'string'
      && joinTypes.has(join.type)
      && (
        join.joinedTableId === undefined
        || typeof join.joinedTableId === 'string'
      )
      && isFieldReference(join.left)
      && isFieldReference(join.right)
      && (
        join.conditions === undefined
        || isFilterGroup(join.conditions)
      )
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
      && (
        sorting.expression === undefined
        || isQueryExpression(sorting.expression)
      )
      && (
        sorting.outputReference === undefined
        || typeof sorting.outputReference === 'string'
      )
      && sortDirections.has(sorting.direction)
    )
    && (
      value.pagination.limit === null
      || isFiniteNumber(value.pagination.limit)
    )
    && isFiniteNumber(value.pagination.offset)
    && (
      value.setOperations === undefined
      || (
        Array.isArray(value.setOperations)
        && value.setOperations.every((operation) =>
          isRecord(operation)
          && typeof operation.id === 'string'
          && setOperators.has(operation.operator)
          && isQueryModelValue(operation.query, depth + 1)
        )
      )
    )
}

export function isQueryModel(value: unknown): value is QueryModel {
  return isQueryModelValue(value, 0)
}

export function createEmptyQueryModel(): QueryModel {
  return {
    version: 1,
    dialect: 'mariadb',
    distinct: false,
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

export function queryExpressionReferencesTable(
  expression: QueryExpression,
  tableId: string
): boolean {
  switch (expression.kind) {
    case 'field':
      return expression.field.tableId === tableId
    case 'function':
      return expression.arguments.some((argument) =>
        queryExpressionReferencesTable(argument, tableId)
      )
    case 'binary':
      return queryExpressionReferencesTable(expression.left, tableId)
        || queryExpressionReferencesTable(expression.right, tableId)
    case 'unary':
      return queryExpressionReferencesTable(expression.operand, tableId)
    case 'aggregate':
      return queryExpressionReferencesTable(expression.argument, tableId)
        || (
          expression.ordering?.some((ordering) =>
            queryExpressionReferencesTable(ordering.expression, tableId)
          ) ?? false
        )
    case 'subquery':
      return queryModelReferencesTable(expression.query, tableId)
    case 'case':
      return (
        expression.operand !== undefined
        && queryExpressionReferencesTable(expression.operand, tableId)
      )
        || expression.branches.some((branch) =>
          queryExpressionReferencesTable(branch.when, tableId)
          || queryExpressionReferencesTable(branch.then, tableId)
        )
        || (
          expression.elseExpression !== undefined
          && queryExpressionReferencesTable(
            expression.elseExpression,
            tableId
          )
        )
    default:
      return false
  }
}

function filterNodeReferencesTable(
  node: FilterNode,
  tableId: string
): boolean {
  if (node.kind === 'group') {
    return node.children.some((child) =>
      filterNodeReferencesTable(child, tableId)
    )
  }

  return node.field.tableId === tableId
    || (
      node.expression !== undefined
      && queryExpressionReferencesTable(node.expression, tableId)
    )
    || (
      node.rightExpression !== undefined
      && queryExpressionReferencesTable(node.rightExpression, tableId)
    )
}

function queryModelReferencesTable(
  model: QueryModel,
  tableId: string
): boolean {
  return model.selectedFields.some((field) =>
    field.expression !== undefined
      ? queryExpressionReferencesTable(field.expression, tableId)
      : field.field.tableId === tableId
  )
    || model.joins.some((join) =>
      join.left.tableId === tableId
      || join.right.tableId === tableId
      || (
        join.conditions !== undefined
        && filterNodeReferencesTable(join.conditions, tableId)
      )
    )
    || filterNodeReferencesTable(model.filters, tableId)
    || model.grouping.some((field) => field.field.tableId === tableId)
    || model.sorting.some((field) =>
      field.expression !== undefined
        ? queryExpressionReferencesTable(field.expression, tableId)
        : field.field.tableId === tableId
    )
    || (
      model.setOperations?.some((operation) =>
        queryModelReferencesTable(operation.query, tableId)
      ) ?? false
    )
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
