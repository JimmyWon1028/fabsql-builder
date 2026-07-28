export const queryBuilderDragType = 'application/x-sql-builder'

export type QueryBuilderDragPayload =
  | {
      kind: 'table'
      tableName: string
    }
  | {
      kind: 'field'
      tableId?: string
      tableName: string
      columnName: string
    }

export function writeDragPayload(
  event: DragEvent,
  payload: QueryBuilderDragPayload
): void {
  if (!event.dataTransfer) {
    return
  }

  event.dataTransfer.effectAllowed = payload.kind === 'field'
    ? 'copyLink'
    : 'copy'
  event.dataTransfer.setData(
    queryBuilderDragType,
    JSON.stringify(payload)
  )
  event.dataTransfer.setData(
    'text/plain',
    payload.kind === 'table'
      ? payload.tableName
      : `${payload.tableName}.${payload.columnName}`
  )
}

export function readDragPayload(
  event: DragEvent
): QueryBuilderDragPayload | null {
  const serialized = event.dataTransfer?.getData(queryBuilderDragType)

  if (!serialized) {
    return null
  }

  try {
    const payload = JSON.parse(serialized) as QueryBuilderDragPayload

    if (
      payload.kind === 'table'
      && typeof payload.tableName === 'string'
    ) {
      return payload
    }

    if (
      payload.kind === 'field'
      && typeof payload.tableName === 'string'
      && typeof payload.columnName === 'string'
    ) {
      return payload
    }
  } catch {
    return null
  }

  return null
}
