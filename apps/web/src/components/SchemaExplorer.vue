<script setup lang="ts">
import type { SchemaColumn, SchemaTable } from '@sql-builder/shared'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'

import {
  useApplicationPreferences
} from '../preferences/use-application-preferences'
import { writeDragPayload } from '../query-builder/drag-payload'
import { getColumns, getTables } from '../services/schema-api'

const props = defineProps<{
  databaseName: string
}>()

const emit = defineEmits<{
  addTable: [table: SchemaTable]
  addField: [table: SchemaTable, column: SchemaColumn]
}>()
const { t } = useApplicationPreferences()

const tables = ref<SchemaTable[]>([])
const searchText = ref('')
const expandedTables = ref(new Set<string>())
const columnsByTable = ref(new Map<string, SchemaColumn[]>())
const loadingTables = ref(new Set<string>())
const columnErrorsByTable = ref(new Map<string, string>())
const loading = ref(true)
const errorMessage = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const normalizedSearch = computed(() =>
  searchText.value.trim().toLocaleLowerCase('zh-Hant')
)

const filteredTables = computed(() => {
  const search = normalizedSearch.value

  if (!search) {
    return tables.value
  }

  return tables.value.filter((table) =>
    table.name.toLocaleLowerCase('en-US').includes(search)
  )
})

function isExpanded(tableName: string): boolean {
  return expandedTables.value.has(tableName)
}

function isLoadingColumns(tableName: string): boolean {
  return loadingTables.value.has(tableName)
}

function getLoadedColumns(tableName: string): SchemaColumn[] {
  return columnsByTable.value.get(tableName) ?? []
}

async function toggleTable(table: SchemaTable): Promise<void> {
  const databaseName = props.databaseName
  const nextExpanded = new Set(expandedTables.value)

  if (nextExpanded.has(table.name)) {
    nextExpanded.delete(table.name)
    expandedTables.value = nextExpanded
    return
  }

  nextExpanded.add(table.name)
  expandedTables.value = nextExpanded

  if (
    columnsByTable.value.has(table.name)
    || loadingTables.value.has(table.name)
  ) {
    return
  }

  const nextErrors = new Map(columnErrorsByTable.value)
  nextErrors.delete(table.name)
  columnErrorsByTable.value = nextErrors
  const nextLoading = new Set(loadingTables.value)
  nextLoading.add(table.name)
  loadingTables.value = nextLoading

  try {
    const response = await getColumns(table.name, databaseName)

    if (databaseName !== props.databaseName) {
      return
    }

    const nextColumns = new Map(columnsByTable.value)
    nextColumns.set(table.name, response.columns)
    columnsByTable.value = nextColumns
  } catch (error) {
    const nextColumnErrors = new Map(columnErrorsByTable.value)
    nextColumnErrors.set(
      table.name,
      error instanceof Error
        ? error.message
        : t('schema.columnsFailed')
    )
    columnErrorsByTable.value = nextColumnErrors
  } finally {
    if (databaseName !== props.databaseName) {
      return
    }

    const finishedLoading = new Set(loadingTables.value)
    finishedLoading.delete(table.name)
    loadingTables.value = finishedLoading
  }
}

function refreshTables(): void {
  expandedTables.value = new Set()
  columnsByTable.value = new Map()
  loadingTables.value = new Set()
  columnErrorsByTable.value = new Map()
  void loadTables()
}

async function loadTables(
  databaseName = props.databaseName
): Promise<void> {
  if (!databaseName) {
    return
  }

  loading.value = true
  errorMessage.value = ''

  try {
    const response = await getTables(databaseName)

    if (databaseName !== props.databaseName) {
      return
    }

    tables.value = response.tables
  } catch (error) {
    errorMessage.value = error instanceof Error
      ? error.message
      : t('schema.tablesFailed')
  } finally {
    if (databaseName === props.databaseName) {
      loading.value = false
    }
  }
}

function handleKeyboardShortcut(event: KeyboardEvent): void {
  if (
    (event.metaKey || event.ctrlKey)
    && event.key.toLocaleLowerCase('en-US') === 'k'
  ) {
    event.preventDefault()
    searchInput.value?.focus()
  }
}

function startTableDrag(event: DragEvent, table: SchemaTable): void {
  writeDragPayload(event, {
    kind: 'table',
    tableName: table.name
  })
}

function startFieldDrag(
  event: DragEvent,
  table: SchemaTable,
  column: SchemaColumn
): void {
  writeDragPayload(event, {
    kind: 'field',
    tableName: table.name,
    columnName: column.name
  })
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyboardShortcut)
})

watch(
  () => props.databaseName,
  (databaseName) => {
    tables.value = []
    expandedTables.value = new Set()
    columnsByTable.value = new Map()
    loadingTables.value = new Set()
    columnErrorsByTable.value = new Map()
    errorMessage.value = ''
    loading.value = Boolean(databaseName)

    if (databaseName) {
      void loadTables(databaseName)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyboardShortcut)
})
</script>

<template>
  <section
    class="schema-explorer"
    aria-labelledby="schema-explorer-title"
  >
    <header class="schema-explorer__header">
      <div>
        <p class="eyebrow">
          {{ t('schema.database') }}
        </p>
        <h2 id="schema-explorer-title">
          {{ t('schema.title') }}
        </h2>
      </div>
      <button
        class="refresh-button"
        type="button"
        :aria-label="t('schema.refresh')"
        :disabled="loading"
        @click="refreshTables"
      >
        ↻
      </button>
    </header>

    <label class="schema-search">
      <span class="schema-search__icon" aria-hidden="true">⌕</span>
      <span class="visually-hidden">{{ t('schema.search') }}</span>
      <input
        ref="searchInput"
        v-model="searchText"
        type="search"
        :placeholder="t('schema.searchPlaceholder')"
        autocomplete="off"
      >
      <kbd>⌘ K</kbd>
    </label>

    <div class="schema-summary" aria-live="polite">
      <span>{{ t('schema.objects', { count: tables.length }) }}</span>
      <span v-if="normalizedSearch">
        {{ t('schema.results', { count: filteredTables.length }) }}
      </span>
    </div>

    <div
      v-if="errorMessage"
      class="schema-message schema-message--error"
      role="alert"
    >
      <strong>{{ t('schema.connectionFailed') }}</strong>
      <span>{{ errorMessage }}</span>
    </div>

    <div
      v-else-if="loading"
      class="schema-message"
      aria-live="polite"
    >
      <span class="loading-indicator" aria-hidden="true"></span>
      {{ t('schema.reading', { database: databaseName }) }}
    </div>

    <div
      v-else-if="filteredTables.length === 0"
      class="schema-message"
    >
      {{ t('schema.empty') }}
    </div>

    <ul v-else class="schema-tree">
      <li
        v-for="table in filteredTables"
        :key="table.name"
        class="schema-table"
      >
        <div class="schema-table__row">
          <button
            class="schema-table__button"
            type="button"
            draggable="true"
            :aria-expanded="isExpanded(table.name)"
            :title="t('schema.dragTable', { table: table.name })"
            @click="toggleTable(table)"
            @dragstart="startTableDrag($event, table)"
          >
            <span
              class="disclosure"
              :class="{ 'disclosure--expanded': isExpanded(table.name) }"
              aria-hidden="true"
            >
              ›
            </span>
            <span
              class="table-icon"
              aria-hidden="true"
            >
              ▦
            </span>
            <span class="schema-table__name">
              {{ table.name }}
            </span>
          </button>
          <button
            class="schema-add-button"
            type="button"
            :aria-label="t('schema.addTable', { table: table.name })"
            :title="t('schema.addCanvas')"
            @click="emit('addTable', table)"
          >
            +
          </button>
        </div>

        <div
          v-if="isExpanded(table.name)"
          class="schema-table__content"
        >
          <div
            v-if="isLoadingColumns(table.name)"
            class="columns-loading"
          >
            <span class="loading-indicator" aria-hidden="true"></span>
            {{ t('schema.loadingFields') }}
          </div>

          <div
            v-else-if="columnErrorsByTable.get(table.name)"
            class="columns-loading columns-loading--error"
            role="alert"
          >
            {{ columnErrorsByTable.get(table.name) }}
          </div>

          <ul v-else class="column-list">
            <li
              v-for="column in getLoadedColumns(table.name)"
              :key="column.name"
              class="column-item"
              draggable="true"
              :title="t('schema.dragField', {
                field: `${table.name}.${column.name}`
              })"
              @dragstart="startFieldDrag($event, table, column)"
            >
              <span
                class="column-key"
                :class="{
                  'column-key--primary': column.primaryKey,
                  'column-key--indexed': column.indexed && !column.primaryKey
                }"
                :title="column.primaryKey
                  ? t('schema.primaryKey')
                  : column.indexed
                    ? t('schema.indexedColumn')
                    : t('schema.column')"
                aria-hidden="true"
              >
                {{ column.primaryKey ? '◆' : column.indexed ? '◇' : '·' }}
              </span>
              <span class="column-item__name">
                {{ column.name }}
              </span>
              <span
                class="column-item__type"
                :title="column.columnType"
              >
                {{ column.dataType }}
              </span>
              <button
                class="schema-add-button schema-add-button--field"
                type="button"
                :aria-label="t('schema.addField', {
                  field: `${table.name}.${column.name}`
                })"
                :title="t('schema.addSelected')"
                @click="emit('addField', table, column)"
              >
                +
              </button>
            </li>
          </ul>
        </div>
      </li>
    </ul>
  </section>
</template>
