/**
 * Server entry point — creates the Express app and starts listening.
 *
 * Reads configuration from environment variables and logs the
 * listening port and auth status on startup.
 */

import { createApp } from "./app.js"
import { loadConfig } from "./config.js"

const config = loadConfig()
const app = createApp(config)

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`@debriefer/server listening on port ${config.port}`)
  if (config.authEnabled) {
    // eslint-disable-next-line no-console
    console.log(`Auth enabled (${config.apiKeys.length} API key(s) configured)`)
  } else {
    // eslint-disable-next-line no-console
    console.log("Auth disabled (no DEBRIEFER_API_KEYS set)")
  }
})
