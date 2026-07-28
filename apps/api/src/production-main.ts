import { fileURLToPath } from 'node:url'

import {
  createProductionApplication
} from './production-application.js'

const webRoot = fileURLToPath(new URL('../web/', import.meta.url))
const {
  app,
  listenOptions
} = await createProductionApplication(webRoot)

try {
  await app.listen(listenOptions)
} catch (error) {
  app.log.error(error)
  await app.close()
  process.exitCode = 1
}
