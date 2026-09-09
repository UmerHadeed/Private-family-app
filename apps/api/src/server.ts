import { buildApp } from './app.js'
import { DevelopmentHeaderAuthenticator } from './auth.js'
import { InMemoryAuditSink, InMemoryTenantDatabase } from './data.js'
import { DevelopmentObjectStorage } from './storage.js'

const database = new InMemoryTenantDatabase()
const app = buildApp({
  authenticator: new DevelopmentHeaderAuthenticator(),
  database,
  objectStorage: new DevelopmentObjectStorage(),
  audit: new InMemoryAuditSink(),
})

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '127.0.0.1'

await app.listen({ port, host })
