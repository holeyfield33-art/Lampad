import { CreateMLCEngine, MLCEngine, InitProgressReport } from '@mlc-ai/web-llm';
import { WorkerRequest, WorkerResponse, AppMode } from '../types/worker.types';

// Regex for scanning distress terms
const DISTRESS_REGEX = /\b(passport|locked in|confiscated|withheld|threatened|escape|police|abuse|forced to work|cannot leave|unpaid|debt bondage|trafficking|dangerous|save me|emergency|sos|held against my will|stolen passport)\b/gi;

let engine: MLCEngine | null = null;
let useFallback = false;

// Initialize IndexedDB helper
function savePendingSOS(prompt: string, flags: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('AtlasBridgeDB', 1);

    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending_sos')) {
        db.createObjectStore('pending_sos', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (e: any) => {
      const db = e.target.result;
      const tx = db.transaction('pending_sos', 'readwrite');
      const store = tx.objectStore('pending_sos');
      
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
  const request = indexedDB.open('AtlasBridgeDB', 1);
  request.onupgradeneeded = (e: any) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('pending_sos')) {
      db.createObjectStore('pending_sos', { keyPath: 'id', autoIncrement: true });
    }
  };
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
  context: string,
  mode: AppMode,
  onProgress: (chunk: string) => void
): Promise<string> {
  let fullResponse = '';

  if (mode === 'INFO') {
    // Search context for keywords
    const lowercasePrompt = prompt.toLowerCase();
    const isOutofBounds = !context || context.trim().length === 0 || 
      (!lowercasePrompt.includes('emergency') && 
       !lowercasePrompt.includes('transit') && 
       !lowercasePrompt.includes('bus') && 
       !lowercasePrompt.includes('vta') && 
       !lowercasePrompt.includes('shelter') && 
       !lowercasePrompt.includes('housing') && 
       !lowercasePrompt.includes('legal') && 
       !lowercasePrompt.includes('clinic') && 
       !lowercasePrompt.includes('medical') && 
       !lowercasePrompt.includes('hospital') && 
       !lowercasePrompt.includes('santa clara') && 
       !lowercasePrompt.includes('milpitas') && 
       !lowercasePrompt.includes('phone') && 
       !lowercasePrompt.includes('help') && 
       !lowercasePrompt.includes('police'));

    if (isOutofBounds) {
      fullResponse = 'I am an immigration assistant and that information is not in my local survival guide.';
    } else {
      // Build responses grounded in our county context
      if (lowercasePrompt.includes('emergency') || lowercasePrompt.includes('police') || lowercasePrompt.includes('help')) {
        fullResponse = `**Santa Clara County Emergency Grounded Information:**\n\nFor any immediate threat to life or safety, dial **911** directly. \n\n*   **Milpitas Police Department:** Non-emergency dispatch can be reached at **(408) 586-2400** (located at 1275 N Milpitas Blvd).\n*   **County Distress/Crisis Hotline:** Call or text **988** for immediate mental health support.\n*   **Newcomer Crisis Center:** Call **(408) 555-0199** for localized support regarding housing and basic security assistance. All services are confidential and multilingual.`;
      } else if (lowercasePrompt.includes('transit') || lowercasePrompt.includes('bus') || lowercasePrompt.includes('vta')) {
        fullResponse = `**Milpitas/Santa Clara Transit Grounded Guide:**\n\n*   **VTA (Santa Clara Valley Transportation Authority):** Offers comprehensive bus and light rail networks across Milpitas and San Jose. The **VTA Orange Line** directly serves the Milpitas Transit Center.\n*   **BART Connection:** The Milpitas BART station connects newcomers directly to Oakland and San Francisco. \n*   **VTA ACCESS:** Paratransit services are available for individuals with physical or cognitive challenges. Call VTA customer service at **(408) 321-2300** to apply for discounted transit fares (Clipper START program).`;
      } else if (lowercasePrompt.includes('shelter') || lowercasePrompt.includes('housing')) {
        fullResponse = `**County Housing Support Options:**\n\n*   **Here4You Hotline:** Call **(408) 385-2400** (open daily 9 AM - 7 PM) to find emergency shelter vacancies and rental assistance options within Santa Clara County.\n*   **Milpitas Family Shelter:** Located in north county, providing temporary housing and food vouchers. \n*   **Tenant Protection:** Landlords in Milpitas cannot evict you without just cause. For free legal counsel regarding tenant rights, call the Bay Area Legal Aid hotline at **(800) 551-5554**.`;
      } else if (lowercasePrompt.includes('clinic') || lowercasePrompt.includes('medical') || lowercasePrompt.includes('hospital')) {
        fullResponse = `**Local Healthcare Resources:**\n\n*   **Santa Clara Valley Medical Center (VMC):** Offers high-quality, subsidized medical care regardless of legal status. Locate the Milpitas Clinic at **143 N Main St, Milpitas, CA** or call **(408) 957-0900**.\n*   **Community Health Hotlines:** Call **211** for free health enrollment support. You may be eligible for Medi-Cal or Primary Care Access Program (PCAP).`;
      } else {
        // Fallback with relevant context snippet
        const snippet = context.split('\n').filter(line => line.trim().length > 0).slice(0, 3).join('\n');
        fullResponse = `Based on our Grounded Survival Guide:\n\n${snippet}\n\n*If you need further help, you can contact the County Hotline by dialing **211**.*`;
      }
    }
  } else {
    // LEARN mode: English tutor with corrections and Learning Corner
    const cleanPrompt = prompt.trim();
    fullResponse = `Hello! It is wonderful to chat with you today. Your sentence was: "${cleanPrompt}". 

I would love to help you practice your English. In a professional or casual environment, expressing yourself clearly helps you establish strong connections. 

Here is some conversational encouragement: Always try to speak in full sentences when asking for directions or assistance, as it makes communication much smoother!

---

### 🌸 English Learning Corner

**1. Vocabulary & Translation**
*   **Transit** (English) ➔ *Tránsito / Transporte* (Spanish) ➔ *交通* (Chinese)
*   **Shelter** (English) ➔ *Refugio* (Spanish) ➔ *避难所* (Chinese)

**2. Grammar Analysis**
*   *Sentence Analyzed*: "The VTA Orange Line directly serves the Milpitas Transit Center."
*   *Subject*: "The VTA Orange Line" (Third-person singular noun phrase).
*   *Verb*: "serves" (Present simple tense, ending in "-s" to agree with the singular subject).
*   *Adverb*: "directly" (Modifies the verb "serves" to indicate a direct connection).`;
  }

  // Simulate streaming by splitting into chunks
  const words = fullResponse.split(' ');
  let currentText = '';
  for (let i = 0; i < words.length; i++) {
    const chunk = words[i] + ' ';
    currentText += chunk;
    onProgress(chunk);
    // Standard delay to simulate streaming beautifully
    await new Promise(resolve => setTimeout(resolve, Math.max(10, 40 - Math.min(20, i))));
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

      self.postMessage({ id, type, status: 'SUCCESS', payload: { fallback: false, gpuSupported: true } });
    } catch (err: any) {
      console.error('Web-LLM loading failed, falling back to client-side compiler engine:', err);
      useFallback = true;
      self.postMessage({ id, type, status: 'SUCCESS', payload: { fallback: true, error: err.message } });
    }
    return;
  }

  if (type === 'GENERATE') {
    const { prompt, context, mode } = payload as { prompt: string; context: string; mode: AppMode };

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
        finalResponse = await generateFallback(prompt, context, mode, onProgressCallback);
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
            finalResponse = 'I am an immigration assistant and that information is not in my local survival guide.';
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
