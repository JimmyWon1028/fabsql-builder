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

  test('keeps source SQL as presentation metadata only', () => {
    const model = singleTableModel()
    model.sourceSql = 'SELECT  M.id\\nFROM orders M'

    const result = compileQuery(model)

    expect(result.status).toBe('valid')
    expect(result.sql).toBe([
      'Select',
      '  `orders`.`id`',
      'From `orders`'
    ].join('\n'))
    expect(deserializeQueryModel(serializeQueryModel(model)).sourceSql)
      .toBe(model.sourceSql)
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

  test('allows MariaDB non-strict GROUP BY output fields', () => {
    const model = singleTableModel()
    model.selectedFields[0]!.field.columnName = 'customer_id'
    model.selectedFields.push({
      id: 'customer-name',
      field: {
        tableId: 'orders',
        columnName: 'customer_name'
      },
      alias: '',
      aggregate: 'none',
      distinct: false
    })
    model.selectedFields.push({
      id: 'count',
      field: {
        tableId: 'orders',
        columnName: 'id'
      },
      alias: 'order_count',
      aggregate: 'COUNT',
      distinct: false
    })
    model.grouping.push({
      id: 'group-customer',
      field: {
        tableId: 'orders',
        columnName: 'customer_id'
      }
    })

    const result = compileQuery(model)

    expect(result.status).toBe('valid')
    expect(result.sql).toContain('`orders`.`customer_name`')
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

  test('compiles structured expressions and custom parameters', () => {
    const model = singleTableModel()
    model.tables[0]!.alias = 'M'
    model.tables.push(table('detail', 'details', 'D'))
    model.selectedFields[0] = {
      ...model.selectedFields[0]!,
      field: {
        tableId: 'orders',
        columnName: 'delivery_date'
      },
      expression: {
        kind: 'function',
        name: 'formatDateStr',
        arguments: [{
          kind: 'field',
          field: {
            tableId: 'orders',
            columnName: 'delivery_date'
          }
        }]
      },
      alias: 'delivery_date'
    }
    model.selectedFields.push({
      id: 'signed-quantity',
      field: {
        tableId: 'detail',
        columnName: 'quantity'
      },
      expression: {
        kind: 'binary',
        operator: '*',
        left: {
          kind: 'field',
          field: {
            tableId: 'detail',
            columnName: 'quantity'
          }
        },
        right: {
          kind: 'literal',
          value: -1
        }
      },
      alias: 'signed_quantity',
      aggregate: 'none',
      distinct: false
    })
    model.joins.push({
      id: 'join-detail',
      type: 'JOIN',
      left: {
        tableId: 'orders',
        columnName: 'id'
      },
      right: {
        tableId: 'detail',
        columnName: 'order_id'
      },
      conditions: {
        id: 'join-conditions',
        kind: 'group',
        conjunction: 'AND',
        children: [{
          id: 'join-active',
          kind: 'condition',
          field: {
            tableId: 'detail',
            columnName: 'active'
          },
          operator: '=',
          value: true
        }]
      }
    })
    model.filters.children.push({
      id: 'delivery-from',
      kind: 'condition',
      field: {
        tableId: 'orders',
        columnName: 'delivery_date'
      },
      operator: '>=',
      value: {
        kind: 'parameter',
        name: 'delivery_from'
      }
    })
    model.sorting.push({
      id: 'sort-delivery',
      field: {
        tableId: 'orders',
        columnName: 'delivery_date'
      },
      outputReference: 'delivery_date',
      direction: 'ASC'
    })

    const result = compileQuery(model)

    expect(result.status).toBe('valid')
    expect(result.sql).toContain(
      'formatDateStr(`M`.`delivery_date`) As `delivery_date`'
    )
    expect(result.sql).toContain(
      '(`D`.`quantity` * ?) As `signed_quantity`'
    )
    expect(result.sql).toContain('  And (`D`.`active` = ?)')
    expect(result.sql).toContain(
      'Where `M`.`delivery_date` >= @delivery_from'
    )
    expect(result.sql).toContain('Order By `delivery_date` Asc')
    expect(result.parameters).toEqual([-1, true])
    expect(result.namedParameters).toEqual(['delivery_from'])
  })

  test('binds provided custom parameter values', () => {
    const model = singleTableModel()
    model.filters.children.push({
      id: 'delivery-from',
      kind: 'condition',
      field: {
        tableId: 'orders',
        columnName: 'delivery_date'
      },
      operator: '>=',
      value: {
        kind: 'parameter',
        name: 'delivery_from'
      }
    })

    const result = compileQuery(model, {
      delivery_from: '20260701'
    })

    expect(result.status).toBe('valid')
    expect(result.sql).toContain(
      'Where `orders`.`delivery_date` >= ?'
    )
    expect(result.parameters).toEqual(['20260701'])
    expect(result.namedParameters).toEqual([])
  })

  test('compiles SELECT DISTINCT with a derived table JOIN', () => {
    const subquery = singleTableModel()
    subquery.tables[0]!.alias = 'M2'
    subquery.selectedFields[0]!.field.columnName = 'delivery_no'
    subquery.filters.children.push({
      id: 'subquery-type',
      kind: 'condition',
      field: {
        tableId: 'orders',
        columnName: 'transaction_type'
      },
      operator: 'IN',
      value: ['51']
    })

    const model = singleTableModel()
    model.distinct = true
    model.tables[0]!.alias = 'M'
    model.tables.push({
      id: 'derived-orders',
      name: 'T2',
      alias: 'T2',
      position: {
        x: 320,
        y: 40
      },
      source: {
        kind: 'subquery',
        query: subquery
      }
    })
    model.selectedFields.push({
      id: 'customer-order',
      field: {
        tableId: 'derived-orders',
        columnName: 'customer_order_no'
      },
      alias: '',
      aggregate: 'none',
      distinct: false
    })
    model.joins.push({
      id: 'join-derived',
      type: 'JOIN',
      left: {
        tableId: 'orders',
        columnName: 'delivery_no'
      },
      right: {
        tableId: 'derived-orders',
        columnName: 'delivery_no'
      }
    })
    model.filters.children.push({
      id: 'outer-date',
      kind: 'condition',
      field: {
        tableId: 'orders',
        columnName: 'delivery_date'
      },
      operator: '>=',
      value: {
        kind: 'parameter',
        name: 'delivery_from'
      }
    })

    const result = compileQuery(model)

    expect(result.status).toBe('valid')
    expect(result.sql).toContain('Select Distinct')
    expect(result.sql).toContain(
      '  Join (\n'
        + '    Select\n'
        + '      `M2`.`delivery_no`\n'
        + '    From `orders` As `M2`'
    )
    expect(result.sql).toContain('  ) As `T2`')
    expect(result.sql).toContain(
      '  On `M`.`delivery_no` = `T2`.`delivery_no`'
    )
    expect(result.parameters).toEqual(['51'])
    expect(result.namedParameters).toEqual(['delivery_from'])
  })

  test('compiles scalar subqueries and ORDER BY expressions', () => {
    const model = singleTableModel()
    model.tables[0]!.alias = 'W'
    model.selectedFields.push({
      id: 'constant-mark',
      field: {
        tableId: 'orders',
        columnName: 'mark'
      },
      expression: {
        kind: 'literal',
        value: ''
      },
      alias: 'mark',
      aggregate: 'none',
      distinct: false
    })

    const scalarQuery = singleTableModel()
    scalarQuery.tables[0]!.id = 'detail'
    scalarQuery.tables[0]!.alias = 'D'
    scalarQuery.selectedFields[0]!.field.tableId = 'detail'
    scalarQuery.externalTables = [{
      id: 'orders',
      alias: 'W'
    }]
    scalarQuery.selectedFields[0] = {
      ...scalarQuery.selectedFields[0]!,
      expression: {
        kind: 'aggregate',
        name: 'GROUP_CONCAT',
        argument: {
          kind: 'field',
          field: {
            tableId: 'detail',
            columnName: 'quantity'
          }
        },
        distinct: false,
        ordering: [{
          expression: {
            kind: 'field',
            field: {
              tableId: 'detail',
              columnName: 'delivery_date'
            }
          },
          direction: 'ASC'
        }]
      }
    }
    scalarQuery.filters.children.push({
      id: 'correlated-product',
      kind: 'condition',
      field: {
        tableId: 'detail',
        columnName: 'product_id'
      },
      operator: '=',
      rightExpression: {
        kind: 'field',
        field: {
          tableId: 'orders',
          columnName: 'product_id'
        }
      }
    })
    model.selectedFields.push({
      id: 'scalar-total',
      field: {
        tableId: 'orders',
        columnName: 'total'
      },
      expression: {
        kind: 'subquery',
        query: scalarQuery
      },
      alias: 'total',
      aggregate: 'none',
      distinct: false
    })
    model.sorting.push({
      id: 'sort-fallback',
      field: {
        tableId: 'orders',
        columnName: 'sort_no'
      },
      expression: {
        kind: 'function',
        name: 'IfNull',
        arguments: [
          {
            kind: 'field',
            field: {
              tableId: 'orders',
              columnName: 'sort_no'
            }
          },
          {
            kind: 'literal',
            value: 999
          }
        ]
      },
      direction: 'ASC'
    })

    const result = compileQuery(model)

    expect(result.status).toBe('valid')
    expect(result.sql).toContain('? As `mark`')
    expect(result.sql).toContain(
      'GROUP_CONCAT(`D`.`quantity` Order By `D`.`delivery_date` Asc)'
    )
    expect(result.sql).toContain(
      'Where `D`.`product_id` = `W`.`product_id`'
    )
    expect(result.sql).toContain(
      'Order By IfNull(`W`.`sort_no`, ?) Asc'
    )
    expect(result.parameters).toEqual(['', 999])
  })

  test('compiles CASE expressions with expression branches', () => {
    const model = createEmptyQueryModel()
    model.tables.push(table('product', 'prod', 'P'))
    model.selectedFields.push({
      id: 'process-label',
      field: {
        tableId: 'product',
        columnName: 'proc7'
      },
      expression: {
        kind: 'case',
        branches: [{
          when: {
            kind: 'binary',
            operator: '=',
            left: {
              kind: 'field',
              field: {
                tableId: 'product',
                columnName: 'proc7'
              }
            },
            right: {
              kind: 'literal',
              value: '0'
            }
          },
          then: {
            kind: 'literal',
            value: '炖: NO'
          }
        }],
        elseExpression: {
          kind: 'literal',
          value: '炖:YES'
        }
      },
      alias: 'proc7',
      aggregate: 'none',
      distinct: false
    })

    const result = compileQuery(model)

    expect(result.status).toBe('valid')
    expect(result.sql).toContain(
      'Case When (`P`.`proc7` = ?) Then ? Else ? End As `proc7`'
    )
    expect(result.parameters).toEqual(['0', '炖: NO', '炖:YES'])
  })

  test('compiles UNION, IN subqueries, and self JOIN conditions', () => {
    const model = createEmptyQueryModel()
    model.tables.push(
      table('orders', 'orders', 'O'),
      table('product', 'prod', 'P')
    )
    model.selectedFields.push({
      id: 'order-id',
      field: {
        tableId: 'orders',
        columnName: 'id'
      },
      alias: '',
      aggregate: 'none',
      distinct: false
    })
    model.joins.push({
      id: 'self-product-join',
      type: 'JOIN',
      joinedTableId: 'product',
      left: {
        tableId: 'product',
        columnName: 'id'
      },
      right: {
        tableId: 'product',
        columnName: 'id'
      }
    })

    const filterSubquery = createEmptyQueryModel()
    filterSubquery.tables.push(table('allowed', 'allowed_orders', 'A'))
    filterSubquery.selectedFields.push({
      id: 'allowed-id',
      field: {
        tableId: 'allowed',
        columnName: 'order_id'
      },
      alias: '',
      aggregate: 'none',
      distinct: true
    })

    const unionQuery = createEmptyQueryModel()
    unionQuery.tables.push(table('archive', 'archived_orders', 'R'))
    unionQuery.selectedFields.push({
      id: 'archive-id',
      field: {
        tableId: 'archive',
        columnName: 'id'
      },
      alias: '',
      aggregate: 'none',
      distinct: false
    })
    unionQuery.filters.children.push({
      id: 'archive-allowed',
      kind: 'condition',
      field: {
        tableId: 'archive',
        columnName: 'id'
      },
      operator: 'IN',
      rightExpression: {
        kind: 'subquery',
        query: filterSubquery
      }
    })
    model.setOperations = [{
      id: 'union-archive',
      operator: 'UNION',
      query: unionQuery
    }]

    const result = compileQuery(model)

    expect(result.status).toBe('valid')
    expect(result.sql).toContain(
      'Join `prod` As `P`\n  On `P`.`id` = `P`.`id`'
    )
    expect(result.sql).toContain('\nUnion\nSelect')
    expect(result.sql).toContain(
      '`R`.`id` In (\n  Select\n    `A`.`order_id`'
    )
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
