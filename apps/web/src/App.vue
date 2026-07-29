<script setup lang="ts">
import type {
  CanvasPosition,
  DatabaseConnectionApplyResponse,
  FieldReference,
  HealthResponse,
  JoinType,
  QueryModel,
  QueryTable,
  SchemaColumn,
  SchemaTable
} from '@sql-builder/shared'
import {
  compileQuery,
  deserializeQueryModel,
  isQueryModel,
  serializeQueryModel
} from '@sql-builder/shared'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'

import EnvironmentSettingsDialog
  from './components/EnvironmentSettingsDialog.vue'
import ExportPngIcon from './components/ExportPngIcon.vue'
import QueryCanvas from './components/QueryCanvas.vue'
import QueryInspector from './components/QueryInspector.vue'
import QueryWorkspacePanel from './components/QueryWorkspacePanel.vue'
import RegionMaximizeIcon from './components/RegionMaximizeIcon.vue'
import SchemaExplorer from './components/SchemaExplorer.vue'
import {
  type ApiProvider,
  useApplicationPreferences
} from './preferences/use-application-preferences'
import { useQueryBuilder } from './query-builder/use-query-builder'
import {
  getColumns,
  getDatabases,
  getHealth
} from './services/schema-api'
import {
  getPersistentItem,
  onElectronCloseRequested,
  removePersistentItem,
  setPersistentItem
} from './services/persistent-storage'
import {
  LaravelAuthenticationRequiredError,
  LaravelSessionAuthenticationRequiredError
} from './services/laravel-auth'

type MaximizedRegion = 'canvas' | 'workspace'

interface QueryCanvasExportApi {
  exportPng: () => Promise<{
    fileName: string
    width: number
    height: number
  }>
}

const health = ref<HealthResponse | null>(null)
const connectionFailed = ref(false)
const authenticationRequired = ref(false)
const databases = ref<string[]>([])
const selectedDatabase = ref('')
const isEditingDatabase = ref(false)
const databaseSelect = ref<HTMLSelectElement | null>(null)
const queryFileInput = ref<HTMLInputElement | null>(null)
const queryCanvas = ref<QueryCanvasExportApi | null>(null)
const schemaExplorerWidth = ref(280)
const isSchemaDrawerCollapsed = ref(false)
const isResizingSchema = ref(false)
const queryInspectorWidth = ref(440)
const isInspectorDrawerCollapsed = ref(false)
const isResizingInspector = ref(false)
const workspacePanelHeight = ref(190)
const isWorkspaceDrawerCollapsed = ref(false)
const isResizingWorkspacePanel = ref(false)
const isSqlEditing = ref(false)
const quoteIdentifiers = ref(false)
const namedParameterValues = ref<Record<string, string>>({})
const uiScale = ref(1)
const maximizedRegion = ref<MaximizedRegion | null>(null)
const isEnvironmentSettingsOpen = ref(false)
const columnsByTable = ref<Record<string, SchemaColumn[]>>({})
const notification = ref('')
let notificationTimer: number | undefined
let workspaceSaveTimer: number | undefined
let workspacePersistenceEnabled = false
let workspaceStateCleared = false
let removeElectronCloseListener: () => void = () => undefined
let schemaResizeStartPosition = 0
let schemaResizeStartedCollapsed = false
let schemaResizeMoved = false
let suppressSchemaDrawerClick = false
let inspectorResizeStartPosition = 0
let inspectorResizeStartedCollapsed = false
let inspectorResizeMoved = false
let suppressInspectorDrawerClick = false
let workspaceResizeStartPosition = 0
let workspaceResizeStartedCollapsed = false
let workspaceResizeMoved = false
let suppressWorkspaceDrawerClick = false
const pendingColumnRequests = new Map<string, Promise<void>>()
const {
  apiProvider,
  t
} = useApplicationPreferences()
const apiProviderLabel = computed(() => {
  if (apiProvider.value === 'fastify') {
    return t('settings.databaseMode')
  }

  if (apiProvider.value === 'session') {
    return t('settings.sessionMode')
  }

  return t('settings.apiMode')
})
const authenticationRequiredLabel = computed(() =>
  apiProvider.value === 'session'
    ? t('app.sessionRequired')
    : t('app.authenticationRequired')
)

function isAuthenticationRequiredError(error: unknown): boolean {
  return error instanceof LaravelAuthenticationRequiredError
    || error instanceof LaravelSessionAuthenticationRequiredError
}

const {
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
} = useQueryBuilder()

const compileResult = computed(() => compileQuery(model.value))
const defaultSchemaExplorerWidth = 280
const minimumSchemaExplorerWidth = 0
const schemaDrawerClickOpenWidth = 220
const maximumSchemaExplorerWidth = 520
const minimumWorkbenchWidth = 900
const splitterWidth = 7
const defaultQueryInspectorWidth = 440
const minimumQueryInspectorWidth = 0
const inspectorDrawerClickOpenWidth = 340
const maximumQueryInspectorWidth = 720
const minimumCanvasWidth = 470
const defaultWorkspacePanelHeight = 190
const minimumWorkspacePanelHeight = 0
const workspaceDrawerClickOpenHeight = 150
const minimumCanvasHeight = 280
const horizontalSplitterHeight = 7
const drawerOpenDragThreshold = 6
const drawerCollapseDragThreshold = 20
const minimumUiScale = 0.7
const maximumUiScale = 1.3
const uiScaleStep = 0.1
const workspaceStorageKey = 'sql-builder.workspace-state.v1'
const uiScalePercent = computed(() => Math.round(uiScale.value * 100))

interface PersistedWorkspaceState {
  version: 1
  databaseName: string
  schemaExplorerWidth: number
  schemaDrawerCollapsed?: boolean
  queryInspectorWidth: number
  inspectorDrawerCollapsed?: boolean
  workspacePanelHeight: number
  workspaceDrawerCollapsed?: boolean
  quoteIdentifiers: boolean
  namedParameterValues?: Record<string, string>
  uiScale: number
  queryModel: QueryModel
  updatedAt: string
}

async function readWorkspaceState(): Promise<PersistedWorkspaceState | null> {
  const serialized = await getPersistentItem(workspaceStorageKey)

  if (!serialized) {
    return null
  }

  try {
    const value = JSON.parse(serialized) as Partial<PersistedWorkspaceState>

    if (
      value.version !== 1
      || typeof value.databaseName !== 'string'
      || !Number.isFinite(value.schemaExplorerWidth)
      || !Number.isFinite(value.queryInspectorWidth)
      || (
        value.schemaDrawerCollapsed !== undefined
        && typeof value.schemaDrawerCollapsed !== 'boolean'
      )
      || (
        value.inspectorDrawerCollapsed !== undefined
        && typeof value.inspectorDrawerCollapsed !== 'boolean'
      )
      || (
        value.workspacePanelHeight !== undefined
        && !Number.isFinite(value.workspacePanelHeight)
      )
      || (
        value.workspaceDrawerCollapsed !== undefined
        && typeof value.workspaceDrawerCollapsed !== 'boolean'
      )
      || (
        value.quoteIdentifiers !== undefined
        && typeof value.quoteIdentifiers !== 'boolean'
      )
      || (
        value.namedParameterValues !== undefined
        && (
          typeof value.namedParameterValues !== 'object'
          || value.namedParameterValues === null
          || Array.isArray(value.namedParameterValues)
          || Object.values(value.namedParameterValues).some(
            (parameterValue) => typeof parameterValue !== 'string'
          )
        )
      )
      || (
        value.uiScale !== undefined
        && !Number.isFinite(value.uiScale)
      )
      || !isQueryModel(value.queryModel)
      || typeof value.updatedAt !== 'string'
    ) {
      return null
    }

    return {
      ...value,
      schemaDrawerCollapsed: value.schemaDrawerCollapsed === true,
      inspectorDrawerCollapsed: value.inspectorDrawerCollapsed === true,
      workspacePanelHeight: Number.isFinite(value.workspacePanelHeight)
        ? Number(value.workspacePanelHeight)
        : defaultWorkspacePanelHeight,
      workspaceDrawerCollapsed: value.workspaceDrawerCollapsed === true,
      quoteIdentifiers: value.quoteIdentifiers === true,
      namedParameterValues: value.namedParameterValues ?? {},
      uiScale: Number.isFinite(value.uiScale)
        ? clampUiScale(Number(value.uiScale))
        : 1
    } as PersistedWorkspaceState
  } catch {
    return null
  }
}

async function persistWorkspaceState(): Promise<void> {
  if (
    !workspacePersistenceEnabled
    || workspaceStateCleared
    || !selectedDatabase.value
  ) {
    return
  }

  const updatedAt = new Date()
  const state: PersistedWorkspaceState = {
    version: 1,
    databaseName: selectedDatabase.value,
    schemaExplorerWidth: schemaExplorerWidth.value,
    schemaDrawerCollapsed: isSchemaDrawerCollapsed.value,
    queryInspectorWidth: queryInspectorWidth.value,
    inspectorDrawerCollapsed: isInspectorDrawerCollapsed.value,
    workspacePanelHeight: workspacePanelHeight.value,
    workspaceDrawerCollapsed: isWorkspaceDrawerCollapsed.value,
    quoteIdentifiers: quoteIdentifiers.value,
    namedParameterValues: namedParameterValues.value,
    uiScale: uiScale.value,
    queryModel: model.value,
    updatedAt: updatedAt.toISOString()
  }

  try {
    await setPersistentItem(workspaceStorageKey, JSON.stringify(state))
    savedAt.value = updatedAt
  } catch {
    showNotification(t('app.noticeAutosaveFailed'))
  }
}

function scheduleWorkspaceSave(): void {
  if (!workspacePersistenceEnabled) {
    return
  }

  workspaceStateCleared = false

  if (workspaceSaveTimer) {
    window.clearTimeout(workspaceSaveTimer)
  }

  workspaceSaveTimer = window.setTimeout(() => {
    workspaceSaveTimer = undefined
    void persistWorkspaceState()
  }, 180)
}

async function flushWorkspaceState(): Promise<void> {
  if (workspaceSaveTimer) {
    window.clearTimeout(workspaceSaveTimer)
    workspaceSaveTimer = undefined
  }

  await persistWorkspaceState()
}

function handlePageHide(): void {
  void persistWorkspaceState()
}

function clampUiScale(scale: number): number {
  return Math.min(
    maximumUiScale,
    Math.max(
      minimumUiScale,
      Math.round(scale / uiScaleStep) * uiScaleStep
    )
  )
}

function getLogicalViewportWidth(): number {
  return window.innerWidth / uiScale.value
}

function getLogicalViewportHeight(): number {
  return window.innerHeight / uiScale.value
}

function setUiScale(scale: number): void {
  uiScale.value = clampUiScale(scale)
  void nextTick(handleWindowResize)
}

function zoomOut(): void {
  setUiScale(uiScale.value - uiScaleStep)
}

function zoomIn(): void {
  setUiScale(uiScale.value + uiScaleStep)
}

function resetUiScale(): void {
  setUiScale(1)
}

function clampSchemaExplorerWidth(width: number): number {
  const viewportMaximum = Math.max(
    minimumSchemaExplorerWidth,
    Math.min(
      maximumSchemaExplorerWidth,
      getLogicalViewportWidth()
        - minimumWorkbenchWidth
        - splitterWidth
    )
  )

  return Math.min(
    Math.max(Math.round(width), minimumSchemaExplorerWidth),
    viewportMaximum
  )
}

function setSchemaExplorerWidth(width: number): void {
  schemaExplorerWidth.value = clampSchemaExplorerWidth(width)
  queryInspectorWidth.value = clampQueryInspectorWidth(
    queryInspectorWidth.value
  )
}

function collapseSchemaDrawer(): void {
  isSchemaDrawerCollapsed.value = true
}

function expandSchemaDrawer(width = schemaExplorerWidth.value): void {
  isSchemaDrawerCollapsed.value = false
  setSchemaExplorerWidth(width)
}

function startSchemaResize(event: PointerEvent): void {
  if (event.button !== 0) {
    return
  }

  isResizingSchema.value = true
  schemaResizeStartPosition = event.clientX
  schemaResizeStartedCollapsed = isSchemaDrawerCollapsed.value
  schemaResizeMoved = false
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  document.body.classList.add('is-resizing-schema')
}

function resizeSchema(event: PointerEvent): void {
  if (!isResizingSchema.value) {
    return
  }

  if (
    Math.abs(event.clientX - schemaResizeStartPosition)
    > drawerOpenDragThreshold
  ) {
    schemaResizeMoved = true
  }

  if (schemaResizeStartedCollapsed) {
    const dragDistance = (
      event.clientX - schemaResizeStartPosition
    ) / uiScale.value

    if (dragDistance <= drawerOpenDragThreshold) {
      collapseSchemaDrawer()
      return
    }

    expandSchemaDrawer(minimumSchemaExplorerWidth + dragDistance)
    return
  }

  const width = event.clientX / uiScale.value

  if (width <= drawerCollapseDragThreshold) {
    collapseSchemaDrawer()
    return
  }

  expandSchemaDrawer(width)
}

function stopSchemaResize(event: PointerEvent): void {
  if (!isResizingSchema.value) {
    return
  }

  isResizingSchema.value = false
  suppressSchemaDrawerClick = schemaResizeMoved
  schemaResizeStartedCollapsed = false
  const handle = event.currentTarget as HTMLElement

  if (handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId)
  }

  document.body.classList.remove('is-resizing-schema')

  if (suppressSchemaDrawerClick) {
    window.setTimeout(() => {
      suppressSchemaDrawerClick = false
    })
  }
}

function openSchemaDrawerFromHandle(): void {
  if (suppressSchemaDrawerClick) {
    suppressSchemaDrawerClick = false
    return
  }

  if (isSchemaDrawerCollapsed.value) {
    expandSchemaDrawer(schemaDrawerClickOpenWidth)
  }
}

function resizeSchemaWithKeyboard(event: KeyboardEvent): void {
  const resizeStep = event.shiftKey ? 32 : 16

  if (isSchemaDrawerCollapsed.value) {
    if (
      event.key === 'ArrowRight'
      || event.key === 'End'
      || event.key === 'Enter'
      || event.key === ' '
    ) {
      event.preventDefault()
      expandSchemaDrawer(schemaDrawerClickOpenWidth)
    }

    return
  }

  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault()
      if (
        schemaExplorerWidth.value - resizeStep
        <= minimumSchemaExplorerWidth
      ) {
        collapseSchemaDrawer()
      } else {
        setSchemaExplorerWidth(schemaExplorerWidth.value - resizeStep)
      }
      break
    case 'ArrowRight':
      event.preventDefault()
      setSchemaExplorerWidth(schemaExplorerWidth.value + resizeStep)
      break
    case 'Home':
      event.preventDefault()
      collapseSchemaDrawer()
      break
    case 'End':
      event.preventDefault()
      setSchemaExplorerWidth(maximumSchemaExplorerWidth)
      break
  }
}

function resetSchemaExplorerWidth(): void {
  expandSchemaDrawer(defaultSchemaExplorerWidth)
}

function clampQueryInspectorWidth(width: number): number {
  const viewportMaximum = Math.max(
    minimumQueryInspectorWidth,
    Math.min(
      maximumQueryInspectorWidth,
      getLogicalViewportWidth()
        - (
          isSchemaDrawerCollapsed.value
            ? 0
            : schemaExplorerWidth.value
        )
        - minimumCanvasWidth
        - splitterWidth * 2
    )
  )

  return Math.min(
    Math.max(Math.round(width), minimumQueryInspectorWidth),
    viewportMaximum
  )
}

function setQueryInspectorWidth(width: number): void {
  queryInspectorWidth.value = clampQueryInspectorWidth(width)
}

function collapseInspectorDrawer(): void {
  isInspectorDrawerCollapsed.value = true
}

function expandInspectorDrawer(width = queryInspectorWidth.value): void {
  isInspectorDrawerCollapsed.value = false
  setQueryInspectorWidth(width)
}

function startInspectorResize(event: PointerEvent): void {
  if (event.button !== 0) {
    return
  }

  isResizingInspector.value = true
  inspectorResizeStartPosition = event.clientX
  inspectorResizeStartedCollapsed = isInspectorDrawerCollapsed.value
  inspectorResizeMoved = false
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  document.body.classList.add('is-resizing-inspector')
}

function resizeInspector(event: PointerEvent): void {
  if (!isResizingInspector.value) {
    return
  }

  if (
    Math.abs(event.clientX - inspectorResizeStartPosition)
    > drawerOpenDragThreshold
  ) {
    inspectorResizeMoved = true
  }

  if (inspectorResizeStartedCollapsed) {
    const dragDistance = (
      inspectorResizeStartPosition - event.clientX
    ) / uiScale.value

    if (dragDistance <= drawerOpenDragThreshold) {
      collapseInspectorDrawer()
      return
    }

    expandInspectorDrawer(minimumQueryInspectorWidth + dragDistance)
    return
  }

  const width = (
    window.innerWidth - event.clientX
  ) / uiScale.value

  if (width <= drawerCollapseDragThreshold) {
    collapseInspectorDrawer()
    return
  }

  expandInspectorDrawer(width)
}

function stopInspectorResize(event: PointerEvent): void {
  if (!isResizingInspector.value) {
    return
  }

  isResizingInspector.value = false
  suppressInspectorDrawerClick = inspectorResizeMoved
  inspectorResizeStartedCollapsed = false
  const handle = event.currentTarget as HTMLElement

  if (handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId)
  }

  document.body.classList.remove('is-resizing-inspector')

  if (suppressInspectorDrawerClick) {
    window.setTimeout(() => {
      suppressInspectorDrawerClick = false
    })
  }
}

function openInspectorDrawerFromHandle(): void {
  if (suppressInspectorDrawerClick) {
    suppressInspectorDrawerClick = false
    return
  }

  if (isInspectorDrawerCollapsed.value) {
    expandInspectorDrawer(inspectorDrawerClickOpenWidth)
  }
}

function resizeInspectorWithKeyboard(event: KeyboardEvent): void {
  const resizeStep = event.shiftKey ? 32 : 16

  if (isInspectorDrawerCollapsed.value) {
    if (
      event.key === 'ArrowLeft'
      || event.key === 'Home'
      || event.key === 'Enter'
      || event.key === ' '
    ) {
      event.preventDefault()
      expandInspectorDrawer(inspectorDrawerClickOpenWidth)
    }

    return
  }

  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault()
      setQueryInspectorWidth(queryInspectorWidth.value + resizeStep)
      break
    case 'ArrowRight':
      event.preventDefault()
      if (
        queryInspectorWidth.value - resizeStep
        <= minimumQueryInspectorWidth
      ) {
        collapseInspectorDrawer()
      } else {
        setQueryInspectorWidth(queryInspectorWidth.value - resizeStep)
      }
      break
    case 'Home':
      event.preventDefault()
      setQueryInspectorWidth(maximumQueryInspectorWidth)
      break
    case 'End':
      event.preventDefault()
      collapseInspectorDrawer()
      break
  }
}

function resetQueryInspectorWidth(): void {
  expandInspectorDrawer(defaultQueryInspectorWidth)
}

function getMaximumWorkspacePanelHeight(): number {
  return Math.max(
    minimumWorkspacePanelHeight,
    getLogicalViewportHeight()
      - 64
      - minimumCanvasHeight
      - horizontalSplitterHeight
  )
}

function clampWorkspacePanelHeight(height: number): number {
  return Math.min(
    Math.max(Math.round(height), minimumWorkspacePanelHeight),
    getMaximumWorkspacePanelHeight()
  )
}

function setWorkspacePanelHeight(height: number): void {
  workspacePanelHeight.value = clampWorkspacePanelHeight(height)
}

function collapseWorkspaceDrawer(): void {
  isWorkspaceDrawerCollapsed.value = true
}

function expandWorkspaceDrawer(
  height = workspacePanelHeight.value
): void {
  isWorkspaceDrawerCollapsed.value = false
  setWorkspacePanelHeight(height)
}

function toggleMaximizedRegion(region: MaximizedRegion): void {
  const willMaximize = maximizedRegion.value !== region
  maximizedRegion.value = willMaximize ? region : null

  if (willMaximize) {
    window.scrollTo(0, 0)
  }

  void nextTick(handleWindowResize)
}

function startWorkspacePanelResize(event: PointerEvent): void {
  if (event.button !== 0) {
    return
  }

  isResizingWorkspacePanel.value = true
  workspaceResizeStartPosition = event.clientY
  workspaceResizeStartedCollapsed = isWorkspaceDrawerCollapsed.value
  workspaceResizeMoved = false
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  document.body.classList.add('is-resizing-workspace-panel')
}

function resizeWorkspacePanel(event: PointerEvent): void {
  if (!isResizingWorkspacePanel.value) {
    return
  }

  if (
    Math.abs(event.clientY - workspaceResizeStartPosition)
    > drawerOpenDragThreshold
  ) {
    workspaceResizeMoved = true
  }

  if (workspaceResizeStartedCollapsed) {
    const dragDistance = (
      workspaceResizeStartPosition - event.clientY
    ) / uiScale.value

    if (dragDistance <= drawerOpenDragThreshold) {
      collapseWorkspaceDrawer()
      return
    }

    expandWorkspaceDrawer(minimumWorkspacePanelHeight + dragDistance)
    return
  }

  const height = (
    window.innerHeight - event.clientY
  ) / uiScale.value

  if (height <= drawerCollapseDragThreshold) {
    collapseWorkspaceDrawer()
    return
  }

  expandWorkspaceDrawer(height)
}

function stopWorkspacePanelResize(event: PointerEvent): void {
  if (!isResizingWorkspacePanel.value) {
    return
  }

  isResizingWorkspacePanel.value = false
  suppressWorkspaceDrawerClick = workspaceResizeMoved
  workspaceResizeStartedCollapsed = false
  const handle = event.currentTarget as HTMLElement

  if (handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId)
  }

  document.body.classList.remove('is-resizing-workspace-panel')

  if (suppressWorkspaceDrawerClick) {
    window.setTimeout(() => {
      suppressWorkspaceDrawerClick = false
    })
  }
}

function openWorkspaceDrawerFromHandle(): void {
  if (suppressWorkspaceDrawerClick) {
    suppressWorkspaceDrawerClick = false
    return
  }

  if (isWorkspaceDrawerCollapsed.value) {
    expandWorkspaceDrawer(workspaceDrawerClickOpenHeight)
  }
}

function resizeWorkspacePanelWithKeyboard(event: KeyboardEvent): void {
  const resizeStep = event.shiftKey ? 32 : 16

  if (isWorkspaceDrawerCollapsed.value) {
    if (
      event.key === 'ArrowUp'
      || event.key === 'End'
      || event.key === 'Enter'
      || event.key === ' '
    ) {
      event.preventDefault()
      expandWorkspaceDrawer(workspaceDrawerClickOpenHeight)
    }

    return
  }

  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault()
      setWorkspacePanelHeight(workspacePanelHeight.value + resizeStep)
      break
    case 'ArrowDown':
      event.preventDefault()
      if (
        workspacePanelHeight.value - resizeStep
        <= minimumWorkspacePanelHeight
      ) {
        collapseWorkspaceDrawer()
      } else {
        setWorkspacePanelHeight(
          workspacePanelHeight.value - resizeStep
        )
      }
      break
    case 'Home':
      event.preventDefault()
      collapseWorkspaceDrawer()
      break
    case 'End':
      event.preventDefault()
      setWorkspacePanelHeight(window.innerHeight)
      break
  }
}

function resetWorkspacePanelHeight(): void {
  expandWorkspaceDrawer(defaultWorkspacePanelHeight)
}

function handleWindowResize(): void {
  setSchemaExplorerWidth(schemaExplorerWidth.value)
  setQueryInspectorWidth(queryInspectorWidth.value)
  setWorkspacePanelHeight(workspacePanelHeight.value)
}

function showNotification(message: string): void {
  notification.value = message

  if (notificationTimer) {
    window.clearTimeout(notificationTimer)
  }

  notificationTimer = window.setTimeout(() => {
    notification.value = ''
  }, 2200)
}

async function exportQueryCanvasPng(): Promise<void> {
  try {
    const result = await queryCanvas.value?.exportPng()

    if (result) {
      showNotification(t('app.noticeCanvasExported', {
        file: result.fileName
      }))
    }
  } catch {
    showNotification(t('app.noticeCanvasExportFailed'))
  }
}

function findQueryTable(
  queryModel: QueryModel,
  tableId: string
): QueryTable | undefined {
  for (const table of queryModel.tables) {
    if (table.id === tableId) {
      return table
    }

    if (table.source?.kind === 'subquery') {
      const nestedTable = findQueryTable(table.source.query, tableId)

      if (nestedTable) {
        return nestedTable
      }
    }
  }

  for (const operation of queryModel.setOperations ?? []) {
    const setTable = findQueryTable(operation.query, tableId)

    if (setTable) {
      return setTable
    }
  }

  return undefined
}

function collectQueryTableIds(
  queryModel: QueryModel,
  tableIds = new Set<string>()
): Set<string> {
  queryModel.tables.forEach((table) => {
    tableIds.add(table.id)

    if (table.source?.kind === 'subquery') {
      collectQueryTableIds(table.source.query, tableIds)
    }
  })

  queryModel.setOperations?.forEach((operation) => {
    collectQueryTableIds(operation.query, tableIds)
  })

  return tableIds
}

async function ensureColumns(table: QueryTable): Promise<void> {
  if (table.source?.kind === 'subquery') {
    columnsByTable.value = {
      ...columnsByTable.value,
      [table.id]: table.source.query.selectedFields.map((field, index) => ({
        name: field.alias.trim()
          || (
            field.expression
              ? `expression_${index + 1}`
              : field.field.columnName
          ),
        ordinalPosition: index + 1,
        dataType: 'derived',
        columnType: 'derived',
        nullable: true,
        primaryKey: false,
        indexed: false,
        extra: '',
        comment: ''
      }))
    }
    return
  }

  if (columnsByTable.value[table.id]) {
    return
  }

  const databaseName = selectedDatabase.value

  if (!databaseName) {
    return
  }

  const requestKey = [
    databaseName,
    table.id,
    table.name
  ].join('\u0000')
  const pendingRequest = pendingColumnRequests.get(requestKey)

  if (pendingRequest) {
    return pendingRequest
  }

  const request = (async () => {
    try {
      const response = await getColumns(table.name, databaseName)
      const currentTable = findQueryTable(model.value, table.id)

      if (
        databaseName !== selectedDatabase.value
        || currentTable?.name !== table.name
      ) {
        return
      }

      columnsByTable.value = {
        ...columnsByTable.value,
        [table.id]: response.columns
      }
    } catch (error) {
      if (
        databaseName !== selectedDatabase.value
        || !findQueryTable(model.value, table.id)
      ) {
        return
      }

      showNotification(
        error instanceof Error
          ? error.message
          : t('app.noticeColumnsFailed')
      )
    } finally {
      pendingColumnRequests.delete(requestKey)
    }
  })()

  pendingColumnRequests.set(requestKey, request)
  return request
}

function handleSqlEditingChange(value: boolean): void {
  isSqlEditing.value = value
}

function handleSqlModelSaved(nextModel: QueryModel): void {
  applyImportedModel(nextModel)
  const nextTableIds = collectQueryTableIds(model.value)

  columnsByTable.value = Object.fromEntries(
    Object.entries(columnsByTable.value).filter(([tableId]) =>
      nextTableIds.has(tableId)
    )
  )
  activeModel.value.tables.forEach((table) => {
    void ensureColumns(table)
  })
  showNotification(t('app.noticeSqlApplied'))
}

function nextTablePosition(): CanvasPosition {
  const index = activeModel.value.tables.length

  return {
    x: 30 + (index % 4) * 220,
    y: 30 + Math.floor(index / 4) * 205
  }
}

async function addTableToCanvas(
  tableName: string,
  position = nextTablePosition()
): Promise<QueryTable> {
  const table = addTable(tableName, position)
  await ensureColumns(table)
  return table
}

function handleSchemaTable(table: SchemaTable): void {
  void addTableToCanvas(table.name)
}

async function handleSchemaField(
  table: SchemaTable,
  column: SchemaColumn
): Promise<void> {
  const queryTable = activeModel.value.tables.find(
    (item) => item.name === table.name
  ) ?? await addTableToCanvas(table.name)

  addSelectedField(queryTable.id, column.name)
}

function handleRemoveTable(tableId: string): void {
  const table = activeModel.value.tables.find(
    (item) => item.id === tableId
  )

  if (!table) {
    return
  }

  const affectedCount = activeModel.value.selectedFields.filter(
    (field) => field.field.tableId === tableId
  ).length + activeModel.value.joins.filter(
    (join) =>
      join.left.tableId === tableId || join.right.tableId === tableId
  ).length

  if (
    affectedCount > 0
    && !window.confirm(
      t('app.confirmRemoveTable', {
        table: table.alias,
        count: affectedCount
      })
    )
  ) {
    return
  }

  removeTable(tableId)
  const nextColumns = { ...columnsByTable.value }
  delete nextColumns[tableId]
  columnsByTable.value = nextColumns
}

function handleCreateJoin(
  source: FieldReference,
  target: FieldReference
): void {
  const sourceIndex = activeModel.value.tables.findIndex(
    (table) => table.id === source.tableId
  )
  const targetIndex = activeModel.value.tables.findIndex(
    (table) => table.id === target.tableId
  )

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return
  }

  const left = sourceIndex < targetIndex ? source : target
  const right = sourceIndex < targetIndex ? target : source
  const duplicate = activeModel.value.joins.some((join) =>
    (
      join.left.tableId === left.tableId
      && join.right.tableId === right.tableId
    )
    || (
      join.left.tableId === right.tableId
      && join.right.tableId === left.tableId
    )
  )

  if (duplicate) {
    showNotification(t('app.noticeJoinFieldsExist'))
    return
  }

  const added = addJoin({
    type: 'JOIN',
    left,
    right
  })

  if (!added) {
    showNotification(t('app.noticeJoinTablesExist'))
    return
  }

  const leftTable = activeModel.value.tables.find(
    (table) => table.id === left.tableId
  )
  const rightTable = activeModel.value.tables.find(
    (table) => table.id === right.tableId
  )

  showNotification(t('app.noticeJoinCreated', {
    left: `${leftTable?.alias}.${left.columnName}`,
    right: `${rightTable?.alias}.${right.columnName}`
  }))
}

function handleUpdateJoinType(joinId: string, type: JoinType): void {
  setJoins(activeModel.value.joins.map((join) =>
    join.id === joinId
      ? { ...join, type }
      : join
  ))
}

function handleNewQuery(): void {
  if (
    model.value.tables.length > 0
    && !window.confirm(t('app.confirmNew'))
  ) {
    return
  }

  reset()
  columnsByTable.value = {}
  maximizedRegion.value = null
  showNotification(t('app.noticeNew'))
}

function createQueryFileName(): string {
  const databaseName = selectedDatabase.value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    || 'query'
  const timestamp = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, 'Z')

  return `fabsql-${databaseName}-${timestamp}.json`
}

function handleDownloadQueryFile(): void {
  try {
    const fileName = createQueryFileName()
    const file = new Blob(
      [serializeQueryModel(model.value)],
      { type: 'application/json;charset=utf-8' }
    )
    const fileUrl = URL.createObjectURL(file)
    const downloadLink = document.createElement('a')

    downloadLink.href = fileUrl
    downloadLink.download = fileName
    document.body.append(downloadLink)
    downloadLink.click()
    downloadLink.remove()
    window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000)
    showNotification(t('app.noticeSaved', { file: fileName }))
  } catch {
    showNotification(t('app.noticeSaveFailed'))
  }
}

function openQueryFilePicker(): void {
  const fileInput = queryFileInput.value

  if (!fileInput) {
    return
  }

  fileInput.value = ''
  fileInput.click()
}

async function handleQueryFileSelected(event: Event): Promise<void> {
  const fileInput = event.currentTarget as HTMLInputElement
  const file = fileInput.files?.[0]

  if (!file) {
    return
  }

  try {
    const nextModel = deserializeQueryModel(await file.text())
    restore(nextModel)
    columnsByTable.value = {}
    model.value.tables.forEach((table) => {
      void ensureColumns(table)
    })
    maximizedRegion.value = null
    showNotification(t('app.noticeLoaded', { file: file.name }))
  } catch {
    showNotification(t('app.noticeLoadFailed'))
  } finally {
    fileInput.value = ''
  }
}

async function handleClearStoredState(): Promise<void> {
  if (
    model.value.tables.length > 0
    && !window.confirm(
      t('app.confirmClear')
    )
  ) {
    return
  }

  workspacePersistenceEnabled = false

  if (workspaceSaveTimer) {
    window.clearTimeout(workspaceSaveTimer)
    workspaceSaveTimer = undefined
  }

  await removePersistentItem(workspaceStorageKey)
  workspaceStateCleared = true
  clearSavedQuery()
  reset()
  columnsByTable.value = {}
  maximizedRegion.value = null
  selectedDatabase.value = health.value?.database.name
    ?? selectedDatabase.value
  setUiScale(1)
  expandSchemaDrawer(defaultSchemaExplorerWidth)
  expandInspectorDrawer(defaultQueryInspectorWidth)
  expandWorkspaceDrawer(defaultWorkspacePanelHeight)
  quoteIdentifiers.value = false
  namedParameterValues.value = {}

  await nextTick()
  workspacePersistenceEnabled = true
  showNotification(t('app.noticeStateCleared'))
}

async function refreshDatabases(): Promise<void> {
  const response = await getDatabases()
  databases.value = response.databases.includes(selectedDatabase.value)
    ? response.databases
    : [selectedDatabase.value, ...response.databases].filter(Boolean)
}

async function beginDatabaseEdit(): Promise<void> {
  if (!health.value || isSqlEditing.value) {
    return
  }

  try {
    await refreshDatabases()
    isEditingDatabase.value = true
    await nextTick()
    databaseSelect.value?.focus()
  } catch (error) {
    showNotification(
      error instanceof Error
        ? error.message
        : t('app.noticeDatabaseListFailed')
    )
  }
}

function handleDatabaseChange(event: Event): void {
  const select = event.currentTarget as HTMLSelectElement
  const nextDatabase = select.value

  if (!nextDatabase || nextDatabase === selectedDatabase.value) {
    isEditingDatabase.value = false
    return
  }

  if (
    model.value.tables.length > 0
    && !window.confirm(
      t('app.confirmDatabase', {
        database: nextDatabase
      })
    )
  ) {
    select.value = selectedDatabase.value
    isEditingDatabase.value = false
    return
  }

  selectedDatabase.value = nextDatabase
  reset()
  savedAt.value = null
  columnsByTable.value = {}
  maximizedRegion.value = null
  isEditingDatabase.value = false
  showNotification(t('app.noticeDatabaseChanged', {
    database: nextDatabase
  }))
}

function handleDatabaseConnectionApplied(
  response: DatabaseConnectionApplyResponse
): void {
  health.value = {
    status: 'ok',
    database: {
      name: response.settings.database,
      version: response.version
    }
  }
  databases.value = response.databases
  selectedDatabase.value = response.settings.database
  connectionFailed.value = false
  isEditingDatabase.value = false
  isEnvironmentSettingsOpen.value = false
  reset()
  savedAt.value = null
  columnsByTable.value = {}
  maximizedRegion.value = null
  showNotification(t('app.noticeConnectionApplied', {
    database: response.settings.database
  }))
}

async function handleApiSourceApplied(
  provider: ApiProvider
): Promise<void> {
  isEnvironmentSettingsOpen.value = false
  connectionFailed.value = false
  authenticationRequired.value = false
  health.value = null
  databases.value = []
  selectedDatabase.value = ''
  isEditingDatabase.value = false
  reset()
  savedAt.value = null
  columnsByTable.value = {}
  maximizedRegion.value = null

  try {
    health.value = await getHealth()
    const databaseResponse = await getDatabases()
    databases.value = databaseResponse.databases
    selectedDatabase.value = health.value.database.name
    showNotification(t('settings.apiApplied', {
      provider: provider === 'fastify'
        ? t('settings.databaseMode')
        : provider === 'session'
          ? t('settings.sessionMode')
          : t('settings.apiMode')
    }))
  } catch (error) {
    const authenticationError = isAuthenticationRequiredError(error)

    if (authenticationError) {
      authenticationRequired.value = true
      isEnvironmentSettingsOpen.value = true
    } else {
      connectionFailed.value = true
    }

    showNotification(
      authenticationError
        ? authenticationRequiredLabel.value
        : error instanceof Error
        ? error.message
        : t('app.connectionFailed')
    )
  }
}

function handleLaravelSignedOut(): void {
  authenticationRequired.value = true
  connectionFailed.value = false
  health.value = null
  databases.value = []
  selectedDatabase.value = ''
  isEditingDatabase.value = false
  reset()
  savedAt.value = null
  columnsByTable.value = {}
  maximizedRegion.value = null
  showNotification(t('settings.laravelSignedOut'))
}

function handleHistoryShortcut(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null

  if (event.key === 'Escape' && maximizedRegion.value) {
    event.preventDefault()
    maximizedRegion.value = null
    return
  }

  if (isSqlEditing.value) {
    return
  }

  if (
    target?.matches('input, textarea, select, [contenteditable="true"]')
    || !(event.metaKey || event.ctrlKey)
  ) {
    return
  }

  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomIn()
  } else if (event.key === '-') {
    event.preventDefault()
    zoomOut()
  } else if (event.key === '0') {
    event.preventDefault()
    resetUiScale()
  } else if (event.key.toLocaleLowerCase('en-US') === 'z') {
    event.preventDefault()
    event.shiftKey ? redo() : undo()
  } else if (event.key.toLocaleLowerCase('en-US') === 'y') {
    event.preventDefault()
    redo()
  }
}

watch(
  () => activeModel.value.tables.map((table) => table.id).join(','),
  () => {
    activeModel.value.tables.forEach((table) => {
      void ensureColumns(table)
    })
  },
  { immediate: true }
)

watch(
  [
    model,
    selectedDatabase,
    schemaExplorerWidth,
    isSchemaDrawerCollapsed,
    queryInspectorWidth,
    isInspectorDrawerCollapsed,
    workspacePanelHeight,
    isWorkspaceDrawerCollapsed,
    quoteIdentifiers,
    namedParameterValues,
    uiScale
  ],
  scheduleWorkspaceSave
)

onMounted(async () => {
  window.addEventListener('resize', handleWindowResize)
  window.addEventListener('keydown', handleHistoryShortcut)
  window.addEventListener('pagehide', handlePageHide)
  removeElectronCloseListener = onElectronCloseRequested(
    flushWorkspaceState
  )
  let workspaceState: PersistedWorkspaceState | null = null

  try {
    workspaceState = await readWorkspaceState()
  } catch {
    showNotification(t('app.noticeAutosaveFailed'))
  }

  if (workspaceState) {
    uiScale.value = workspaceState.uiScale
    isSchemaDrawerCollapsed.value
      = workspaceState.schemaDrawerCollapsed === true
    isInspectorDrawerCollapsed.value
      = workspaceState.inspectorDrawerCollapsed === true
    isWorkspaceDrawerCollapsed.value
      = workspaceState.workspaceDrawerCollapsed === true
    setSchemaExplorerWidth(workspaceState.schemaExplorerWidth)
    setQueryInspectorWidth(workspaceState.queryInspectorWidth)
    setWorkspacePanelHeight(workspaceState.workspacePanelHeight)
    quoteIdentifiers.value = workspaceState.quoteIdentifiers
    namedParameterValues.value = workspaceState.namedParameterValues ?? {}
  } else {
    setWorkspacePanelHeight(
      Math.round((getLogicalViewportHeight() - 64) * 0.25)
    )
  }

  try {
    health.value = await getHealth()
    const databaseResponse = await getDatabases()
    databases.value = databaseResponse.databases
    const canRestoreWorkspace = Boolean(
      workspaceState
      && databases.value.includes(workspaceState.databaseName)
    )

    selectedDatabase.value = canRestoreWorkspace
      ? workspaceState!.databaseName
      : health.value.database.name

    if (canRestoreWorkspace) {
      columnsByTable.value = {}
      restore(workspaceState!.queryModel)
      const restoredDate = new Date(workspaceState!.updatedAt)
      savedAt.value = Number.isNaN(restoredDate.getTime())
        ? null
        : restoredDate
    }
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      authenticationRequired.value = true
      isEnvironmentSettingsOpen.value = true
      showNotification(authenticationRequiredLabel.value)
    } else {
      connectionFailed.value = true
    }
  } finally {
    workspacePersistenceEnabled = true
    scheduleWorkspaceSave()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('keydown', handleHistoryShortcut)
  window.removeEventListener('pagehide', handlePageHide)
  removeElectronCloseListener()
  document.body.classList.remove('is-resizing-schema')
  document.body.classList.remove('is-resizing-inspector')
  document.body.classList.remove('is-resizing-workspace-panel')

  if (notificationTimer) {
    window.clearTimeout(notificationTimer)
  }

  if (workspaceSaveTimer) {
    window.clearTimeout(workspaceSaveTimer)
    workspaceSaveTimer = undefined
    void persistWorkspaceState()
  }
})
</script>

<template>
  <div
    class="application-shell"
    :style="{
      width: `${100 / uiScale}%`,
      height: `${100 / uiScale}vh`,
      transform: `scale(${uiScale})`
    }"
  >
    <header class="application-header">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true">FS</span>
        <div>
          <h1>FabSQL Builder</h1>
          <p>{{ t('app.subtitle') }}</p>
        </div>
      </div>

      <div class="application-actions">
        <button
          type="button"
          :disabled="isSqlEditing"
          @click="handleNewQuery"
        >
          {{ t('app.new') }}
        </button>
        <button
          type="button"
          :disabled="isSqlEditing || !canUndo"
          @click="undo"
        >
          {{ t('app.undo') }}
        </button>
        <button
          type="button"
          :disabled="isSqlEditing || !canRedo"
          @click="redo"
        >
          {{ t('app.redo') }}
        </button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button
          type="button"
          :disabled="isSqlEditing"
          @click="handleDownloadQueryFile"
        >
          {{ t('app.save') }}
        </button>
        <button
          type="button"
          :disabled="isSqlEditing"
          @click="openQueryFilePicker"
        >
          {{ t('app.load') }}
        </button>
        <input
          ref="queryFileInput"
          type="file"
          accept=".json,application/json"
          hidden
          @change="handleQueryFileSelected"
        >
        <button
          class="clear-state-button"
          type="button"
          :disabled="isSqlEditing"
          @click="handleClearStoredState"
        >
          {{ t('app.clearState') }}
        </button>
        <span
          v-if="savedAt"
          class="saved-time"
          :title="savedAt.toLocaleString()"
        >
          {{ t('app.autosaved') }}
        </span>
      </div>

      <div class="connection-status">
        <span
          class="connection-status__dot"
          :class="{ 'connection-status__dot--error': connectionFailed }"
          aria-hidden="true"
        ></span>
        <template v-if="health && !authenticationRequired">
          <span>
            {{ apiProviderLabel }}
            · MariaDB {{ health.database.version }} ·
          </span>
          <select
            v-if="isEditingDatabase"
            ref="databaseSelect"
            class="database-selector"
            :aria-label="t('app.selectDatabase')"
            :value="selectedDatabase"
            @blur="isEditingDatabase = false"
            @change="handleDatabaseChange"
            @keydown.esc.prevent="isEditingDatabase = false"
          >
            <option
              v-for="database in databases"
              :key="database"
              :value="database"
            >
              {{ database }}
            </option>
          </select>
          <button
            v-else
            class="database-name"
            type="button"
            :disabled="isSqlEditing"
            :title="t('app.editDatabase')"
            :aria-label="t('app.editDatabase')"
            @dblclick="beginDatabaseEdit"
            @keydown.enter.prevent="beginDatabaseEdit"
          >
            {{ selectedDatabase }}
          </button>
        </template>
        <span v-else-if="authenticationRequired">
          {{ authenticationRequiredLabel }}
        </span>
        <span v-else-if="connectionFailed">
          {{ t('app.connectionFailed') }}
        </span>
        <span v-else>
          {{ t('app.connecting') }}
        </span>
      </div>
      <button
        class="environment-settings-button"
        type="button"
        :disabled="isSqlEditing"
        :aria-label="t('app.environmentSettings')"
        :title="t('app.environmentSettings')"
        @click="isEnvironmentSettingsOpen = true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 8.75A3.25 3.25 0 1 0 12 15.25
              3.25 3.25 0 0 0 12 8.75Z"
          />
          <path
            d="M19.15 13.3a7.78 7.78 0 0 0 0-2.6l2-1.55-2-3.46-2.47
              1a7.42 7.42 0 0 0-2.25-1.3L14.08 2h-4.16l-.35
              3.39a7.42 7.42 0 0 0-2.25 1.3l-2.47-1-2 3.46
              2 1.55a7.78 7.78 0 0 0 0 2.6l-2 1.55 2 3.46
              2.47-1a7.42 7.42 0 0 0 2.25 1.3l.35 3.39h4.16
              l.35-3.39a7.42 7.42 0 0 0 2.25-1.3l2.47 1 2-3.46-2-1.55Z"
          />
        </svg>
      </button>
    </header>

    <main
      class="workspace"
      :class="{
        'workspace--schema-drawer-collapsed':
          isSchemaDrawerCollapsed
      }"
      :style="{
        '--schema-explorer-width': `${schemaExplorerWidth}px`
      }"
    >
      <aside
        class="workspace__sidebar"
        :class="{ 'query-model-locked': isSqlEditing }"
        :aria-hidden="isSchemaDrawerCollapsed"
        :aria-disabled="isSqlEditing"
        :inert="isSchemaDrawerCollapsed || isSqlEditing"
      >
        <SchemaExplorer
          :database-name="selectedDatabase"
          @add-table="handleSchemaTable"
          @add-field="handleSchemaField"
        />
      </aside>

      <div
        class="workspace__splitter"
        :class="{
          'workspace__splitter--active': isResizingSchema,
          'drawer-handle': isSchemaDrawerCollapsed,
          'drawer-handle--left': isSchemaDrawerCollapsed
        }"
        role="separator"
        :aria-label="isSchemaDrawerCollapsed
          ? t('app.openSchemaDrawer')
          : t('app.resizeSchema')"
        aria-orientation="vertical"
        :aria-valuemin="0"
        :aria-valuemax="maximumSchemaExplorerWidth"
        :aria-valuenow="isSchemaDrawerCollapsed
          ? 0
          : schemaExplorerWidth"
        tabindex="0"
        :title="isSchemaDrawerCollapsed
          ? t('app.openSchemaDrawerHint')
          : t('app.resizeWidthHint')"
        @click="openSchemaDrawerFromHandle"
        @dblclick="resetSchemaExplorerWidth"
        @keydown="resizeSchemaWithKeyboard"
        @lostpointercapture="stopSchemaResize"
        @pointercancel="stopSchemaResize"
        @pointerdown="startSchemaResize"
        @pointermove="resizeSchema"
        @pointerup="stopSchemaResize"
      >
        <span aria-hidden="true"></span>
      </div>

      <section
        class="workbench"
        :class="{
          'workbench--inspector-drawer-collapsed':
            isInspectorDrawerCollapsed
        }"
        :style="{
          '--query-inspector-width': `${queryInspectorWidth}px`
        }"
      >
        <div
          class="workbench__center"
          :class="{
            'workbench__center--workspace-drawer-collapsed':
              isWorkspaceDrawerCollapsed
          }"
          :style="{
            '--workspace-panel-height': `${workspacePanelHeight}px`
          }"
        >
          <div
            class="workbench__canvas"
            :class="{
              'workspace-region--maximized':
                maximizedRegion === 'canvas',
              'query-model-locked': isSqlEditing
            }"
            :aria-disabled="isSqlEditing"
          >
            <nav
              v-if="queryBreadcrumbs.length > 0"
              class="query-breadcrumb"
              :aria-label="t('canvas.queryBreadcrumb')"
            >
              <button
                type="button"
                @click="navigateToQueryDepth(0)"
              >
                {{ t('canvas.mainQuery') }}
              </button>
              <template
                v-for="(breadcrumb, index) in queryBreadcrumbs"
                :key="breadcrumb.tableId"
              >
                <span aria-hidden="true">›</span>
                <button
                  type="button"
                  :disabled="index === queryBreadcrumbs.length - 1"
                  @click="navigateToQueryDepth(index + 1)"
                >
                  {{ breadcrumb.label }}
                </button>
              </template>
            </nav>
            <nav
              v-if="activeModel.setOperations?.length"
              class="set-operation-navigation"
              :class="{
                'set-operation-navigation--with-breadcrumb':
                  queryBreadcrumbs.length > 0
              }"
              :aria-label="t('canvas.setOperationNavigation')"
            >
              <button type="button" disabled>
                SELECT 1
              </button>
              <button
                v-for="(operation, index) in activeModel.setOperations"
                :key="operation.id"
                type="button"
                @click="enterSetOperation(operation.id)"
              >
                {{ operation.operator }} {{ index + 2 }}
              </button>
            </nav>
            <button
              class="region-export-button"
              type="button"
              :disabled="isSqlEditing || activeModel.tables.length === 0"
              :aria-label="t('app.exportCanvasPng')"
              :title="t('app.exportCanvasPng')"
              @click="exportQueryCanvasPng"
            >
              <ExportPngIcon />
            </button>
            <button
              class="region-maximize-button"
              type="button"
              :disabled="isSqlEditing"
              :aria-label="maximizedRegion === 'canvas'
                ? t('app.restoreCanvas')
                : t('app.maximizeCanvas')"
              :title="maximizedRegion === 'canvas'
                ? t('app.restoreCanvasEsc')
                : t('app.maximizeCanvas')"
              @click="toggleMaximizedRegion('canvas')"
            >
              <RegionMaximizeIcon
                :maximized="maximizedRegion === 'canvas'"
              />
            </button>
            <QueryCanvas
              ref="queryCanvas"
              :key="activeQueryPath.join('/') || 'main-query'"
              :model="activeModel"
              :columns-by-table="columnsByTable"
              :inert="isSqlEditing"
              @drop-table="addTableToCanvas"
              @set-field-selected="setFieldSelected"
              @create-join="handleCreateJoin"
              @update-join-type="handleUpdateJoinType"
              @move-table="moveTable"
              @remove-table="handleRemoveTable"
              @update-alias="updateTableAlias"
              @open-subquery="enterSubquery"
            />
            <div
              v-if="isSqlEditing"
              class="query-model-lock-message"
              role="status"
            >
              {{ t('workspace.sqlEditingHint') }}
            </div>
          </div>

          <div
            class="workbench__horizontal-splitter"
            :class="{
              'workbench__horizontal-splitter--active':
                isResizingWorkspacePanel,
              'drawer-handle': isWorkspaceDrawerCollapsed,
              'drawer-handle--bottom': isWorkspaceDrawerCollapsed
            }"
            role="separator"
            :aria-label="isWorkspaceDrawerCollapsed
              ? t('app.openWorkspaceDrawer')
              : t('app.resizeWorkspace')"
            aria-orientation="horizontal"
            :aria-valuemin="0"
            :aria-valuemax="getMaximumWorkspacePanelHeight()"
            :aria-valuenow="isWorkspaceDrawerCollapsed
              ? 0
              : workspacePanelHeight"
            tabindex="0"
            :title="isWorkspaceDrawerCollapsed
              ? t('app.openWorkspaceDrawerHint')
              : t('app.resizeHeightHint')"
            @click="openWorkspaceDrawerFromHandle"
            @dblclick="resetWorkspacePanelHeight"
            @keydown="resizeWorkspacePanelWithKeyboard"
            @lostpointercapture="stopWorkspacePanelResize"
            @pointercancel="stopWorkspacePanelResize"
            @pointerdown="startWorkspacePanelResize"
            @pointermove="resizeWorkspacePanel"
            @pointerup="stopWorkspacePanelResize"
          >
            <span aria-hidden="true"></span>
          </div>

          <QueryWorkspacePanel
            :database-name="selectedDatabase"
            :model="model"
            :compile-result="compileResult"
            :quote-identifiers="quoteIdentifiers"
            :named-parameter-values="namedParameterValues"
            :maximized="maximizedRegion === 'workspace'"
            :aria-hidden="isWorkspaceDrawerCollapsed"
            :inert="isWorkspaceDrawerCollapsed"
            @toggle-maximize="toggleMaximizedRegion('workspace')"
            @editing-change="handleSqlEditingChange"
            @save-model="handleSqlModelSaved"
            @update:quote-identifiers="quoteIdentifiers = $event"
            @update:named-parameter-values="
              namedParameterValues = $event
            "
          />
        </div>

        <div
          class="workbench__splitter"
          :class="{
            'workbench__splitter--active': isResizingInspector,
            'drawer-handle': isInspectorDrawerCollapsed,
            'drawer-handle--right': isInspectorDrawerCollapsed
          }"
          role="separator"
          :aria-label="isInspectorDrawerCollapsed
            ? t('app.openInspectorDrawer')
            : t('app.resizeInspector')"
          aria-orientation="vertical"
          :aria-valuemin="0"
          :aria-valuemax="maximumQueryInspectorWidth"
          :aria-valuenow="isInspectorDrawerCollapsed
            ? 0
            : queryInspectorWidth"
          tabindex="0"
          :title="isInspectorDrawerCollapsed
            ? t('app.openInspectorDrawerHint')
            : t('app.resizeWidthHint')"
          @click="openInspectorDrawerFromHandle"
          @dblclick="resetQueryInspectorWidth"
          @keydown="resizeInspectorWithKeyboard"
          @lostpointercapture="stopInspectorResize"
          @pointercancel="stopInspectorResize"
          @pointerdown="startInspectorResize"
          @pointermove="resizeInspector"
          @pointerup="stopInspectorResize"
        >
          <span aria-hidden="true"></span>
        </div>

        <QueryInspector
          :class="{ 'query-model-locked': isSqlEditing }"
          :model="activeModel"
          :columns-by-table="columnsByTable"
          :aria-hidden="isInspectorDrawerCollapsed"
          :aria-disabled="isSqlEditing"
          :inert="isInspectorDrawerCollapsed || isSqlEditing"
          @update-field="updateSelectedField"
          @reorder-field="reorderSelectedField"
          @set-distinct="setDistinct"
          @add-join="addJoin"
          @set-joins="setJoins"
          @set-filters="setFilters"
          @add-grouping="addGrouping"
          @set-grouping="setGrouping"
          @add-sorting="addSorting"
          @set-sorting="setSorting"
          @set-pagination="setPagination"
        />
      </section>
    </main>

    <EnvironmentSettingsDialog
      :open="isEnvironmentSettingsOpen"
      @applied="handleDatabaseConnectionApplied"
      @api-source-applied="handleApiSourceApplied"
      @close="isEnvironmentSettingsOpen = false"
      @laravel-signed-out="handleLaravelSignedOut"
    />

    <div
      v-if="notification"
      class="notification"
      role="status"
    >
      {{ notification }}
    </div>
  </div>

  <div
    class="zoom-toolbar"
    role="toolbar"
    :aria-label="t('app.zoomToolbar')"
  >
    <button
      type="button"
      :disabled="uiScale <= minimumUiScale"
      :aria-label="t('app.zoomOut')"
      :title="`${t('app.zoomOut')}（Ctrl/Cmd -）`"
      @click="zoomOut"
    >
      −
    </button>
    <button
      class="zoom-toolbar__value"
      type="button"
      :aria-label="t('app.zoomReset')"
      :title="`${t('app.zoomReset')}（Ctrl/Cmd 0）`"
      @click="resetUiScale"
    >
      {{ uiScalePercent }}%
    </button>
    <button
      type="button"
      :disabled="uiScale >= maximumUiScale"
      :aria-label="t('app.zoomIn')"
      :title="`${t('app.zoomIn')}（Ctrl/Cmd +）`"
      @click="zoomIn"
    >
      ＋
    </button>
  </div>
</template>
