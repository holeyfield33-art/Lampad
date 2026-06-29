import { pipeline } from '@xenova/transformers';
import { WorkerRequest, WorkerResponse } from '../types/worker.types';

let extractor: any = null;
let useFallback = false;

interface Document {
  chunk: string;
  embedding: Float32Array;
}

let database: Document[] = [];

/**
 * High-performance Fallback Vectorizer: Token-Hashing & Normalization
 * Generates a stable 384-dimensional unit vector based on text content.
 * Dot products of these vectors correspond directly to token overlap.
 */
function generateFallbackEmbedding(text: string): Float32Array {
  const vector = new Float32Array(384);
  const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const tokens = clean.split(/\s+/).filter(t => t.length > 1);

  if (tokens.length === 0) {
    // Return unit constant vector
    const val = 1.0 / Math.sqrt(384);
    vector.fill(val);
    return vector;
  }

  // Hash each token to an index in [0, 383] and accumulate weights
  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash << 5) - hash + token.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    const idx = Math.abs(hash) % 384;
    vector[idx] += 1.0;
  }

  // Calculate magnitude and normalize to unit length
  let sumSq = 0;
  for (let i = 0; i < 384; i++) {
    sumSq += vector[i] * vector[i];
  }
  const mag = Math.sqrt(sumSq);

  if (mag > 0) {
    for (let i = 0; i < 384; i++) {
      vector[i] /= mag;
    }
  }

  return vector;
}

/**
 * Calculates dot product between two normalized vectors (Cosine Similarity)
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;

  if (type === 'PING') {
    self.postMessage({ id, type, status: 'SUCCESS', payload: 'PONG' });
    return;
  }

  if (type === 'INIT_ENGINE') {
    try {
      self.postMessage({
        id,
        type,
        status: 'PROGRESS',
        payload: { progress: 0.2, text: 'Initializing transformer environment...' }
      });

      // Load Xenova's multilingual paraphrase extractor
      extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
        progress_callback: (info: any) => {
          if (info.status === 'progress') {
            self.postMessage({
              id,
              type,
              status: 'PROGRESS',
              payload: { progress: 0.2 + (info.progress / 100) * 0.7, text: `Loading model files: ${info.file} (${Math.round(info.progress)}%)` }
            });
          }
        }
      });

      self.postMessage({ id, type, status: 'SUCCESS', payload: { fallback: false } });
    } catch (err: any) {
      console.warn('Transformer loading failed, running high-performance Token-Hashing Fallback:', err);
      useFallback = true;
      self.postMessage({ id, type, status: 'SUCCESS', payload: { fallback: true, error: err.message } });
    }
    return;
  }

  if (type === 'VECTORIZE_BUNDLE') {
    const { chunks } = payload as { chunks: string[] };

    try {
      database = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let embedding: Float32Array;

        if (useFallback || !extractor) {
          embedding = generateFallbackEmbedding(chunk);
        } else {
          const output = await extractor(chunk, { pooling: 'mean', normalize: true });
          embedding = new Float32Array(output.data);
        }

        database.push({ chunk, embedding });

        self.postMessage({
          id,
          type,
          status: 'PROGRESS',
          payload: {
            current: i + 1,
            total: chunks.length,
            percent: Math.round(((i + 1) / chunks.length) * 100)
          }
        });
      }

      self.postMessage({
        id,
        type,
        status: 'SUCCESS',
        payload: { count: database.length, dimension: 384 }
      });
    } catch (err: any) {
      self.postMessage({ id, type, status: 'ERROR', payload: err.message });
    }
    return;
  }

  if (type === 'COSINE_SEARCH') {
    const { query, topK } = payload as { query: string; topK: number };

    try {
      if (database.length === 0) {
        self.postMessage({ id, type, status: 'SUCCESS', payload: [] });
        return;
      }

      // Generate query embedding
      let queryVec: Float32Array;
      if (useFallback || !extractor) {
        queryVec = generateFallbackEmbedding(query);
      } else {
        const output = await extractor(query, { pooling: 'mean', normalize: true });
        queryVec = new Float32Array(output.data);
      }

      // Measure search performance
      const t0 = performance.now();

      // Scan and calculate similarity
      const results = database.map(doc => {
        const score = cosineSimilarity(queryVec, doc.embedding);
        return {
          chunk: doc.chunk,
          score: parseFloat(score.toFixed(4))
        };
      });

      // Sort by descending score
      results.sort((a, b) => b.score - a.score);

      const topResults = results.slice(0, topK);
      const scanTime = performance.now() - t0;

      // Log latency diagnostics
      console.log(`[Retrieval Worker] Cosine search complete in ${scanTime.toFixed(2)}ms for ${database.length} chunks.`);

      self.postMessage({
        id,
        type,
        status: 'SUCCESS',
        payload: topResults
      });
    } catch (err: any) {
      self.postMessage({ id, type, status: 'ERROR', payload: err.message });
    }
  }
});
