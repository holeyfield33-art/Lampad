/// <reference lib="webworker" />

import { env, pipeline, type FeatureExtractionPipeline, type Tensor } from '@xenova/transformers'

import type {
  AnyWorkerRequest,
  KnowledgeBundle,
  SearchMatch,
  WorkerErrorResponse,
  WorkerProgressResponse,
  WorkerRequest,
  WorkerResponse,
  WorkerResultResponse,
} from '../types/worker.types'

const selfRef = self as DedicatedWorkerGlobalScope
const RETRIEVAL_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

let knowledgeBundle: KnowledgeBundle | null = null
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null

env.allowLocalModels = false
env.useBrowserCache = true

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
      stage: 'retrieval',
      progress,
      message,
    },
  }

  selfRef.postMessage(response satisfies WorkerResponse<T>)
}

function postError<T extends WorkerRequest['type']>(id: string, requestType: T, error: unknown): void {
  const response: WorkerErrorResponse<T> = {
    id,
    requestType,
    type: 'ERROR',
    error: error instanceof Error ? error.message : 'Unknown retrieval worker error.',
  }

  selfRef.postMessage(response satisfies WorkerResponse<T>)
}

async function ensureExtractor(
  id: string,
  requestType: WorkerRequest['type'],
): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', RETRIEVAL_MODEL, {
      progress_callback: (progress: { progress?: number; status?: string; file?: string }) => {
        const fraction = typeof progress.progress === 'number' ? progress.progress * 100 : 0
        const label =
          typeof progress.status === 'string'
            ? progress.status
            : typeof progress.file === 'string'
              ? progress.file
              : 'Loading multilingual embedding model...'

        postProgress(id, requestType, fraction, label)
      },
    })
  }

  return extractorPromise
}

async function embedTexts(
  texts: string[],
  id: string,
  requestType: WorkerRequest['type'],
): Promise<{ dimension: number; embeddings: Float32Array }> {
  const extractor = await ensureExtractor(id, requestType)
  const tensor = (await extractor(texts, { pooling: 'mean', normalize: true })) as Tensor
  const typedArray =
    tensor.data instanceof Float32Array ? tensor.data : Float32Array.from(tensor.data as ArrayLike<number>)
  const dimension = tensor.dims[tensor.dims.length - 1] ?? 0

  return {
    dimension,
    embeddings: typedArray,
  }
}

function cosineSearch(
  queryEmbedding: Float32Array,
  bundle: KnowledgeBundle,
  topK: number,
): { matches: SearchMatch[]; searchMs: number } {
  const startedAt = performance.now()
  const results: SearchMatch[] = []

  for (let row = 0; row < bundle.entries.length; row += 1) {
    let score = 0
    const offset = row * bundle.dimension

    for (let column = 0; column < bundle.dimension; column += 1) {
      score += queryEmbedding[column] * bundle.embeddings[offset + column]
    }

    results.push({
      ...bundle.entries[row],
      score,
    })
  }

  results.sort((left, right) => right.score - left.score)

  return {
    matches: results.slice(0, topK),
    searchMs: performance.now() - startedAt,
  }
}

selfRef.onmessage = async (event: MessageEvent<AnyWorkerRequest>) => {
  const request = event.data

  try {
    if (request.type === 'PING') {
      postResult(request.id, request.type, {
        pong: true,
        worker: 'retrieval',
        receivedAt: performance.now(),
      })
      return
    }

    if (request.type === 'INIT_RETRIEVAL') {
      await ensureExtractor(request.id, request.type)
      postResult(request.id, request.type, {
        model: RETRIEVAL_MODEL,
        ready: true,
      })
      return
    }

    if (request.type === 'SEED_KNOWLEDGE') {
      const { entries } = request.payload
      postProgress(request.id, request.type, 5, 'Embedding local Milpitas and Santa Clara County guide...')
      const { dimension, embeddings } = await embedTexts(
        entries.map((entry: (typeof entries)[number]) => entry.text),
        request.id,
        request.type,
      )

      knowledgeBundle = {
        model: RETRIEVAL_MODEL,
        dimension,
        createdAt: new Date().toISOString(),
        entries,
        embeddings,
      }

      postResult(request.id, request.type, knowledgeBundle)
      return
    }

    if (request.type === 'SEARCH_KNOWLEDGE') {
      const { payload } = request

      if (!knowledgeBundle) {
        postResult(request.id, request.type, {
          bundleReady: false,
          query: payload.query,
          topK: payload.topK,
          threshold: payload.threshold,
          searchMs: 0,
          matches: [],
        })
        return
      }

      const { embeddings } = await embedTexts([payload.query], request.id, request.type)
      const queryEmbedding = embeddings.slice(0, knowledgeBundle.dimension)
      const { matches, searchMs } = cosineSearch(queryEmbedding, knowledgeBundle, payload.topK)

      postResult(request.id, request.type, {
        bundleReady: true,
        query: payload.query,
        topK: payload.topK,
        threshold: payload.threshold,
        searchMs,
        matches,
      })
      return
    }

    throw new Error(`Unsupported retrieval worker request: ${request.type}`)
  } catch (error) {
    postError(request.id, request.type, error)
  }
}

export {}
