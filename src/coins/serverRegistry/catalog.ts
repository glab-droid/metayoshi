import type { ServerCoinCatalogItem, ServerCoinRow } from './types'
import {
  inferRuntimeModelFromTokenLikeCoinId,
  isBlockedServerCoinId,
  isLikelyTokenServerCoinLike,
  mapServerCoinIdToNetworkId,
  normalizeServerCoinSymbol,
  resolveAppNetworkId
} from './mappings'
import { isServerCoinBridgeEnabled, resolveServerCoinChain, resolveServerCoinId } from './types'

function resolveActiveServerNetworkChain(coin: ServerCoinRow): 'main' | 'test' {
  const rows = Array.isArray(coin.networks) ? coin.networks.filter((n) => n && n.isActive !== false) : []
  if (rows.length === 0) return resolveServerCoinChain(coin, null)
  const main = rows.find((n) => String(n.chain || '').trim().toLowerCase() === 'main')
  const selected = main || rows[0]
  return resolveServerCoinChain(coin, selected)
}

export function isLikelyTokenServerCoin(coin: ServerCoinRow): boolean {
  return isLikelyTokenServerCoinLike(
    String(coin?.coinId || ''),
    String(coin?.name || ''),
    String(coin?.symbol || '')
  )
}

export function buildServerCoinCatalog(coins: ServerCoinRow[]): ServerCoinCatalogItem[] {
  const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/
  const findHexAddressInValue = (value: unknown): string => {
    const text = String(value ?? '').trim()
    const m = text.match(/0x[a-fA-F0-9]{40}/)
    return m ? m[0] : ''
  }
  const findTronAddressInValue = (value: unknown): string => {
    const text = String(value ?? '').trim()
    const m = text.match(/\bT[1-9A-HJ-NP-Za-km-z]{33}\b/)
    return m ? m[0] : ''
  }
  const findSolanaMintInValue = (value: unknown): string => {
    const text = String(value ?? '').trim()
    if (text.length < 32 || text.length > 44) return ''
    if (!BASE58_RE.test(text)) return ''
    return text
  }
  const findTokenAddressInValue = (value: unknown): string => {
    return (
      findHexAddressInValue(value)
      || findTronAddressInValue(value)
      || findSolanaMintInValue(value)
    )
  }
  const findContractAddress = (coin: ServerCoinRow): string => {
    const direct = findTokenAddressInValue(coin.coinId) || findTokenAddressInValue(coin.name)
    if (direct) return direct

    const directFieldCandidates = [
      (coin as any)?.contractAddress,
      (coin as any)?.tokenAddress,
      (coin as any)?.mintAddress,
      (coin as any)?.address,
      (coin as any)?.mint
    ]
    for (const value of directFieldCandidates) {
      const fromField = findTokenAddressInValue(value)
      if (fromField) return fromField
    }

    const networks = Array.isArray(coin.networks) ? coin.networks : []
    for (const row of networks) {
      const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : null
      if (!metadata) continue
      const preferredMetaKeys = ['contractAddress', 'tokenAddress', 'mintAddress', 'address', 'mint', 'ca', 'contract']
      for (const key of preferredMetaKeys) {
        if (!(key in metadata)) continue
        const fromPreferred = findTokenAddressInValue((metadata as Record<string, unknown>)[key])
        if (fromPreferred) return fromPreferred
      }
      for (const value of Object.values(metadata)) {
        const fromMeta = findTokenAddressInValue(value)
        if (fromMeta) return fromMeta
      }
    }
    return ''
  }

  const out: ServerCoinCatalogItem[] = []
  for (const coin of coins) {
    if (!coin?.enabled) continue
    if (!isServerCoinBridgeEnabled(coin)) continue
    const coinId = resolveServerCoinId(coin)
    if (!coinId) continue
    if (isBlockedServerCoinId(coinId)) continue

    const chain = resolveActiveServerNetworkChain(coin)
    const tokenLike = isLikelyTokenServerCoin(coin)
    const mappedModel = mapServerCoinIdToNetworkId(coinId)
    const runtimeModelId = tokenLike ? (inferRuntimeModelFromTokenLikeCoinId(coinId) || mappedModel) : mappedModel
    const appNetworkId = runtimeModelId
      ? (tokenLike ? runtimeModelId : resolveAppNetworkId(runtimeModelId, coinId))
      : null

    out.push({
      coinId,
      name: String(coin.name || coinId).trim() || coinId,
      symbol: normalizeServerCoinSymbol(coinId, String(coin.symbol || '').trim()),
      kind: tokenLike ? 'asset' : 'main',
      contractAddress: tokenLike ? (findContractAddress(coin) || undefined) : undefined,
      runtimeModelId: runtimeModelId || null,
      appNetworkId,
      chain
    })
  }

  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'main' ? -1 : 1
    const left = `${a.name}|${a.coinId}`.toLowerCase()
    const right = `${b.name}|${b.coinId}`.toLowerCase()
    return left.localeCompare(right)
  })
}
