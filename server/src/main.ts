import { buildApp } from './app.js'
import { ensureBootstrapUser } from './bootstrap.js'
import { createRuntime } from './runtime.js'

const runtime = await createRuntime()
await ensureBootstrapUser(runtime.store, runtime.config.bootstrap)
const app = buildApp({ store: runtime.store, config: runtime.config.app, mediaStorage: runtime.mediaStorage, integrations: runtime.config.integrations })
await app.ready()
runtime.publicationScheduler.start()

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  await runtime.publicationScheduler.stop()
  await app.close()
  process.exit(0)
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

try {
  await app.listen({ host: runtime.config.host, port: runtime.config.port })
} catch (error) {
  await runtime.publicationScheduler.stop()
  await app.close()
  throw error
}
