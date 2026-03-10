import type { Network } from '../../coins'
import type { UtxoRpcConfig } from '../utxoRpc'
import { callBridgeMethod } from '../utxoRpc'
import { fetchServerAddressJson, normalizeServerAddress } from '../serverAddressApi'

let ethersModulePromise: Promise<typeof import('ethers')> | null = null
let solanaWeb3ModulePromise: Promise<typeof import('@solana/web3.js')> | null = null
let tronNonCustodialModulePromise: Promise<typeof import('../tronNonCustodial')> | null = null

function loadEthersModule() {
  if (!ethersModulePromise) ethersModulePromise = import('ethers')
  return ethersModulePromise
}

function loadSolanaWeb3Module() {
  if (!solanaWeb3ModulePromise) solanaWeb3ModulePromise = import('@solana/web3.js')
  return solanaWeb3ModulePromise
}

function loadTronNonCustodialModule() {
  if (!tronNonCustodialModulePromise) tronNonCustodialModulePromise = import('../tronNonCustodial')
  return tronNonCustodialModulePromise
}

function asNumberLike(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function asDecimalString(value: unknown): string {
  const raw = String(value ?? '').trim()
  return /^\d+(\.\d+)?$/.test(raw) ? raw : ''
}

function formatDecimalUnits(value: bigint, decimals: number): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const fraction = abs % base
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '')
  const out = fractionText ? `${whole.toString()}.${fractionText}` : whole.toString()
  return negative ? `-${out}` : out
}

function parseRpcQuantityToBigInt(value: unknown, label: string): bigint {
  const raw = String(value ?? '').trim()
  if (!raw) return 0n
  if (/^0x[0-9a-fA-F]+$/.test(raw)) return BigInt(raw)
  if (/^\d+$/.test(raw)) return BigInt(raw)
  const preview = raw.length > 120 ? `${raw.slice(0, 117)}...` : raw
  throw new Error(
    `${label} returned a non-quantity value (${preview}). ` +
    'RPC endpoint appears incompatible (must be JSON-RPC, not explorer API).'
  )
}

function isLikelyExplorerApiUrl(url: string): boolean {
  const lower = String(url || '').trim().toLowerCase()
  if (!lower) return false
  if (
    /etherscan\.io|bscscan\.com|polygonscan\.com|snowtrace\.io|arbiscan\.io|basescan\.org|ftmscan\.com/.test(lower)
  ) {
    return true
  }
  const hasApiPath = /\/api(?:[/?#]|$)/.test(lower)
  const hasExplorerQuery = /(?:\?|&)(module|action|apikey)=/i.test(lower)
  return hasApiPath && hasExplorerQuery
}

function isBlockedDirectEvmRpcUrl(url: string): boolean {
  const lower = String(url || '').trim().toLowerCase()
  if (!lower) return false
  return (
    lower.includes('ethereum-rpc.publicnode.com')
    || lower.includes('base-rpc.publicnode.com')
  )
}

function isEvmBridgePayloadIncompatibleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /RPC endpoint appears incompatible/i.test(message)
}

function resolveRpcCacheKey(rpcConfig: UtxoRpcConfig): string {
  const bridgeUrl = String(rpcConfig.bridgeUrl || '').trim().toLowerCase()
  if (bridgeUrl) return `bridge:${bridgeUrl}`
  const rpcUrl = String(rpcConfig.rpcUrl || '').trim().toLowerCase()
  const rpcWallet = String(rpcConfig.rpcWallet || '').trim().toLowerCase()
  return `rpc:${rpcUrl}|wallet:${rpcWallet}`
}

function resolveBridgeVariantCacheKey(rpcConfig: UtxoRpcConfig, scope: string): string {
  return `${resolveRpcCacheKey(rpcConfig)}|scope:${scope}`
}

function isFresh(checkedAt: number, ttlMs: number): boolean {
  return Date.now() - checkedAt <= ttlMs
}

const BRIDGE_METHOD_VARIANT_CACHE_TTL_MS = 10 * 60 * 1000
const bridgeMethodVariantCache = new Map<string, { method: string; checkedAt: number }>()

async function getSolanaBalanceViaBridge(rpcConfig: UtxoRpcConfig, address: string): Promise<string> {
  const variants: Array<{ method: string; params: any[] }> = [
    { method: 'getBalance', params: [address, { commitment: 'confirmed' }] },
    { method: 'getBalance', params: [address] },
    { method: 'getbalance', params: [address] }
  ]
  const cacheKey = resolveBridgeVariantCacheKey(rpcConfig, 'solana-balance')
  const cached = bridgeMethodVariantCache.get(cacheKey)
  const calls = cached && isFresh(cached.checkedAt, BRIDGE_METHOD_VARIANT_CACHE_TTL_MS)
    ? [
        ...variants.filter((v) => v.method === cached.method),
        ...variants.filter((v) => v.method !== cached.method)
      ]
    : variants

  let lastError: unknown = null
  for (const call of calls) {
    try {
      const result = await callBridgeMethod(rpcConfig, call.method, call.params)
      const lamports = asNumberLike((result as any)?.value ?? result)
      if (lamports !== null) {
        bridgeMethodVariantCache.set(cacheKey, { method: call.method, checkedAt: Date.now() })
        return formatDecimalUnits(BigInt(Math.trunc(lamports)), 9)
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Bridge Solana balance query failed')
}

async function getSolanaBalanceDirectRpc(rpcUrl: string, address: string): Promise<string> {
  const { Connection, LAMPORTS_PER_SOL, PublicKey } = await loadSolanaWeb3Module()
  const connection = new Connection(String(rpcUrl || '').trim(), 'confirmed')
  const lamports = await connection.getBalance(new PublicKey(address), 'confirmed')
  if (!Number.isFinite(lamports) || lamports < 0) {
    throw new Error('Invalid Solana balance from RPC')
  }
  return String(lamports / LAMPORTS_PER_SOL)
}

async function getStellarBalanceViaBridge(rpcConfig: UtxoRpcConfig, address: string): Promise<string> {
  const variants: Array<{ method: string; params: any[] }> = [
    { method: 'getaddressbalance', params: [address] },
    { method: 'getaddressbalance', params: [{ address }] },
    { method: 'getaddressbalance', params: [{ addresses: [address] }] },
    { method: 'getAccount', params: [address] }
  ]
  const cacheKey = resolveBridgeVariantCacheKey(rpcConfig, 'stellar-balance')
  const cached = bridgeMethodVariantCache.get(cacheKey)
  const calls = cached && isFresh(cached.checkedAt, BRIDGE_METHOD_VARIANT_CACHE_TTL_MS)
    ? [
        ...variants.filter((v) => v.method === cached.method),
        ...variants.filter((v) => v.method !== cached.method)
      ]
    : variants

  let lastError: unknown = null
  for (const call of calls) {
    try {
      const result = await callBridgeMethod(rpcConfig, call.method, call.params)
      const scalar = asDecimalString((result as any)?.balance ?? (result as any)?.result?.balance ?? result)
      if (scalar) {
        bridgeMethodVariantCache.set(cacheKey, { method: call.method, checkedAt: Date.now() })
        return scalar
      }
      const balances = Array.isArray((result as any)?.balances) ? (result as any).balances : []
      const native = balances.find((b: any) => String(b?.asset_type || '').toLowerCase() === 'native')
      const nativeBalance = asDecimalString(native?.balance)
      if (nativeBalance) {
        bridgeMethodVariantCache.set(cacheKey, { method: call.method, checkedAt: Date.now() })
        return nativeBalance
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Bridge Stellar balance query failed')
}

async function getCardanoBalanceViaBridge(rpcConfig: UtxoRpcConfig, address: string): Promise<string> {
  const variants: Array<{ method: string; params: any[] }> = [
    { method: 'getaddressbalance', params: [address] },
    { method: 'getaddressbalance', params: [{ address }] },
    { method: 'getaddressbalance', params: [{ addresses: [address] }] }
  ]
  const cacheKey = resolveBridgeVariantCacheKey(rpcConfig, 'cardano-balance')
  const cached = bridgeMethodVariantCache.get(cacheKey)
  const calls = cached && isFresh(cached.checkedAt, BRIDGE_METHOD_VARIANT_CACHE_TTL_MS)
    ? [
        ...variants.filter((v) => v.method === cached.method),
        ...variants.filter((v) => v.method !== cached.method)
      ]
    : variants

  let lastError: unknown = null
  for (const call of calls) {
    try {
      const result = await callBridgeMethod(rpcConfig, call.method, call.params)
      const rawBalance = String((result as any)?.balance ?? (result as any)?.result?.balance ?? result ?? '').trim()
      if (/^\d+$/.test(rawBalance)) {
        bridgeMethodVariantCache.set(cacheKey, { method: call.method, checkedAt: Date.now() })
        return formatDecimalUnits(BigInt(rawBalance), 6)
      }
      const decimal = asDecimalString(rawBalance)
      if (decimal) {
        bridgeMethodVariantCache.set(cacheKey, { method: call.method, checkedAt: Date.now() })
        return decimal
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Bridge Cardano balance query failed')
}

function parseServerBalanceScalar(json: Record<string, unknown> | null): string {
  return asDecimalString(
    json?.balance
    ?? (json?.result as any)?.balance
    ?? (json?.payload as any)?.balance
    ?? ''
  )
}

async function getTronBalanceViaServer(network: Network, address: string, timeoutMs?: number): Promise<string> {
  const response = await fetchServerAddressJson(network, address, 'balance', {}, { timeoutMs })
  if (!response.ok) {
    const detail = String(
      response.json?.error
      ?? (response.json?.result as any)?.error
      ?? response.text
      ?? `HTTP ${response.status}`
    ).trim()
    throw new Error(`Server TRON balance query failed [HTTP ${response.status}]: ${detail}`)
  }
  const scalar = parseServerBalanceScalar(response.json)
  if (!scalar) throw new Error(`Server TRON balance query returned no balance: ${response.url}`)
  return scalar
}

async function getEvmBalance(network: Network, address: string, rpcConfig: UtxoRpcConfig): Promise<string> {
  try {
    const { ethers } = await loadEthersModule()
    const balHex = await callBridgeMethod(rpcConfig, 'eth_getBalance', [address, 'latest'])
    const balanceWei = parseRpcQuantityToBigInt(balHex, 'eth_getBalance')
    return ethers.formatEther(balanceWei)
  } catch (error) {
    if (!isEvmBridgePayloadIncompatibleError(error)) throw error
    const rpcUrl = String(network.rpcUrl || '').trim()
    if (!rpcUrl || isLikelyExplorerApiUrl(rpcUrl) || isBlockedDirectEvmRpcUrl(rpcUrl)) throw error
    const { ethers } = await loadEthersModule()
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const wei = await provider.getBalance(address)
    return ethers.formatEther(wei)
  }
}

async function fetchSuiJsonRpc(endpoint: string, method: string, params: any[]): Promise<any> {
  const response = await fetch(String(endpoint || '').trim(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    })
  })
  if (!response.ok) throw new Error(`Sui RPC HTTP ${response.status}`)
  const json = await response.json().catch(() => null)
  if (!json || json.error) {
    throw new Error(`Sui RPC error: ${JSON.stringify(json?.error || json)}`)
  }
  return json.result
}

async function getSuiBalance(rpcUrl: string, address: string): Promise<string> {
  const candidates: Array<{ method: string; params: any[] }> = [
    { method: 'suix_getBalance', params: [address] },
    { method: 'suix_getBalance', params: [address, '0x2::sui::SUI'] },
    { method: 'suix_getAllBalances', params: [address] }
  ]

  let lastError: unknown = null
  for (const candidate of candidates) {
    try {
      const result = await fetchSuiJsonRpc(rpcUrl, candidate.method, candidate.params)
      const totalBalance = String(
        result?.totalBalance
        || result?.balance
        || result?.[0]?.totalBalance
        || result?.[0]?.balance
        || ''
      ).trim()
      if (/^\d+$/.test(totalBalance)) {
        return formatDecimalUnits(BigInt(totalBalance), 9)
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Sui balance query failed')
}

export async function fetchProtocolBalance(network: Network, modelId: string, address: string, rpcConfig?: UtxoRpcConfig): Promise<string | null> {
  if (modelId === 'sol') {
    if (rpcConfig?.bridgeUrl) {
      try {
        return await getSolanaBalanceViaBridge(rpcConfig, address)
      } catch {
        // Fall through to direct RPC.
      }
    }
    const rpcUrl = String(network.rpcUrl || '').trim()
    if (!rpcUrl) throw new Error('SOL RPC URL is not configured')
    return await getSolanaBalanceDirectRpc(rpcUrl, address)
  }
  if (modelId === 'ada') {
    if (!rpcConfig?.bridgeUrl) throw new Error('Bridge RPC config is required for ADA')
    return await getCardanoBalanceViaBridge(rpcConfig, address)
  }
  if (modelId === 'xlm') {
    if (!rpcConfig?.bridgeUrl) throw new Error('Bridge RPC config is required for XLM')
    return await getStellarBalanceViaBridge(rpcConfig, address)
  }
  if (modelId === 'tron') {
    try {
      return await getTronBalanceViaServer(network, address, Number(rpcConfig?.timeoutMs ?? 15000))
    } catch {
      // Fall through to alternate reads.
    }
    if (rpcConfig?.bridgeUrl) {
      try {
        const serverAddress = await normalizeServerAddress(network, address)
        if (/^0x[0-9a-fA-F]{40}$/.test(serverAddress)) {
          const { ethers } = await loadEthersModule()
          const raw = await callBridgeMethod(rpcConfig, 'eth_getBalance', [serverAddress, 'latest'])
          return ethers.formatEther(parseRpcQuantityToBigInt(raw, 'eth_getBalance'))
        }
      } catch {
        // Fall through to direct RPC.
      }
    }
    const rpcUrl = String(network.rpcUrl || '').trim()
    if (!rpcUrl) throw new Error('TRON RPC URL is not configured')
    const { getTronBalance } = await loadTronNonCustodialModule()
    return await getTronBalance(rpcUrl, address)
  }
  if (modelId === 'sui') {
    const rpcUrl = String(network.rpcUrl || '').trim()
    if (!rpcUrl) throw new Error('Sui RPC URL is not configured')
    return await getSuiBalance(rpcUrl, address)
  }
  if (network.coinType === 'EVM') {
    if (!rpcConfig?.bridgeUrl) throw new Error('Bridge RPC config is required for EVM networks')
    return await getEvmBalance(network, address, rpcConfig)
  }
  return null
}
