import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { DevelopmentHeaderAuthenticator } from '../src/auth.js'
import { InMemoryAuditSink, InMemoryTenantDatabase } from '../src/data.js'
import { DevelopmentObjectStorage } from '../src/storage.js'

const userId = '11111111-1111-4111-8111-111111111111'
const householdId = '22222222-2222-4222-8222-222222222222'
const spaceId = '33333333-3333-4333-8333-333333333333'
const digest = 'a'.repeat(64)

function createFixture(options?: { household?: boolean; space?: boolean }) {
  const database = new InMemoryTenantDatabase()
  if (options?.household !== false) database.grantHouseholdMember(userId, householdId)
  if (options?.space !== false) database.grantSpaceMember(userId, spaceId)
  const audit = new InMemoryAuditSink()
  const app = buildApp({
    authenticator: new DevelopmentHeaderAuthenticator(),
    database,
    objectStorage: new DevelopmentObjectStorage(),
    audit,
  })
  return { app, database, audit }
}

afterEach(() => { process.env.NODE_ENV = 'test' })

describe('asset upload intents', () => {
  it('rejects unauthenticated requests', async () => {
    const { app } = createFixture()
    const response = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', payload: {} })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects a user without household access', async () => {
    const { app } = createFixture({ household: false })
    const response = await app.inject({
      method: 'POST', url: '/v1/assets/upload-intents',
      headers: { 'x-development-user-id': userId },
      payload: { householdId, spaceId, assetType: 'photo', filename: 'family.jpg', mimeType: 'image/jpeg', byteSize: 123, contentSha256: digest },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'household_access_denied' })
    await app.close()
  })

  it('rejects a household member without explicit space access', async () => {
    const { app } = createFixture({ space: false })
    const response = await app.inject({
      method: 'POST', url: '/v1/assets/upload-intents',
      headers: { 'x-development-user-id': userId },
      payload: { householdId, spaceId, assetType: 'photo', filename: 'family.jpg', mimeType: 'image/jpeg', byteSize: 123, contentSha256: digest },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'space_access_denied' })
    await app.close()
  })

  it('creates a signed upload intent only after both grants succeed and writes audit evidence', async () => {
    const { app, database, audit } = createFixture()
    const response = await app.inject({
      method: 'POST', url: '/v1/assets/upload-intents',
      headers: { 'x-development-user-id': userId },
      payload: { householdId, spaceId, assetType: 'photo', filename: 'family.jpg', mimeType: 'image/jpeg', byteSize: 123, contentSha256: digest },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json() as { assetId: string; objectKey: string; requiredHeaders: Record<string, string> }
    expect(body.objectKey).toContain(`households/${householdId}/assets/${body.assetId}/original`)
    expect(body.requiredHeaders['x-content-sha256']).toBe(digest)
    expect(database.assets).toHaveLength(1)
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]?.resourceId).toBe(body.assetId)
    await app.close()
  })
})
