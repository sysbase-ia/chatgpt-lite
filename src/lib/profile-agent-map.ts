import { readFile } from 'fs/promises'

type AgentProfileCache = {
  expiresAtMs: number
  byAgent: Map<string, string>
}

let cachedMap: AgentProfileCache | undefined

function normalizeProfileID(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function normalizeAgentID(value: string): string {
  return String(value || '').trim()
}

function readMapFilePath(): string {
  const configured = String(process.env.WEB_CHAT_PROFILE_AGENT_MAP_FILE || '').trim()
  if (configured) {
    return configured
  }
  return '/opt/sysbase/components/openclaw/config/profile_agents.map'
}

function readCacheTTLms(): number {
  const raw = String(process.env.WEB_CHAT_PROFILE_AGENT_MAP_CACHE_SECONDS || '15').trim()
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 15_000
  }
  return Math.floor(parsed * 1000)
}

function parseProfileAgentMap(content: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const parts = line.split('|')
    if (parts.length < 2) {
      continue
    }
    const profileID = normalizeProfileID(parts[0] || '')
    const agentID = normalizeAgentID(parts[1] || '')
    if (!profileID || !agentID) {
      continue
    }
    out.set(agentID, profileID)
  }
  return out
}

export async function getAgentProfileMap(): Promise<Map<string, string>> {
  if (cachedMap && Date.now() < cachedMap.expiresAtMs) {
    return cachedMap.byAgent
  }
  const path = readMapFilePath()
  try {
    const content = await readFile(path, 'utf8')
    const byAgent = parseProfileAgentMap(content)
    cachedMap = {
      expiresAtMs: Date.now() + readCacheTTLms(),
      byAgent
    }
    return byAgent
  } catch {
    cachedMap = {
      expiresAtMs: Date.now() + readCacheTTLms(),
      byAgent: new Map<string, string>()
    }
    return cachedMap.byAgent
  }
}

export function isAgentAllowedForProfiles(
  agentIDRaw: string,
  allowedProfilesRaw: string[],
  byAgent: Map<string, string>
): boolean {
  const agentID = normalizeAgentID(agentIDRaw)
  if (!agentID) {
    return false
  }
  const profile = normalizeProfileID(byAgent.get(agentID) || '')
  if (!profile) {
    return false
  }
  const allowedProfiles = new Set(
    (allowedProfilesRaw || [])
      .map((value) => normalizeProfileID(value))
      .filter((value) => value !== '')
  )
  return allowedProfiles.has(profile)
}

export function pickFirstAllowedAgent(
  allowedProfilesRaw: string[],
  byAgent: Map<string, string>
): string {
  const allowedProfiles = new Set(
    (allowedProfilesRaw || [])
      .map((value) => normalizeProfileID(value))
      .filter((value) => value !== '')
  )
  if (allowedProfiles.size === 0) {
    return ''
  }

  const candidates: string[] = []
  for (const [agentID, profileID] of byAgent.entries()) {
    if (!agentID) {
      continue
    }
    if (allowedProfiles.has(normalizeProfileID(profileID))) {
      candidates.push(agentID)
    }
  }
  candidates.sort()
  return candidates[0] || ''
}
