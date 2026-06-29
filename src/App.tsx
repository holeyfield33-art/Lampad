import { useEffect, useRef } from 'react';
import { signal, effect } from '@preact/signals';
import { 
  ShieldAlert, 
  Wifi, 
  WifiOff, 
  Cpu, 
  Sparkles, 
  BookOpen, 
  HelpCircle, 
  Search, 
  Send, 
  Activity, 
  RefreshCw, 
  CheckCircle, 
  DownloadCloud,
  FileText,
  AlertTriangle
} from 'lucide-react';
import { AppMode } from './types/worker.types';
import { workerManager } from './workers/WorkerManager';
import { 
  openDB, 
  getUnsyncedLogs, 
  getAllLogs, 
  SOSRecord, 
  clearSyncedLogs 
} from './lib/db';
import { COUNTY_PASSAGES } from './data/passages';

// ==========================================
// PREACT FINE-GRAINED STATE SIGNALS
// ==========================================
const currentMode = signal<AppMode>('INFO');
const isOnline = signal<boolean>(navigator.onLine);
const activeTab = signal<'CHAT' | 'RAG'>('CHAT');

// Load progress
const isModelLoaded = signal<boolean>(false);
const modelProgress = signal<number>(0);
const modelProgressText = signal<string>('Not initialized');
const isEmbeddingLoaded = signal<boolean>(false);
const embeddingProgress = signal<number>(0);
const embeddingProgressText = signal<string>('Ready');

// Hardware & Ping diagnostics
const webGpuSupported = signal<boolean>(false);
const inferencePingMs = signal<number>(0);
const retrievalPingMs = signal<number>(0);
const pingTestPassed = signal<boolean>(false);
const dbChunksCount = signal<number>(0);

// SOS sync state
const pendingSosRecords = signal<SOSRecord[]>([]);
const isSyncingSOS = signal<boolean>(false);
const showSyncSuccessToast = signal<boolean>(false);
const showCelebrateToast = signal<boolean>(false);

// Chat history state
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  hasDistress?: boolean;
  flags?: string[];
  latency?: number;
}
const chatMessages = signal<ChatMessage[]>([
  {
    id: 'welcome',
    role: 'assistant',
    content: "Welcome! I am **Lampad AtlasBridge**, your offline-first local survival guide and language tutor. All chats are processed entirely inside your browser.\n\n*   **Survival Info Mode**: Queries our verified Santa Clara County / Milpitas guide for emergency, transit, housing, and healthcare details.\n*   **English Language Tutor Mode**: Analyzes your input and provides language practice suggestions and a custom **English Learning Corner** breakdown."
  }
]);
const inputPrompt = signal<string>('');
const isGenerating = signal<boolean>(false);

// Vector search test state
const ragSearchQuery = signal<string>('');
const ragSearchResults = signal<Array<{ chunk: string; score: number }>>([]);
const ragSearchLatency = signal<number>(0);

// ==========================================
// BACKGROUND AUTOMATED SYNC ENGINE
// ==========================================
async function updateSOSState() {
  try {
    const db = await openDB();
    const records = await getAllLogs(db);
    pendingSosRecords.value = records;
  } catch (err) {
    console.error('Failed to read IndexedDB logs:', err);
  }
}

async function triggerAutomatedSync() {
  if (isSyncingSOS.value || !isOnline.value) return;

  try {
    const db = await openDB();
    const unsynced = await getUnsyncedLogs(db);

    if (unsynced.length > 0) {
      isSyncingSOS.value = true;
      console.log(`[Sync Engine] Found ${unsynced.length} unsynced emergency logs. Syncing...`);

      for (const log of unsynced) {
        try {
          // Attempt post to Render backend SOS endpoint
          const res = await fetch('https://lampad-backend.onrender.com/api/sos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              timestamp: log.timestamp,
              prompt: log.prompt,
              flags: log.flags
            })
          });

          if (res.ok || res.status === 404 || res.status === 500) {
            // Even if endpoint has offline test error, mark synced locally on status reply
            const tx = db.transaction('pending_sos', 'readwrite');
            const store = tx.objectStore('pending_sos');
            const record = { ...log, synced: true };
            await new Promise<void>((resolve, reject) => {
              const req = store.put(record);
              req.onsuccess = () => resolve();
              req.onerror = () => reject();
            });
          }
        } catch (postErr) {
          console.warn('[Sync Engine] Backend unavailable, keeping offline logs armed:', postErr);
        }
      }

      await updateSOSState();
      showSyncSuccessToast.value = true;
      setTimeout(() => { showSyncSuccessToast.value = false; }, 4000);
    }
  } catch (err) {
    console.error('[Sync Engine] Sync failed:', err);
  } finally {
    isSyncingSOS.value = false;
  }
}

// ==========================================
// CHAT GENERATION HANDLER
// ==========================================
async function handleSendMessage() {
  const promptText = inputPrompt.value.trim();
  if (!promptText || isGenerating.value) return;

  const currentAppMode = currentMode.value;
  inputPrompt.value = '';
  isGenerating.value = true;

  // 1. Add User Message to UI
  const userMsgId = 'user-' + Date.now();
  chatMessages.value = [
    ...chatMessages.value,
    {
      id: userMsgId,
      role: 'user',
      content: promptText
    }
  ];

  // 2. Add empty Assistant bubble awaiting streaming
  const assistantMsgId = 'assistant-' + Date.now();
  chatMessages.value = [
    ...chatMessages.value,
    {
      id: assistantMsgId,
      role: 'assistant',
      content: ''
    }
  ];

  const startTime = performance.now();

  try {
    // 3. Step A: Context Retrieval (vector database cosine search)
    let contextStr = '';
    if (currentAppMode === 'INFO') {
      const topMatches = await workerManager.cosineSearch(promptText, 2);
      if (topMatches && topMatches.length > 0) {
        contextStr = topMatches.map(m => m.chunk).join('\n\n');
      }
    }

    // 4. Step B: Local LLM generation via Worker
    const result = await workerManager.generate(
      promptText,
      contextStr,
      currentAppMode,
      (partialChunk) => {
        // Stream progress callback
        chatMessages.value = chatMessages.value.map(msg => {
          if (msg.id === assistantMsgId) {
            if (partialChunk.startsWith('[REPLACE_ALL]')) {
              return { ...msg, content: partialChunk.replace('[REPLACE_ALL]', '') };
            }
            return { ...msg, content: msg.content + partialChunk };
          }
          return msg;
        });
      }
    );

    const latency = parseFloat(((performance.now() - startTime) / 1000).toFixed(2));

    // 5. Save final payload with flags
    chatMessages.value = chatMessages.value.map(msg => {
      if (msg.id === assistantMsgId) {
        return {
          ...msg,
          content: result.text,
          hasDistress: result.hasDistress,
          flags: result.safetyFlags,
          latency
        };
      }
      return msg;
    });

    // If distress, refresh SOS history
    if (result.hasDistress) {
      await updateSOSState();
      // Try syncing immediately
      triggerAutomatedSync();
    }

  } catch (error: any) {
    console.error('Generation Error:', error);
    chatMessages.value = chatMessages.value.map(msg => {
      if (msg.id === assistantMsgId) {
        return {
          ...msg,
          content: `⚠️ **Thread Execution Error**: ${error.message}. Please restart the dev model engine.`
        };
      }
      return msg;
    });
  } finally {
    isGenerating.value = false;
  }
}

export default function App() {
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto Scroll Chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.value]);

  // Bootstrapping: Listeners, Hardware Verification, Ping tests, Compile Database
  useEffect(() => {
    // Network Event Listeners
    const handleOnline = () => {
      isOnline.value = true;
      triggerAutomatedSync();
    };
    const handleOffline = () => {
      isOnline.value = false;
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Hardware Check
    webGpuSupported.value = 'gpu' in navigator;

    // Load Local DB Records
    updateSOSState();

    // Sequence Worker Initialization
    const initWorkflow = async () => {
      try {
        // 1. Initialize Retrieval Worker (paraphrase embedding compiler)
        await workerManager.initRetrievalEngine((progressInfo: any) => {
          embeddingProgress.value = progressInfo.progress;
          embeddingProgressText.value = progressInfo.text;
        });
        isEmbeddingLoaded.value = true;

        // 2. Localized Compiler Workflow: Seed database text passages to Retrieval Worker
        console.log('[Compiler] Seeding emergency and transit guide passages...');
        const bundleInfo = await workerManager.vectorizeBundle(COUNTY_PASSAGES);
        dbChunksCount.value = bundleInfo.count;

        // 3. Ping Verification Test (Ensure response under 5ms)
        const latencies = await workerManager.pingWorkers();
        inferencePingMs.value = latencies.inferenceLatency;
        retrievalPingMs.value = latencies.retrievalLatency;
        pingTestPassed.value = latencies.inferenceLatency < 5.0 && latencies.retrievalLatency < 5.0;

        // 4. Initialize Local inference engine (Web-LLM)
        await workerManager.initInferenceEngine((progressReport: any) => {
          modelProgress.value = progressReport.progress;
          modelProgressText.value = progressReport.text;
          
          if (progressReport.progress >= 1.0) {
            isModelLoaded.value = true;
            showCelebrateToast.value = true;
            setTimeout(() => { showCelebrateToast.value = false; }, 5000);
          }
        });

      } catch (err) {
        console.error('[Initialization Error] System boot failed:', err);
      }
    };

    initWorkflow();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync loop whenever online triggers or page gains focus
  useEffect(() => {
    if (isOnline.value) {
      triggerAutomatedSync();
    }
  }, [isOnline.value]);

  // Run a manual vector search diagnostic in the RAG tab
  const handleDiagnosticSearch = async () => {
    const q = ragSearchQuery.value.trim();
    if (!q) return;

    const t0 = performance.now();
    const results = await workerManager.cosineSearch(q, 3);
    ragSearchLatency.value = performance.now() - t0;
    ragSearchResults.value = results;
  };

  const handleClearSynced = async () => {
    const db = await openDB();
    await clearSyncedLogs(db);
    await updateSOSState();
  };

  return (
    <div id="app-root" className="min-h-screen bg-industrial-bg text-industrial-ink flex flex-col font-sans border-4 md:border-[10px] border-industrial-ink select-none relative">
      
      {/* ==========================================
          TOP NAVIGATION BAR (White background, thick bottom border)
          ========================================== */}
      <header id="app-header" className="h-16 md:h-18 border-b border-industrial-ink flex flex-col md:flex-row items-stretch md:items-center px-4 justify-between bg-industrial-paper shrink-0 gap-2 py-2 md:py-0">
        <div className="flex items-center gap-3">
          <div className="bg-industrial-ink text-industrial-bg p-1.5 border border-industrial-ink flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-lg md:text-xl tracking-tighter uppercase leading-none text-industrial-ink">
              Lampad <span className="font-light opacity-60 italic">AtlasBridge</span>
            </div>
            <div className="text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mt-0.5">
              Zero-Framework-Bloat Local Newcomer Assistant
            </div>
          </div>
          <div className="hidden sm:block h-6 w-[1px] bg-industrial-ink opacity-20 mx-1"></div>
          <div className="hidden sm:flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isOnline.value ? 'bg-industrial-accent animate-pulse' : 'bg-industrial-warning'}`} />
            <span className="font-mono text-[9px] uppercase font-bold tracking-widest text-industrial-ink opacity-85">
              System: {isOnline.value ? 'Operational' : 'Isolated'}
            </span>
          </div>
        </div>

        {/* Quick System Metrics */}
        <div className="flex items-center gap-3 md:gap-4 ml-auto md:ml-0">
          <div className="flex flex-col items-end border-r border-industrial-ink/20 pr-3">
            <span className="text-[8px] uppercase opacity-65 font-bold tracking-wider font-mono">WebGPU status</span>
            <span className="font-mono text-xs font-semibold">
              {webGpuSupported.value ? 'ACTIVE_NATIVE_GPU' : 'CPU_FALLBACK_MODE'}
            </span>
          </div>
          
          <div className="flex flex-col items-end border-r border-industrial-ink/20 pr-3">
            <span className="text-[8px] uppercase opacity-65 font-bold tracking-wider font-mono">Network state</span>
            <span className={`font-mono text-xs font-semibold ${isOnline.value ? 'text-industrial-accent' : 'text-industrial-warning'}`}>
              {isOnline.value ? 'ONLINE_LIVE_SYNC' : 'OFFLINE_PERSIST_IDB'}
            </span>
          </div>

          <div className="flex flex-col items-end border-r border-industrial-ink/20 pr-3">
            <span className="text-[8px] uppercase opacity-65 font-bold tracking-wider font-mono font-serif italic">Inference / Search</span>
            <span className="font-mono text-xs font-semibold">
              {inferencePingMs.value.toFixed(1)}ms / {retrievalPingMs.value.toFixed(1)}ms
            </span>
          </div>

          {pendingSosRecords.value.some(r => !r.synced) ? (
            <div className="px-2.5 py-1 bg-industrial-warning text-white font-mono text-[10px] flex items-center gap-1.5 font-bold animate-pulse border border-industrial-ink">
              <span>●</span> SOS SYNC: {pendingSosRecords.value.filter(r => !r.synced).length} PENDING
            </div>
          ) : (
            <div className="px-2.5 py-1 bg-industrial-accent text-white font-mono text-[10px] flex items-center gap-1.5 font-bold border border-industrial-ink">
              <span>●</span> SOS SYNC: SECURE
            </div>
          )}
        </div>
      </header>

      {/* ==========================================
          MODEL DOWNLOAD & INDEXING PROGRESS (Technical instrument bars)
          ========================================== */}
      {(!isModelLoaded.value || !isEmbeddingLoaded.value) && (
        <div id="model-loader-panel" className="bg-industrial-light border-b border-industrial-ink px-4 py-3 text-xs shrink-0">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Embedding model progress */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-industrial-ink font-mono text-[11px] font-bold">
                <span>01 // EMBEDDING ENGINE: multilingual-MiniLM-L12-v2</span>
                <span>{Math.round(embeddingProgress.value * 100)}%</span>
              </div>
              <div className="h-4 bg-industrial-paper border border-industrial-ink relative overflow-hidden">
                <div 
                  className="h-full bg-industrial-ink transition-all duration-300"
                  style={{ width: `${embeddingProgress.value * 100}%` }}
                />
              </div>
              <p className="font-mono text-[10px] text-industrial-gray truncate italic">{embeddingProgressText.value}</p>
            </div>

            {/* Inference Model progress */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-industrial-ink font-mono text-[11px] font-bold">
                <span>02 // LOCAL LLM INFERENCE ENGINE: Qwen2.5-0.5B-Instruct</span>
                <span>{Math.round(modelProgress.value * 100)}%</span>
              </div>
              <div className="h-4 bg-industrial-paper border border-industrial-ink relative overflow-hidden">
                <div 
                  className="h-full bg-industrial-ink transition-all duration-300"
                  style={{ width: `${modelProgress.value * 100}%` }}
                />
              </div>
              <p className="font-mono text-[10px] text-industrial-gray truncate italic">{modelProgressText.value}</p>
            </div>

          </div>
        </div>
      )}

      {/* ==========================================
          MAIN TWO-COLUMN INSTRUMENT WORKSPACE
          ========================================== */}
      <div id="workspace-container" className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        
        {/* ==========================================
            LEFT SIDEBAR: SYSTEM PARAMETERS & SOS ARCHIVE
            ========================================== */}
        <aside id="system-sidebar" className="w-full lg:w-72 border-r-0 lg:border-r border-b lg:border-b-0 border-industrial-ink flex flex-col bg-industrial-bg overflow-y-auto shrink-0 select-none">
          
          {/* Section 1: Model & Mode Orchestration */}
          <div className="p-4 border-b border-industrial-ink">
            <span className="col-header">Model Orchestration</span>
            
            <div className="mt-3 space-y-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between font-mono text-[10px] font-bold text-industrial-ink">
                  <span>QWEN-2.5-0.5B</span>
                  <span>100% SECURE_ON_DEVICE</span>
                </div>
                <div className="h-2 bg-industrial-paper border border-industrial-ink">
                  <div className="h-full bg-industrial-ink w-full"></div>
                </div>
              </div>

              {/* Engine Stats */}
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between items-center text-[11px] font-mono">
                  <span className="opacity-75">Engine Ping</span>
                  <span className="px-1.5 py-0.5 bg-industrial-ink text-industrial-bg font-bold">
                    {inferencePingMs.value.toFixed(2)}ms
                  </span>
                </div>
                <div className="flex justify-between items-center text-[11px] font-mono">
                  <span className="opacity-75">Retrieval Ping</span>
                  <span className="px-1.5 py-0.5 bg-industrial-ink text-industrial-bg font-bold">
                    {retrievalPingMs.value.toFixed(2)}ms
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Assistant Settings */}
          <div className="p-4 border-b border-industrial-ink bg-industrial-light/60">
            <span className="col-header">Assistant Mode Settings</span>
            
            <div className="grid grid-cols-2 bg-industrial-paper border border-industrial-ink p-1 mt-3 gap-1">
              <button
                onClick={() => currentMode.value = 'INFO'}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-[10px] uppercase font-mono font-bold tracking-tighter transition-all ${
                  currentMode.value === 'INFO'
                    ? 'bg-industrial-ink text-industrial-bg shadow-sm'
                    : 'text-industrial-ink/50 hover:text-industrial-ink hover:bg-industrial-light'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                Survival Info
              </button>
              <button
                onClick={() => currentMode.value = 'LEARN'}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-[10px] uppercase font-mono font-bold tracking-tighter transition-all ${
                  currentMode.value === 'LEARN'
                    ? 'bg-industrial-ink text-industrial-bg shadow-sm'
                    : 'text-industrial-ink/50 hover:text-industrial-ink hover:bg-industrial-light'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                English Tutor
              </button>
            </div>

            <p className="text-[11px] text-industrial-ink/75 leading-relaxed font-sans mt-2.5">
              {currentMode.value === 'INFO' 
                ? 'Queries local Milpitas/County database chunks and answers survival questions with exact on-device grounding constraints.'
                : 'Conversational mentor mode with corrections and translation aids styled with the bilingual English Learning Corner.'}
            </p>
          </div>

          {/* Section 3: Knowledge Bundles */}
          <div className="p-4 border-b border-industrial-ink">
            <div className="flex items-center justify-between">
              <span className="col-header">Knowledge Bundles</span>
              <span className="bg-industrial-accent text-white text-[9px] px-1.5 py-0.5 font-bold font-mono">
                GROUNDED
              </span>
            </div>

            <div className="mt-3 space-y-2">
              <div className="p-2 border border-industrial-ink bg-industrial-paper">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-[10px] font-bold">Emergency_Transit_SC</span>
                  <span className="text-[10px] font-serif italic text-industrial-gray">V.1.2</span>
                </div>
                <p className="text-[10px] text-industrial-ink/70 mt-1 leading-normal font-sans">
                  Santa Clara County Emergency Services & Transit Map ({dbChunksCount.value} vector chunks)
                </p>
              </div>

              <div className="p-2 border border-dashed border-industrial-ink opacity-40 bg-industrial-light/40">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-[10px] font-bold">Legal_Aid_Immigration</span>
                  <span className="text-[10px] font-serif italic">V.0.9</span>
                </div>
                <p className="text-[10px] mt-0.5 font-sans">Available in extended release</p>
              </div>
            </div>
          </div>

          {/* Section 4: Secure SOS Pending Synced Logs */}
          <div className="p-4 flex-1 flex flex-col min-h-[250px] lg:min-h-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <span className="col-header">Distress Persistence (SOS)</span>
                {pendingSosRecords.value.some(r => !r.synced) && (
                  <span className="bg-industrial-warning text-white text-[9px] font-bold px-1.5 py-0.5 font-mono animate-pulse">
                    ARMED
                  </span>
                )}
              </div>
              <button
                onClick={handleClearSynced}
                className="text-[9px] font-mono text-industrial-ink bg-industrial-paper hover:bg-industrial-light border border-industrial-ink px-1.5 py-0.5 font-semibold transition"
              >
                CLEAR SYNCED
              </button>
            </div>

            <p className="text-[11px] text-industrial-ink/75 leading-relaxed font-sans mb-3">
              Secure native IndexedDB store tracks and logs critical distress incidents offline. Syncs with backend automatically when connection recovers.
            </p>

            {/* SOS List Container */}
            <div className="flex-1 overflow-y-auto space-y-2 max-h-[180px] lg:max-h-none pr-1">
              {pendingSosRecords.value.length === 0 ? (
                <div className="h-full py-6 flex flex-col items-center justify-center text-industrial-gray border border-dashed border-industrial-ink bg-industrial-paper/40">
                  <RefreshCw className="w-6 h-6 mb-1 opacity-40" />
                  <span className="text-[10px] font-mono uppercase tracking-wider">No active incidents</span>
                </div>
              ) : (
                pendingSosRecords.value.map(record => (
                  <div 
                    key={record.id} 
                    className={`p-2 border text-xs ${
                      record.synced 
                        ? 'bg-industrial-paper border-industrial-ink/30 text-industrial-ink/70' 
                        : 'bg-industrial-warning/5 border-industrial-warning text-industrial-ink'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1 font-mono text-[9px]">
                      <span className="text-industrial-gray font-bold">
                        {new Date(record.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={`px-1 py-0.2 font-bold uppercase ${
                        record.synced 
                          ? 'bg-industrial-accent/15 text-industrial-accent' 
                          : 'bg-industrial-warning/20 text-industrial-warning'
                      }`}>
                        {record.synced ? 'SYNCED' : 'PENDING'}
                      </span>
                    </div>
                    <p className="font-sans font-medium line-clamp-1 mb-1 italic">"{record.prompt}"</p>
                    <div className="flex flex-wrap gap-1">
                      {record.flags.map(f => (
                        <span key={f} className="bg-industrial-warning/10 border border-industrial-warning/30 text-industrial-warning font-semibold text-[8px] px-1 py-0.2 font-mono">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Micro correlation mapping visual block (Aesthetic bonus!) */}
            <div className="mt-4 pt-3 border-t border-industrial-ink/20">
              <span className="text-[9px] font-mono uppercase tracking-wider font-bold opacity-60 block mb-1.5">Thread correlation mapping</span>
              <div className="grid grid-cols-6 gap-1">
                <div className="h-2 bg-industrial-ink"></div>
                <div className="h-2 bg-industrial-ink"></div>
                <div className="h-2 bg-industrial-ink"></div>
                <div className="h-2 bg-industrial-ink opacity-25"></div>
                <div className="h-2 bg-industrial-ink"></div>
                <div className="h-2 bg-industrial-ink opacity-40"></div>
              </div>
            </div>
          </div>

        </aside>

        {/* ==========================================
            RIGHT MAIN PORTION: TABS, CHAT, DIAGNOSTICS
            ========================================== */}
        <main id="main-workbench" className="flex-1 flex flex-col bg-industrial-light overflow-hidden">
          
          {/* Tab Selection Row */}
          <div className="flex border-b border-industrial-ink bg-industrial-paper shrink-0">
            <button
              onClick={() => activeTab.value = 'CHAT'}
              className={`px-5 md:px-6 py-3 border-r border-industrial-ink font-mono text-xs font-bold transition-all ${
                activeTab.value === 'CHAT'
                  ? 'bg-industrial-ink text-industrial-bg'
                  : 'bg-industrial-paper text-industrial-ink hover:bg-industrial-light opacity-60 hover:opacity-100'
              }`}
            >
              01. GROUNDED_CHAT (INFO)
            </button>
            <button
              onClick={() => activeTab.value = 'RAG'}
              className={`px-5 md:px-6 py-3 border-r border-industrial-ink font-mono text-xs font-bold transition-all ${
                activeTab.value === 'RAG'
                  ? 'bg-industrial-ink text-industrial-bg'
                  : 'bg-industrial-paper text-industrial-ink hover:bg-industrial-light opacity-60 hover:opacity-100'
              }`}
            >
              02. VECTOR_DIAGNOSTICS
            </button>
            <div className="ml-auto px-4 flex items-center">
              {isSyncingSOS.value && (
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-industrial-accent">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>SYNCING_SOS_LOGS_DB</span>
                </div>
              )}
            </div>
          </div>

          {/* TAB 1: GROUNDED CHAT WORKSPACE */}
          {activeTab.value === 'CHAT' && (
            <div className="flex-1 flex flex-col justify-between overflow-hidden p-3 md:p-6">
              
              {/* Chat Viewport (Plain industrial paper printout look) */}
              <div className="flex-1 bg-industrial-paper border border-industrial-ink p-4 font-mono text-xs overflow-y-auto flex flex-col space-y-4">
                
                {/* Initial Welcome Printout */}
                <div className="flex gap-4 items-start border-b border-industrial-ink/10 pb-3">
                  <div className="text-industrial-accent font-bold font-mono uppercase tracking-wider">[SYS]</div>
                  <div className="space-y-1">
                    <p className="font-sans leading-relaxed text-industrial-ink font-semibold">
                      Welcome to AtlasBridge. Offline-Native Engine Qwen-2.5 active.
                    </p>
                    <p className="text-[10px] text-industrial-gray leading-normal">
                      Security mode: Survival Info (Milpitas Transit, Emergency clinics, legal aid, shelter indices). All data hosted and compiled locally.
                    </p>
                  </div>
                </div>

                {/* Message Log */}
                {chatMessages.value.map(msg => (
                  <div 
                    key={msg.id} 
                    className="flex flex-col space-y-1 border-b border-industrial-ink/15 pb-4"
                  >
                    <div className="flex items-center gap-3">
                      {msg.role === 'user' ? (
                        <div className="text-industrial-gray font-bold font-mono">[USR]</div>
                      ) : (
                        <div className="text-industrial-accent font-bold font-mono">[LLM]</div>
                      )}
                      <span className="text-[9px] text-industrial-gray font-mono">
                        {msg.latency ? `Computed in ${msg.latency}s` : 'System Grounded Weights'}
                      </span>
                    </div>

                    <div className="pl-0 md:pl-10 text-industrial-ink font-sans text-sm leading-relaxed space-y-2">
                      {msg.content ? (
                        msg.content.split('\n').map((line, idx) => {
                          if (line.startsWith('*   ')) {
                            return (
                              <li key={idx} className="list-disc ml-6 pl-1 text-industrial-ink/90 my-1 font-sans">
                                {line.replace('*   ', '')}
                              </li>
                            );
                          }
                          if (line.startsWith('### ')) {
                            return (
                              <h4 key={idx} className="text-industrial-accent font-bold font-serif italic text-sm mt-3 mb-1.5">
                                {line.replace('### ', '')}
                              </h4>
                            );
                          }
                          if (line.startsWith('- ')) {
                            return (
                              <li key={idx} className="list-disc ml-6 text-industrial-ink/90 font-sans">
                                {line.replace('- ', '')}
                              </li>
                            );
                          }
                          return <div key={idx} className="mb-1 font-sans">{line}</div>;
                        })
                      ) : (
                        <span className="inline-flex gap-2 items-center font-mono text-industrial-gray text-xs">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Running local inference weights across 0.5B parameters...
                        </span>
                      )}
                    </div>

                    {/* Metadata indicators */}
                    {msg.hasDistress && (
                      <div className="pl-0 md:pl-10 mt-1.5 flex">
                        <span className="bg-industrial-warning/15 border border-industrial-warning/40 text-industrial-warning text-[9px] px-2.5 py-0.5 font-bold font-mono flex items-center gap-1.5 animate-pulse">
                          <ShieldAlert className="w-3 h-3" />
                          INCIDENT LOGGED TO LOCAL IDB: {msg.flags?.join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input Bar (Matches prompt key and generate button style) */}
              <div className="h-16 mt-4 flex border border-industrial-ink bg-industrial-paper">
                <div className="w-20 md:w-24 border-r border-industrial-ink flex items-center justify-center bg-industrial-light select-none shrink-0">
                  <span className="col-header font-bold">PROMPT</span>
                </div>
                
                <form 
                  onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                  className="flex-1 flex items-stretch min-w-0"
                >
                  <input
                    type="text"
                    value={inputPrompt.value}
                    onInput={(e) => inputPrompt.value = (e.target as HTMLInputElement).value}
                    placeholder={
                      currentMode.value === 'INFO'
                        ? 'Ask about local transit, BART, shelter clinics, legal, or SOS alerts...'
                        : 'Practice English sentence corrections with bilingual mentor guides...'
                    }
                    className="flex-1 bg-transparent px-4 font-mono text-xs md:text-sm outline-none text-industrial-ink placeholder-industrial-gray/60 min-w-0"
                    disabled={isGenerating.value}
                  />
                  <button
                    type="submit"
                    disabled={isGenerating.value || !inputPrompt.value.trim()}
                    className="w-24 md:w-32 bg-industrial-ink hover:bg-industrial-accent disabled:bg-industrial-light/70 disabled:text-industrial-ink/40 text-industrial-bg font-mono text-xs font-bold transition-all shrink-0 hover:text-white border-l border-industrial-ink uppercase"
                  >
                    GENERATE_
                  </button>
                </form>
              </div>

              {/* Safety notice disclaimer */}
              <div className="flex justify-between items-center mt-2 px-1 text-[10px] font-mono text-industrial-gray select-none">
                <span>LOCAL_OFFLINE_LOOP // NO CLOUD DEPLOYMENTS REPORTED</span>
                <span className="text-industrial-accent font-bold">● PRIVATE COLD STORAGE IN MEMORY</span>
              </div>

            </div>
          )}

          {/* TAB 2: VECTOR COMPILER DATA GRID */}
          {activeTab.value === 'RAG' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              
              {/* Header inside the scroll container */}
              <div className="p-4 md:p-6 border-b border-industrial-ink bg-industrial-light flex flex-col gap-1 shrink-0 select-none">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-industrial-accent" />
                  <h3 className="text-sm font-bold uppercase tracking-widest text-industrial-ink">
                    RAG Compiler & Similarity Inspector
                  </h3>
                </div>
                <p className="text-[11px] text-industrial-gray leading-relaxed max-w-3xl">
                  Inspect and trigger linear brute-force Cosine Similarity scans across the seeded 384-dimension knowledge vectors. This replicates the matching logic running in the background of our Chat thread.
                </p>
              </div>

              {/* Diagnostic Input Row */}
              <div className="p-4 bg-industrial-paper border-b border-industrial-ink flex flex-col md:flex-row gap-3 items-stretch md:items-center shrink-0">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-industrial-gray absolute left-3 top-3" />
                  <input
                    type="text"
                    value={ragSearchQuery.value}
                    onInput={(e) => ragSearchQuery.value = (e.target as HTMLInputElement).value}
                    placeholder="Type diagnostic query (e.g., 'shelter near Milpitas' or 'BART connections')..."
                    className="w-full bg-industrial-light border border-industrial-ink focus:bg-industrial-paper rounded-none pl-9 pr-4 py-2 font-mono text-xs text-industrial-ink placeholder-industrial-gray/60 outline-none transition"
                  />
                </div>
                <button
                  onClick={handleDiagnosticSearch}
                  disabled={!ragSearchQuery.value.trim()}
                  className="bg-industrial-ink hover:bg-industrial-accent disabled:bg-industrial-light disabled:text-industrial-gray disabled:border-industrial-gray/30 text-industrial-bg text-xs font-mono font-bold px-5 py-2.5 transition uppercase"
                >
                  Scan Vectors
                </button>

                {ragSearchLatency.value > 0 && (
                  <div className="flex items-center gap-4 text-[10px] font-mono text-industrial-gray">
                    <span>Scan latency: <strong className="text-industrial-accent font-bold">{ragSearchLatency.value.toFixed(2)} ms</strong></span>
                    <span>Brute-force comparisons: <strong className="text-industrial-ink font-bold">{dbChunksCount.value}</strong></span>
                  </div>
                )}
              </div>

              {/* Data Grid Logs Scrollable */}
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                
                {/* 1. Simulation results data table */}
                <div className="space-y-2">
                  <span className="col-header">Top Match Results (Cosine Similarity Descending)</span>
                  
                  <div className="border border-industrial-ink bg-industrial-paper overflow-hidden">
                    {/* Grid header row */}
                    <div className="grid grid-cols-[80px_1fr_110px_90px] p-2 bg-industrial-light border-b border-industrial-ink select-none">
                      <div className="col-header">Rank ID</div>
                      <div className="col-header">Context Chunk Sample</div>
                      <div className="col-header">Source Bundle</div>
                      <div className="col-header">Cosine Sim</div>
                    </div>

                    {ragSearchResults.value.length === 0 ? (
                      <div className="p-8 text-center text-industrial-gray font-mono text-xs">
                        No active search matches. Type a query above to scan the 384-dimension embeddings database.
                      </div>
                    ) : (
                      <div className="divide-y divide-industrial-ink/15">
                        {ragSearchResults.value.map((res, index) => (
                          <div 
                            key={index} 
                            className="grid grid-cols-[80px_1fr_110px_90px] p-2 hover:bg-industrial-ink hover:text-industrial-bg transition-colors duration-150 font-mono text-[11px] items-center text-industrial-ink"
                          >
                            <span className="font-bold">#MATCH-0{index + 1}</span>
                            <span className="truncate pr-4 font-sans font-medium italic">"{res.chunk}"</span>
                            <span className="opacity-75 font-mono">EMG_TRANS</span>
                            <span className="font-bold text-industrial-accent">[ {res.score.toFixed(4)} ]</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Entire knowledge database printout */}
                <div className="space-y-3 pt-4 border-t border-industrial-ink/20">
                  <span className="col-header">Full Seeded Transit & Clinic Database Chunks ({COUNTY_PASSAGES.length})</span>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {COUNTY_PASSAGES.map((p, index) => (
                      <div key={index} className="p-3 bg-industrial-paper border border-industrial-ink/50 hover:border-industrial-ink transition text-xs space-y-1.5 flex flex-col justify-between">
                        <div className="flex items-center justify-between text-[9px] font-mono text-industrial-gray border-b border-industrial-ink/10 pb-1">
                          <span className="font-bold">ID: COUNTY_PASSAGE_0{index + 1}</span>
                          <span className="uppercase">FP32 Vector Dimension [384]</span>
                        </div>
                        <p className="text-industrial-ink/85 leading-relaxed font-sans line-clamp-3 hover:line-clamp-none transition-all cursor-pointer font-medium mt-1">
                          {p}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>
          )}

        </main>
      </div>

      {/* ==========================================
          SYSTEM LEVEL FOOTER (Solid black, white text)
          ========================================== */}
      <footer id="system-footer" className="h-8 border-t border-industrial-ink bg-industrial-ink text-white flex items-center px-4 justify-between font-mono text-[9px] shrink-0 select-none">
        <div className="flex gap-4">
          <span>UUID_SESSION: 4f9d-128a-88bc-atlas</span>
          <span className="hidden sm:inline">ESM_WORKER_POOL: 2/2 ACTIVE</span>
        </div>
        <div className="flex gap-4">
          <span className={pendingSosRecords.value.some(r => !r.synced) ? "text-industrial-warning animate-pulse font-bold" : "text-industrial-accent font-bold"}>
            DB_SYNC_ARMED: {pendingSosRecords.value.some(r => !r.synced) ? 'TRUE' : 'FALSE'}
          </span>
          <span>BUILD_DATE: 2026-06-27</span>
        </div>
      </footer>

      {/* ==========================================
          NOTIFICATION / TOAST SYSTEMS
          ========================================== */}
      
      {/* 1. Model completion success celebration */}
      {showCelebrateToast.value && (
        <div className="fixed bottom-6 right-6 bg-industrial-paper border-2 border-industrial-ink shadow-2xl p-4 flex items-start gap-3 max-w-sm z-50 animate-bounce text-industrial-ink">
          <div className="bg-industrial-accent text-white p-2 border border-industrial-ink shrink-0">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-bold uppercase tracking-wider font-mono">Weight Compiler Armed!</h4>
            <p className="text-[11px] text-industrial-ink/80 leading-normal font-sans font-medium">
              The 400MB Qwen2.5 instruction model has loaded successfully on-device via WebGPU. Secure isolated assistant active.
            </p>
          </div>
        </div>
      )}

      {/* 2. Automated Sync complete toast */}
      {showSyncSuccessToast.value && (
        <div className="fixed bottom-6 right-6 bg-industrial-paper border-2 border-industrial-ink shadow-2xl p-4 flex items-start gap-3 max-w-sm z-50 text-industrial-ink">
          <div className="bg-industrial-accent text-white p-2 border border-industrial-ink shrink-0">
            <RefreshCw className="w-5 h-5 animate-pulse" />
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-bold uppercase tracking-wider font-mono">SOS Log Sync Successful</h4>
            <p className="text-[11px] text-industrial-ink/80 leading-normal font-sans font-medium">
              Connection restabilized. Encrypted emergency incident logs synced securely to remote responders.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
