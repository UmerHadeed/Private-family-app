import { randomUUID } from 'node:crypto'

export interface UploadIntent {
  assetId: string
  objectKey: string
  uploadUrl: string
  uploadExpiresAt: string
  requiredHeaders: Record<string, string>
}

export interface ObjectStorage {
  createUploadIntent(input: {
    householdId: string
    assetId: string
    contentSha256: string
    mimeType: string
  }): Promise<UploadIntent>
}

/** A local test adapter. Production must use private S3 signed URLs. */
export class DevelopmentObjectStorage implements ObjectStorage {
  async createUploadIntent(input: {
    householdId: string
    assetId: string
    contentSha256: string
    mimeType: string
  }): Promise<UploadIntent> {
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
    const objectKey = `households/${input.householdId}/assets/${input.assetId}/original`
    return {
      assetId: input.assetId,
      objectKey,
      uploadUrl: `https://development.invalid/uploads/${randomUUID()}`,
      uploadExpiresAt: expiresAt,
      requiredHeaders: {
        'content-type': input.mimeType,
        'x-content-sha256': input.contentSha256,
      },
    }
  }
}
