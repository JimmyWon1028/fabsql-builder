import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerStaticWebRoutes } from './static-web.js'

describe('static web routes', () => {
  let webRoot: string

  beforeEach(async () => {
    webRoot = await mkdtemp(join(tmpdir(), 'fabsql-static-web-'))
    await mkdir(join(webRoot, 'assets'))
    await writeFile(
      join(webRoot, 'index.html'),
      '<!doctype html><title>FabSQL Builder</title>'
    )
    await writeFile(
      join(webRoot, 'assets', 'application.css'),
      'body { color: black; }\n'
    )
  })

  afterEach(async () => {
    await rm(webRoot, {
      force: true,
      recursive: true
    })
  })

  it('serves the application index', async () => {
    const app = Fastify()
    registerStaticWebRoutes(app, webRoot)

    const response = await app.inject({
      method: 'GET',
      url: '/'
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.headers['cache-control']).toBe('no-cache')
    expect(response.body).toContain('FabSQL Builder')

    await app.close()
  })

  it('serves hashed assets with long-lived caching', async () => {
    const app = Fastify()
    registerStaticWebRoutes(app, webRoot)

    const response = await app.inject({
      method: 'GET',
      url: '/assets/application.css'
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/css')
    expect(response.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable'
    )

    await app.close()
  })

  it('falls back to the application index for client routes', async () => {
    const app = Fastify()
    registerStaticWebRoutes(app, webRoot)

    const response = await app.inject({
      method: 'GET',
      url: '/queries/example'
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('FabSQL Builder')

    await app.close()
  })

  it.each([
    '/api',
    '/api/missing'
  ])(
    'does not turn the %s route into an application page',
    async (url) => {
      const app = Fastify()
      registerStaticWebRoutes(app, webRoot)

      const response = await app.inject({
        method: 'GET',
        url
      })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({
        message: 'Route not found.'
      })

      await app.close()
    }
  )
})
