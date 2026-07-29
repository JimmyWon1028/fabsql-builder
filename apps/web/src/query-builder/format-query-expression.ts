import type {
  FilterNode,
  QueryExpression,
  QueryFilterValue,
  QueryTable
} from '@sql-builder/shared'

function tableAlias(tableId: string, tables: QueryTable[]): string {
  return tables.find((table) => table.id === tableId)?.alias ?? '?'
}

export function formatQueryFilterValue(value: QueryFilterValue): string {
  if (typeof value === 'object' && value !== null) {
    return `@${value.name}`
  }

  if (value === null) {
    return 'NULL'
  }

  if (typeof value === 'string') {
    return `'${value.replaceAll("'", "''")}'`
  }

  return String(value)
}

export function formatQueryExpression(
  expression: QueryExpression,
  tables: QueryTable[]
): string {
  switch (expression.kind) {
    case 'field':
      return `${tableAlias(expression.field.tableId, tables)}.${expression.field.columnName}`
    case 'literal':
      return formatQueryFilterValue(expression.value)
    case 'parameter':
      return `@${expression.name}`
    case 'function':
      return `${expression.name}(${expression.arguments
        .map((argument) => formatQueryExpression(argument, tables))
        .join(', ')})`
    case 'binary':
      return `(${formatQueryExpression(expression.left, tables)} ${expression.operator} ${formatQueryExpression(expression.right, tables)})`
    case 'unary':
      return `${expression.operator}${formatQueryExpression(expression.operand, tables)}`
    case 'aggregate': {
      const distinct = expression.distinct ? 'DISTINCT ' : ''
      const ordering = expression.ordering?.length
        ? ' ORDER BY ' + expression.ordering
            .map((item) =>
              `${formatQueryExpression(item.expression, tables)} ${item.direction}`
            )
            .join(', ')
        : ''
      return `${expression.name}(${distinct}${
        formatQueryExpression(expression.argument, tables)
      }${ordering})`
    }
    case 'subquery':
      return '(SELECT …)'
    case 'case': {
      const operand = expression.operand
        ? ` ${formatQueryExpression(expression.operand, tables)}`
        : ''
      const branches = expression.branches.map((branch) =>
        ` WHEN ${formatQueryExpression(branch.when, tables)}`
        + ` THEN ${formatQueryExpression(branch.then, tables)}`
      ).join('')
      const elseClause = expression.elseExpression
        ? ` ELSE ${
            formatQueryExpression(expression.elseExpression, tables)
          }`
        : ''

      return `CASE${operand}${branches}${elseClause} END`
    }
  }
}

export function formatQueryFilterNode(
  node: FilterNode,
  tables: QueryTable[]
): string {
  if (node.kind === 'group') {
    return node.children
      .map((child) => formatQueryFilterNode(child, tables))
      .filter(Boolean)
      .map((condition) => `(${condition})`)
      .join(` ${node.conjunction} `)
  }

  const left = node.expression
    ? formatQueryExpression(node.expression, tables)
    : `${tableAlias(node.field.tableId, tables)}.${node.field.columnName}`

  if (node.operator === 'IS NULL' || node.operator === 'IS NOT NULL') {
    return `${left} ${node.operator}`
  }

  const values = Array.isArray(node.value)
    ? node.value.map(formatQueryFilterValue).join(', ')
    : node.value === undefined
      ? ''
      : formatQueryFilterValue(node.value)

  if (node.operator === 'IN' || node.operator === 'NOT IN') {
    if (node.rightExpression) {
      return `${left} ${node.operator} ${
        formatQueryExpression(node.rightExpression, tables)
      }`
    }

    return `${left} ${node.operator} (${values})`
  }

  if (node.operator === 'BETWEEN') {
    const secondValue = node.secondValue === undefined
      ? ''
      : formatQueryFilterValue(node.secondValue)
    return `${left} BETWEEN ${values} AND ${secondValue}`
  }

  const right = node.rightExpression
    ? formatQueryExpression(node.rightExpression, tables)
    : values

  return `${left} ${node.operator} ${right}`
}
