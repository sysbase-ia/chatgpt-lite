import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

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

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const target = new URL(deriveTopologyURL())
    const activeMinutesRaw = req.nextUrl.searchParams.get('activeMinutes')?.trim() || ''
    if (activeMinutesRaw) {
      target.searchParams.set('activeMinutes', activeMinutesRaw)
    }

    const token = process.env.CONTROL_PLANE_CHAT_TOKEN?.trim()
    const response = await fetch(target.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
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
      const parsed = JSON.parse(text)
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
