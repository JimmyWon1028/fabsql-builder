import { ref } from 'vue'

import { getApiClientConfig } from './api-client-config'

export interface LaravelUser {
  id?: number | string
  name: string
  email: string
}

interface LaravelAuthentication {
  version: 1
  laravelUrl: string
  accessToken: string
  user: LaravelUser
}

interface LaravelLoginResponse {
  token?: string
  user?: Partial<LaravelUser>
  message?: string
}

interface LaravelRefreshResponse {
  authorisation?: {
    token?: string
  }
  message?: string
}

const storageKey = 'fabsql.laravel-auth.v1'
let pendingRefresh: Promise<string> | null = null

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function readAuthentication(): LaravelAuthentication | null {
  try {
    const serialized = sessionStorage.getItem(storageKey)

    if (!serialized) {
      return null
    }

    const value = JSON.parse(serialized) as Partial<LaravelAuthentication>

    if (
      value.version !== 1
      || typeof value.laravelUrl !== 'string'
      || !value.laravelUrl
      || typeof value.accessToken !== 'string'
      || !value.accessToken
      || !value.user
      || typeof value.user.name !== 'string'
      || typeof value.user.email !== 'string'
    ) {
      return null
    }

    return value as LaravelAuthentication
  } catch {
    return null
  }
}

function persistAuthentication(
  authentication: LaravelAuthentication | null
): void {
  try {
    if (authentication) {
      sessionStorage.setItem(storageKey, JSON.stringify(authentication))
    } else {
      sessionStorage.removeItem(storageKey)
    }
  } catch {
    // Authentication remains available in memory for this page.
  }
}

async function authenticationRequest<ResponseType>(
  laravelUrl: string,
  path: string,
  options: RequestInit
): Promise<ResponseType> {
  const response = await fetch(`${normalizeBaseUrl(laravelUrl)}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers
    }
  })
  const body = await response.json().catch(() => null) as (
    ResponseType & {
      message?: string
    }
  ) | null

  if (!response.ok) {
    throw new Error(body?.message ?? `Request failed: ${response.status}`)
  }

  if (!body) {
    throw new Error('Laravel authentication returned an empty response.')
  }

  return body
}

export class LaravelAuthenticationRequiredError extends Error {
  public constructor() {
    super('Laravel sign-in is required.')
    this.name = 'LaravelAuthenticationRequiredError'
  }
}

export class LaravelSessionAuthenticationRequiredError extends Error {
  public constructor() {
    super('An authenticated ERP session is required.')
    this.name = 'LaravelSessionAuthenticationRequiredError'
  }
}

export const laravelAuthentication = ref<LaravelAuthentication | null>(
  readAuthentication()
)

export function isLaravelAuthenticatedForUrl(url: string): boolean {
  return Boolean(
    laravelAuthentication.value
    && laravelAuthentication.value.laravelUrl === normalizeBaseUrl(url)
    && laravelAuthentication.value.accessToken
  )
}

export function getLaravelAccessToken(): string | null {
  const config = getApiClientConfig()

  if (
    config.provider !== 'laravel'
    || !isLaravelAuthenticatedForUrl(config.laravelUrl)
  ) {
    return null
  }

  return laravelAuthentication.value?.accessToken ?? null
}

export async function loginToLaravel(
  laravelUrl: string,
  email: string,
  password: string
): Promise<LaravelUser> {
  const normalizedUrl = normalizeBaseUrl(laravelUrl)
  const response = await authenticationRequest<LaravelLoginResponse>(
    normalizedUrl,
    '/api/login',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password
      })
    }
  )

  if (!response.token || !response.user) {
    throw new Error('Laravel login response is incomplete.')
  }

  const user: LaravelUser = {
    ...(response.user.id !== undefined
      ? { id: response.user.id }
      : {}),
    name: typeof response.user.name === 'string'
      ? response.user.name
      : email,
    email: typeof response.user.email === 'string'
      ? response.user.email
      : email
  }
  const authentication: LaravelAuthentication = {
    version: 1,
    laravelUrl: normalizedUrl,
    accessToken: response.token,
    user
  }

  laravelAuthentication.value = authentication
  persistAuthentication(authentication)

  return user
}

async function performRefresh(): Promise<string> {
  const authentication = laravelAuthentication.value

  if (!authentication) {
    throw new LaravelAuthenticationRequiredError()
  }

  try {
    const response = await authenticationRequest<LaravelRefreshResponse>(
      authentication.laravelUrl,
      '/api/refresh',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authentication.accessToken}`
        }
      }
    )
    const accessToken = response.authorisation?.token

    if (!accessToken) {
      throw new Error('Laravel refresh response is incomplete.')
    }

    const refreshedAuthentication = {
      ...authentication,
      accessToken
    }

    laravelAuthentication.value = refreshedAuthentication
    persistAuthentication(refreshedAuthentication)

    return accessToken
  } catch {
    clearLaravelAuthentication()
    throw new LaravelAuthenticationRequiredError()
  }
}

export function refreshLaravelAccessToken(): Promise<string> {
  if (!pendingRefresh) {
    pendingRefresh = performRefresh().finally(() => {
      pendingRefresh = null
    })
  }

  return pendingRefresh
}

export async function logoutFromLaravel(): Promise<void> {
  const authentication = laravelAuthentication.value

  try {
    if (authentication) {
      await authenticationRequest(
        authentication.laravelUrl,
        '/api/logout',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authentication.accessToken}`
          }
        }
      )
    }
  } finally {
    clearLaravelAuthentication()
  }
}

export function clearLaravelAuthentication(): void {
  laravelAuthentication.value = null
  persistAuthentication(null)
}
