export type SqlTokenType =
  | 'comment'
  | 'function'
  | 'identifier'
  | 'keyword'
  | 'number'
  | 'operator'
  | 'parameter'
  | 'plain'
  | 'string'

export interface SqlToken {
  type: SqlTokenType
  value: string
}

const keywords = new Set([
  'ALL',
  'AND',
  'AS',
  'ASC',
  'BETWEEN',
  'BY',
  'CASE',
  'DESC',
  'DISTINCT',
  'ELSE',
  'END',
  'EXISTS',
  'FALSE',
  'FROM',
  'FULL',
  'GROUP',
  'HAVING',
  'IN',
  'INNER',
  'IS',
  'JOIN',
  'LEFT',
  'LIKE',
  'LIMIT',
  'NOT',
  'NULL',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'OUTER',
  'RIGHT',
  'SELECT',
  'THEN',
  'TRUE',
  'WHEN',
  'WHERE'
])

const functions = new Set([
  'AVG',
  'COUNT',
  'MAX',
  'MIN',
  'SUM'
])

const tokenPatterns: Array<{
  type: SqlTokenType
  pattern: RegExp
}> = [
  {
    type: 'plain',
    pattern: /^\s+/
  },
  {
    type: 'comment',
    pattern: /^(?:--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/
  },
  {
    type: 'identifier',
    pattern: /^`(?:``|[^`])*`/
  },
  {
    type: 'string',
    pattern: /^(?:'(?:''|\\.|[^'])*'|"(?:""|\\.|[^"])*")/
  },
  {
    type: 'parameter',
    pattern: /^(?:\?|[:@][A-Za-z_][A-Za-z0-9_]*)/
  },
  {
    type: 'number',
    pattern: /^\b\d+(?:\.\d+)?\b/
  },
  {
    type: 'operator',
    pattern: /^(?:<=>|<>|<=|>=|!=|:=|[-+*/%=<>()[\]{},.;])/
  }
]

function appendToken(tokens: SqlToken[], token: SqlToken): void {
  const previousToken = tokens.at(-1)

  if (previousToken?.type === token.type) {
    previousToken.value += token.value
    return
  }

  tokens.push(token)
}

export function highlightSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = []
  let remainingSql = sql

  while (remainingSql) {
    const wordMatch = remainingSql.match(/^[A-Za-z_][A-Za-z0-9_$]*/)

    if (wordMatch) {
      const value = wordMatch[0]
      const normalizedValue = value.toLocaleUpperCase('en-US')
      const type = keywords.has(normalizedValue)
        ? 'keyword'
        : functions.has(normalizedValue)
          || /^\s*\(/.test(remainingSql.slice(value.length))
          ? 'function'
          : 'plain'

      appendToken(tokens, {
        type,
        value
      })
      remainingSql = remainingSql.slice(value.length)
      continue
    }

    const matchedPattern = tokenPatterns.find(({ pattern }) =>
      pattern.test(remainingSql)
    )
    const value = matchedPattern
      ? remainingSql.match(matchedPattern.pattern)?.[0]
      : remainingSql[0]

    appendToken(tokens, {
      type: matchedPattern?.type ?? 'plain',
      value: value ?? ''
    })
    remainingSql = remainingSql.slice(value?.length ?? 1)
  }

  return tokens
}
