/// <reference lib="webworker" />

import { CreateMLCEngine, type MLCEngine } from '@mlc-ai/web-llm'

import type {
  AnyWorkerRequest,
  ChatMessage,
  ChatRequest,
  WorkerErrorResponse,
  WorkerProgressResponse,
  WorkerRequest,
  WorkerResponse,
  WorkerResultResponse,
  WorkerStreamResponse,
} from '../types/worker.types'
import { MAX_CHAT_HISTORY } from '../types/worker.types'

const selfRef = self as DedicatedWorkerGlobalScope
const MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'
const OUT_OF_BOUNDS_MESSAGE =
  'I am an immigration assistant and that information is not in my local survival guide.'
const DISTRESS_TERMS = [
  'passport',
  'locked in',
  'unsafe',
  'trafficking',
  'hurt',
  'stranded',
  'no shelter',
  'domestic violence',
  'emergency',
] as const
const DISTRESS_PATTERNS = new Map(
  DISTRESS_TERMS.map((term) => [term, new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i')]),
)

let enginePromise: Promise<MLCEngine> | null = null

function postResult<T extends WorkerRequest['type']>(
  id: string,
  requestType: T,
  payload: Extract<WorkerResultResponse<T>, { type: 'RESULT' }>['payload'],
): void {
  const response: WorkerResultResponse<T> = {
    id,
    requestType,
    type: 'RESULT',
    payload,
  }

  selfRef.postMessage(response satisfies WorkerResponse<T>)
}

function postProgress<T extends WorkerRequest['type']>(
  id: string,
  requestType: T,
  progress: number,
  message: string,
): void {
  const response: WorkerProgressResponse<T> = {
    id,
    requestType,
    type: 'PROGRESS',
    payload: {
      stage: 'inference',
      progress,
      message,
    },
  }

  selfRef.postMessage(response satisfies WorkerResponse<T>)
}

function postStream<T extends WorkerRequest['type']>(id: string, requestType: T, chunk: string): void {
  const response: WorkerStreamResponse<T> = {
    id,
    requestType,
    type: 'STREAM',
    payload: { chunk },
  }

  selfRef.postMessage(response satisfies WorkerResponse<T>)
}

function postError<T extends WorkerRequest['type']>(id: string, requestType: T, error: unknown): void {
  const response: WorkerErrorResponse<T> = {
    id,
    requestType,
    type: 'ERROR',
    error: error instanceof Error ? error.message : 'Unknown inference worker error.',
  }

  selfRef.postMessage(response satisfies WorkerResponse<T>)
}

async function ensureEngine(
  id: string,
  requestType: WorkerRequest['type'],
): Promise<MLCEngine> {
  if (!enginePromise) {
    enginePromise = CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        postProgress(id, requestType, report.progress * 100, report.text)
      },
    })
  }

  return enginePromise
}

function scanForDistress(prompt: string): string[] {
  return DISTRESS_TERMS.filter((term) => DISTRESS_PATTERNS.get(term)?.test(prompt) ?? false)
}

function buildMessages(request: ChatRequest): ChatMessage[] {
  const hasContext = request.context.length > 0
  const contextBlock = hasContext ? request.context.map((entry) => `- ${entry}`).join('\n') : '- none'

  const systemPrompt =
    request.mode === 'INFO'
      ? [
          'You are Lampad AtlasBridge, an offline-first immigration survival assistant.',
          'Use only the provided local context.',
          `If the context is missing or insufficient, answer exactly: "${OUT_OF_BOUNDS_MESSAGE}"`,
          'Keep the answer concise, factual, and actionable.',
          `Local context:\n${contextBlock}`,
        ].join('\n\n')
      : [
          'You are Lampad AtlasBridge English Tutor.',
          'Respond with a warm answer that includes a translation aid, a grammar note, and a short practice sentence.',
          'Keep it grounded in the user prompt and any provided local context.',
          `Local context:\n${contextBlock}`,
        ].join('\n\n')

  return [
    { role: 'system', content: systemPrompt },
    ...request.history.slice(-MAX_CHAT_HISTORY),
    { role: 'user', content: request.prompt },
  ]
}

async function handleChat(request: WorkerRequest<'CHAT'>): Promise<void> {
  const distressKeywords = scanForDistress(request.payload.prompt)
  const distressTriggered = distressKeywords.length > 0

  if (distressTriggered) {
    postProgress(
      request.id,
      request.type,
      100,
      `Distress trigger detected: ${distressKeywords.join(', ')}`,
    )
  }

  if (request.payload.mode === 'INFO' && request.payload.context.length === 0) {
    postResult(request.id, request.type, {
      text: OUT_OF_BOUNDS_MESSAGE,
      modelId: MODEL_ID,
      mode: request.payload.mode,
      distressTriggered,
      distressKeywords,
      usedContext: request.payload.context,
    })
    return
  }

  const engine = await ensureEngine(request.id, request.type)
  const completion = await engine.chat.completions.create({
    messages: buildMessages(request.payload),
    temperature: request.payload.mode === 'LEARN' ? 0.5 : 0.2,
    max_tokens: 256,
    stream: true,
  })

  let combined = ''

  for await (const chunk of completion) {
    const partial = chunk.choices[0]?.delta?.content ?? ''

    if (!partial) {
      continue
    }

    combined += partial
    postStream(request.id, request.type, partial)
  }

  postResult(request.id, request.type, {
    text: combined.trim() || OUT_OF_BOUNDS_MESSAGE,
    modelId: MODEL_ID,
    mode: request.payload.mode,
    distressTriggered,
    distressKeywords,
    usedContext: request.payload.context,
  })
}

selfRef.onmessage = async (event: MessageEvent<AnyWorkerRequest>) => {
  const request = event.data

  try {
    if (request.type === 'PING') {
      postResult(request.id, request.type, {
        pong: true,
        worker: 'inference',
        receivedAt: performance.now(),
      })
      return
    }

    if (request.type === 'INIT_INFERENCE') {
      await ensureEngine(request.id, request.type)
      postResult(request.id, request.type, {
        modelId: MODEL_ID,
        ready: true,
      })
      return
    }

    if (request.type === 'CHAT') {
      await handleChat(request)
      return
    }

    throw new Error(`Unsupported inference worker request: ${request.type}`)
  } catch (error) {
    postError(request.id, request.type, error)
  }
}

export {}
