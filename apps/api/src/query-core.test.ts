import type {
  FilterGroup,
  QueryModel,
  QueryTable
} from '@sql-builder/shared'
import {
  cloneQueryModel,
  compileQuery,
  createEmptyQueryModel,
  deserializeQueryModel,
  isQueryModel,
  QueryHistory,
  serializeQueryModel,
  validateQueryModel
} from '@sql-builder/shared'
import { describe, expect, test } from 'vitest'

function table(
  id: string,
  name: string,
  alias = name
): QueryTable {
  return {
    id,
    name,
    alias,
    position: {
      x: 0,
      y: 0
    }
  }
}

function singleTableModel(): QueryModel {
  const model = createEmptyQueryModel()
  model.tables.push(table('orders', 'orders'))
  model.selectedFields.push({
    id: 'selected-id',
    field: {
      tableId: 'orders',
      columnName: 'id'
    },
    alias: '',
    aggregate: 'none',
    distinct: false
  })
  return model
}

describe('MariaDB query compiler', () => {
  test('compiles a single selected field', () => {
    const result = compileQuery(singleTableModel())

    expect(result.status).toBe('valid')
    expect(result.sql).toBe([
      'Select',
      '  `orders`.`id`',
      'From `orders`'
    ].join('\n'))
    expect(result.parameters).toEqual([])
  })

  test('compiles a manual LEFT JOIN and stable aliases', () => {
    const model = singleTableModel()
    model.tables[0]!.alias = 'o'
    model.tables.push(table('customers', 'customers', 'c'))
    model.selectedFields.push({
      id: 'selected-name',
      field: {
        tableId: 'customers',
        columnName: 'name'
      },
      alias: 'customer_name',
      aggregate: 'none',
      distinct: false
    })
    model.joins.push({
      id: 'join-customer',
      type: 'LEFT',
      left: {
        tableId: 'orders',
        columnName: 'customer_id'
      },
      right: {
        tableId: 'customers',
        columnName: 'id'
      }
    })

    const result = compileQuery(model)

    expect(result.status).toBe('valid')
    expect(result.sql).toContain(
      '  `o`.`id`, `c`.`name` As `customer_name`'
    )
    expect(result.sql).toContain('From `orders` As `o`')
    expect(result.sql).toContain('  Left Join `customers` As `c`')
    expect(result.sql).toContain(
      '  On `o`.`customer_id` = `c`.`id`'
    )
    expect(result.sql).toContain('`c`.`name` As `customer_name`')
  })

  test('compiles a RIGHT JOIN', () => {
    const model = singleTableModel()
    model.tables.push(table('history', 'order_history'))
    model.joins.push({
      id: 'join-history',
      type: 'RIGHT',
      left: {
        tableId: 'orders',
        columnName: 'id'
      },
      right: {
        tableId: 'history',
        columnName: 'order_id'
      }
    })

    const result = compileQuery(model)

    expect(result.status).toBe('valid')
    expect(result.sql).toContain('  Right Join `order_history`')
    expect(result.sql).toContain(
      '  On `orders`.`id` = `order_history`.`order_id`'
    )
  })

  test('compiles an unqualified JOIN keyword', () => {
    const model = singleTableModel()
    model.tables.push(table('customers', 'customers'))
    model.joins.push({
      id: 'join-customers',
      type: 'JOIN',
      left: {
        tableId: 'orders',
        columnName: 'customer_id'
      },
      right: {
        tableId: 'customers',
        columnName: 'id'
      }
    })

    const result = compileQuery(model)

    expect(result.status).toBe('valid')
    expect(result.sql).toBe([
      'Select',
      '  `orders`.`id`',
      'From `orders`',
      '  Join `customers`',
      '  On `orders`.`customer_id` = `customers`.`id`'
    ].join('\n'))
  })

  test('rejects alias conflicts', () => {
    const model = singleTableModel()
    model.tables[0]!.alias = 'row'
    model.tables.push(table('customers', 'customers', 'row'))

    expect(validateQueryModel(model)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'table-alias-conflict',
        severity: 'error'
      })
    ]))
  })

  test('compiles nested AND and OR filters with parameters', () => {
    const model = singleTableModel()
    const nestedGroup: FilterGroup = {
      id: 'nested',
      kind: 'group',
      conjunction: 'OR',
      children: [
        {
          id: 'status-a',
          kind: 'condition',
          field: {
            tableId: 'orders',
            columnName: 'status'
          },
          operator: '=',
          value: 'open'
        },
        {
          id: 'status-b',
          kind: 'condition',
          field: {
            tableId: 'orders',
            columnName: 'status'
          },
          operator: '=',
          value: 'pending'
        }
      ]
    }
    model.filters.children = [
      nestedGroup,
      {
        id: 'total',
        kind: 'condition',
        field: {
          tableId: 'orders',
          columnName: 'total'
        },
        operator: '>',
        value: 100
      }
    ]

    const result = compileQuery(model)

    expect(result.sql).toContain(
      'Where (`orders`.`status` = ? Or `orders`.`status` = ?) '
        + 'And `orders`.`total` > ?'
    )
    expect(result.parameters).toEqual(['open', 'pending', 100])
  })

  test('parenthesizes a nested group regardless of its stable ID', () => {
    const model = singleTableModel()
    model.filters.id = 'actual-root'
    model.filters.children = [
      {
        id: 'filter-root',
        kind: 'group',
        conjunction: 'OR',
        children: [
          {
            id: 'status-open',
            kind: 'condition',
            field: {
              tableId: 'orders',
              columnName: 'status'
            },
            operator: '=',
            value: 'open'
          },
          {
            id: 'status-pending',
            kind: 'condition',
            field: {
              tableId: 'orders',
              columnName: 'status'
            },
            operator: '=',
            value: 'pending'
          }
        ]
      },
      {
        id: 'active',
        kind: 'condition',
        field: {
          tableId: 'orders',
          columnName: 'active'
        },
        operator: '=',
        value: true
      }
    ]

    expect(compileQuery(model).sql).toContain(
      'Where (`orders`.`status` = ? Or `orders`.`status` = ?) '
        + 'And `orders`.`active` = ?'
    )
  })

  test('trims editable table aliases before compiling', () => {
    const model = singleTableModel()
    model.tables[0]!.alias = '  o  '

    expect(compileQuery(model).sql).toContain(
      '`o`.`id`\nFrom `orders` As `o`'
    )
  })

  test('compiles NULL comparisons without parameters', () => {
    const model = singleTableModel()
    model.filters.children.push({
      id: 'deleted',
      kind: 'condition',
      field: {
        tableId: 'orders',
        columnName: 'deleted_at'
      },
      operator: 'IS NULL'
    })

    const result = compileQuery(model)

    expect(result.sql).toContain('Where `orders`.`deleted_at` Is Null')
    expect(result.parameters).toEqual([])
  })

  test('marks an empty IN list as incomplete', () => {
    const model = singleTableModel()
    model.filters.children.push({
      id: 'empty-in',
      kind: 'condition',
      field: {
        tableId: 'orders',
        columnName: 'status'
      },
      operator: 'IN',
      value: []
    })

    const result = compileQuery(model)

    expect(result.status).toBe('incomplete')
    expect(result.sql).toBe('')
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'filter-empty-list'
      })
    ]))
  })

  test('compiles aggregation and GROUP BY', () => {
    const model = singleTableModel()
    model.selectedFields[0]!.field.columnName = 'customer_id'
    model.selectedFields.push({
      id: 'count',
      field: {
        tableId: 'orders',
        columnName: 'id'
      },
      alias: 'order_count',
      aggregate: 'COUNT',
      distinct: true
    })
    model.grouping.push({
      id: 'group-customer',
      field: {
        tableId: 'orders',
        columnName: 'customer_id'
      }
    })

    const result = compileQuery(model)

    expect(result.sql).toContain(
      'COUNT(Distinct `orders`.`id`) As `order_count`'
    )
    expect(result.sql).toContain('Group By `orders`.`customer_id`')
  })

  test('compiles sorting and parameterized pagination', () => {
    const model = singleTableModel()
    model.sorting.push({
      id: 'sort-id',
      field: {
        tableId: 'orders',
        columnName: 'created_at'
      },
      direction: 'DESC'
    })
    model.pagination = {
      limit: 25,
      offset: 50
    }

    const result = compileQuery(model)

    expect(result.sql).toContain('Order By `orders`.`created_at` Desc')
    expect(result.sql).toContain('Limit ?\nOffset ?')
    expect(result.parameters).toEqual([25, 50])
  })

  test('escapes special characters in identifiers', () => {
    const model = createEmptyQueryModel()
    model.tables.push(table('special', 'order`detail', 'select'))
    model.selectedFields.push({
      id: 'special-field',
      field: {
        tableId: 'special',
        columnName: 'strange`name'
      },
      alias: '',
      aggregate: 'none',
      distinct: false
    })

    expect(compileQuery(model).sql).toContain(
      '`select`.`strange``name`\nFrom `order``detail` As `select`'
    )
  })
})

describe('Query Model state', () => {
  test('round trips through versioned JSON serialization', () => {
    const model = singleTableModel()
    const serialized = serializeQueryModel(model)

    expect(deserializeQueryModel(serialized)).toEqual(model)
  })

  test('supports undo and redo with isolated snapshots', () => {
    const initial = singleTableModel()
    const history = new QueryHistory(initial, cloneQueryModel)
    const changed = cloneQueryModel(initial)
    changed.tables[0]!.alias = 'o'

    history.commit(changed)
    expect(history.current.tables[0]!.alias).toBe('o')
    expect(history.undo().tables[0]!.alias).toBe('orders')
    expect(history.redo().tables[0]!.alias).toBe('o')
  })

  test('clones nested Proxy values into plain history snapshots', () => {
    const model = singleTableModel()
    const sourcePosition = model.tables[0]!.position
    model.tables[0]!.position = new Proxy(sourcePosition, {})

    const cloned = cloneQueryModel(model)
    cloned.tables[0]!.position.x = 80

    expect(cloned.tables[0]!.position).toEqual({ x: 80, y: 0 })
    expect(sourcePosition).toEqual({ x: 0, y: 0 })
    expect(() => new QueryHistory(model, cloneQueryModel)).not.toThrow()
  })

  test('rejects a condition in place of the root filter group', () => {
    const model = singleTableModel() as unknown as Record<string, unknown>
    model.filters = {
      id: 'invalid-root',
      kind: 'condition',
      field: {
        tableId: 'orders',
        columnName: 'id'
      },
      operator: '=',
      value: 1
    }

    expect(isQueryModel(model)).toBe(false)
  })

  test('reports duplicate stable IDs', () => {
    const model = singleTableModel()
    model.selectedFields[0]!.id = model.tables[0]!.id

    expect(validateQueryModel(model)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'stable-id-duplicate',
        severity: 'error'
      })
    ]))
  })

  test('clones the initial history value and caps undo entries', () => {
    const initial = singleTableModel()
    const history = new QueryHistory(initial, cloneQueryModel, 2)
    initial.tables[0]!.alias = 'mutated-outside'

    expect(history.current.tables[0]!.alias).toBe('orders')

    for (const alias of ['one', 'two', 'three']) {
      const changed = cloneQueryModel(history.current)
      changed.tables[0]!.alias = alias
      history.commit(changed)
    }

    expect(history.undo().tables[0]!.alias).toBe('two')
    expect(history.undo().tables[0]!.alias).toBe('one')
    expect(history.undo().tables[0]!.alias).toBe('one')
  })
})
