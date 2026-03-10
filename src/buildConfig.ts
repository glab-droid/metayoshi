export type BuildModelStatus = 'tested' | 'untested' | 'blocked'

export type BuildConfig = {
  coins?: {
    enabled?: 'all' | '*' | 'tested' | string[]
    disabled?: string[]
  }
  features?: Record<string, boolean | undefined>
  modelStatus?: {
    tested?: string[]
    untested?: string[]
    blocked?: string[]
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeId(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

const HARD_TESTED_MODEL_IDS = new Set(['rtm', 'eth', 'base', 'bnb', 'sol', 'dash', 'btcz', 'cosmos'])

function normalizeModelStatusId(value: unknown): string {
  const id = normalizeId(value)
  if (!id) return ''

  // Server-backed aliases should map to runtime model ids for status display.
  if (id === 'srv--dash') return 'dash'
  if (id === 'srv--ethereum' || id === 'ethereum') return 'eth'
  if (id === 'srv--base' || id === 'base-mainnet' || id === 'mainnet-base') return 'base'
  if (
    id === 'srv--bnb'
    || id === 'bsc'
    || id === 'bnb-mainnet'
    || id === 'mainnet-bnb'
    || id === 'bsc-mainnet'
    || id === 'bnb-smart-chain'
    || id === 'binance-smart-chain'
    || id === 'bnb-smart-chain-mainnet'
    || id === 'binance-smart-chain-mainnet'
  ) {
    return 'bnb'
  }
  if (id.startsWith('eth--')) return 'eth'
  if (id.startsWith('base--')) return 'base'
  return id
}

function normalizeIdList(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(normalizeId).filter(Boolean)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    return trimmed.split(',').map((v) => normalizeId(v)).filter(Boolean)
  }
  return []
}

function parseBooleanLike(value: unknown, fallback: boolean): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function normalizeBuildConfig(raw: unknown): BuildConfig {
  const obj = asRecord(raw) || {}
  const coins = asRecord(obj.coins)
  const features = asRecord(obj.features)
  const modelStatus = asRecord(obj.modelStatus)

  const enabledRaw = coins?.enabled
  const enabled = (() => {
    if (typeof enabledRaw === 'string') {
      const normalized = enabledRaw.trim().toLowerCase()
      if (['all', '*', 'tested'].includes(normalized)) {
        return normalized as 'all' | '*' | 'tested'
      }
    }
    if (Array.isArray(enabledRaw)) {
      return enabledRaw.map(normalizeId).filter(Boolean)
    }
    return undefined
  })()

  const out: BuildConfig = {
    coins: {
      enabled,
      disabled: normalizeIdList(coins?.disabled)
    },
    features: {},
    modelStatus: {
      tested: normalizeIdList(modelStatus?.tested),
      untested: normalizeIdList(modelStatus?.untested),
      blocked: normalizeIdList(modelStatus?.blocked)
    }
  }

  if (features) {
    for (const [key, value] of Object.entries(features)) {
      if (typeof value === 'boolean') out.features![key] = value
      else if (typeof value === 'string') out.features![key] = parseBooleanLike(value, false)
    }
  }

  if (!out.coins?.enabled && (out.coins?.disabled?.length ?? 0) === 0) delete out.coins
  if (Object.keys(out.features || {}).length === 0) delete out.features
  if (
    (out.modelStatus?.tested?.length ?? 0) === 0
    && (out.modelStatus?.untested?.length ?? 0) === 0
    && (out.modelStatus?.blocked?.length ?? 0) === 0
  ) {
    delete out.modelStatus
  }

  return out
}

export const BUILD_CONFIG: BuildConfig = normalizeBuildConfig(
  // Provided at compile-time via vite define().
  typeof __METAYOSHI_BUILD_CONFIG__ === 'undefined' ? undefined : __METAYOSHI_BUILD_CONFIG__
)

function getNormalizedBlockedModelIds(): Set<string> {
  return new Set(normalizeIdList(BUILD_CONFIG.modelStatus?.blocked).map(normalizeModelStatusId))
}

function getNormalizedTestedModelIds(): Set<string> {
  const tested = new Set(HARD_TESTED_MODEL_IDS)
  for (const modelId of normalizeIdList(BUILD_CONFIG.modelStatus?.tested).map(normalizeModelStatusId)) {
    if (modelId) tested.add(modelId)
  }
  for (const modelId of getNormalizedBlockedModelIds()) {
    tested.delete(modelId)
  }
  return tested
}

export function getTestedModelIds(): string[] {
  return [...getNormalizedTestedModelIds()]
}

export function getBuildFeatureFlag(featureKey: string, envKey: string, fallback: boolean): boolean {
  const fromConfig = BUILD_CONFIG.features?.[featureKey]
  if (typeof fromConfig === 'boolean') return fromConfig
  return parseBooleanLike((import.meta.env as any)?.[envKey], fallback)
}

export function getModelStatus(modelId: string): BuildModelStatus {
  const id = normalizeModelStatusId(modelId)
  if (!id) return 'untested'

  const blocked = getNormalizedBlockedModelIds()
  if (blocked.has(id)) return 'blocked'

  if (getNormalizedTestedModelIds().has(id)) return 'tested'

  const explicitUntested = normalizeIdList(BUILD_CONFIG.modelStatus?.untested).map(normalizeModelStatusId)
  if (explicitUntested.length > 0) {
    const untested = new Set(explicitUntested)
    if (untested.has(id)) return 'untested'
  }

  return 'untested'
}

export function getModelIconRingClass(modelId: string): string {
  const status = getModelStatus(modelId)
  if (status === 'tested') return 'ring-2 ring-green-500/70'
  if (status === 'blocked') return 'ring-2 ring-red-500/70'
  return 'ring-2 ring-orange-500/70'
}

export function getModelIconFrameClass(modelId: string): string {
  const status = getModelStatus(modelId)
  if (status === 'tested') return 'border-green-500/50 shadow-[0_0_14px_rgba(34,197,94,0.24)]'
  if (status === 'blocked') return 'border-red-500/50 shadow-[0_0_14px_rgba(239,68,68,0.24)]'
  return 'border-primary/40 shadow-[0_0_14px_rgba(245,132,31,0.2)]'
}
