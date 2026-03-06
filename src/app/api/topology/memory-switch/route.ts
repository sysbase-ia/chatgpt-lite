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

function readRequiredTopologyWriteScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_REQUIRED_TOPOLOGY_WRITE_SCOPES)
  if (configured.length > 0) {
    return configured
  }
  return ['topology.read']
}

function deriveMemorySwitchURL(): string {
  const explicit = process.env.CONTROL_PLANE_TOPOLOGY_URL?.trim()
  if (explicit) {
    try {
      const u = new URL(explicit)
      u.pathname = '/topology/memory/switch'
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
      u.pathname = '/topology/memory/switch'
      u.search = ''
      u.hash = ''
      return u.toString()
    } catch {
      // continue to fallback
    }
  }

  return 'http://127.0.0.1:8080/topology/memory/switch'
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      backend?: string
    }
    const backend = String(body.backend || '')
      .trim()
      .toLowerCase()

    if (!['memory-lancedb', 'memory-core', 'none'].includes(backend)) {
      return NextResponse.json(
        { error: 'backend must be memory-lancedb, memory-core, or none' },
        { status: 400 }
      )
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
        return NextResponse.json(
          {
            error: 'memory backend switch is only allowed with global profile scope (profile.all)'
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
    const response = await fetch(deriveMemorySwitchURL(), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        ...(authHeader || {})
      },
      body: JSON.stringify({ backend })
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
          error: parsed.error || `control-plane memory switch http ${response.status}`,
          detail: parsed.detail
        },
        { status: response.status }
      )
    }
    return NextResponse.json(parsed, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to switch memory backend' },
      { status: 500 }
    )
  }
}
