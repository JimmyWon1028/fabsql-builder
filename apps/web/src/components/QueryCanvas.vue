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
  computed,
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
  setTableCollapsed: [tableId: string, collapsed: boolean]
  removeTable: [tableId: string]
  updateAlias: [tableId: string, alias: string]
  openSubquery: [tableId: string]
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

interface CanvasPanState {
  pointerId: number
  startPointerX: number
  startPointerY: number
  scaleX: number
  scaleY: number
  startOffset: CanvasPosition
}

interface JoinGeometry {
  id: string
  type: JoinType
  conditionCount: number
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

interface LogicalRect {
  x: number
  y: number
  width: number
  height: number
}

interface CanvasExportResult {
  fileName: string
  width: number
  height: number
}

const canvas = ref<HTMLElement | null>(null)
const isDragOver = ref(false)
const nodeDrag = ref<NodeDragState | null>(null)
const canvasPan = ref<CanvasPanState | null>(null)
const panOffset = reactive<CanvasPosition>({ x: 0, y: 0 })
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

const displayColumnsByTable = computed<
  Record<string, SchemaColumn[] | undefined>
>(() => {
  const joinedColumnNames = new Map<string, string[]>()

  props.model.joins.forEach((join) => {
    const fields = [join.left, join.right]

    fields.forEach((field) => {
      const names = joinedColumnNames.get(field.tableId) ?? []

      if (
        !names.some((name) =>
          name.toLocaleLowerCase() === field.columnName.toLocaleLowerCase()
        )
      ) {
        names.push(field.columnName)
      }

      joinedColumnNames.set(field.tableId, names)
    })
  })

  return Object.fromEntries(props.model.tables.map((table) => {
    const columns = props.columnsByTable[table.id]
    const referencedNames = joinedColumnNames.get(table.id) ?? []

    if (!columns && referencedNames.length === 0) {
      return [table.id, undefined]
    }

    const existingNames = new Set(
      (columns ?? []).map((column) => column.name.toLocaleLowerCase())
    )
    const referencedColumns = referencedNames
      .filter((name) => !existingNames.has(name.toLocaleLowerCase()))
      .map((name, index): SchemaColumn => ({
        name,
        ordinalPosition: -(referencedNames.length - index),
        dataType: 'SQL',
        columnType: 'SQL reference',
        nullable: true,
        primaryKey: false,
        indexed: false,
        extra: '',
        comment: 'Referenced by SQL JOIN'
      }))

    return [table.id, [...referencedColumns, ...(columns ?? [])]]
  }))
})

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
  fieldBounds: DOMRect | undefined,
  tableBounds: DOMRect
): number {
  if (!fieldBounds) {
    return tableBounds.top + tableBounds.height / 2
  }

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
      !leftTableElement
      || !rightTableElement
    ) {
      return []
    }

    const leftBounds = leftElement?.getBoundingClientRect()
    const rightBounds = rightElement?.getBoundingClientRect()
    const leftTableBounds = leftTableElement.getBoundingClientRect()
    const rightTableBounds = rightTableElement.getBoundingClientRect()

    if (join.left.tableId === join.right.tableId) {
      const startX = (
        leftTableBounds.right
        - canvasBounds.left
      ) / canvasScale.x
        + canvasElement.scrollLeft
      const centerY = (
        fieldCenterAtTableEdge(leftBounds, leftTableBounds)
        - canvasBounds.top
      ) / canvasScale.y
        + canvasElement.scrollTop
      const endY = centerY + 18
      const loopOffset = 58

      return [{
        id: join.id,
        type: join.type,
        conditionCount: join.conditions?.children.length ?? 0,
        path: `M ${startX} ${centerY} C `
          + `${startX + loopOffset} ${centerY - 28}, `
          + `${startX + loopOffset} ${endY + 28}, `
          + `${startX} ${endY}`,
        startX,
        startY: centerY,
        endX: startX,
        endY,
        labelX: startX + loopOffset,
        labelY: centerY + 4
      }]
    }

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
      conditionCount: join.conditions?.children.length ?? 0,
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

function getDisplayedTablePosition(table: QueryTable): CanvasPosition {
  const position = getTablePosition(table)

  return {
    x: position.x + panOffset.x,
    y: position.y + panOffset.y
  }
}

function getTableTransform(table: QueryTable): string {
  const position = getDisplayedTablePosition(table)

  return `translate(${position.x}px, ${position.y}px)`
}

function openSubquery(table: QueryTable): void {
  if (table.source?.kind === 'subquery') {
    emit('openSubquery', table.id)
  }
}

function clampPosition(position: CanvasPosition): CanvasPosition {
  const canvasElement = canvas.value
  const minimumX = 20 - panOffset.x
  const minimumY = 20 - panOffset.y
  const maximumX = Math.max(
    minimumX,
    (canvasElement?.clientWidth ?? 900) - 220 - panOffset.x
  )
  const maximumY = Math.max(
    minimumY,
    (canvasElement?.clientHeight ?? 600) - 100 - panOffset.y
  )

  return {
    x: Math.min(Math.max(Math.round(position.x), minimumX), maximumX),
    y: Math.min(Math.max(Math.round(position.y), minimumY), maximumY)
  }
}

function isCanvasPanTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }

  return !target.closest(
    '.table-node, .join-label, .join-type-editor, '
      + 'button, input, select, textarea, label'
  )
}

function startCanvasPan(event: PointerEvent): void {
  const canvasElement = canvas.value

  if (
    event.button !== 0
    || (event.buttons & 1) === 0
    || !canvasElement
    || !isCanvasPanTarget(event.target)
    || nodeDrag.value
    || joinDragSource.value
  ) {
    return
  }

  event.preventDefault()
  joinTypeEditor.value = null
  const canvasScale = getCanvasScale(canvasElement)
  canvasPan.value = {
    pointerId: event.pointerId,
    startPointerX: event.clientX,
    startPointerY: event.clientY,
    scaleX: canvasScale.x,
    scaleY: canvasScale.y,
    startOffset: {
      x: panOffset.x,
      y: panOffset.y
    }
  }
  canvasElement.setPointerCapture(event.pointerId)
}

function moveCanvasPan(event: PointerEvent): void {
  const pan = canvasPan.value

  if (!pan || pan.pointerId !== event.pointerId) {
    return
  }

  if ((event.buttons & 1) === 0) {
    finishCanvasPan(event)
    return
  }

  panOffset.x = pan.startOffset.x
    + (event.clientX - pan.startPointerX) / pan.scaleX
  panOffset.y = pan.startOffset.y
    + (event.clientY - pan.startPointerY) / pan.scaleY
  scheduleJoinGeometryUpdate()
}

function releaseCanvasPointer(event: PointerEvent): void {
  const canvasElement = canvas.value

  if (canvasElement?.hasPointerCapture(event.pointerId)) {
    canvasElement.releasePointerCapture(event.pointerId)
  }
}

function finishCanvasPan(event: PointerEvent): void {
  const pan = canvasPan.value

  if (!pan || pan.pointerId !== event.pointerId) {
    return
  }

  canvasPan.value = null
  releaseCanvasPointer(event)
  scheduleJoinGeometryUpdate()
}

function handleCanvasLostPointerCapture(event: PointerEvent): void {
  if (canvasPan.value?.pointerId === event.pointerId) {
    canvasPan.value = null
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
      - panOffset.x
      - 125,
    y: (event.clientY - bounds.top) / canvasScale.y
      + canvasElement.scrollTop
      - panOffset.y
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
      && !field.expression
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

function joinGeometryLabel(geometry: JoinGeometry): string {
  const label = joinTypeLabel(geometry.type)
  return geometry.conditionCount > 0
    ? `${label} +${geometry.conditionCount}`
    : label
}

function elementLogicalRect(
  element: HTMLElement,
  canvasElement: HTMLElement,
  canvasBounds: DOMRect,
  canvasScale: { x: number, y: number }
): LogicalRect {
  const bounds = element.getBoundingClientRect()

  return {
    x: (bounds.left - canvasBounds.left) / canvasScale.x
      + canvasElement.scrollLeft,
    y: (bounds.top - canvasBounds.top) / canvasScale.y
      + canvasElement.scrollTop,
    width: bounds.width / canvasScale.x,
    height: bounds.height / canvasScale.y
  }
}

function roundedRectanglePath(
  context: CanvasRenderingContext2D,
  rectangle: LogicalRect,
  radius: number
): void {
  const cornerRadius = Math.min(
    radius,
    rectangle.width / 2,
    rectangle.height / 2
  )

  context.beginPath()
  context.moveTo(rectangle.x + cornerRadius, rectangle.y)
  context.lineTo(
    rectangle.x + rectangle.width - cornerRadius,
    rectangle.y
  )
  context.quadraticCurveTo(
    rectangle.x + rectangle.width,
    rectangle.y,
    rectangle.x + rectangle.width,
    rectangle.y + cornerRadius
  )
  context.lineTo(
    rectangle.x + rectangle.width,
    rectangle.y + rectangle.height - cornerRadius
  )
  context.quadraticCurveTo(
    rectangle.x + rectangle.width,
    rectangle.y + rectangle.height,
    rectangle.x + rectangle.width - cornerRadius,
    rectangle.y + rectangle.height
  )
  context.lineTo(
    rectangle.x + cornerRadius,
    rectangle.y + rectangle.height
  )
  context.quadraticCurveTo(
    rectangle.x,
    rectangle.y + rectangle.height,
    rectangle.x,
    rectangle.y + rectangle.height - cornerRadius
  )
  context.lineTo(rectangle.x, rectangle.y + cornerRadius)
  context.quadraticCurveTo(
    rectangle.x,
    rectangle.y,
    rectangle.x + cornerRadius,
    rectangle.y
  )
  context.closePath()
}

function fitCanvasText(
  context: CanvasRenderingContext2D,
  value: string,
  maximumWidth: number
): string {
  if (maximumWidth <= 0 || context.measureText(value).width <= maximumWidth) {
    return value
  }

  const ellipsis = '…'
  let output = value

  while (
    output.length > 0
    && context.measureText(`${output}${ellipsis}`).width > maximumWidth
  ) {
    output = output.slice(0, -1)
  }

  return `${output}${ellipsis}`
}

function drawExportBackground(
  context: CanvasRenderingContext2D,
  bounds: LogicalRect
): void {
  context.fillStyle = '#f4f8fd'
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
  context.fillStyle = '#b8d3f3'

  const gridSize = 20
  const startX = Math.floor(bounds.x / gridSize) * gridSize
  const startY = Math.floor(bounds.y / gridSize) * gridSize

  for (
    let x = startX;
    x <= bounds.x + bounds.width;
    x += gridSize
  ) {
    for (
      let y = startY;
      y <= bounds.y + bounds.height;
      y += gridSize
    ) {
      context.beginPath()
      context.arc(x, y, 0.8, 0, Math.PI * 2)
      context.fill()
    }
  }
}

function drawExportJoinArrow(
  context: CanvasRenderingContext2D,
  geometry: JoinGeometry,
  edge: 'start' | 'end'
): void {
  const pointsRight = edge === 'end'
  const tipX = pointsRight
    ? geometry.endX - 3
    : geometry.startX + 3
  const tipY = pointsRight ? geometry.endY : geometry.startY
  const baseX = tipX + (pointsRight ? -12 : 12)

  context.save()
  context.beginPath()
  context.moveTo(tipX, tipY)
  context.lineTo(baseX, tipY - 6)
  context.lineTo(baseX, tipY + 6)
  context.closePath()
  context.fillStyle = '#1f6fd1'
  context.strokeStyle = '#ffffff'
  context.lineWidth = 1.5
  context.stroke()
  context.fill()
  context.restore()
}

function drawExportJoins(context: CanvasRenderingContext2D): void {
  joinGeometries.value.forEach((geometry) => {
    const path = new Path2D(geometry.path)

    context.save()
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#ffffff'
    context.lineWidth = 6
    context.stroke(path)
    context.strokeStyle = '#1f6fd1'
    context.lineWidth = 2
    context.stroke(path)

    if (geometry.type === 'LEFT') {
      drawExportJoinArrow(context, geometry, 'end')
    } else if (geometry.type === 'RIGHT') {
      drawExportJoinArrow(context, geometry, 'start')
    }

    const label = joinGeometryLabel(geometry)
    context.font = '700 14px ui-monospace, SFMono-Regular, Menlo, monospace'
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    context.lineWidth = 5
    context.strokeStyle = '#ffffff'
    context.strokeText(label, geometry.labelX, geometry.labelY)
    context.fillStyle = '#1f6fd1'
    context.fillText(label, geometry.labelX, geometry.labelY)
    context.restore()
  })
}

function drawExportTable(
  context: CanvasRenderingContext2D,
  table: QueryTable,
  tableElement: HTMLElement,
  canvasElement: HTMLElement,
  canvasBounds: DOMRect,
  canvasScale: { x: number, y: number }
): void {
  const tableRectangle = elementLogicalRect(
    tableElement,
    canvasElement,
    canvasBounds,
    canvasScale
  )
  const headerElement = tableElement.querySelector<HTMLElement>(
    '.table-node__header'
  )
  const aliasElement = tableElement.querySelector<HTMLElement>(
    '.table-node__alias'
  )
  const fieldListElement = tableElement.querySelector<HTMLElement>(
    '.table-node__fields'
  )

  context.save()
  context.shadowColor = 'rgba(27, 63, 104, 0.16)'
  context.shadowBlur = 18
  context.shadowOffsetY = 7
  roundedRectanglePath(context, tableRectangle, 8)
  context.fillStyle = '#ffffff'
  context.fill()
  context.restore()

  roundedRectanglePath(context, tableRectangle, 8)
  context.strokeStyle = '#a9c4e8'
  context.lineWidth = 1
  context.stroke()

  if (headerElement) {
    const rectangle = elementLogicalRect(
      headerElement,
      canvasElement,
      canvasBounds,
      canvasScale
    )

    context.save()
    roundedRectanglePath(context, {
      ...rectangle,
      height: rectangle.height + 8
    }, 8)
    context.clip()
    context.fillStyle = '#1f6fd1'
    context.fillRect(
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height
    )
    context.restore()

    context.fillStyle = '#ffffff'
    context.textBaseline = 'middle'
    context.textAlign = 'left'
    context.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace'
    context.fillText('▦', rectangle.x + 8, rectangle.y + rectangle.height / 2)

    const isSubquery = table.source?.kind === 'subquery'
    const badgeWidth = isSubquery ? 42 : 0
    const titleX = rectangle.x + 26
    const titleWidth = rectangle.width - 34 - badgeWidth
    context.fillText(
      fitCanvasText(context, table.name, titleWidth),
      titleX,
      rectangle.y + rectangle.height / 2
    )

    if (isSubquery) {
      const badgeRectangle = {
        x: rectangle.x + rectangle.width - badgeWidth - 6,
        y: rectangle.y + 7,
        width: badgeWidth,
        height: 14
      }

      roundedRectanglePath(context, badgeRectangle, 7)
      context.fillStyle = '#ffffff'
      context.fill()
      context.fillStyle = '#1458a9'
      context.font = '800 10px sans-serif'
      context.textAlign = 'center'
      context.fillText(
        t('canvas.subquery'),
        badgeRectangle.x + badgeRectangle.width / 2,
        badgeRectangle.y + badgeRectangle.height / 2
      )
    }
  }

  if (aliasElement) {
    const rectangle = elementLogicalRect(
      aliasElement,
      canvasElement,
      canvasBounds,
      canvasScale
    )

    context.fillStyle = '#eef5ff'
    context.fillRect(
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height
    )
    context.strokeStyle = '#c9daee'
    context.beginPath()
    context.moveTo(rectangle.x, rectangle.y + rectangle.height)
    context.lineTo(
      rectangle.x + rectangle.width,
      rectangle.y + rectangle.height
    )
    context.stroke()

    context.fillStyle = '#536b86'
    context.font = '12px sans-serif'
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.fillText(
      t('canvas.alias'),
      rectangle.x + 6,
      rectangle.y + rectangle.height / 2
    )

    const inputRectangle = {
      x: rectangle.x + 40,
      y: rectangle.y + 3,
      width: rectangle.width - 46,
      height: rectangle.height - 6
    }
    roundedRectanglePath(context, inputRectangle, 3)
    context.fillStyle = '#ffffff'
    context.fill()
    context.strokeStyle = '#a9c4e8'
    context.stroke()
    context.fillStyle = '#203a5c'
    context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
    context.fillText(
      fitCanvasText(context, table.alias, inputRectangle.width - 10),
      inputRectangle.x + 5,
      inputRectangle.y + inputRectangle.height / 2
    )
  }

  if (fieldListElement) {
    const listRectangle = elementLogicalRect(
      fieldListElement,
      canvasElement,
      canvasBounds,
      canvasScale
    )
    const rowElements = Array.from(
      fieldListElement.querySelectorAll<HTMLElement>('li')
    )
    const columns = displayColumnsByTable.value[table.id] ?? []

    context.save()
    context.beginPath()
    context.rect(
      listRectangle.x,
      listRectangle.y,
      listRectangle.width,
      listRectangle.height
    )
    context.clip()

    rowElements.forEach((rowElement, index) => {
      const column = columns[index]

      if (!column) {
        return
      }

      const rectangle = elementLogicalRect(
        rowElement,
        canvasElement,
        canvasBounds,
        canvasScale
      )

      if (
        rectangle.y + rectangle.height <= listRectangle.y
        || rectangle.y >= listRectangle.y + listRectangle.height
      ) {
        return
      }

      const selected = isFieldSelected(table.id, column.name)
      context.fillStyle = selected ? '#e4f0ff' : '#ffffff'
      context.fillRect(
        rectangle.x,
        rectangle.y,
        rectangle.width,
        rectangle.height
      )
      context.fillStyle = selected ? '#e4f0ff' : '#f7f9fc'
      context.fillRect(rectangle.x, rectangle.y, 24, rectangle.height)
      context.strokeStyle = '#d6e1ef'
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(rectangle.x + 24, rectangle.y)
      context.lineTo(
        rectangle.x + 24,
        rectangle.y + rectangle.height
      )
      context.moveTo(
        rectangle.x,
        rectangle.y + rectangle.height
      )
      context.lineTo(
        rectangle.x + rectangle.width,
        rectangle.y + rectangle.height
      )
      context.stroke()

      const checkboxSize = 12
      const checkboxX = rectangle.x + 6
      const checkboxY = rectangle.y
        + (rectangle.height - checkboxSize) / 2
      context.fillStyle = selected ? '#1f6fd1' : '#ffffff'
      context.fillRect(
        checkboxX,
        checkboxY,
        checkboxSize,
        checkboxSize
      )
      context.strokeStyle = selected ? '#1f6fd1' : '#73869b'
      context.strokeRect(
        checkboxX + 0.5,
        checkboxY + 0.5,
        checkboxSize - 1,
        checkboxSize - 1
      )

      if (selected) {
        context.strokeStyle = '#ffffff'
        context.lineWidth = 1.5
        context.beginPath()
        context.moveTo(checkboxX + 2.5, checkboxY + 6)
        context.lineTo(checkboxX + 5, checkboxY + 8.5)
        context.lineTo(checkboxX + 9.5, checkboxY + 3)
        context.stroke()
      }

      context.textBaseline = 'middle'
      context.textAlign = 'left'
      context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
      context.fillStyle = column.primaryKey ? '#c18218' : '#7b8da1'
      context.fillText(
        column.primaryKey ? '◆' : '·',
        rectangle.x + 28,
        rectangle.y + rectangle.height / 2
      )

      context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
      context.fillStyle = selected ? '#1458a9' : '#203a5c'
      const typeWidth = Math.min(
        62,
        context.measureText(column.dataType).width
      )
      context.fillText(
        fitCanvasText(
          context,
          column.name,
          rectangle.width - 48 - typeWidth
        ),
        rectangle.x + 42,
        rectangle.y + rectangle.height / 2
      )

      context.textAlign = 'right'
      context.font = '11px sans-serif'
      context.fillStyle = '#657a91'
      context.fillText(
        fitCanvasText(context, column.dataType, 62),
        rectangle.x + rectangle.width - 5,
        rectangle.y + rectangle.height / 2
      )
    })

    context.restore()
  }
}

function canvasExportBounds(
  tableRectangles: LogicalRect[]
): LogicalRect {
  const horizontalPoints = tableRectangles.flatMap((rectangle) => [
    rectangle.x,
    rectangle.x + rectangle.width
  ])
  const verticalPoints = tableRectangles.flatMap((rectangle) => [
    rectangle.y,
    rectangle.y + rectangle.height
  ])

  joinGeometries.value.forEach((geometry) => {
    horizontalPoints.push(
      geometry.startX,
      geometry.endX,
      geometry.labelX - 90,
      geometry.labelX + 90
    )
    verticalPoints.push(
      geometry.startY - 35,
      geometry.startY,
      geometry.endY,
      geometry.endY + 35,
      geometry.labelY - 18,
      geometry.labelY + 12
    )
  })

  const minimumX = Math.min(...horizontalPoints)
  const maximumX = Math.max(...horizontalPoints)
  const minimumY = Math.min(...verticalPoints)
  const maximumY = Math.max(...verticalPoints)
  const padding = 28

  return {
    x: minimumX - padding,
    y: minimumY - padding,
    width: Math.max(1, maximumX - minimumX + padding * 2),
    height: Math.max(1, maximumY - minimumY + padding * 2)
  }
}

function canvasToPngBlob(
  exportCanvas: HTMLCanvasElement
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    exportCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Unable to encode Query Canvas PNG.'))
      }
    }, 'image/png')
  })
}

async function exportPng(): Promise<CanvasExportResult> {
  await nextTick()
  updateJoinGeometry()

  const canvasElement = canvas.value

  if (!canvasElement || props.model.tables.length === 0) {
    throw new Error('Query Canvas has no tables to export.')
  }

  const canvasBounds = canvasElement.getBoundingClientRect()
  const canvasScale = getCanvasScale(canvasElement, canvasBounds)
  const tableRectangles = props.model.tables.flatMap((table) => {
    const element = tableElements.get(table.id)

    return element
      ? [elementLogicalRect(
          element,
          canvasElement,
          canvasBounds,
          canvasScale
        )]
      : []
  })

  if (tableRectangles.length === 0) {
    throw new Error('Query Canvas table elements are unavailable.')
  }

  const bounds = canvasExportBounds(tableRectangles)
  const maximumDimension = 8192
  const maximumPixels = 32_000_000
  const exportScale = Math.min(
    2,
    maximumDimension / bounds.width,
    maximumDimension / bounds.height,
    Math.sqrt(maximumPixels / (bounds.width * bounds.height))
  )
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = Math.max(1, Math.ceil(bounds.width * exportScale))
  exportCanvas.height = Math.max(1, Math.ceil(bounds.height * exportScale))
  const context = exportCanvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas rendering is unavailable.')
  }

  context.setTransform(
    exportScale,
    0,
    0,
    exportScale,
    -bounds.x * exportScale,
    -bounds.y * exportScale
  )
  drawExportBackground(context, bounds)
  drawExportJoins(context)

  props.model.tables.forEach((table) => {
    const tableElement = tableElements.get(table.id)

    if (tableElement) {
      drawExportTable(
        context,
        table,
        tableElement,
        canvasElement,
        canvasBounds,
        canvasScale
      )
    }
  })

  const blob = await canvasToPngBlob(exportCanvas)
  const timestamp = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, 'Z')
  const fileName = `fabsql-relation-${timestamp}.png`
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)

  return {
    fileName,
    width: exportCanvas.width,
    height: exportCanvas.height
  }
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
        join.joinedTableId ?? '',
        join.left.tableId,
        join.left.columnName,
        join.right.tableId,
        join.right.columnName,
        join.conditions?.children.length ?? 0
      ].join('\u0000')
    ).join('\u0001'),
    () => props.model.tables.map((table) =>
      [
        table.id,
        table.position.x,
        table.position.y,
        table.collapsed === true ? 'collapsed' : 'expanded'
      ].join('\u0000')
    ).join('\u0001'),
    () => props.columnsByTable
  ],
  () => {
    void nextTick(scheduleJoinGeometryUpdate)
  }
)

watch(
  () => props.model.tables.length,
  (tableCount) => {
    if (tableCount === 0) {
      panOffset.x = 0
      panOffset.y = 0
      canvasPan.value = null
    }
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

defineExpose({
  exportPng
})
</script>

<template>
  <section
    ref="canvas"
    class="query-canvas"
    :class="{
      'query-canvas--drag-over': isDragOver,
      'query-canvas--panning': canvasPan
    }"
    :style="{
      backgroundPosition: `${panOffset.x}px ${panOffset.y}px`
    }"
    :aria-label="t('canvas.title')"
    :title="t('canvas.panHint')"
    @dragenter="handleDragEnter"
    @dragleave.self="isDragOver = false"
    @dragover="handleDragOver"
    @drop="handleDrop"
    @lostpointercapture="handleCanvasLostPointerCapture"
    @pointercancel="finishCanvasPan"
    @pointerdown="startCanvasPan"
    @pointermove="moveCanvasPan"
    @pointerup="finishCanvasPan"
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
            type: joinGeometryLabel(geometry)
          })"
          @dblclick.stop="openJoinTypeEditor(geometry)"
          @keydown.enter.prevent="openJoinTypeEditor(geometry)"
        >
          {{ joinGeometryLabel(geometry) }}
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
      :class="{ 'table-node--collapsed': table.collapsed }"
      :style="{
        transform: getTableTransform(table)
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
        @dblclick.stop="openSubquery(table)"
      >
        <span class="table-node__icon" aria-hidden="true">▦</span>
        <strong>{{ table.name }}</strong>
        <button
          v-if="table.source?.kind === 'subquery'"
          class="table-node__source-badge"
          type="button"
          :aria-label="t('canvas.openSubquery', {
            table: table.alias || table.name
          })"
          :title="t('canvas.openSubquery', {
            table: table.alias || table.name
          })"
          @pointerdown.stop
          @click.stop="openSubquery(table)"
        >
          {{ t('canvas.subquery') }}
        </button>
        <button
          type="button"
          class="icon-button table-node__collapse-button"
          :aria-expanded="!table.collapsed"
          :aria-label="table.collapsed
            ? t('canvas.expandTable', { table: table.name })
            : t('canvas.collapseTable', { table: table.name })"
          :title="table.collapsed
            ? t('canvas.expandTable', { table: table.name })
            : t('canvas.collapseTable', { table: table.name })"
          @dblclick.stop
          @pointerdown.stop
          @click.stop="emit(
            'setTableCollapsed',
            table.id,
            !table.collapsed
          )"
        >
          <span aria-hidden="true">
            {{ table.collapsed ? '▸' : '▾' }}
          </span>
        </button>
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

      <label v-if="!table.collapsed" class="table-node__alias">
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
        v-if="!table.collapsed && !displayColumnsByTable[table.id]"
        class="table-node__loading"
      >
        {{ t('canvas.loadingFields') }}
      </div>

      <ul
        v-else-if="!table.collapsed"
        class="table-node__fields"
        @scroll="handleFieldListScroll"
      >
        <li
          v-for="column in displayColumnsByTable[table.id]"
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
