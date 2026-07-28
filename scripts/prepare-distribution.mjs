import { cp, mkdir, writeFile } from 'node:fs/promises'

const projectRoot = new URL('../', import.meta.url)
const distributionDirectory = new URL('../dist/', import.meta.url)

const buildOutputs = [
  {
    source: new URL('packages/shared/dist/', projectRoot),
    destination: new URL('shared/', distributionDirectory)
  },
  {
    source: new URL('apps/web/dist/', projectRoot),
    destination: new URL('web/', distributionDirectory)
  },
  {
    source: new URL('apps/api/dist/', projectRoot),
    destination: new URL('api/', distributionDirectory)
  }
]

await mkdir(distributionDirectory, {
  recursive: true
})

for (const buildOutput of buildOutputs) {
  await cp(buildOutput.source, buildOutput.destination, {
    recursive: true
  })
}

// Use package self-reference for compiled @sql-builder/shared imports.
const distributionPackage = {
  name: '@sql-builder/shared',
  private: true,
  version: '0.1.0',
  type: 'module',
  exports: {
    '.': './shared/index.js'
  },
  scripts: {
    start: 'node start.mjs'
  },
  dependencies: {
    fastify: '5.10.0',
    mariadb: '3.5.3'
  },
  engines: {
    node: '>=20'
  }
}

await writeFile(
  new URL('package.json', distributionDirectory),
  `${JSON.stringify(distributionPackage, null, 2)}\n`
)

await writeFile(
  new URL('start.mjs', distributionDirectory),
  "import './api/production-main.js'\n"
)

await cp(
  new URL('.env.example', projectRoot),
  new URL('.env.example', distributionDirectory)
)
