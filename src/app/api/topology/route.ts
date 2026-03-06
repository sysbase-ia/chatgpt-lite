import { NextResponse, type NextRequest } from 'next/server'
import {
  assertRequestHasAnyScope,
  getControlPlaneAuthorizationHeader,
  MissingKeycloakBearerTokenError,
  MissingKeycloakScopeError,
  parseScopeList,
  resolveRequestProfileAccess
} from '@/lib/control-plane-auth'

export const runtime = 'nodejs'

function readRequiredTopologyReadScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_REQUIRED_TOPOLOGY_READ_SCOPES)
  if (configured.length > 0) {
    return configured
  }
  return ['topology.read']
}

function deriveTopologyURL(): string {
  const explicit = process.env.CONTROL_PLANE_TOPOLOGY_URL?.trim()
  if (explicit) {
    return explicit
  }
  const fromChat =
    process.env.CONTROL_PLANE_CHAT_URL?.trim() || process.env.CONTROL_PLANE_CHAT_STREAM_URL?.trim()
  if (fromChat) {
    try {
      const u = new URL(fromChat)
      u.pathname = '/topology'
      u.search = ''
      u.hash = ''
      return u.toString()
    } catch {
      // continue to fallback
    }
  }
  return 'http://127.0.0.1:8080/topology'
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 0
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
  }
  return false
}

function normalizeProfileID(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
}

function normalizeAgentID(raw: unknown): string {
  return String(raw || '').trim()
}

function filterTopologyPayloadByProfiles(
  payload: Record<string, unknown>,
  allowedProfilesRaw: string[]
): Record<string, unknown> {
  const allowedProfiles = new Set(
    (allowedProfilesRaw || [])
      .map((value) => normalizeProfileID(value))
      .filter((value) => value !== '')
  )

  const rawAgents = Array.isArray(payload.agents) ? payload.agents : []
  const filteredAgents = rawAgents.filter((item) => {
    if (!item || typeof item !== 'object') {
      return false
    }
    const profile = normalizeProfileID((item as Record<string, unknown>).profile)
    return profile !== '' && allowedProfiles.has(profile)
  }) as Array<Record<string, unknown>>

  const agentProfileByID = new Map<string, string>()
  for (const agent of filteredAgents) {
    const id = normalizeAgentID(agent.id)
    const profile = normalizeProfileID(agent.profile)
    if (id && profile) {
      agentProfileByID.set(id, profile)
    }
  }

  const rawSessions = Array.isArray(payload.sessions) ? payload.sessions : []
  const filteredSessions = rawSessions.filter((item) => {
    if (!item || typeof item !== 'object') {
      return false
    }
    const agentID = normalizeAgentID((item as Record<string, unknown>).agentId)
    return agentID !== '' && agentProfileByID.has(agentID)
  }) as Array<Record<string, unknown>>

  const profileStats = new Map<
    string,
    { agentIDs: Set<string>; activeAgents: number; activeSessions: number }
  >()
  for (const agent of filteredAgents) {
    const profile = normalizeProfileID(agent.profile)
    const agentID = normalizeAgentID(agent.id)
    if (!profile || !agentID) {
      continue
    }
    const entry = profileStats.get(profile) || {
      agentIDs: new Set<string>(),
      activeAgents: 0,
      activeSessions: 0
    }
    entry.agentIDs.add(agentID)
    if (toBool(agent.active)) {
      entry.activeAgents += 1
    }
    profileStats.set(profile, entry)
  }
  for (const session of filteredSessions) {
    const agentID = normalizeAgentID(session.agentId)
    const profile = agentProfileByID.get(agentID)
    if (!profile) {
      continue
    }
    const entry = profileStats.get(profile)
    if (!entry) {
      continue
    }
    entry.activeSessions += 1
  }

  const rawProfiles = Array.isArray(payload.profiles) ? payload.profiles : []
  const originalProfiles = new Map<string, Record<string, unknown>>()
  for (const item of rawProfiles) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const profileID = normalizeProfileID((item as Record<string, unknown>).id)
    if (profileID) {
      originalProfiles.set(profileID, item as Record<string, unknown>)
    }
  }
  const filteredProfiles = Array.from(profileStats.keys())
    .sort()
    .map((profileID) => {
      const original = originalProfiles.get(profileID) || {}
      const stats = profileStats.get(profileID)!
      return {
        ...original,
        id: profileID,
        agentCount: stats.agentIDs.size,
        activeAgents: stats.activeAgents,
        activeSessions: stats.activeSessions,
        agentIds: Array.from(stats.agentIDs).sort()
      }
    })

  const summaryRaw =
    payload.summary && typeof payload.summary === 'object'
      ? (payload.summary as Record<string, unknown>)
      : {}
  const filteredSummary: Record<string, unknown> = {
    ...summaryRaw,
    profiles: filteredProfiles.length,
    agents: filteredAgents.length,
    activeAgents: filteredAgents.filter((item) => toBool(item.active)).length,
    activeSessions: filteredSessions.length,
    inputTokens: filteredAgents.reduce((sum, item) => sum + toNumber(item.inputTokens), 0),
    outputTokens: filteredAgents.reduce((sum, item) => sum + toNumber(item.outputTokens), 0),
    totalTokens: filteredAgents.reduce((sum, item) => sum + toNumber(item.totalTokens), 0),
    cacheReadTokens: filteredAgents.reduce((sum, item) => sum + toNumber(item.cacheReadTokens), 0),
    cacheWriteTokens: filteredAgents.reduce((sum, item) => sum + toNumber(item.cacheWriteTokens), 0),
    highLoadSessions: filteredSessions.filter((item) => toBool(item.highLoad)).length
  }

  return {
    ...payload,
    summary: filteredSummary,
    profiles: filteredProfiles,
    agents: filteredAgents,
    sessions: filteredSessions
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const target = new URL(deriveTopologyURL())
    const activeMinutesRaw = req.nextUrl.searchParams.get('activeMinutes')?.trim() || ''
    if (activeMinutesRaw) {
      target.searchParams.set('activeMinutes', activeMinutesRaw)
    }

    const profileAccess = await resolveRequestProfileAccess(req)
    let authHeader: Record<string, string> | undefined
    try {
      await assertRequestHasAnyScope(req, readRequiredTopologyReadScopes())
      if (profileAccess.mode === 'denied') {
        return NextResponse.json(
          {
            error: 'missing required profile scope',
            requiredProfileScopes: ['profile.all', 'profile.<id>']
          },
          { status: 403 }
        )
      }
      authHeader = await getControlPlaneAuthorizationHeader(req)
    } catch (error) {
      if (error instanceof MissingKeycloakBearerTokenError) {
        return NextResponse.json({ error: 'missing keycloak bearer token' }, { status: 401 })
      }
      if (error instanceof MissingKeycloakScopeError) {
        return NextResponse.json(
          {
            error: error.message,
            requiredScopes: error.requiredScopes,
            grantedScopes: error.grantedScopes
          },
          { status: 403 }
        )
      }
      throw error
    }
    const response = await fetch(target.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: authHeader
    })

    const text = await response.text()
    if (!response.ok) {
      return NextResponse.json(
        {
          error: `control-plane topology http ${response.status}`,
          detail: text.slice(0, 500)
        },
        { status: response.status }
      )
    }

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (profileAccess.mode === 'restricted') {
        return NextResponse.json(
          filterTopologyPayloadByProfiles(parsed, profileAccess.allowedProfiles),
          { status: 200 }
        )
      }
      return NextResponse.json(parsed, { status: 200 })
    } catch {
      return NextResponse.json({ error: 'Invalid topology JSON from control-plane' }, { status: 502 })
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch topology' },
      { status: 500 }
    )
  }
}
