import type { Network } from '../coins'
import type { UtxoRpcConfig } from './utxoRpc'
import {
  getBlockchainInfo,
  getUtxoBalance,
  validateAddress,
} from './utxoRpc'
import type { EvmGasLane } from './coinFeatureModel'
import {
  fetchNetworkBalanceAndSync,
  resolveNetworkRuntimeProtocol,
  resolveNetworkSendCustodyMode,
  sendNetworkTransaction,
  sendUtxoNonCustodialNetworkTransaction,
  validateNetworkAddress,
  type SendUtxoNonCustodialInput,
  type ChainSendCustodyMode
} from './protocolRegistry'

export interface ChainBalanceSyncResult {
  balance: string
  syncPercent: number | null
  isSyncing: boolean
}

export interface FetchChainBalanceInput {
  network: Network
  address: string
  rpcConfig?: UtxoRpcConfig
  skipChainSyncProbe?: boolean
  preferAddressIndexBalance?: boolean
  zeroBalanceRecheckMs?: number
}

export interface SendChainTransactionInput {
  network: Network
  to: string
  amount: string
  rpcConfig?: UtxoRpcConfig
  evm?: {
    mnemonic: string
    accountIndex: number
    gasLane?: EvmGasLane
  }
  utxoSend?: () => Promise<{ hash: string }>
  xrpSend?: () => Promise<{ hash: string }>
}

export type { UtxoDonationInput, SendUtxoNonCustodialInput } from './protocolRegistry'

function resolveProtocol(network: Network): string {
  return resolveNetworkRuntimeProtocol(network)
}

export function resolveChainSendCustodyMode(network: Network): ChainSendCustodyMode {
  return resolveNetworkSendCustodyMode(network)
}

function resolveSyncStateFromChainInfo(chainInfo: any): { syncPercent: number | null; isSyncing: boolean } {
  let syncPercent: number | null = null
  let isSyncing = false
  const vpRaw = Number(chainInfo?.verificationprogress)
  const fallbackFromBlocks =
    Number(chainInfo?.headers) > 0
      ? (Number(chainInfo?.blocks) / Number(chainInfo?.headers))
      : NaN
  const progress01 = Number.isFinite(vpRaw) && vpRaw > 0 ? vpRaw : fallbackFromBlocks
  if (Number.isFinite(progress01) && progress01 >= 0) {
    syncPercent = Math.max(0, Math.min(100, progress01 * 100))
  }
  if (typeof chainInfo?.initialblockdownload === 'boolean') {
    isSyncing = chainInfo.initialblockdownload
  } else if (syncPercent !== null) {
    isSyncing = syncPercent < 99.9
  }
  return { syncPercent, isSyncing }
}

const CHAIN_INFO_CACHE_TTL_MS = 12 * 1000
const ADDRESS_VALIDATION_CACHE_TTL_MS = 30 * 1000

const chainInfoCache = new Map<string, { value: any; checkedAt: number }>()
const addressValidationCache = new Map<string, { value: boolean; checkedAt: number }>()

function resolveRpcCacheKey(rpcConfig: UtxoRpcConfig): string {
  const bridgeUrl = String(rpcConfig.bridgeUrl || '').trim().toLowerCase()
  if (bridgeUrl) return `bridge:${bridgeUrl}`
  const rpcUrl = String(rpcConfig.rpcUrl || '').trim().toLowerCase()
  const rpcWallet = String(rpcConfig.rpcWallet || '').trim().toLowerCase()
  return `rpc:${rpcUrl}|wallet:${rpcWallet}`
}

function isFresh(checkedAt: number, ttlMs: number): boolean {
  return Date.now() - checkedAt <= ttlMs
}

async function getCachedBlockchainInfo(rpcConfig: UtxoRpcConfig): Promise<any> {
  const cacheKey = resolveRpcCacheKey(rpcConfig)
  const cached = chainInfoCache.get(cacheKey)
  if (cached && isFresh(cached.checkedAt, CHAIN_INFO_CACHE_TTL_MS)) {
    return cached.value
  }
  const value = await getBlockchainInfo(rpcConfig)
  chainInfoCache.set(cacheKey, { value, checkedAt: Date.now() })
  return value
}

export async function fetchChainBalanceAndSync(input: FetchChainBalanceInput): Promise<ChainBalanceSyncResult> {
  const address = String(input.address || '').trim()
  if (!address) throw new Error('Address is required')

  const protocolBalance = await fetchNetworkBalanceAndSync(input.network, address, input.rpcConfig)
  if (protocolBalance !== null) {
    return protocolBalance
  }

  if (!input.rpcConfig) {
    throw new Error(`RPC config is required for ${input.network.symbol}`)
  }

  let syncPercent: number | null = null
  let isSyncing = false
  if (!input.skipChainSyncProbe) {
    try {
      const chainInfo = await getCachedBlockchainInfo(input.rpcConfig)
      const parsed = resolveSyncStateFromChainInfo(chainInfo)
      syncPercent = parsed.syncPercent
      isSyncing = parsed.isSyncing
    } catch {
      // Keep default sync unknown when chain probe fails.
    }
  }
  let balance = await getUtxoBalance(input.rpcConfig, address, {
    preferAddressIndex: input.preferAddressIndexBalance
  })
  if (balance.total <= 0 && input.zeroBalanceRecheckMs && input.zeroBalanceRecheckMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, input.zeroBalanceRecheckMs))
    try {
      const secondRead = await getUtxoBalance(input.rpcConfig, address, {
        preferAddressIndex: input.preferAddressIndexBalance
      })
      if (secondRead.total > balance.total) balance = secondRead
    } catch {
      // Preserve first read.
    }
  }
  return { balance: String(balance.total), syncPercent, isSyncing }
}

export async function validateChainAddress(network: Network, rpcConfig: UtxoRpcConfig | undefined, address: string): Promise<boolean> {
  const protocol = resolveProtocol(network)
  const value = String(address || '').trim()
  if (!value) return false
  const protocolValidated = await validateNetworkAddress(network, value, { runtimeProtocol: protocol })
  if (typeof protocolValidated === 'boolean') return protocolValidated
  if (!rpcConfig) throw new Error(`RPC config is required for ${network.symbol}`)
  const cacheKey = `${resolveRpcCacheKey(rpcConfig)}|addr:${value}`
  const cached = addressValidationCache.get(cacheKey)
  if (cached && isFresh(cached.checkedAt, ADDRESS_VALIDATION_CACHE_TTL_MS)) {
    return cached.value
  }
  const result = await validateAddress(rpcConfig, value)
  const isValid = Boolean(result?.isvalid)
  addressValidationCache.set(cacheKey, { value: isValid, checkedAt: Date.now() })
  return isValid
}

export async function sendChainTransaction(input: SendChainTransactionInput): Promise<{ hash: string }> {
  return sendNetworkTransaction(input)
}

export async function sendUtxoNonCustodialTransaction(input: SendUtxoNonCustodialInput): Promise<{ hash: string }> {
  return sendUtxoNonCustodialNetworkTransaction(input)
}
