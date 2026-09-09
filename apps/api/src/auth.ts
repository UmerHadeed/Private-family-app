export interface AuthenticatedPrincipal {
  userId: string
  subject: string
}

export interface Authenticator {
  authenticate(request: { headers: Record<string, string | string[] | undefined> }): Promise<AuthenticatedPrincipal | null>
}

/**
 * Development-only adapter. It exists solely to exercise the API before the OIDC
 * provider is configured. It must never be enabled in staging or production.
 */
export class DevelopmentHeaderAuthenticator implements Authenticator {
  async authenticate(request: { headers: Record<string, string | string[] | undefined> }): Promise<AuthenticatedPrincipal | null> {
    if (process.env.NODE_ENV === 'production') return null
    const value = request.headers['x-development-user-id']
    const userId = Array.isArray(value) ? value[0] : value
    if (!userId || !isUuid(userId)) return null
    return { userId, subject: `development:${userId}` }
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
