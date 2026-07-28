<script setup lang="ts">
import type {
  CanvasPosition,
  FieldReference,
  JoinType,
  QueryModel,
  QueryTable,
  SchemaColumn
} from '@sql-builder/shared'
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch
} from 'vue'

import {
  useApplicationPreferences
} from '../preferences/use-application-preferences'
import {
  readDragPayload,
  writeDragPayload
} from '../query-builder/drag-payload'

const props = defineProps<{
  model: QueryModel
  columnsByTable: Record<string, SchemaColumn[]>
}>()

const emit = defineEmits<{
  dropTable: [tableName: string, position: CanvasPosition]
  setFieldSelected: [
    tableId: string,
    columnName: string,
    selected: boolean
  ]
  createJoin: [source: FieldReference, target: FieldReference]
  updateJoinType: [joinId: string, type: JoinType]
  moveTable: [tableId: string, position: CanvasPosition]
  removeTable: [tableId: string]
  updateAlias: [tableId: string, alias: string]
}>()
const { t } = useApplicationPreferences()

interface NodeDragState {
  tableId: string
  pointerId: number
  startPointerX: number
  startPointerY: number
  scaleX: number
  scaleY: number
  startPosition: CanvasPosition
}

interface JoinGeometry {
  id: string
  type: JoinType
  path: string
  startX: number
  startY: number
  endX: number
  endY: number
  labelX: number
  labelY: number
}

interface JoinTypeEditorState {
  joinId: string
  x: number
  y: number
}

const canvas = ref<HTMLElement | null>(null)
const isDragOver = ref(false)
const nodeDrag = ref<NodeDragState | null>(null)
const joinDragSource = ref<FieldReference | null>(null)
const joinDropTarget = ref<FieldReference | null>(null)
const joinGeometries = ref<JoinGeometry[]>([])
const joinTypeEditor = ref<JoinTypeEditorState | null>(null)
const joinTypeSelect = ref<HTMLSelectElement | null>(null)
const previewPositions = reactive<Record<string, CanvasPosition>>({})
const fieldElements = new Map<string, HTMLElement>()
const tableElements = new Map<string, HTMLElement>()
let geometryFrame: number | null = null
let canvasResizeObserver: ResizeObserver | null = null

function fieldKey(field: FieldReference): string {
  return `${field.tableId}\u0000${field.columnName}`
}

function setFieldElement(
  field: FieldReference,
  element: unknown
): void {
  const key = fieldKey(field)

  if (element instanceof HTMLElement) {
    fieldElements.set(key, element)
  } else {
    fieldElements.delete(key)
  }

  scheduleJoinGeometryUpdate()
}

function setTableElement(tableId: string, element: unknown): void {
  if (element instanceof HTMLElement) {
    tableElements.set(tableId, element)
  } else {
    tableElements.delete(tableId)
  }

  scheduleJoinGeometryUpdate()
}

function fieldCenterAtTableEdge(
  fieldBounds: DOMRect,
  tableBounds: DOMRect
): number {
  const fieldCenter = fieldBounds.top + fieldBounds.height / 2

  return Math.min(
    Math.max(fieldCenter, tableBounds.top),
    tableBounds.bottom
  )
}

function getCanvasScale(
  canvasElement: HTMLElement,
  canvasBounds = canvasElement.getBoundingClientRect()
): { x: number, y: number } {
  return {
    x: canvasElement.offsetWidth > 0
      ? canvasBounds.width / canvasElement.offsetWidth
      : 1,
    y: canvasElement.offsetHeight > 0
      ? canvasBounds.height / canvasElement.offsetHeight
      : 1
  }
}

function updateJoinGeometry(): void {
  geometryFrame = null
  const canvasElement = canvas.value

  if (!canvasElement) {
    joinGeometries.value = []
    return
  }

  const canvasBounds = canvasElement.getBoundingClientRect()

  if (canvasBounds.width === 0 || canvasBounds.height === 0) {
    joinGeometries.value = []
    return
  }

  const canvasScale = getCanvasScale(canvasElement, canvasBounds)

  joinGeometries.value = props.model.joins.flatMap((join) => {
    const leftElement = fieldElements.get(fieldKey(join.left))
    const rightElement = fieldElements.get(fieldKey(join.right))
    const leftTableElement = tableElements.get(join.left.tableId)
    const rightTableElement = tableElements.get(join.right.tableId)

    if (
      !leftElement
      || !rightElement
      || !leftTableElement
      || !rightTableElement
    ) {
      return []
    }

    const leftBounds = leftElement.getBoundingClientRect()
    const rightBounds = rightElement.getBoundingClientRect()
    const leftTableBounds = leftTableElement.getBoundingClientRect()
    const rightTableBounds = rightTableElement.getBoundingClientRect()
    const leftIsVisuallyFirst = (
      leftTableBounds.left + leftTableBounds.width / 2
      <= rightTableBounds.left + rightTableBounds.width / 2
    )
    const startFieldBounds = leftIsVisuallyFirst ? leftBounds : rightBounds
    const endFieldBounds = leftIsVisuallyFirst ? rightBounds : leftBounds
    const startTableBounds = leftIsVisuallyFirst
      ? leftTableBounds
      : rightTableBounds
    const endTableBounds = leftIsVisuallyFirst
      ? rightTableBounds
      : leftTableBounds
    const startX = (
      startTableBounds.right
      - canvasBounds.left
    ) / canvasScale.x
      + canvasElement.scrollLeft
    const endX = (
      endTableBounds.left
      - canvasBounds.left
    ) / canvasScale.x
      + canvasElement.scrollLeft
    const startY = (
      fieldCenterAtTableEdge(startFieldBounds, startTableBounds)
      - canvasBounds.top
    ) / canvasScale.y
      + canvasElement.scrollTop
    const endY = (
      fieldCenterAtTableEdge(endFieldBounds, endTableBounds)
      - canvasBounds.top
    ) / canvasScale.y
      + canvasElement.scrollTop
    const controlOffset = Math.max(
      42,
      Math.abs(endX - startX) * 0.42
    )

    return [{
      id: join.id,
      type: join.type,
      path: `M ${startX} ${startY} C `
        + `${startX + controlOffset} ${startY}, `
        + `${endX - controlOffset} ${endY}, `
        + `${endX} ${endY}`,
      startX,
      startY,
      endX,
      endY,
      labelX: (startX + endX) / 2,
      labelY: (startY + endY) / 2 - 8
    }]
  })
}

function joinArrowPoints(
  geometry: JoinGeometry,
  edge: 'start' | 'end'
): string {
  const pointsRight = edge === 'end'
  const tipX = pointsRight
    ? geometry.endX - 3
    : geometry.startX + 3
  const tipY = pointsRight ? geometry.endY : geometry.startY
  const baseX = tipX + (pointsRight ? -12 : 12)

  return [
    `${tipX},${tipY}`,
    `${baseX},${tipY - 6}`,
    `${baseX},${tipY + 6}`
  ].join(' ')
}

function scheduleJoinGeometryUpdate(): void {
  if (geometryFrame !== null) {
    return
  }

  geometryFrame = window.requestAnimationFrame(updateJoinGeometry)
}

function getTablePosition(table: QueryTable): CanvasPosition {
  return previewPositions[table.id] ?? table.position
}

function clampPosition(position: CanvasPosition): CanvasPosition {
  const canvasElement = canvas.value
  const maximumX = Math.max(
    20,
    (canvasElement?.clientWidth ?? 900) - 270
  )
  const maximumY = Math.max(
    20,
    (canvasElement?.clientHeight ?? 600) - 100
  )

  return {
    x: Math.min(Math.max(Math.round(position.x), 20), maximumX),
    y: Math.min(Math.max(Math.round(position.y), 20), maximumY)
  }
}

function handleDragOver(event: DragEvent): void {
  if (joinDragSource.value) {
    isDragOver.value = false

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none'
    }

    return
  }

  event.preventDefault()
  isDragOver.value = true

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function handleDragEnter(event: DragEvent): void {
  if (joinDragSource.value) {
    isDragOver.value = false
    return
  }

  event.preventDefault()
  isDragOver.value = true
}

function handleDrop(event: DragEvent): void {
  event.preventDefault()
  isDragOver.value = false
  const payload = readDragPayload(event)
  const canvasElement = canvas.value
  const bounds = canvasElement?.getBoundingClientRect()

  if (!payload || payload.kind !== 'table' || !canvasElement || !bounds) {
    return
  }

  const canvasScale = getCanvasScale(canvasElement, bounds)

  emit('dropTable', payload.tableName, clampPosition({
    x: (event.clientX - bounds.left) / canvasScale.x
      + canvasElement.scrollLeft
      - 125,
    y: (event.clientY - bounds.top) / canvasScale.y
      + canvasElement.scrollTop
      - 26
  }))
}

function startNodeMove(event: PointerEvent, table: QueryTable): void {
  if (event.button !== 0 || (event.buttons & 1) === 0) {
    return
  }

  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  const canvasElement = canvas.value
  const canvasScale = canvasElement
    ? getCanvasScale(canvasElement)
    : { x: 1, y: 1 }
  nodeDrag.value = {
    tableId: table.id,
    pointerId: event.pointerId,
    startPointerX: event.clientX,
    startPointerY: event.clientY,
    scaleX: canvasScale.x,
    scaleY: canvasScale.y,
    startPosition: getTablePosition(table)
  }
  handle.setPointerCapture(event.pointerId)
}

function moveNode(event: PointerEvent): void {
  const drag = nodeDrag.value

  if (!drag || drag.pointerId !== event.pointerId) {
    return
  }

  if ((event.buttons & 1) === 0) {
    cancelNodeMove(event)
    return
  }

  previewPositions[drag.tableId] = clampPosition({
    x: drag.startPosition.x
      + (event.clientX - drag.startPointerX) / drag.scaleX,
    y: drag.startPosition.y
      + (event.clientY - drag.startPointerY) / drag.scaleY
  })
  void nextTick(scheduleJoinGeometryUpdate)
}

function releaseNodePointer(event: PointerEvent): void {
  const handle = event.currentTarget as HTMLElement

  if (handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId)
  }
}

function cancelNodeMove(event: PointerEvent): void {
  const drag = nodeDrag.value

  if (!drag || drag.pointerId !== event.pointerId) {
    return
  }

  delete previewPositions[drag.tableId]
  nodeDrag.value = null
  releaseNodePointer(event)
  void nextTick(scheduleJoinGeometryUpdate)
}

function finishNodeMove(event: PointerEvent): void {
  const drag = nodeDrag.value

  if (!drag || drag.pointerId !== event.pointerId) {
    return
  }

  const position = previewPositions[drag.tableId]

  nodeDrag.value = null
  releaseNodePointer(event)

  if (position) {
    emit('moveTable', drag.tableId, {
      x: position.x,
      y: position.y
    })
    delete previewPositions[drag.tableId]
    void nextTick(scheduleJoinGeometryUpdate)
  }
}

function moveNodeWithKeyboard(
  event: KeyboardEvent,
  table: QueryTable
): void {
  const distance = event.shiftKey ? 40 : 16
  const position = getTablePosition(table)
  let nextPosition: CanvasPosition | null = null

  switch (event.key) {
    case 'ArrowLeft':
      nextPosition = { x: position.x - distance, y: position.y }
      break
    case 'ArrowRight':
      nextPosition = { x: position.x + distance, y: position.y }
      break
    case 'ArrowUp':
      nextPosition = { x: position.x, y: position.y - distance }
      break
    case 'ArrowDown':
      nextPosition = { x: position.x, y: position.y + distance }
      break
  }

  if (nextPosition) {
    event.preventDefault()
    emit('moveTable', table.id, clampPosition(nextPosition))
    void nextTick(scheduleJoinGeometryUpdate)
  }
}

function startFieldDrag(
  event: DragEvent,
  table: QueryTable,
  column: SchemaColumn
): void {
  joinDragSource.value = {
    tableId: table.id,
    columnName: column.name
  }
  writeDragPayload(event, {
    kind: 'field',
    tableId: table.id,
    tableName: table.name,
    columnName: column.name
  })
}

function isSameField(
  first: FieldReference | null,
  second: FieldReference
): boolean {
  return first?.tableId === second.tableId
    && first.columnName === second.columnName
}

function isFieldSelected(tableId: string, columnName: string): boolean {
  return props.model.selectedFields.some(
    (field) =>
      field.field.tableId === tableId
      && field.field.columnName === columnName
  )
}

function isValidJoinTarget(target: FieldReference): boolean {
  return Boolean(
    joinDragSource.value
    && joinDragSource.value.tableId !== target.tableId
  )
}

function handleJoinDragOver(
  event: DragEvent,
  target: FieldReference
): void {
  event.stopPropagation()

  if (!isValidJoinTarget(target)) {
    joinDropTarget.value = null

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none'
    }

    return
  }

  event.preventDefault()
  joinDropTarget.value = target

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'link'
  }
}

function handleJoinDragLeave(
  event: DragEvent,
  target: FieldReference
): void {
  const currentTarget = event.currentTarget as HTMLElement
  const relatedTarget = event.relatedTarget

  if (
    relatedTarget instanceof Node
    && currentTarget.contains(relatedTarget)
  ) {
    return
  }

  if (isSameField(joinDropTarget.value, target)) {
    joinDropTarget.value = null
  }
}

function handleJoinDrop(
  event: DragEvent,
  target: FieldReference
): void {
  event.stopPropagation()

  const payload = readDragPayload(event)

  if (
    !payload
    || payload.kind !== 'field'
    || !payload.tableId
    || payload.tableId === target.tableId
  ) {
    finishFieldDrag()
    return
  }

  event.preventDefault()
  emit(
    'createJoin',
    {
      tableId: payload.tableId,
      columnName: payload.columnName
    },
    target
  )
  finishFieldDrag()
}

function finishFieldDrag(): void {
  joinDragSource.value = null
  joinDropTarget.value = null
  isDragOver.value = false
}

function openJoinTypeEditor(geometry: JoinGeometry): void {
  joinTypeEditor.value = {
    joinId: geometry.id,
    x: geometry.labelX,
    y: geometry.labelY
  }

  void nextTick(() => {
    joinTypeSelect.value?.focus()
  })
}

function joinTypeLabel(type: JoinType): string {
  return type === 'JOIN' ? 'JOIN' : `${type} JOIN`
}

function selectJoinType(joinId: string, type: JoinType): void {
  emit('updateJoinType', joinId, type)
  joinTypeEditor.value = null
  void nextTick(scheduleJoinGeometryUpdate)
}

function handleFieldListScroll(): void {
  joinTypeEditor.value = null
  scheduleJoinGeometryUpdate()
}

watch(
  [
    () => props.model.joins.map((join) =>
      [
        join.id,
        join.type,
        join.left.tableId,
        join.left.columnName,
        join.right.tableId,
        join.right.columnName
      ].join('\u0000')
    ).join('\u0001'),
    () => props.model.tables.map((table) =>
      `${table.id}\u0000${table.position.x}\u0000${table.position.y}`
    ).join('\u0001'),
    () => props.columnsByTable
  ],
  () => {
    void nextTick(scheduleJoinGeometryUpdate)
  }
)

onMounted(() => {
  window.addEventListener('resize', scheduleJoinGeometryUpdate)
  canvasResizeObserver = new ResizeObserver(scheduleJoinGeometryUpdate)

  if (canvas.value) {
    canvasResizeObserver.observe(canvas.value)
  }

  scheduleJoinGeometryUpdate()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleJoinGeometryUpdate)
  canvasResizeObserver?.disconnect()
  canvasResizeObserver = null

  if (geometryFrame !== null) {
    window.cancelAnimationFrame(geometryFrame)
  }
})
</script>

<template>
  <section
    ref="canvas"
    class="query-canvas"
    :class="{ 'query-canvas--drag-over': isDragOver }"
    :aria-label="t('canvas.title')"
    @dragenter="handleDragEnter"
    @dragleave.self="isDragOver = false"
    @dragover="handleDragOver"
    @drop="handleDrop"
    @scroll="scheduleJoinGeometryUpdate"
  >
    <svg
      v-if="model.joins.length > 0"
      class="join-layer"
      :aria-label="t('canvas.joinConnections')"
    >
      <g
        v-for="geometry in joinGeometries"
        :key="geometry.id"
      >
        <path class="join-path join-path--halo" :d="geometry.path"></path>
        <path
          class="join-path"
          :d="geometry.path"
        ></path>
        <polygon
          v-if="geometry.type === 'LEFT'"
          class="join-arrow"
          :points="joinArrowPoints(geometry, 'end')"
          aria-hidden="true"
        ></polygon>
        <polygon
          v-else-if="geometry.type === 'RIGHT'"
          class="join-arrow"
          :points="joinArrowPoints(geometry, 'start')"
          aria-hidden="true"
        ></polygon>
        <text
          class="join-label"
          :x="geometry.labelX"
          :y="geometry.labelY"
          role="button"
          tabindex="0"
          text-anchor="middle"
          :aria-label="t('canvas.editJoinType', {
            type: joinTypeLabel(geometry.type)
          })"
          @dblclick.stop="openJoinTypeEditor(geometry)"
          @keydown.enter.prevent="openJoinTypeEditor(geometry)"
        >
          {{ joinTypeLabel(geometry.type) }}
        </text>
      </g>
    </svg>

    <div
      v-if="joinTypeEditor"
      class="join-type-editor"
      :style="{
        left: `${joinTypeEditor.x}px`,
        top: `${joinTypeEditor.y}px`
      }"
      @pointerdown.stop
    >
      <label>
        <span>{{ t('canvas.joinType') }}</span>
        <select
          ref="joinTypeSelect"
          :value="model.joins.find(
            (join) => join.id === joinTypeEditor?.joinId
          )?.type"
          @blur="joinTypeEditor = null"
          @change="selectJoinType(
            joinTypeEditor.joinId,
            ($event.target as HTMLSelectElement).value as JoinType
          )"
        >
          <option value="JOIN">JOIN</option>
          <option value="LEFT">LEFT JOIN →</option>
          <option value="RIGHT">← RIGHT JOIN</option>
        </select>
      </label>
    </div>

    <div
      v-if="model.tables.length === 0"
      class="canvas-empty"
    >
      <span class="canvas-empty__icon" aria-hidden="true">＋</span>
      <h2>{{ t('canvas.emptyTitle') }}</h2>
      <p>{{ t('canvas.emptyHint') }}</p>
    </div>

    <article
      v-for="table in model.tables"
      :key="table.id"
      :ref="(element) => setTableElement(table.id, element)"
      class="table-node"
      :style="{
        transform: `translate(${getTablePosition(table).x}px, ${getTablePosition(table).y}px)`
      }"
    >
      <header
        class="table-node__header"
        :class="{
          'table-node__header--dragging': nodeDrag?.tableId === table.id
        }"
        tabindex="0"
        :aria-label="t('canvas.moveTable', { table: table.name })"
        :title="t('canvas.moveHint')"
        @keydown="moveNodeWithKeyboard($event, table)"
        @lostpointercapture="cancelNodeMove"
        @pointercancel="cancelNodeMove"
        @pointerdown="startNodeMove($event, table)"
        @pointermove="moveNode"
        @pointerup="finishNodeMove"
      >
        <span class="table-node__icon" aria-hidden="true">▦</span>
        <strong>{{ table.name }}</strong>
        <button
          type="button"
          class="icon-button icon-button--danger"
          :aria-label="t('canvas.removeTable', { table: table.name })"
          :title="t('canvas.removeTableHint')"
          @pointerdown.stop
          @click="emit('removeTable', table.id)"
        >
          ×
        </button>
      </header>

      <label class="table-node__alias">
        <span>{{ t('canvas.alias') }}</span>
        <input
          :value="table.alias"
          type="text"
          spellcheck="false"
          @input="emit(
            'updateAlias',
            table.id,
            ($event.target as HTMLInputElement).value
          )"
        >
      </label>

      <div
        v-if="!columnsByTable[table.id]"
        class="table-node__loading"
      >
        {{ t('canvas.loadingFields') }}
      </div>

      <ul
        v-else
        class="table-node__fields"
        @scroll="handleFieldListScroll"
      >
        <li
          v-for="column in columnsByTable[table.id]"
          :key="column.name"
          :ref="(element) => setFieldElement({
            tableId: table.id,
            columnName: column.name
          }, element)"
          :class="{
            'field-selected': isFieldSelected(table.id, column.name),
            'join-drag-source': isSameField(joinDragSource, {
              tableId: table.id,
              columnName: column.name
            }),
            'join-drop-target': isSameField(joinDropTarget, {
              tableId: table.id,
              columnName: column.name
            })
          }"
          draggable="true"
          :title="t('canvas.dragJoin', {
            field: `${table.alias}.${column.name}`
          })"
          @dragend="finishFieldDrag"
          @dragleave="handleJoinDragLeave($event, {
            tableId: table.id,
            columnName: column.name
          })"
          @dragover="handleJoinDragOver($event, {
            tableId: table.id,
            columnName: column.name
          })"
          @dragstart="startFieldDrag($event, table, column)"
          @drop="handleJoinDrop($event, {
            tableId: table.id,
            columnName: column.name
          })"
        >
          <label
            class="node-field-checkbox"
            draggable="false"
            :title="isFieldSelected(table.id, column.name)
              ? t('canvas.unselectField', {
                  field: `${table.alias}.${column.name}`
                })
              : t('canvas.selectField', {
                  field: `${table.alias}.${column.name}`
                })"
            @dragstart.stop.prevent
            @pointerdown.stop
          >
            <input
              type="checkbox"
              :checked="isFieldSelected(table.id, column.name)"
              :aria-label="t('canvas.selectField', {
                field: `${table.alias}.${column.name}`
              })"
              @change="emit(
                'setFieldSelected',
                table.id,
                column.name,
                ($event.target as HTMLInputElement).checked
              )"
            >
          </label>
          <button
            class="node-field-button"
            type="button"
            :aria-pressed="isFieldSelected(table.id, column.name)"
            :title="isFieldSelected(table.id, column.name)
              ? t('canvas.unselectField', {
                  field: `${table.alias}.${column.name}`
                })
              : t('canvas.selectField', {
                  field: `${table.alias}.${column.name}`
                })"
            @click="emit(
              'setFieldSelected',
              table.id,
              column.name,
              !isFieldSelected(table.id, column.name)
            )"
          >
            <span
              class="node-column-key"
              :class="{ 'node-column-key--primary': column.primaryKey }"
              aria-hidden="true"
            >
              {{ column.primaryKey ? '◆' : '·' }}
            </span>
            <span>{{ column.name }}</span>
            <small>{{ column.dataType }}</small>
          </button>
        </li>
      </ul>
    </article>

    <div
      v-if="isDragOver"
      class="canvas-drop-message"
      aria-hidden="true"
    >
      {{ t('canvas.dropTable') }}
    </div>

    <div
      v-if="joinDragSource"
      class="join-drag-message"
      aria-hidden="true"
    >
      {{ t('canvas.dropJoin') }}
    </div>
  </section>
</template>
