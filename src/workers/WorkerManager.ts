import type {
  AnyWorkerResponse,
  WorkerProgressPayload,
  WorkerRequest,
  WorkerRequestPayloadMap,
  WorkerRequestType,
  WorkerResultPayloadMap,
  WorkerStreamPayload,
} from '../types/worker.types'

export type WorkerTarget = 'inference' | 'retrieval'

type DeferredPromise<T> = {
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
  target: WorkerTarget
}

type RequestCallbacks = {
  onProgress?: (payload: WorkerProgressPayload) => void
  onStream?: (payload: WorkerStreamPayload) => void
}

export class WorkerManager {
  private readonly workers: Record<WorkerTarget, Worker>

  private readonly pending = new Map<string, DeferredPromise<unknown>>()

  private readonly callbacks = new Map<string, RequestCallbacks>()

  constructor() {
    this.workers = {
      inference: new Worker(new URL('./inference.worker.ts', import.meta.url), {
        type: 'module',
      }),
      retrieval: new Worker(new URL('./retrieval.worker.ts', import.meta.url), {
        type: 'module',
      }),
    }

    this.bindWorker('inference')
    this.bindWorker('retrieval')
  }

  async send<T extends WorkerRequestType>(
    target: WorkerTarget,
    type: T,
    payload: WorkerRequestPayloadMap[T],
    callbacks?: RequestCallbacks,
  ): Promise<WorkerResultPayloadMap[T]> {
    const id = crypto.randomUUID()
    const workerRequest: WorkerRequest<T> = { id, type, payload }

    return new Promise<WorkerResultPayloadMap[T]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, target })
      this.callbacks.set(id, callbacks ?? {})
      this.workers[target].postMessage(workerRequest)
    })
  }

  dispose(): void {
    for (const worker of Object.values(this.workers)) {
      worker.terminate()
    }

    for (const [id, deferred] of this.pending.entries()) {
      deferred.reject(new Error(`Worker request ${id} was cancelled during disposal.`))
    }

    this.pending.clear()
    this.callbacks.clear()
  }

  private bindWorker(target: WorkerTarget): void {
    const worker = this.workers[target]

    worker.addEventListener('message', (event: MessageEvent<AnyWorkerResponse>) => {
      const message = event.data
      const deferred = this.pending.get(message.id)
      const requestCallbacks = this.callbacks.get(message.id)

      if (!deferred) {
        return
      }

      if (message.type === 'PROGRESS') {
        requestCallbacks?.onProgress?.(message.payload)
        return
      }

      if (message.type === 'STREAM') {
        requestCallbacks?.onStream?.(message.payload)
        return
      }

      this.pending.delete(message.id)
      this.callbacks.delete(message.id)

      if (message.type === 'ERROR') {
        deferred.reject(new Error(message.error))
        return
      }

      deferred.resolve(message.payload)
    })

    worker.addEventListener('error', (event) => {
      const message = event.message || `Unhandled ${target} worker error.`

      for (const [id, deferred] of this.pending.entries()) {
        if (deferred.target !== target) {
          continue
        }

        deferred.reject(new Error(message))
        this.pending.delete(id)
        this.callbacks.delete(id)
      }
    })
  }
}
