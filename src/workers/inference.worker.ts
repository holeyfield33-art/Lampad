import { CreateMLCEngine, MLCEngine, InitProgressReport } from '@mlc-ai/web-llm';
import { WorkerRequest, WorkerResponse, AppMode } from '../types/worker.types';
import { applyUpgrade, DB_NAME, DB_VERSION, SOS_STORE } from '../lib/db';
import {
  answerFromRetrieval,
  answerLearnMode,
  REFUSAL,
  type RetrievedMatch,
} from './fallback';

// Regex for scanning distress terms
const DISTRESS_REGEX = /\b(passport|locked in|confiscated|withheld|threatened|escape|police|abuse|forced to work|cannot leave|unpaid|debt bondage|trafficking|dangerous|save me|emergency|sos|held against my will|stolen passport)\b/gi;

// Mirrors MAX_PROMPT_CHARS in App.tsx: the worker must not depend on the UI
// having enforced the cap.
const MAX_PROMPT_CHARS = 2000;
// Upper bound on simulated streaming chunks in the fallback engine.
const MAX_STREAM_CHUNKS = 400;

let engine: MLCEngine | null = null;
let useFallback = false;

// Initialize IndexedDB helper
function savePendingSOS(prompt: string, flags: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e: any) => applyUpgrade(e.target.result);

    request.onsuccess = (e: any) => {
      const db = e.target.result;
      const tx = db.transaction(SOS_STORE, 'readwrite');
      const store = tx.objectStore(SOS_STORE);
      
      const sosRecord = {
        timestamp: new Date().toISOString(),
        prompt,
        flags,
        synced: false
      };
      
      const addRequest = store.add(sosRecord);
      addRequest.onsuccess = () => resolve();
      addRequest.onerror = () => reject(new Error('Add failed'));
    };

    request.onerror = () => reject(new Error('DB open failed'));
  });
}

// Ensure database stores exist on worker init
function initDB() {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = (e: any) => applyUpgrade(e.target.result);
}
initDB();

/**
 * Executes a safety scan on the text prompt
 */
function scanForDistress(text: string): { hasDistress: boolean; flags: string[] } {
  // Global flag ensures every distress term is captured, not just the first.
  const matches = text.match(DISTRESS_REGEX);
  if (matches && matches.length > 0) {
    // Collect all matched terms, de-duplicated and case-normalized.
    const flags = Array.from(new Set(matches.map(m => m.toLowerCase())));
    return { hasDistress: true, flags };
  }
  return { hasDistress: false, flags: [] };
}

/**
 * Fallback AI Generator (when WebGPU is not supported or fails to load)
 */
async function generateFallback(
  prompt: string,
  matches: RetrievedMatch[],
  mode: AppMode,
  onProgress: (chunk: string) => void
): Promise<string> {
  // Answers come from what retrieval actually returned, not from a lookup
  // table keyed on substrings of the prompt.
  const fullResponse =
    mode === 'INFO' ? answerFromRetrieval(prompt, matches) : answerLearnMode(prompt);

  // Simulate streaming by splitting into chunks. The per-word delay is capped
  // by MAX_STREAM_CHUNKS: a long response would otherwise hold the input
  // disabled for minutes at ~10ms per word before the remainder is flushed.
  const words = fullResponse.split(' ');
  const streamed = words.slice(0, MAX_STREAM_CHUNKS);
  for (let i = 0; i < streamed.length; i++) {
    onProgress(streamed[i] + ' ');
    await new Promise(resolve => setTimeout(resolve, Math.max(10, 40 - Math.min(20, i))));
  }
  if (words.length > streamed.length) {
    onProgress(words.slice(streamed.length).join(' '));
  }

  return fullResponse;
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;

  if (type === 'PING') {
    self.postMessage({ id, type, status: 'SUCCESS', payload: 'PONG' });
    return;
  }

  if (type === 'INIT_ENGINE') {
    // Check if WebGPU is supported
    const hasGPU = 'gpu' in self.navigator;
    if (!hasGPU) {
      console.warn('WebGPU is not supported in this environment. Initializing local Fallback Engine.');
      useFallback = true;
      self.postMessage({ id, type, status: 'SUCCESS', payload: { fallback: true, gpuSupported: false } });
      return;
    }

    try {
      // Send progress reporting
      self.postMessage({
        id,
        type,
        status: 'PROGRESS',
        payload: { progress: 0.1, text: 'Initializing WebGPU context...' }
      });

      const modelId = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
      
      engine = await CreateMLCEngine(modelId, {
        initProgressCallback: (report: InitProgressReport) => {
          self.postMessage({
            id,
            type,
            status: 'PROGRESS',
            payload: { progress: report.progress, text: report.text }
          });
        }
      });

      // A retry after an earlier failed attempt must actually switch
      // GENERATE back to the real engine; without this, useFallback stays
      // true forever once set once, and a successful retry would silently
      // keep answering from the fallback engine while reporting success.
      useFallback = false;
      self.postMessage({ id, type, status: 'SUCCESS', payload: { fallback: false, gpuSupported: true } });
    } catch (err: any) {
      console.error('Web-LLM loading failed, falling back to client-side compiler engine:', err);
      useFallback = true;
      self.postMessage({ id, type, status: 'SUCCESS', payload: { fallback: true, error: err.message } });
    }
    return;
  }

  if (type === 'GENERATE') {
    const { prompt: rawPrompt, context: rawContext, mode, matches: rawMatches } = payload as
      { prompt: unknown; context: unknown; mode: AppMode; matches: unknown };
    // Defensive: never trust the caller for type or length.
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.slice(0, MAX_PROMPT_CHARS) : '';
    const context = typeof rawContext === 'string' ? rawContext : '';
    const matches: RetrievedMatch[] = Array.isArray(rawMatches)
      ? rawMatches.filter(m => m && typeof m.chunk === 'string' && typeof m.score === 'number')
      : [];

    // 1. RUN SAFETY SCANNER
    const { hasDistress, flags } = scanForDistress(prompt);
    if (hasDistress) {
      try {
        await savePendingSOS(prompt, flags);
      } catch (e) {
        console.error('Failed to log distress to IndexedDB:', e);
      }
    }

    // Custom Callback for stream updates
    const onProgressCallback = (chunk: string) => {
      self.postMessage({
        id,
        type,
        status: 'PROGRESS',
        payload: chunk
      });
    };

    try {
      let finalResponse = '';

      if (useFallback || !engine) {
        finalResponse = await generateFallback(prompt, matches, mode, onProgressCallback);
      } else {
        // Construct prompts based on current Mode
        let systemPrompt = '';
        if (mode === 'INFO') {
          systemPrompt = `You are "Lampad AtlasBridge", an offline newcomer survival assistant for Santa Clara County and Milpitas.
Your task is to answer user queries using ONLY the following grounded context:
===
${context}
===
Rules:
1. Ground your answers 100% in the facts provided above. Do not hallucinate.
2. If the user's query is outside the scope of local survival information or the provided context doesn't contain the answer, you MUST respond with EXACTLY: "I am an immigration assistant and that information is not in my local survival guide." No other greetings or additions.`;
        } else {
          systemPrompt = `You are "Lampad AtlasBridge", an English Language Tutor for newcomers. 
Acknowledge the user's message kindly, suggest corrections if there are grammar errors, and answer their query.
At the end of your response, ALWAYS include a section formatted exactly as:
### 🌸 English Learning Corner
**1. Vocabulary & Translation**
- Provide translations for 2 key terms into Spanish and Chinese.
**2. Grammar Analysis**
- Give a quick structural analysis of one of your sentences.`;
        }

        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ] as any;

        const chatCompletion = await engine.chat.completions.create({
          messages,
          stream: true,
          temperature: 0.1,
          max_tokens: 512,
        });

        for await (const chunk of chatCompletion) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            finalResponse += content;
            onProgressCallback(content);
          }
        }

        // Out-of-bounds Post-Generation Safeguard
        if (mode === 'INFO') {
          const lowercaseResp = finalResponse.toLowerCase();
          if (
            lowercaseResp.includes("don't know") || 
            lowercaseResp.includes("cannot find") || 
            lowercaseResp.includes("not mentioned") || 
            lowercaseResp.includes("sorry, as an ai") ||
            finalResponse.trim().length === 0
          ) {
            finalResponse = REFUSAL;
            onProgressCallback('[REPLACE_ALL]' + finalResponse);
          }
        }
      }

      self.postMessage({
        id,
        type,
        status: 'SUCCESS',
        payload: {
          text: finalResponse,
          hasDistress,
          safetyFlags: flags
        }
      });
    } catch (err: any) {
      self.postMessage({ id, type, status: 'ERROR', payload: err.message });
    }
  }
});
