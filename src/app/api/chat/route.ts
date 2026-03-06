import type { NextRequest } from 'next/server'
import { azure as azureProvider, createAzure } from '@ai-sdk/azure'
import { createOpenAI } from '@ai-sdk/openai'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type ModelMessage,
  type LanguageModel,
  type ToolSet
} from 'ai'
import {
  assertRequestHasAnyScope,
  getControlPlaneAuthorizationHeader,
  MissingKeycloakBearerTokenError,
  MissingKeycloakScopeError,
  parseScopeList,
  resolveRequestProfileAccess
} from '@/lib/control-plane-auth'
import { getAgentProfileMap, isAgentAllowedForProfiles, pickFirstAllowedAgent } from '@/lib/profile-agent-map'

export const runtime = 'nodejs'

let cachedModel:
  | {
      model: LanguageModel
      isAzure: boolean
      openaiModel?: string
      openaiProvider?: ReturnType<typeof createOpenAI>
    }
  | undefined

/**
 * Helper method to dynamically select and configure the AI model
 * based on environment variables.
 *
 * @returns {object} Configured language model and provider metadata (Azure or OpenAI)
 */
function getModel(): {
  model: LanguageModel
  isAzure: boolean
  openaiModel?: string
  openaiProvider?: ReturnType<typeof createOpenAI>
} {
  if (cachedModel) {
    return cachedModel
  }

  // Check if Azure OpenAI credentials are provided
  const azureResourceName = process.env.AZURE_OPENAI_RESOURCE_NAME
  const azureApiKey = process.env.AZURE_OPENAI_API_KEY
  const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT

  if (azureResourceName && azureApiKey && azureDeployment) {
    // Use Azure OpenAI
    const azure = createAzure({
      resourceName: azureResourceName,
      apiKey: azureApiKey
    })
    cachedModel = { model: azure(azureDeployment), isAzure: true }
    return cachedModel
  }

  // Fallback to OpenAI
  const openaiApiKey = process.env.OPENAI_API_KEY
  let openaiBaseUrl = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1'
  const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  // Ensure baseURL ends with /v1 for OpenAI-compatible APIs
  if (!openaiBaseUrl.endsWith('/v1')) {
    openaiBaseUrl = openaiBaseUrl.replace(/\/$/, '') + '/v1'
  }
  if (!openaiApiKey) {
    throw new Error(
      'No AI provider configured. Please set either Azure OpenAI or OpenAI credentials in environment variables.'
    )
  }

  const openai = createOpenAI({
    apiKey: openaiApiKey,
    baseURL: openaiBaseUrl
  })

  cachedModel = {
    model: openai.chat(openaiModel),
    isAzure: false,
    openaiModel,
    openaiProvider: openai
  }
  return cachedModel
}

type MessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; image: string | URL }
      | {
          type: 'document'
          name: string
          content: string
          mimeType: string
          images?: Array<{
            pageNumber: number
            name: string
            width: number
            height: number
            dataUrl: string
          }>
        }
    >

type ChatCompletionMessage = {
  role: 'assistant' | 'user' | 'system'
  content: MessageContent
}

type ChatRequestPayload = {
  prompt: string
  messages: ChatCompletionMessage[]
  input: MessageContent
  sessionId?: string
  agentId?: string
  think?: string
}

type ControlPlaneTokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

type ControlPlaneUsage = {
  request?: ControlPlaneTokenUsage
  session?: ControlPlaneTokenUsage
  modelProvider?: string
  model?: string
  promptTokens?: number
  capturedAt?: string
}

type ControlPlaneChatResponse = {
  text?: string
  usage?: ControlPlaneUsage
  agentId?: string
  sessionKey?: string
  error?: string
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function normalizeUsagePart(raw: unknown): ControlPlaneTokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const part: ControlPlaneTokenUsage = {
    inputTokens: toNumber(row.inputTokens),
    outputTokens: toNumber(row.outputTokens),
    totalTokens: toNumber(row.totalTokens),
    cacheReadTokens: toNumber(row.cacheReadTokens),
    cacheWriteTokens: toNumber(row.cacheWriteTokens)
  }
  if (
    part.inputTokens === undefined &&
    part.outputTokens === undefined &&
    part.totalTokens === undefined &&
    part.cacheReadTokens === undefined &&
    part.cacheWriteTokens === undefined
  ) {
    return undefined
  }
  return part
}

function buildTokenUsageDataPart(
  usage: ControlPlaneUsage | undefined,
  agentId?: string,
  sessionKey?: string
): Record<string, unknown> | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const data: Record<string, unknown> = {}
  const request = normalizeUsagePart(usage.request)
  const session = normalizeUsagePart(usage.session)
  if (request) data.request = request
  if (session) data.session = session
  if (typeof usage.modelProvider === 'string' && usage.modelProvider.trim()) {
    data.modelProvider = usage.modelProvider.trim()
  }
  if (typeof usage.model === 'string' && usage.model.trim()) {
    data.model = usage.model.trim()
  }
  const promptTokens = toNumber(usage.promptTokens)
  if (promptTokens !== undefined) {
    data.promptTokens = promptTokens
  }
  if (typeof usage.capturedAt === 'string' && usage.capturedAt.trim()) {
    data.capturedAt = usage.capturedAt.trim()
  }
  if (typeof agentId === 'string' && agentId.trim()) {
    data.agentId = agentId.trim()
  }
  if (typeof sessionKey === 'string' && sessionKey.trim()) {
    data.sessionKey = sessionKey.trim()
  }
  return Object.keys(data).length > 0 ? data : undefined
}

function convertToCoreMessage(msg: ChatCompletionMessage): ModelMessage {
  if (msg.role === 'system') {
    return {
      role: 'system',
      content: typeof msg.content === 'string' ? msg.content : ''
    }
  }

  if (msg.role === 'user') {
    if (typeof msg.content === 'string') {
      return {
        role: 'user',
        content: msg.content
      }
    }
    return {
      role: 'user',
      content: msg.content.flatMap((part) => {
        if (part.type === 'text') {
          return [{ type: 'text', text: part.text }]
        } else if (part.type === 'image') {
          return [{ type: 'image', image: part.image }]
        } else {
          // Convert document to text and include images
          const result: Array<
            { type: 'text'; text: string } | { type: 'image'; image: string | URL }
          > = []

          // Add document text
          result.push({
            type: 'text',
            text: `[Document: ${part.name}]\n\n${part.content}`
          })

          // Add document images if present
          if (part.images && part.images.length > 0) {
            result.push({
              type: 'text',
              text: `\n\n[This document contains ${part.images.length} image(s)]`
            })

            part.images.forEach((img) => {
              result.push({
                type: 'image',
                image: img.dataUrl
              })
            })
          }

          return result
        }
      })
    }
  }

  // assistant
  return {
    role: 'assistant',
    content: typeof msg.content === 'string' ? msg.content : ''
  }
}

function readRequiredChatScopes(): string[] {
  const configured = parseScopeList(process.env.WEB_CHAT_REQUIRED_CHAT_SCOPES)
  if (configured.length > 0) {
    return configured
  }
  return ['chat.write']
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const toToolSetEntry = <T>(tool: T): ToolSet[string] => tool as ToolSet[string]
    const payload = (await req.json()) as ChatRequestPayload
    const { prompt, messages, input, sessionId, agentId, think } = payload

    const acceptHeader = req.headers.get('accept') ?? ''
    const wantsUiStream = acceptHeader.includes('text/event-stream')
    const profileAccess = await resolveRequestProfileAccess(req)
    try {
      await assertRequestHasAnyScope(req, readRequiredChatScopes())
    } catch (error) {
      if (error instanceof MissingKeycloakBearerTokenError) {
        return new Response('missing keycloak bearer token', {
          status: 401,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      }
      if (error instanceof MissingKeycloakScopeError) {
        return new Response(error.message, {
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      }
      throw error
    }
    if (profileAccess.mode === 'denied') {
      return new Response('missing required profile scope (profile.all or profile.<id>)', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    }

    const controlPlaneChatURL = process.env.CONTROL_PLANE_CHAT_URL?.trim()
    const controlPlaneChatStreamURL = process.env.CONTROL_PLANE_CHAT_STREAM_URL?.trim()
    if (controlPlaneChatURL) {
      let authHeader: Record<string, string> | undefined
      try {
        authHeader = await getControlPlaneAuthorizationHeader(req)
      } catch (error) {
        if (error instanceof MissingKeycloakBearerTokenError) {
          return new Response('missing keycloak bearer token', {
            status: 401,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          })
        }
        throw error
      }
      const defaultAgentID = process.env.CONTROL_PLANE_AGENT_ID?.trim() || ''
      let resolvedAgentID = (typeof agentId === 'string' ? agentId.trim() : '') || defaultAgentID
      if (profileAccess.mode === 'restricted') {
        const byAgent = await getAgentProfileMap()
        if (
          !resolvedAgentID ||
          !isAgentAllowedForProfiles(resolvedAgentID, profileAccess.allowedProfiles, byAgent)
        ) {
          const fallbackAgent = pickFirstAllowedAgent(profileAccess.allowedProfiles, byAgent)
          if (!fallbackAgent) {
            return new Response('no allowed agent for current profile scope', {
              status: 403,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            })
          }
          resolvedAgentID = fallbackAgent
        }
      }
      const controlPlanePayload = {
        prompt,
        messages,
        input,
        sessionId: sessionId ?? undefined,
        agentId: resolvedAgentID || undefined,
        think: think ?? process.env.CONTROL_PLANE_THINK?.trim() ?? undefined
      }
      const controlPlaneHeaders = {
        'Content-Type': 'application/json',
        ...(authHeader || {})
      }

      if (wantsUiStream && controlPlaneChatStreamURL) {
        const streamResponse = await fetch(controlPlaneChatStreamURL, {
          method: 'POST',
          headers: {
            ...controlPlaneHeaders,
            Accept: 'text/event-stream'
          },
          body: JSON.stringify(controlPlanePayload)
        })
        if (!streamResponse.ok || !streamResponse.body) {
          let errorText = ''
          try {
            errorText = (await streamResponse.text()).trim()
          } catch {
            // ignore
          }
          throw new Error(errorText || `control-plane stream http ${streamResponse.status}`)
        }
        return new Response(streamResponse.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'x-vercel-ai-ui-message-stream': 'v1'
          }
        })
      }

      const response = await fetch(controlPlaneChatURL, {
        method: 'POST',
        headers: controlPlaneHeaders,
        body: JSON.stringify(controlPlanePayload)
      })

      let body: ControlPlaneChatResponse = {}
      try {
        body = (await response.json()) as ControlPlaneChatResponse
      } catch {
        // keep empty payload fallback
      }
      if (!response.ok || (body.error && body.error.trim())) {
        const msg = body.error?.trim() || `control-plane chat http ${response.status}`
        throw new Error(msg)
      }
      const text = (body.text ?? '').trim()
      if (!wantsUiStream) {
        return new Response(text, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      }

      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          const messageId = `cp-${Date.now()}`
          const usageData = buildTokenUsageDataPart(body.usage, body.agentId, body.sessionKey)
          writer.write({ type: 'start', messageId } as never)
          writer.write({ type: 'text-start', id: messageId } as never)
          writer.write({ type: 'text-delta', id: messageId, delta: text } as never)
          writer.write({ type: 'text-end', id: messageId } as never)
          if (usageData) {
            writer.write({ type: 'data-tokenUsage', data: usageData } as never)
          }
          writer.write({ type: 'finish' } as never)
        }
      })
      return createUIMessageStreamResponse({ stream })
    }

    const messagesWithHistory: ModelMessage[] = [
      { role: 'system', content: prompt },
      ...messages.map(convertToCoreMessage),
      convertToCoreMessage({ role: 'user', content: input })
    ]

    const { model, isAzure, openaiModel, openaiProvider } = getModel()

    const runStream = async () => {
      if (isAzure) {
        const canUseWebSearch = true
        console.log('[Chat API] Auto web search:', {
          provider: 'azure',
          canUseWebSearch,
          modelWillDecide: canUseWebSearch
        })

        const tools = {
          // Azure Web Search (preview)
          // The model will automatically decide when to use this tool
          web_search_preview: toToolSetEntry(
            azureProvider.tools.webSearchPreview({
              searchContextSize: 'high'
              // userLocation: {
              //   type: 'approximate',
              //   country: 'CN'
              // }
            })
          )
        } satisfies ToolSet

        return streamText({
          model,
          messages: messagesWithHistory,
          tools
          // Note: No toolChoice specified - let the model decide intelligently
        })
      }

      if (openaiProvider && openaiModel) {
        try {
          const tools = {
            // OpenAI Web Search (preview)
            // The model will automatically decide when to use this tool
            web_search_preview: toToolSetEntry(
              openaiProvider.tools.webSearchPreview({
                searchContextSize: 'high'
              })
            )
          } satisfies ToolSet

          return await streamText({
            model: openaiProvider.responses(openaiModel),
            messages: messagesWithHistory,
            tools
          })
        } catch (error) {
          console.error('[Chat API] Web search failed, falling back to chat:', error)
        }
      }

      console.log('[Chat API] Chat completion fallback:', {
        provider: 'openai',
        model: openaiModel ?? 'unknown'
      })

      return streamText({
        model,
        messages: messagesWithHistory
      })
    }

    if (!wantsUiStream) {
      const result = await runStream()
      return result.toTextStreamResponse()
    }

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const result = await runStream()
        writer.merge(result.toUIMessageStream({ sendSources: true, sendReasoning: false }))
      },
      onFinish: ({ finishReason, responseMessage }) => {
        console.log('[Chat API] UI stream finished:', {
          finishReason,
          messageId: responseMessage?.id
        })
      }
    })

    return createUIMessageStreamResponse({
      stream
    })
  } catch (error) {
    console.error('[Chat API] Error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
