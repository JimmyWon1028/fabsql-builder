<script setup lang="ts">
import type {
  FilterCondition,
  FilterGroup,
  FilterOperator,
  QueryFilterValue,
  QueryTable,
  SchemaColumn
} from '@sql-builder/shared'
import { cloneQueryData } from '@sql-builder/shared'

import {
  useApplicationPreferences
} from '../preferences/use-application-preferences'
import {
  formatQueryExpression
} from '../query-builder/format-query-expression'

const props = defineProps<{
  group: FilterGroup
  tables: QueryTable[]
  columnsByTable: Record<string, SchemaColumn[]>
  root?: boolean
}>()

const emit = defineEmits<{
  change: [group: FilterGroup]
  remove: []
}>()
const { t } = useApplicationPreferences()

const operators: FilterOperator[] = [
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
]

let localIdSequence = 0

function createId(prefix: string): string {
  localIdSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${localIdSequence}`
}

function update(mutator: (draft: FilterGroup) => void): void {
  const draft = cloneQueryData(props.group)
  mutator(draft)
  emit('change', draft)
}

function updateCondition(
  conditionIndex: number,
  mutator: (condition: FilterCondition) => void
): void {
  update((draft) => {
    const node = draft.children[conditionIndex]

    if (node?.kind === 'condition') {
      mutator(node)
    }
  })
}

function addCondition(): void {
  const table = props.tables[0]
  const column = table
    ? props.columnsByTable[table.id]?.[0]
    : undefined

  if (!table || !column) {
    return
  }

  update((draft) => {
    draft.children.push({
      id: createId('condition'),
      kind: 'condition',
      field: {
        tableId: table.id,
        columnName: column.name
      },
      operator: '=',
      value: ''
    })
  })
}

function addGroup(): void {
  update((draft) => {
    draft.children.push({
      id: createId('filter-group'),
      kind: 'group',
      conjunction: 'AND',
      children: []
    })
  })
}

function removeChild(index: number): void {
  update((draft) => {
    draft.children.splice(index, 1)
  })
}

function updateChildGroup(index: number, childGroup: FilterGroup): void {
  update((draft) => {
    draft.children[index] = childGroup
  })
}

function updateConditionTable(index: number, tableId: string): void {
  const firstColumn = props.columnsByTable[tableId]?.[0]

  updateCondition(index, (condition) => {
    condition.field.tableId = tableId
    condition.field.columnName = firstColumn?.name ?? ''
  })
}

function updateConditionOperator(
  index: number,
  operator: FilterOperator
): void {
  updateCondition(index, (condition) => {
    condition.operator = operator

    if (operator === 'IS NULL' || operator === 'IS NOT NULL') {
      delete condition.value
      delete condition.secondValue
    } else if (operator === 'IN' || operator === 'NOT IN') {
      condition.value = []
      delete condition.secondValue
    } else {
      if (Array.isArray(condition.value)) {
        condition.value = ''
      }

      if (operator !== 'BETWEEN') {
        delete condition.secondValue
      }
    }
  })
}

function valueForInput(condition: FilterCondition): string {
  return Array.isArray(condition.value)
    ? condition.value.map(valueForEditor).join(', ')
    : condition.value === undefined
      ? ''
      : valueForEditor(condition.value)
}

function valueForEditor(value: QueryFilterValue): string {
  return typeof value === 'object' && value !== null
    ? `@${value.name}`
    : String(value ?? '')
}

function parseEditorValue(value: string): QueryFilterValue {
  const parameterMatch = value.trim().match(/^@([A-Za-z_][A-Za-z0-9_]*)$/)

  return parameterMatch
    ? {
        kind: 'parameter',
        name: parameterMatch[1] ?? ''
      }
    : value
}

function updateConditionValue(index: number, value: string): void {
  updateCondition(index, (condition) => {
    condition.value = (
      condition.operator === 'IN' || condition.operator === 'NOT IN'
    )
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .map(parseEditorValue)
      : parseEditorValue(value)
  })
}

function updateSecondValue(
  index: number,
  value: string
): void {
  updateCondition(index, (condition) => {
    condition.secondValue = parseEditorValue(value)
  })
}
</script>

<template>
  <fieldset
    class="filter-group"
    :class="{ 'filter-group--root': root }"
  >
    <legend class="visually-hidden">
      {{ root ? t('filters.title') : t('filters.nested') }}
    </legend>

    <div class="filter-group__toolbar">
      <select
        :value="group.conjunction"
        :aria-label="t('filters.conjunction')"
        @change="update((draft) => {
          draft.conjunction =
            ($event.target as HTMLSelectElement).value as 'AND' | 'OR'
        })"
      >
        <option value="AND">AND</option>
        <option value="OR">OR</option>
      </select>
      <span>
        {{ t('filters.conditionCount', {
          count: group.children.length
        }) }}
      </span>
      <button type="button" @click="addCondition">
        {{ t('filters.addCondition') }}
      </button>
      <button type="button" @click="addGroup">
        {{ t('filters.addGroup') }}
      </button>
      <button
        v-if="!root"
        type="button"
        class="text-button text-button--danger"
        @click="emit('remove')"
      >
        {{ t('filters.removeGroup') }}
      </button>
    </div>

    <div
      v-if="group.children.length === 0"
      class="filter-group__empty"
    >
      {{ t('filters.empty') }}
    </div>

    <template
      v-for="(node, index) in group.children"
      :key="node.id"
    >
      <div
        v-if="node.kind === 'condition'"
        class="filter-condition"
      >
        <code
          v-if="node.expression"
          class="filter-condition__expression"
          :title="formatQueryExpression(node.expression, tables)"
        >
          {{ formatQueryExpression(node.expression, tables) }}
        </code>
        <select
          v-else
          :value="node.field.tableId"
          :aria-label="t('filters.table')"
          @change="updateConditionTable(
            index,
            ($event.target as HTMLSelectElement).value
          )"
        >
          <option
            v-for="table in tables"
            :key="table.id"
            :value="table.id"
          >
            {{ table.alias }}
          </option>
        </select>
        <select
          v-if="!node.expression"
          :value="node.field.columnName"
          :aria-label="t('filters.field')"
          @change="updateCondition(index, (condition) => {
            condition.field.columnName =
              ($event.target as HTMLSelectElement).value
          })"
        >
          <option
            v-for="column in columnsByTable[node.field.tableId] ?? []"
            :key="column.name"
            :value="column.name"
          >
            {{ column.name }}
          </option>
        </select>
        <select
          :value="node.operator"
          :aria-label="t('filters.operator')"
          @change="updateConditionOperator(
            index,
            ($event.target as HTMLSelectElement).value as FilterOperator
          )"
        >
          <option
            v-for="operator in operators"
            :key="operator"
            :value="operator"
          >
            {{ operator }}
          </option>
        </select>
        <code
          v-if="node.rightExpression"
          class="filter-condition__right-expression"
          :title="formatQueryExpression(node.rightExpression, tables)"
        >
          {{ formatQueryExpression(node.rightExpression, tables) }}
        </code>
        <input
          v-else-if="node.operator !== 'IS NULL'
            && node.operator !== 'IS NOT NULL'"
          :value="valueForInput(node)"
          type="text"
          :placeholder="node.operator === 'IN' || node.operator === 'NOT IN'
            ? 'value1, value2'
            : t('filters.value')"
          :aria-label="t('filters.value')"
          @input="updateConditionValue(
            index,
            ($event.target as HTMLInputElement).value
          )"
        >
        <input
          v-if="node.operator === 'BETWEEN'"
          :value="node.secondValue === undefined
            ? ''
            : valueForEditor(node.secondValue)"
          type="text"
          :placeholder="t('filters.secondValue')"
          :aria-label="t('filters.secondValue')"
          @input="updateSecondValue(
            index,
            ($event.target as HTMLInputElement).value
          )"
        >
        <button
          type="button"
          class="icon-button icon-button--danger"
          :aria-label="t('filters.removeCondition')"
          @click="removeChild(index)"
        >
          ×
        </button>
      </div>

      <FilterGroupEditor
        v-else
        :group="node"
        :tables="tables"
        :columns-by-table="columnsByTable"
        @change="updateChildGroup(index, $event)"
        @remove="removeChild(index)"
      />
    </template>
  </fieldset>
</template>
