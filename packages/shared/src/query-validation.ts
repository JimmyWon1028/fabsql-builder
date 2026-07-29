import type {
  FieldReference,
  FilterNode,
  QueryExpression,
  QueryFilterValue,
  QueryModel
} from './query-model.js'

export type ValidationSeverity = 'error' | 'incomplete' | 'warning'

export interface QueryValidationIssue {
  severity: ValidationSeverity
  code: string
  message: string
  targetId?: string
}

function fieldExists(
  field: FieldReference,
  tableIds: Set<string>
): boolean {
  return tableIds.has(field.tableId) && field.columnName.trim().length > 0
}

function collectFilterIds(node: FilterNode, ids: string[]): void {
  ids.push(node.id)

  if (node.kind === 'group') {
    node.children.forEach((child) => {
      collectFilterIds(child, ids)
    })
  }
}

function validateExpression(
  expression: QueryExpression,
  tableIds: Set<string>,
  issues: QueryValidationIssue[],
  targetId: string
): void {
  switch (expression.kind) {
    case 'field':
      if (!fieldExists(expression.field, tableIds)) {
        issues.push({
          severity: 'error',
          code: 'expression-field-invalid',
          message: 'Expression 參照了不存在的 table 或欄位。',
          targetId
        })
      }
      return
    case 'function':
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(expression.name)) {
        issues.push({
          severity: 'error',
          code: 'expression-function-invalid',
          message: 'Expression 函式名稱格式無效。',
          targetId
        })
      }
      expression.arguments.forEach((argument) => {
        validateExpression(argument, tableIds, issues, targetId)
      })
      return
    case 'binary':
      validateExpression(expression.left, tableIds, issues, targetId)
      validateExpression(expression.right, tableIds, issues, targetId)
      return
    case 'unary':
      validateExpression(expression.operand, tableIds, issues, targetId)
      return
    case 'aggregate':
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(expression.name)) {
        issues.push({
          severity: 'error',
          code: 'expression-function-invalid',
          message: 'Aggregate expression 名稱格式無效。',
          targetId
        })
      }
      validateExpression(expression.argument, tableIds, issues, targetId)
      expression.ordering?.forEach((ordering) => {
        validateExpression(ordering.expression, tableIds, issues, targetId)
      })
      return
    case 'subquery':
      validateQueryModel(expression.query).forEach((issue) => {
        issues.push({
          ...issue,
          message: `Scalar 子查詢：${issue.message}`,
          targetId: issue.targetId ?? targetId
        })
      })
      return
    case 'case':
      if (expression.branches.length === 0) {
        issues.push({
          severity: 'error',
          code: 'expression-case-empty',
          message: 'CASE expression 至少需要一個 WHEN 分支。',
          targetId
        })
      }
      if (expression.operand) {
        validateExpression(expression.operand, tableIds, issues, targetId)
      }
      expression.branches.forEach((branch) => {
        validateExpression(branch.when, tableIds, issues, targetId)
        validateExpression(branch.then, tableIds, issues, targetId)
      })
      if (expression.elseExpression) {
        validateExpression(
          expression.elseExpression,
          tableIds,
          issues,
          targetId
        )
      }
      return
    case 'parameter':
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(expression.name)) {
        issues.push({
          severity: 'error',
          code: 'named-parameter-invalid',
          message: '具名參數名稱格式無效。',
          targetId
        })
      }
      return
    case 'literal':
      return
  }
}

function isFilterValueMissing(
  value: QueryFilterValue | undefined
): boolean {
  return value === undefined || value === ''
}

function validateStableIds(
  model: QueryModel,
  issues: QueryValidationIssue[]
): void {
  const ids = [
    ...model.tables.map((item) => item.id),
    ...model.selectedFields.map((item) => item.id),
    ...model.joins.map((item) => item.id),
    ...model.grouping.map((item) => item.id),
    ...model.sorting.map((item) => item.id),
    ...(model.setOperations ?? []).map((item) => item.id)
  ]

  collectFilterIds(model.filters, ids)
  model.joins.forEach((join) => {
    if (join.conditions) {
      collectFilterIds(join.conditions, ids)
    }
  })
  const seenIds = new Set<string>()

  ids.forEach((id) => {
    if (!id.trim() || seenIds.has(id)) {
      issues.push({
        severity: 'error',
        code: !id.trim() ? 'stable-id-missing' : 'stable-id-duplicate',
        message: !id.trim()
          ? 'Query Model 包含空白 ID。'
          : `Query Model ID ${id} 重複。`,
        targetId: id || undefined
      })
    }

    seenIds.add(id)
  })
}

function validateFilterNode(
  node: FilterNode,
  tableIds: Set<string>,
  issues: QueryValidationIssue[]
): void {
  if (node.kind === 'group') {
    node.children.forEach((child) => {
      validateFilterNode(child, tableIds, issues)
    })
    return
  }

  if (node.expression) {
    validateExpression(node.expression, tableIds, issues, node.id)
  } else if (!fieldExists(node.field, tableIds)) {
    issues.push({
      severity: 'error',
      code: 'filter-field-missing',
      message: '篩選條件參照了不存在的欄位。',
      targetId: node.id
    })
  }

  if (node.rightExpression) {
    validateExpression(
      node.rightExpression,
      tableIds,
      issues,
      node.id
    )
  }

  if (node.operator === 'IS NULL' || node.operator === 'IS NOT NULL') {
    return
  }

  if (
    (node.operator === 'IN' || node.operator === 'NOT IN')
    && !node.rightExpression
    && (!Array.isArray(node.value) || node.value.length === 0)
  ) {
    issues.push({
      severity: 'incomplete',
      code: 'filter-empty-list',
      message: `${node.operator} 至少需要一個值。`,
      targetId: node.id
    })
    return
  }

  if (
    !node.rightExpression
    &&
    !Array.isArray(node.value)
    && isFilterValueMissing(node.value)
  ) {
    issues.push({
      severity: 'incomplete',
      code: 'filter-value-missing',
      message: '篩選條件尚未輸入值。',
      targetId: node.id
    })
  }

  if (
    node.operator === 'BETWEEN'
    && isFilterValueMissing(node.secondValue)
  ) {
    issues.push({
      severity: 'incomplete',
      code: 'filter-second-value-missing',
      message: 'BETWEEN 尚未輸入第二個值。',
      targetId: node.id
    })
  }
}

export function validateQueryModel(
  model: QueryModel
): QueryValidationIssue[] {
  const issues: QueryValidationIssue[] = []
  const tableIds = new Set([
    ...model.tables.map((table) => table.id),
    ...(model.externalTables ?? []).map((table) => table.id)
  ])
  const aliases = new Set<string>()

  validateStableIds(model, issues)

  if (model.tables.length === 0) {
    issues.push({
      severity: 'incomplete',
      code: 'table-missing',
      message: '請先將 table 加入 Query Canvas。'
    })
  }

  if (model.selectedFields.length === 0) {
    issues.push({
      severity: 'incomplete',
      code: 'selected-field-missing',
      message: '請至少選取一個輸出欄位。'
    })
  }

  model.tables.forEach((table) => {
    const normalizedAlias = table.alias.trim().toLocaleLowerCase('en-US')

    if (!table.name.trim()) {
      issues.push({
        severity: 'error',
        code: 'table-name-missing',
        message: 'Table 名稱不可空白。',
        targetId: table.id
      })
    }

    if (!normalizedAlias) {
      issues.push({
        severity: 'error',
        code: 'table-alias-missing',
        message: `${table.name} 的 alias 不可空白。`,
        targetId: table.id
      })
    } else if (aliases.has(normalizedAlias)) {
      issues.push({
        severity: 'error',
        code: 'table-alias-conflict',
        message: `Alias ${table.alias} 重複。`,
        targetId: table.id
      })
    }

    aliases.add(normalizedAlias)

    if (table.source?.kind === 'subquery') {
      validateQueryModel(table.source.query).forEach((issue) => {
        issues.push({
          ...issue,
          message: `${table.alias} 子查詢：${issue.message}`,
          targetId: issue.targetId ?? table.id
        })
      })
    }
  })

  model.setOperations?.forEach((operation, index) => {
    if (
      operation.query.selectedFields.length
      !== model.selectedFields.length
    ) {
      issues.push({
        severity: 'error',
        code: 'set-column-count-mismatch',
        message: `${operation.operator} 第 ${index + 2} 段的輸出欄位數量必須與第一段相同。`,
        targetId: operation.id
      })
    }

    validateQueryModel(operation.query).forEach((issue) => {
      issues.push({
        ...issue,
        message: `${operation.operator} 第 ${index + 2} 段：${issue.message}`,
        targetId: issue.targetId ?? operation.id
      })
    })
  })

  model.selectedFields.forEach((selectedField) => {
    if (selectedField.expression) {
      validateExpression(
        selectedField.expression,
        tableIds,
        issues,
        selectedField.id
      )
    } else if (!fieldExists(selectedField.field, tableIds)) {
      issues.push({
        severity: 'error',
        code: 'selected-field-invalid',
        message: '輸出欄位參照了不存在的 table。',
        targetId: selectedField.id
      })
    }
  })

  model.joins.forEach((join) => {
    if (
      !fieldExists(join.left, tableIds)
      || !fieldExists(join.right, tableIds)
    ) {
      issues.push({
        severity: 'error',
        code: 'join-field-invalid',
        message: 'JOIN 參照了不存在的 table 或欄位。',
        targetId: join.id
      })
    }

    if (
      join.joinedTableId !== undefined
      && !tableIds.has(join.joinedTableId)
    ) {
      issues.push({
        severity: 'error',
        code: 'join-table-invalid',
        message: 'JOIN 參照了不存在的加入 table。',
        targetId: join.id
      })
    }

    if (join.conditions) {
      validateFilterNode(join.conditions, tableIds, issues)
    }
  })

  if (model.tables.length > 1) {
    const connectedTableIds = new Set([model.tables[0]?.id])

    model.tables.slice(1).forEach((table) => {
      const join = model.joins.find((candidate) =>
        (candidate.joinedTableId ?? candidate.right.tableId) === table.id
        && (
          connectedTableIds.has(candidate.left.tableId)
          || candidate.left.tableId === table.id
        )
      )

      if (!join) {
        issues.push({
          severity: 'incomplete',
          code: 'table-not-joined',
          message: `${table.alias || table.name} 尚未從已加入的 table 建立 JOIN。`,
          targetId: table.id
        })
      } else {
        connectedTableIds.add(table.id)
      }
    })
  }

  model.grouping.forEach((groupingField) => {
    if (!fieldExists(groupingField.field, tableIds)) {
      issues.push({
        severity: 'error',
        code: 'grouping-field-invalid',
        message: 'GROUP BY 參照了不存在的欄位。',
        targetId: groupingField.id
      })
    }
  })

  model.sorting.forEach((sortingField) => {
    if (sortingField.expression) {
      validateExpression(
        sortingField.expression,
        tableIds,
        issues,
        sortingField.id
      )
    } else if (!fieldExists(sortingField.field, tableIds)) {
      issues.push({
        severity: 'error',
        code: 'sorting-field-invalid',
        message: 'ORDER BY 參照了不存在的欄位。',
        targetId: sortingField.id
      })
    }
  })

  validateFilterNode(model.filters, tableIds, issues)

  if (
    model.pagination.limit !== null
    && (!Number.isInteger(model.pagination.limit)
      || model.pagination.limit < 1)
  ) {
    issues.push({
      severity: 'error',
      code: 'pagination-limit-invalid',
      message: 'LIMIT 必須是大於 0 的整數。'
    })
  }

  if (
    !Number.isInteger(model.pagination.offset)
    || model.pagination.offset < 0
  ) {
    issues.push({
      severity: 'error',
      code: 'pagination-offset-invalid',
      message: 'OFFSET 必須是 0 或正整數。'
    })
  }

  return issues
}
