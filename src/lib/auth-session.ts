export const WEB_CHAT_ACCESS_TOKEN_COOKIE = 'sysbase_web_chat_access_token'
export const WEB_CHAT_REFRESH_TOKEN_COOKIE = 'sysbase_web_chat_refresh_token'
export const WEB_CHAT_SESSION_USER_COOKIE = 'sysbase_web_chat_session_user'

function parseBool(value: string | undefined): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export function shouldUseSecureAuthCookies(): boolean {
  if (process.env.WEB_CHAT_AUTH_COOKIE_SECURE !== undefined) {
    return parseBool(process.env.WEB_CHAT_AUTH_COOKIE_SECURE)
  }
  return false
}

export function parseCookieHeader(rawCookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {}
  const source = String(rawCookieHeader || '').trim()
  if (!source) {
    return out
  }
  for (const chunk of source.split(';')) {
    const part = chunk.trim()
    if (!part) continue
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = decodeURIComponent(part.slice(0, index).trim())
    const value = decodeURIComponent(part.slice(index + 1).trim())
    if (key) {
      out[key] = value
    }
  }
  return out
}

export function readAccessTokenFromRequest(req?: Pick<Request, 'headers'>): string {
  if (!req) {
    return ''
  }
  const cookieHeader = req.headers?.get('cookie') || ''
  const cookies = parseCookieHeader(cookieHeader)
  return String(cookies[WEB_CHAT_ACCESS_TOKEN_COOKIE] || '').trim()
}

export function readRefreshTokenFromRequest(req?: Pick<Request, 'headers'>): string {
  if (!req) {
    return ''
  }
  const cookieHeader = req.headers?.get('cookie') || ''
  const cookies = parseCookieHeader(cookieHeader)
  return String(cookies[WEB_CHAT_REFRESH_TOKEN_COOKIE] || '').trim()
}

export function readSessionUserFromRequest(req?: Pick<Request, 'headers'>): string {
  if (!req) {
    return ''
  }
  const cookieHeader = req.headers?.get('cookie') || ''
  const cookies = parseCookieHeader(cookieHeader)
  return String(cookies[WEB_CHAT_SESSION_USER_COOKIE] || '').trim()
}
