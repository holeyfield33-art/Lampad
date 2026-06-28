import { computed, signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type {
  AppMode,
  ChatMessage,
  KnowledgeBundle,
  KnowledgeEntry,
  SearchResponsePayload,
} from './types/worker.types'
import { WorkerManager } from './workers/WorkerManager'

type TabKey = 'chat' | 'rag'

type ChatTurn = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type ScanLog = {
  id: string
  query: string
  searchMs: number
  threshold: number
  matches: SearchResponsePayload['matches']
}

type Toast = {
  id: string
  title: string
  body: string
}

type PendingSosRecord = {
  id: string
  prompt: string
  mode: AppMode
  keywords: string[]
  createdAt: string
}

const SOS_ENDPOINT = import.meta.env.VITE_SOS_ENDPOINT ?? 'https://lampad-backend.onrender.com/api/sos'
const DISTRESS_STORE = 'pending_sos'
const KNOWLEDGE_THRESHOLD = 0.35
const TOP_K = 3

const knowledgeSeed: KnowledgeEntry[] = [
  {
    id: 'milpitas-emergency-911',
    title: 'Immediate emergencies',
    category: 'emergency',
    locale: 'Milpitas',
    text: 'In Milpitas and Santa Clara County, call 911 for immediate danger, fire, medical emergency, or active violence. For non-emergency police help, contact the Milpitas Police Department dispatch line.',
  },
  {
    id: 'scc-shelter-support',
    title: 'Santa Clara County shelter help',
    category: 'housing',
    locale: 'Santa Clara County',
    text: 'Santa Clara County residents needing urgent shelter or crisis housing can contact the county social services hotline and local family resource centers for same-day referrals and multilingual help.',
  },
  {
    id: 'valley-medical',
    title: 'Valley Medical Center access',
    category: 'health',
    locale: 'Santa Clara County',
    text: 'Valley Medical Center in Santa Clara County provides emergency care, urgent services, and financial counseling for eligible residents who need help understanding bills or county medical support.',
  },
  {
    id: 'vta-transit',
    title: 'VTA buses and light rail',
    category: 'transit',
    locale: 'Milpitas',
    text: 'Milpitas residents can use VTA buses and the Orange Line light rail to connect with North San Jose, Mountain View, and county services. The Milpitas Transit Center also links to BART for regional travel.',
  },
  {
    id: 'bart-sjc-access',
    title: 'BART and airport travel',
    category: 'transit',
    locale: 'Milpitas',
    text: 'From Milpitas, riders can take BART toward Berryessa and use VTA or airport connectors to reach San Jose Mineta International Airport and nearby service hubs.',
  },
  {
    id: 'food-support',
    title: 'Food and family support',
    category: 'food',
    locale: 'Santa Clara County',
    text: 'Food banks and community pantries in Santa Clara County offer groceries, diapers, and family support. Local libraries and community centers often share schedules for multilingual outreach services.',
  },
  {
    id: 'documents-safety',
    title: 'Protecting important documents',
    category: 'safety',
    locale: 'Santa Clara County',
    text: 'If a newcomer loses access to a passport, visa papers, or identification, they should move to a safe location, contact trusted support, and document where the papers were last seen before contacting aid services.',
  },
  {
    id: 'english-practice',
    title: 'English practice for transit and services',
    category: 'education',
    locale: 'Milpitas',
    text: 'Useful practice phrases include asking for the nearest bus stop, requesting help at a clinic desk, and confirming an appointment time with county staff.',
  },
]

const activeTab = signal<TabKey>('chat')
const chatMode = signal<AppMode>('INFO')
const connectionStatus = signal<'online' | 'offline'>(navigator.onLine ? 'online' : 'offline')
const gpuSupported = signal<boolean>('gpu' in navigator)
const modelDownloadProgress = signal(0)
const modelDownloadMessage = signal('Waiting for WebGPU model warm-up...')
const modelVerified = signal(false)
const retrievalReady = signal(false)
const inferenceReady = signal(false)
const latencyMs = signal<number | null>(null)
const pingMetrics = signal<{ inference: number | null; retrieval: number | null }>({
  inference: null,
  retrieval: null,
})
const busy = signal(false)
const liveWarningCount = signal(0)
const bundleInfo = signal<KnowledgeBundle | null>(null)
const chatTurns = signal<ChatTurn[]>([
  {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: 'AtlasBridge is booting local retrieval and offline safety tooling.',
  },
])
const scanLogs = signal<ScanLog[]>([])
const draftPrompt = signal('')
const toasts = signal<Toast[]>([])

const hardwareBanner = computed(() =>
  gpuSupported.value
    ? 'WebGPU detected. Local Qwen2.5 inference can warm up in the browser.'
    : 'WebGPU is unavailable here. Retrieval diagnostics still work, but local chat inference may stay unavailable.',
)

function pushToast(title: string, body: string): void {
  const id = crypto.randomUUID()
  toasts.value = [...toasts.value, { id, title, body }]
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }, 4500)
}

function updateAssistantDraft(requestId: string, chunk: string): void {
  chatTurns.value = chatTurns.value.map((turn) =>
    turn.id === requestId ? { ...turn, content: `${turn.content}${chunk}` } : turn,
  )
}

function finalizeAssistantDraft(requestId: string, finalText: string): void {
  chatTurns.value = chatTurns.value.map((turn) =>
    turn.id === requestId ? { ...turn, content: finalText } : turn,
  )
}

function openAtlasDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lampad-atlasbridge', 1)

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DISTRESS_STORE)) {
        request.result.createObjectStore(DISTRESS_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function addPendingSos(record: PendingSosRecord): Promise<void> {
  const database = await openAtlasDb()
  const transaction = database.transaction(DISTRESS_STORE, 'readwrite')
  await requestToPromise(transaction.objectStore(DISTRESS_STORE).put(record))
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

async function listPendingSos(): Promise<PendingSosRecord[]> {
  const database = await openAtlasDb()
  const transaction = database.transaction(DISTRESS_STORE, 'readonly')
  return requestToPromise(transaction.objectStore(DISTRESS_STORE).getAll())
}

async function deletePendingSos(id: string): Promise<void> {
  const database = await openAtlasDb()
  const transaction = database.transaction(DISTRESS_STORE, 'readwrite')
  await requestToPromise(transaction.objectStore(DISTRESS_STORE).delete(id))
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

async function refreshPendingCount(): Promise<void> {
  liveWarningCount.value = (await listPendingSos()).length
}

async function syncPendingSos(): Promise<void> {
  if (connectionStatus.value !== 'online') {
    return
  }

  const pendingItems = await listPendingSos()

  for (const item of pendingItems) {
    const response = await fetch(SOS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(item),
    })

    if (!response.ok) {
      const details = await response.text()
      throw new Error(
        `SOS sync failed with status ${response.status} ${response.statusText}${
          details ? `: ${details}` : ''
        }`,
      )
    }

    await deletePendingSos(item.id)
  }

  await refreshPendingCount()
}

async function measurePing(manager: WorkerManager, target: 'inference' | 'retrieval'): Promise<number> {
  let total = 0

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = performance.now()
    await manager.send(target, 'PING', null)
    total += performance.now() - startedAt
  }

  return total / 3
}

async function bootWorkers(manager: WorkerManager): Promise<void> {
  await manager.send('retrieval', 'INIT_RETRIEVAL', null)
  retrievalReady.value = true

  const knowledge = await manager.send('retrieval', 'SEED_KNOWLEDGE', { entries: knowledgeSeed })
  bundleInfo.value = knowledge

  if (gpuSupported.value) {
    await manager.send('inference', 'INIT_INFERENCE', null, {
      onProgress: ({ progress, message }) => {
        modelDownloadProgress.value = Math.max(0, Math.min(100, progress))
        modelDownloadMessage.value = message
      },
    })
    inferenceReady.value = true
  }

  const [retrievalPing, inferencePing] = await Promise.all([
    measurePing(manager, 'retrieval'),
    gpuSupported.value ? measurePing(manager, 'inference') : Promise.resolve<number | null>(null),
  ])

  pingMetrics.value = {
    retrieval: retrievalPing,
    inference: inferencePing,
  }
}

async function submitPrompt(manager: WorkerManager, prompt: string): Promise<void> {
  const requestId = crypto.randomUUID()
  const startedAt = performance.now()

  chatTurns.value = [
    ...chatTurns.value,
    { id: crypto.randomUUID(), role: 'user', content: prompt },
    { id: requestId, role: 'assistant', content: '' },
  ]

  const searchResult = await manager.send('retrieval', 'SEARCH_KNOWLEDGE', {
    query: prompt,
    topK: TOP_K,
    threshold: KNOWLEDGE_THRESHOLD,
  })

  scanLogs.value = [
    {
      id: crypto.randomUUID(),
      query: prompt,
      searchMs: searchResult.searchMs,
      threshold: searchResult.threshold,
      matches: searchResult.matches,
    },
    ...scanLogs.value,
  ].slice(0, 8)

  const context = searchResult.matches
    .filter((match) => match.score >= KNOWLEDGE_THRESHOLD)
    .map((match) => `${match.title}: ${match.text}`)

  const history: ChatMessage[] = chatTurns.value
    .slice(-4)
    .map((turn) => ({
      role: turn.role,
      content: turn.content,
    }))

  const finalResponse = await manager.send('inference', 'CHAT', {
    mode: chatMode.value,
    prompt,
    context,
    history,
  }, {
    onStream: ({ chunk }) => {
      updateAssistantDraft(requestId, chunk)
    },
  })

  finalizeAssistantDraft(requestId, finalResponse.text)
  latencyMs.value = performance.now() - startedAt

  if (finalResponse.distressTriggered) {
    await addPendingSos({
      id: crypto.randomUUID(),
      prompt,
      mode: chatMode.value,
      keywords: finalResponse.distressKeywords,
      createdAt: new Date().toISOString(),
    })
    await refreshPendingCount()
    pushToast('SOS packet queued', `Stored offline distress packet for: ${finalResponse.distressKeywords.join(', ')}`)

    if (connectionStatus.value === 'online') {
      await syncPendingSos()
    }
  }
}

export function App() {
  const managerRef = useRef<WorkerManager | null>(null)

  useEffect(() => {
    const manager = new WorkerManager()
    managerRef.current = manager

    const handleOnline = () => {
      connectionStatus.value = 'online'
      syncPendingSos().catch((error) => {
        pushToast('Sync paused', error instanceof Error ? error.message : 'Could not sync pending SOS packets.')
      })
    }
    const handleOffline = () => {
      connectionStatus.value = 'offline'
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    refreshPendingCount().catch(() => {
      liveWarningCount.value = 0
    })

    bootWorkers(manager)
      .then(() => {
        pushToast('Workers ready', 'Local retrieval is seeded and AtlasBridge is ready for newcomer guidance.')
      })
      .catch((error) => {
        pushToast('Boot warning', error instanceof Error ? error.message : 'AtlasBridge worker boot failed.')
      })

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      manager.dispose()
      managerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (modelDownloadProgress.value >= 100 && !modelVerified.value) {
      modelVerified.value = true
      pushToast('400MB model verified', 'Qwen2.5 local weights finished downloading and are ready offline.')
    }
  }, [modelDownloadProgress.value])

  return (
    <main class="min-h-screen px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div class="mx-auto flex max-w-7xl flex-col gap-6">
        <header class="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p class="text-sm font-semibold uppercase tracking-[0.3em] text-sky-300">
                Lampad AtlasBridge
              </p>
              <h1 class="mt-2 text-3xl font-bold text-white">Offline-first newcomer assistant</h1>
              <p class="mt-3 max-w-3xl text-sm text-slate-300">
                Worker-native browser AI with Preact signals, local vector search, IndexedDB SOS packet
                persistence, and PWA-ready model caching.
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <span class="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                {connectionStatus.value.toUpperCase()}
              </span>
              <span class="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
                {bundleInfo.value ? `${bundleInfo.value.dimension}D bundle ready` : 'Seeding vectors...'}
              </span>
              <span class="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">
                {modelVerified.value ? '400MB model verified' : 'Model warm-up pending'}
              </span>
            </div>
          </div>
        </header>

        <section
          class={`rounded-3xl border p-4 text-sm ${
            gpuSupported.value
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-100'
          }`}
        >
          {hardwareBanner.value}
        </section>

        <section class="grid gap-6 lg:grid-cols-[1.7fr,1fr]">
          <article class="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex gap-2">
                <button
                  class={`rounded-full px-4 py-2 text-sm font-semibold ${
                    activeTab.value === 'chat'
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-slate-800 text-slate-200'
                  }`}
                  type="button"
                  onClick={() => {
                    activeTab.value = 'chat'
                  }}
                >
                  Grounded Local Chat
                </button>
                <button
                  class={`rounded-full px-4 py-2 text-sm font-semibold ${
                    activeTab.value === 'rag'
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-slate-800 text-slate-200'
                  }`}
                  type="button"
                  onClick={() => {
                    activeTab.value = 'rag'
                  }}
                >
                  Vector Search (RAG)
                </button>
              </div>
              <div class="flex flex-wrap gap-2 text-xs text-slate-300">
                <span>Latency: {latencyMs.value ? `${latencyMs.value.toFixed(1)} ms` : '—'}</span>
                <span>Inference ping: {pingMetrics.value.inference?.toFixed(2) ?? '—'} ms</span>
                <span>Retrieval ping: {pingMetrics.value.retrieval?.toFixed(2) ?? '—'} ms</span>
              </div>
            </div>

            {activeTab.value === 'chat' ? (
              <div class="mt-5 space-y-4">
                <div class="flex flex-wrap items-center gap-3">
                  <div class="inline-flex rounded-full bg-slate-800 p-1">
                    <button
                      type="button"
                      class={`rounded-full px-4 py-2 text-sm ${
                        chatMode.value === 'INFO'
                          ? 'bg-slate-100 text-slate-950'
                          : 'text-slate-300'
                      }`}
                      onClick={() => {
                        chatMode.value = 'INFO'
                      }}
                    >
                      Survival Info
                    </button>
                    <button
                      type="button"
                      class={`rounded-full px-4 py-2 text-sm ${
                        chatMode.value === 'LEARN'
                          ? 'bg-slate-100 text-slate-950'
                          : 'text-slate-300'
                      }`}
                      onClick={() => {
                        chatMode.value = 'LEARN'
                      }}
                    >
                      English Tutor
                    </button>
                  </div>
                  <span class="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200">
                    SOS warning badge: {liveWarningCount.value}
                  </span>
                </div>

                <div class="max-h-[24rem] space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  {chatTurns.value.map((turn) => (
                    <div
                      key={turn.id}
                      class={`rounded-2xl p-3 text-sm ${
                        turn.role === 'user'
                          ? 'ml-auto max-w-[85%] bg-sky-500/20 text-sky-50'
                          : 'mr-auto max-w-[90%] bg-slate-800 text-slate-100'
                      }`}
                    >
                      <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {turn.role === 'user' ? 'You' : 'AtlasBridge'}
                      </p>
                      <p class="whitespace-pre-wrap leading-6">{turn.content || 'Streaming local response…'}</p>
                    </div>
                  ))}
                </div>

                <form
                  class="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const manager = managerRef.current
                    const prompt = draftPrompt.value.trim()

                    if (!manager || !prompt || busy.value || !retrievalReady.value || !inferenceReady.value) {
                      return
                    }

                    busy.value = true
                    draftPrompt.value = ''
                    submitPrompt(manager, prompt)
                      .catch((error) => {
                        chatTurns.value = [
                          ...chatTurns.value,
                          {
                            id: crypto.randomUUID(),
                            role: 'assistant',
                            content:
                              error instanceof Error
                                ? error.message
                                : 'AtlasBridge could not complete that local response.',
                          },
                        ]
                      })
                      .finally(() => {
                        busy.value = false
                      })
                  }}
                >
                  <textarea
                    class="min-h-32 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-sky-400"
                    placeholder="Ask about emergency help, transit, documents, or switch to English Tutor for translation and grammar coaching."
                    value={draftPrompt.value}
                    onInput={(event) => {
                      draftPrompt.value = event.currentTarget.value
                    }}
                  />
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <p class="text-xs text-slate-400">
                      {modelDownloadMessage.value} · Info mode stays grounded to local retrieved context.
                    </p>
                    <button
                      type="submit"
                      class="rounded-full bg-sky-400 px-5 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busy.value || !retrievalReady.value || !inferenceReady.value}
                    >
                      {busy.value ? 'Thinking locally…' : 'Send'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div class="mt-5 space-y-4">
                <div class="grid gap-4 sm:grid-cols-3">
                  <div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p class="text-xs uppercase tracking-widest text-slate-400">Bundle status</p>
                    <p class="mt-2 text-lg font-semibold text-white">
                      {bundleInfo.value ? `${bundleInfo.value.entries.length} passages` : 'Compiling'}
                    </p>
                  </div>
                  <div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p class="text-xs uppercase tracking-widest text-slate-400">Search target</p>
                    <p class="mt-2 text-lg font-semibold text-white">≤ 50 ms brute-force cosine</p>
                  </div>
                  <div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p class="text-xs uppercase tracking-widest text-slate-400">Threshold</p>
                    <p class="mt-2 text-lg font-semibold text-white">{KNOWLEDGE_THRESHOLD}</p>
                  </div>
                </div>

                <div class="space-y-3">
                  {scanLogs.value.length === 0 ? (
                    <div class="rounded-2xl border border-dashed border-slate-700 p-6 text-sm text-slate-400">
                      Submit a chat prompt to populate diagnostic retrieval scans and matching metrics.
                    </div>
                  ) : (
                    scanLogs.value.map((log) => (
                      <div key={log.id} class="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <p class="font-semibold text-white">{log.query}</p>
                          <p class="text-xs text-slate-400">
                            {log.searchMs.toFixed(2)} ms · threshold {log.threshold}
                          </p>
                        </div>
                        <ul class="mt-3 space-y-2">
                          {log.matches.map((match) => (
                            <li key={match.id} class="rounded-xl bg-slate-900/80 p-3 text-sm">
                              <div class="flex items-center justify-between gap-3">
                                <span class="font-medium text-slate-100">{match.title}</span>
                                <span class="text-xs text-sky-300">{match.score.toFixed(3)}</span>
                              </div>
                              <p class="mt-1 text-xs text-slate-400">
                                {match.locale} · {match.category}
                              </p>
                              <p class="mt-2 text-slate-300">{match.text}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </article>

          <aside class="space-y-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <section class="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p class="text-xs uppercase tracking-widest text-slate-400">Model download</p>
              <div class="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
                <div
                  class="h-full rounded-full bg-sky-400 transition-all"
                  style={{ width: `${modelDownloadProgress.value}%` }}
                />
              </div>
              <p class="mt-3 text-sm text-slate-300">{modelDownloadMessage.value}</p>
            </section>

            <section class="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p class="text-xs uppercase tracking-widest text-slate-400">Ping verification</p>
              <ul class="mt-3 space-y-2 text-sm text-slate-300">
                <li>Inference worker: {pingMetrics.value.inference?.toFixed(2) ?? '—'} ms</li>
                <li>Retrieval worker: {pingMetrics.value.retrieval?.toFixed(2) ?? '—'} ms</li>
                <li>
                  Result:{' '}
                  {pingMetrics.value.inference !== null &&
                  pingMetrics.value.retrieval !== null &&
                  pingMetrics.value.inference < 5 &&
                  pingMetrics.value.retrieval < 5
                    ? 'PASS'
                    : 'PENDING / CHECK DEVICE'}
                </li>
              </ul>
            </section>

            <section class="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <p class="text-xs uppercase tracking-widest text-slate-400">Offline safety sync</p>
              <p class="mt-3 text-sm text-slate-300">
                IndexedDB stores distress packets in <code class="rounded bg-slate-800 px-1">pending_sos</code>,
                then posts them to the Render backend when connectivity returns.
              </p>
            </section>
          </aside>
        </section>
      </div>

      <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-3">
        {toasts.value.map((toast) => (
          <div key={toast.id} class="rounded-2xl border border-slate-700 bg-slate-900/95 p-4 shadow-xl">
            <p class="font-semibold text-white">{toast.title}</p>
            <p class="mt-1 text-sm text-slate-300">{toast.body}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
