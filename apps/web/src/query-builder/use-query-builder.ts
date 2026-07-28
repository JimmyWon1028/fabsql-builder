import type {
  CanvasPosition,
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
        node.kind === 'group' || node.field.tableId !== tableId
      )
      .map((node) =>
        node.kind === 'group'
          ? removeFilterTableReferences(node, tableId)
          : node
      )
  }
}

export function useQueryBuilder() {
  const initialModel = createEmptyQueryModel()
  const history = new QueryHistory(initialModel, cloneQueryModel)
  const model = shallowRef<QueryModel>(history.current)
  const historyVersion = ref(0)
  const savedAt = ref<Date | null>(null)

  const canUndo = computed(() => {
    historyVersion.value
    return history.canUndo
  })
  const canRedo = computed(() => {
    historyVersion.value
    return history.canRedo
  })

  function syncHistory(nextModel: QueryModel): void {
    model.value = history.commit(nextModel)
    historyVersion.value += 1
  }

  function mutate(mutator: (draft: QueryModel) => void): void {
    const draft = cloneQueryModel(model.value)
    mutator(draft)
    syncHistory(draft)
  }

  function createAlias(tableName: string): string {
    const aliases = new Set(
      model.value.tables.map((table) =>
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
    const table = model.value.tables.find((item) => item.id === tableId)

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
    const table = model.value.tables.find((item) => item.id === tableId)

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
    })
  }

  function removeTable(tableId: string): void {
    if (!model.value.tables.some((table) => table.id === tableId)) {
      return
    }

    mutate((draft) => {
      draft.tables = draft.tables.filter((table) => table.id !== tableId)
      draft.selectedFields = draft.selectedFields.filter(
        (field) => field.field.tableId !== tableId
      )
      draft.joins = draft.joins.filter(
        (join) =>
          join.left.tableId !== tableId && join.right.tableId !== tableId
      )
      draft.filters = removeFilterTableReferences(draft.filters, tableId)
      draft.grouping = draft.grouping.filter(
        (item) => item.field.tableId !== tableId
      )
      draft.sorting = draft.sorting.filter(
        (item) => item.field.tableId !== tableId
      )
    })
  }

  function addSelectedField(
    tableId: string,
    columnName: string
  ): SelectedField {
    const existingField = model.value.selectedFields.find(
      (field) =>
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
    const matchingFields = model.value.selectedFields.filter(
      (field) =>
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
          field.field.tableId !== tableId
          || field.field.columnName !== columnName
      )
    })
  }

  function updateSelectedField(
    selectedField: SelectedField
  ): void {
    const currentField = model.value.selectedFields.find(
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
    const sourceIndex = model.value.selectedFields.findIndex(
      (item) => item.id === selectedFieldId
    )
    const targetIndex = model.value.selectedFields.findIndex(
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

  function addJoin(join: Omit<QueryJoin, 'id'>): boolean {
    const alreadyJoined = model.value.joins.some((existingJoin) =>
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
      model.value.pagination.limit === pagination.limit
      && model.value.pagination.offset === pagination.offset
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
  }

  function redo(): void {
    model.value = history.redo()
    historyVersion.value += 1
  }

  function reset(): void {
    model.value = history.replace(createEmptyQueryModel())
    historyVersion.value += 1
  }

  function restore(nextModel: QueryModel): void {
    model.value = history.replace(nextModel)
    historyVersion.value += 1
  }

  function clearSavedQuery(): void {
    localStorage.removeItem(storageKey)
    savedAt.value = null
  }

  return {
    model,
    canUndo,
    canRedo,
    savedAt,
    addTable,
    updateTableAlias,
    moveTable,
    removeTable,
    addSelectedField,
    setFieldSelected,
    updateSelectedField,
    reorderSelectedField,
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
    clearSavedQuery
  }
}
