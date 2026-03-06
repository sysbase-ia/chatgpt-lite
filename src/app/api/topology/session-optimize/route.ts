import { NextResponse, type NextRequest } from 'next/server'
import {
  assertRequestHasAnyScope,
  getControlPlaneAuthorizationHeader,
  MissingKeycloakBearerTokenError,
  MissingKeycloakScopeError,
  parseScopeList,
  resolveRequestProfileAccess
} from '@/lib/control-plane-auth'
import { getAgentProfileMap, isAgentAllowedForProfiles } from '@/lib/profile-agent-map'

export const runtime = 'nodejs'

function readRequiredTopologyWriteScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_REQUIRED_TOPOLOGY_WRITE_SCOPES)
  if (configured.length > 0) {
    return configured
  }
  return ['topology.read']
}

function deriveSessionOptimizeURL(): string {
  const explicit = process.env.CONTROL_PLANE_TOPOLOGY_URL?.trim()
  if (explicit) {
    try {
      const u = new URL(explicit)
      u.pathname = '/topology/sessions/optimize'
      u.search = ''
      u.hash = ''
      return u.toString()
    } catch {
      // continue to fallback
    }
  }

  const fromChat =
    process.env.CONTROL_PLANE_CHAT_URL?.trim() || process.env.CONTROL_PLANE_CHAT_STREAM_URL?.trim()
  if (fromChat) {
    try {
      const u = new URL(fromChat)
      u.pathname = '/topology/sessions/optimize'
      u.search = ''
      u.hash = ''
      return u.toString()
    } catch {
      // continue to fallback
    }
  }

  return 'http://127.0.0.1:8080/topology/sessions/optimize'
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      action?: string
      sessionKey?: string
      key?: string
      agentId?: string
    }
    const action = String(body.action || '').trim().toLowerCase()
    const sessionKey = String(body.sessionKey || body.key || '').trim()
    const agentId = String(body.agentId || '').trim()
    if (!action || !['compact', 'cache', 'refresh'].includes(action)) {
      return NextResponse.json({ error: 'action must be compact, cache, or refresh' }, { status: 400 })
    }
    if (!sessionKey) {
      return NextResponse.json({ error: 'sessionKey is required' }, { status: 400 })
    }

    let authHeader: Record<string, string> | undefined
    try {
      await assertRequestHasAnyScope(req, readRequiredTopologyWriteScopes())
      const profileAccess = await resolveRequestProfileAccess(req)
      if (profileAccess.mode === 'denied') {
        return NextResponse.json(
          {
            error: 'missing required profile scope',
            requiredProfileScopes: ['profile.all', 'profile.<id>']
          },
          { status: 403 }
        )
      }
      if (profileAccess.mode === 'restricted') {
        if (!agentId) {
          return NextResponse.json(
            { error: 'agentId is required for restricted profile scope' },
            { status: 403 }
          )
        }
        const byAgent = await getAgentProfileMap()
        if (!isAgentAllowedForProfiles(agentId, profileAccess.allowedProfiles, byAgent)) {
          return NextResponse.json(
            {
              error: `agent ${agentId} is not allowed for this profile scope`,
              allowedProfiles: profileAccess.allowedProfiles
            },
            { status: 403 }
          )
        }
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
    const response = await fetch(deriveSessionOptimizeURL(), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        ...(authHeader || {})
      },
      body: JSON.stringify({ action, sessionKey, agentId })
    })

    const text = await response.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      parsed = { detail: text.slice(0, 500) }
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: parsed.error || `control-plane session optimize http ${response.status}`,
          detail: parsed.detail
        },
        { status: response.status }
      )
    }
    return NextResponse.json(parsed, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to optimize session' },
      { status: 500 }
    )
  }
}
