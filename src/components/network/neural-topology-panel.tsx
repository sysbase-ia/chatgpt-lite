'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  Activity,
  AlertTriangle,
  Bot,
  Clock3,
  Cpu,
  Database,
  Loader2,
  LocateFixed,
  RefreshCw,
  Server,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'

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
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  highLoadSessions: number
}

type TopologyMemory = {
  backend: string
  status: string
  available: string[]
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
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  maxContextTokens: number
  maxContextUsagePct: number
  highLoad: boolean
}

type TopologySession = {
  key: string
  agentId: string
  updatedAt: number
  subagentId?: string
  isSubagent: boolean
  modelProvider?: string
  model?: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  contextTokens: number
  contextUsagePct: number
  highLoad: boolean
}

type TopologyResponse = {
  service: string
  status: string
  generatedAt: string
  installDir: string
  server: TopologyServer
  summary: TopologySummary
  memory: TopologyMemory
  nodes: TopologyNode[]
  profiles: TopologyProfile[]
  agents: TopologyAgent[]
  sessions: TopologySession[]
}

type SessionCloseResponse = {
  status?: string
  sessionKey?: string
  agentId?: string
  removed?: boolean
  warnings?: string[]
  error?: string
  detail?: string
}

type SessionOptimizeResponse = {
  status?: string
  action?: string
  sessionKey?: string
  agentId?: string
  resultText?: string
  warnings?: string[]
  risks?: string[]
  error?: string
  detail?: string
}

type MemorySwitchResponse = {
  status?: string
  backend?: string
  previousBackend?: string
  restarted?: boolean
  warnings?: string[]
  error?: string
  detail?: string
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
  agentId?: string
  subagentId?: string
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
const GRAPH_MIN_SCALE = 0.45
const GRAPH_MAX_SCALE = 2.6

type GraphViewport = {
  scale: number
  offsetX: number
  offsetY: number
}

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
  const rawMemory =
    obj.memory && typeof obj.memory === 'object' ? (obj.memory as Record<string, unknown>) : {}

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
            subagentsActive: asStringArray(row.subagentsActive),
            inputTokens: toNumber(row.inputTokens, 0),
            outputTokens: toNumber(row.outputTokens, 0),
            totalTokens: toNumber(row.totalTokens, 0),
            cacheReadTokens: toNumber(row.cacheReadTokens, 0),
            cacheWriteTokens: toNumber(row.cacheWriteTokens, 0),
            maxContextTokens: toNumber(row.maxContextTokens, 0),
            maxContextUsagePct: toNumber(row.maxContextUsagePct, 0),
            highLoad: toBool(row.highLoad)
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
            isSubagent: toBool(row.isSubagent),
            modelProvider: String(row.modelProvider ?? '').trim() || undefined,
            model: String(row.model ?? '').trim() || undefined,
            inputTokens: toNumber(row.inputTokens, 0),
            outputTokens: toNumber(row.outputTokens, 0),
            totalTokens: toNumber(row.totalTokens, 0),
            cacheReadTokens: toNumber(row.cacheReadTokens, 0),
            cacheWriteTokens: toNumber(row.cacheWriteTokens, 0),
            contextTokens: toNumber(row.contextTokens, 0),
            contextUsagePct: toNumber(row.contextUsagePct, 0),
            highLoad: toBool(row.highLoad)
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
      activeSessions: toNumber(rawSummary.activeSessions, sessions.length),
      inputTokens: toNumber(rawSummary.inputTokens, 0),
      outputTokens: toNumber(rawSummary.outputTokens, 0),
      totalTokens: toNumber(rawSummary.totalTokens, 0),
      cacheReadTokens: toNumber(rawSummary.cacheReadTokens, 0),
      cacheWriteTokens: toNumber(rawSummary.cacheWriteTokens, 0),
      highLoadSessions: toNumber(rawSummary.highLoadSessions, 0)
    },
    memory: {
      backend: String(rawMemory.backend ?? 'memory-core'),
      status: String(rawMemory.status ?? 'unknown'),
      available: asStringArray(rawMemory.available)
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

function fmtTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0'
  }
  if (value < 1000) return `${Math.round(value)}`
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(2)}M`
}

function memoryBackendLabel(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (!value) {
    return 'memory-core'
  }
  if (value === 'memory-lancedb') {
    return 'memory-lancedb (LanceDB)'
  }
  if (value === 'memory-core') {
    return 'memory-core (clásico)'
  }
  return value
}

function sessionRiskLevel(session: TopologySession): 'ok' | 'warn' | 'danger' {
  if (session.highLoad || session.contextUsagePct >= 90 || session.totalTokens >= 140000) {
    return 'danger'
  }
  if (session.contextUsagePct >= 70 || session.totalTokens >= 90000) {
    return 'warn'
  }
  return 'ok'
}

function riskBadgeClass(level: 'ok' | 'warn' | 'danger'): string {
  if (level === 'danger') {
    return 'bg-red-500/15 text-red-700 dark:text-red-300'
  }
  if (level === 'warn') {
    return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
  }
  return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
}

function shortLabel(value: string, max = 18): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) {
    return trimmed
  }
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function buildDefaultViewport(width: number, height: number): GraphViewport {
  const safeWidth = Math.max(280, width)
  const safeHeight = Math.max(240, height)
  const fitScale = Math.min(safeWidth / VIEWBOX_WIDTH, safeHeight / VIEWBOX_HEIGHT)
  const scale = clampNumber(fitScale * 0.95, GRAPH_MIN_SCALE, 1.2)
  return {
    scale,
    offsetX: (safeWidth - VIEWBOX_WIDTH * scale) / 2,
    offsetY: (safeHeight - VIEWBOX_HEIGHT * scale) / 2
  }
}

function applyZoom(
  viewport: GraphViewport,
  zoomFactor: number,
  pivotX: number,
  pivotY: number
): GraphViewport {
  const nextScale = clampNumber(viewport.scale * zoomFactor, GRAPH_MIN_SCALE, GRAPH_MAX_SCALE)
  if (Math.abs(nextScale - viewport.scale) < 0.0001) {
    return viewport
  }
  const worldX = (pivotX - viewport.offsetX) / viewport.scale
  const worldY = (pivotY - viewport.offsetY) / viewport.scale
  return {
    scale: nextScale,
    offsetX: pivotX - worldX * nextScale,
    offsetY: pivotY - worldY * nextScale
  }
}

function toWorldPoint(clientX: number, clientY: number, viewport: GraphViewport) {
  return {
    x: (clientX - viewport.offsetX) / viewport.scale,
    y: (clientY - viewport.offsetY) / viewport.scale
  }
}

function isSelectableGraphNode(node: GraphNode): boolean {
  return node.type === 'agent' || node.type === 'subagent'
}

function pickGraphNode(
  nodes: GraphNode[],
  x: number,
  y: number,
  viewport: GraphViewport
): GraphNode | null {
  const world = toWorldPoint(x, y, viewport)
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i]
    const hitPadding = 8 / viewport.scale
    const hitRadius = node.radius + hitPadding
    const dx = world.x - node.x
    const dy = world.y - node.y
    if (dx * dx + dy * dy <= hitRadius * hitRadius) {
      return node
    }
  }
  return null
}

function drawGraphCanvas(
  ctx: CanvasRenderingContext2D,
  graph: GraphLayout,
  viewport: GraphViewport,
  width: number,
  height: number,
  hoverNodeID: string
) {
  ctx.clearRect(0, 0, width, height)

  const background = ctx.createRadialGradient(
    width * 0.5,
    height * 0.45,
    Math.min(width, height) * 0.08,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.75
  )
  background.addColorStop(0, 'rgba(16,185,129,0.12)')
  background.addColorStop(1, 'rgba(59,130,246,0.05)')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.translate(viewport.offsetX, viewport.offsetY)
  ctx.scale(viewport.scale, viewport.scale)

  for (const edge of graph.edges) {
    ctx.beginPath()
    ctx.moveTo(edge.x1, edge.y1)
    ctx.lineTo(edge.x2, edge.y2)
    ctx.strokeStyle = edge.active ? 'rgba(16,185,129,0.5)' : 'rgba(148,163,184,0.35)'
    ctx.lineWidth = edge.weight
    ctx.stroke()
  }

  for (const node of graph.nodes) {
    const isAgent = node.type === 'agent'
    const isSubagent = node.type === 'subagent'
    const isHovered = node.id === hoverNodeID

    const fillColor =
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

    if (isAgent && node.active) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, node.radius + 9, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(34,197,94,0.2)'
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
    ctx.fillStyle = fillColor
    ctx.fill()
    ctx.strokeStyle = node.selected
      ? 'rgba(250,204,21,0.98)'
      : isHovered && isSelectableGraphNode(node)
        ? 'rgba(255,255,255,0.95)'
        : node.active
          ? 'rgba(255,255,255,0.82)'
          : 'rgba(255,255,255,0.5)'
    ctx.lineWidth = node.selected ? 3 : 1.5
    ctx.stroke()

    ctx.font = `600 ${isSubagent ? 11 : 12}px ui-sans-serif, system-ui, -apple-system, Segoe UI`
    ctx.fillStyle = 'rgba(248,250,252,0.96)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const labelY = node.y - (isSubagent ? 16 : node.radius + 9)
    ctx.fillText(shortLabel(node.label, isSubagent ? 14 : 16), node.x, labelY)

    if (isAgent && (node.sessionCount ?? 0) > 0) {
      ctx.beginPath()
      ctx.arc(node.x + node.radius - 2, node.y - node.radius + 2, 9, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(250,204,21,0.95)'
      ctx.fill()
      ctx.font = '700 10px ui-sans-serif, system-ui, -apple-system, Segoe UI'
      ctx.fillStyle = 'rgba(0,0,0,0.9)'
      ctx.fillText(`${Math.min(99, node.sessionCount ?? 0)}`, node.x + node.radius - 2, node.y - node.radius + 5)
    }
  }
  ctx.restore()
}

function buildGraph(
  topology: TopologyResponse | null,
  selectedAgentId: string,
  selectedSubagentId: string
): GraphLayout {
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
  const subagentSessionCount = new Map<string, number>()
  const subagentIDsByAgent = new Map<string, Set<string>>()
  for (const agent of topology.agents) {
    const profileId = (agent.profile || 'default').trim() || 'default'
    const list = agentsByProfile.get(profileId)
    if (list) {
      list.push(agent)
    } else {
      agentsByProfile.set(profileId, [agent])
    }
  }
  for (const session of topology.sessions) {
    if (!session.subagentId) {
      continue
    }
    const key = `${session.agentId}:${session.subagentId}`
    subagentSessionCount.set(key, (subagentSessionCount.get(key) ?? 0) + 1)
    const set = subagentIDsByAgent.get(session.agentId)
    if (set) {
      set.add(session.subagentId)
    } else {
      subagentIDsByAgent.set(session.agentId, new Set([session.subagentId]))
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
        selected: agent.id === selectedAgentId && selectedSubagentId === '',
        profileId,
        sessionCount: agent.activeSessionCount,
        agentId: agent.id
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

      const mergedSubagents = new Set(agent.subagentsActive ?? [])
      const bySession = subagentIDsByAgent.get(agent.id)
      if (bySession) {
        for (const subID of bySession) {
          mergedSubagents.add(subID)
        }
      }
      const subagents = [...mergedSubagents].sort((a, b) => a.localeCompare(b))
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
          selected: selectedAgentId === agent.id && selectedSubagentId === subId,
          profileId,
          sessionCount: subagentSessionCount.get(`${agent.id}:${subId}`) ?? 0,
          agentId: agent.id,
          subagentId: subId
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
  const [selectedSubagentId, setSelectedSubagentId] = useState<string>('')
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const [sessionToClose, setSessionToClose] = useState<TopologySession | null>(null)
  const [closingSession, setClosingSession] = useState(false)
  const [closeSessionError, setCloseSessionError] = useState('')
  const [closeSessionInfo, setCloseSessionInfo] = useState('')
  const [memorySwitchBusy, setMemorySwitchBusy] = useState(false)
  const [memorySwitchError, setMemorySwitchError] = useState('')
  const [memorySwitchInfo, setMemorySwitchInfo] = useState('')
  const [sessionActionBusyKey, setSessionActionBusyKey] = useState('')
  const [canvasSize, setCanvasSize] = useState({ width: 920, height: 560 })
  const [graphViewport, setGraphViewport] = useState<GraphViewport>({ scale: 1, offsetX: 0, offsetY: 0 })
  const [hoverNodeID, setHoverNodeID] = useState('')
  const graphContainerRef = useRef<HTMLDivElement | null>(null)
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewportInitializedRef = useRef(false)
  const pointerStateRef = useRef({
    dragging: false,
    moved: false,
    lastX: 0,
    lastY: 0,
    pointerType: ''
  })

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

  const confirmCloseSession = useCallback(async () => {
    if (!sessionToClose) {
      return
    }
    setClosingSession(true)
    setCloseSessionError('')
    try {
      const response = await fetch('/api/topology/session-close', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionKey: sessionToClose.key,
          agentId: sessionToClose.agentId
        })
      })
      const payload = (await response.json()) as SessionCloseResponse
      if (!response.ok) {
        throw new Error(
          String(payload.error || payload.detail || `session close http ${response.status}`)
        )
      }
      const warnings = Array.isArray(payload.warnings)
        ? payload.warnings.filter((item) => typeof item === 'string' && item.trim() !== '')
        : []
      if (payload.removed === false) {
        setCloseSessionInfo(`Sesión ya cerrada o inexistente: ${sessionToClose.key}`)
      } else {
        const warningText = warnings.length > 0 ? ` (${warnings.join(' | ')})` : ''
        setCloseSessionInfo(`Sesión cerrada: ${sessionToClose.key}${warningText}`)
      }
      setSessionToClose(null)
      void loadTopology(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo cerrar la sesión'
      setCloseSessionError(message)
    } finally {
      setClosingSession(false)
    }
  }, [loadTopology, sessionToClose])

  const optimizeSession = useCallback(
    async (session: TopologySession, action: 'compact' | 'cache' | 'refresh') => {
      const key = `${action}:${session.key}`
      setSessionActionBusyKey(key)
      setCloseSessionError('')
      try {
        const response = await fetch('/api/topology/session-optimize', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action,
            sessionKey: session.key,
            agentId: session.agentId
          })
        })
        const payload = (await response.json()) as SessionOptimizeResponse
        if (!response.ok) {
          throw new Error(
            String(payload.error || payload.detail || `session optimize http ${response.status}`)
          )
        }
        const base =
          action === 'compact'
            ? `Compactación ejecutada: ${session.key}`
            : action === 'cache'
              ? `Limpieza de cache/store aplicada: ${session.key}`
              : `Refresh aplicado (contexto reiniciado): ${session.key}`
        const detail = String(payload.resultText || '').trim()
        const warnings = Array.isArray(payload.warnings)
          ? payload.warnings.filter((item) => typeof item === 'string' && item.trim() !== '')
          : []
        const merged = [base, detail, ...warnings].filter((item) => item && item.trim() !== '')
        setCloseSessionInfo(merged.join(' | '))
        void loadTopology(true)
      } catch (err) {
        setCloseSessionError(err instanceof Error ? err.message : 'No se pudo optimizar la sesión')
      } finally {
        setSessionActionBusyKey('')
      }
    },
    [loadTopology]
  )

  const switchMemoryBackend = useCallback(
    async (backend: 'memory-lancedb' | 'memory-core') => {
      setMemorySwitchBusy(true)
      setMemorySwitchError('')
      setMemorySwitchInfo('')
      try {
        const response = await fetch('/api/topology/memory-switch', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ backend })
        })
        const payload = (await response.json()) as MemorySwitchResponse
        if (!response.ok) {
          throw new Error(
            String(payload.error || payload.detail || `memory switch http ${response.status}`)
          )
        }
        const active = String(payload.backend || backend).trim()
        const previous = String(payload.previousBackend || '').trim()
        const warnings = Array.isArray(payload.warnings)
          ? payload.warnings.filter((item) => typeof item === 'string' && item.trim() !== '')
          : []
        const warningText = warnings.length > 0 ? ` | ${warnings.join(' | ')}` : ''
        const previousText = previous ? ` (antes: ${previous})` : ''
        setMemorySwitchInfo(`Memoria activa: ${active}${previousText}${warningText}`)
        void loadTopology(true)
      } catch (err) {
        setMemorySwitchError(
          err instanceof Error ? err.message : 'No se pudo cambiar el backend de memoria'
        )
      } finally {
        setMemorySwitchBusy(false)
      }
    },
    [loadTopology]
  )

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
      setSelectedSubagentId('')
      return
    }
    const exists = topology.agents.some((agent) => agent.id === selectedAgentId)
    if (!exists) {
      const preferred = topology.agents.find((agent) => agent.active) ?? topology.agents[0]
      setSelectedAgentId(preferred.id)
      setSelectedSubagentId('')
    }
  }, [selectedAgentId, topology])

  useEffect(() => {
    if (!selectedSubagentId) {
      return
    }
    const selectedAgent = topology?.agents.find((agent) => agent.id === selectedAgentId)
    if (!selectedAgent) {
      setSelectedSubagentId('')
      return
    }
    const knownSubagents = new Set(selectedAgent.subagentsActive ?? [])
    for (const session of topology?.sessions ?? []) {
      if (session.agentId === selectedAgent.id && session.subagentId) {
        knownSubagents.add(session.subagentId)
      }
    }
    if (!knownSubagents.has(selectedSubagentId)) {
      setSelectedSubagentId('')
    }
  }, [selectedAgentId, selectedSubagentId, topology])

  const selectedAgent = useMemo(
    () => topology?.agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [selectedAgentId, topology]
  )

  const selectedSessions = useMemo(() => {
    if (!topology || !selectedAgent) {
      return []
    }
    let sessions = topology.sessions
      .filter((session) => session.agentId === selectedAgent.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    if (selectedSubagentId) {
      sessions = sessions.filter((session) => (session.subagentId ?? '') === selectedSubagentId)
    }
    return sessions
  }, [selectedAgent, selectedSubagentId, topology])

  const selectedSubagentLabel = useMemo(() => {
    if (!selectedSubagentId) {
      return ''
    }
    return displaySubagentName(selectedSubagentId)
  }, [selectedSubagentId])

  const selectedAgentSubagents = useMemo(() => {
    if (!topology || !selectedAgent) {
      return [] as Array<{ id: string; sessions: number }>
    }
    const counts = new Map<string, number>()
    for (const subID of selectedAgent.subagentsActive ?? []) {
      counts.set(subID, counts.get(subID) ?? 0)
    }
    for (const session of topology.sessions) {
      if (session.agentId === selectedAgent.id && session.subagentId) {
        counts.set(session.subagentId, (counts.get(session.subagentId) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([id, sessions]) => ({ id, sessions }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [selectedAgent, topology])

  const activeAgents = useMemo(() => {
    if (!topology) {
      return []
    }
    return topology.agents.filter((agent) => agent.active)
  }, [topology])

  const graph = useMemo(
    () => buildGraph(topology, selectedAgentId, selectedSubagentId),
    [selectedAgentId, selectedSubagentId, topology]
  )

  useEffect(() => {
    const container = graphContainerRef.current
    if (!container) {
      return
    }
    const updateSize = () => {
      const rect = container.getBoundingClientRect()
      setCanvasSize({
        width: Math.max(320, Math.floor(rect.width)),
        height: Math.max(420, Math.floor(rect.height))
      })
    }
    updateSize()
    const observer = new ResizeObserver(() => updateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (viewportInitializedRef.current) {
      return
    }
    if (canvasSize.width <= 0 || canvasSize.height <= 0) {
      return
    }
    setGraphViewport(buildDefaultViewport(canvasSize.width, canvasSize.height))
    viewportInitializedRef.current = true
  }, [canvasSize.height, canvasSize.width])

  useEffect(() => {
    const canvas = graphCanvasRef.current
    if (!canvas) {
      return
    }
    const dpr = window.devicePixelRatio || 1
    const pixelWidth = Math.max(1, Math.floor(canvasSize.width * dpr))
    const pixelHeight = Math.max(1, Math.floor(canvasSize.height * dpr))
    if (canvas.width !== pixelWidth) {
      canvas.width = pixelWidth
    }
    if (canvas.height !== pixelHeight) {
      canvas.height = pixelHeight
    }
    canvas.style.width = `${canvasSize.width}px`
    canvas.style.height = `${canvasSize.height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawGraphCanvas(ctx, graph, graphViewport, canvasSize.width, canvasSize.height, hoverNodeID)
  }, [canvasSize.height, canvasSize.width, graph, graphViewport, hoverNodeID])

  const resetViewport = useCallback(() => {
    setGraphViewport(buildDefaultViewport(canvasSize.width, canvasSize.height))
  }, [canvasSize.height, canvasSize.width])

  const zoomBy = useCallback(
    (factor: number) => {
      setGraphViewport((prev) =>
        applyZoom(prev, factor, canvasSize.width / 2, canvasSize.height / 2)
      )
    },
    [canvasSize.height, canvasSize.width]
  )

  const updateHoverFromPointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = graphCanvasRef.current
      if (!canvas) {
        return
      }
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const node = pickGraphNode(graph.nodes, x, y, graphViewport)
      setHoverNodeID(node?.id ?? '')
      if (pointerStateRef.current.dragging) {
        canvas.style.cursor = 'grabbing'
      } else if (node && isSelectableGraphNode(node)) {
        canvas.style.cursor = 'pointer'
      } else {
        canvas.style.cursor = 'grab'
      }
    },
    [graph.nodes, graphViewport]
  )

  const handleGraphPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = graphCanvasRef.current
    if (!canvas) {
      return
    }
    const isMouse = event.pointerType === 'mouse'
    if (isMouse) {
      canvas.setPointerCapture(event.pointerId)
    }
    pointerStateRef.current.dragging = isMouse
    pointerStateRef.current.moved = false
    pointerStateRef.current.lastX = event.clientX
    pointerStateRef.current.lastY = event.clientY
    pointerStateRef.current.pointerType = event.pointerType
    if (isMouse) {
      canvas.style.cursor = 'grabbing'
    }
  }, [])

  const handleGraphPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const state = pointerStateRef.current
      if (!state.dragging) {
        if (state.pointerType !== 'mouse') {
          const dx = event.clientX - state.lastX
          const dy = event.clientY - state.lastY
          if (Math.abs(dx) + Math.abs(dy) > 8) {
            state.moved = true
          }
          state.lastX = event.clientX
          state.lastY = event.clientY
        } else {
          updateHoverFromPointer(event)
        }
        return
      }
      const dx = event.clientX - state.lastX
      const dy = event.clientY - state.lastY
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        state.moved = true
      }
      state.lastX = event.clientX
      state.lastY = event.clientY
      setGraphViewport((prev) => ({
        ...prev,
        offsetX: prev.offsetX + dx,
        offsetY: prev.offsetY + dy
      }))
    },
    [updateHoverFromPointer]
  )

  const handleGraphPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = graphCanvasRef.current
      const state = pointerStateRef.current
      if (canvas && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
      if (!state.dragging) {
        if (state.moved) {
          state.pointerType = ''
          state.moved = false
          return
        }
        if (canvas) {
          const rect = canvas.getBoundingClientRect()
          const x = event.clientX - rect.left
          const y = event.clientY - rect.top
          const node = pickGraphNode(graph.nodes, x, y, graphViewport)
          if (node?.type === 'agent' && node.agentId) {
            setSelectedAgentId(node.agentId)
            setSelectedSubagentId('')
          } else if (node?.type === 'subagent' && node.agentId && node.subagentId) {
            setSelectedAgentId(node.agentId)
            setSelectedSubagentId(node.subagentId)
          }
        }
        state.pointerType = ''
        return
      }
      const wasMoved = state.moved
      state.dragging = false
      state.moved = false
      state.pointerType = ''
      if (!wasMoved && canvas) {
        const rect = canvas.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        const node = pickGraphNode(graph.nodes, x, y, graphViewport)
        if (node?.type === 'agent' && node.agentId) {
          setSelectedAgentId(node.agentId)
          setSelectedSubagentId('')
        } else if (node?.type === 'subagent' && node.agentId && node.subagentId) {
          setSelectedAgentId(node.agentId)
          setSelectedSubagentId(node.subagentId)
        }
      }
      if (canvas) {
        canvas.style.cursor = 'grab'
      }
      updateHoverFromPointer(event)
    },
    [graph.nodes, graphViewport, updateHoverFromPointer]
  )

  const handleGraphWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      if (!(event.ctrlKey || event.metaKey || event.altKey)) {
        return
      }
      event.preventDefault()
      const canvas = graphCanvasRef.current
      if (!canvas) {
        return
      }
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const factor = event.deltaY < 0 ? 1.12 : 0.9
      setGraphViewport((prev) => applyZoom(prev, factor, x, y))
    },
    []
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-scroll px-4 py-4 pb-24 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          Topología en vivo
        </div>
        {topology && (
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            <Clock3 className="size-3.5" />
            <span>Actualizado: {new Date(topology.generatedAt).toLocaleTimeString()}</span>
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-blue-500/25 bg-blue-500/8 px-2 py-1 text-xs">
            <Database className="size-3.5 text-blue-700 dark:text-blue-300" />
            <span className="text-blue-700 dark:text-blue-300">
              {memoryBackendLabel(topology?.memory.backend ?? 'memory-core')}
            </span>
            <span className="text-muted-foreground">({String(topology?.memory.status || 'unknown')})</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              memorySwitchBusy ||
              String(topology?.memory.backend || '').trim().toLowerCase() === 'memory-lancedb'
            }
            onClick={() => {
              void switchMemoryBackend('memory-lancedb')
            }}
          >
            {memorySwitchBusy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            LanceDB
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              memorySwitchBusy ||
              String(topology?.memory.backend || '').trim().toLowerCase() === 'memory-core'
            }
            onClick={() => {
              void switchMemoryBackend('memory-core')
            }}
          >
            {memorySwitchBusy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            Core
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void loadTopology(true)
            }}
            disabled={refreshing}
          >
            <RefreshCw className={cn('mr-1 size-3.5', refreshing && 'animate-spin')} />
            Refrescar
          </Button>
        </div>
      </div>
      {memorySwitchInfo && (
        <p className="mb-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-300">
          {memorySwitchInfo}
        </p>
      )}
      {memorySwitchError && (
        <p className="mb-2 rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-300">
          {memorySwitchError}
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
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
        <div className="bg-card border-border rounded-xl border px-3 py-2.5">
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
            Tokens totales
          </p>
          <p className="text-lg font-semibold">{fmtTokens(topology?.summary.totalTokens ?? 0)}</p>
        </div>
        <div className="bg-card border-border rounded-xl border px-3 py-2.5">
          <p className="text-muted-foreground text-[11px] tracking-wide uppercase">Cache leído</p>
          <p className="text-lg font-semibold">{fmtTokens(topology?.summary.cacheReadTokens ?? 0)}</p>
          <p
            className={cn(
              'text-[11px]',
              (topology?.summary.highLoadSessions ?? 0) > 0
                ? 'text-red-600 dark:text-red-300'
                : 'text-muted-foreground'
            )}
          >
            {(topology?.summary.highLoadSessions ?? 0) > 0
              ? `${topology?.summary.highLoadSessions ?? 0} sesiones en alto consumo`
              : 'sin alertas'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 pb-2 xl:grid-cols-12">
        <div className="bg-card border-border min-h-[500px] rounded-2xl border xl:col-span-8">
          <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
            <Activity className="size-4" />
            <p className="text-sm font-medium">Red neuronal de perfiles y agentes</p>
            <div className="ml-auto flex items-center gap-2">
              {topology && (
                <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
                  <Server className="size-3.5" />
                  <span>{topology.server.hostname}</span>
                  <Cpu className="size-3.5" />
                  <span>
                    uptime {fmtAgo(Math.floor(Date.now() / 1000) - topology.server.uptimeSeconds)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="size-7"
                  onClick={() => zoomBy(0.9)}
                  aria-label="Alejar"
                  title="Alejar"
                >
                  <ZoomOut className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="size-7"
                  onClick={() => zoomBy(1.12)}
                  aria-label="Acercar"
                  title="Acercar"
                >
                  <ZoomIn className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="size-7"
                  onClick={resetViewport}
                  aria-label="Recentrar"
                  title="Recentrar vista"
                >
                  <LocateFixed className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <div className="h-full p-2">
            <div
              ref={graphContainerRef}
              className="border-border relative h-[560px] w-full overflow-hidden rounded-xl border touch-pan-y"
            >
              <canvas
                ref={graphCanvasRef}
                className="h-full w-full touch-pan-y"
                onPointerDown={handleGraphPointerDown}
                onPointerMove={handleGraphPointerMove}
                onPointerUp={handleGraphPointerUp}
                onPointerLeave={handleGraphPointerUp}
                onWheel={handleGraphWheel}
              />
              <div className="text-muted-foreground pointer-events-none absolute right-2 bottom-2 rounded-md bg-black/25 px-2 py-0.5 text-[10px]">
                zoom {(graphViewport.scale * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card border-border flex min-h-[500px] flex-col rounded-2xl border xl:col-span-4">
          <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
            <Sparkles className="size-4" />
            <p className="text-sm font-medium">Detalle del agente</p>
          </div>

          <div className="flex flex-1 flex-col gap-3 p-3">
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
                    <p className="text-lg font-semibold">{selectedAgentSubagents.length}</p>
                  </div>
                  <div className="rounded-xl border px-3 py-2.5">
                    <p className="text-muted-foreground text-[11px] uppercase">Tokens acumulados</p>
                    <p className="text-lg font-semibold">{fmtTokens(selectedAgent.totalTokens)}</p>
                    <p className="text-muted-foreground text-[11px]">
                      in {fmtTokens(selectedAgent.inputTokens)} / out {fmtTokens(selectedAgent.outputTokens)}
                    </p>
                  </div>
                  <div className="rounded-xl border px-3 py-2.5">
                    <p className="text-muted-foreground text-[11px] uppercase">Cache y contexto</p>
                    <p className="text-lg font-semibold">{fmtTokens(selectedAgent.cacheReadTokens)}</p>
                    <p
                      className={cn(
                        'text-[11px]',
                        selectedAgent.maxContextUsagePct >= 90
                          ? 'text-red-600 dark:text-red-300'
                          : selectedAgent.maxContextUsagePct >= 70
                            ? 'text-amber-600 dark:text-amber-300'
                            : 'text-muted-foreground'
                      )}
                    >
                      ctx máx {selectedAgent.maxContextUsagePct}% ({fmtTokens(selectedAgent.maxContextTokens)})
                    </p>
                  </div>
                </div>

                {selectedAgentSubagents.length > 0 && (
                  <div className="rounded-xl border px-3 py-2.5">
                    <p className="mb-2 text-[11px] font-semibold tracking-wide uppercase">
                      Subagentes detectados
                    </p>
                    <div className="space-y-1.5">
                      {selectedAgentSubagents.map((subagent) => (
                        <div
                          key={`subagent-row-${selectedAgent.id}-${subagent.id}`}
                          className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs"
                        >
                          <span className="font-medium">{displaySubagentName(subagent.id)}</span>
                          <span className="text-muted-foreground truncate font-mono">
                            {subagent.id}
                          </span>
                          <span className="text-muted-foreground text-[10px]">
                            {subagent.sessions} ses
                          </span>
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
                  {selectedSubagentLabel && (
                    <p className="mb-2 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-700 dark:text-cyan-300">
                      Filtro subagente: {selectedSubagentLabel}
                    </p>
                  )}
                  {closeSessionInfo && (
                    <p className="mb-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                      {closeSessionInfo}
                    </p>
                  )}
                  {closeSessionError && (
                    <p className="mb-2 rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1 text-[11px] text-red-700 dark:text-red-300">
                      {closeSessionError}
                    </p>
                  )}
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
                        <div className="mb-1.5 flex items-start gap-2">
                          <p className="min-w-0 flex-1 truncate font-mono text-[11px]">{session.key}</p>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                              riskBadgeClass(sessionRiskLevel(session))
                            )}
                          >
                            {sessionRiskLevel(session) === 'danger'
                              ? 'alto'
                              : sessionRiskLevel(session) === 'warn'
                                ? 'medio'
                                : 'ok'}
                          </span>
                        </div>
                        <div className="text-muted-foreground grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                          <p>actualizado: {fmtClock(session.updatedAt)}</p>
                          <p>
                            modelo: {session.modelProvider && session.model
                              ? `${session.modelProvider}/${session.model}`
                              : 'n/a'}
                          </p>
                          <p>tokens: {fmtTokens(session.totalTokens)}</p>
                          <p>cache: {fmtTokens(session.cacheReadTokens)}</p>
                          <p>
                            contexto: {session.contextUsagePct}% ({fmtTokens(session.contextTokens)})
                          </p>
                        </div>
                        <div className="mt-2 flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => {
                              void optimizeSession(session, 'compact')
                            }}
                            disabled={sessionActionBusyKey !== '' || closingSession}
                            title="Compactar contexto de sesión"
                          >
                            {sessionActionBusyKey === `compact:${session.key}` && (
                              <Loader2 className="size-3 animate-spin" />
                            )}
                            Compactar
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => {
                              void optimizeSession(session, 'cache')
                            }}
                            disabled={sessionActionBusyKey !== '' || closingSession}
                            title="Limpiar cache/store sin reiniciar la sesión activa"
                          >
                            {sessionActionBusyKey === `cache:${session.key}` && (
                              <Loader2 className="size-3 animate-spin" />
                            )}
                            Cache
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => {
                              void optimizeSession(session, 'refresh')
                            }}
                            disabled={sessionActionBusyKey !== '' || closingSession}
                            title="Refresh de sesión (reinicia contexto)"
                          >
                            {sessionActionBusyKey === `refresh:${session.key}` && (
                              <Loader2 className="size-3 animate-spin" />
                            )}
                            Refresh
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="size-7 text-red-600 hover:bg-red-500/15 hover:text-red-600 dark:text-red-400"
                            onClick={() => {
                              setCloseSessionError('')
                              setSessionToClose(session)
                            }}
                            aria-label={`Cerrar sesión ${session.key}`}
                            title="Cerrar sesión forzada"
                            disabled={sessionActionBusyKey !== '' || closingSession}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={sessionToClose !== null}
        onOpenChange={(open) => {
          if (!open && !closingSession) {
            setSessionToClose(null)
            setCloseSessionError('')
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-red-500" />
              Cerrar sesión forzada
            </DialogTitle>
            <DialogDescription>
              Vas a cerrar manualmente una sesión activa de OpenClaw. Esta acción corta su contexto
              persistido.
            </DialogDescription>
          </DialogHeader>
          {sessionToClose && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border px-3 py-2">
                <p className="text-muted-foreground text-xs">Agente</p>
                <p className="font-medium">{sessionToClose.agentId}</p>
                <p className="text-muted-foreground mt-2 text-xs">Session Key</p>
                <p className="break-all font-mono text-[11px]">{sessionToClose.key}</p>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                <p className="mb-1.5 text-xs font-semibold uppercase">Riesgos</p>
                <ul className="text-muted-foreground space-y-1 text-xs">
                  <li>Se pierde el contexto actual de esa conversación.</li>
                  <li>Si el agente está respondiendo, puede interrumpirse la ejecución.</li>
                  <li>No se puede deshacer el cierre forzado.</li>
                </ul>
              </div>
              {closeSessionError && (
                <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {closeSessionError}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!closingSession) {
                  setSessionToClose(null)
                  setCloseSessionError('')
                }
              }}
              disabled={closingSession}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void confirmCloseSession()
              }}
              disabled={!sessionToClose || closingSession}
            >
              {closingSession && <Loader2 className="size-4 animate-spin" />}
              Cerrar sesión
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {agentPickerOpen && (
        <div className="bg-card border-border fixed right-5 bottom-20 z-30 max-h-[52vh] w-[290px] overflow-auto rounded-2xl border p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Agentes activos</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setAgentPickerOpen(false)}
              aria-label="Cerrar selector de agentes"
            >
              <X className="size-4" />
            </Button>
          </div>
          {activeAgents.length === 0 ? (
            <p className="text-muted-foreground text-xs">No hay agentes activos ahora.</p>
          ) : (
            <div className="space-y-1.5">
              {activeAgents.map((agent) => (
                <button
                  key={`floating-${agent.id}`}
                  type="button"
                  onClick={() => {
                    setSelectedAgentId(agent.id)
                    setSelectedSubagentId('')
                    setAgentPickerOpen(false)
                  }}
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
      )}

      <Button
        type="button"
        variant="default"
        className="fixed right-5 bottom-5 z-30 rounded-full px-4 shadow-lg"
        onClick={() => setAgentPickerOpen((prev) => !prev)}
      >
        <Bot className="mr-2 size-4" />
        <span>Agentes</span>
        <span className="ml-2 rounded-full bg-black/15 px-2 py-0.5 text-xs font-semibold">
          {activeAgents.length}
        </span>
      </Button>
    </div>
  )
}
