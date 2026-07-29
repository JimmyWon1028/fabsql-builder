<script setup lang="ts">
import type {
  CompileQueryResult,
  ExecuteQueryResponse,
  QueryModel
} from '@sql-builder/shared'
import {
  computed,
  onBeforeUnmount,
  ref,
  watch
} from 'vue'

import {
  useApplicationPreferences
} from '../preferences/use-application-preferences'
import { highlightSql } from '../query-builder/highlight-sql'
import { executeQuery } from '../services/schema-api'
import RegionMaximizeIcon from './RegionMaximizeIcon.vue'

type WorkspaceTab = 'preview' | 'result'

const props = defineProps<{
  databaseName: string
  model: QueryModel
  compileResult: CompileQueryResult
  quoteIdentifiers: boolean
  namedParameterValues: Record<string, string>
  maximized: boolean
}>()

const emit = defineEmits<{
  'editing-change': [value: boolean]
  'save-model': [model: QueryModel]
  'update:quoteIdentifiers': [value: boolean]
  'update:namedParameterValues': [value: Record<string, string>]
  toggleMaximize: []
}>()
const { t } = useApplicationPreferences()

const activeTab = ref<WorkspaceTab>('preview')
const isResultTabOpen = ref(true)
const copied = ref(false)
const isRunning = ref(false)
const isEditingSql = ref(false)
const isSavingSql = ref(false)
const sqlDraft = ref('')
const sqlEditError = ref('')
const editingParameters = ref<CompileQueryResult['parameters']>([])
const executionError = ref('')
const executionResult = ref<ExecuteQueryResponse | null>(null)
const sqlEditorHighlight = ref<HTMLPreElement | null>(null)
let executionSequence = 0
let copiedResetTimer: number | undefined

const statusLabel = computed(() => {
  if (props.compileResult.status === 'valid') {
    return t('workspace.valid')
  }

  if (props.compileResult.status === 'error') {
    return t('workspace.invalid')
  }

  return t('workspace.incomplete')
})

function removeIdentifierQuotes(sql: string): string {
  return sql.replace(
    /`((?:``|[^`])*)`/g,
    (_, identifier: string) => identifier.replaceAll('``', '`')
  )
}

const displaySql = computed(() => {
  if (
    props.model.sourceSql !== undefined
    && !props.quoteIdentifiers
  ) {
    return removeIdentifierQuotes(props.model.sourceSql)
  }

  return props.quoteIdentifiers
    ? props.compileResult.sql
    : removeIdentifierQuotes(props.compileResult.sql)
})

const highlightedSql = computed(() =>
  highlightSql(displaySql.value)
)
const highlightedSqlDraft = computed(() =>
  highlightSql(sqlDraft.value)
)
const sqlForClipboard = computed(() =>
  isEditingSql.value ? sqlDraft.value : displaySql.value
)
const executionNamedParameterValues = computed(() =>
  Object.fromEntries(
    props.compileResult.namedParameters.map((name) => [
      name,
      props.namedParameterValues[name] ?? ''
    ])
  )
)

function updateNamedParameterValue(
  name: string,
  value: string
): void {
  emit('update:namedParameterValues', {
    ...props.namedParameterValues,
    [name]: value
  })
}

watch(
  () => [props.databaseName, props.model],
  () => {
    executionSequence += 1
    isRunning.value = false
    executionError.value = ''
    executionResult.value = null

    if (isEditingSql.value) {
      cancelSqlEditing()
    }
  }
)

function selectTab(tab: WorkspaceTab): void {
  activeTab.value = tab
}

function closeResultTab(): void {
  executionSequence += 1
  isRunning.value = false
  executionError.value = ''
  executionResult.value = null
  isResultTabOpen.value = false
  activeTab.value = 'preview'
}

async function copySql(): Promise<void> {
  if (!sqlForClipboard.value) {
    return
  }

  try {
    await navigator.clipboard.writeText(sqlForClipboard.value)
    copied.value = true

    if (copiedResetTimer) {
      window.clearTimeout(copiedResetTimer)
    }

    copiedResetTimer = window.setTimeout(() => {
      copied.value = false
      copiedResetTimer = undefined
    }, 1400)
  } catch {
    copied.value = false
  }
}

async function runPreviewQuery(): Promise<void> {
  if (
    props.compileResult.status !== 'valid'
    || !props.databaseName
    || isRunning.value
  ) {
    return
  }

  executionSequence += 1
  const sequence = executionSequence
  isResultTabOpen.value = true
  activeTab.value = 'result'
  isRunning.value = true
  executionError.value = ''
  executionResult.value = null

  try {
    const result = await executeQuery(
      props.databaseName,
      props.model,
      executionNamedParameterValues.value
    )

    if (sequence === executionSequence) {
      executionResult.value = result
    }
  } catch (error) {
    if (sequence === executionSequence) {
      executionError.value = error instanceof Error
        ? error.message
        : t('workspace.executionFailed')
    }
  } finally {
    if (sequence === executionSequence) {
      isRunning.value = false
    }
  }
}

function formatResultCell(
  value: ExecuteQueryResponse['rows'][number][number]
): string {
  return value === null ? 'NULL' : String(value)
}

function localizedIssueMessage(issue: {
  code: string
  message: string
}): string {
  const key = `issue.${issue.code}`
  const translated = t(key)
  return translated === key ? issue.message : translated
}

function setSqlEditing(value: boolean): void {
  if (isEditingSql.value === value) {
    return
  }

  isEditingSql.value = value
  emit('editing-change', value)
}

function synchronizeSqlEditorScroll(event: Event): void {
  const editor = event.currentTarget as HTMLTextAreaElement

  if (!sqlEditorHighlight.value) {
    return
  }

  sqlEditorHighlight.value.scrollTop = editor.scrollTop
  sqlEditorHighlight.value.scrollLeft = editor.scrollLeft
}

function beginSqlEditing(): void {
  if (!displaySql.value || isRunning.value) {
    return
  }

  executionSequence += 1
  isRunning.value = false
  activeTab.value = 'preview'
  sqlDraft.value = displaySql.value
  editingParameters.value = [...props.compileResult.parameters]
  sqlEditError.value = ''
  setSqlEditing(true)
}

function cancelSqlEditing(): void {
  if (isSavingSql.value) {
    return
  }

  sqlDraft.value = ''
  editingParameters.value = []
  sqlEditError.value = ''
  setSqlEditing(false)
}

function isSqlImportError(error: unknown): error is {
  code: string
  detail: string
  message: string
} {
  return error instanceof Error
    && error.name === 'SqlImportError'
    && 'code' in error
    && typeof error.code === 'string'
    && 'detail' in error
    && typeof error.detail === 'string'
}

async function saveSqlEditing(): Promise<void> {
  if (
    !isEditingSql.value
    || isSavingSql.value
    || !sqlDraft.value.trim()
  ) {
    return
  }

  isSavingSql.value = true

  try {
    const { parseSqlToQueryModel } = await import(
      '../query-builder/parse-sql'
    )
    const nextModel = parseSqlToQueryModel(
      sqlDraft.value,
      props.model,
      editingParameters.value
    )

    sqlEditError.value = ''
    setSqlEditing(false)
    emit('save-model', nextModel)
    sqlDraft.value = ''
    editingParameters.value = []
  } catch (error) {
    if (isSqlImportError(error)) {
      const key = `workspace.sqlImport.${error.code}`
      const localizedMessage = t(key)
      sqlEditError.value = localizedMessage === key
        ? error.message
        : error.detail
          ? `${localizedMessage} ${error.detail}`
          : localizedMessage
      return
    }

    sqlEditError.value = t('workspace.sqlImport.syntax')
  } finally {
    isSavingSql.value = false
  }
}

onBeforeUnmount(() => {
  executionSequence += 1

  if (isEditingSql.value) {
    emit('editing-change', false)
  }

  if (copiedResetTimer) {
    window.clearTimeout(copiedResetTimer)
  }
})
</script>

<template>
  <section
    class="query-workspace-panel"
    :class="{ 'workspace-region--maximized': maximized }"
    :aria-label="t('workspace.title')"
  >
    <button
      class="region-maximize-button"
      type="button"
      :aria-label="maximized
        ? t('workspace.restore')
        : t('workspace.maximize')"
      :title="maximized
        ? t('workspace.restoreEsc')
        : t('workspace.maximize')"
      @click="emit('toggleMaximize')"
    >
      <RegionMaximizeIcon :maximized="maximized" />
    </button>

    <section
      v-show="activeTab === 'preview'"
      id="query-workspace-preview-panel"
      class="query-workspace-content sql-preview"
      role="tabpanel"
      aria-labelledby="query-workspace-preview-tab"
    >
      <header>
        <div>
          <h2>SQL Preview</h2>
        </div>
        <label class="sql-preview__quote-option">
          <input
            :checked="quoteIdentifiers"
            :disabled="isEditingSql"
            type="checkbox"
            @change="emit(
              'update:quoteIdentifiers',
              ($event.target as HTMLInputElement).checked
            )"
          >
          {{ t('workspace.quoteIdentifiers') }}
        </label>
        <span
          v-if="isEditingSql"
          class="compile-status compile-status--editing"
        >
          {{ t('workspace.sqlEditing') }}
        </span>
        <span
          v-else
          class="compile-status"
          :class="`compile-status--${compileResult.status}`"
        >
          {{ statusLabel }}
        </span>
        <button
          v-if="!isEditingSql"
          type="button"
          :disabled="!displaySql || isRunning"
          @click="beginSqlEditing"
        >
          {{ t('workspace.editSql') }}
        </button>
        <template v-else>
          <button
            class="sql-preview__save-button"
            type="button"
            :disabled="isSavingSql || !sqlDraft.trim()"
            @click="saveSqlEditing"
          >
            {{ isSavingSql
              ? t('workspace.savingSql')
              : t('workspace.saveSql') }}
          </button>
          <button
            type="button"
            :disabled="isSavingSql"
            @click="cancelSqlEditing"
          >
            {{ t('workspace.cancelSql') }}
          </button>
        </template>
        <button
          class="run-query-button"
          type="button"
          :disabled="isEditingSql
            || compileResult.status !== 'valid'
            || isRunning"
          @click="runPreviewQuery"
        >
          {{ isRunning ? t('workspace.running') : t('workspace.run') }}
        </button>
        <button
          type="button"
          :disabled="!sqlForClipboard"
          @click="copySql"
        >
          {{ copied ? t('workspace.copied') : t('workspace.copy') }}
        </button>
      </header>

      <div v-if="isEditingSql" class="sql-preview__editor-region">
        <p class="sql-preview__editing-hint">
          {{ t('workspace.sqlEditingHint') }}
        </p>
        <div class="sql-preview__editor-shell">
          <pre
            ref="sqlEditorHighlight"
            class="sql-preview__editor-highlight"
            aria-hidden="true"
          ><code><span
            v-for="(token, index) in highlightedSqlDraft"
            :key="`${index}-${token.type}`"
            :class="token.type === 'plain'
              ? undefined
              : `sql-token sql-token--${token.type}`"
          >{{ token.value }}</span></code></pre>
          <textarea
            v-model="sqlDraft"
            class="sql-preview__editor"
            :aria-label="t('workspace.sqlEditorLabel')"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            wrap="off"
            @scroll="synchronizeSqlEditorScroll"
          ></textarea>
        </div>
        <p
          v-if="sqlEditError"
          class="sql-preview__edit-error"
          role="alert"
        >
          {{ sqlEditError }}
        </p>
      </div>
      <pre v-else-if="displaySql"><code><span
        v-for="(token, index) in highlightedSql"
        :key="`${index}-${token.type}`"
        :class="token.type === 'plain'
          ? undefined
          : `sql-token sql-token--${token.type}`"
      >{{ token.value }}</span></code></pre>
      <div v-else class="sql-preview__issues">
        <p
          v-for="issue in compileResult.issues"
          :key="`${issue.code}-${issue.targetId ?? ''}`"
          :class="`issue--${issue.severity}`"
        >
          {{ localizedIssueMessage(issue) }}
        </p>
      </div>

      <details
        v-if="!isEditingSql && compileResult.parameters.length > 0"
      >
        <summary>
          {{ t('workspace.parameters', {
            count: compileResult.parameters.length
          }) }}
        </summary>
        <pre><code>{{ JSON.stringify(
          compileResult.parameters,
          null,
          2
        ) }}</code></pre>
      </details>
      <details
        v-if="!isEditingSql && compileResult.namedParameters.length > 0"
        class="sql-preview__named-parameters"
      >
        <summary>
          {{ t('workspace.namedParameters', {
            count: compileResult.namedParameters.length
          }) }}
        </summary>
        <p>{{ t('workspace.namedParameterHint') }}</p>
        <div class="named-parameter-grid">
          <label
            v-for="name in compileResult.namedParameters"
            :key="name"
          >
            <span>@{{ name }}</span>
            <input
              :value="namedParameterValues[name] ?? ''"
              type="text"
              autocomplete="off"
              spellcheck="false"
              @input="updateNamedParameterValue(
                name,
                ($event.target as HTMLInputElement).value
              )"
            >
          </label>
        </div>
      </details>
    </section>

    <section
      v-if="isResultTabOpen"
      v-show="activeTab === 'result'"
      id="query-workspace-result-panel"
      class="query-workspace-content query-result-panel"
      role="tabpanel"
      aria-labelledby="query-workspace-result-tab"
    >
      <div v-if="isRunning" class="query-result-placeholder" role="status">
        {{ t('workspace.executing') }}
      </div>

      <div
        v-else-if="executionError"
        class="query-result query-result--error"
        role="alert"
      >
        {{ executionError }}
      </div>

      <section
        v-else-if="executionResult"
        class="query-result"
        aria-labelledby="query-result-title"
      >
        <header class="query-result__header">
          <strong id="query-result-title">
            {{ t('workspace.result') }}
          </strong>
          <span>
            {{ t('workspace.rows', {
              count: executionResult.rowCount,
              duration: executionResult.durationMs
            }) }}
            <template v-if="executionResult.truncated">
              {{ t('workspace.truncated') }}
            </template>
          </span>
        </header>
        <div class="query-result__table">
          <table>
            <thead>
              <tr>
                <th
                  v-for="(column, index) in executionResult.columns"
                  :key="`${column}-${index}`"
                  scope="col"
                >
                  {{ column }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, rowIndex) in executionResult.rows"
                :key="rowIndex"
              >
                <td
                  v-for="(value, columnIndex) in row"
                  :key="columnIndex"
                  :class="{ 'query-result__null': value === null }"
                  :title="formatResultCell(value)"
                >
                  {{ formatResultCell(value) }}
                </td>
              </tr>
              <tr v-if="executionResult.rows.length === 0">
                <td
                  class="query-result__empty"
                  :colspan="Math.max(executionResult.columns.length, 1)"
                >
                  {{ t('workspace.noData') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div v-else class="query-result-placeholder">
        {{ t('workspace.runHint') }}
      </div>
    </section>

    <nav
      class="query-workspace-tabs"
      role="tablist"
      :aria-label="t('workspace.tabs')"
    >
      <button
        id="query-workspace-preview-tab"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'preview'"
        aria-controls="query-workspace-preview-panel"
        :class="{ active: activeTab === 'preview' }"
        @click="selectTab('preview')"
      >
        SQL Preview
      </button>

      <div
        v-if="isResultTabOpen"
        class="query-workspace-tab"
        :class="{ active: activeTab === 'result' }"
      >
        <button
          id="query-workspace-result-tab"
          type="button"
          role="tab"
          :disabled="isEditingSql"
          :aria-selected="activeTab === 'result'"
          aria-controls="query-workspace-result-panel"
          @click="selectTab('result')"
        >
          {{ t('workspace.result') }}
          <span
            v-if="executionResult"
            class="query-workspace-tab__count"
          >
            {{ executionResult.rowCount }}
          </span>
        </button>
        <button
          type="button"
          class="query-workspace-tab__close"
          :disabled="isEditingSql"
          :aria-label="t('workspace.closeResult')"
          :title="t('workspace.closeResult')"
          @click.stop="closeResultTab"
        >
          ×
        </button>
      </div>
    </nav>
  </section>
</template>
