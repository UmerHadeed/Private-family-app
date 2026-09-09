export type UUID = string

export type SpaceType = 'private_vault' | 'family' | 'profile' | 'custom_shared'
export type SpaceRole = 'owner' | 'editor' | 'viewer'
export type AgentStatus = 'draft' | 'active' | 'paused' | 'archived'
export type SourceCapability = 'read_metadata' | 'read_original' | 'create_proposal' | 'create_reminder'
export type AssetType = 'photo' | 'video' | 'audio' | 'document' | 'note'

export interface RequestContext {
  requestId: UUID
  userId: UUID
  householdId: UUID
  deviceId?: UUID
}

export interface CreateHouseholdRequest {
  name: string
}

export interface CreateProfileRequest {
  householdId: UUID
  profileType: 'adult' | 'child' | 'dependent'
  displayName: string
  birthDate?: string
}

export interface CreateAgentRequest {
  householdId: UUID
  name: string
  purpose: string
  modelRoute: string
  scopeGrants: Array<{
    spaceId?: UUID
    profileId?: UUID
    capabilities: SourceCapability[]
  }>
}

export interface CreateAssetUploadRequest {
  householdId: UUID
  spaceId: UUID
  assetType: AssetType
  filename: string
  mimeType: string
  byteSize: number
  contentSha256: string
  mediaCreatedAt?: string
  capturedTimezone?: string
}

export interface CreateAssetUploadResponse {
  assetId: UUID
  objectKey: string
  uploadUrl: string
  uploadExpiresAt: string
  requiredHeaders: Record<string, string>
}

export interface CompleteAssetUploadRequest {
  assetId: UUID
  objectETag: string
}

export interface AIProposal {
  id: UUID
  assetId?: UUID
  agentId: UUID
  type: 'person_tag' | 'memory' | 'timeline' | 'reminder' | 'caption' | 'filing'
  payload: Record<string, unknown>
  confidence?: number
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'auto_applied'
  provenance: {
    sourceAssetIds: UUID[]
    modelIdentifier: string
    modelVersion?: string
    createdAt: string
  }
}

/**
 * Agents receive this server-created envelope, never a broad household dump.
 * The worker verifies every scope again before fetching an object or derived record.
 */
export interface AgentExecutionEnvelope {
  requestId: UUID
  agentId: UUID
  householdId: UUID
  allowedSpaceIds: UUID[]
  allowedProfileIds: UUID[]
  capabilities: SourceCapability[]
  assetIds: UUID[]
  action: 'derive_metadata' | 'propose_filing' | 'answer_question'
}
