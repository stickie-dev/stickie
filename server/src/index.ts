import { configuredPort } from './config.js'
import { startServer } from './serve.js'

// the command line's server: everything is in serve.ts, which the desktop app
// starts too; this only reads what the environment asks for
try {
  const running = await startServer({
    port: configuredPort(),
    hostname: process.env.STICKIE_HOST ?? '127.0.0.1',
    ...(process.env.STICKIE_ADD_REPO === undefined
      ? {}
      : { addRepo: process.env.STICKIE_ADD_REPO }),
  })
  console.log(`stickie server on ${running.url}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
