import type { Network } from '../coins'
import { estimateNetworkFee, getCoinRuntimeProfile } from '../coins'
import { getBuildFeatureFlag } from '../buildConfig'
import { getCoinManifestByAlias, getCoinManifestById } from '../coins/coinRegistry'
import type { CoinProtocolFamily } from '../coins/registryTypes'
import { deriveCosmosAddress, resolveCosmosAddressConfig } from './cosmosAddress'
import { deriveMoneroAddress } from './moneroAddress'
import { deriveSuiAddress } from './suiAddress'
import { isCosmosLikeModelId, isCroCosmosModelId, resolveRuntimeModelId } from './runtimeModel'
import type { UtxoRpcConfig } from './utxoRpc'
import { callBridgeMethod, getBlockchainInfo, sendBridgeEvmSignedRelay } from './utxoRpc'
import {
  createRawTransaction,
  getAddressMempoolSpentOutpoints,
  getAddressUtxos,
  getUtxoBalance,
  listUtxoUnspent,
  scanAddressUnspent,
  sendRawTransaction,
  sendToAddress,
  type UtxoUnspent
} from './utxoRpc'
import { getXrpAccountBalance } from './xrpRpc'
import { estimateEvmTxFee } from './evmFee'
import type { EvmGasLane, UtxoFeePreset, UtxoInputStrategy } from './coinFeatureModel'
import { signBtczTransparentTransaction, signLegacyP2pkhTransaction, type UnsignedTxInput } from './utxoSign'
import { isCosmosAddressForHrp } from './cosmosAddress'
import { isAddressForCoinSymbol } from './utxoAddress'
import { fetchCosmosBalanceAndSync, resolveCosmosNetworkConfig } from './protocolAdapters/cosmos'
import { validateProtocolAddress } from './protocolAdapters/addressValidation'
import { fetchProtocolBalance } from './protocolAdapters/balances'

export type ChainSendCustodyMode = 'non-custodial' | 'custodial-server' | 'unsupported'

export interface ProtocolBalanceResult {
  balance: string
  syncPercent: number | null
  isSyncing: boolean
}

export interface SendNetworkTransactionInput {
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

export interface UtxoDonationInput {
  address: string
  amount: string
  required?: boolean
}

export interface SendUtxoNonCustodialInput {
  network: Network
  rpcConfig: UtxoRpcConfig
  senderAddress: string
  to: string
  amount: string
  donation?: UtxoDonationInput
  feePreset?: UtxoFeePreset
  inputStrategy?: UtxoInputStrategy
  deriveSigningKey: (senderAddress: string) => Promise<{ privHex: string }>
}

interface ResolveProtocolOptions {
  modelId?: string
  runtimeProtocol?: string
}

interface ProtocolResolutionContext {
  modelId: string
  runtimeProtocol: string
  family: CoinProtocolFamily
}

let ethersModulePromise: Promise<typeof import('ethers')> | null = null
let xrpAddressModulePromise: Promise<typeof import('./xrpAddress')> | null = null
let cardanoAddressModulePromise: Promise<typeof import('./cardanoAddress')> | null = null
let solanaAddressModulePromise: Promise<typeof import('./solanaAddress')> | null = null
let stellarAddressModulePromise: Promise<typeof import('./stellarAddress')> | null = null
let tronAddressModulePromise: Promise<typeof import('./tronAddress')> | null = null

const CHAIN_INFO_CACHE_TTL_MS = 12 * 1000
const chainInfoCache = new Map<string, { value: any; checkedAt: number }>()

function loadEthersModule() {
  if (!ethersModulePromise) ethersModulePromise = import('ethers')
  return ethersModulePromise
}

function loadXrpAddressModule() {
  if (!xrpAddressModulePromise) xrpAddressModulePromise = import('./xrpAddress')
  return xrpAddressModulePromise
}

function loadCardanoAddressModule() {
  if (!cardanoAddressModulePromise) cardanoAddressModulePromise = import('./cardanoAddress')
  return cardanoAddressModulePromise
}

function loadSolanaAddressModule() {
  if (!solanaAddressModulePromise) solanaAddressModulePromise = import('./solanaAddress')
  return solanaAddressModulePromise
}

function loadStellarAddressModule() {
  if (!stellarAddressModulePromise) stellarAddressModulePromise = import('./stellarAddress')
  return stellarAddressModulePromise
}

function loadTronAddressModule() {
  if (!tronAddressModulePromise) tronAddressModulePromise = import('./tronAddress')
  return tronAddressModulePromise
}

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

function resolveNetworkRuntimeProfile(network: Network, modelId: string) {
  const runtimeCandidates = [
    String(network.runtimeModelId || '').trim().toLowerCase(),
    String(network.id || '').trim().toLowerCase(),
    String(network.serverCoinId || '').trim().toLowerCase(),
    modelId
  ].filter(Boolean)

  for (const candidate of runtimeCandidates) {
    const profile = getCoinRuntimeProfile(candidate)
    if (profile) return profile
  }
  return undefined
}

export function resolveNetworkRuntimeProtocol(network: Network, options?: ResolveProtocolOptions): string {
  const modelId = String(options?.modelId || resolveRuntimeModelId(network)).trim().toLowerCase()
  return resolveNetworkRuntimeProfile(network, modelId)?.protocol || String(options?.runtimeProtocol || '').trim() || 'utxo-jsonrpc'
}

export function resolveNetworkProtocolFamily(network: Network, options?: ResolveProtocolOptions): CoinProtocolFamily {
  const modelId = String(options?.modelId || resolveRuntimeModelId(network)).trim().toLowerCase()
  const runtimeProtocol = resolveNetworkRuntimeProtocol(network, { ...options, modelId })
  const manifest =
    getCoinManifestById(String(network.id || '').trim())
    || getCoinManifestByAlias(modelId)
    || getCoinManifestByAlias(String(network.serverCoinId || '').trim())

  if (manifest?.protocolFamily) return manifest.protocolFamily
  if (isCosmosLikeModelId(modelId) || String(network.coinType || '').trim().toUpperCase() === 'COSMOS') return 'cosmos'
  if (modelId === 'ada' || runtimeProtocol === 'cardano-wallet-compat') return 'cardano'
  if (modelId === 'xmr' || runtimeProtocol === 'monero-wallet-compat') return 'monero'
  if (modelId === 'sol') return 'solana'
  if (modelId === 'sui') return 'sui'
  if (modelId === 'xlm') return 'stellar'
  if (modelId === 'tron') return 'tron'
  if (String(network.coinType || '').trim().toUpperCase() === 'XRP' || runtimeProtocol === 'xrp-jsonrpc-compat') return 'xrp'
  if (String(network.coinType || '').trim().toUpperCase() === 'EVM') return 'evm'
  if (String(network.coinType || '').trim().toUpperCase() === 'UTXO') return 'utxo'
  return 'generic'
}

function resolveProtocolContext(network: Network, options?: ResolveProtocolOptions): ProtocolResolutionContext {
  const modelId = String(options?.modelId || resolveRuntimeModelId(network)).trim().toLowerCase()
  const runtimeProtocol = resolveNetworkRuntimeProtocol(network, { ...options, modelId })
  return {
    modelId,
    runtimeProtocol,
    family: resolveNetworkProtocolFamily(network, { ...options, modelId, runtimeProtocol })
  }
}

function evmDerivationPath(accountIndex: number): string {
  return `m/44'/60'/${accountIndex}'/0/0`
}

async function deriveEvmAddress(mnemonic: string, derivationIndex: number): Promise<string> {
  const { ethers } = await loadEthersModule()
  return ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, evmDerivationPath(derivationIndex)).address
}

async function deriveEvmWallet(mnemonic: string, accountIndex: number) {
  const { ethers } = await loadEthersModule()
  return ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, evmDerivationPath(accountIndex))
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

function assertCoinAmount(amount: string, decimals: number, symbol: string): void {
  const raw = String(amount || '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid ${symbol} amount`)
  const [whole, fraction = ''] = raw.split('.')
  if (fraction.length > decimals) throw new Error(`${symbol} supports up to ${decimals} decimals`)
  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('Amount must be greater than 0')
  void whole
}

function supportsAddressIndex(coinSymbol?: string): boolean {
  const symbol = String(coinSymbol || '').trim().toUpperCase()
  return symbol === 'RTM' || symbol === 'BTCZ' || symbol === 'TIDE' || symbol === 'FIRO' || symbol === 'DOGE'
}

function isClientSignerFormatError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return (
    /offset is outside the bounds of the dataview/i.test(message)
    || /failed to parse unsigned legacy transaction/i.test(message)
    || /unsupported varint size/i.test(message)
    || /invalid typed array length/i.test(message)
    || /input count mismatch/i.test(message)
  )
}

async function fetchXrpBalanceAndSync(address: string, rpcConfig: UtxoRpcConfig): Promise<ProtocolBalanceResult> {
  let syncPercent: number | null = null
  let isSyncing = false
  try {
    const chainInfo = await getCachedBlockchainInfo(rpcConfig)
    const parsed = resolveSyncStateFromChainInfo(chainInfo)
    syncPercent = parsed.syncPercent
    isSyncing = parsed.isSyncing
  } catch {
    // Keep sync unknown when chain probe fails.
  }
  const balance = await getXrpAccountBalance(rpcConfig, address)
  return { balance: balance.balance, syncPercent, isSyncing }
}

export async function deriveAddressForNetwork(
  mnemonic: string,
  network: Network,
  derivationIndex: number,
  options?: ResolveProtocolOptions
): Promise<string> {
  const context = resolveProtocolContext(network, options)

  if (context.family === 'evm') {
    return deriveEvmAddress(mnemonic, derivationIndex)
  }
  if (context.family === 'xrp') {
    const { deriveXrpAddress } = await loadXrpAddressModule()
    const derived = await deriveXrpAddress(mnemonic, derivationIndex)
    return derived.address
  }
  if (context.family === 'cosmos') {
    const cosmosCfg = resolveCosmosAddressConfig({
      runtimeModelId: context.modelId,
      serverCoinId: String(network.serverCoinId || '').trim(),
      id: String(network.id || '').trim()
    })
    const derived = await deriveCosmosAddress(mnemonic, derivationIndex, cosmosCfg)
    return derived.address
  }
  if (context.family === 'utxo' && network.coinSymbol) {
    const { deriveUtxoAddress } = await import('./utxoAddress')
    const derived = await deriveUtxoAddress(mnemonic, network.coinSymbol, derivationIndex, 0, 0)
    return derived.address
  }
  if (context.family === 'cardano') {
    const { deriveCardanoAddress } = await loadCardanoAddressModule()
    const derived = await deriveCardanoAddress(mnemonic, derivationIndex, network.rpcUrl)
    return derived.address
  }
  if (context.family === 'monero') {
    const derived = await deriveMoneroAddress(mnemonic, derivationIndex, network.rpcUrl)
    return derived.address
  }
  if (context.family === 'solana') {
    const { deriveSolanaAddress } = await loadSolanaAddressModule()
    const derived = await deriveSolanaAddress(mnemonic, derivationIndex)
    return derived.address
  }
  if (context.family === 'sui') {
    const derived = await deriveSuiAddress(mnemonic, derivationIndex)
    return derived.address
  }
  if (context.family === 'stellar') {
    const { deriveStellarAddress } = await loadStellarAddressModule()
    const derived = await deriveStellarAddress(mnemonic, derivationIndex)
    return derived.address
  }
  if (context.family === 'tron') {
    const { deriveTronAddress } = await loadTronAddressModule()
    const derived = await deriveTronAddress(mnemonic, derivationIndex)
    return derived.address
  }

  return ''
}

export async function validateNetworkAddress(
  network: Network,
  value: string,
  options?: ResolveProtocolOptions
): Promise<boolean | null> {
  const context = resolveProtocolContext(network, options)
  if (context.family === 'utxo' && network.coinSymbol) {
    return isAddressForCoinSymbol(value, network.coinSymbol)
  }
  return validateProtocolAddress(network, context.modelId, context.runtimeProtocol, value)
}

export async function fetchNetworkBalanceAndSync(
  network: Network,
  address: string,
  rpcConfig?: UtxoRpcConfig,
  options?: ResolveProtocolOptions
): Promise<ProtocolBalanceResult | null> {
  const context = resolveProtocolContext(network, options)

  if (context.family === 'cosmos') {
    if (!rpcConfig) throw new Error('Bridge RPC config is required for Cosmos-like networks')
    return fetchCosmosBalanceAndSync(network, address, rpcConfig)
  }

  const protocolBalance = await fetchProtocolBalance(network, context.modelId, address, rpcConfig)
  if (protocolBalance !== null) {
    return { balance: protocolBalance, syncPercent: 100, isSyncing: false }
  }

  if (context.runtimeProtocol === 'xrp-jsonrpc-compat') {
    if (!rpcConfig) throw new Error(`RPC config is required for ${network.symbol}`)
    return fetchXrpBalanceAndSync(address, rpcConfig)
  }

  return null
}

export async function sendNetworkTransaction(
  input: SendNetworkTransactionInput,
  options?: ResolveProtocolOptions
): Promise<{ hash: string }> {
  const context = resolveProtocolContext(input.network, options)
  const to = String(input.to || '').trim()
  if (!to) throw new Error('Destination address is required')

  if (context.family === 'xrp' || context.runtimeProtocol === 'xrp-jsonrpc-compat') {
    if (!input.xrpSend) throw new Error('XRP sender is not configured')
    return input.xrpSend()
  }

  if (context.family === 'evm') {
    const { ethers } = await loadEthersModule()
    const evmContext = input.evm
    if (!evmContext?.mnemonic) throw new Error('Wallet is locked')
    if (!input.rpcConfig || !input.rpcConfig.bridgeUrl) {
      throw new Error('Bridge RPC config is required for EVM networks')
    }
    const wallet = await deriveEvmWallet(evmContext.mnemonic, evmContext.accountIndex)
    const from = wallet.address
    const valueWei = ethers.parseEther(String(input.amount))
    const chainIdHex = await callBridgeMethod(input.rpcConfig, 'eth_chainId', [])
    const resolvedChainId = Number(parseRpcQuantityToBigInt(chainIdHex || input.network.chainId || 1, 'eth_chainId'))
    const expectedChainId = Number(input.network.chainId || 0)
    if (Number.isFinite(expectedChainId) && expectedChainId > 0 && resolvedChainId !== expectedChainId) {
      throw new Error(
        `Bridge/RPC chain mismatch: selected ${input.network.name} expects chainId ${expectedChainId}, got ${resolvedChainId}.`
      )
    }
    const nonceHex = await callBridgeMethod(input.rpcConfig, 'eth_getTransactionCount', [from, 'pending'])
    const feeQuote = await estimateEvmTxFee({
      rpcConfig: input.rpcConfig,
      from,
      to,
      valueWei,
      fallbackGasLimitHex: '0x5208',
      lane: evmContext.gasLane
    })

    const tx: any = {
      to,
      value: valueWei,
      nonce: Number(parseRpcQuantityToBigInt(nonceHex, 'eth_getTransactionCount')),
      gasLimit: feeQuote.gasLimit,
      chainId: resolvedChainId
    }
    if (feeQuote.type === 2) {
      tx.type = 2
      tx.maxFeePerGas = feeQuote.maxFeePerGas
      tx.maxPriorityFeePerGas = feeQuote.maxPriorityFeePerGas
    } else {
      tx.gasPrice = feeQuote.gasPrice ?? 1_000_000_000n
    }
    const signed = await wallet.signTransaction(tx)
    const relayed = await sendBridgeEvmSignedRelay(input.rpcConfig, {
      kind: 'coin',
      signedTxHex: signed
    })
    return { hash: String(relayed.txid) }
  }

  if (context.family === 'utxo' || context.runtimeProtocol === 'utxo-jsonrpc') {
    if (!input.utxoSend) throw new Error('UTXO sender is not configured')
    return input.utxoSend()
  }

  if (!input.rpcConfig) throw new Error(`RPC config is required for ${input.network.symbol}`)

  if (context.family === 'cardano' || context.runtimeProtocol === 'cardano-wallet-compat') {
    assertCoinAmount(input.amount, 6, 'ADA')
    throw new Error('Cardano send is disabled by strict non-custodial policy')
  }

  if (context.family === 'monero' || context.runtimeProtocol === 'monero-wallet-compat') {
    assertCoinAmount(input.amount, 12, 'XMR')
    throw new Error('Monero send is disabled by strict non-custodial policy')
  }

  throw new Error(`Unsupported protocol: ${context.runtimeProtocol}`)
}

export async function sendUtxoNonCustodialNetworkTransaction(input: SendUtxoNonCustodialInput): Promise<{ hash: string }> {
  const net = input.network
  const rpcConfig = input.rpcConfig
  const context = resolveProtocolContext(net)

  if (context.family !== 'utxo' && context.family !== 'cosmos') {
    throw new Error('Active network is not UTXO-compatible')
  }

  if (context.family === 'cosmos' && isCroCosmosModelId(context.modelId)) {
    const { hrp, decimals } = resolveCosmosNetworkConfig(net)
    const to = String(input.to || '').trim()
    if (!isCosmosAddressForHrp(to, hrp)) {
      throw new Error(`Destination address must be a valid ${hrp}1... address`)
    }
    const amount = Number(String(input.amount || '').trim())
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Amount must be greater than 0')
    }
    const txid = await sendToAddress(rpcConfig, to, Number(amount.toFixed(decimals)))
    return { hash: String(txid) }
  }

  if (context.family !== 'utxo') {
    throw new Error(`Unsupported non-custodial send family: ${context.family}`)
  }
  if (!net.coinSymbol) throw new Error('Network missing coinSymbol')

  const senderAddress = String(input.senderAddress || '').trim()
  if (!senderAddress) throw new Error(`No address derived for ${net.name}`)
  const senderValid = await validateNetworkAddress(net, senderAddress)
  if (senderValid !== true) {
    throw new Error(`Active sender address is invalid for ${net.symbol}: ${senderAddress}`)
  }

  let unspent: UtxoUnspent[] = []
  if (supportsAddressIndex(net.coinSymbol)) {
    try {
      const byIndex = await getAddressUtxos(rpcConfig, senderAddress, 1)
      if (byIndex.length > 0) unspent = byIndex
    } catch {
      // address index not available
    }
  }
  if (unspent.length === 0) {
    try {
      const byWallet = await listUtxoUnspent(rpcConfig, senderAddress, 1)
      if (byWallet.length > 0) unspent = byWallet
    } catch {
      // wallet does not hold address
    }
  }
  if (unspent.length === 0) {
    const scanned = await scanAddressUnspent(rpcConfig, senderAddress)
    if (scanned.length > 0) unspent = scanned
  }
  if (unspent.length > 0 && supportsAddressIndex(net.coinSymbol)) {
    try {
      const mempoolSpent = await getAddressMempoolSpentOutpoints(rpcConfig, senderAddress)
      if (mempoolSpent.size > 0) {
        unspent = unspent.filter((utxo) => !mempoolSpent.has(`${utxo.txid}:${utxo.vout}`))
      }
    } catch {
      // getaddressmempool may be unavailable
    }
  }
  if (unspent.length > 0) {
    const normalizedSender = senderAddress
    const before = unspent.length
    unspent = unspent.filter((utxo) => String(utxo.address || normalizedSender).trim() === normalizedSender)
    if (unspent.length !== before) {
      console.warn(`[${net.symbol}] filtered ${before - unspent.length} non-sender UTXOs before signing`)
    }
  }
  if (unspent.length === 0) {
    const balanceHint = await getUtxoBalance(rpcConfig, senderAddress, {
      preferAddressIndex: supportsAddressIndex(net.coinSymbol)
    }).catch(() => null)
    if (balanceHint && balanceHint.total > 0 && balanceHint.confirmed <= 0) {
      throw new Error(`Funds are present but not yet spendable (unconfirmed). Confirmed: ${balanceHint.confirmed}, total: ${balanceHint.total}`)
    }
    if (balanceHint && balanceHint.total > 0) {
      throw new Error('Detected pending unconfirmed spend from this address (mempool conflict). Wait for confirmation, then retry.')
    }
    throw new Error(`No confirmed spendable UTXOs found for address ${senderAddress}`)
  }

  const amountToSend = parseFloat(String(input.amount))
  const sat = (coins: number): number => Math.round(Number(coins) * 1e8)
  const coins8 = (sats: number): number => Number((sats / 1e8).toFixed(8))
  const donationAddress = String(input.donation?.address || '').trim()
  const donationAmountCoins = Number(input.donation?.amount ?? 0)
  const donationAmountSats = Number.isFinite(donationAmountCoins) && donationAmountCoins > 0 ? sat(donationAmountCoins) : 0
  if (input.donation?.required && donationAmountSats <= 0) {
    throw new Error('Donation is required by bridge policy')
  }
  if ((donationAmountSats > 0 || input.donation?.required) && !donationAddress) {
    throw new Error('Donation address is missing from bridge policy')
  }
  if (donationAmountSats > 0) {
    const donationValid = await validateNetworkAddress(net, donationAddress)
    if (donationValid !== true) {
      throw new Error(`Donation address is invalid for ${net.symbol}: ${donationAddress}`)
    }
  }

  const rawFeePerByteCoins = net.feePerByte ?? estimateNetworkFee(net.id, 1) ?? 0.0000002
  let feePerByteSats = Math.max(1, sat(rawFeePerByteCoins))
  if (feePerByteSats > 500) feePerByteSats = Math.max(1, Math.round(feePerByteSats / 1000))
  const feePreset = String(input.feePreset || 'fast').trim().toLowerCase()
  if (feePreset === 'cheap') feePerByteSats = Math.max(1, Math.floor((feePerByteSats * 80) / 100))
  if (feePreset === 'premium') feePerByteSats = Math.max(1, Math.ceil((feePerByteSats * 145) / 100))
  const OVERHEAD_BYTES = 10
  const INPUT_BYTES = 148
  const OUTPUT_BYTES = 34
  const MAX_REASONABLE_FEE_SATS = 10_000_000
  const DUST_THRESHOLD_SATS = 1_000
  let amountToSendSats = sat(amountToSend)
  const outputsWithoutChange = 1 + (donationAmountSats > 0 ? 1 : 0)
  const isRtmSelfSend = context.modelId === 'rtm' && String(input.to || '').trim() === senderAddress

  const inputStrategy = String(input.inputStrategy || 'minimize-inputs').trim().toLowerCase()
  const sorted = [...unspent].sort((a, b) => (
    inputStrategy === 'consolidate-fragments'
      ? a.amount - b.amount
      : b.amount - a.amount
  ))
  const selectedUtxos: UtxoUnspent[] = []
  let accumulatedSats = 0
  for (const utxo of sorted) {
    selectedUtxos.push(utxo)
    accumulatedSats += sat(utxo.amount)
    const txBytesTry = OVERHEAD_BYTES + INPUT_BYTES * selectedUtxos.length + OUTPUT_BYTES * (outputsWithoutChange + 1)
    const estimatedFeeTry = txBytesTry * feePerByteSats
    if (accumulatedSats >= amountToSendSats + donationAmountSats + estimatedFeeTry) break
    if (selectedUtxos.length >= 25) break
  }

  const txBytes = OVERHEAD_BYTES + INPUT_BYTES * selectedUtxos.length + OUTPUT_BYTES * (outputsWithoutChange + 1)
  const estimatedFeeSats = txBytes * feePerByteSats
  const totalAvailableSats = selectedUtxos.reduce((sum, utxo) => sum + sat(utxo.amount), 0)

  if (isRtmSelfSend && amountToSendSats + donationAmountSats + estimatedFeeSats > totalAvailableSats) {
    amountToSendSats = Math.max(0, totalAvailableSats - donationAmountSats - estimatedFeeSats)
  }
  if (amountToSendSats <= 0) {
    throw new Error(`Amount is too low after network fee for ${net.coinSymbol}`)
  }
  if (estimatedFeeSats > MAX_REASONABLE_FEE_SATS) {
    throw new Error(`Estimated fee too high: ${coins8(estimatedFeeSats)} ${net.coinSymbol}. Check fee settings / UTXO fragmentation.`)
  }
  if (amountToSendSats + donationAmountSats + estimatedFeeSats > totalAvailableSats) {
    throw new Error(`Insufficient balance: need ${coins8(amountToSendSats + donationAmountSats + estimatedFeeSats).toFixed(8)}, have ${coins8(totalAvailableSats).toFixed(8)}`)
  }
  const changeAmountSats = totalAvailableSats - amountToSendSats - donationAmountSats - estimatedFeeSats

  const derived = await input.deriveSigningKey(senderAddress)
  const inputs = selectedUtxos.map((utxo) => ({ txid: utxo.txid, vout: utxo.vout }))
  const toAddress = String(input.to || '').trim()
  const outputsSats: Record<string, number> = {}
  const addOutputSats = (address: string, satsValue: number) => {
    if (!address || satsValue <= 0) return
    outputsSats[address] = (outputsSats[address] || 0) + satsValue
  }
  addOutputSats(toAddress, amountToSendSats)
  addOutputSats(donationAddress, donationAmountSats)
  if (changeAmountSats > DUST_THRESHOLD_SATS) {
    addOutputSats(senderAddress, changeAmountSats)
  }
  const outputs = Object.fromEntries(Object.entries(outputsSats).map(([address, satsValue]) => [address, coins8(satsValue)]))

  const coinSymbol = String(net.coinSymbol || '').trim().toUpperCase()
  const isSaplingTransparent = coinSymbol === 'BTCZ' || coinSymbol === 'ARRR'
  let saplingBranchId: number | undefined
  if (isSaplingTransparent) {
    try {
      const chainInfo = await getBlockchainInfo(rpcConfig)
      const branchRaw = String((chainInfo as any)?.consensus?.chaintip ?? (chainInfo as any)?.consensus?.nextblock ?? '').trim()
      if (/^[0-9a-fA-F]{8}$/.test(branchRaw)) {
        saplingBranchId = Number.parseInt(branchRaw, 16) >>> 0
      }
    } catch (err) {
      console.warn(`[${net.symbol}] could not resolve consensus branch id, using Sapling signer default`, err)
    }
  }

  const rawHex = await createRawTransaction(rpcConfig, inputs, outputs)
  const signingInputs: UnsignedTxInput[] = selectedUtxos.map((utxo) => ({
    txid: utxo.txid,
    vout: utxo.vout,
    scriptPubKeyHex: utxo.scriptPubKey,
    amountSats: sat(utxo.amount)
  }))
  let signedHex = ''
  try {
    signedHex = isSaplingTransparent
      ? await signBtczTransparentTransaction(rawHex, signingInputs, derived.privHex, { consensusBranchId: saplingBranchId })
      : await signLegacyP2pkhTransaction(rawHex, signingInputs, derived.privHex)
  } catch (signErr) {
    if (isSaplingTransparent && isClientSignerFormatError(signErr)) {
      throw new Error(`${net.symbol} client-side signing failed while parsing transaction format. Only transparent Overwinter/Sapling transactions are supported.`)
    }
    throw signErr
  }

  try {
    const txid = await sendRawTransaction(rpcConfig, signedHex)
    return { hash: txid }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/txn-mempool-conflict|\(code\s*18\)|code\s*18/i.test(message)) {
      throw new Error('Transaction conflicts with a pending mempool transaction from this wallet. Wait for at least 1 confirmation and try again.')
    }
    throw error
  }
}

export function resolveNetworkSendCustodyMode(network: Network, options?: ResolveProtocolOptions): ChainSendCustodyMode {
  const context = resolveProtocolContext(network, options)

  if (context.family === 'cosmos') {
    return isCroCosmosModelId(context.modelId) ? 'custodial-server' : 'non-custodial'
  }
  if (context.family === 'solana' || context.family === 'stellar' || context.family === 'tron') {
    return 'non-custodial'
  }
  if (context.family === 'sui') return 'unsupported'
  if (context.family === 'cardano') return 'non-custodial'
  if (context.family === 'monero') {
    const enabled = getBuildFeatureFlag('enableXmrNonCustodial', 'VITE_ENABLE_XMR_NON_CUSTODIAL', false)
    return enabled ? 'non-custodial' : 'unsupported'
  }
  if (context.family === 'evm' || context.family === 'utxo' || context.family === 'xrp') {
    return 'non-custodial'
  }
  if (context.runtimeProtocol === 'cosmos-rest-bridge') return 'non-custodial'
  if (context.runtimeProtocol === 'utxo-jsonrpc') return 'non-custodial'
  if (context.runtimeProtocol === 'xrp-jsonrpc-compat') return 'non-custodial'
  if (context.runtimeProtocol === 'cardano-wallet-compat' || context.runtimeProtocol === 'monero-wallet-compat') {
    return 'unsupported'
  }

  return 'unsupported'
}
