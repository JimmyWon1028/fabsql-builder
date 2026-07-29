export type ApiProvider = 'fastify' | 'laravel' | 'session'

export interface ApiClientConfig {
  provider: ApiProvider
  laravelUrl: string
}

export const defaultLaravelApiUrl = 'http://api.jl.test'

let activeConfig: ApiClientConfig = {
  provider: 'fastify',
  laravelUrl: defaultLaravelApiUrl
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function resolveSessionApiUrl(
  search: string,
  pageProtocol: string
): string | null {
  const sessionValue = new URLSearchParams(search).get('session')?.trim()

  if (!sessionValue) {
    return null
  }

  const protocol = pageProtocol === 'http:' || pageProtocol === 'https:'
    ? pageProtocol
    : 'https:'
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(sessionValue)
    ? sessionValue
    : sessionValue.startsWith('//')
      ? `${protocol}${sessionValue}`
      : `${protocol}//${sessionValue.replace(/^\/+/, '')}`

  try {
    const url = new URL(candidate)

    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || !url.hostname
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      return null
    }

    return normalizeBaseUrl(url.toString())
  } catch {
    return null
  }
}

export function configureApiClient(config: ApiClientConfig): void {
  activeConfig = {
    provider: config.provider,
    laravelUrl: normalizeBaseUrl(config.laravelUrl)
      || defaultLaravelApiUrl
  }
}

export function getApiClientConfig(): ApiClientConfig {
  return {
    ...activeConfig
  }
}

export function resolveApiUrl(path: string): string {
  if (activeConfig.provider === 'fastify') {
    return path
  }

  if (activeConfig.provider === 'session') {
    const sessionPath = path.replace(/^\/api(?=\/|$)/, '')

    return `${activeConfig.laravelUrl}${sessionPath}`
  }

  return `${activeConfig.laravelUrl}${path}`
}
