import { create } from 'zustand'

export interface ApiPendingRequest {
  id: string
  networkId?: string
  rpcMethod: string
  url: string
  startedAt: number
}

export interface ApiRecentRequest {
  id: string
  networkId?: string
  rpcMethod: string
  url: string
  startedAt: number
  endedAt: number
  durationMs: number
  status: 'success' | 'error'
  httpStatus?: number
  errorMessage?: string
}

interface ApiMonitorState {
  inFlight: number
  oldestPendingAt: number | null
  slowThresholdMs: number
  lastDurationMs: number | null
  lastSuccessAt: number | null
  lastError: string | null
  pendingById: Record<string, ApiPendingRequest>
  recent: ApiRecentRequest[]

  beginRequest: (input: { networkId?: string; rpcMethod: string; url: string }) => string
  completeRequest: (id: string, input?: { httpStatus?: number }) => void
  failRequest: (id: string, input: { errorMessage: string; httpStatus?: number }) => void
  clearLastError: () => void
}

const MAX_RECENT = 40

function makeRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getOldestPendingAt(pendingById: Record<string, ApiPendingRequest>): number | null {
  const values = Object.values(pendingById)
  if (values.length === 0) return null
  return values.reduce((min, item) => Math.min(min, item.startedAt), values[0].startedAt)
}

function pushRecent(
  prev: ApiRecentRequest[],
  item: ApiRecentRequest
): ApiRecentRequest[] {
  return [item, ...prev].slice(0, MAX_RECENT)
}

export const useApiMonitorStore = create<ApiMonitorState>((set, get) => ({
  inFlight: 0,
  oldestPendingAt: null,
  slowThresholdMs: 7000,
  lastDurationMs: null,
  lastSuccessAt: null,
  lastError: null,
  pendingById: {},
  recent: [],

  beginRequest: ({ networkId, rpcMethod, url }) => {
    const id = makeRequestId()
    const startedAt = Date.now()
    set((state) => {
      const pendingById = {
        ...state.pendingById,
        [id]: { id, networkId, rpcMethod, url, startedAt }
      }
      return {
        pendingById,
        inFlight: Object.keys(pendingById).length,
        oldestPendingAt: getOldestPendingAt(pendingById)
      }
    })
    return id
  },

  completeRequest: (id, input) => {
    const pending = get().pendingById[id]
    if (!pending) return
    const endedAt = Date.now()
    const durationMs = Math.max(0, endedAt - pending.startedAt)

    set((state) => {
      const pendingById = { ...state.pendingById }
      delete pendingById[id]
      return {
        pendingById,
        inFlight: Object.keys(pendingById).length,
        oldestPendingAt: getOldestPendingAt(pendingById),
        lastDurationMs: durationMs,
        lastSuccessAt: endedAt,
        lastError: null,
        recent: pushRecent(state.recent, {
          id,
          networkId: pending.networkId,
          rpcMethod: pending.rpcMethod,
          url: pending.url,
          startedAt: pending.startedAt,
          endedAt,
          durationMs,
          status: 'success',
          httpStatus: input?.httpStatus
        })
      }
    })
  },

  failRequest: (id, input) => {
    const pending = get().pendingById[id]
    if (!pending) return
    const endedAt = Date.now()
    const durationMs = Math.max(0, endedAt - pending.startedAt)
    const message = String(input.errorMessage || 'Unknown API error')

    set((state) => {
      const pendingById = { ...state.pendingById }
      delete pendingById[id]
      return {
        pendingById,
        inFlight: Object.keys(pendingById).length,
        oldestPendingAt: getOldestPendingAt(pendingById),
        lastDurationMs: durationMs,
        lastError: message,
        recent: pushRecent(state.recent, {
          id,
          networkId: pending.networkId,
          rpcMethod: pending.rpcMethod,
          url: pending.url,
          startedAt: pending.startedAt,
          endedAt,
          durationMs,
          status: 'error',
          httpStatus: input?.httpStatus,
          errorMessage: message
        })
      }
    })
  },

  clearLastError: () => set({ lastError: null })
}))
