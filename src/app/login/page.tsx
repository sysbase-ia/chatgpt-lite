'use client'

import { Suspense, useCallback, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const PASSWORD_RECOVERY_BASE_URL = String(
  process.env.NEXT_PUBLIC_WEB_CHAT_KEYCLOAK_BASE_URL || ''
).trim()
const PASSWORD_RECOVERY_REALM = String(
  process.env.NEXT_PUBLIC_WEB_CHAT_KEYCLOAK_REALM || 'sysbase'
).trim()
const PASSWORD_RECOVERY_URL =
  PASSWORD_RECOVERY_BASE_URL && PASSWORD_RECOVERY_REALM
    ? `${PASSWORD_RECOVERY_BASE_URL.replace(/\/+$/, '')}/realms/${encodeURIComponent(
        PASSWORD_RECOVERY_REALM
      )}/account/`
    : ''

function LoginScreen(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = useMemo(() => {
    const requested = String(searchParams.get('next') || '').trim()
    if (!requested || !requested.startsWith('/')) {
      return '/chat'
    }
    return requested
  }, [searchParams])

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (busy) {
        return
      }
      setError('')
      setBusy(true)
      try {
        const response = await fetch('/api/auth/keycloak/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            password: password.trim(),
            remember
          })
        })
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        if (!response.ok) {
          throw new Error(String(payload.error || `login failed (${response.status})`))
        }
        router.replace(nextPath)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo iniciar sesion')
      } finally {
        setBusy(false)
      }
    },
    [busy, nextPath, password, remember, router, username]
  )

  return (
    <div className="bg-background text-foreground flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm">
        <div className="mb-5 space-y-1">
          <h1 className="text-2xl font-semibold">Iniciar Sesion</h1>
          <p className="text-muted-foreground text-sm">
            Accede con tu usuario de Keycloak para entrar a Chat Web.
          </p>
        </div>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="username">
              Usuario
            </label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="efra"
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="password">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              disabled={busy}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              disabled={busy}
            />
            Recordarme en este dispositivo
          </label>
          {PASSWORD_RECOVERY_URL ? (
            <div className="space-y-1">
              <a
                className="text-xs text-blue-600 underline underline-offset-2"
                href={PASSWORD_RECOVERY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Recuperar contraseña
              </a>
              <p className="text-muted-foreground text-[11px]">
                Se abre Keycloak. Ahí usa el enlace <strong>Forgot Password?</strong>.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Recuperación de contraseña no configurada en este entorno.
            </p>
          )}
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <Button className="w-full" type="submit" disabled={busy}>
            {busy ? 'Ingresando...' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  )
}

function LoginFallback(): React.JSX.Element {
  return (
    <div className="bg-background text-foreground flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm">
        <p className="text-muted-foreground text-sm">Cargando login...</p>
      </div>
    </div>
  )
}

export default function LoginPage(): React.JSX.Element {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginScreen />
    </Suspense>
  )
}
