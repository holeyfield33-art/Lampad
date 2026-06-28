export type AppMode = 'INFO' | 'LEARN'

export const DEFAULT_SOS_ENDPOINT = 'https://lampad-backend.onrender.com/api/sos'
export const MAX_CHAT_HISTORY = 4

export type WorkerRequestType =
  | 'PING'
  | 'INIT_INFERENCE'
  | 'INIT_RETRIEVAL'
  | 'SEED_KNOWLEDGE'
  | 'SEARCH_KNOWLEDGE'
  | 'CHAT'

export type WorkerResponseType = 'RESULT' | 'ERROR' | 'PROGRESS' | 'STREAM'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface KnowledgeEntry {
  id: string
  title: string
  text: string
  locale: string
  category: string
}

export interface KnowledgeBundle {
  model: string
  dimension: number
  createdAt: string
  entries: KnowledgeEntry[]
  embeddings: Float32Array
}

export interface SearchMatch extends KnowledgeEntry {
  score: number
}

export interface SearchRequest {
  query: string
  topK: number
  threshold: number
}

export interface SearchResponsePayload {
  bundleReady: boolean
  query: string
  topK: number
  threshold: number
  searchMs: number
  matches: SearchMatch[]
}

export interface PingResponsePayload {
  pong: true
  worker: 'inference' | 'retrieval'
  receivedAt: number
}

export interface WorkerProgressPayload {
  stage: string
  progress: number
  message: string
}

export interface WorkerStreamPayload {
  chunk: string
}

export interface InferenceInitPayload {
  modelId: string
  ready: boolean
}

export interface RetrievalInitPayload {
  model: string
  ready: boolean
}

export interface ChatRequest {
  mode: AppMode
  prompt: string
  context: string[]
  history: ChatMessage[]
}

export interface ChatResponsePayload {
  text: string
  modelId: string
  mode: AppMode
  distressTriggered: boolean
  distressKeywords: string[]
  usedContext: string[]
}

export interface WorkerRequestPayloadMap {
  PING: null
  INIT_INFERENCE: null
  INIT_RETRIEVAL: null
  SEED_KNOWLEDGE: {
    entries: KnowledgeEntry[]
  }
  SEARCH_KNOWLEDGE: SearchRequest
  CHAT: ChatRequest
}

export interface WorkerResultPayloadMap {
  PING: PingResponsePayload
  INIT_INFERENCE: InferenceInitPayload
  INIT_RETRIEVAL: RetrievalInitPayload
  SEED_KNOWLEDGE: KnowledgeBundle
  SEARCH_KNOWLEDGE: SearchResponsePayload
  CHAT: ChatResponsePayload
}

export interface WorkerRequest<T extends WorkerRequestType = WorkerRequestType> {
  id: string
  type: T
  payload: WorkerRequestPayloadMap[T]
}

export type AnyWorkerRequest = {
  [K in WorkerRequestType]: WorkerRequest<K>
}[WorkerRequestType]

interface WorkerEnvelope<T extends WorkerRequestType> {
  id: string
  requestType: T
}

export interface WorkerResultResponse<T extends WorkerRequestType = WorkerRequestType>
  extends WorkerEnvelope<T> {
  type: 'RESULT'
  payload: WorkerResultPayloadMap[T]
}

export interface WorkerProgressResponse<T extends WorkerRequestType = WorkerRequestType>
  extends WorkerEnvelope<T> {
  type: 'PROGRESS'
  payload: WorkerProgressPayload
}

export interface WorkerStreamResponse<T extends WorkerRequestType = WorkerRequestType>
  extends WorkerEnvelope<T> {
  type: 'STREAM'
  payload: WorkerStreamPayload
}

export interface WorkerErrorResponse<T extends WorkerRequestType = WorkerRequestType>
  extends WorkerEnvelope<T> {
  type: 'ERROR'
  error: string
}

export type WorkerResponse<T extends WorkerRequestType = WorkerRequestType> =
  | WorkerResultResponse<T>
  | WorkerProgressResponse<T>
  | WorkerStreamResponse<T>
  | WorkerErrorResponse<T>

export type AnyWorkerResponse = {
  [K in WorkerRequestType]: WorkerResponse<K>
}[WorkerRequestType]
