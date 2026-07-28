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
  maximized: boolean
}>()

const emit = defineEmits<{
  'update:quoteIdentifiers': [value: boolean]
  toggleMaximize: []
}>()
const { t } = useApplicationPreferences()

const activeTab = ref<WorkspaceTab>('preview')
const isResultTabOpen = ref(true)
const copied = ref(false)
const isRunning = ref(false)
const executionError = ref('')
const executionResult = ref<ExecuteQueryResponse | null>(null)
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

const displaySql = computed(() => props.quoteIdentifiers
  ? props.compileResult.sql
  : removeIdentifierQuotes(props.compileResult.sql)
)

const highlightedSql = computed(() =>
  highlightSql(displaySql.value)
)

watch(
  () => [props.databaseName, props.model],
  () => {
    executionSequence += 1
    isRunning.value = false
    executionError.value = ''
    executionResult.value = null
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
  if (!displaySql.value) {
    return
  }

  try {
    await navigator.clipboard.writeText(displaySql.value)
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
    const result = await executeQuery(props.databaseName, props.model)

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

onBeforeUnmount(() => {
  executionSequence += 1

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
            type="checkbox"
            @change="emit(
              'update:quoteIdentifiers',
              ($event.target as HTMLInputElement).checked
            )"
          >
          {{ t('workspace.quoteIdentifiers') }}
        </label>
        <span
          class="compile-status"
          :class="`compile-status--${compileResult.status}`"
        >
          {{ statusLabel }}
        </span>
        <button
          class="run-query-button"
          type="button"
          :disabled="compileResult.status !== 'valid' || isRunning"
          @click="runPreviewQuery"
        >
          {{ isRunning ? t('workspace.running') : t('workspace.run') }}
        </button>
        <button
          type="button"
          :disabled="!compileResult.sql"
          @click="copySql"
        >
          {{ copied ? t('workspace.copied') : t('workspace.copy') }}
        </button>
      </header>

      <pre v-if="displaySql"><code><span
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

      <details v-if="compileResult.parameters.length > 0">
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
