import { WorkerRequest, WorkerResponse, WorkerRequestType, AppMode } from '../types/worker.types';

interface DeferredPromise {
  resolve: (value: any) => void;
  reject: (err: any) => void;
  onProgress?: (data: any) => void;
}

export class WorkerManager {
  private inferenceWorker: Worker | null = null;
  private retrievalWorker: Worker | null = null;
  private promises = new Map<string, DeferredPromise>();

  constructor() {
    this.initWorkers();
  }

  private initWorkers() {
    // Vite standard ESM worker instantiation
    try {
      this.inferenceWorker = new Worker(
        new URL('./inference.worker.ts', import.meta.url),
        { type: 'module' }
      );
      this.retrievalWorker = new Worker(
        new URL('./retrieval.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.inferenceWorker.addEventListener('message', (e) => this.handleMessage(e.data));
      this.retrievalWorker.addEventListener('message', (e) => this.handleMessage(e.data));
    } catch (error) {
      console.error('Failed to initialize workers:', error);
    }
  }

  private handleMessage(data: WorkerResponse) {
    const { id, type, status, payload } = data;
    const deferred = this.promises.get(id);
    if (!deferred) {
      // Could be an un-targeted message or global event
      return;
    }

    if (status === 'PROGRESS') {
      if (deferred.onProgress) {
        deferred.onProgress(payload);
      }
    } else if (status === 'SUCCESS') {
      deferred.resolve(payload);
      this.promises.delete(id);
    } else if (status === 'ERROR') {
      deferred.reject(new Error(payload || `Worker error during ${type}`));
      this.promises.delete(id);
    }
  }

  private sendRequest(
    worker: Worker | null,
    type: WorkerRequestType,
    payload?: any,
    onProgress?: (data: any) => void
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!worker) {
        return reject(new Error('Worker is not initialized'));
      }

      // Generate a crypto or fallback UUID
      const id = typeof crypto !== 'undefined' && crypto.randomUUID 
        ? crypto.randomUUID() 
        : Math.random().toString(36).substring(2, 15);

      this.promises.set(id, { resolve, reject, onProgress });

      const request: WorkerRequest = { id, type, payload };
      worker.postMessage(request);
    });
  }

  /**
   * Ping both workers to measure message-passing roundtrip latency.
   */
  public async pingWorkers(): Promise<{ inferenceLatency: number; retrievalLatency: number }> {
    const t0_inf = performance.now();
    await this.sendRequest(this.inferenceWorker, 'PING');
    const t1_inf = performance.now();

    const t0_ret = performance.now();
    await this.sendRequest(this.retrievalWorker, 'PING');
    const t1_ret = performance.now();

    return {
      inferenceLatency: t1_inf - t0_inf,
      retrievalLatency: t1_ret - t0_ret,
    };
  }

  /**
   * Triggers loading of Qwen2.5 MLC Engine inside the inference worker
   */
  public initInferenceEngine(onProgress: (progress: any) => void): Promise<void> {
    return this.sendRequest(this.inferenceWorker, 'INIT_ENGINE', null, onProgress);
  }

  /**
   * Runs local LLM generation with streaming updates
   */
  public generate(
    prompt: string,
    context: string,
    mode: AppMode,
    onProgress: (chunk: string) => void
  ): Promise<{ text: string; hasDistress: boolean; safetyFlags: string[] }> {
    return this.sendRequest(
      this.inferenceWorker,
      'GENERATE',
      { prompt, context, mode },
      onProgress
    );
  }

  /**
   * Initializes or loads the embedding engine inside retrieval worker
   */
  public initRetrievalEngine(onProgress: (progress: any) => void): Promise<void> {
    return this.sendRequest(this.retrievalWorker, 'INIT_ENGINE', null, onProgress);
  }

  /**
   * Feeds raw text chunks to the retrieval worker to build embeddings
   */
  public vectorizeBundle(chunks: string[]): Promise<{ count: number; dimension: number }> {
    return this.sendRequest(this.retrievalWorker, 'VECTORIZE_BUNDLE', { chunks });
  }

  /**
   * Performs real-time brute force Cosine Similarity search on built knowledge bundle
   */
  public cosineSearch(
    query: string,
    topK: number = 3
  ): Promise<Array<{ chunk: string; score: number }>> {
    return this.sendRequest(this.retrievalWorker, 'COSINE_SEARCH', { query, topK });
  }

  /**
   * Cleanup method to terminate active worker threads if needed
   */
  public terminate() {
    if (this.inferenceWorker) {
      this.inferenceWorker.terminate();
      this.inferenceWorker = null;
    }
    if (this.retrievalWorker) {
      this.retrievalWorker.terminate();
      this.retrievalWorker = null;
    }
    this.promises.clear();
  }
}

export const workerManager = new WorkerManager();
