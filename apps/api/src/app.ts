import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import { z } from 'zod'
import type { Authenticator } from './auth.js'
import type { AuditSink, TenantDatabase } from './data.js'
import type { ObjectStorage } from './storage.js'

const uuid = z.string().uuid()
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, 'contentSha256 must be a SHA-256 hex digest')
const uploadRequestSchema = z.object({
  householdId: uuid,
  spaceId: uuid,
  assetType: z.enum(['photo', 'video', 'audio', 'document', 'note']),
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  byteSize: z.number().int().nonnegative().max(10 * 1024 * 1024 * 1024),
  contentSha256: sha256,
  mediaCreatedAt: z.string().datetime().optional(),
  capturedTimezone: z.string().min(1).max(100).optional(),
})

export interface AppDependencies {
  authenticator: Authenticator
  database: TenantDatabase
  objectStorage: ObjectStorage
  audit: AuditSink
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: true, genReqId: () => randomUUID() })
  void app.register(helmet, { contentSecurityPolicy: false })

  app.get('/healthz', async () => ({ status: 'ok' }))
  app.get('/readyz', async () => ({ status: 'ready', dependencies: ['auth', 'database', 'object-storage', 'audit'] }))

  app.post('/v1/assets/upload-intents', async (request, reply) => {
    const principal = await dependencies.authenticator.authenticate({ headers: request.headers })
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' })

    const parsed = uploadRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    const input = parsed.data

    const householdMember = await dependencies.database.isActiveHouseholdMember({ userId: principal.userId, householdId: input.householdId })
    if (!householdMember) return reply.code(403).send({ error: 'household_access_denied' })

    const spaceMember = await dependencies.database.isActiveSpaceMember({ userId: principal.userId, spaceId: input.spaceId })
    if (!spaceMember) return reply.code(403).send({ error: 'space_access_denied' })

    return dependencies.database.withUser({ userId: principal.userId, householdId: input.householdId }, async () => {
      const assetId = randomUUID()
      const intent = await dependencies.objectStorage.createUploadIntent({
        householdId: input.householdId,
        assetId,
        contentSha256: input.contentSha256.toLowerCase(),
        mimeType: input.mimeType,
      })

      await dependencies.database.registerPendingAsset({
        assetId,
        householdId: input.householdId,
        spaceId: input.spaceId,
        uploadedByUserId: principal.userId,
        assetType: input.assetType,
        objectKey: intent.objectKey,
        contentSha256: input.contentSha256.toLowerCase(),
        filename: input.filename,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        ...(input.mediaCreatedAt ? { mediaCreatedAt: input.mediaCreatedAt } : {}),
        ...(input.capturedTimezone ? { capturedTimezone: input.capturedTimezone } : {}),
      })

      await dependencies.audit.write({
        householdId: input.householdId,
        actorUserId: principal.userId,
        action: 'create',
        resourceType: 'asset_upload_intent',
        resourceId: assetId,
        requestId: request.id,
        metadata: { assetType: input.assetType, spaceId: input.spaceId, byteSize: input.byteSize },
      })

      return reply.code(201).send(intent)
    })
  })

  return app
}
