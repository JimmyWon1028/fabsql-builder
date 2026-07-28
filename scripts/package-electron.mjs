import { execFile } from 'node:child_process'
import {
  mkdir,
  readFile,
  rm
} from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { packager } from '@electron/packager'

const executeFile = promisify(execFile)
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const outputDirectory = path.join(projectRoot, 'out')
const makeDirectory = path.join(outputDirectory, 'make')
const packageMetadata = JSON.parse(
  await readFile(
    path.join(projectRoot, 'package.json'),
    'utf8'
  )
)
const applicationName = packageMetadata.productName
const applicationVersion = packageMetadata.version
const electronVersion = packageMetadata.devDependencies.electron
const shouldMakeDistributables = process.argv.includes('--make')
const requestedWindowsArchitectures = [
  ['--windows-arm64', 'arm64'],
  ['--windows-x64', 'x64']
].filter(([argument]) => process.argv.includes(argument))

if (requestedWindowsArchitectures.length > 1) {
  throw new Error('Only one Windows architecture can be packaged at a time.')
}

const targetPlatform = requestedWindowsArchitectures.length > 0
  ? 'win32'
  : 'darwin'
const targetArchitecture = requestedWindowsArchitectures[0]?.[1] ?? 'arm64'
const targetName = `${targetPlatform}-${targetArchitecture}`
const targetOutputDirectory = path.join(
  outputDirectory,
  `${applicationName}-${targetName}`
)

function ignoreApplicationFile(filePath) {
  const relativePath = filePath.startsWith(projectRoot)
    ? path.relative(projectRoot, filePath)
    : filePath.replace(/^[/\\]+/, '')

  if (!relativePath || relativePath.startsWith('..')) {
    return false
  }

  const topLevelPath = relativePath.split(path.sep)[0]

  return topLevelPath !== 'desktop'
    && topLevelPath !== 'package.json'
}

await rm(targetOutputDirectory, {
  force: true,
  recursive: true
})

const packagedApplications = await packager({
  ...(targetPlatform === 'darwin'
    ? {
        appBundleId: 'com.fabsql.builder',
        appCategoryType: 'public.app-category.developer-tools'
      }
    : {
        win32metadata: {
          FileDescription: applicationName,
          InternalName: applicationName,
          OriginalFilename: `${applicationName}.exe`,
          ProductName: applicationName,
          'requested-execution-level': 'asInvoker'
        }
      }),
  arch: targetArchitecture,
  asar: true,
  dir: projectRoot,
  electronVersion,
  executableName: applicationName,
  extraResource: [
    path.join(projectRoot, 'dist')
  ],
  ignore: ignoreApplicationFile,
  name: applicationName,
  out: outputDirectory,
  overwrite: true,
  platform: targetPlatform,
  prune: false
})

if (packagedApplications.length !== 1) {
  throw new Error(
    `Expected one packaged application, received ${packagedApplications.length}.`
  )
}

const packagedApplicationDirectory = packagedApplications[0]
const packagedApplication = targetPlatform === 'darwin'
  ? path.join(
      packagedApplicationDirectory,
      `${applicationName}.app`
    )
  : path.join(
      packagedApplicationDirectory,
      `${applicationName}.exe`
    )

if (targetPlatform === 'darwin') {
  await executeFile('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    packagedApplication
  ])
}

console.log(`Packaged application: ${packagedApplication}`)

if (shouldMakeDistributables) {
  await mkdir(makeDirectory, {
    recursive: true
  })

  const artifactBaseName = [
    applicationName.replaceAll(' ', '-'),
    applicationVersion,
    targetName
  ].join('-')
  const zipPath = path.join(
    makeDirectory,
    `${artifactBaseName}.zip`
  )

  await rm(zipPath, {
    force: true
  })

  if (targetPlatform === 'darwin') {
    const dmgPath = path.join(
      makeDirectory,
      `${artifactBaseName}.dmg`
    )

    await rm(dmgPath, {
      force: true
    })
    await executeFile('ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      packagedApplication,
      zipPath
    ])
    await executeFile('hdiutil', [
      'create',
      '-volname',
      applicationName,
      '-srcfolder',
      packagedApplication,
      '-ov',
      '-format',
      'ULFO',
      dmgPath
    ])

    console.log(`DMG distributable: ${dmgPath}`)
  } else {
    await executeFile(
      'zip',
      [
        '-q',
        '-r',
        zipPath,
        path.basename(packagedApplicationDirectory)
      ],
      {
        cwd: outputDirectory
      }
    )
  }

  console.log(`ZIP distributable: ${zipPath}`)
}
