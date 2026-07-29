<script setup lang="ts">
import type {
  AggregateFunction,
  FieldReference,
  FilterGroup,
  GroupingField,
  JoinType,
  QueryJoin,
  QueryModel,
  QueryPagination,
  QueryTable,
  SchemaColumn,
  SelectedField,
  SortingField
} from '@sql-builder/shared'
import {
  computed,
  onBeforeUnmount,
  ref,
  watchEffect
} from 'vue'

import {
  useApplicationPreferences
} from '../preferences/use-application-preferences'
import {
  formatQueryExpression,
  formatQueryFilterNode
} from '../query-builder/format-query-expression'
import FilterGroupEditor from './FilterGroupEditor.vue'

type InspectorTab = 'fields' | 'joins' | 'filters' | 'grouping'

const props = defineProps<{
  model: QueryModel
  columnsByTable: Record<string, SchemaColumn[]>
}>()

const emit = defineEmits<{
  setDistinct: [distinct: boolean]
  updateField: [field: SelectedField]
  reorderField: [
    fieldId: string,
    targetFieldId: string,
    placement: 'before' | 'after'
  ]
  addJoin: [join: Omit<QueryJoin, 'id'>]
  setJoins: [joins: QueryJoin[]]
  setFilters: [filters: FilterGroup]
  addGrouping: [grouping: Omit<GroupingField, 'id'>]
  setGrouping: [grouping: GroupingField[]]
  addSorting: [sorting: Omit<SortingField, 'id'>]
  setSorting: [sorting: SortingField[]]
  setPagination: [pagination: QueryPagination]
}>()
const { t } = useApplicationPreferences()

const activeTab = ref<InspectorTab>('fields')
const draggedSelectedFieldId = ref<string | null>(null)
const selectedFieldDropTarget = ref<{
  fieldId: string
  placement: 'before' | 'after'
} | null>(null)
let selectedFieldPointerDrag: {
  fieldId: string
  pointerId: number
  handle: HTMLElement
} | null = null
const joinType = ref<JoinType>('JOIN')
const leftTableId = ref('')
const leftColumnName = ref('')
const rightTableId = ref('')
const rightColumnName = ref('')

const aggregateFunctions: AggregateFunction[] = [
  'none',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX'
]

const allFields = computed(() =>
  props.model.tables.flatMap((table) =>
    (props.columnsByTable[table.id] ?? []).map((column) => ({
      field: {
        tableId: table.id,
        columnName: column.name
      },
      label: `${table.alias}.${column.name}`
    }))
  )
)

const currentJoinExists = computed(() =>
  props.model.joins.some((join) =>
    (
      join.left.tableId === leftTableId.value
      && join.right.tableId === rightTableId.value
    )
    || (
      join.left.tableId === rightTableId.value
      && join.right.tableId === leftTableId.value
    )
  )
)

const canAddCurrentJoin = computed(() =>
  Boolean(
    leftTableId.value
    && leftColumnName.value
    && rightTableId.value
    && rightColumnName.value
    && leftTableId.value !== rightTableId.value
    && !currentJoinExists.value
  )
)

watchEffect(() => {
  const firstTable = props.model.tables[0]
  const secondTable = props.model.tables[1]

  if (!props.model.tables.some((table) => table.id === leftTableId.value)) {
    leftTableId.value = firstTable?.id ?? ''
  }

  if (
    !props.model.tables.some((table) => table.id === rightTableId.value)
    || rightTableId.value === leftTableId.value
  ) {
    rightTableId.value = secondTable?.id
      ?? props.model.tables.find(
        (table) => table.id !== leftTableId.value
      )?.id
      ?? ''
  }

  const leftColumns = props.columnsByTable[leftTableId.value] ?? []
  const rightColumns = props.columnsByTable[rightTableId.value] ?? []

  if (!leftColumns.some((column) => column.name === leftColumnName.value)) {
    leftColumnName.value = leftColumns[0]?.name ?? ''
  }

  if (!rightColumns.some((column) => column.name === rightColumnName.value)) {
    rightColumnName.value = rightColumns[0]?.name ?? ''
  }
})

function tableForId(tableId: string): QueryTable | undefined {
  return props.model.tables.find((table) => table.id === tableId)
}

function fieldLabel(field: FieldReference): string {
  const table = tableForId(field.tableId)
  return `${table?.alias ?? '?'}.${field.columnName}`
}

function selectedFieldLabel(field: SelectedField): string {
  return field.expression
    ? formatQueryExpression(field.expression, props.model.tables)
    : fieldLabel(field.field)
}

function updateSelectedField(
  field: SelectedField,
  patch: Partial<SelectedField>
): void {
  const updatedField = {
    ...field,
    ...patch
  }

  if (updatedField.aggregate === 'none') {
    updatedField.distinct = false
  }

  emit('updateField', updatedField)
}

function startSelectedFieldPointerDrag(
  event: PointerEvent,
  fieldId: string
): void {
  if (event.button !== 0) {
    return
  }

  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  selectedFieldPointerDrag = {
    fieldId,
    pointerId: event.pointerId,
    handle
  }
  draggedSelectedFieldId.value = fieldId
  selectedFieldDropTarget.value = null
  document.body.classList.add('is-reordering-selected-field')
  window.addEventListener(
    'mouseup',
    finishSelectedFieldMouseDrag,
    { once: true }
  )
}

function updateSelectedFieldPointerDrag(
  event: PointerEvent
): void {
  if (
    !selectedFieldPointerDrag
    || selectedFieldPointerDrag.pointerId !== event.pointerId
  ) {
    return
  }

  event.preventDefault()
  const target = document.elementFromPoint(
    event.clientX,
    event.clientY
  ) as HTMLElement | null
  const row = target?.closest<HTMLTableRowElement>(
    '[data-selected-field-id]'
  )
  const fieldId = row?.dataset.selectedFieldId

  if (!row || !fieldId || fieldId === selectedFieldPointerDrag.fieldId) {
    selectedFieldDropTarget.value = null
    return
  }

  const bounds = row.getBoundingClientRect()
  selectedFieldDropTarget.value = {
    fieldId,
    placement: event.clientY < bounds.top + bounds.height / 2
      ? 'before'
      : 'after'
  }
}

function completeSelectedFieldPointerDrag(cancelled = false): void {
  if (!selectedFieldPointerDrag) {
    return
  }

  const {
    fieldId,
    handle,
    pointerId
  } = selectedFieldPointerDrag
  const dropTarget = selectedFieldDropTarget.value

  if (handle.hasPointerCapture(pointerId)) {
    handle.releasePointerCapture(pointerId)
  }

  if (!cancelled && dropTarget) {
    emit(
      'reorderField',
      fieldId,
      dropTarget.fieldId,
      dropTarget.placement
    )
  }

  selectedFieldPointerDrag = null
  draggedSelectedFieldId.value = null
  selectedFieldDropTarget.value = null
  document.body.classList.remove('is-reordering-selected-field')
  window.removeEventListener('mouseup', finishSelectedFieldMouseDrag)
}

function finishSelectedFieldPointerDrag(
  event: PointerEvent,
  cancelled = false
): void {
  if (
    !selectedFieldPointerDrag
    || selectedFieldPointerDrag.pointerId !== event.pointerId
  ) {
    return
  }

  completeSelectedFieldPointerDrag(cancelled)
}

function finishSelectedFieldMouseDrag(): void {
  completeSelectedFieldPointerDrag()
}

function addCurrentJoin(): void {
  if (
    !leftTableId.value
    || !leftColumnName.value
    || !rightTableId.value
    || !rightColumnName.value
    || leftTableId.value === rightTableId.value
  ) {
    return
  }

  emit('addJoin', {
    type: joinType.value,
    left: {
      tableId: leftTableId.value,
      columnName: leftColumnName.value
    },
    right: {
      tableId: rightTableId.value,
      columnName: rightColumnName.value
    }
  })
}

function updateJoinType(joinId: string, type: JoinType): void {
  emit('setJoins', props.model.joins.map((join) =>
    join.id === joinId
      ? { ...join, type }
      : join
  ))
}

function removeJoin(joinId: string): void {
  emit('setJoins', props.model.joins.filter((join) => join.id !== joinId))
}

function addGrouping(): void {
  const firstField = allFields.value[0]?.field

  if (firstField) {
    emit('addGrouping', {
      field: firstField
    })
  }
}

function addSorting(): void {
  const firstField = allFields.value[0]?.field

  if (firstField) {
    emit('addSorting', {
      field: firstField,
      direction: 'ASC'
    })
  }
}

function encodeField(field: FieldReference): string {
  return `${field.tableId}\u0000${field.columnName}`
}

function decodeField(value: string): FieldReference {
  const [tableId, columnName] = value.split('\u0000')
  return {
    tableId: tableId ?? '',
    columnName: columnName ?? ''
  }
}

function updateGroupingField(
  groupingId: string,
  field: FieldReference
): void {
  emit('setGrouping', props.model.grouping.map((grouping) =>
    grouping.id === groupingId
      ? {
          ...grouping,
          field,
          expression: undefined
        }
      : grouping
  ))
}

function removeGrouping(groupingId: string): void {
  emit(
    'setGrouping',
    props.model.grouping.filter((grouping) => grouping.id !== groupingId)
  )
}

function updateSortingField(
  sortingId: string,
  patch: Partial<SortingField>
): void {
  emit('setSorting', props.model.sorting.map((sorting) =>
    sorting.id === sortingId
      ? { ...sorting, ...patch }
      : sorting
  ))
}

function removeSorting(sortingId: string): void {
  emit(
    'setSorting',
    props.model.sorting.filter((sorting) => sorting.id !== sortingId)
  )
}

function updatePagination(
  patch: Partial<QueryPagination>
): void {
  emit('setPagination', {
    ...props.model.pagination,
    ...patch
  })
}

onBeforeUnmount(() => {
  completeSelectedFieldPointerDrag(true)
})

</script>

<template>
  <aside class="query-inspector" :aria-label="t('inspector.title')">
    <nav class="inspector-tabs" :aria-label="t('inspector.settings')">
      <button
        type="button"
        :class="{ active: activeTab === 'fields' }"
        @click="activeTab = 'fields'"
      >
        {{ t('inspector.fields') }}
        <span>{{ model.selectedFields.length }}</span>
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'joins' }"
        @click="activeTab = 'joins'"
      >
        JOIN <span>{{ model.joins.length }}</span>
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'filters' }"
        @click="activeTab = 'filters'"
      >
        {{ t('inspector.filters') }}
        <span>{{ model.filters.children.length }}</span>
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'grouping' }"
        @click="activeTab = 'grouping'"
      >
        {{ t('inspector.more') }}
      </button>
    </nav>

    <div class="inspector-editor">
      <section
        v-if="activeTab === 'fields'"
        class="inspector-section"
        aria-labelledby="selected-fields-title"
      >
        <div class="section-heading">
          <div>
            <p class="eyebrow">SELECT</p>
            <h2 id="selected-fields-title">
              {{ t('inspector.selectedFields') }}
            </h2>
          </div>
          <label class="query-distinct-option">
            <input
              :checked="Boolean(model.distinct)"
              type="checkbox"
              @change="emit(
                'setDistinct',
                ($event.target as HTMLInputElement).checked
              )"
            >
            {{ t('inspector.queryDistinct') }}
          </label>
        </div>

        <div
          v-if="model.selectedFields.length === 0"
          class="inspector-empty"
        >
          {{ t('inspector.noSelectedFields') }}
        </div>

        <div v-else class="selected-fields-table-wrap">
          <table class="selected-fields-table">
            <thead>
              <tr>
                <th scope="col">{{ t('inspector.field') }}</th>
                <th scope="col">{{ t('inspector.function') }}</th>
                <th scope="col">{{ t('inspector.alias') }}</th>
                <th scope="col" class="selected-fields-table__distinct">
                  {{ t('inspector.distinct') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="field in model.selectedFields"
                :key="field.id"
                :data-selected-field-id="field.id"
                :class="{
                  'selected-fields-table__row--dragging':
                    draggedSelectedFieldId === field.id,
                  'selected-fields-table__row--drop-before':
                    selectedFieldDropTarget?.fieldId === field.id
                    && selectedFieldDropTarget.placement === 'before',
                  'selected-fields-table__row--drop-after':
                    selectedFieldDropTarget?.fieldId === field.id
                    && selectedFieldDropTarget.placement === 'after'
                }"
              >
                <td>
                  <div
                    class="selected-field-drag-handle"
                    :title="t('inspector.dragField', {
                      field: selectedFieldLabel(field)
                    })"
                    @pointercancel="finishSelectedFieldPointerDrag(
                      $event,
                      true
                    )"
                    @pointerdown.stop="startSelectedFieldPointerDrag(
                      $event,
                      field.id
                    )"
                    @pointermove="updateSelectedFieldPointerDrag"
                    @pointerup="finishSelectedFieldPointerDrag"
                  >
                    <span aria-hidden="true">⋮⋮</span>
                    <code :title="selectedFieldLabel(field)">
                      {{ selectedFieldLabel(field) }}
                    </code>
                  </div>
                </td>
                <td>
                  <label>
                    <span class="visually-hidden">
                      {{ selectedFieldLabel(field) }}
                      {{ t('inspector.function') }}
                    </span>
                    <select
                      :value="field.aggregate"
                      @change="updateSelectedField(field, {
                        aggregate: (
                          $event.target as HTMLSelectElement
                        ).value as AggregateFunction
                      })"
                    >
                      <option
                        v-for="aggregate in aggregateFunctions"
                        :key="aggregate"
                        :value="aggregate"
                      >
                        {{ aggregate }}
                      </option>
                    </select>
                  </label>
                </td>
                <td>
                  <label>
                    <span class="visually-hidden">
                      {{ selectedFieldLabel(field) }}
                      {{ t('inspector.alias') }}
                    </span>
                    <input
                      :value="field.alias"
                      type="text"
                      :placeholder="t('common.optional')"
                      @input="updateSelectedField(field, {
                        alias: ($event.target as HTMLInputElement).value
                      })"
                    >
                  </label>
                </td>
                <td class="selected-fields-table__distinct">
                  <label>
                    <span class="visually-hidden">
                      {{ selectedFieldLabel(field) }}
                      {{ t('inspector.distinct') }}
                    </span>
                    <input
                      :checked="field.distinct"
                      type="checkbox"
                      :disabled="field.aggregate === 'none'"
                      @change="updateSelectedField(field, {
                        distinct: ($event.target as HTMLInputElement).checked
                      })"
                    >
                  </label>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        v-else-if="activeTab === 'joins'"
        class="inspector-section"
        aria-labelledby="joins-title"
      >
        <div class="section-heading">
          <div>
            <p class="eyebrow">{{ t('inspector.manual') }}</p>
            <h2 id="joins-title">JOIN</h2>
          </div>
        </div>
        <p class="section-help">
          {{ t('inspector.joinHelp') }}
        </p>

        <div class="join-form">
          <select
            v-model="joinType"
            :aria-label="t('inspector.joinType')"
          >
            <option value="JOIN">JOIN</option>
            <option value="INNER">INNER JOIN</option>
            <option value="LEFT">LEFT JOIN</option>
            <option value="RIGHT">RIGHT JOIN</option>
          </select>
          <div class="join-side">
            <select
              v-model="leftTableId"
              :aria-label="t('inspector.leftTable')"
            >
              <option
                v-for="table in model.tables"
                :key="table.id"
                :value="table.id"
              >
                {{ table.alias }}
              </option>
            </select>
            <select
              v-model="leftColumnName"
              :aria-label="t('inspector.leftField')"
            >
              <option
                v-for="column in columnsByTable[leftTableId] ?? []"
                :key="column.name"
                :value="column.name"
              >
                {{ column.name }}
              </option>
            </select>
          </div>
          <span class="join-equals">=</span>
          <div class="join-side">
            <select
              v-model="rightTableId"
              :aria-label="t('inspector.rightTable')"
            >
              <option
                v-for="table in model.tables"
                :key="table.id"
                :value="table.id"
                :disabled="table.id === leftTableId"
              >
                {{ table.alias }}
              </option>
            </select>
            <select
              v-model="rightColumnName"
              :aria-label="t('inspector.rightField')"
            >
              <option
                v-for="column in columnsByTable[rightTableId] ?? []"
                :key="column.name"
                :value="column.name"
              >
                {{ column.name }}
              </option>
            </select>
          </div>
          <button
            type="button"
            class="primary-button"
            :disabled="!canAddCurrentJoin"
            @click="addCurrentJoin"
          >
            {{ t('inspector.addJoin') }}
          </button>
        </div>

        <div
          v-if="model.joins.length === 0"
          class="inspector-empty"
        >
          {{ t('inspector.noJoins') }}
        </div>
        <ul v-else class="join-list">
          <li v-for="join in model.joins" :key="join.id">
            <select
              :value="join.type"
              @change="updateJoinType(
                join.id,
                ($event.target as HTMLSelectElement).value as JoinType
              )"
            >
              <option value="JOIN">JOIN</option>
              <option value="INNER">INNER</option>
              <option value="LEFT">LEFT</option>
              <option value="RIGHT">RIGHT</option>
            </select>
            <div class="join-list__conditions">
              <code>
                {{ join.onExpression
                  ? formatQueryExpression(join.onExpression, model.tables)
                  : `${fieldLabel(join.left)} = ${fieldLabel(join.right)}` }}
              </code>
              <code
                v-if="join.conditions
                  && join.conditions.children.length > 0"
                class="join-list__extra-condition"
              >
                AND {{ formatQueryFilterNode(
                  join.conditions,
                  model.tables
                ) }}
              </code>
            </div>
            <button
              type="button"
              class="icon-button icon-button--danger"
              :aria-label="t('inspector.removeJoin')"
              @click="removeJoin(join.id)"
            >
              ×
            </button>
          </li>
        </ul>
      </section>

      <section
        v-else-if="activeTab === 'filters'"
        class="inspector-section"
        aria-labelledby="filters-title"
      >
        <div class="section-heading">
          <div>
            <p class="eyebrow">WHERE</p>
            <h2 id="filters-title">{{ t('inspector.filters') }}</h2>
          </div>
        </div>
        <FilterGroupEditor
          :group="model.filters"
          :tables="model.tables"
          :columns-by-table="columnsByTable"
          root
          @change="emit('setFilters', $event)"
        />
      </section>

      <section
        v-else
        class="inspector-section"
        aria-labelledby="more-title"
      >
        <div class="section-heading">
          <div>
            <p class="eyebrow">GROUP / SORT / PAGE</p>
            <h2 id="more-title">{{ t('inspector.queryOptions') }}</h2>
          </div>
        </div>

        <div class="option-block">
          <div class="option-block__heading">
            <strong>GROUP BY</strong>
            <button type="button" @click="addGrouping">
              ＋ {{ t('common.add') }}
            </button>
          </div>
          <div
            v-for="grouping in model.grouping"
            :key="grouping.id"
            class="option-row"
          >
            <code
              v-if="grouping.expression"
              class="option-row__sorting-expression"
              :title="formatQueryExpression(
                grouping.expression,
                model.tables
              )"
            >
              {{ formatQueryExpression(
                grouping.expression,
                model.tables
              ) }}
            </code>
            <select
              v-else
              :value="encodeField(grouping.field)"
              @change="updateGroupingField(
                grouping.id,
                decodeField(($event.target as HTMLSelectElement).value)
              )"
            >
              <option
                v-for="item in allFields"
                :key="encodeField(item.field)"
                :value="encodeField(item.field)"
              >
                {{ item.label }}
              </option>
            </select>
            <button
              type="button"
              class="icon-button icon-button--danger"
              :aria-label="t('inspector.removeGroupBy')"
              @click="removeGrouping(grouping.id)"
            >
              ×
            </button>
          </div>
        </div>

        <div class="option-block">
          <div class="option-block__heading">
            <strong>ORDER BY</strong>
            <button type="button" @click="addSorting">
              ＋ {{ t('common.add') }}
            </button>
          </div>
          <div
            v-for="sorting in model.sorting"
            :key="sorting.id"
            class="option-row option-row--sort"
          >
            <code
              v-if="sorting.expression"
              class="option-row__sorting-expression"
              :title="formatQueryExpression(
                sorting.expression,
                model.tables
              )"
            >
              {{ formatQueryExpression(
                sorting.expression,
                model.tables
              ) }}
            </code>
            <select
              v-else
              :value="encodeField(sorting.field)"
              @change="updateSortingField(sorting.id, {
                field: decodeField(
                  ($event.target as HTMLSelectElement).value
                ),
                expression: undefined,
                outputReference: undefined
              })"
            >
              <option
                v-for="item in allFields"
                :key="encodeField(item.field)"
                :value="encodeField(item.field)"
              >
                {{ item.label }}
              </option>
            </select>
            <code
              v-if="sorting.outputReference"
              class="option-row__output-reference"
              :title="t('inspector.orderByOutputReference')"
            >
              {{ sorting.outputReference }}
            </code>
            <select
              :value="sorting.direction"
              :aria-label="t('inspector.sortDirection')"
              @change="updateSortingField(sorting.id, {
                direction:
                  ($event.target as HTMLSelectElement).value as 'ASC' | 'DESC'
              })"
            >
              <option value="ASC">ASC</option>
              <option value="DESC">DESC</option>
            </select>
            <button
              type="button"
              class="icon-button icon-button--danger"
              :aria-label="t('inspector.removeOrderBy')"
              @click="removeSorting(sorting.id)"
            >
              ×
            </button>
          </div>
        </div>

        <div class="option-block">
          <div class="option-block__heading">
            <strong>{{ t('inspector.pagination') }}</strong>
          </div>
          <div class="pagination-row">
            <label>
              <span>LIMIT</span>
              <input
                :value="model.pagination.limit ?? ''"
                type="number"
                min="1"
                placeholder="none"
                @change="updatePagination({
                  limit: ($event.target as HTMLInputElement).value
                    ? Number(($event.target as HTMLInputElement).value)
                    : null
                })"
              >
            </label>
            <label>
              <span>OFFSET</span>
              <input
                :value="model.pagination.offset"
                type="number"
                min="0"
                @change="updatePagination({
                  offset: Number(($event.target as HTMLInputElement).value)
                })"
              >
            </label>
          </div>
        </div>
      </section>
    </div>

  </aside>
</template>
