import { BUNDLED_COIN_REGISTRY } from './catalog'
import type { CoinManifest } from './registryTypes'
import type { CoinModule } from './types'

function normalizeRegistryToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
}

function uniq(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeRegistryToken(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

const MANIFESTS = BUNDLED_COIN_REGISTRY.map((entry) => ({
  ...entry.manifest,
  aliases: uniq([
    entry.manifest.id,
    entry.manifest.runtimeModelId,
    entry.manifest.coinId,
    ...(entry.manifest.aliases || [])
  ])
}))

const MANIFEST_BY_ID = new Map<string, CoinManifest>(
  MANIFESTS.map((manifest) => [manifest.id, manifest])
)

const MANIFEST_BY_ALIAS = new Map<string, CoinManifest>()
for (const manifest of MANIFESTS) {
  for (const alias of manifest.aliases || []) {
    MANIFEST_BY_ALIAS.set(alias, manifest)
  }
}

const COIN_BY_ID = new Map<string, CoinModule>(
  BUNDLED_COIN_REGISTRY.map((entry) => [entry.manifest.id, entry.coin])
)

export function getBundledCoinRegistryEntries() {
  return [...BUNDLED_COIN_REGISTRY]
}

export function getCoinManifestById(id: string): CoinManifest | undefined {
  return MANIFEST_BY_ID.get(String(id || '').trim())
}

export function getCoinManifestByAlias(value: string): CoinManifest | undefined {
  return MANIFEST_BY_ALIAS.get(normalizeRegistryToken(value))
}

export function getCanonicalCoinId(value: string): string | null {
  return getCoinManifestByAlias(value)?.id || null
}

export function getCoinManifests(): CoinManifest[] {
  return [...MANIFESTS]
}

export function getCoinIdsByProtocol(protocolFamily: CoinManifest['protocolFamily']): string[] {
  return MANIFESTS
    .filter((manifest) => manifest.protocolFamily === protocolFamily)
    .map((manifest) => manifest.id)
}

export function getBundledEvmCoinIds(): string[] {
  return MANIFESTS
    .filter((manifest) => manifest.protocolFamily === 'evm' && manifest.includeInEvmSet)
    .map((manifest) => manifest.id)
}

export function getBundledEthereumLayer2CoinIds(): string[] {
  return MANIFESTS
    .filter((manifest) => manifest.protocolFamily === 'evm' && manifest.isEthereumLayer2)
    .map((manifest) => manifest.id)
}

export function getEvmChainIdToCoinIdMap(): Record<number, string> {
  const out: Record<number, string> = {}
  for (const manifest of MANIFESTS) {
    if (manifest.protocolFamily !== 'evm') continue
    if (!Number.isInteger(manifest.chainId) || Number(manifest.chainId) <= 0) continue
    out[Number(manifest.chainId)] = manifest.id
  }
  return out
}

export function getStandardRuntimeMetaMap(): Record<string, {
  symbol: string
  coinId: string
  chain?: 'main' | 'test'
  protocolFamily: CoinManifest['protocolFamily']
  chainId?: number
}> {
  const out: Record<string, {
    symbol: string
    coinId: string
    chain?: 'main' | 'test'
    protocolFamily: CoinManifest['protocolFamily']
    chainId?: number
  }> = {}
  for (const manifest of MANIFESTS) {
    const coin = COIN_BY_ID.get(manifest.id)
    const symbol = String(coin?.coinSymbol || coin?.symbol || '').trim()
    if (!symbol || !manifest.coinId) continue
    out[manifest.id] = {
      symbol,
      coinId: manifest.coinId,
      chain: manifest.chain,
      protocolFamily: manifest.protocolFamily,
      chainId: manifest.chainId
    }
  }
  return out
}

export function getHardTestedCoinIds(): string[] {
  return MANIFESTS
    .filter((manifest) => manifest.testedByDefault)
    .map((manifest) => manifest.id)
}

export function getDefaultVisibleCoinIds(): string[] {
  return MANIFESTS
    .filter((manifest) => manifest.visibleByDefault)
    .map((manifest) => manifest.id)
}
