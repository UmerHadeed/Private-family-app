export interface AuditEventInput {
  householdId: string
  actorUserId: string
  action: 'create' | 'read' | 'update' | 'delete' | 'share' | 'revoke' | 'download' | 'export' | 'ai_process' | 'ai_propose' | 'ai_apply'
  resourceType: string
  resourceId?: string
  requestId: string
  metadata?: Record<string, unknown>
}

export interface AuditSink {
  write(event: AuditEventInput): Promise<void>
}

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEventInput[] = []

  async write(event: AuditEventInput): Promise<void> {
    this.events.push(event)
  }
}

/**
 * This is the seam for PostgreSQL RLS transactions. The production adapter must
 * execute `SET LOCAL app.user_id = $1` on the same transaction as the query.
 */
export interface TenantDatabase {
  withUser<T>(input: { userId: string; householdId: string }, operation: () => Promise<T>): Promise<T>
  isActiveHouseholdMember(input: { userId: string; householdId: string }): Promise<boolean>
  isActiveSpaceMember(input: { userId: string; spaceId: string }): Promise<boolean>
  registerPendingAsset(input: {
    assetId: string
    householdId: string
    spaceId: string
    uploadedByUserId: string
    assetType: string
    objectKey: string
    contentSha256: string
    filename: string
    mimeType: string
    byteSize: number
    mediaCreatedAt?: string
    capturedTimezone?: string
  }): Promise<void>
}

export class InMemoryTenantDatabase implements TenantDatabase {
  readonly assets: Array<Record<string, unknown>> = []
  private readonly householdMembers = new Set<string>()
  private readonly spaceMembers = new Set<string>()

  grantHouseholdMember(userId: string, householdId: string): void {
    this.householdMembers.add(`${userId}:${householdId}`)
  }

  grantSpaceMember(userId: string, spaceId: string): void {
    this.spaceMembers.add(`${userId}:${spaceId}`)
  }

  async withUser<T>(_input: { userId: string; householdId: string }, operation: () => Promise<T>): Promise<T> {
    return operation()
  }

  async isActiveHouseholdMember(input: { userId: string; householdId: string }): Promise<boolean> {
    return this.householdMembers.has(`${input.userId}:${input.householdId}`)
  }

  async isActiveSpaceMember(input: { userId: string; spaceId: string }): Promise<boolean> {
    return this.spaceMembers.has(`${input.userId}:${input.spaceId}`)
  }

  async registerPendingAsset(input: {
    assetId: string
    householdId: string
    spaceId: string
    uploadedByUserId: string
    assetType: string
    objectKey: string
    contentSha256: string
    filename: string
    mimeType: string
    byteSize: number
    mediaCreatedAt?: string
    capturedTimezone?: string
  }): Promise<void> {
    this.assets.push(input)
  }
}
