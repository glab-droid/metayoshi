export interface BridgeTraceEntry {
  id: string
  ts: number
  source: string
  event: string
  context?: string
}

export const BRIDGE_TRACE_STORAGE_KEY = 'metayoshi-bridge-trace-v1'
const MAX_BRIDGE_TRACE_ENTRIES = 400

function hasChromeStorage(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
  } catch {
    return false
  }
}

function makeTraceId(): string {
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function compactContext(context?: Record<string, unknown>): string | undefined {
  if (!context) return undefined
  try {
    const json = JSON.stringify(context)
    if (!json) return undefined
    return json.length > 2500 ? `${json.slice(0, 2500)}...` : json
  } catch {
    return undefined
  }
}

async function storageGet<T>(key: string, fallback: T): Promise<T> {
  if (!hasChromeStorage()) return fallback
  return await new Promise<T>((resolve) => {
    try {
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime?.lastError) {
          resolve(fallback)
          return
        }
        const value = (result?.[key] as T | undefined) ?? fallback
        resolve(value)
      })
    } catch {
      resolve(fallback)
    }
  })
}

async function storageSet<T>(key: string, value: T): Promise<void> {
  if (!hasChromeStorage()) return
  await new Promise<void>((resolve) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => resolve())
    } catch {
      resolve()
    }
  })
}

export async function getBridgeTraceLog(): Promise<BridgeTraceEntry[]> {
  const rows = await storageGet<BridgeTraceEntry[]>(BRIDGE_TRACE_STORAGE_KEY, [])
  return Array.isArray(rows) ? rows : []
}

export async function clearBridgeTraceLog(): Promise<void> {
  await storageSet(BRIDGE_TRACE_STORAGE_KEY, [])
}

export async function recordBridgeTrace(
  source: string,
  event: string,
  context?: Record<string, unknown>
): Promise<void> {
  const entry: BridgeTraceEntry = {
    id: makeTraceId(),
    ts: Date.now(),
    source,
    event,
    context: compactContext(context)
  }

  const current = await getBridgeTraceLog()
  const next = [entry, ...current].slice(0, MAX_BRIDGE_TRACE_ENTRIES)
  await storageSet(BRIDGE_TRACE_STORAGE_KEY, next)
}
