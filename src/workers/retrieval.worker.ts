import { pipeline } from '@xenova/transformers';
import { WorkerRequest, WorkerResponse } from '../types/worker.types';
import {
  buildIdf,
  cosineSimilarity,
  hasContentOverlap,
  lexicalEmbedding,
  type Idf,
} from '../lib/text';

let extractor: any = null;
let useFallback = false;

interface Document {
  chunk: string;
  embedding: Float32Array;
}

let database: Document[] = [];
/** IDF weights over the indexed corpus; only used by the lexical fallback. */
let idf: Idf | undefined;

/**
 * Lexical fallback vectoriser, used when the MiniLM model cannot be loaded.
 *
 * Delegates to `lib/text`, which is IDF-weighted, stopword-filtered and uses
 * signed feature hashing. The previous implementation accumulated raw positive
 * token counts, which made similarity a measure of stopword overlap: an
 * off-topic question scored higher than most on-topic ones. See
 * test/retrieval.test.mjs for the measured behaviour.
 */
function generateFallbackEmbedding(text: string): Float32Array {
  return lexicalEmbedding(text, idf);
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
      console.warn('Transformer model unavailable; using the lexical keyword fallback (degraded retrieval quality):', err);
      useFallback = true;
      self.postMessage({ id, type, status: 'SUCCESS', payload: { fallback: true, error: err.message } });
    }
    return;
  }

  if (type === 'VECTORIZE_BUNDLE') {
    const { chunks } = payload as { chunks: string[] };

    try {
      database = [];
      // IDF is computed over the corpus being indexed, so rare, meaningful
      // terms ("notario", "OPT", "Here4You") outweigh common ones. Only the
      // lexical fallback consults it.
      idf = buildIdf(chunks);

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
      if (typeof query !== 'string' || query.trim() === '' || database.length === 0) {
        self.postMessage({ id, type, status: 'SUCCESS', payload: [] });
        return;
      }

      const usingLexicalFallback = useFallback || !extractor;

      // Generate query embedding
      let queryVec: Float32Array;
      if (usingLexicalFallback) {
        queryVec = generateFallbackEmbedding(query);
      } else {
        const output = await extractor(query, { pooling: 'mean', normalize: true });
        queryVec = new Float32Array(output.data);
      }

      // Measure search performance
      const t0 = performance.now();

      const results = database.map(doc => ({
        chunk: doc.chunk,
        score: parseFloat(cosineSimilarity(queryVec, doc.embedding).toFixed(4)),
        // A lexical matcher always returns a nearest neighbour, however
        // unrelated. Flag whether the query and passage actually share
        // vocabulary so the caller can refuse instead of answering from a
        // passage that merely won a similarity contest among 18 candidates.
        grounded: usingLexicalFallback ? hasContentOverlap(query, doc.chunk) : true,
      }));

      results.sort((a, b) => b.score - a.score);

      const topResults = results.slice(0, topK);
      const scanTime = performance.now() - t0;

      console.log(
        `[Retrieval Worker] Cosine search complete in ${scanTime.toFixed(2)}ms for ${database.length} chunks` +
        `${usingLexicalFallback ? ' (lexical fallback)' : ''}.`
      );

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
