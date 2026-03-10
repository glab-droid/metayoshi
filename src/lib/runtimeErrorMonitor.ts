export interface RuntimeErrorEntry {
  id: string
  ts: number
  source: string
  extensionId: string
  message: string
  stack?: string
  context?: string
}

const STORAGE_KEY = 'metayoshi-runtime-errors-v1'
const MAX_ERRORS = 200

function makeId(): string {
  return `err-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function runtimeId(): string {
  try {
    return chrome?.runtime?.id || 'unknown'
  } catch {
    return 'unknown'
  }
}

function hasChromeStorage(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
  } catch {
    return false
  }
}

function normalizeUnknown(input: unknown): { message: string; stack?: string } {
  if (input instanceof Error) {
    return { message: input.message || 'Unknown error', stack: input.stack }
  }
  if (typeof input === 'string') {
    return { message: input }
  }
  try {
    return { message: JSON.stringify(input) }
  } catch {
    return { message: String(input ?? 'Unknown error') }
  }
}

function compactContext(context?: Record<string, unknown>): string | undefined {
  if (!context) return undefined
  try {
    const json = JSON.stringify(context)
    if (!json) return undefined
    return json.length > 2000 ? `${json.slice(0, 2000)}...` : json
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

export async function getRuntimeErrorLog(): Promise<RuntimeErrorEntry[]> {
  const value = await storageGet<RuntimeErrorEntry[]>(STORAGE_KEY, [])
  return Array.isArray(value) ? value : []
}

export async function clearRuntimeErrorLog(): Promise<void> {
  await storageSet(STORAGE_KEY, [])
}

export async function recordRuntimeError(
  source: string,
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const normalized = normalizeUnknown(error)
  const entry: RuntimeErrorEntry = {
    id: makeId(),
    ts: Date.now(),
    source,
    extensionId: runtimeId(),
    message: normalized.message,
    stack: normalized.stack,
    context: compactContext(context)
  }

  const current = await getRuntimeErrorLog()
  const next = [entry, ...current].slice(0, MAX_ERRORS)
  await storageSet(STORAGE_KEY, next)
}

export function installGlobalErrorMonitor(source: string): void {
  const globalObj = globalThis as any
  const marker = `__metayoshi_error_monitor_installed_${source}`
  if (globalObj[marker]) return
  globalObj[marker] = true

  if (typeof globalObj.addEventListener !== 'function') return

  globalObj.addEventListener('error', (event: any) => {
    const payload = event?.error ?? event?.message ?? 'Unhandled runtime error'
    void recordRuntimeError(source, payload, {
      kind: 'error',
      filename: event?.filename,
      lineno: event?.lineno,
      colno: event?.colno
    })
  })

  globalObj.addEventListener('unhandledrejection', (event: any) => {
    void recordRuntimeError(source, event?.reason ?? 'Unhandled promise rejection', {
      kind: 'unhandledrejection'
    })
  })
}
