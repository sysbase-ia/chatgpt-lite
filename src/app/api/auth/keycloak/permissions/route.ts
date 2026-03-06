import { NextResponse, type NextRequest } from 'next/server'
import {
  getRequestGrantedScopes,
  hasAnyScope,
  parseScopeList,
  resolveRequestProfileAccess
} from '@/lib/control-plane-auth'

export const runtime = 'nodejs'

function readRequiredChatScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_REQUIRED_CHAT_SCOPES)
  if (configured.length > 0) {
    return configured
  }
  return ['chat.write']
}

function readRequiredTopologyReadScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_REQUIRED_TOPOLOGY_READ_SCOPES)
  if (configured.length > 0) {
    return configured
  }
  return ['topology.read']
}

function readRequiredTopologyWriteScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_REQUIRED_TOPOLOGY_WRITE_SCOPES)
  if (configured.length > 0) {
    return configured
  }
  return ['topology.read']
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { hasUserToken, grantedScopes } = await getRequestGrantedScopes(req)
    const profileAccess = await resolveRequestProfileAccess(req)

    return NextResponse.json(
      {
        ok: true,
        hasUserToken,
        grantedScopes,
        requiredScopes: {
          chat: readRequiredChatScopes(),
          topologyRead: readRequiredTopologyReadScopes(),
          topologyWrite: readRequiredTopologyWriteScopes()
        },
        permissions: {
          canChat: hasAnyScope(grantedScopes, readRequiredChatScopes()),
          canTopologyRead: hasAnyScope(grantedScopes, readRequiredTopologyReadScopes()),
          canTopologyWrite: hasAnyScope(grantedScopes, readRequiredTopologyWriteScopes())
        },
        profileAccess
      },
      { status: 200 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to resolve permissions' },
      { status: 500 }
    )
  }
}
