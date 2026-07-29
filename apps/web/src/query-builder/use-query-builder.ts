import type {
  CanvasPosition,
  FilterCondition,
  FilterGroup,
  GroupingField,
  QueryJoin,
  QueryModel,
  QueryPagination,
  QueryTable,
  SelectedField,
  SortingField
} from '@sql-builder/shared'
import {
  cloneQueryData,
  cloneQueryModel,
  createEmptyQueryModel,
  queryExpressionReferencesTable,
  QueryHistory
} from '@sql-builder/shared'
import {
  computed,
  ref,
  shallowRef
} from 'vue'

const storageKey = 'sql-builder.query-model.v1'
let idSequence = 0

function createId(prefix: string): string {
  idSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}`
}

function removeFilterTableReferences(
  group: FilterGroup,
  tableId: string
): FilterGroup {
  return {
    ...group,
    children: group.children
      .filter((node) =>
        node.kind === 'group'
        || !filterConditionReferencesTable(node, tableId)
      )
      .map((node) =>
        node.kind === 'group'
          ? removeFilterTableReferences(node, tableId)
          : node
      )
  }
}

function filterConditionReferencesTable(
  condition: FilterCondition,
  tableId: string
): boolean {
  return (
    condition.expression
      ? queryExpressionReferencesTable(condition.expression, tableId)
      : condition.field.tableId === tableId
  )
    || (
      condition.rightExpression !== undefined
      && queryExpressionReferencesTable(
        condition.rightExpression,
        tableId
      )
    )
}

function filterGroupReferencesTable(
  group: FilterGroup,
  tableId: string
): boolean {
  return group.children.some((node) =>
    node.kind === 'group'
      ? filterGroupReferencesTable(node, tableId)
      : filterConditionReferencesTable(node, tableId)
  )
}

export function useQueryBuilder() {
  const initialModel = createEmptyQueryModel()
  const history = new QueryHistory(initialModel, cloneQueryModel)
  const model = shallowRef<QueryModel>(history.current)
  const activeQueryPath = ref<string[]>([])
  const historyVersion = ref(0)
  const savedAt = ref<Date | null>(null)
  const activeModel = computed(() =>
    resolveQueryModel(model.value, activeQueryPath.value) ?? model.value
  )
  const queryBreadcrumbs = computed(() => {
    const breadcrumbs: Array<{ tableId: string, label: string }> = []
    let currentModel = model.value

    for (const tableId of activeQueryPath.value) {
      const table = currentModel.tables.find((item) => item.id === tableId)

      if (table?.source?.kind === 'subquery') {
        breadcrumbs.push({
          tableId,
          label: table.alias || table.name
        })
        currentModel = table.source.query
        continue
      }

      const operationIndex = currentModel.setOperations?.findIndex(
        (operation) => operation.id === tableId
      ) ?? -1
      const operation = operationIndex >= 0
        ? currentModel.setOperations?.[operationIndex]
        : undefined

      if (!operation) {
        break
      }

      breadcrumbs.push({
        tableId,
        label: `${operation.operator} ${operationIndex + 2}`
      })
      currentModel = operation.query
    }

    return breadcrumbs
  })

  const canUndo = computed(() => {
    historyVersion.value
    return history.canUndo
  })
  const canRedo = computed(() => {
    historyVersion.value
    return history.canRedo
  })

  function resolveQueryModel(
    rootModel: QueryModel,
    path: string[]
  ): QueryModel | null {
    let currentModel = rootModel

    for (const tableId of path) {
      const table = currentModel.tables.find((item) => item.id === tableId)

      if (table?.source?.kind === 'subquery') {
        currentModel = table.source.query
        continue
      }

      const operation = currentModel.setOperations?.find(
        (item) => item.id === tableId
      )

      if (!operation) {
        return null
      }

      currentModel = operation.query
    }

    return currentModel
  }

  function ensureActiveQueryPath(): void {
    if (!resolveQueryModel(model.value, activeQueryPath.value)) {
      activeQueryPath.value = []
    }
  }

  function syncHistory(nextModel: QueryModel): void {
    model.value = history.commit(nextModel)
    historyVersion.value += 1
    ensureActiveQueryPath()
  }

  function mutate(
    mutator: (draft: QueryModel) => void,
    preserveSourceSql = false
  ): void {
    const draft = cloneQueryModel(model.value)

    if (!preserveSourceSql) {
      delete draft.sourceSql
    }

    const targetModel = resolveQueryModel(draft, activeQueryPath.value)

    if (!targetModel) {
      activeQueryPath.value = []
      mutator(draft)
    } else {
      if (!preserveSourceSql) {
        delete targetModel.sourceSql
      }

      mutator(targetModel)
    }

    syncHistory(draft)
  }

  function createAlias(tableName: string): string {
    const aliases = new Set(
      activeModel.value.tables.map((table) =>
        table.alias.toLocaleLowerCase('en-US')
      )
    )

    if (!aliases.has(tableName.toLocaleLowerCase('en-US'))) {
      return tableName
    }

    let suffix = 2

    while (
      aliases.has(`${tableName}_${suffix}`.toLocaleLowerCase('en-US'))
    ) {
      suffix += 1
    }

    return `${tableName}_${suffix}`
  }

  function addTable(
    tableName: string,
    position: CanvasPosition
  ): QueryTable {
    const table: QueryTable = {
      id: createId('table'),
      name: tableName,
      alias: createAlias(tableName),
      position
    }

    mutate((draft) => {
      draft.tables.push(table)
    })

    return table
  }

  function updateTableAlias(tableId: string, alias: string): void {
    const table = activeModel.value.tables.find(
      (item) => item.id === tableId
    )

    if (!table || table.alias === alias) {
      return
    }

    mutate((draft) => {
      const draftTable = draft.tables.find((item) => item.id === tableId)

      if (draftTable) {
        draftTable.alias = alias
      }
    })
  }

  function moveTable(tableId: string, position: CanvasPosition): void {
    const table = activeModel.value.tables.find(
      (item) => item.id === tableId
    )

    if (
      table
      && table.position.x === position.x
      && table.position.y === position.y
    ) {
      return
    }

    mutate((draft) => {
      const draftTable = draft.tables.find((item) => item.id === tableId)

      if (draftTable) {
        draftTable.position = cloneQueryData(position)
      }
    }, true)
  }

  function setTableCollapsed(
    tableId: string,
    collapsed: boolean
  ): void {
    const table = activeModel.value.tables.find(
      (item) => item.id === tableId
    )

    if (!table || Boolean(table.collapsed) === collapsed) {
      return
    }

    mutate((draft) => {
      const draftTable = draft.tables.find((item) => item.id === tableId)

      if (!draftTable) {
        return
      }

      if (collapsed) {
        draftTable.collapsed = true
      } else {
        delete draftTable.collapsed
      }
    }, true)
  }

  function removeTable(tableId: string): void {
    if (!activeModel.value.tables.some((table) => table.id === tableId)) {
      return
    }

    mutate((draft) => {
      draft.tables = draft.tables.filter((table) => table.id !== tableId)
      draft.selectedFields = draft.selectedFields.filter(
        (field) =>
          field.expression
            ? !queryExpressionReferencesTable(field.expression, tableId)
            : field.field.tableId !== tableId
      )
      draft.joins = draft.joins.filter(
        (join) =>
          join.left.tableId !== tableId
          && join.right.tableId !== tableId
          && (
            !join.conditions
            || !filterGroupReferencesTable(join.conditions, tableId)
          )
      )
      draft.filters = removeFilterTableReferences(draft.filters, tableId)
      draft.grouping = draft.grouping.filter(
        (item) => item.field.tableId !== tableId
      )
      draft.sorting = draft.sorting.filter(
        (item) =>
          item.expression
            ? !queryExpressionReferencesTable(item.expression, tableId)
            : item.field.tableId !== tableId
      )
    })
  }

  function addSelectedField(
    tableId: string,
    columnName: string
  ): SelectedField {
    const existingField = activeModel.value.selectedFields.find(
      (field) =>
        !field.expression
        &&
        field.field.tableId === tableId
        && field.field.columnName === columnName
    )

    if (existingField) {
      return existingField
    }

    const selectedField: SelectedField = {
      id: createId('field'),
      field: {
        tableId,
        columnName
      },
      alias: '',
      aggregate: 'none',
      distinct: false
    }

    mutate((draft) => {
      draft.selectedFields.push(selectedField)
    })

    return selectedField
  }

  function setFieldSelected(
    tableId: string,
    columnName: string,
    selected: boolean
  ): void {
    const matchingFields = activeModel.value.selectedFields.filter(
      (field) =>
        !field.expression
        &&
        field.field.tableId === tableId
        && field.field.columnName === columnName
    )

    if (selected && matchingFields.length > 0) {
      return
    }

    if (!selected && matchingFields.length === 0) {
      return
    }

    if (selected) {
      addSelectedField(tableId, columnName)
      return
    }

    mutate((draft) => {
      draft.selectedFields = draft.selectedFields.filter(
        (field) =>
          field.expression !== undefined
          ||
          field.field.tableId !== tableId
          || field.field.columnName !== columnName
      )
    })
  }

  function updateSelectedField(
    selectedField: SelectedField
  ): void {
    const currentField = activeModel.value.selectedFields.find(
      (item) => item.id === selectedField.id
    )

    if (
      !currentField
      || (
        currentField.alias === selectedField.alias
        && currentField.aggregate === selectedField.aggregate
        && currentField.distinct === selectedField.distinct
        && currentField.field.tableId === selectedField.field.tableId
        && currentField.field.columnName === selectedField.field.columnName
      )
    ) {
      return
    }

    mutate((draft) => {
      const index = draft.selectedFields.findIndex(
        (item) => item.id === selectedField.id
      )

      if (index >= 0) {
        draft.selectedFields[index] = cloneQueryData(selectedField)
      }
    })
  }

  function reorderSelectedField(
    selectedFieldId: string,
    targetFieldId: string,
    placement: 'before' | 'after'
  ): void {
    const sourceIndex = activeModel.value.selectedFields.findIndex(
      (item) => item.id === selectedFieldId
    )
    const targetIndex = activeModel.value.selectedFields.findIndex(
      (item) => item.id === targetFieldId
    )

    if (
      sourceIndex < 0
      || targetIndex < 0
      || sourceIndex === targetIndex
    ) {
      return
    }

    const nextIndex = placement === 'before'
      ? targetIndex - (sourceIndex < targetIndex ? 1 : 0)
      : targetIndex + (sourceIndex > targetIndex ? 1 : 0)

    if (nextIndex === sourceIndex) {
      return
    }

    mutate((draft) => {
      const [item] = draft.selectedFields.splice(sourceIndex, 1)
      const remainingTargetIndex = draft.selectedFields.findIndex(
        (field) => field.id === targetFieldId
      )
      const insertionIndex = placement === 'after'
        ? remainingTargetIndex + 1
        : remainingTargetIndex

      draft.selectedFields.splice(insertionIndex, 0, item!)
    })
  }

  function setJoins(joins: QueryJoin[]): void {
    mutate((draft) => {
      draft.joins = cloneQueryData(joins)
    })
  }

  function setDistinct(distinct: boolean): void {
    if (Boolean(activeModel.value.distinct) === distinct) {
      return
    }

    mutate((draft) => {
      draft.distinct = distinct
    })
  }

  function addJoin(join: Omit<QueryJoin, 'id'>): boolean {
    const alreadyJoined = activeModel.value.joins.some((existingJoin) =>
      (
        existingJoin.left.tableId === join.left.tableId
        && existingJoin.right.tableId === join.right.tableId
      )
      || (
        existingJoin.left.tableId === join.right.tableId
        && existingJoin.right.tableId === join.left.tableId
      )
    )

    if (alreadyJoined) {
      return false
    }

    mutate((draft) => {
      draft.joins.push({
        ...cloneQueryData(join),
        id: createId('join')
      })
    })

    return true
  }

  function setFilters(filters: FilterGroup): void {
    mutate((draft) => {
      draft.filters = cloneQueryData(filters)
    })
  }

  function setGrouping(grouping: GroupingField[]): void {
    mutate((draft) => {
      draft.grouping = cloneQueryData(grouping)
    })
  }

  function addGrouping(
    grouping: Omit<GroupingField, 'id'>
  ): void {
    mutate((draft) => {
      draft.grouping.push({
        ...cloneQueryData(grouping),
        id: createId('group')
      })
    })
  }

  function setSorting(sorting: SortingField[]): void {
    mutate((draft) => {
      draft.sorting = cloneQueryData(sorting)
    })
  }

  function addSorting(
    sorting: Omit<SortingField, 'id'>
  ): void {
    mutate((draft) => {
      draft.sorting.push({
        ...cloneQueryData(sorting),
        id: createId('sort')
      })
    })
  }

  function setPagination(pagination: QueryPagination): void {
    if (
      activeModel.value.pagination.limit === pagination.limit
      && activeModel.value.pagination.offset === pagination.offset
    ) {
      return
    }

    mutate((draft) => {
      draft.pagination = { ...pagination }
    })
  }

  function undo(): void {
    model.value = history.undo()
    historyVersion.value += 1
    ensureActiveQueryPath()
  }

  function redo(): void {
    model.value = history.redo()
    historyVersion.value += 1
    ensureActiveQueryPath()
  }

  function reset(): void {
    activeQueryPath.value = []
    model.value = history.replace(createEmptyQueryModel())
    historyVersion.value += 1
  }

  function restore(nextModel: QueryModel): void {
    activeQueryPath.value = []
    model.value = history.replace(nextModel)
    historyVersion.value += 1
  }

  function applyImportedModel(nextModel: QueryModel): void {
    activeQueryPath.value = []
    syncHistory(cloneQueryModel(nextModel))
  }

  function enterSubquery(tableId: string): boolean {
    const table = activeModel.value.tables.find(
      (item) => item.id === tableId
    )

    if (table?.source?.kind !== 'subquery') {
      return false
    }

    activeQueryPath.value = [...activeQueryPath.value, tableId]
    return true
  }

  function enterSetOperation(operationId: string): boolean {
    if (
      !activeModel.value.setOperations?.some(
        (operation) => operation.id === operationId
      )
    ) {
      return false
    }

    activeQueryPath.value = [...activeQueryPath.value, operationId]
    return true
  }

  function navigateToQueryDepth(depth: number): void {
    activeQueryPath.value = activeQueryPath.value.slice(
      0,
      Math.max(0, depth)
    )
  }

  function clearSavedQuery(): void {
    localStorage.removeItem(storageKey)
    savedAt.value = null
  }

  return {
    model,
    activeModel,
    activeQueryPath,
    queryBreadcrumbs,
    canUndo,
    canRedo,
    savedAt,
    addTable,
    updateTableAlias,
    moveTable,
    setTableCollapsed,
    removeTable,
    addSelectedField,
    setFieldSelected,
    updateSelectedField,
    reorderSelectedField,
    setDistinct,
    setJoins,
    addJoin,
    setFilters,
    setGrouping,
    addGrouping,
    setSorting,
    addSorting,
    setPagination,
    undo,
    redo,
    reset,
    restore,
    applyImportedModel,
    enterSubquery,
    enterSetOperation,
    navigateToQueryDepth,
    clearSavedQuery
  }
}
