import type {
  AggregateFunction,
  FieldReference,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOperator,
  QueryExpression,
  QueryFilterValue,
  QueryModel,
  QueryParameterValue,
  QueryTable,
  SelectedField
} from '@sql-builder/shared'
import {
  createEmptyQueryModel,
  validateQueryModel
} from '@sql-builder/shared'
import { Parser } from 'node-sql-parser/build/mariadb'

type AstNode = Record<string, unknown>

interface SqlWordToken {
  value: string
  offset: number
  depth: number
}

const parser = new Parser()
let importIdSequence = 0
const aggregateFunctions = new Set<AggregateFunction>([
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX'
])
const comparisonOperators = new Set<FilterOperator>([
  '=',
  '<>',
  '>',
  '>=',
  '<',
  '<=',
  'LIKE',
  'NOT LIKE'
])
const expressionBinaryOperators = new Set<string>([
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '<>',
  '>',
  '>=',
  '<',
  '<='
])

export type SqlImportErrorCode =
  | 'syntax'
  | 'single-statement'
  | 'select-only'
  | 'unsupported-query'
  | 'table-required'
  | 'unsupported-table'
  | 'unsupported-select-expression'
  | 'column-reference'
  | 'unsupported-join'
  | 'unsupported-join-condition'
  | 'unsupported-filter'
  | 'parameter-missing'
  | 'unsupported-grouping'
  | 'unsupported-sorting'
  | 'unsupported-pagination'
  | 'invalid-model'

export class SqlImportError extends Error {
  public constructor(
    public readonly code: SqlImportErrorCode,
    public readonly detail = ''
  ) {
    super(detail || code)
    this.name = 'SqlImportError'
  }
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (isNode(value) && typeof value.value === 'string') {
    return value.value
  }

  return ''
}

function tokenizeSqlWords(sql: string): SqlWordToken[] {
  const tokens: SqlWordToken[] = []
  let index = 0
  let depth = 0

  while (index < sql.length) {
    const character = sql[index]!
    const nextCharacter = sql[index + 1]

    if (character === "'" || character === '"' || character === '`') {
      const quote = character

      index += 1
      while (index < sql.length) {
        if (sql[index] === '\\') {
          index += 2
          continue
        }
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2
            continue
          }
          index += 1
          break
        }
        index += 1
      }
      continue
    }

    if (
      character === '#'
      || (character === '-' && nextCharacter === '-')
    ) {
      index += character === '#' ? 1 : 2
      while (index < sql.length && sql[index] !== '\n') {
        index += 1
      }
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      index += 2
      while (
        index < sql.length
        && !(sql[index] === '*' && sql[index + 1] === '/')
      ) {
        index += 1
      }
      index = Math.min(index + 2, sql.length)
      continue
    }

    if (character === '(') {
      depth += 1
      index += 1
      continue
    }

    if (character === ')') {
      depth = Math.max(0, depth - 1)
      index += 1
      continue
    }

    if (/[A-Za-z_]/.test(character)) {
      const offset = index

      index += 1
      while (
        index < sql.length
        && /[A-Za-z0-9_$]/.test(sql[index]!)
      ) {
        index += 1
      }

      tokens.push({
        value: sql.slice(offset, index).toUpperCase(),
        offset,
        depth
      })
      continue
    }

    index += 1
  }

  return tokens
}

function astStartOffset(value: unknown): number | undefined {
  if (!isNode(value)) {
    if (Array.isArray(value)) {
      return value
        .map(astStartOffset)
        .filter((offset): offset is number => offset !== undefined)
        .sort((left, right) => left - right)[0]
    }
    return undefined
  }

  const location = isNode(value.loc) ? value.loc : undefined
  const start = location && isNode(location.start)
    ? location.start
    : undefined
  const ownOffset = start && typeof start.offset === 'number'
    ? start.offset
    : undefined
  const childOffset = Object.entries(value)
    .filter(([key]) => key !== 'loc')
    .map(([, item]) => astStartOffset(item))
    .filter((offset): offset is number => offset !== undefined)
    .sort((left, right) => left - right)[0]

  if (ownOffset === undefined) {
    return childOffset
  }

  return childOffset === undefined
    ? ownOffset
    : Math.min(ownOffset, childOffset)
}

function sourceInnerJoinType(
  astTable: AstNode,
  tokens: SqlWordToken[]
): 'JOIN' | 'INNER JOIN' | undefined {
  if (stringValue(astTable.join).toUpperCase() !== 'INNER JOIN') {
    return undefined
  }

  const conditionOffset = astStartOffset(astTable.on)

  if (conditionOffset === undefined) {
    return undefined
  }

  const onToken = tokens
    .filter((token) =>
      token.value === 'ON' && token.offset < conditionOffset
    )
    .sort((left, right) => right.offset - left.offset)[0]

  if (!onToken) {
    return undefined
  }

  const joinToken = tokens
    .filter((token) =>
      token.value === 'JOIN'
      && token.depth === onToken.depth
      && token.offset < onToken.offset
    )
    .sort((left, right) => right.offset - left.offset)[0]

  if (!joinToken) {
    return undefined
  }

  const previousToken = tokens
    .filter((token) =>
      token.depth === joinToken.depth
      && token.offset < joinToken.offset
    )
    .sort((left, right) => right.offset - left.offset)[0]

  return previousToken?.value === 'INNER' ? 'INNER JOIN' : 'JOIN'
}

function restoreSourceJoinTypes(
  value: unknown,
  tokens: SqlWordToken[],
  visited = new Set<object>()
): void {
  if (!isNode(value) && !Array.isArray(value)) {
    return
  }

  if (visited.has(value)) {
    return
  }
  visited.add(value)

  if (
    isNode(value)
    && value.type === 'select'
    && Array.isArray(value.from)
  ) {
    value.from.slice(1).forEach((table) => {
      if (!isNode(table)) {
        return
      }

      const sourceType = sourceInnerJoinType(table, tokens)

      if (sourceType) {
        table.join = sourceType
      }
    })
  }

  const children = Array.isArray(value)
    ? value
    : Object.entries(value)
        .filter(([key]) => key !== 'loc')
        .map(([, item]) => item)

  children.forEach((child) => {
    restoreSourceJoinTypes(child, tokens, visited)
  })
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function importError(
  code: SqlImportErrorCode,
  detail = ''
): never {
  throw new SqlImportError(code, detail)
}

function createImportId(prefix: string, index: number): string {
  importIdSequence += 1
  return `sql-${prefix}-${Date.now().toString(36)}-${
    importIdSequence.toString(36)
  }-${index + 1}`
}

function defaultTablePosition(index: number): { x: number; y: number } {
  return {
    x: 30 + (index % 4) * 220,
    y: 30 + Math.floor(index / 4) * 205
  }
}

function tableMatches(
  table: QueryTable,
  name: string,
  alias: string,
  derived: boolean
): boolean {
  if (derived) {
    return table.source?.kind === 'subquery'
      && normalize(table.alias) === normalize(alias)
  }

  return normalize(table.name) === normalize(name)
    && normalize(table.alias || table.name) === normalize(alias)
}

function parseTables(
  from: unknown,
  currentModel: QueryModel,
  externalTables: QueryTable[] = []
): {
  astTables: AstNode[]
  tables: QueryTable[]
  tablesByQualifier: Map<string, QueryTable>
} {
  if (!Array.isArray(from) || from.length === 0) {
    return importError('table-required')
  }

  const astTables = from.map((value) => {
    const derived = isNode(value)
      && isNode(value.expr)
      && isNode(value.expr.ast)

    if (
      !isNode(value)
      || value.db
      || (
        !derived
        && (
          typeof value.table !== 'string'
          || isNode(value.expr)
        )
      )
      || (
        derived
        && !stringValue(value.as)
      )
    ) {
      return importError('unsupported-table')
    }

    return value
  })
  const usedCurrentTableIds = new Set<string>()
  const tables = astTables.map((astTable, index) => {
    const derived = isNode(astTable.expr)
      && isNode(astTable.expr.ast)
    const baseName = stringValue(astTable.table)
    const alias = stringValue(astTable.as) || baseName
    const name = derived ? alias : baseName
    const existingTable = currentModel.tables.find((table) =>
      !usedCurrentTableIds.has(table.id)
      && tableMatches(table, name, alias, derived)
    )

    if (existingTable) {
      usedCurrentTableIds.add(existingTable.id)
    }

    return {
      id: existingTable?.id ?? createImportId('table', index),
      name,
      alias,
      position: existingTable
        ? { ...existingTable.position }
        : defaultTablePosition(index)
    }
  })
  const tablesByQualifier = new Map<string, QueryTable>()

  tables.forEach((table) => {
    const alias = normalize(table.alias || table.name)
    const name = normalize(table.name)

    if (tablesByQualifier.has(alias)) {
      return importError('unsupported-table')
    }

    tablesByQualifier.set(alias, table)

    if (!tablesByQualifier.has(name)) {
      tablesByQualifier.set(name, table)
    }
  })

  externalTables.forEach((table) => {
    const alias = normalize(table.alias || table.name)
    const name = normalize(table.name)

    if (!tablesByQualifier.has(alias)) {
      tablesByQualifier.set(alias, table)
    }

    if (!tablesByQualifier.has(name)) {
      tablesByQualifier.set(name, table)
    }
  })

  return {
    astTables,
    tables,
    tablesByQualifier
  }
}

function parseColumnReference(
  value: unknown,
  tables: QueryTable[],
  tablesByQualifier: Map<string, QueryTable>
): FieldReference {
  if (
    !isNode(value)
    || value.type !== 'column_ref'
    || typeof value.column !== 'string'
    || value.column === '*'
  ) {
    return importError('column-reference')
  }

  const qualifier = stringValue(value.table)
  let table: QueryTable | undefined

  if (qualifier) {
    table = tablesByQualifier.get(normalize(qualifier))
  } else {
    table = tables[0]
  }

  if (!table) {
    return importError('column-reference')
  }

  return {
    tableId: table.id,
    columnName: value.column
  }
}

function parseParameterValue(
  value: unknown,
  parameters: QueryParameterValue[],
  parameterIndex: { value: number }
): QueryFilterValue {
  if (!isNode(value) || typeof value.type !== 'string') {
    return importError('unsupported-filter')
  }

  if (value.type === 'origin' && value.value === '?') {
    if (parameterIndex.value >= parameters.length) {
      return importError('parameter-missing')
    }

    const parameter = parameters[parameterIndex.value]
    parameterIndex.value += 1
    return parameter!
  }

  if (value.type === 'var' && typeof value.name === 'string') {
    return {
      kind: 'parameter',
      name: value.name.replace(/^@/, '')
    }
  }

  if (
    value.type === 'number'
    || value.type === 'bool'
    || value.type === 'boolean'
    || value.type === 'single_quote_string'
    || value.type === 'double_quote_string'
    || value.type === 'string'
    || value.type === 'natural_string'
    || value.type === 'null'
  ) {
    const result = value.value

    if (
      result === null
      || typeof result === 'string'
      || typeof result === 'number'
      || typeof result === 'boolean'
    ) {
      return result
    }
  }

  return importError('unsupported-filter')
}

function functionName(value: AstNode): string {
  if (!isNode(value.name) || !Array.isArray(value.name.name)) {
    return importError('unsupported-select-expression')
  }

  const parts = value.name.name.map(stringValue).filter(Boolean)

  if (parts.length !== 1) {
    return importError('unsupported-select-expression')
  }

  return parts[0]!
}

function parseExpression(
  value: unknown,
  tables: QueryTable[],
  tablesByQualifier: Map<string, QueryTable>,
  parameters: QueryParameterValue[],
  parameterIndex: { value: number },
  externalTables: QueryTable[] = []
): QueryExpression {
  if (isNode(value) && isNode(value.ast)) {
    return {
      kind: 'subquery',
      query: parseSelectAst(
        value.ast,
        createEmptyQueryModel(),
        parameters,
        parameterIndex,
        [...tables, ...externalTables]
      )
    }
  }

  if (!isNode(value) || typeof value.type !== 'string') {
    return importError('unsupported-select-expression')
  }

  if (value.type === 'column_ref') {
    return {
      kind: 'field',
      field: parseColumnReference(value, tables, tablesByQualifier)
    }
  }

  if (
    value.type === 'origin'
    || value.type === 'var'
    || value.type === 'number'
    || value.type === 'bool'
    || value.type === 'boolean'
    || value.type === 'single_quote_string'
    || value.type === 'double_quote_string'
    || value.type === 'string'
    || value.type === 'natural_string'
    || value.type === 'null'
  ) {
    const parsedValue = parseParameterValue(
      value,
      parameters,
      parameterIndex
    )

    return typeof parsedValue === 'object' && parsedValue !== null
      ? parsedValue
      : {
          kind: 'literal',
          value: parsedValue
        }
  }

  if (value.type === 'case' && Array.isArray(value.args)) {
    const branches: Array<{
      when: QueryExpression
      then: QueryExpression
    }> = []
    let elseExpression: QueryExpression | undefined

    value.args.forEach((argument) => {
      if (
        !isNode(argument)
        || !isNode(argument.result)
        || (argument.type !== 'when' && argument.type !== 'else')
      ) {
        return importError('unsupported-select-expression')
      }

      if (argument.type === 'else') {
        elseExpression = parseExpression(
          argument.result,
          tables,
          tablesByQualifier,
          parameters,
          parameterIndex,
          externalTables
        )
        return
      }

      if (!isNode(argument.cond)) {
        return importError('unsupported-select-expression')
      }

      branches.push({
        when: parseExpression(
          argument.cond,
          tables,
          tablesByQualifier,
          parameters,
          parameterIndex,
          externalTables
        ),
        then: parseExpression(
          argument.result,
          tables,
          tablesByQualifier,
          parameters,
          parameterIndex,
          externalTables
        )
      })
    })

    if (branches.length === 0) {
      return importError('unsupported-select-expression')
    }

    return {
      kind: 'case',
      operand: isNode(value.expr)
        ? parseExpression(
            value.expr,
            tables,
            tablesByQualifier,
            parameters,
            parameterIndex,
            externalTables
          )
        : undefined,
      branches,
      elseExpression
    }
  }

  if (value.type === 'function') {
    const args = isNode(value.args) && Array.isArray(value.args.value)
      ? value.args.value
      : []

    return {
      kind: 'function',
      name: functionName(value),
      arguments: args.map((argument) =>
        parseExpression(
          argument,
          tables,
          tablesByQualifier,
          parameters,
          parameterIndex,
          externalTables
        )
      )
    }
  }

  if (
    value.type === 'aggr_func'
    && typeof value.name === 'string'
    && isNode(value.args)
    && isNode(value.args.expr)
  ) {
    const ordering = Array.isArray(value.args.orderby)
      ? value.args.orderby.map((item) => {
          if (!isNode(item) || !isNode(item.expr)) {
            return importError('unsupported-select-expression')
          }

          const direction = stringValue(item.type).toUpperCase() || 'ASC'

          if (direction !== 'ASC' && direction !== 'DESC') {
            return importError('unsupported-select-expression')
          }

          return {
            expression: parseExpression(
              item.expr,
              tables,
              tablesByQualifier,
              parameters,
              parameterIndex,
              externalTables
            ),
            direction: direction as 'ASC' | 'DESC'
          }
        })
      : undefined

    return {
      kind: 'aggregate',
      name: value.name,
      argument: parseExpression(
        value.args.expr,
        tables,
        tablesByQualifier,
        parameters,
        parameterIndex,
        externalTables
      ),
      distinct: value.args.distinct === 'DISTINCT',
      ordering
    }
  }

  if (
    value.type === 'binary_expr'
    && expressionBinaryOperators.has(stringValue(value.operator))
  ) {
    return {
      kind: 'binary',
      operator: value.operator as
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
        | '<=',
      left: parseExpression(
        value.left,
        tables,
        tablesByQualifier,
        parameters,
        parameterIndex,
        externalTables
      ),
      right: parseExpression(
        value.right,
        tables,
        tablesByQualifier,
        parameters,
        parameterIndex,
        externalTables
      )
    }
  }

  if (
    value.type === 'unary_expr'
    && (value.operator === '+' || value.operator === '-')
  ) {
    return {
      kind: 'unary',
      operator: value.operator,
      operand: parseExpression(
        value.expr,
        tables,
        tablesByQualifier,
        parameters,
        parameterIndex,
        externalTables
      )
    }
  }

  return importError('unsupported-select-expression')
}

function firstExpressionField(
  expression: QueryExpression
): FieldReference | undefined {
  switch (expression.kind) {
    case 'field':
      return expression.field
    case 'function':
      return expression.arguments
        .map(firstExpressionField)
        .find(Boolean)
    case 'binary':
      return firstExpressionField(expression.left)
        ?? firstExpressionField(expression.right)
    case 'unary':
      return firstExpressionField(expression.operand)
    case 'aggregate':
      return firstExpressionField(expression.argument)
        ?? expression.ordering
          ?.map((ordering) => firstExpressionField(ordering.expression))
          .find(Boolean)
    case 'subquery':
      return undefined
    case 'case':
      return (
        expression.operand
          ? firstExpressionField(expression.operand)
          : undefined
      )
        ?? expression.branches
          .flatMap((branch) => [branch.when, branch.then])
          .map(firstExpressionField)
          .find(Boolean)
        ?? (
          expression.elseExpression
            ? firstExpressionField(expression.elseExpression)
            : undefined
        )
    default:
      return undefined
  }
}

function parseSelectedFields(
  columns: unknown,
  tables: QueryTable[],
  tablesByQualifier: Map<string, QueryTable>,
  parameters: QueryParameterValue[],
  parameterIndex: { value: number },
  externalTables: QueryTable[] = []
): SelectedField[] {
  if (!Array.isArray(columns)) {
    return importError('unsupported-select-expression')
  }

  return columns.map((column, index) => {
    if (!isNode(column) || !isNode(column.expr)) {
      return importError('unsupported-select-expression')
    }

    const astExpression = column.expr
    let aggregate: AggregateFunction = 'none'
    let distinct = false
    let expression = parseExpression(
      astExpression,
      tables,
      tablesByQualifier,
      parameters,
      parameterIndex,
      externalTables
    )

    if (
      expression.kind === 'aggregate'
      && aggregateFunctions.has(
        expression.name.toUpperCase() as AggregateFunction
      )
      && firstExpressionField(expression.argument)
    ) {
      aggregate = expression.name.toUpperCase() as AggregateFunction
      distinct = expression.distinct
      expression = expression.argument
    }

    const alias = stringValue(column.as)
    const field = firstExpressionField(expression) ?? {
      tableId: tables[0]!.id,
      columnName: alias || `expression_${index + 1}`
    }
    const isSimpleField = expression.kind === 'field'

    return {
      id: createImportId('field', index),
      field,
      expression: isSimpleField ? undefined : expression,
      alias,
      aggregate,
      distinct
    }
  })
}

function parseDerivedTables(
  astTables: AstNode[],
  tables: QueryTable[],
  currentModel: QueryModel,
  parameters: QueryParameterValue[],
  parameterIndex: { value: number },
  externalTables: QueryTable[] = []
): void {
  astTables.forEach((astTable, index) => {
    if (!isNode(astTable.expr) || !isNode(astTable.expr.ast)) {
      return
    }

    const table = tables[index]!
    const currentQuery = currentModel.tables.find(
      (currentTable) => currentTable.id === table.id
    )?.source?.query ?? createEmptyQueryModel()

    table.source = {
      kind: 'subquery',
      query: parseSelectAst(
        astTable.expr.ast,
        currentQuery,
        parameters,
        parameterIndex,
        externalTables
      )
    }
  })
}

function flattenAndConditions(value: AstNode): AstNode[] {
  if (
    value.type === 'binary_expr'
    && stringValue(value.operator).toUpperCase() === 'AND'
    && isNode(value.left)
    && isNode(value.right)
  ) {
    return [
      ...flattenAndConditions(value.left),
      ...flattenAndConditions(value.right)
    ]
  }

  return [value]
}

function tryJoinFields(
  value: AstNode,
  tables: QueryTable[],
  tablesByQualifier: Map<string, QueryTable>,
  currentTable: QueryTable,
  connectedTableIds: Set<string>
): { left: FieldReference; right: FieldReference } | null {
  if (
    value.type !== 'binary_expr'
    || value.operator !== '='
    || !isNode(value.left)
    || !isNode(value.right)
    || value.left.type !== 'column_ref'
    || value.right.type !== 'column_ref'
  ) {
    return null
  }

  let left = parseColumnReference(
    value.left,
    tables,
    tablesByQualifier
  )
  let right = parseColumnReference(
    value.right,
    tables,
    tablesByQualifier
  )

  if (
    left.tableId === currentTable.id
    && right.tableId === currentTable.id
  ) {
    return { left, right }
  }

  if (
    left.tableId === currentTable.id
    && connectedTableIds.has(right.tableId)
  ) {
    [left, right] = [right, left]
  }

  return connectedTableIds.has(left.tableId)
    && right.tableId === currentTable.id
    ? { left, right }
    : null
}

function parseJoins(
  astTables: AstNode[],
  tables: QueryTable[],
  tablesByQualifier: Map<string, QueryTable>,
  parameters: QueryParameterValue[],
  parameterIndex: { value: number }
): QueryModel['joins'] {
  const connectedTableIds = new Set<string>([tables[0]!.id])

  return astTables.slice(1).map((astTable, index) => {
    const joinType = stringValue(astTable.join).toUpperCase()
    const type = joinType === 'JOIN'
      ? 'JOIN'
      : joinType === 'INNER JOIN'
        ? 'INNER'
        : joinType === 'LEFT JOIN'
          ? 'LEFT'
          : joinType === 'RIGHT JOIN'
            ? 'RIGHT'
            : importError('unsupported-join')
    if (!isNode(astTable.on)) {
      return importError('unsupported-join-condition')
    }
    const currentTable = tables[index + 1]!
    const clauses = flattenAndConditions(astTable.on)
    const primaryIndex = clauses.findIndex((clause) =>
      Boolean(tryJoinFields(
        clause,
        tables,
        tablesByQualifier,
        currentTable,
        connectedTableIds
      ))
    )

    if (primaryIndex < 0) {
      return importError('unsupported-join-condition')
    }
    const primary = tryJoinFields(
      clauses[primaryIndex]!,
      tables,
      tablesByQualifier,
      currentTable,
      connectedTableIds
    )!
    const nodeIndex = { value: (index + 1) * 1000 }
    const extraConditions = clauses
      .filter((_, clauseIndex) => clauseIndex !== primaryIndex)
      .map((clause) =>
        parseFilterNode(
          clause,
          tables,
          tablesByQualifier,
          parameters,
          parameterIndex,
          nodeIndex
        )
      )
      .filter((condition): condition is FilterNode => Boolean(condition))
    const conditions: FilterGroup | undefined = extraConditions.length > 0
      ? {
          id: createImportId('join-filter-root', index),
          kind: 'group',
          conjunction: 'AND',
          children: extraConditions
        }
      : undefined

    connectedTableIds.add(currentTable.id)
    return {
      id: createImportId('join', index),
      type,
      joinedTableId: currentTable.id,
      left: primary.left,
      right: primary.right,
      conditions
    }
  })
}

function filterLiteralValue(
  value: unknown
): string | number | boolean | undefined {
  if (
    !isNode(value)
    || (
      value.type !== 'number'
      && value.type !== 'bool'
      && value.type !== 'boolean'
      && value.type !== 'single_quote_string'
      && value.type !== 'double_quote_string'
      && value.type !== 'string'
      && value.type !== 'natural_string'
    )
  ) {
    return undefined
  }

  return typeof value.value === 'string'
    || typeof value.value === 'number'
    || typeof value.value === 'boolean'
    ? value.value
    : undefined
}

function isAlwaysTrueFilter(value: AstNode): boolean {
  if (
    value.type !== 'binary_expr'
    || stringValue(value.operator).toUpperCase() !== '='
  ) {
    return false
  }

  const left = filterLiteralValue(value.left)
  const right = filterLiteralValue(value.right)

  return left !== undefined
    && right !== undefined
    && left === right
}

function parseFilterNode(
  value: unknown,
  tables: QueryTable[],
  tablesByQualifier: Map<string, QueryTable>,
  parameters: QueryParameterValue[],
  parameterIndex: { value: number },
  nodeIndex: { value: number }
): FilterNode | null {
  if (!isNode(value) || value.type !== 'binary_expr') {
    return importError('unsupported-filter')
  }

  const operator = stringValue(value.operator).toUpperCase()

  if (operator === 'AND' || operator === 'OR') {
    const left = parseFilterNode(
      value.left,
      tables,
      tablesByQualifier,
      parameters,
      parameterIndex,
      nodeIndex
    )
    const right = parseFilterNode(
      value.right,
      tables,
      tablesByQualifier,
      parameters,
      parameterIndex,
      nodeIndex
    )

    if (operator === 'AND') {
      if (!left) {
        return right
      }

      if (!right) {
        return left
      }
    } else if (!left || !right) {
      return null
    }

    return {
      id: createImportId('filter-group', nodeIndex.value++),
      kind: 'group',
      conjunction: operator,
      children: [left, right]
    }
  }

  if (isAlwaysTrueFilter(value)) {
    return null
  }

  const leftExpression = parseExpression(
    value.left,
    tables,
    tablesByQualifier,
    parameters,
    parameterIndex
  )
  const field = firstExpressionField(leftExpression)

  if (!field) {
    return importError('unsupported-filter')
  }
  const condition: FilterCondition = {
    id: createImportId('filter', nodeIndex.value++),
    kind: 'condition',
    field,
    expression: leftExpression.kind === 'field'
      ? undefined
      : leftExpression,
    operator: '='
  }

  if (
    (operator === 'IS' || operator === 'IS NOT')
    && isNode(value.right)
    && value.right.type === 'null'
  ) {
    condition.operator = operator === 'IS'
      ? 'IS NULL'
      : 'IS NOT NULL'
    return condition
  }

  if (operator === 'IN' || operator === 'NOT IN') {
    if (!isNode(value.right) || !Array.isArray(value.right.value)) {
      return importError('unsupported-filter')
    }

    condition.operator = operator
    if (
      value.right.value.length === 1
      && isNode(value.right.value[0])
      && isNode(value.right.value[0].ast)
    ) {
      condition.rightExpression = parseExpression(
        value.right.value[0],
        tables,
        tablesByQualifier,
        parameters,
        parameterIndex
      )
      return condition
    }

    condition.value = value.right.value.map((item) =>
      parseParameterValue(item, parameters, parameterIndex)
    )
    return condition
  }

  if (operator === 'BETWEEN') {
    if (
      !isNode(value.right)
      || !Array.isArray(value.right.value)
      || value.right.value.length !== 2
    ) {
      return importError('unsupported-filter')
    }

    condition.operator = 'BETWEEN'
    condition.value = parseParameterValue(
      value.right.value[0],
      parameters,
      parameterIndex
    )
    condition.secondValue = parseParameterValue(
      value.right.value[1],
      parameters,
      parameterIndex
    )
    return condition
  }

  if (!comparisonOperators.has(operator as FilterOperator)) {
    return importError('unsupported-filter')
  }

  condition.operator = operator as FilterOperator
  if (
    isNode(value.right)
    && (
      value.right.type === 'column_ref'
      || value.right.type === 'function'
      || value.right.type === 'aggr_func'
      || value.right.type === 'binary_expr'
      || value.right.type === 'unary_expr'
      || isNode(value.right.ast)
    )
  ) {
    condition.rightExpression = parseExpression(
      value.right,
      tables,
      tablesByQualifier,
      parameters,
      parameterIndex
    )
  } else {
    condition.value = parseParameterValue(
      value.right,
      parameters,
      parameterIndex
    )
  }
  return condition
}

function parseFilters(
  where: unknown,
  tables: QueryTable[],
  tablesByQualifier: Map<string, QueryTable>,
  parameters: QueryParameterValue[],
  parameterIndex: { value: number }
): FilterGroup {
  if (!where) {
    return {
      id: 'filter-root',
      kind: 'group',
      conjunction: 'AND',
      children: []
    }
  }

  const nodeIndex = { value: 0 }
  const parsed = parseFilterNode(
    where,
    tables,
    tablesByQualifier,
    parameters,
    parameterIndex,
    nodeIndex
  )

  if (!parsed) {
    return {
      id: 'filter-root',
      kind: 'group',
      conjunction: 'AND',
      children: []
    }
  }

  if (parsed.kind === 'group') {
    return {
      ...parsed,
      id: 'filter-root'
    }
  }

  return {
    id: 'filter-root',
    kind: 'group',
    conjunction: 'AND',
    children: [parsed]
  }
}

function parseGrouping(
  groupBy: unknown,
  tables: QueryTable[],
  tablesByQualifier: Map<string, QueryTable>
): QueryModel['grouping'] {
  if (!groupBy) {
    return []
  }

  const columns = isNode(groupBy) ? groupBy.columns : groupBy

  if (!Array.isArray(columns)) {
    return importError('unsupported-grouping')
  }

  return columns.map((column, index) => ({
    id: createImportId('group', index),
    field: parseColumnReference(
      column,
      tables,
      tablesByQualifier
    )
  }))
}

function parseSorting(
  orderBy: unknown,
  selectedFields: SelectedField[],
  tables: QueryTable[],
  tablesByQualifier: Map<string, QueryTable>,
  parameters: QueryParameterValue[],
  parameterIndex: { value: number },
  externalTables: QueryTable[] = []
): QueryModel['sorting'] {
  if (!orderBy) {
    return []
  }

  if (!Array.isArray(orderBy)) {
    return importError('unsupported-sorting')
  }

  return orderBy.map((item, index) => {
    if (!isNode(item) || !isNode(item.expr)) {
      return importError('unsupported-sorting')
    }

    const direction = stringValue(item.type).toUpperCase() || 'ASC'

    if (direction !== 'ASC' && direction !== 'DESC') {
      return importError('unsupported-sorting')
    }

    let field: FieldReference
    let expression: QueryExpression | undefined
    const alias = item.expr.type === 'column_ref'
      && !item.expr.table
      && typeof item.expr.column === 'string'
      ? item.expr.column
      : ''
    const matchingSelectedFields = alias
      ? selectedFields.filter((selectedField) => {
          const outputName = selectedField.alias.trim()
            || (
              selectedField.expression
                ? ''
                : selectedField.field.columnName
            )

          return normalize(outputName) === normalize(alias)
        })
      : []
    const matchingSelectedField = matchingSelectedFields.length === 1
      ? matchingSelectedFields[0]
      : undefined
    let outputReference: string | undefined

    if (matchingSelectedField) {
      field = { ...matchingSelectedField.field }
      outputReference = alias
    } else {
      const parsedExpression = parseExpression(
        item.expr,
        tables,
        tablesByQualifier,
        parameters,
        parameterIndex,
        externalTables
      )
      field = firstExpressionField(parsedExpression) ?? {
        tableId: tables[0]!.id,
        columnName: `sorting_${index + 1}`
      }
      expression = parsedExpression.kind === 'field'
        ? undefined
        : parsedExpression
    }

    return {
      id: createImportId('sort', index),
      field,
      expression,
      outputReference,
      direction
    }
  })
}

function parsePagination(
  limit: unknown,
  parameters: QueryParameterValue[],
  parameterIndex: { value: number }
): QueryModel['pagination'] {
  if (!limit) {
    return {
      limit: null,
      offset: 0
    }
  }

  if (!isNode(limit) || !Array.isArray(limit.value)) {
    return importError('unsupported-pagination')
  }

  const values = limit.value.map((item) =>
    parseParameterValue(item, parameters, parameterIndex)
  )

  if (
    values.length < 1
    || values.length > 2
    || values.some((value) =>
      typeof value !== 'number'
      || !Number.isInteger(value)
      || value < 0
    )
  ) {
    return importError('unsupported-pagination')
  }

  if (limit.seperator === ',') {
    return {
      limit: values[1] as number,
      offset: values[0] as number
    }
  }

  return {
    limit: values[0] as number,
    offset: (values[1] as number | undefined) ?? 0
  }
}

function parseSelectAst(
  parsed: AstNode,
  currentModel: QueryModel,
  parameters: QueryParameterValue[],
  parameterIndex: { value: number },
  externalTables: QueryTable[] = [],
  includeSetOperations = true
): QueryModel {
  if (parsed.type !== 'select') {
    return importError('select-only')
  }

  if (
    parsed.with
    || parsed.having
    || parsed.window
    || parsed.qualify
    || (
      parsed.distinct
      && stringValue(parsed.distinct).toUpperCase() !== 'DISTINCT'
    )
    || (
      Array.isArray(parsed.options)
      && parsed.options.length > 0
    )
  ) {
    return importError('unsupported-query')
  }

  const {
    astTables,
    tables,
    tablesByQualifier
  } = parseTables(parsed.from, currentModel, externalTables)
  const selectedFields = parseSelectedFields(
    parsed.columns,
    tables,
    tablesByQualifier,
    parameters,
    parameterIndex,
    externalTables
  )
  parseDerivedTables(
    astTables,
    tables,
    currentModel,
    parameters,
    parameterIndex,
    externalTables
  )
  const model: QueryModel = {
    version: 1,
    dialect: 'mariadb',
    distinct: stringValue(parsed.distinct).toUpperCase() === 'DISTINCT',
    externalTables: externalTables.map((table) => ({
      id: table.id,
      alias: table.alias || table.name
    })),
    tables,
    selectedFields,
    joins: parseJoins(
      astTables,
      tables,
      tablesByQualifier,
      parameters,
      parameterIndex
    ),
    filters: parseFilters(
      parsed.where,
      tables,
      tablesByQualifier,
      parameters,
      parameterIndex
    ),
    grouping: parseGrouping(
      parsed.groupby,
      tables,
      tablesByQualifier
    ),
    sorting: parseSorting(
      parsed.orderby,
      selectedFields,
      tables,
      tablesByQualifier,
      parameters,
      parameterIndex,
      externalTables
    ),
    pagination: parsePagination(
      parsed.limit,
      parameters,
      parameterIndex
    )
  }

  if (includeSetOperations) {
    const setOperations: NonNullable<QueryModel['setOperations']> = []
    let currentAst = parsed
    let setIndex = 0

    while (isNode(currentAst._next)) {
      const operator = stringValue(currentAst.set_op)
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase()

      if (operator !== 'UNION' && operator !== 'UNION ALL') {
        return importError('unsupported-query')
      }

      const nextAst = currentAst._next
      const currentOperation = currentModel.setOperations?.[setIndex]

      setOperations.push({
        id: currentOperation?.id
          ?? createImportId('set-operation', setIndex),
        operator,
        query: parseSelectAst(
          nextAst,
          currentOperation?.query ?? createEmptyQueryModel(),
          parameters,
          parameterIndex,
          externalTables,
          false
        )
      })

      currentAst = nextAst
      setIndex += 1
    }

    if (setOperations.length > 0) {
      model.setOperations = setOperations
    }
  }

  const blockingIssue = validateQueryModel(model).find(
    (issue) => issue.severity !== 'warning'
  )

  if (blockingIssue) {
    return importError('invalid-model', blockingIssue.message)
  }

  return model
}

export function parseSqlToQueryModel(
  sql: string,
  currentModel: QueryModel,
  parameters: QueryParameterValue[]
): QueryModel {
  let parsed: unknown

  try {
    parsed = parser.astify(sql, {
      parseOptions: {
        includeLocations: true
      }
    })
  } catch (error) {
    return importError(
      'syntax',
      error instanceof Error ? error.message : ''
    )
  }

  if (Array.isArray(parsed)) {
    return importError('single-statement')
  }

  if (!isNode(parsed)) {
    return importError('select-only')
  }

  restoreSourceJoinTypes(parsed, tokenizeSqlWords(sql))

  const model = parseSelectAst(
    parsed,
    currentModel,
    parameters,
    { value: 0 }
  )

  return {
    ...model,
    sourceSql: sql
  }
}
