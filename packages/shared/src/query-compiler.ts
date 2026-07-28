import type {
  FieldReference,
  FilterNode,
  QueryModel,
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
  issues: QueryValidationIssue[]
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

function tableReference(table: QueryTable): string {
  const quotedName = quoteIdentifier(table.name)
  const alias = tableAlias(table)

  if (alias === table.name) {
    return quotedName
  }

  return `${quotedName} As ${quoteIdentifier(alias)}`
}

function fieldReference(
  field: FieldReference,
  tablesById: Map<string, QueryTable>
): string {
  const table = tablesById.get(field.tableId)
  const qualifier = table ? tableAlias(table) : field.tableId

  return `${quoteIdentifier(qualifier)}.${quoteIdentifier(field.columnName)}`
}

function compileFilterNode(
  node: FilterNode,
  tablesById: Map<string, QueryTable>,
  parameters: QueryParameterValue[],
  root = false
): string {
  if (node.kind === 'group') {
    const children = node.children
      .map((child) =>
        compileFilterNode(child, tablesById, parameters)
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

  const field = fieldReference(node.field, tablesById)

  if (node.operator === 'IS NULL' || node.operator === 'IS NOT NULL') {
    return `${field} ${titleCaseKeyword(node.operator)}`
  }

  if (node.operator === 'IN' || node.operator === 'NOT IN') {
    const values = Array.isArray(node.value) ? node.value : []
    parameters.push(...values)
    return `${field} ${titleCaseKeyword(node.operator)} `
      + `(${values.map(() => '?').join(', ')})`
  }

  if (node.operator === 'BETWEEN') {
    parameters.push(
      node.value as QueryParameterValue,
      node.secondValue as QueryParameterValue
    )
    return `${field} Between ? And ?`
  }

  parameters.push(node.value as QueryParameterValue)
  const operator = /[A-Z]/i.test(node.operator)
    ? titleCaseKeyword(node.operator)
    : node.operator

  return `${field} ${operator} ?`
}

export function compileQuery(model: QueryModel): CompileQueryResult {
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
      issues
    }
  }

  const tablesById = new Map(
    model.tables.map((table) => [table.id, table])
  )
  const parameters: QueryParameterValue[] = []
  const selectLines = model.selectedFields.map((selectedField) => {
    let expression = fieldReference(selectedField.field, tablesById)

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
    'Select',
    `  ${selectLines.join(', ')}`,
    `From ${tableReference(model.tables[0]!)}`
  ]
  const connectedTableIds = new Set([model.tables[0]!.id])

  model.tables.slice(1).forEach((table) => {
    const join = model.joins.find((candidate) =>
      candidate.right.tableId === table.id
      && connectedTableIds.has(candidate.left.tableId)
    )

    if (!join) {
      return
    }

    const joinKeyword = join.type === 'JOIN'
      ? 'Join'
      : `${titleCaseKeyword(join.type)} Join`

    sqlLines.push(
      `  ${joinKeyword} ${tableReference(table)}`,
      `  On ${fieldReference(join.left, tablesById)} = `
        + fieldReference(join.right, tablesById)
    )
    connectedTableIds.add(table.id)
  })

  const whereClause = compileFilterNode(
    model.filters,
    tablesById,
    parameters,
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
            `${fieldReference(item.field, tablesById)} `
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

  return {
    status: 'valid',
    sql: sqlLines.join('\n'),
    parameters,
    issues
  }
}
