import type {
  FieldReference,
  FilterNode,
  QueryModel,
  QueryExpression,
  QueryFilterValue,
  QueryNamedParameter,
  QueryParameterValue,
  QueryTable
} from './query-model.js'
import {
  validateQueryModel,
  type QueryValidationIssue
} from './query-validation.js'

export type CompileStatus = 'valid' | 'incomplete' | 'error'

export interface CompileQueryResult {
  status: CompileStatus
  sql: string
  parameters: QueryParameterValue[]
  namedParameters: string[]
  issues: QueryValidationIssue[]
}

export type QueryNamedParameterValues = Record<
  string,
  QueryParameterValue
>

interface CompileContext {
  tablesById: Map<string, QueryTable>
  parameters: QueryParameterValue[]
  namedParameters: Set<string>
  namedParameterValues: QueryNamedParameterValues
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``
}

function titleCaseKeyword(keyword: string): string {
  return keyword
    .toLocaleLowerCase('en-US')
    .replace(/\b[a-z]/g, (character) =>
      character.toLocaleUpperCase('en-US')
    )
}

function tableAlias(table: QueryTable): string {
  return table.alias.trim() || table.name
}

function tableReference(
  table: QueryTable,
  context: CompileContext
): string {
  if (table.source?.kind === 'subquery') {
    const result = compileQuery(
      table.source.query,
      context.namedParameterValues
    )

    mergeCompileResult(result, context)

    const nestedSql = result.sql
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')

    return `(\n${nestedSql}\n  ) As ${quoteIdentifier(tableAlias(table))}`
  }

  const quotedName = quoteIdentifier(table.name)
  const alias = tableAlias(table)

  if (alias === table.name) {
    return quotedName
  }

  return `${quotedName} As ${quoteIdentifier(alias)}`
}

function mergeCompileResult(
  result: CompileQueryResult,
  context: CompileContext
): void {
  context.parameters.push(...result.parameters)
  result.namedParameters.forEach((name) => {
    context.namedParameters.add(name)
  })
}

function fieldReference(
  field: FieldReference,
  tablesById: Map<string, QueryTable>
): string {
  const table = tablesById.get(field.tableId)
  const qualifier = table ? tableAlias(table) : field.tableId

  return `${quoteIdentifier(qualifier)}.${quoteIdentifier(field.columnName)}`
}

function compileExpression(
  expression: QueryExpression,
  context: CompileContext
): string {
  switch (expression.kind) {
    case 'field':
      return fieldReference(expression.field, context.tablesById)
    case 'literal':
      context.parameters.push(expression.value)
      return '?'
    case 'parameter':
      return compileNamedParameter(expression.name, context)
    case 'function':
      return `${expression.name}(${
        expression.arguments
          .map((argument) => compileExpression(argument, context))
          .join(', ')
      })`
    case 'binary':
      return `(${compileExpression(expression.left, context)} `
        + `${expression.operator} `
        + `${compileExpression(expression.right, context)})`
    case 'unary':
      return `(${expression.operator}${
        compileExpression(expression.operand, context)
      })`
    case 'aggregate': {
      const distinct = expression.distinct ? 'Distinct ' : ''
      const ordering = expression.ordering?.length
        ? ' Order By ' + expression.ordering
            .map((item) =>
              `${compileExpression(item.expression, context)} `
              + titleCaseKeyword(item.direction)
            )
            .join(', ')
        : ''
      return `${expression.name}(${distinct}${
        compileExpression(expression.argument, context)
      }${ordering})`
    }
    case 'subquery': {
      const result = compileQuery(
        expression.query,
        context.namedParameterValues
      )

      mergeCompileResult(result, context)
      return `(\n${result.sql
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n')}\n)`
    }
    case 'case': {
      const operand = expression.operand
        ? ` ${compileExpression(expression.operand, context)}`
        : ''
      const branches = expression.branches.map((branch) =>
        ` When ${compileExpression(branch.when, context)}`
        + ` Then ${compileExpression(branch.then, context)}`
      ).join('')
      const elseClause = expression.elseExpression
        ? ` Else ${compileExpression(expression.elseExpression, context)}`
        : ''

      return `Case${operand}${branches}${elseClause} End`
    }
  }
}

function compileFilterValue(
  value: QueryFilterValue,
  context: CompileContext
): string {
  if (isNamedParameter(value)) {
    return compileNamedParameter(value.name, context)
  }

  context.parameters.push(value)
  return '?'
}

function compileNamedParameter(
  name: string,
  context: CompileContext
): string {
  if (
    Object.prototype.hasOwnProperty.call(
      context.namedParameterValues,
      name
    )
  ) {
    context.parameters.push(context.namedParameterValues[name]!)
    return '?'
  }

  context.namedParameters.add(name)
  return `@${name}`
}

function isNamedParameter(
  value: QueryFilterValue
): value is QueryNamedParameter {
  return typeof value === 'object'
    && value !== null
    && value.kind === 'parameter'
}

function compileFilterNode(
  node: FilterNode,
  context: CompileContext,
  root = false
): string {
  if (node.kind === 'group') {
    const children = node.children
      .map((child) =>
        compileFilterNode(child, context)
      )
      .filter(Boolean)

    if (children.length === 0) {
      return ''
    }

    const expression = children.join(
      ` ${titleCaseKeyword(node.conjunction)} `
    )

    return root ? expression : `(${expression})`
  }

  const field = node.expression
    ? compileExpression(node.expression, context)
    : fieldReference(node.field, context.tablesById)

  if (node.operator === 'IS NULL' || node.operator === 'IS NOT NULL') {
    return `${field} ${titleCaseKeyword(node.operator)}`
  }

  if (node.operator === 'IN' || node.operator === 'NOT IN') {
    if (node.rightExpression) {
      return `${field} ${titleCaseKeyword(node.operator)} `
        + compileExpression(node.rightExpression, context)
    }

    const values = Array.isArray(node.value) ? node.value : []
    return `${field} ${titleCaseKeyword(node.operator)} `
      + `(${values
        .map((value) => compileFilterValue(value, context))
        .join(', ')})`
  }

  if (node.operator === 'BETWEEN') {
    return `${field} Between ${
      compileFilterValue(node.value as QueryFilterValue, context)
    } And ${
      compileFilterValue(node.secondValue as QueryFilterValue, context)
    }`
  }

  const operator = /[A-Z]/i.test(node.operator)
    ? titleCaseKeyword(node.operator)
    : node.operator

  const right = node.rightExpression
    ? compileExpression(node.rightExpression, context)
    : compileFilterValue(node.value as QueryFilterValue, context)

  return `${field} ${operator} ${right}`
}

export function compileQuery(
  model: QueryModel,
  namedParameterValues: QueryNamedParameterValues = {}
): CompileQueryResult {
  const issues = validateQueryModel(model)
  const hasError = issues.some((issue) => issue.severity === 'error')
  const hasIncomplete = issues.some(
    (issue) => issue.severity === 'incomplete'
  )

  if (hasError || hasIncomplete) {
    return {
      status: hasError ? 'error' : 'incomplete',
      sql: '',
      parameters: [],
      namedParameters: [],
      issues
    }
  }

  const tablesById = new Map<string, QueryTable>([
    ...(model.externalTables ?? []).map((table) => [
      table.id,
      {
        id: table.id,
        name: table.alias,
        alias: table.alias,
        position: {
          x: 0,
          y: 0
        }
      } satisfies QueryTable
    ] as const),
    ...model.tables.map((table) => [table.id, table] as const)
  ])
  const parameters: QueryParameterValue[] = []
  const namedParameters = new Set<string>()
  const context: CompileContext = {
    tablesById,
    parameters,
    namedParameters,
    namedParameterValues
  }
  const selectLines = model.selectedFields.map((selectedField) => {
    let expression = selectedField.expression
      ? compileExpression(selectedField.expression, context)
      : fieldReference(selectedField.field, tablesById)

    if (selectedField.aggregate !== 'none') {
      const distinct = selectedField.distinct ? 'Distinct ' : ''
      expression = `${selectedField.aggregate}(${distinct}${expression})`
    }

    if (selectedField.alias.trim()) {
      expression += ` As ${quoteIdentifier(selectedField.alias.trim())}`
    }

    return expression
  })
  const sqlLines = [
    model.distinct ? 'Select Distinct' : 'Select',
    `  ${selectLines.join(', ')}`,
    `From ${tableReference(model.tables[0]!, context)}`
  ]
  const connectedTableIds = new Set([model.tables[0]!.id])

  model.tables.slice(1).forEach((table) => {
    const join = model.joins.find((candidate) =>
      (candidate.joinedTableId ?? candidate.right.tableId) === table.id
      && (
        connectedTableIds.has(candidate.left.tableId)
        || candidate.left.tableId === table.id
      )
    )

    if (!join) {
      return
    }

    const joinKeyword = join.type === 'JOIN'
      ? 'Join'
      : `${titleCaseKeyword(join.type)} Join`

    sqlLines.push(
      `  ${joinKeyword} ${tableReference(table, context)}`,
      `  On ${fieldReference(join.left, tablesById)} = `
        + fieldReference(join.right, tablesById)
    )

    if (join.conditions && join.conditions.children.length > 0) {
      const conditions = compileFilterNode(
        join.conditions,
        context,
        false
      )

      if (conditions) {
        sqlLines.push(`  And ${conditions}`)
      }
    }

    connectedTableIds.add(table.id)
  })

  const whereClause = compileFilterNode(
    model.filters,
    context,
    true
  )

  if (whereClause) {
    sqlLines.push(`Where ${whereClause}`)
  }

  if (model.grouping.length > 0) {
    sqlLines.push(
      'Group By '
        + model.grouping
          .map((item) => fieldReference(item.field, tablesById))
          .join(', ')
    )
  }

  if (model.sorting.length > 0) {
    sqlLines.push(
      'Order By '
        + model.sorting
          .map((item) =>
            `${item.expression
              ? compileExpression(item.expression, context)
              : item.outputReference?.trim()
              ? quoteIdentifier(item.outputReference.trim())
              : fieldReference(item.field, tablesById)} `
              + titleCaseKeyword(item.direction)
          )
          .join(', ')
    )
  }

  if (model.pagination.limit !== null) {
    sqlLines.push('Limit ?')
    parameters.push(model.pagination.limit)

    if (model.pagination.offset > 0) {
      sqlLines.push('Offset ?')
      parameters.push(model.pagination.offset)
    }
  }

  model.setOperations?.forEach((operation) => {
    const result = compileQuery(
      operation.query,
      namedParameterValues
    )

    sqlLines.push(
      titleCaseKeyword(operation.operator),
      result.sql
    )
    parameters.push(...result.parameters)
    result.namedParameters.forEach((name) => {
      namedParameters.add(name)
    })
  })

  return {
    status: 'valid',
    sql: sqlLines.join('\n'),
    parameters,
    namedParameters: [...namedParameters],
    issues
  }
}
