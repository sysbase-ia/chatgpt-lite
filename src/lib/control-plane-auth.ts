import {
  readAccessTokenFromRequest,
  readRefreshTokenFromRequest,
  readSessionUserFromRequest
} from '@/lib/auth-session'

const TOKEN_REFRESH_SKEW_MS = 10_000

type TokenCache = {
  token: string
  expiresAtMs: number
}

export class MissingKeycloakBearerTokenError extends Error {
  constructor() {
    super('missing keycloak bearer token')
    this.name = 'MissingKeycloakBearerTokenError'
  }
}

export class MissingKeycloakScopeError extends Error {
  readonly requiredScopes: string[]
  readonly grantedScopes: string[]

  constructor(requiredScopes: string[], grantedScopes: string[]) {
    const normalizedRequired = requiredScopes.filter((value) => value.trim() !== '')
    super(
      normalizedRequired.length > 0
        ? `missing required scope (${normalizedRequired.join(', ')})`
        : 'missing required scope'
    )
    this.name = 'MissingKeycloakScopeError'
    this.requiredScopes = normalizedRequired
    this.grantedScopes = grantedScopes.filter((value) => value.trim() !== '')
  }
}

let cachedToken: TokenCache | undefined
let tokenRequestInFlight: Promise<string | undefined> | undefined

function readStaticBearerToken(): string {
  return process.env.CONTROL_PLANE_CHAT_TOKEN?.trim() || ''
}

function firstNonEmpty(...items: Array<string | undefined>): string {
  for (const item of items) {
    const value = String(item || '').trim()
    if (value) {
      return value
    }
  }
  return ''
}

function parseBool(raw: string | undefined): boolean {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function readStrictUserTokenMode(): boolean {
  return parseBool(process.env.WEB_CHAT_REQUIRE_KEYCLOAK_TOKEN)
}

function extractBearerToken(header: string | null | undefined): string {
  const raw = String(header || '').trim()
  if (!raw) {
    return ''
  }
  const match = raw.match(/^bearer\s+(.+)$/i)
  if (!match) {
    return ''
  }
  return String(match[1] || '').trim()
}

function normalizeScope(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function parseSpaceOrCommaScopes(raw: string): string[] {
  return String(raw || '')
    .split(/[\s,]+/)
    .map((item) => normalizeScope(item))
    .filter((item) => item !== '')
}

export function parseScopeList(raw: string | undefined): string[] {
  return Array.from(new Set(parseSpaceOrCommaScopes(String(raw || ''))))
}

export function hasAnyScope(grantedScopes: string[], requiredScopes: string[]): boolean {
  const required = Array.from(
    new Set(
      (requiredScopes || [])
        .map((value) => normalizeScope(value))
        .filter((value) => value !== '')
    )
  )
  if (required.length === 0) {
    return true
  }
  const grantedSet = new Set(
    (grantedScopes || [])
      .map((value) => normalizeScope(value))
      .filter((value) => value !== '')
  )
  for (const scope of required) {
    if (grantedSet.has(scope)) {
      return true
    }
  }
  return false
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const raw = String(token || '').trim()
  if (!raw) {
    return undefined
  }
  const parts = raw.split('.')
  if (parts.length < 2) {
    return undefined
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function decodeJwtExpirationMs(token: string): number | undefined {
  const payload = decodeJwtPayload(token) as { exp?: unknown } | undefined
  if (!payload) {
    return undefined
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return undefined
  }
  return Math.floor(payload.exp * 1000)
}

function isLikelyFreshJwt(token: string): boolean {
  const expMs = decodeJwtExpirationMs(token)
  if (!expMs) {
    return true
  }
  return Date.now() + TOKEN_REFRESH_SKEW_MS < expMs
}

function readClientCredentialsConfig(): {
  tokenURL: string
  clientID: string
  clientSecret: string
  scope: string
} {
  return {
    tokenURL: process.env.CONTROL_PLANE_AUTH_TOKEN_URL?.trim() || '',
    clientID: process.env.CONTROL_PLANE_AUTH_CLIENT_ID?.trim() || '',
    clientSecret: process.env.CONTROL_PLANE_AUTH_CLIENT_SECRET?.trim() || '',
    scope: process.env.CONTROL_PLANE_AUTH_SCOPE?.trim() || ''
  }
}

function readPasswordGrantConfig(): {
  tokenURL: string
  clientID: string
  clientSecret: string
  scope: string
} {
  return {
    tokenURL: firstNonEmpty(
      process.env.WEB_CHAT_KEYCLOAK_LOGIN_TOKEN_URL,
      process.env.CONTROL_PLANE_AUTH_TOKEN_URL
    ),
    clientID: firstNonEmpty(
      process.env.WEB_CHAT_KEYCLOAK_LOGIN_CLIENT_ID,
      process.env.CONTROL_PLANE_AUTH_CLIENT_ID
    ),
    clientSecret: firstNonEmpty(
      process.env.WEB_CHAT_KEYCLOAK_LOGIN_CLIENT_SECRET,
      process.env.CONTROL_PLANE_AUTH_CLIENT_SECRET
    ),
    scope: process.env.WEB_CHAT_KEYCLOAK_LOGIN_SCOPE?.trim() || ''
  }
}

function readCachedToken(): string | undefined {
  if (!cachedToken) return undefined
  if (Date.now() >= cachedToken.expiresAtMs-TOKEN_REFRESH_SKEW_MS) return undefined
  return cachedToken.token
}

async function requestClientCredentialsToken(): Promise<string | undefined> {
  const { tokenURL, clientID, clientSecret, scope } = readClientCredentialsConfig()
  if (!tokenURL || !clientID || !clientSecret) {
    return undefined
  }

  const body = new URLSearchParams()
  body.set('grant_type', 'client_credentials')
  body.set('client_id', clientID)
  body.set('client_secret', clientSecret)
  if (scope) {
    body.set('scope', scope)
  }

  const response = await fetch(tokenURL, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body: body.toString()
  })

  const text = await response.text()
  let parsed: Record<string, unknown> = {}
  if (text.trim()) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      parsed = { detail: text.slice(0, 500) }
    }
  }

  if (!response.ok) {
    const detail =
      typeof parsed.error === 'string' && parsed.error.trim()
        ? parsed.error.trim()
        : `control-plane auth token http ${response.status}`
    throw new Error(detail)
  }

  const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : ''
  if (!accessToken) {
    throw new Error('control-plane auth token response missing access_token')
  }

  const expiresInRaw = parsed.expires_in
  const expiresIn =
    typeof expiresInRaw === 'number' && Number.isFinite(expiresInRaw)
      ? Math.max(30, Math.floor(expiresInRaw))
      : 300

  cachedToken = {
    token: accessToken,
    expiresAtMs: Date.now() + expiresIn * 1000
  }
  return accessToken
}

async function getClientCredentialsToken(): Promise<string | undefined> {
  const cached = readCachedToken()
  if (cached) {
    return cached
  }
  if (!tokenRequestInFlight) {
    tokenRequestInFlight = requestClientCredentialsToken().finally(() => {
      tokenRequestInFlight = undefined
    })
  }
  return tokenRequestInFlight
}

async function requestRefreshToken(refreshToken: string): Promise<string | undefined> {
  const { tokenURL, clientID, clientSecret, scope } = readPasswordGrantConfig()
  if (!tokenURL || !clientID || !clientSecret) {
    return undefined
  }

  const form = new URLSearchParams()
  form.set('grant_type', 'refresh_token')
  form.set('client_id', clientID)
  form.set('client_secret', clientSecret)
  form.set('refresh_token', refreshToken)
  if (scope) {
    form.set('scope', scope)
  }

  const response = await fetch(tokenURL, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body: form.toString()
  })
  if (!response.ok) {
    return undefined
  }
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string
  }
  const accessToken = String(payload.access_token || '').trim()
  if (!accessToken) {
    return undefined
  }
  return accessToken
}

function appendScopes(out: Set<string>, claim: unknown): void {
  if (!claim) {
    return
  }
  if (typeof claim === 'string') {
    for (const scope of parseSpaceOrCommaScopes(claim)) {
      out.add(scope)
    }
    return
  }
  if (Array.isArray(claim)) {
    for (const item of claim) {
      if (typeof item !== 'string') {
        continue
      }
      const normalized = normalizeScope(item)
      if (normalized) {
        out.add(normalized)
      }
    }
  }
}

function readScopesFromJwt(token: string): string[] {
  const payload = decodeJwtPayload(token)
  if (!payload) {
    return []
  }
  const scopes = new Set<string>()
  appendScopes(scopes, payload.scope)
  appendScopes(scopes, payload.scp)
  appendScopes(scopes, payload.scopes)

  if (payload.realm_access && typeof payload.realm_access === 'object') {
    const realm = payload.realm_access as Record<string, unknown>
    appendScopes(scopes, realm.roles)
  }
  if (payload.resource_access && typeof payload.resource_access === 'object') {
    const resourceAccess = payload.resource_access as Record<string, unknown>
    for (const client of Object.values(resourceAccess)) {
      if (!client || typeof client !== 'object') {
        continue
      }
      appendScopes(scopes, (client as Record<string, unknown>).roles)
    }
  }

  return Array.from(scopes)
}

async function getUserAccessToken(req?: Pick<Request, 'headers'>): Promise<string | undefined> {
  const requestBearerToken = extractBearerToken(req?.headers?.get('authorization'))
  if (requestBearerToken) {
    return requestBearerToken
  }

  const cookieAccessToken = readAccessTokenFromRequest(req)
  const refreshToken = readRefreshTokenFromRequest(req)
  if (cookieAccessToken) {
    if (isLikelyFreshJwt(cookieAccessToken)) {
      return cookieAccessToken
    }
    if (refreshToken) {
      const refreshedAccessToken = await requestRefreshToken(refreshToken)
      if (refreshedAccessToken) {
        return refreshedAccessToken
      }
    }
    return cookieAccessToken
  }

  if (refreshToken) {
    const refreshedAccessToken = await requestRefreshToken(refreshToken)
    if (refreshedAccessToken) {
      return refreshedAccessToken
    }
  }

  return undefined
}

export async function getRequestGrantedScopes(
  req?: Pick<Request, 'headers'>
): Promise<{ hasUserToken: boolean; grantedScopes: string[] }> {
  const userToken = await getUserAccessToken(req)
  if (!userToken) {
    return { hasUserToken: false, grantedScopes: [] }
  }
  return { hasUserToken: true, grantedScopes: readScopesFromJwt(userToken) }
}

type ProfileScopeMode = 'off' | 'optional' | 'strict'

export type RequestProfileAccess = {
  mode: 'all' | 'restricted' | 'denied'
  allowedProfiles: string[]
  grantedScopes: string[]
  hasUserToken: boolean
}

function readProfileScopeMode(): ProfileScopeMode {
  const value = String(process.env.WEB_CHAT_PROFILE_SCOPE_MODE || 'optional')
    .trim()
    .toLowerCase()
  if (value === 'off') {
    return 'off'
  }
  if (value === 'strict') {
    return 'strict'
  }
  return 'optional'
}

function readProfileScopePrefix(): string {
  const raw = String(process.env.WEB_CHAT_PROFILE_SCOPE_PREFIX || 'profile.').trim().toLowerCase()
  return raw || 'profile.'
}

function readProfileAllScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_PROFILE_ALL_SCOPES)
  if (configured.length > 0) {
    return configured
  }
  return ['profile.all', 'profile.*']
}

function readProfileSelfScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_PROFILE_SELF_SCOPES)
  if (configured.length > 0) {
    return configured
  }
  return ['profile.self']
}

function normalizeProfileID(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

export async function resolveRequestProfileAccess(
  req?: Pick<Request, 'headers'>
): Promise<RequestProfileAccess> {
  const { hasUserToken, grantedScopes } = await getRequestGrantedScopes(req)
  const normalizedScopes = grantedScopes.map((value) => normalizeScope(value))
  const scopeMode = readProfileScopeMode()
  if (scopeMode === 'off') {
    return {
      mode: 'all',
      allowedProfiles: [],
      grantedScopes: normalizedScopes,
      hasUserToken
    }
  }

  const allScopes = new Set(readProfileAllScopes())
  const selfScopes = new Set(readProfileSelfScopes())
  const profilePrefix = readProfileScopePrefix()
  const sessionUser = normalizeProfileID(readSessionUserFromRequest(req))

  let hasProfileScopedGrant = false
  let hasAllProfiles = false
  const allowedProfiles = new Set<string>()

  for (const scope of normalizedScopes) {
    if (allScopes.has(scope)) {
      hasProfileScopedGrant = true
      hasAllProfiles = true
      continue
    }
    if (selfScopes.has(scope)) {
      hasProfileScopedGrant = true
      if (sessionUser) {
        allowedProfiles.add(sessionUser)
      }
      continue
    }
    if (!scope.startsWith(profilePrefix)) {
      continue
    }
    hasProfileScopedGrant = true
    const suffix = normalizeProfileID(scope.slice(profilePrefix.length))
    if (!suffix) {
      continue
    }
    if (suffix === '*' || suffix === 'all') {
      hasAllProfiles = true
      continue
    }
    if (suffix === 'self') {
      if (sessionUser) {
        allowedProfiles.add(sessionUser)
      }
      continue
    }
    allowedProfiles.add(suffix)
  }

  if (scopeMode === 'optional' && !hasProfileScopedGrant) {
    return {
      mode: 'all',
      allowedProfiles: [],
      grantedScopes: normalizedScopes,
      hasUserToken
    }
  }

  if (hasAllProfiles) {
    return {
      mode: 'all',
      allowedProfiles: [],
      grantedScopes: normalizedScopes,
      hasUserToken
    }
  }

  const profileList = Array.from(allowedProfiles).sort()
  if (profileList.length > 0) {
    return {
      mode: 'restricted',
      allowedProfiles: profileList,
      grantedScopes: normalizedScopes,
      hasUserToken
    }
  }

  return {
    mode: 'denied',
    allowedProfiles: [],
    grantedScopes: normalizedScopes,
    hasUserToken
  }
}

export async function assertRequestHasAnyScope(
  req: Pick<Request, 'headers'> | undefined,
  requiredScopesRaw: string[]
): Promise<void> {
  const requiredScopes = Array.from(
    new Set(
      (requiredScopesRaw || [])
        .map((value) => normalizeScope(value))
        .filter((value) => value !== '')
    )
  )
  if (requiredScopes.length === 0) {
    return
  }

  const userToken = await getUserAccessToken(req)
  if (!userToken) {
    if (readStrictUserTokenMode()) {
      throw new MissingKeycloakBearerTokenError()
    }
    return
  }

  const grantedScopes = readScopesFromJwt(userToken)
  if (grantedScopes.some((scope) => requiredScopes.includes(scope))) {
    return
  }
  throw new MissingKeycloakScopeError(requiredScopes, grantedScopes)
}

export async function getControlPlaneAuthorizationHeader(
  req?: Pick<Request, 'headers'>
): Promise<Record<string, string> | undefined> {
  const userToken = await getUserAccessToken(req)
  if (userToken) {
    return { Authorization: `Bearer ${userToken}` }
  }

  if (readStrictUserTokenMode()) {
    throw new MissingKeycloakBearerTokenError()
  }

  const staticToken = readStaticBearerToken()
  if (staticToken) {
    return { Authorization: `Bearer ${staticToken}` }
  }

  const clientToken = await getClientCredentialsToken()
  if (clientToken) {
    return { Authorization: `Bearer ${clientToken}` }
  }
  return undefined
}
