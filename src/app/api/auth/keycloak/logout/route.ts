import { NextResponse } from 'next/server'
import {
  shouldUseSecureAuthCookies,
  WEB_CHAT_ACCESS_TOKEN_COOKIE,
  WEB_CHAT_REFRESH_TOKEN_COOKIE,
  WEB_CHAT_SESSION_USER_COOKIE
} from '@/lib/auth-session'

export const runtime = 'nodejs'

export async function POST(): Promise<NextResponse> {
  const secure = shouldUseSecureAuthCookies()
  const response = NextResponse.json({ ok: true }, { status: 200 })
  response.cookies.set({
    name: WEB_CHAT_ACCESS_TOKEN_COOKIE,
    value: '',
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  })
  response.cookies.set({
    name: WEB_CHAT_REFRESH_TOKEN_COOKIE,
    value: '',
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  })
  response.cookies.set({
    name: WEB_CHAT_SESSION_USER_COOKIE,
    value: '',
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  })
  return response
}
