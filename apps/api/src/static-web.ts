import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

import type { FastifyInstance, FastifyReply } from 'fastify'

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
])

function resolveWebFile(
  webRoot: string,
  pathname: string
): string | undefined {
  let decodedPathname: string

  try {
    decodedPathname = decodeURIComponent(pathname)
  } catch {
    return undefined
  }

  const relativePath = decodedPathname.replace(/^\/+/, '')
  const filePath = resolve(webRoot, relativePath)
  const normalizedRoot = resolve(webRoot)

  if (
    filePath !== normalizedRoot
    && !filePath.startsWith(`${normalizedRoot}${sep}`)
  ) {
    return undefined
  }

  return filePath
}

async function sendFile(
  reply: FastifyReply,
  filePath: string,
  cacheControl: string
): Promise<FastifyReply> {
  const contentType = contentTypes.get(extname(filePath).toLowerCase())
    ?? 'application/octet-stream'
  const content = await readFile(filePath)

  return reply
    .header('Cache-Control', cacheControl)
    .type(contentType)
    .send(content)
}

export function registerStaticWebRoutes(
  app: FastifyInstance,
  webRoot: string
): void {
  app.get('/*', async (request, reply) => {
    const requestUrl = new URL(
      request.raw.url ?? '/',
      'http://127.0.0.1'
    )
    const pathname = requestUrl.pathname

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return reply.code(404).send({
        message: 'Route not found.'
      })
    }

    const filePath = resolveWebFile(webRoot, pathname)

    if (!filePath) {
      return reply.code(400).send({
        message: 'Invalid path.'
      })
    }

    if (pathname !== '/') {
      try {
        return await sendFile(
          reply,
          filePath,
          pathname.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache'
        )
      } catch (error) {
        const errorCode = (error as NodeJS.ErrnoException).code

        if (errorCode !== 'ENOENT' && errorCode !== 'EISDIR') {
          throw error
        }
      }
    }

    return sendFile(
      reply,
      resolve(webRoot, 'index.html'),
      'no-cache'
    )
  })
}
