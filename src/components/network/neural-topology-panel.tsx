'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Activity, Clock3, Cpu, RefreshCw, Server, Sparkles } from 'lucide-react'

type TopologyServer = {
  hostname: string
  metricsListen: string
  uptimeSeconds: number
  lastSuccessUnix: number
  lastErrorUnix: number
}

type TopologySummary = {
  configuredNodes: number
  profiles: number
  agents: number
  activeAgents: number
  activeSessions: number
}

type TopologyNode = {
  id: string
  type: string
  status: string
}

type TopologyProfile = {
  id: string
  agentCount: number
  activeAgents: number
  activeSessions: number
  agentIds: string[]
}

type TopologyAgent = {
  id: string
  name: string
  profile: string
  workspace: string
  default: boolean
  active: boolean
  activeSessionCount: number
  totalSessionCount: number
  lastActiveUnix: number
  subagentsActive: string[] | null
}

type TopologySession = {
  key: string
  agentId: string
  updatedAt: number
  subagentId?: string
  isSubagent: boolean
}

type TopologyResponse = {
  service: string
  status: string
  generatedAt: string
  installDir: string
  server: TopologyServer
  summary: TopologySummary
  nodes: TopologyNode[]
  profiles: TopologyProfile[]
  agents: TopologyAgent[]
  sessions: TopologySession[]
}

const ANIMAL_NAMES = [
  'Aardvark',
  'Albatross',
  'Alligator',
  'Alpaca',
  'Antelope',
  'Armadillo',
  'Axolotl',
  'Badger',
  'Barracuda',
  'Bat',
  'Beaver',
  'Bison',
  'Bobcat',
  'Buffalo',
  'Butterfly',
  'Camel',
  'Capybara',
  'Caracal',
  'Cardinal',
  'Caribou',
  'Cassowary',
  'Cheetah',
  'Chinchilla',
  'Cobra',
  'Cougar',
  'Coyote',
  'Crane',
  'Crocodile',
  'Crow',
  'Deer',
  'Dingo',
  'Dolphin',
  'Dragonfly',
  'Eagle',
  'Echidna',
  'Egret',
  'Elephant',
  'Falcon',
  'Ferret',
  'Firefly',
  'Flamingo',
  'Fox',
  'Frog',
  'Gazelle',
  'Gecko',
  'Giraffe',
  'Gorilla',
  'Hawk',
  'Hedgehog',
  'Heron',
  'Hippopotamus',
  'Hyena',
  'Ibis',
  'Iguana',
  'Jaguar',
  'Jay',
  'Jellyfish',
  'Kangaroo',
  'Kingfisher',
  'Koala',
  'Kookaburra',
  'Lemur',
  'Leopard',
  'Lion',
  'Llama',
  'Lobster',
  'Lynx',
  'Macaw',
  'Magpie',
  'Manatee',
  'Manta',
  'Meerkat',
  'Mink',
  'Moose',
  'Narwhal',
  'Nightingale',
  'Octopus',
  'Okapi',
  'Osprey',
  'Otter',
  'Owl',
  'Panther',
  'Parrot',
  'Peacock',
  'Pelican',
  'Penguin',
  'Puma',
  'Quail',
  'Quokka',
  'Rabbit',
  'Raccoon',
  'Raven',
  'Rhino',
  'Salamander',
  'Seal',
  'Serval',
  'Shark',
  'Sparrow',
  'Swan',
  'Tapir',
  'Tiger',
  'Toucan',
  'Turtle',
  'Viper',
  'Walrus',
  'Wolf',
  'Wombat',
  'Yak',
  'Zebra'
] as const

type GraphNodeType = 'server' | 'profile' | 'agent' | 'subagent'

type GraphNode = {
  id: string
  type: GraphNodeType
  label: string
  x: number
  y: number
  radius: number
  active: boolean
  selected: boolean
  profileId?: string
  sessionCount?: number
}

type GraphEdge = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  active: boolean
  weight: number
}

type GraphLayout = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const VIEWBOX_WIDTH = 1280
const VIEWBOX_HEIGHT = 780

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes'
  }
  return false
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return Math.abs(hash >>> 0)
}

function looksLikeStandaloneID(raw: string): boolean {
  const value = raw.trim().toLowerCase()
  if (!value) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    return true
  }
  if (/^[a-z0-9]{24,}$/.test(value) && /[0-9]/.test(value)) {
    return true
  }
  return false
}

function formatStandaloneSubagentName(rawID: string): string {
  const index = hashString(rawID) % ANIMAL_NAMES.length
  const animal = ANIMAL_NAMES[index].toLowerCase()
  return `standalone-${animal}`
}

function displaySubagentName(rawID: string): string {
  const id = rawID.trim()
  if (!id) {
    return 'standalone-agent'
  }
  if (looksLikeStandaloneID(id)) {
    return formatStandaloneSubagentName(id)
  }
  return id
}

function normalizeTopology(raw: unknown): TopologyResponse {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rawSummary =
    obj.summary && typeof obj.summary === 'object' ? (obj.summary as Record<string, unknown>) : {}
  const rawServer =
    obj.server && typeof obj.server === 'object' ? (obj.server as Record<string, unknown>) : {}

  const nodes = Array.isArray(obj.nodes)
    ? obj.nodes
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const row = item as Record<string, unknown>
          const id = String(row.id ?? '').trim()
          if (!id) return null
          return {
            id,
            type: String(row.type ?? 'component'),
            status: String(row.status ?? 'configured')
          } as TopologyNode
        })
        .filter((item): item is TopologyNode => item !== null)
    : []

  const profiles = Array.isArray(obj.profiles)
    ? obj.profiles
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const row = item as Record<string, unknown>
          const id = String(row.id ?? '').trim()
          if (!id) return null
          return {
            id,
            agentCount: toNumber(row.agentCount, 0),
            activeAgents: toNumber(row.activeAgents, 0),
            activeSessions: toNumber(row.activeSessions, 0),
            agentIds: asStringArray(row.agentIds)
          } as TopologyProfile
        })
        .filter((item): item is TopologyProfile => item !== null)
    : []

  const agents = Array.isArray(obj.agents)
    ? obj.agents
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const row = item as Record<string, unknown>
          const id = String(row.id ?? '').trim()
          if (!id) return null
          return {
            id,
            name: String(row.name ?? id),
            profile: String(row.profile ?? 'default'),
            workspace: String(row.workspace ?? ''),
            default: toBool(row.default),
            active: toBool(row.active),
            activeSessionCount: toNumber(row.activeSessionCount, 0),
            totalSessionCount: toNumber(row.totalSessionCount, toNumber(row.activeSessionCount, 0)),
            lastActiveUnix: toNumber(row.lastActiveUnix, 0),
            subagentsActive: asStringArray(row.subagentsActive)
          } as TopologyAgent
        })
        .filter((item): item is TopologyAgent => item !== null)
    : []

  const sessions = Array.isArray(obj.sessions)
    ? obj.sessions
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const row = item as Record<string, unknown>
          const key = String(row.key ?? '').trim()
          const agentId = String(row.agentId ?? '').trim()
          if (!key || !agentId) return null
          return {
            key,
            agentId,
            updatedAt: toNumber(row.updatedAt, 0),
            subagentId: String(row.subagentId ?? '').trim() || undefined,
            isSubagent: toBool(row.isSubagent)
          } as TopologySession
        })
        .filter((item): item is TopologySession => item !== null)
    : []

  return {
    service: String(obj.service ?? 'sysbase-control-plane'),
    status: String(obj.status ?? 'ok'),
    generatedAt: String(obj.generatedAt ?? new Date().toISOString()),
    installDir: String(obj.installDir ?? '/opt/sysbase'),
    server: {
      hostname: String(rawServer.hostname ?? 'sysbase'),
      metricsListen: String(rawServer.metricsListen ?? ''),
      uptimeSeconds: toNumber(rawServer.uptimeSeconds, 0),
      lastSuccessUnix: toNumber(rawServer.lastSuccessUnix, 0),
      lastErrorUnix: toNumber(rawServer.lastErrorUnix, 0)
    },
    summary: {
      configuredNodes: toNumber(rawSummary.configuredNodes, nodes.length),
      profiles: toNumber(rawSummary.profiles, profiles.length),
      agents: toNumber(rawSummary.agents, agents.length),
      activeAgents: toNumber(
        rawSummary.activeAgents,
        agents.filter((agent) => agent.active).length
      ),
      activeSessions: toNumber(rawSummary.activeSessions, sessions.length)
    },
    nodes,
    profiles,
    agents,
    sessions
  }
}

function fmtAgo(unixSeconds: number): string {
  if (!unixSeconds || unixSeconds <= 0) {
    return 'sin actividad reciente'
  }
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds)
  if (diff < 60) {
    return `${diff}s`
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m`
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h`
  }
  return `${Math.floor(diff / 86400)}d`
}

function fmtClock(unixSeconds: number): string {
  if (!unixSeconds || unixSeconds <= 0) {
    return 'n/a'
  }
  return new Date(unixSeconds * 1000).toLocaleString()
}

function shortLabel(value: string, max = 18): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) {
    return trimmed
  }
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}

function buildGraph(topology: TopologyResponse | null, selectedAgentId: string): GraphLayout {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  if (!topology) {
    return { nodes, edges }
  }

  const cx = VIEWBOX_WIDTH / 2
  const cy = VIEWBOX_HEIGHT / 2

  nodes.push({
    id: 'server',
    type: 'server',
    label: topology.server.hostname || 'server',
    x: cx,
    y: cy,
    radius: 42,
    active: true,
    selected: false
  })

  const agentsByProfile = new Map<string, TopologyAgent[]>()
  for (const agent of topology.agents) {
    const profileId = (agent.profile || 'default').trim() || 'default'
    const list = agentsByProfile.get(profileId)
    if (list) {
      list.push(agent)
    } else {
      agentsByProfile.set(profileId, [agent])
    }
  }

  const profileIds =
    topology.profiles.length > 0
      ? topology.profiles.map((item) => item.id)
      : Array.from(agentsByProfile.keys())

  const profileCount = Math.max(1, profileIds.length)
  const profileRadius = 250
  const agentOffsetRadius = 150
  const subagentOffsetRadius = 56

  for (let profileIndex = 0; profileIndex < profileIds.length; profileIndex += 1) {
    const profileId = profileIds[profileIndex]
    const profileAngle = -Math.PI / 2 + (profileIndex * Math.PI * 2) / profileCount
    const px = cx + Math.cos(profileAngle) * profileRadius
    const py = cy + Math.sin(profileAngle) * profileRadius

    const profileAgents = [...(agentsByProfile.get(profileId) ?? [])].sort((a, b) => {
      if (a.active !== b.active) {
        return Number(b.active) - Number(a.active)
      }
      return a.id.localeCompare(b.id)
    })

    const profileActive = profileAgents.some((agent) => agent.active)

    nodes.push({
      id: `profile:${profileId}`,
      type: 'profile',
      label: profileId,
      x: px,
      y: py,
      radius: 28,
      active: profileActive,
      selected: false,
      profileId
    })

    edges.push({
      id: `edge:server:${profileId}`,
      x1: cx,
      y1: cy,
      x2: px,
      y2: py,
      active: profileActive,
      weight: 1
    })

    const agentCount = profileAgents.length
    const spread = Math.min(Math.PI * 1.6, Math.PI * (0.7 + agentCount * 0.2))
    const startAngle = profileAngle - spread / 2

    for (let agentIndex = 0; agentIndex < profileAgents.length; agentIndex += 1) {
      const agent = profileAgents[agentIndex]
      const localAngle =
        agentCount <= 1 ? profileAngle : startAngle + (agentIndex * spread) / (agentCount - 1)
      const ax = px + Math.cos(localAngle) * agentOffsetRadius
      const ay = py + Math.sin(localAngle) * agentOffsetRadius

      nodes.push({
        id: `agent:${agent.id}`,
        type: 'agent',
        label: agent.name || agent.id,
        x: ax,
        y: ay,
        radius: 22,
        active: agent.active,
        selected: agent.id === selectedAgentId,
        profileId,
        sessionCount: agent.activeSessionCount
      })

      edges.push({
        id: `edge:profile:${profileId}:agent:${agent.id}`,
        x1: px,
        y1: py,
        x2: ax,
        y2: ay,
        active: agent.active,
        weight: 2
      })

      const subagents = [...(agent.subagentsActive ?? [])].sort((a, b) => a.localeCompare(b))
      const subCount = subagents.length
      for (let subIndex = 0; subIndex < subCount; subIndex += 1) {
        const subId = subagents[subIndex]
        const subAngle = -Math.PI / 2 + (subIndex * Math.PI * 2) / subCount
        const sx = ax + Math.cos(subAngle) * subagentOffsetRadius
        const sy = ay + Math.sin(subAngle) * subagentOffsetRadius

        nodes.push({
          id: `subagent:${agent.id}:${subId}`,
          type: 'subagent',
          label: displaySubagentName(subId),
          x: sx,
          y: sy,
          radius: 10,
          active: true,
          selected: false,
          profileId,
          sessionCount: 1
        })

        edges.push({
          id: `edge:agent:${agent.id}:sub:${subId}`,
          x1: ax,
          y1: ay,
          x2: sx,
          y2: sy,
          active: true,
          weight: 1
        })
      }
    }
  }

  return { nodes, edges }
}

export function NeuralTopologyPanel(): React.JSX.Element {
  const [topology, setTopology] = useState<TopologyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string>('')
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')

  const loadTopology = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      const response = await fetch('/api/topology?activeMinutes=20', {
        method: 'GET',
        cache: 'no-store'
      })
      const payload = (await response.json()) as TopologyResponse & {
        error?: string
        detail?: string
      }
      if (!response.ok) {
        throw new Error(payload.error || payload.detail || `topology http ${response.status}`)
      }
      setTopology(normalizeTopology(payload))
      setError('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo consultar la topología'
      setError(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadTopology(false)
    const timer = window.setInterval(() => {
      void loadTopology(true)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [loadTopology])

  useEffect(() => {
    if (!topology || topology.agents.length === 0) {
      setSelectedAgentId('')
      return
    }
    const exists = topology.agents.some((agent) => agent.id === selectedAgentId)
    if (!exists) {
      const preferred = topology.agents.find((agent) => agent.active) ?? topology.agents[0]
      setSelectedAgentId(preferred.id)
    }
  }, [selectedAgentId, topology])

  const selectedAgent = useMemo(
    () => topology?.agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [selectedAgentId, topology]
  )

  const selectedSessions = useMemo(() => {
    if (!topology || !selectedAgent) {
      return []
    }
    return topology.sessions
      .filter((session) => session.agentId === selectedAgent.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [selectedAgent, topology])

  const activeAgents = useMemo(() => {
    if (!topology) {
      return []
    }
    return topology.agents.filter((agent) => agent.active)
  }, [topology])

  const graph = useMemo(() => buildGraph(topology, selectedAgentId), [selectedAgentId, topology])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          Topología en vivo
        </div>
        {topology && (
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            <Clock3 className="size-3.5" />
            <span>Actualizado: {new Date(topology.generatedAt).toLocaleTimeString()}</span>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void loadTopology(true)
          }}
          className="ml-auto"
          disabled={refreshing}
        >
          <RefreshCw className={cn('mr-1 size-3.5', refreshing && 'animate-spin')} />
          Refrescar
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="bg-card border-border rounded-xl border px-3 py-2.5">
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">Nodos</p>
          <p className="text-lg font-semibold">{topology?.summary.configuredNodes ?? 0}</p>
        </div>
        <div className="bg-card border-border rounded-xl border px-3 py-2.5">
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">Perfiles</p>
          <p className="text-lg font-semibold">{topology?.summary.profiles ?? 0}</p>
        </div>
        <div className="bg-card border-border rounded-xl border px-3 py-2.5">
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
            Agentes activos
          </p>
          <p className="text-lg font-semibold">{topology?.summary.activeAgents ?? 0}</p>
        </div>
        <div className="bg-card border-border rounded-xl border px-3 py-2.5">
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
            Sesiones activas
          </p>
          <p className="text-lg font-semibold">{topology?.summary.activeSessions ?? 0}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="bg-card border-border min-h-[500px] rounded-2xl border xl:col-span-8">
          <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
            <Activity className="size-4" />
            <p className="text-sm font-medium">Red neuronal de perfiles y agentes</p>
          </div>
          <div className="h-full overflow-auto p-2">
            <div className="mx-auto min-w-[920px]">
              <svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} className="h-[560px] w-full">
                <defs>
                  <radialGradient id="graphBackdrop" cx="50%" cy="50%" r="60%">
                    <stop offset="0%" stopColor="rgba(16,185,129,0.08)" />
                    <stop offset="100%" stopColor="rgba(59,130,246,0.04)" />
                  </radialGradient>
                </defs>
                <rect
                  x="0"
                  y="0"
                  width={VIEWBOX_WIDTH}
                  height={VIEWBOX_HEIGHT}
                  fill="url(#graphBackdrop)"
                  rx="22"
                />

                {graph.edges.map((edge) => (
                  <line
                    key={edge.id}
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    stroke={edge.active ? 'rgba(16,185,129,0.5)' : 'rgba(148,163,184,0.35)'}
                    strokeWidth={edge.weight}
                  />
                ))}

                {graph.nodes.map((node) => {
                  const isAgent = node.type === 'agent'
                  const isSubagent = node.type === 'subagent'
                  const clickable = isAgent
                  const fill =
                    node.type === 'server'
                      ? 'rgba(59,130,246,0.9)'
                      : node.type === 'profile'
                        ? node.active
                          ? 'rgba(16,185,129,0.85)'
                          : 'rgba(100,116,139,0.8)'
                        : isSubagent
                          ? 'rgba(244,114,182,0.95)'
                          : node.active
                            ? 'rgba(34,197,94,0.92)'
                            : 'rgba(100,116,139,0.88)'

                  return (
                    <g
                      key={node.id}
                      className={cn(clickable && 'cursor-pointer')}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : -1}
                      onClick={
                        clickable
                          ? () => {
                              setSelectedAgentId(node.id.replace(/^agent:/, ''))
                            }
                          : undefined
                      }
                      onKeyDown={
                        clickable
                          ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setSelectedAgentId(node.id.replace(/^agent:/, ''))
                              }
                            }
                          : undefined
                      }
                    >
                      {isAgent && node.active && (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.radius + 9}
                          fill="rgba(34,197,94,0.2)"
                          className="animate-pulse"
                        />
                      )}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={node.radius}
                        fill={fill}
                        stroke={
                          node.selected
                            ? 'rgba(250,204,21,0.98)'
                            : node.active
                              ? 'rgba(255,255,255,0.82)'
                              : 'rgba(255,255,255,0.5)'
                        }
                        strokeWidth={node.selected ? 3 : 1.5}
                      />
                      <text
                        x={node.x}
                        y={node.y - (node.type === 'subagent' ? 16 : node.radius + 9)}
                        textAnchor="middle"
                        className="fill-foreground text-[12px] font-semibold"
                      >
                        {shortLabel(node.label, node.type === 'subagent' ? 14 : 16)}
                      </text>
                      {isAgent && (node.sessionCount ?? 0) > 0 && (
                        <g>
                          <circle
                            cx={node.x + node.radius - 2}
                            cy={node.y - node.radius + 2}
                            r="9"
                            fill="rgba(250,204,21,0.95)"
                          />
                          <text
                            x={node.x + node.radius - 2}
                            y={node.y - node.radius + 5}
                            textAnchor="middle"
                            className="fill-black text-[10px] font-bold"
                          >
                            {Math.min(99, node.sessionCount ?? 0)}
                          </text>
                        </g>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-card border-border min-h-[500px] rounded-2xl border xl:col-span-4">
          <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
            <Sparkles className="size-4" />
            <p className="text-sm font-medium">Detalle del agente</p>
          </div>

          <div className="flex h-full flex-col gap-3 overflow-auto p-3">
            {!selectedAgent && !loading && (
              <div className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
                No hay agentes disponibles en la topología.
              </div>
            )}

            {selectedAgent && (
              <>
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-base font-semibold">
                      {selectedAgent.name || selectedAgent.id}
                    </p>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        selectedAgent.active
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-500/20 text-slate-600 dark:text-slate-300'
                      )}
                    >
                      {selectedAgent.active ? 'activo' : 'idle'}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">ID: {selectedAgent.id}</p>
                  <p className="text-muted-foreground text-xs">Perfil: {selectedAgent.profile}</p>
                  <p className="text-muted-foreground text-xs">
                    Última actividad: {fmtAgo(selectedAgent.lastActiveUnix)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border px-3 py-2.5">
                    <p className="text-muted-foreground text-[11px] uppercase">Sesiones activas</p>
                    <p className="text-lg font-semibold">{selectedAgent.activeSessionCount}</p>
                  </div>
                  <div className="rounded-xl border px-3 py-2.5">
                    <p className="text-muted-foreground text-[11px] uppercase">
                      Subagentes activos
                    </p>
                    <p className="text-lg font-semibold">
                      {(selectedAgent.subagentsActive ?? []).length}
                    </p>
                  </div>
                </div>

                {(selectedAgent.subagentsActive ?? []).length > 0 && (
                  <div className="rounded-xl border px-3 py-2.5">
                    <p className="mb-2 text-[11px] font-semibold tracking-wide uppercase">
                      Subagentes detectados
                    </p>
                    <div className="space-y-1.5">
                      {(selectedAgent.subagentsActive ?? []).map((subID) => (
                        <div
                          key={`subagent-row-${selectedAgent.id}-${subID}`}
                          className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs"
                        >
                          <span className="font-medium">{displaySubagentName(subID)}</span>
                          <span className="text-muted-foreground truncate font-mono">{subID}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border px-3 py-2.5">
                  <p className="mb-1 text-[11px] font-semibold tracking-wide uppercase">
                    Workspace
                  </p>
                  <p className="text-muted-foreground text-xs break-all">
                    {selectedAgent.workspace || 'n/a'}
                  </p>
                </div>

                <div className="rounded-xl border px-3 py-2.5">
                  <p className="mb-2 text-[11px] font-semibold tracking-wide uppercase">
                    Sesiones del agente
                  </p>
                  {selectedSessions.length === 0 && (
                    <p className="text-muted-foreground text-xs">
                      Sin sesiones activas en la ventana de 20 minutos.
                    </p>
                  )}
                  <div className="space-y-2">
                    {selectedSessions.map((session) => (
                      <div
                        key={`${session.key}-${session.updatedAt}`}
                        className="rounded-lg border px-2 py-1.5"
                      >
                        <p className="truncate font-mono text-[11px]">{session.key}</p>
                        <p className="text-muted-foreground text-[11px]">
                          actualizado: {fmtClock(session.updatedAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="mt-auto rounded-xl border px-3 py-2.5">
              <p className="mb-2 text-[11px] font-semibold tracking-wide uppercase">
                Agentes activos ahora
              </p>
              {activeAgents.length === 0 ? (
                <p className="text-muted-foreground text-xs">Sin agentes activos.</p>
              ) : (
                <div className="space-y-1.5">
                  {activeAgents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={cn(
                        'w-full rounded-lg border px-2 py-1.5 text-left text-xs transition-colors',
                        selectedAgentId === agent.id
                          ? 'border-emerald-500/35 bg-emerald-500/15'
                          : 'hover:bg-muted/70 border-border'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{agent.id}</span>
                        <span className="text-muted-foreground">
                          {agent.activeSessionCount} sesión(es)
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {topology && (
              <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
                <Server className="size-3.5" />
                <span>{topology.server.hostname}</span>
                <Cpu className="ml-2 size-3.5" />
                <span>
                  uptime {fmtAgo(Math.floor(Date.now() / 1000) - topology.server.uptimeSeconds)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
