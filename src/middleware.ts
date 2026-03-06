import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { readAccessTokenFromRequest, readRefreshTokenFromRequest } from '@/lib/auth-session'

const PUBLIC_PATHS = new Set(['/login'])
const PUBLIC_API_PREFIXES = ['/api/auth/keycloak/session', '/api/auth/keycloak/logout']

function normalizeScope(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function parseScopeList(raw: string | undefined): string[] {
  const scopes = String(raw || '')
    .split(/[\s,]+/)
    .map((item) => normalizeScope(item))
    .filter((item) => item !== '')
  return Array.from(new Set(scopes))
}

function readRequiredChatScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_REQUIRED_CHAT_SCOPES)
  return configured.length > 0 ? configured : ['chat.write']
}

function readRequiredTopologyReadScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_REQUIRED_TOPOLOGY_READ_SCOPES)
  return configured.length > 0 ? configured : ['topology.read']
}

function readRequiredTopologyWriteScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_REQUIRED_TOPOLOGY_WRITE_SCOPES)
  return configured.length > 0 ? configured : ['topology.read']
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
    const decoded = atob(padded)
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function appendScopes(target: Set<string>, raw: unknown): void {
  if (!raw) {
    return
  }
  if (typeof raw === 'string') {
    for (const scope of parseScopeList(raw)) {
      target.add(scope)
    }
    return
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'string') {
        continue
      }
      const normalized = normalizeScope(item)
      if (normalized) {
        target.add(normalized)
      }
    }
  }
}

function readGrantedScopesFromToken(token: string): string[] {
  const payload = decodeJwtPayload(token)
  if (!payload) {
    return []
  }
  const out = new Set<string>()
  appendScopes(out, payload.scope)
  appendScopes(out, payload.scp)
  appendScopes(out, payload.scopes)
  if (payload.realm_access && typeof payload.realm_access === 'object') {
    const realm = payload.realm_access as Record<string, unknown>
    appendScopes(out, realm.roles)
  }
  if (payload.resource_access && typeof payload.resource_access === 'object') {
    const resourceAccess = payload.resource_access as Record<string, unknown>
    for (const client of Object.values(resourceAccess)) {
      if (!client || typeof client !== 'object') {
        continue
      }
      appendScopes(out, (client as Record<string, unknown>).roles)
    }
  }
  return Array.from(out)
}

function hasAnyScope(granted: string[], required: string[]): boolean {
  if (required.length === 0) {
    return true
  }
  if (granted.length === 0) {
    return false
  }
  const grantedSet = new Set(granted)
  return required.some((scope) => grantedSet.has(scope))
}

function readRequiredScopesForPath(pathnameRaw: string): string[] {
  const pathname = pathnameRaw.toLowerCase()
  if (
    pathname === '/network' ||
    pathname.startsWith('/network/') ||
    pathname === '/chat/network' ||
    pathname.startsWith('/chat/network/')
  ) {
    return readRequiredTopologyReadScopes()
  }

  if (
    pathname.startsWith('/api/topology/session-close') ||
    pathname.startsWith('/api/topology/session-optimize') ||
    pathname.startsWith('/api/topology/memory-switch')
  ) {
    return readRequiredTopologyWriteScopes()
  }

  if (pathname.startsWith('/api/topology')) {
    return readRequiredTopologyReadScopes()
  }

  if (
    pathname.startsWith('/api/chat') ||
    pathname.startsWith('/api/upload') ||
    pathname.startsWith('/api/parse-pdf')
  ) {
    return readRequiredChatScopes()
  }

  if (
    pathname === '/chat' ||
    pathname.startsWith('/chat/') ||
    pathname === '/voice-chat' ||
    pathname.startsWith('/voice-chat/')
  ) {
    return readRequiredChatScopes()
  }

  return []
}

function handleMissingScope(request: NextRequest, requiredScopes: string[]): NextResponse {
  const pathname = request.nextUrl.pathname
  const detail = `missing required scope (${requiredScopes.join(', ')})`
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        error: detail,
        requiredScopes
      },
      { status: 403 }
    )
  }

  if (
    pathname === '/network' ||
    pathname.startsWith('/network/') ||
    pathname === '/chat/network' ||
    pathname.startsWith('/chat/network/')
  ) {
    const deniedURL = new URL('/chat', request.url)
    deniedURL.searchParams.set('error', 'missing_scope')
    deniedURL.searchParams.set('required', requiredScopes.join(','))
    return NextResponse.redirect(deniedURL)
  }

  return new NextResponse(detail, {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  })
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) {
    return true
  }
  for (const prefix of PUBLIC_API_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return true
    }
  }
  return false
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl

  if (isPublicPath(pathname)) {
    const token = readAccessTokenFromRequest(request)
    const refreshToken = readRefreshTokenFromRequest(request)
    if (pathname === '/login' && (token || refreshToken)) {
      return NextResponse.redirect(new URL('/chat', request.url))
    }
    return NextResponse.next()
  }

  const token = readAccessTokenFromRequest(request)
  const refreshToken = readRefreshTokenFromRequest(request)
  if (token || refreshToken) {
    const requiredScopes = readRequiredScopesForPath(pathname)
    if (requiredScopes.length > 0 && token) {
      const grantedScopes = readGrantedScopesFromToken(token)
      if (!hasAnyScope(grantedScopes, requiredScopes)) {
        return handleMissingScope(request, requiredScopes)
      }
    }
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 })
  }

  const loginURL = new URL('/login', request.url)
  const nextPath = `${pathname}${search || ''}`
  if (nextPath && nextPath !== '/login') {
    loginURL.searchParams.set('next', nextPath)
  }
  return NextResponse.redirect(loginURL)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|apple-touch-icon.png|.*\\.[a-zA-Z0-9]+$).*)'
  ]
}
