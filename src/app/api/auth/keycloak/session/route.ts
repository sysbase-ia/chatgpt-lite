import { NextResponse, type NextRequest } from 'next/server'
import {
  shouldUseSecureAuthCookies,
  WEB_CHAT_ACCESS_TOKEN_COOKIE,
  WEB_CHAT_REFRESH_TOKEN_COOKIE,
  WEB_CHAT_SESSION_USER_COOKIE
} from '@/lib/auth-session'

export const runtime = 'nodejs'
const REMEMBER_ME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

type KeycloakSessionRequest = {
  username?: string
  password?: string
  remember?: boolean
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

function parseRememberValue(raw: unknown): boolean {
  if (typeof raw === 'boolean') {
    return raw
  }
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function mergeScopes(baseScope: string, includeOfflineAccess: boolean): string {
  const parts = baseScope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
  const unique = new Set(parts)
  if (includeOfflineAccess) {
    unique.add('offline_access')
  }
  return Array.from(unique).join(' ').trim()
}

async function requestPasswordGrantToken(username: string, password: string, remember: boolean): Promise<{
  accessToken: string
  expiresIn: number
  refreshToken: string
  refreshExpiresIn: number
}> {
  const tokenURL = firstNonEmpty(
    process.env.WEB_CHAT_KEYCLOAK_LOGIN_TOKEN_URL,
    process.env.CONTROL_PLANE_AUTH_TOKEN_URL
  )
  const clientID = firstNonEmpty(
    process.env.WEB_CHAT_KEYCLOAK_LOGIN_CLIENT_ID,
    process.env.CONTROL_PLANE_AUTH_CLIENT_ID
  )
  const clientSecret = firstNonEmpty(
    process.env.WEB_CHAT_KEYCLOAK_LOGIN_CLIENT_SECRET,
    process.env.CONTROL_PLANE_AUTH_CLIENT_SECRET
  )
  const scope = mergeScopes(firstNonEmpty(process.env.WEB_CHAT_KEYCLOAK_LOGIN_SCOPE), remember)

  if (!tokenURL || !clientID || !clientSecret) {
    throw new Error('keycloak login is not configured on server')
  }

  const payload = new URLSearchParams()
  payload.set('grant_type', 'password')
  payload.set('client_id', clientID)
  payload.set('client_secret', clientSecret)
  payload.set('username', username)
  payload.set('password', password)

  const requestToken = async (withScope: boolean) => {
    const body = new URLSearchParams(payload.toString())
    if (withScope && scope) {
      body.set('scope', scope)
    } else {
      body.delete('scope')
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

    const raw = await response.text()
    let parsed: Record<string, unknown> = {}
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>
      } catch {
        parsed = { detail: raw.slice(0, 500) }
      }
    }
    return { response, parsed }
  }

  let { response, parsed } = await requestToken(Boolean(scope))
  if (!response.ok && scope) {
    const detail = String(parsed.error_description || parsed.error || '').toLowerCase()
    if (detail.includes('invalid scope') || detail.includes('invalid scopes')) {
      ;({ response, parsed } = await requestToken(false))
    }
  }

  if (!response.ok) {
    const detail =
      (typeof parsed.error_description === 'string' && parsed.error_description.trim()) ||
      (typeof parsed.error === 'string' && parsed.error.trim()) ||
      `keycloak token http ${response.status}`
    throw new Error(detail)
  }

  const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : ''
  if (!accessToken) {
    throw new Error('missing access_token in keycloak response')
  }
  const expiresIn =
    typeof parsed.expires_in === 'number' && Number.isFinite(parsed.expires_in)
      ? Math.max(60, Math.floor(parsed.expires_in))
      : 300
  const refreshToken =
    typeof parsed.refresh_token === 'string' ? parsed.refresh_token.trim() : ''
  const refreshExpiresIn =
    typeof parsed.refresh_expires_in === 'number' && Number.isFinite(parsed.refresh_expires_in)
      ? Math.max(0, Math.floor(parsed.refresh_expires_in))
      : 0

  return { accessToken, expiresIn, refreshToken, refreshExpiresIn }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as KeycloakSessionRequest
    const username = String(body.username || '').trim()
    const password = String(body.password || '').trim()
    const remember = parseRememberValue(body.remember)
    if (!username || !password) {
      return NextResponse.json({ error: 'username and password are required' }, { status: 400 })
    }

    const { accessToken, expiresIn, refreshToken, refreshExpiresIn } = await requestPasswordGrantToken(
      username,
      password,
      remember
    )
    const secure = shouldUseSecureAuthCookies()
    const refreshCookieMaxAge = refreshToken
      ? refreshExpiresIn > 0
        ? refreshExpiresIn
        : remember
          ? REMEMBER_ME_COOKIE_MAX_AGE_SECONDS
          : Math.max(expiresIn, 300)
      : 0
    const sessionMaxAge = refreshCookieMaxAge > 0 ? refreshCookieMaxAge : expiresIn
    const response = NextResponse.json(
      {
        ok: true,
        username,
        expiresIn,
        remember
      },
      { status: 200 }
    )
    response.cookies.set({
      name: WEB_CHAT_ACCESS_TOKEN_COOKIE,
      value: accessToken,
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: expiresIn
    })
    if (refreshToken) {
      response.cookies.set({
        name: WEB_CHAT_REFRESH_TOKEN_COOKIE,
        value: refreshToken,
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: refreshCookieMaxAge
      })
    } else {
      response.cookies.set({
        name: WEB_CHAT_REFRESH_TOKEN_COOKIE,
        value: '',
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: 0
      })
    }
    response.cookies.set({
      name: WEB_CHAT_SESSION_USER_COOKIE,
      value: username,
      httpOnly: false,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: sessionMaxAge
    })
    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'keycloak session login failed' },
      { status: 401 }
    )
  }
}
