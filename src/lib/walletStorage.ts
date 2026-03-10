export const WALLET_STORAGE_KEY = 'metayoshi-storage'

export type PersistedStateEnvelope<T> = {
  state: T
  version?: number
}

export function isPersistedStateEnvelope<T>(value: unknown): value is PersistedStateEnvelope<T> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'state' in (value as Record<string, unknown>) &&
      typeof (value as { state?: unknown }).state === 'object'
  )
}

export function unwrapPersistedState<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== 'object') return null
  if (isPersistedStateEnvelope<T>(raw)) {
    return (raw as PersistedStateEnvelope<T>).state
  }
  return raw as T
}
