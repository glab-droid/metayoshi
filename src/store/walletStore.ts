import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { ethers } from 'ethers'
import { decryptVaultV1, encryptVaultV1, type EncryptedVaultV1 } from '../lib/vaultCrypto'
import { normalizeDappOrigin } from '../lib/dappPermissions'
import { WALLET_STORAGE_KEY } from '../lib/walletStorage'
import {
  callBridgeMethod,
  sendBridgeEvmSignedRelay,
  fetchBridgeTokenBalances,
  listAssetBalancesByAddress,
  sendBridgeTokenTransfer,
  sendRtmAssetNonCustodial,
  getAssetDetailsByName,
  type BridgeTokenBalanceRow,
  type RtmAssetDetails,
  type UtxoRpcConfig
} from '../lib/utxoRpc'
import { resolveBridgeTxKeyCandidates } from '../lib/bridgeAuth'
import { deriveUtxoAddress, deriveUtxoAddressWithSpec, isAddressForCoinSymbol } from '../lib/utxoAddress'
import { getSolanaTokenRegistry } from '../lib/solanaTokenRegistry'
import { deriveCosmosAddress, isCosmosAddressForHrp } from '../lib/cosmosAddress'
import { signCosmosExecuteContractTxBase64, signCosmosTokenTransferTxBase64 } from '../lib/cosmosNonCustodial'
import { normalizeServerAddress } from '../lib/serverAddressApi'
import { resolveEvmExternalSigner, resolveEvmExternalSignerMode } from '../lib/evmExternalSigner'
import { getBuildFeatureFlag } from '../buildConfig'
import { isCosmosLikeModelId, requiresMnemonicForNetwork, resolveRuntimeModelId as resolveNetworkModelId } from '../lib/runtimeModel'
import { MIN_SYNC_PERCENT_FOR_SEND } from '../lib/sendSyncPolicy'
import { resolveNetworkCapabilities } from '../lib/networkCapabilities'
import {
  normalizeNetworkModelPreferences,
  normalizeNetworkModelPreferencesRecord,
  type NetworkModelPreferences
} from '../lib/coinFeatureModel'
import { buildSolanaAssetId, extractSolanaMintFromAssetId } from '../lib/assetTypes'
import { validateWatchOnlyAddress } from '../lib/watchOnlyAddress'
import { getTokenLogoForAsset } from '../coins/tokenlogos'
import { createRequestCache } from '../lib/requestCache'
import { estimateEvmTxFee } from '../lib/evmFee'
import {
  fetchChainBalanceAndSync,
  type ChainBalanceSyncResult,
  resolveChainSendCustodyMode,
  sendChainTransaction,
  sendUtxoNonCustodialTransaction,
  validateChainAddress
} from '../lib/chainRpcAdapter'
import {
  DEFAULT_ACTIVE_NETWORK_ID,
  DEFAULT_NETWORK_ID,
  getCoinRuntimeProfile,
  INITIAL_NETWORKS,
  estimateNetworkFee,
  loadServerRegistrySnapshot
} from '../coins'
import { getCoinApiInterceptor } from '../coins/interceptors'
import { STANDARD_RUNTIME_META } from '../coins/standardRuntimeMeta'
import type { CoinType, Network } from '../coins'
import type { ServerCoinCatalogItem } from '../coins'
import { useApiMonitorStore } from './apiMonitorStore'
import {
  clampDisabledNetworkIdsToMaxEnabled,
  isCroCosmosModel,
  MAX_ACTIVE_REFRESH_NETWORKS,
  normalizeActivityList,
  normalizeActivityRecord,
  normalizeDisabledNetworkIdsForState,
  normalizeNetworkIdAlias,
  normalizeNetworkSymbol,
  parseDecimalToAtomicUnits,
  remapNetworkIdKeyedRecord,
  resolveCosmosNetworkConfig,
  resolveDefaultDisabledNetworkIds,
  resolveEnabledNetworkId,
  resolveEthereumOnlyNetworkDefaults,
  resolveKnownNetworkId,
  shouldForceCanonicalUtxoAddress
} from './walletStoreStateUtils'
import {
  deriveAccountAddresses,
  deriveSingleNetworkAddress
} from './walletStoreAddressing'
import {
  computeLowSyncStreak,
  updateAccountsWithNetworkBalance
} from './walletStoreBalanceHelpers'

export type { CoinType, Network } from '../coins'

const APP_API_KEY = String((import.meta as any)?.env?.VITE_APP_API_KEY || '').trim()

// Ã¢â€â‚¬Ã¢â€â‚¬ Full backup format Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export interface FullBackupV1 {
  type: 'metayoshi-full-backup'
  version: 1
  createdAt: number
  /** Password-encrypted vault containing the mnemonic. */
  vault: import('../lib/vaultCrypto').EncryptedVaultV1
  accounts: Account[]
  nextAccountIndex: number
  activeAccountId: string | null
  activeNetworkId: string
  activity: Activity[]
  authorizedSites: string[]
  autolockMinutes: number
  donationPercent: number
  backupConfirmed: boolean
  networkAssets: Record<string, Record<string, number>>
  sendListPreferences?: Record<string, SendListPreferenceBucket>
  networkModelPreferences?: Record<string, NetworkModelPreferences>
  onboardingCompleted?: boolean
}

export type SendableItemKind = 'native' | 'fungible' | 'nft'

export interface SendListPreferenceBucket {
  /** Explicit ordering for send entries in one account+network scope. */
  order: string[]
  /** Pinned entries displayed above non-pinned rows. */
  pinned: string[]
  /** Hidden entries excluded from the default send list. */
  hidden: string[]
}

export interface SendableItem {
  /** Stable preference id. For EVM tokens we normalize to contract-based ids. */
  id: string
  /** Raw wallet asset id used by sendAssetTransfer. */
  assetId?: string
  requestType: 'native' | 'asset'
  kind: SendableItemKind
  networkId: string
  accountId: string
  symbol: string
  label: string
  logoUrl?: string
  amount: string
  /** Satoshi-like integer (1e8 scale) for sorting/comparisons. */
  rawAmount: number
  pinned: boolean
  hidden: boolean
}

type RefreshActiveBalanceOptions = {
  fast?: boolean
  skipZeroBalanceRecheck?: boolean
}

export interface Account {
  id: string
  name: string
  /** Per-network account labels, keyed by network id. */
  networkNames: Record<string, string>
  /** BIP44 account index used for deterministic derivation. */
  derivationIndex: number
  addresses: Record<CoinType, string>
  /** Per-network derived addresses, keyed by network id */
  networkAddresses: Record<string, string>
  /** Per-network cached balance strings, keyed by network id. */
  networkBalances: Record<string, string>
  balance: string
}

export interface Activity {
  id: string
  type: 'sent' | 'received' | 'swap'
  asset: string
  amount: string
  to?: string
  from?: string
  accountId?: string
  status: 'pending' | 'confirmed' | 'rejected'
  timestamp: number
  networkId: string
}

export interface ChainModelLiveSnapshot {
  networkId: string
  symbol: string
  protocol: string
  backendMode: 'evm-rpc' | 'bridge'
  address: string
  addressValid: boolean
  balance: string
  syncPercent: number | null
  isSyncing: boolean
  isConnected: boolean
  nonCustodialCompliant: boolean
  sendCustodyMode: 'non-custodial' | 'custodial-server' | 'unsupported'
  serverMatched: boolean
  checkedAt: number
  error?: string
}

type FiatCurrency = 'usd' | 'eur'
type FiatValueMap = Partial<Record<FiatCurrency, number | null>>

interface WalletState {
  // Auth state
  isInitialized: boolean
  hasVault: boolean
  isLocked: boolean
  vault: EncryptedVaultV1 | null
  backupConfirmed: boolean
  createdAt: number | null
  sessionMnemonic: string | null
  onboardingCompleted: boolean

  // Wallet state
  accounts: Account[]
  nextAccountIndex: number
  activeAccountId: string | null
  activeNetworkId: string
  networks: Network[]
  /** Hidden main blockchains excluded from wallet UI/runtime scans. */
  disabledNetworkIds: string[]

  // App state
  isConnected: boolean
  isSyncing: boolean
  /** Sync percentage for current network when known (0-100). */
  syncPercent: number | null
  /** Consecutive refresh checks below the safe sync threshold. */
  lowSyncStreak: number
  /** Monotonic id for active balance refresh requests. */
  balanceRefreshNonce: number
  /** Per-network asset balances. Key = networkId, value = { assetName: rawAmount (sats) } */
  networkAssets: Record<string, Record<string, number>>
  /** Per-network asset logos. Key = networkId, value = { assetName: logoUrl } */
  networkAssetLogos: Record<string, Record<string, string>>
  /** Per-network asset display labels. Key = networkId, value = { assetName: label } */
  networkAssetLabels: Record<string, Record<string, string>>
  /** EVM NFT metadata key lookup by network id and asset key. */
  evmNftAssets: Record<string, Record<string, EvmNftHolding>>
  /** Account+network scoped asset balances keyed by `${accountId}::${networkId}`. */
  accountNetworkAssets: Record<string, Record<string, number>>
  /** Account+network scoped asset logos keyed by `${accountId}::${networkId}`. */
  accountNetworkAssetLogos: Record<string, Record<string, string>>
  /** Account+network scoped asset labels keyed by `${accountId}::${networkId}`. */
  accountNetworkAssetLabels: Record<string, Record<string, string>>
  /** Account+network scoped EVM NFT metadata keyed by `${accountId}::${networkId}`. */
  accountNetworkEvmNftAssets: Record<string, Record<string, EvmNftHolding>>
  /** Account+network scoped portfolio totals in fiat. */
  accountNetworkFiatTotals: Record<string, FiatValueMap>
  /** Account+network scoped native coin fiat value. */
  accountNetworkFiatNative: Record<string, FiatValueMap>
  /** Account+network scoped token/NFT fiat values keyed by asset id. */
  accountNetworkFiatAssets: Record<string, Record<string, FiatValueMap>>
  /** Full server registry catalog, classified as main blockchain vs token/asset. */
  serverCoinCatalog: ServerCoinCatalogItem[]
  /** Per account+network send list preferences. Key = `${accountId}::${networkId}`. */
  sendListPreferences: Record<string, SendListPreferenceBucket>
  /** Per-network execution preferences for model-specific send controls. */
  networkModelPreferences: Record<string, NetworkModelPreferences>
  authorizedSites: string[]
  autolockMinutes: number
  donationPercent: number
  lastActiveTimestamp: number
  activity: Activity[]

  // Actions
  initialize: (
    password: string,
    mnemonic: string,
    options?: { startWithEthereumOnly?: boolean }
  ) => Promise<void>
  unlock: (password: string) => Promise<boolean>
  verifyPassword: (password: string) => Promise<boolean>
  signBackendAuthMessage: (message: string) => Promise<{ address: string; signature: string }>
  lock: () => void
  setLocked: (locked: boolean) => void
  setInitialized: (initialized: boolean) => void
  setBackupConfirmed: (confirmed: boolean) => void
  setOnboardingCompleted: (completed: boolean) => void
  wipeVault: () => void
  
  setActiveAccount: (id: string) => void
  setActiveNetwork: (id: string, options?: { skipRefresh?: boolean }) => Promise<void>
  ensureNetworkAddress: (networkId: string) => Promise<string | null>
  
  setConnected: (connected: boolean) => void
  setSyncing: (syncing: boolean) => void
  
  addAuthorizedSite: (origin: string) => void
  removeAuthorizedSite: (origin: string) => void
  
  setAutolock: (minutes: number) => void
  setDonationPercent: (percent: number) => void
  updateLastActive: () => void
  checkAutolock: () => void
  
  addActivity: (item: Activity) => void
  trackActivityTransactionStatus: (params: { txid: string; networkId?: string }) => void
  changePassword: (oldPass: string, newPass: string) => boolean
  
  // Account management
  addAccount: (name: string, networkId?: string) => Promise<void>
  removeAccount: (id: string) => void
  updateAccount: (id: string, updates: Partial<Account>) => void
  setNetworkAccountName: (accountId: string, networkId: string, name: string) => void
  setWatchOnlyAddress: (accountId: string, networkId: string, address: string) => void
  
  // Network management
  addNetwork: (network: Network) => void
  removeNetwork: (id: string) => void
  updateNetwork: (id: string, updates: Partial<Network>) => void
  setNetworkEnabled: (networkId: string, enabled: boolean) => void
  syncNetworksFromServer: () => Promise<void>

  // RPC
  refreshActiveBalance: (options?: RefreshActiveBalanceOptions) => Promise<void>
  probeActiveChainModel: () => Promise<ChainModelLiveSnapshot>
  sendEvmTransaction: (params: {
    to?: string
    amount?: string
    value?: string
    data?: string
    gasLimit?: string
    gasPrice?: string
    maxFeePerGas?: string
    maxPriorityFeePerGas?: string
    type?: 2
  }) => Promise<{ hash: string }>
  sendCardanoTransaction: (params: { to: string; amount: string }) => Promise<{ hash: string }>
  sendSolanaTransaction: (params: { to: string; amount: string }) => Promise<{ hash: string }>
  sendStellarTransaction: (params: { to: string; amount: string }) => Promise<{ hash: string }>
  sendTronTransaction: (params: { to: string; amount: string }) => Promise<{ hash: string }>
  sendUtxoTransaction: (params: {
    to: string
    amount: string
    memo?: string
    donation?: {
      address: string
      amount: string
      required?: boolean
    }
  }) => Promise<{ hash: string }>

  // Full backup / restore
  fullRestore: (params: {
    backup: FullBackupV1
    backupPassword: string
    newPassword: string
  }) => Promise<void>

  // Asset layer (cross-chain)
  fetchNetworkAssets: (options?: { force?: boolean }) => Promise<void>
  fetchNetworkFiat: (options?: { force?: boolean }) => Promise<void>
  fetchAssetDetails: (assetId: string) => Promise<RtmAssetDetails>
  getSendableItems: (options?: {
    accountId?: string
    networkId?: string
    includeHidden?: boolean
    includeZeroBalance?: boolean
  }) => SendableItem[]
  setSendListPreferences: (params: {
    accountId?: string
    networkId?: string
    order?: string[]
    pinned?: string[]
    hidden?: string[]
  }) => void
  getNetworkModelPreferences: (networkId?: string) => NetworkModelPreferences
  setNetworkModelPreferences: (params: {
    networkId?: string
    updates: Partial<NetworkModelPreferences>
  }) => void
  resetSendListPreferences: (params?: {
    accountId?: string
    networkId?: string
  }) => void
  sendAssetTransfer: (params: {
    assetId: string
    qty: string
    toAddress: string
    memo?: string
    changeAddress?: string
    assetChangeAddress?: string
  }) => Promise<{ txid: string }>
  /** @deprecated Use sendAssetTransfer */
  sendRtmAsset: (params: {
    assetId: string
    qty: string
    toAddress: string
    memo?: string
    changeAddress?: string
    assetChangeAddress?: string
  }) => Promise<{ txid: string }>
}

const BALANCE_UI_STABILIZE_MS = 650
const UTXO_ZERO_BALANCE_RECHECK_MS = 900
const SEND_OPERATION_MAX_TPS = 5
const SEND_OPERATION_MIN_INTERVAL_MS = Math.max(1, Math.trunc(1000 / SEND_OPERATION_MAX_TPS))
const MIN_DONATION_PERCENT = 0.5
const MAX_DONATION_PERCENT = 5
const FROZEN_STABLE_NETWORK_IDS = new Set<string>(['rtm', 'eth', 'dash', 'btcz', 'firo'])
const DEFAULT_TRANSIENT_BRIDGE_COOLDOWN_MS = 20_000
const TRANSIENT_BRIDGE_COOLDOWN_MS_BY_NETWORK: Record<string, number> = {
  eth: 60_000,
  firo: 45_000
}
const DEFAULT_UNSUPPORTED_BRIDGE_ASSET_ENDPOINT_TTL_MS = 30 * 60 * 1000
const transientBridgeCooldownUntilByNetwork = new Map<string, number>()
const unsupportedBridgeAssetEndpointUntilByKey = new Map<string, number>()
let sendOperationRateLimiterQueue: Promise<void> = Promise.resolve()
let sendOperationNextAllowedAtMs = 0
let refreshActiveBalanceInFlight: Promise<void> | null = null
let refreshActiveBalanceQueuedOptions: RefreshActiveBalanceOptions | null = null
const trackedActivityStatusPollers = new Set<string>()
let cardanoAddressModulePromise: Promise<typeof import('../lib/cardanoAddress')> | null = null
let cardanoNonCustodialModulePromise: Promise<typeof import('../lib/cardanoNonCustodial')> | null = null
let solanaAddressModulePromise: Promise<typeof import('../lib/solanaAddress')> | null = null
let solanaNonCustodialModulePromise: Promise<typeof import('../lib/solanaNonCustodial')> | null = null
let stellarAddressModulePromise: Promise<typeof import('../lib/stellarAddress')> | null = null
let stellarNonCustodialModulePromise: Promise<typeof import('../lib/stellarNonCustodial')> | null = null
let tronAddressModulePromise: Promise<typeof import('../lib/tronAddress')> | null = null
let tronNonCustodialModulePromise: Promise<typeof import('../lib/tronNonCustodial')> | null = null

function loadCardanoAddressModule() {
  if (!cardanoAddressModulePromise) cardanoAddressModulePromise = import('../lib/cardanoAddress')
  return cardanoAddressModulePromise
}

function loadCardanoNonCustodialModule() {
  if (!cardanoNonCustodialModulePromise) cardanoNonCustodialModulePromise = import('../lib/cardanoNonCustodial')
  return cardanoNonCustodialModulePromise
}

function loadSolanaAddressModule() {
  if (!solanaAddressModulePromise) solanaAddressModulePromise = import('../lib/solanaAddress')
  return solanaAddressModulePromise
}

function loadSolanaNonCustodialModule() {
  if (!solanaNonCustodialModulePromise) solanaNonCustodialModulePromise = import('../lib/solanaNonCustodial')
  return solanaNonCustodialModulePromise
}

function loadStellarAddressModule() {
  if (!stellarAddressModulePromise) stellarAddressModulePromise = import('../lib/stellarAddress')
  return stellarAddressModulePromise
}

function loadStellarNonCustodialModule() {
  if (!stellarNonCustodialModulePromise) stellarNonCustodialModulePromise = import('../lib/stellarNonCustodial')
  return stellarNonCustodialModulePromise
}

function loadTronAddressModule() {
  if (!tronAddressModulePromise) tronAddressModulePromise = import('../lib/tronAddress')
  return tronAddressModulePromise
}

function loadTronNonCustodialModule() {
  if (!tronNonCustodialModulePromise) tronNonCustodialModulePromise = import('../lib/tronNonCustodial')
  return tronNonCustodialModulePromise
}

function buildTrackedActivityStatusKey(networkId: string, txid: string): string {
  return `${String(networkId || '').trim().toLowerCase()}::${String(txid || '').trim().toLowerCase()}`
}

async function checkOnChainTransactionStatus(
  net: Network,
  rpcConfig: UtxoRpcConfig,
  txid: string
): Promise<Activity['status']> {
  const normalizedTxid = String(txid || '').trim()
  if (!normalizedTxid) return 'pending'

  if (net.coinType === 'EVM') {
    try {
      const receipt = await callBridgeMethod(rpcConfig, 'eth_getTransactionReceipt', [normalizedTxid]) as any
      if (!receipt || typeof receipt !== 'object') return 'pending'
      const status = String(receipt?.status ?? '').trim().toLowerCase()
      if (status === '0x1' || status === '1' || status === '0x01') return 'confirmed'
      if (status === '0x0' || status === '0' || status === '0x00') return 'rejected'
      if (String(receipt?.blockHash || '').trim()) return 'confirmed'
      return 'pending'
    } catch {
      return 'pending'
    }
  }

  const modelId = resolveNetworkModelId(net)

  if (modelId === 'sol') {
    try {
      const statusRes = await callBridgeMethod(
        rpcConfig,
        'getSignatureStatuses',
        [[normalizedTxid], { searchTransactionHistory: true }]
      ) as any
      const row = statusRes?.value?.[0] ?? statusRes?.result?.value?.[0]
      if (!row) return 'pending'
      if (row?.err) return 'rejected'
      const confirmationStatus = String(row?.confirmationStatus || '').trim().toLowerCase()
      if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') return 'confirmed'
      const confirmations = Number(row?.confirmations)
      if (Number.isFinite(confirmations) && confirmations >= 1) return 'confirmed'
      return 'pending'
    } catch {
      return 'pending'
    }
  }

  if (net.coinType === 'UTXO') {
    try {
      const txInfo = await callBridgeMethod(rpcConfig, 'gettransaction', [normalizedTxid]) as any
      const confirmations = Number(txInfo?.confirmations)
      if (Number.isFinite(confirmations) && confirmations >= 1) return 'confirmed'
      if (String(txInfo?.blockhash || '').trim()) return 'confirmed'
    } catch {
      // Continue with getrawtransaction fallback.
    }
    try {
      const rawInfo = await callBridgeMethod(rpcConfig, 'getrawtransaction', [normalizedTxid, true]) as any
      const confirmations = Number(rawInfo?.confirmations)
      if (Number.isFinite(confirmations) && confirmations >= 1) return 'confirmed'
      if (String(rawInfo?.blockhash || '').trim()) return 'confirmed'
      return 'pending'
    } catch {
      return 'pending'
    }
  }

  return 'pending'
}

function clampDonationPercent(value: number): number {
  if (!Number.isFinite(value)) return MIN_DONATION_PERCENT
  return Math.max(MIN_DONATION_PERCENT, Math.min(MAX_DONATION_PERCENT, Number(value.toFixed(1))))
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function mergeRefreshActiveBalanceOptions(
  current: RefreshActiveBalanceOptions | null | undefined,
  incoming: RefreshActiveBalanceOptions | null | undefined
): RefreshActiveBalanceOptions | null {
  if (!current && !incoming) return null
  const merged: RefreshActiveBalanceOptions = {}
  if (current?.fast || incoming?.fast) merged.fast = true
  if (current?.skipZeroBalanceRecheck || incoming?.skipZeroBalanceRecheck) {
    merged.skipZeroBalanceRecheck = true
  }
  return merged
}

async function waitForSendOperationSlot(): Promise<void> {
  const runner = async () => {
    const now = Date.now()
    const waitMs = Math.max(0, sendOperationNextAllowedAtMs - now)
    if (waitMs > 0) await delay(waitMs)
    sendOperationNextAllowedAtMs = Date.now() + SEND_OPERATION_MIN_INTERVAL_MS
  }
  const pending = sendOperationRateLimiterQueue.then(runner, runner)
  sendOperationRateLimiterQueue = pending.catch(() => {})
  await pending
}

function isTransientBridgeFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return (
    /rpc call failed \[bridge\]: http 5\d\d/i.test(message)
    || /secure bridge .*http 5\d\d/i.test(message)
    || /bad gateway/i.test(message)
    || /rpc error \[[^\]]+\]: fetch failed/i.test(message)
    || /rpc call failed \[bridge\]:.*\bfetch failed\b/i.test(message)
    || /returned a non-quantity value/i.test(message)
    || /rpc endpoint appears incompatible/i.test(message)
    || /deprecated v1 endpoint/i.test(message)
  )
}

type BridgeAssetEndpointKind = 'token-balance' | 'address-assets'

function compactBridgeAssetErrorText(value: string, maxLen = 220): string {
  const compact = String(value || '').replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= maxLen) return compact
  return `${compact.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`
}

function isUnsupportedBridgeAssetEndpointError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return (
    /\bhttp 501\b/i.test(message)
    || /\b501\b.*\bnot implemented\b/i.test(message)
    || /\bnot implemented\b/i.test(message)
    || /\bhandler is not implemented\b/i.test(message)
  )
}

function buildUnsupportedBridgeAssetEndpointKey(networkId: string, endpoint: BridgeAssetEndpointKind): string {
  const normalizedNetworkId = String(networkId || '').trim().toLowerCase()
  if (!normalizedNetworkId) return ''
  return `${normalizedNetworkId}|${endpoint}`
}

function isUnsupportedBridgeAssetEndpointCached(networkId: string, endpoint: BridgeAssetEndpointKind): boolean {
  const key = buildUnsupportedBridgeAssetEndpointKey(networkId, endpoint)
  if (!key) return false
  const until = Number(unsupportedBridgeAssetEndpointUntilByKey.get(key) || 0)
  if (!Number.isFinite(until) || until <= Date.now()) {
    unsupportedBridgeAssetEndpointUntilByKey.delete(key)
    return false
  }
  return true
}

function markUnsupportedBridgeAssetEndpoint(networkId: string, endpoint: BridgeAssetEndpointKind): boolean {
  const key = buildUnsupportedBridgeAssetEndpointKey(networkId, endpoint)
  if (!key) return false
  const alreadyCached = isUnsupportedBridgeAssetEndpointCached(networkId, endpoint)
  unsupportedBridgeAssetEndpointUntilByKey.set(key, Date.now() + DEFAULT_UNSUPPORTED_BRIDGE_ASSET_ENDPOINT_TTL_MS)
  return !alreadyCached
}

function resolveTransientBridgeCooldownMs(networkId?: string): number {
  const key = String(networkId || '').trim().toLowerCase()
  return TRANSIENT_BRIDGE_COOLDOWN_MS_BY_NETWORK[key] ?? DEFAULT_TRANSIENT_BRIDGE_COOLDOWN_MS
}

function getTransientBridgeCooldownRemainingMs(networkId?: string): number {
  const key = String(networkId || '').trim().toLowerCase()
  if (!key) return 0
  const until = Number(transientBridgeCooldownUntilByNetwork.get(key) || 0)
  if (!Number.isFinite(until) || until <= Date.now()) {
    transientBridgeCooldownUntilByNetwork.delete(key)
    return 0
  }
  return Math.max(0, until - Date.now())
}

function setTransientBridgeCooldown(networkId?: string): void {
  const key = String(networkId || '').trim().toLowerCase()
  if (!key) return
  transientBridgeCooldownUntilByNetwork.set(key, Date.now() + resolveTransientBridgeCooldownMs(key))
}

async function createUtxoRpcConfig(
  net: Network,
  opts: {
    secureBridgeSigner?: (message: string) => Promise<{ address: string; signature: string }>
  } = {}
): Promise<UtxoRpcConfig> {
  const bridgeTxKeyCandidates = await resolveBridgeTxKeyCandidates()
  const bridgeTxKey = bridgeTxKeyCandidates[0]
  const secureBridgeWritesEnabled = (() => {
    return getBuildFeatureFlag('bridgeSecureWritesEnabled', 'VITE_BRIDGE_SECURE_WRITES_ENABLED', true)
  })()
  const secureBridgeApiBaseUrl = String(import.meta.env.VITE_SECURE_BRIDGE_API_BASE_URL || '').trim()

  return {
    networkId: net.id,
    coinSymbol: net.symbol,
    apiInterceptor: getCoinApiInterceptor(net.id),
    // Local RPC fields Ã¢â‚¬â€ use user override if set, otherwise fall back to network defaults
    rpcUrl: net.rpcUrl,
    rpcWallet: net.rpcWallet,
    rpcUsername: net.rpcUsername,
    rpcPassword: net.rpcPassword,
    // Bridge fields
    bridgeUrl:      net.bridgeUrl,
    bridgeUsername: net.bridgeUsername,
    bridgePassword: net.bridgePassword,
    bridgeTxKey,
    bridgeTxKeyCandidates,
    secureBridgeApiBaseUrl: secureBridgeApiBaseUrl || undefined,
    secureBridgeWritesEnabled,
    secureBridgeSigner: opts.secureBridgeSigner
  }
}

function evmDerivationPath(accountIndex: number): string {
  return `m/44'/60'/${accountIndex}'/0/0`
}

function deriveEvmWallet(mnemonic: string, accountIndex: number): ethers.HDNodeWallet {
  return ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, evmDerivationPath(accountIndex))
}

function isExternalEvmSignerEnabled(): boolean {
  return resolveEvmExternalSignerMode() !== 'local'
}

const EVM_ERC20_BALANCE_IFACE = new ethers.Interface(['function balanceOf(address) view returns (uint256)'])
const EVM_ERC20_TRANSFER_IFACE = new ethers.Interface([
  'function transfer(address to, uint256 value) returns (bool)',
  'function decimals() view returns (uint8)'
])
const EVM_ERC20_METADATA_IFACE = new ethers.Interface([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
])
const EVM_ERC165_IFACE = new ethers.Interface(['function supportsInterface(bytes4 interfaceId) view returns (bool)'])
const EVM_ERC721_IFACE = new ethers.Interface([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
])
const EVM_ERC1155_IFACE = new ethers.Interface([
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function uri(uint256 id) view returns (string)',
  'function name() view returns (string)'
])
const EVM_ERC721_ENUMERABLE_IFACE = new ethers.Interface([
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)'
])
const ERC721_INTERFACE_ID = '0x80ac58cd'
const ERC1155_INTERFACE_ID = '0xd9b67a26'
const MAX_TRACKED_EVM_NFTS = 120
const EVM_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)')
const EVM_TOKEN_DISCOVERY_TTL_MS = 5 * 60 * 1000
const evmTokenDiscoveryCache = new Map<string, {
  checkedAt: number
  addresses: string[]
}>()

type EvmTrackedToken = {
  address: string
  symbol: string
  decimals: number
  logoUri?: string
  discovered?: boolean
}

type EvmNftStandard = 'erc721' | 'erc1155'

type EvmTrackedNft = {
  address: string
  tokenId: string
  standard: EvmNftStandard | 'auto'
  label?: string
}

type EvmNftHolding = {
  address: string
  tokenId: string
  standard: EvmNftStandard
  label: string
  quantityRaw: string
}

type ScopedAssetBuckets = {
  assets: Record<string, number>
  logos: Record<string, string>
  labels: Record<string, string>
  evmNfts: Record<string, EvmNftHolding>
}

type PortfolioAssetFiatBuckets = {
  totals: FiatValueMap
  native: FiatValueMap
  assets: Record<string, FiatValueMap>
}

function buildAssetStateScopeKey(accountId: string, networkId: string): string {
  return buildSendListPreferenceScopeKey(accountId, networkId)
}

function resolveCosmosBridgeCoinId(network: Network): string {
  const modelId = resolveNetworkModelId(network)
  const runtimeCoinId = getCoinRuntimeProfile(modelId)?.coinId
  const resolved = String(
    network.serverCoinId
    || runtimeCoinId
    || 'cosmos'
  ).trim().toLowerCase()
  return resolved || 'cosmos'
}

function normalizeFiatValueMap(input: unknown): FiatValueMap {
  const source = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {}
  const read = (key: FiatCurrency): number | null | undefined => {
    const raw = source[key]
    if (raw === null) return null
    const num = Number(raw)
    return Number.isFinite(num) ? num : undefined
  }
  const usd = read('usd')
  const eur = read('eur')
  const out: FiatValueMap = {}
  if (usd !== undefined) out.usd = usd
  if (eur !== undefined) out.eur = eur
  return out
}

export function formatFiatValue(value: number | null | undefined, currency: FiatCurrency = 'usd'): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return ''
  const absolute = Math.abs(numeric)
  const maximumFractionDigits =
    absolute > 0 && absolute < 0.01
      ? 8
      : 2
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits
  }).format(numeric)
}

function getScopedAssetBucket<T>(
  buckets: Record<string, T> | undefined,
  accountId: string,
  networkId: string
): T | undefined {
  return buckets?.[buildAssetStateScopeKey(accountId, networkId)]
}

function buildScopedAssetProjection(
  state: WalletState,
  accountId: string,
  networkId: string
): Pick<WalletState, 'networkAssets' | 'networkAssetLogos' | 'networkAssetLabels' | 'evmNftAssets'> {
  const scopeKey = buildAssetStateScopeKey(accountId, networkId)
  return {
    networkAssets: {
      ...state.networkAssets,
      [networkId]: state.accountNetworkAssets[scopeKey] || {}
    },
    networkAssetLogos: {
      ...state.networkAssetLogos,
      [networkId]: state.accountNetworkAssetLogos[scopeKey] || {}
    },
    networkAssetLabels: {
      ...state.networkAssetLabels,
      [networkId]: state.accountNetworkAssetLabels[scopeKey] || {}
    },
    evmNftAssets: {
      ...state.evmNftAssets,
      [networkId]: state.accountNetworkEvmNftAssets[scopeKey] || {}
    }
  }
}

function buildScopedAssetStateUpdate(
  state: WalletState,
  accountId: string,
  networkId: string,
  payload: ScopedAssetBuckets
): Partial<WalletState> {
  const scopeKey = buildAssetStateScopeKey(accountId, networkId)
  const next: Partial<WalletState> = {
    accountNetworkAssets: {
      ...state.accountNetworkAssets,
      [scopeKey]: payload.assets
    },
    accountNetworkAssetLogos: {
      ...state.accountNetworkAssetLogos,
      [scopeKey]: payload.logos
    },
    accountNetworkAssetLabels: {
      ...state.accountNetworkAssetLabels,
      [scopeKey]: payload.labels
    },
    accountNetworkEvmNftAssets: {
      ...state.accountNetworkEvmNftAssets,
      [scopeKey]: payload.evmNfts
    }
  }

  if (state.activeAccountId === accountId && state.activeNetworkId === networkId) {
    Object.assign(next, buildScopedAssetProjection(state, accountId, networkId))
  }

  return next
}

const DEFAULT_ETH_TRACKED_TOKENS: EvmTrackedToken[] = [
  { address: '0xa0b73e1ff0b80914ab6fe0444e65848c4c34450b', symbol: 'CRO', decimals: 8 },
  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
  { address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 },
  { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
  { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', symbol: 'SHIB', decimals: 18 },
  { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
  { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', decimals: 18 },
  { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI', decimals: 18 },
  { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DdAE9', symbol: 'AAVE', decimals: 18 },
  { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', symbol: 'PEPE', decimals: 18 }
]

const DEFAULT_BNB_TRACKED_TOKENS: EvmTrackedToken[] = [
  { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 },
  { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 },
  { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD', decimals: 18 },
  { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE', decimals: 18 },
  { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH', decimals: 18 },
  { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTCB', decimals: 18 },
  { address: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47', symbol: 'ADA', decimals: 18 },
  { address: '0xBa2aE424d960c26247Dd6c32edC70B295c744C43', symbol: 'DOGE', decimals: 8 },
  { address: '0xCE7de646e7208A4Ef112cb6ed5038FA6c0cFfDcF', symbol: 'TRX', decimals: 18 }
]

const DEFAULT_BASE_TRACKED_TOKENS: EvmTrackedToken[] = [
  // Native Base USDC (Circle).
  { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6 },
  // Wrapped Ether on Base.
  { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
  // MasterBOT ERC-20 on Base.
  { address: '0x6E7c5Faaaa2ccA8437C8FA20EA2eE5A5cF5077DC', symbol: 'MASTERBOT', decimals: 18 }
]

const DEFAULT_ARB_TRACKED_TOKENS: EvmTrackedToken[] = [
  { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
  { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT', decimals: 6 },
  { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', decimals: 18 }
]

const DEFAULT_OP_TRACKED_TOKENS: EvmTrackedToken[] = [
  { address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', symbol: 'USDC', decimals: 6 },
  { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', symbol: 'USDT', decimals: 6 },
  { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 }
]

const DEFAULT_AVAXC_TRACKED_TOKENS: EvmTrackedToken[] = [
  { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', decimals: 6 },
  { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', symbol: 'USDT', decimals: 6 },
  { address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', symbol: 'WETH.E', decimals: 18 }
]

const MIN_TRACKED_EVM_TOKENS_PER_CHAIN = 100
const MAX_TRACKED_EVM_TOKENS_PER_CHAIN = 220
const EVM_TRACKED_TOKEN_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const evmTrackedTokenCache = new Map<string, {
  checkedAt: number
  tokens: EvmTrackedToken[]
}>()

const CHAIN_ID_BY_NETWORK_ID: Record<string, number> = {
  eth: 1,
  op: 10,
  bnb: 56,
  cronos: 25,
  polygon: 137,
  zksync: 324,
  arb: 42161,
  'eth-l2--arbitrum-nova': 42170,
  base: 8453,
  'eth-l2--optimism': 10,
  'eth-l2--zksync-era': 324,
  'eth-l2--linea': 59144,
  'eth-l2--scroll': 534352,
  'eth-l2--mantle': 5000,
  'eth-l2--metis': 1088,
  'eth-l2--blast': 81457,
  'eth-l2--fraxtal': 252,
  'eth-l2--taiko': 167000,
  avaxc: 43114
}

const COINGECKO_CHAIN_SLUG_BY_CHAIN_ID: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  56: 'binance-smart-chain',
  25: 'cronos',
  137: 'polygon-pos',
  324: 'zksync',
  42161: 'arbitrum-one',
  8453: 'base',
  43114: 'avalanche'
}

const TRUSTWALLET_CHAIN_FOLDER_BY_CHAIN_ID: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  25: 'cronos',
  56: 'smartchain',
  100: 'xdai',
  137: 'polygon',
  250: 'fantom',
  324: 'zksync',
  8453: 'base',
  42161: 'arbitrum',
  43114: 'avalanchec',
  59144: 'linea'
}

function parseTrackedEvmTokens(raw: string): EvmTrackedToken[] {
  const entries = String(raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  const parsed: EvmTrackedToken[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    const [addressRaw, symbolRaw = '', decimalsRaw = '18'] = entry.split(':').map((part) => part.trim())
    const checksum = normalizeEvmAddressLoose(addressRaw)
    if (!checksum) continue
    if (seen.has(checksum)) continue
    const symbol = symbolRaw || checksum.slice(0, 6)
    const decimals = Number(decimalsRaw)
    parsed.push({
      address: checksum,
      symbol: symbol.toUpperCase(),
      decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 30 ? decimals : 18
    })
    seen.add(checksum)
  }

  return parsed
}

function normalizeTrackedTokenEnvKeyPart(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeEvmAddressLoose(address: string): string | null {
  const raw = String(address || '').trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return null
  try {
    return ethers.getAddress(raw)
  } catch {
    try {
      return ethers.getAddress(raw.toLowerCase())
    } catch {
      return null
    }
  }
}

function mergeTrackedEvmTokens(...groups: EvmTrackedToken[][]): EvmTrackedToken[] {
  const out: EvmTrackedToken[] = []
  const byAddress = new Map<string, number>()
  for (const group of groups) {
    for (const token of group) {
      const address = normalizeEvmAddressLoose(token.address)
      if (!address) continue
      const existingIndex = byAddress.get(address)
      if (existingIndex !== undefined) {
        const existing = out[existingIndex]
        if (!existing.logoUri && token.logoUri) {
          out[existingIndex] = { ...existing, logoUri: String(token.logoUri || '').trim() || undefined }
        }
        continue
      }
      out.push({
        address,
        symbol: String(token.symbol || '').trim().toUpperCase() || shortAddress(address),
        decimals: Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 30 ? token.decimals : 18,
        logoUri: String(token.logoUri || '').trim() || undefined
      })
      byAddress.set(address, out.length - 1)
    }
  }
  return out
}

function resolveTrackedTokenEnvKeys(network: Pick<Network, 'id' | 'runtimeModelId' | 'chainId'>): string[] {
  const networkId = String(network?.id || '').trim()
  const modelId = String(network?.runtimeModelId || networkId).trim()
  const chainId = resolveEvmChainId(network)
  const keys = new Set<string>()

  const add = (value: string) => {
    const normalized = normalizeTrackedTokenEnvKeyPart(value)
    if (normalized) keys.add(normalized)
  }

  add(networkId)
  add(modelId)

  const lowerNetworkId = networkId.toLowerCase()
  const lowerModelId = modelId.toLowerCase()
  if (lowerNetworkId === 'bnb' || lowerModelId === 'bnb' || chainId === 56) {
    add('bsc')
    add('bnb')
  }
  return [...keys]
}

function resolveTrackedTokensFromEnv(network: Pick<Network, 'id' | 'runtimeModelId' | 'chainId'>): EvmTrackedToken[] {
  for (const key of resolveTrackedTokenEnvKeys(network)) {
    const parsed = parseTrackedEvmTokens(String((import.meta as any)?.env?.[`VITE_${key}_TRACKED_TOKENS`] || ''))
    if (parsed.length > 0) return parsed
  }
  return []
}

function shouldAutoEnableRemoteEvmTokenCatalog(network: Pick<Network, 'id' | 'runtimeModelId' | 'chainId'>): boolean {
  const chainId = resolveEvmChainId(network)
  return chainId === 56
}

function resolveTrackedEvmTokensBase(network: Pick<Network, 'id' | 'runtimeModelId' | 'chainId'>): EvmTrackedToken[] {
  const networkId = String(network?.id || '').trim()
  const modelId = String(network?.runtimeModelId || networkId).trim()
  const fromEnv = resolveTrackedTokensFromEnv(network)
  if (fromEnv.length > 0) return fromEnv
  if (modelId.toLowerCase() === 'eth') return DEFAULT_ETH_TRACKED_TOKENS
  if (modelId.toLowerCase() === 'arb') return DEFAULT_ARB_TRACKED_TOKENS
  if (modelId.toLowerCase() === 'op') return DEFAULT_OP_TRACKED_TOKENS
  if (modelId.toLowerCase() === 'bnb') return DEFAULT_BNB_TRACKED_TOKENS
  if (modelId.toLowerCase() === 'base') return DEFAULT_BASE_TRACKED_TOKENS
  if (modelId.toLowerCase() === 'avaxc') return DEFAULT_AVAXC_TRACKED_TOKENS
  const chainId = resolveEvmChainId(network as Pick<Network, 'id' | 'runtimeModelId' | 'chainId'>)
  if (chainId === 1) return DEFAULT_ETH_TRACKED_TOKENS
  if (chainId === 10) return DEFAULT_OP_TRACKED_TOKENS
  if (chainId === 97) return []
  if (chainId === 56) return DEFAULT_BNB_TRACKED_TOKENS
  if (chainId === 42161) return DEFAULT_ARB_TRACKED_TOKENS
  if (chainId === 43114) return DEFAULT_AVAXC_TRACKED_TOKENS
  if (chainId === 8453) return DEFAULT_BASE_TRACKED_TOKENS
  return []
}

function resolveEvmChainId(network: Pick<Network, 'id' | 'runtimeModelId' | 'chainId'>): number | null {
  if (Number.isInteger(network.chainId) && Number(network.chainId) > 0) return Number(network.chainId)
  const networkId = String(network.id || '').trim().toLowerCase()
  if (CHAIN_ID_BY_NETWORK_ID[networkId]) return CHAIN_ID_BY_NETWORK_ID[networkId]
  const modelId = String(network.runtimeModelId || '').trim().toLowerCase()
  if (CHAIN_ID_BY_NETWORK_ID[modelId]) return CHAIN_ID_BY_NETWORK_ID[modelId]
  return null
}

function parseRemoteTokenCandidates(payload: any): EvmTrackedToken[] {
  const values = Array.isArray(payload?.tokens)
    ? payload.tokens
    : payload && typeof payload === 'object'
      ? Object.values(payload)
      : []
  const out: EvmTrackedToken[] = []
  for (const row of values as any[]) {
    const candidateAddress = String(row?.address || row?.token_address || '').trim()
    const normalizedAddress = normalizeEvmAddressLoose(candidateAddress)
    if (!normalizedAddress) continue
    const symbol = String(row?.symbol || '').trim().toUpperCase()
    const decimals = Number(row?.decimals)
    out.push({
      address: normalizedAddress,
      symbol: symbol || shortAddress(candidateAddress),
      decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 30 ? decimals : 18,
      logoUri: String(row?.logoURI || row?.logo_uri || row?.logo || row?.image || '').trim() || undefined
    })
  }
  return out
}

function buildTrustWalletErc20LogoUri(chainId: number | null, tokenAddress: string): string | undefined {
  if (!chainId || !ethers.isAddress(tokenAddress)) return undefined
  const folder = TRUSTWALLET_CHAIN_FOLDER_BY_CHAIN_ID[chainId]
  if (!folder) return undefined
  const checksum = ethers.getAddress(tokenAddress)
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${checksum}/logo.png`
}

async function fetchRemoteTrackedTokensForChain(chainId: number): Promise<EvmTrackedToken[]> {
  const cacheKey = `chain:${chainId}`
  const cached = evmTrackedTokenCache.get(cacheKey)
  if (cached && Date.now() - cached.checkedAt <= EVM_TRACKED_TOKEN_CACHE_TTL_MS) {
    return cached.tokens
  }

  const urls: string[] = [
    `https://tokens.1inch.io/v1.2/${chainId}`
  ]
  const cgSlug = COINGECKO_CHAIN_SLUG_BY_CHAIN_ID[chainId]
  if (cgSlug) {
    urls.push(`https://tokens.coingecko.com/${cgSlug}/all.json`)
  }

  let merged: EvmTrackedToken[] = []
  for (const url of urls) {
    try {
      const response = await fetch(url, { method: 'GET' })
      if (!response.ok) continue
      const json = await response.json().catch(() => null)
      const parsed = parseRemoteTokenCandidates(json)
      if (parsed.length === 0) continue
      merged = mergeTrackedEvmTokens(merged, parsed)
      if (merged.length >= MAX_TRACKED_EVM_TOKENS_PER_CHAIN) break
    } catch {
      // Try the next source.
    }
  }

  const sliced = merged.slice(0, MAX_TRACKED_EVM_TOKENS_PER_CHAIN)
  evmTrackedTokenCache.set(cacheKey, { checkedAt: Date.now(), tokens: sliced })
  return sliced
}

async function resolveTrackedEvmTokens(network: Pick<Network, 'id' | 'runtimeModelId' | 'chainId'>): Promise<EvmTrackedToken[]> {
  const base = mergeTrackedEvmTokens(resolveTrackedEvmTokensBase(network))
  const chainId = resolveEvmChainId(network)
  if (!chainId) return base

  const enableRemoteCatalog = shouldAutoEnableRemoteEvmTokenCatalog(network)
    || getBuildFeatureFlag('enableRemoteEvmTokenCatalog', 'VITE_ENABLE_REMOTE_EVM_TOKEN_CATALOG', false)
  if (!enableRemoteCatalog) return base
  const remote = await fetchRemoteTrackedTokensForChain(chainId).catch(() => [])
  const merged = mergeTrackedEvmTokens(base, remote)
  if (merged.length >= MIN_TRACKED_EVM_TOKENS_PER_CHAIN) {
    return merged.slice(0, MAX_TRACKED_EVM_TOKENS_PER_CHAIN)
  }
  return merged
}

function resolveCatalogEvmTrackedTokens(
  catalog: ServerCoinCatalogItem[],
  modelId: string
): EvmTrackedToken[] {
  const normalizedModel = String(modelId || '').trim().toLowerCase()
  if (!normalizedModel) return []
  const byAddress = new Map<string, EvmTrackedToken>()
  for (const item of catalog) {
    if (item.kind !== 'asset') continue
    if (String(item.runtimeModelId || '').trim().toLowerCase() !== normalizedModel) continue
    const candidate = String(item.contractAddress || '').trim()
    const address = normalizeEvmAddressLoose(candidate)
    if (!address) continue
    if (byAddress.has(address)) continue
    byAddress.set(address, {
      address,
      symbol: String(item.symbol || '').trim().toUpperCase() || address.slice(0, 6),
      decimals: 18
    })
  }
  return [...byAddress.values()]
}

function parseTrackedEvmNfts(raw: string): EvmTrackedNft[] {
  const entries = String(raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  const out: EvmTrackedNft[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const [addressRaw, tokenIdRaw = '', standardRaw = 'auto', ...labelParts] = entry.split(':')
    const address = normalizeEvmAddressLoose(addressRaw)
    if (!address) continue
    const tokenId = String(tokenIdRaw || '').trim()
    if (!tokenId) continue
    const standardNormalized = String(standardRaw || '').trim().toLowerCase()
    const standard: EvmNftStandard | 'auto' = standardNormalized === 'erc721'
      ? 'erc721'
      : standardNormalized === 'erc1155'
        ? 'erc1155'
        : 'auto'
    const key = `${address}:${tokenId.toLowerCase()}`
    if (seen.has(key)) continue
    const label = labelParts.join(':').trim() || undefined
    out.push({ address, tokenId, standard, label })
    seen.add(key)
  }
  return out
}

function resolveTrackedEvmNfts(network: Pick<Network, 'id' | 'runtimeModelId'>): EvmTrackedNft[] {
  const networkId = String(network?.id || '').trim()
  const modelId = String(network?.runtimeModelId || networkId).trim()
  const byNetwork = parseTrackedEvmNfts(String((import.meta as any)?.env?.[`VITE_${networkId.toUpperCase()}_TRACKED_NFTS`] || ''))
  if (byNetwork.length > 0) return byNetwork
  const byModel = parseTrackedEvmNfts(String((import.meta as any)?.env?.[`VITE_${modelId.toUpperCase()}_TRACKED_NFTS`] || ''))
  if (byModel.length > 0) return byModel
  return []
}

function resolveCatalogEvmTrackedNfts(
  catalog: ServerCoinCatalogItem[],
  modelId: string
): EvmTrackedNft[] {
  const normalizedModel = String(modelId || '').trim().toLowerCase()
  if (!normalizedModel) return []
  const out: EvmTrackedNft[] = []
  const seen = new Set<string>()

  for (const item of catalog) {
    if (item.kind !== 'asset') continue
    if (String(item.runtimeModelId || '').trim().toLowerCase() !== normalizedModel) continue
    const address = String(item.contractAddress || '').trim()
    const checksum = normalizeEvmAddressLoose(address)
    if (!checksum) continue

    const source = `${String(item.coinId || '')} ${String(item.name || '')}`
    const tokenIdMatch = source.match(/(?:tokenid|token|id)\D*(0x[0-9a-f]+|\d+)/i) || source.match(/[#:/](0x[0-9a-f]+|\d+)/i)
    const tokenId = String(tokenIdMatch?.[1] || '').trim()
    if (!tokenId) continue

    const standardHint: EvmNftStandard | 'auto' = /1155/i.test(source)
      ? 'erc1155'
      : /721/i.test(source)
        ? 'erc721'
        : 'auto'
    const key = `${checksum}:${tokenId.toLowerCase()}`
    if (seen.has(key)) continue
    out.push({
      address: checksum,
      tokenId,
      standard: standardHint,
      label: String(item.symbol || item.name || '').trim() || undefined
    })
    seen.add(key)
  }

  return out
}

function tokenIdToBigInt(tokenId: string): bigint {
  const raw = String(tokenId || '').trim()
  if (!raw) return 0n
  if (/^0x[0-9a-f]+$/i.test(raw)) return BigInt(raw)
  return BigInt(raw)
}

function tokenIdHex64(tokenId: string): string {
  const hex = tokenIdToBigInt(tokenId).toString(16)
  return hex.padStart(64, '0')
}

function normalizeAssetUri(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (/^data:/i.test(raw)) return raw
  if (/^ipfs:\/\//i.test(raw)) {
    const rest = raw.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '').replace(/^\/+/, '')
    return `ipfs://${rest}`
  }
  if (/^ipfs\//i.test(raw)) return `ipfs://${raw.replace(/^ipfs\//i, '')}`
  return raw
}

function renderEip1155Template(uri: string, tokenId: string): string {
  const normalized = normalizeAssetUri(uri)
  if (!normalized) return ''
  const idHex = tokenIdHex64(tokenId)
  return normalized
    .replace(/\{id\}/gi, idHex)
    .replace(/\{ID\}/g, idHex.toUpperCase())
    .replace(/\{tokenid\}/gi, tokenId)
}

function formatTokenIdForLabel(tokenId: string): string {
  try {
    return tokenIdToBigInt(tokenId).toString(10)
  } catch {
    return String(tokenId || '').trim()
  }
}

function shortAddress(value: string): string {
  const checksum = ethers.getAddress(value)
  return `${checksum.slice(0, 6)}...${checksum.slice(-4)}`
}

function buildEvmNftAssetKey(address: string, tokenId: string, standard: EvmNftStandard): string {
  return `EVMNFT:${standard}:${ethers.getAddress(address)}:${String(tokenId || '').trim()}`
}

function parseEvmNftAssetKey(assetId: string): { standard: EvmNftStandard; address: string; tokenId: string } | null {
  const m = String(assetId || '').trim().match(/^EVMNFT:(erc721|erc1155):(0x[a-fA-F0-9]{40}):(.+)$/)
  if (!m) return null
  return {
    standard: m[1] as EvmNftStandard,
    address: ethers.getAddress(m[2]),
    tokenId: m[3]
  }
}

function parseEvmFungibleAssetAlias(assetId: string): { symbol: string; ordinal: number } {
  const raw = String(assetId || '').trim()
  if (!raw) return { symbol: '', ordinal: 1 }
  const withoutHint = raw.split('@')[0]
  const m = withoutHint.match(/^(.*?)-(\d+)$/)
  if (!m) return { symbol: withoutHint.toUpperCase(), ordinal: 1 }
  const symbol = String(m[1] || '').trim().toUpperCase()
  const ordinal = Number(m[2])
  if (!symbol || !Number.isInteger(ordinal) || ordinal <= 0) {
    return { symbol: withoutHint.toUpperCase(), ordinal: 1 }
  }
  return { symbol, ordinal }
}

function extractEvmTokenAddressFromLogoUri(logoUri: string): string {
  const raw = String(logoUri || '').trim()
  if (!raw) return ''
  const m = raw.match(/\/assets\/(0x[a-fA-F0-9]{40})\/logo\.(?:png|svg|webp|jpg|jpeg)$/i)
  if (!m) return ''
  return ethers.isAddress(m[1]) ? ethers.getAddress(m[1]) : ''
}

function isBridgeEvmNftTokenType(tokenType: string): boolean {
  const normalized = String(tokenType || '').trim().toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes('erc721')
    || normalized.includes('erc-721')
    || normalized.includes('erc1155')
    || normalized.includes('erc-1155')
    || normalized.includes('nft')
  )
}

function parseBridgeEvmNftReference(row: BridgeTokenBalanceRow): { address: string; tokenId: string } | null {
  const tokenIdRaw = String(row.tokenId || '').trim()
  const tokenAddressRaw = String(row.tokenAddress || '').trim()
  let address = normalizeEvmAddressLoose(tokenAddressRaw)
  if (!address) {
    const tokenAddressMatch = tokenIdRaw.match(/0x[0-9a-fA-F]{40}/)
    if (tokenAddressMatch) address = normalizeEvmAddressLoose(tokenAddressMatch[0])
  }
  if (!address) return null

  let tokenId = tokenIdRaw
  if (!tokenId || normalizeEvmAddressLoose(tokenId)) {
    const fromComposite = tokenIdRaw.match(/^0x[0-9a-fA-F]{40}[:/#-](.+)$/)
    if (fromComposite && String(fromComposite[1] || '').trim()) {
      tokenId = String(fromComposite[1] || '').trim()
    } else {
      const source = `${String(row.name || '').trim()} ${String(row.symbol || '').trim()}`
      const tokenIdMatch =
        source.match(/(?:tokenid|token|id)\D*(0x[0-9a-f]+|\d+)/i)
        || source.match(/[#:/-](0x[0-9a-f]+|\d+)/i)
      tokenId = String(tokenIdMatch?.[1] || '').trim()
    }
  }

  if (!tokenId || normalizeEvmAddressLoose(tokenId)) return null
  return { address, tokenId }
}

function resolvePortfolioRequestMeta(network: Network): { apiBase: string; coin: string; chain: string } | null {
  const apiBase = String(
    import.meta.env.VITE_API_BASE_URL
    || deriveApiBaseFromBridgeUrl(String(network.bridgeUrl || ''))
    || network.rpcUrl
    || ''
  ).trim().replace(/\/+$/, '')
  if (!apiBase) return null

  const modelId = String(resolveNetworkModelId(network) || network.id || '').trim().toLowerCase()
  const runtimeProfile = getCoinRuntimeProfile(modelId)
  const coin = String(
    network.serverCoinId
    || runtimeProfile?.coinId
    || STANDARD_RUNTIME_META[modelId]?.coinId
    || modelId
  ).trim().toLowerCase()
  if (!coin) return null

  const chain = String(network.serverChain || 'main').trim().toLowerCase() || 'main'
  return { apiBase, coin, chain }
}

function parsePortfolioEvmNftReference(row: Record<string, unknown>): { address: string; tokenId: string; standard: EvmNftStandard } | null {
  const tokenIdRaw = String(row.tokenId || '').trim()
  const issuerRaw = String(row.issuer || '').trim()
  const address = normalizeEvmAddressLoose(issuerRaw || tokenIdRaw.match(/0x[a-fA-F0-9]{40}/)?.[0] || '')
  if (!address) return null
  const tokenType = String(row.tokenType || '').trim().toLowerCase()
  const standard: EvmNftStandard = tokenType.includes('1155') ? 'erc1155' : 'erc721'

  let tokenId = tokenIdRaw
  if (normalizeEvmAddressLoose(tokenId)) {
    tokenId = ''
  }
  if (!tokenId) {
    const composite = tokenIdRaw.match(/^0x[a-fA-F0-9]{40}[:/#-](.+)$/)
    if (composite?.[1]) tokenId = String(composite[1]).trim()
  }
  if (!tokenId) return null
  return { address, tokenId, standard }
}

function resolvePortfolioAssetId(
  network: Network,
  assetIds: string[],
  logos: Record<string, string>,
  row: Record<string, unknown>
): string {
  const tokenId = String(row.tokenId || '').trim()
  if (!tokenId) return ''

  if (network.coinType === 'EVM') {
    const tokenType = String(row.tokenType || '').trim().toLowerCase()
    if (tokenType.includes('721') || tokenType.includes('1155') || tokenType.includes('nft')) {
      const nftRef = parsePortfolioEvmNftReference(row)
      if (!nftRef) return ''
      return buildEvmNftAssetKey(nftRef.address, nftRef.tokenId, nftRef.standard)
    }

    const contract = normalizeEvmAddressLoose(String(row.issuer || tokenId).trim())
    if (!contract) return ''
    for (const assetId of assetIds) {
      const logoContract = extractEvmTokenAddressFromLogoUri(String(logos[assetId] || '').trim())
      if (logoContract && logoContract === contract) return assetId
    }
    const contractShort = shortAddress(contract)
    return assetIds.find((assetId) => assetId.includes(`@${contractShort}`)) || ''
  }

  const lowerType = String(row.tokenType || '').trim().toLowerCase()
  if (String(resolveNetworkModelId(network) || network.id || '').trim().toLowerCase() === 'sol') {
    const candidates = [
      tokenId,
      buildSolanaAssetId(tokenId, 'spl-token'),
      buildSolanaAssetId(tokenId, lowerType.includes('compressed') || lowerType.includes('cnft') ? 'compressed-nft' : 'spl-nft'),
      buildSolanaAssetId(tokenId, 'compressed-nft'),
      buildSolanaAssetId(tokenId, 'spl-nft')
    ].filter(Boolean)
    return candidates.find((candidate) => assetIds.includes(candidate)) || ''
  }

  return assetIds.includes(tokenId) ? tokenId : ''
}

function buildPortfolioFiatBuckets(
  state: WalletState,
  accountId: string,
  network: Network,
  portfolio: Record<string, unknown>
): PortfolioAssetFiatBuckets {
  const networkId = String(network.id || '').trim()
  const assetsForScope = getScopedAssetBucket(state.accountNetworkAssets, accountId, networkId) || {}
  const logosForScope = getScopedAssetBucket(state.accountNetworkAssetLogos, accountId, networkId) || {}
  const assetIds = Object.keys(assetsForScope)
  const out: PortfolioAssetFiatBuckets = {
    totals: normalizeFiatValueMap(portfolio.totals),
    native: normalizeFiatValueMap((portfolio.native as Record<string, unknown> | undefined)?.value),
    assets: {}
  }

  const appendRows = (rows: unknown) => {
    if (!Array.isArray(rows)) return
    for (const rawRow of rows) {
      if (!rawRow || typeof rawRow !== 'object') continue
      const row = rawRow as Record<string, unknown>
      const assetId = resolvePortfolioAssetId(network, assetIds, logosForScope, row)
      if (!assetId) continue
      const valueMap = normalizeFiatValueMap(row.value)
      if (Object.keys(valueMap).length === 0) continue
      out.assets[assetId] = valueMap
    }
  }

  appendRows(portfolio.tokens)
  appendRows(portfolio.nfts)
  return out
}

function buildEvmAssetBucketsFromBridgeRows(
  rows: BridgeTokenBalanceRow[],
  chainId: number | null
): ScopedAssetBuckets {
  const assets: Record<string, number> = {}
  const logos: Record<string, string> = {}
  const labels: Record<string, string> = {}
  const evmNfts: Record<string, EvmNftHolding> = {}
  const usedAssetKeys = new Set<string>()
  const assetKeyByContract = new Map<string, string>()

  for (const row of rows) {
    const rawBalanceText = String(row.balanceRaw || '').trim()
    if (!/^\d+$/.test(rawBalanceText)) continue
    const rawBalance = BigInt(rawBalanceText)
    if (rawBalance <= 0n) continue

    const tokenType = String(row.tokenType || '').trim()
    if (isBridgeEvmNftTokenType(tokenType)) {
      const parsedNft = parseBridgeEvmNftReference(row)
      if (!parsedNft) continue
      const standard: EvmNftStandard = /1155/i.test(tokenType) ? 'erc1155' : 'erc721'
      const assetKey = buildEvmNftAssetKey(parsedNft.address, parsedNft.tokenId, standard)
      const quantitySats = Number(rawBalance > 9999999999n ? 9999999999n : rawBalance) * 1e8
      if (!Number.isFinite(quantitySats) || quantitySats <= 0) continue
      const collection = String(row.name || row.symbol || 'NFT').trim() || 'NFT'
      assets[assetKey] = quantitySats
      evmNfts[assetKey] = {
        address: parsedNft.address,
        tokenId: parsedNft.tokenId,
        standard,
        label: `${collection} #${formatTokenIdForLabel(parsedNft.tokenId)} - ${shortAddress(parsedNft.address)}`,
        quantityRaw: rawBalance.toString()
      }
      continue
    }

    const decimalsRaw = Number(row.decimals)
    const decimals = Number.isInteger(decimalsRaw) && decimalsRaw >= 0 && decimalsRaw <= 30 ? decimalsRaw : 18
    const displaySats = toAssetDisplaySats(rawBalance, decimals)
    if (!Number.isFinite(displaySats) || displaySats <= 0) continue

    const tokenAddress = normalizeEvmAddressLoose(String(row.tokenAddress || row.tokenId || row.issuer || '').trim())
    const symbol = String(row.symbol || row.name || '').trim().toUpperCase()
    const displaySymbol = symbol || (tokenAddress ? shortAddress(tokenAddress) : 'TOKEN')

    let assetKey = tokenAddress ? String(assetKeyByContract.get(tokenAddress) || '').trim() : ''
    if (!assetKey) {
      const baseKey = tokenAddress
        ? `${displaySymbol}@${shortAddress(tokenAddress)}`
        : displaySymbol
      assetKey = baseKey
      let suffix = 2
      while (usedAssetKeys.has(assetKey)) {
        assetKey = `${baseKey}-${suffix}`
        suffix += 1
      }
      usedAssetKeys.add(assetKey)
      if (tokenAddress) assetKeyByContract.set(tokenAddress, assetKey)
    }

    const prev = Number(assets[assetKey] || 0)
    assets[assetKey] = Math.max(prev, displaySats)
    labels[assetKey] = displaySymbol
    if (tokenAddress) {
      const logoUri = buildTrustWalletErc20LogoUri(chainId, tokenAddress)
      if (logoUri) logos[assetKey] = logoUri
    }
  }

  return { assets, logos, labels, evmNfts }
}

function formatUnits8(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return value.toFixed(8).replace(/\.?0+$/, '')
}

function toRawSatsLike(balanceText: string): number {
  const num = Number(String(balanceText || '').trim())
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.max(0, Math.round(num * 1e8))
}

const SEND_LIST_NATIVE_PREFIX = 'NATIVE:'
const SEND_LIST_EVM_TOKEN_PREFIX = 'EVMTOKEN:'
const SEND_LIST_ASSET_PREFIX = 'ASSET:'

function buildSendListPreferenceScopeKey(accountId: string, networkId: string): string {
  const account = String(accountId || '').trim().toLowerCase()
  const network = normalizeNetworkIdAlias(String(networkId || '').trim()).toLowerCase()
  return `${account}::${network}`
}

function normalizeIdList(values: string[] | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of values || []) {
    const normalized = normalizeSendListEntryId(row)
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function normalizeSendListPreferenceBucket(raw: Partial<SendListPreferenceBucket> | undefined | null): SendListPreferenceBucket {
  return {
    order: normalizeIdList(Array.isArray(raw?.order) ? raw?.order : []),
    pinned: normalizeIdList(Array.isArray(raw?.pinned) ? raw?.pinned : []),
    hidden: normalizeIdList(Array.isArray(raw?.hidden) ? raw?.hidden : [])
  }
}

function normalizeSendListPreferencesRecord(
  raw: Record<string, Partial<SendListPreferenceBucket>> | undefined | null
): Record<string, SendListPreferenceBucket> {
  const out: Record<string, SendListPreferenceBucket> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [scopeKeyRaw, value] of Object.entries(raw)) {
    const scopeKey = String(scopeKeyRaw || '').trim().toLowerCase()
    if (!scopeKey || !scopeKey.includes('::')) continue
    out[scopeKey] = normalizeSendListPreferenceBucket(value)
  }
  return out
}

function normalizeNetworkModelPreferencesState(
  raw: Record<string, NetworkModelPreferences> | undefined | null,
  networks: Network[]
): Record<string, NetworkModelPreferences> {
  return normalizeNetworkModelPreferencesRecord(remapNetworkIdKeyedRecord(raw || {}), networks)
}

function buildNativeSendEntryId(networkId: string): string {
  const normalizedNetworkId = normalizeNetworkIdAlias(String(networkId || '').trim()).toLowerCase()
  return `${SEND_LIST_NATIVE_PREFIX}${normalizedNetworkId}`
}

function buildAssetSendEntryId(assetId: string): string {
  return `${SEND_LIST_ASSET_PREFIX}${String(assetId || '').trim()}`
}

function buildEvmTokenSendEntryId(contractAddress: string): string {
  return `${SEND_LIST_EVM_TOKEN_PREFIX}${ethers.getAddress(contractAddress)}`
}

function normalizeSendListEntryId(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^native:/i.test(raw)) {
    const networkId = normalizeNetworkIdAlias(raw.slice('native:'.length).trim()).toLowerCase()
    return networkId ? `${SEND_LIST_NATIVE_PREFIX}${networkId}` : ''
  }
  if (/^evmtoken:/i.test(raw)) {
    const token = raw.slice('evmtoken:'.length).trim()
    if (!ethers.isAddress(token)) return ''
    return buildEvmTokenSendEntryId(token)
  }
  if (/^asset:/i.test(raw)) {
    const asset = raw.slice('asset:'.length).trim()
    return asset ? `${SEND_LIST_ASSET_PREFIX}${asset}` : ''
  }
  if (ethers.isAddress(raw)) return buildEvmTokenSendEntryId(raw)
  const nft = parseEvmNftAssetKey(raw)
  if (nft) {
    const canonical = buildEvmNftAssetKey(nft.address, nft.tokenId, nft.standard)
    return buildAssetSendEntryId(canonical)
  }
  return buildAssetSendEntryId(raw)
}

function resolveSendListAssetEntryId(input: {
  network: Network
  assetId: string
  logoUri?: string
}): string {
  const assetId = String(input.assetId || '').trim()
  if (!assetId) return ''
  const nft = parseEvmNftAssetKey(assetId)
  if (nft) return buildAssetSendEntryId(buildEvmNftAssetKey(nft.address, nft.tokenId, nft.standard))

  if (input.network.coinType === 'EVM') {
    if (ethers.isAddress(assetId)) return buildEvmTokenSendEntryId(assetId)
    const hinted = extractEvmTokenAddressFromLogoUri(String(input.logoUri || '').trim())
    if (hinted) return buildEvmTokenSendEntryId(hinted)
  }

  return buildAssetSendEntryId(assetId)
}

function parseCosmosContractAssetId(assetId: string): {
  kind: 'cw20' | 'cw721'
  contract: string
  tokenId?: string
} | null {
  const raw = String(assetId || '').trim()
  if (!raw) return null
  const cw20 = raw.match(/^cw20:([^:\s]+)$/i)
  if (cw20) {
    return {
      kind: 'cw20',
      contract: String(cw20[1] || '').trim()
    }
  }
  const cw721 = raw.match(/^cw721:([^:\s]+):(.+)$/i)
  if (cw721) {
    const tokenId = String(cw721[2] || '').trim()
    if (!tokenId) return null
    return {
      kind: 'cw721',
      contract: String(cw721[1] || '').trim(),
      tokenId
    }
  }
  return null
}

async function detectEvmNftStandard(
  rpcConfig: UtxoRpcConfig,
  address: string
): Promise<EvmNftStandard | null> {
  const contract = ethers.getAddress(address)
  const checkInterface = async (interfaceId: string): Promise<boolean> => {
    try {
      const data = EVM_ERC165_IFACE.encodeFunctionData('supportsInterface', [interfaceId])
      const raw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: contract, data }, 'latest'])
      const [supported] = EVM_ERC165_IFACE.decodeFunctionResult('supportsInterface', String(raw || '0x'))
      return Boolean(supported)
    } catch {
      return false
    }
  }
  if (await checkInterface(ERC721_INTERFACE_ID)) return 'erc721'
  if (await checkInterface(ERC1155_INTERFACE_ID)) return 'erc1155'
  return null
}

function toAssetDisplaySats(balanceRaw: bigint, decimals: number): number {
  const denom = 10n ** BigInt(Math.max(0, decimals))
  const scaled = (balanceRaw * 100000000n) / denom
  return Number(scaled)
}

type TrackedTronToken = {
  symbol: string
  contract: string
}

const chainBalanceSnapshotCache = createRequestCache<ChainBalanceSyncResult & { balance: string }>({
  defaultTtlMs: 10_000,
  maxEntries: 200
})

const assetDetailsCache = createRequestCache<any>({
  defaultTtlMs: 5 * 60_000,
  maxEntries: 800
})

const networkAssetsCache = createRequestCache<{
  assets: Record<string, number>
  logos: Record<string, string>
  labels: Record<string, string>
  evmNfts?: Record<string, any>
}>({
  defaultTtlMs: 25_000,
  maxEntries: 120
})
const networkAssetsInFlightByKey = new Map<string, Promise<void>>()

const networkFiatCache = createRequestCache<PortfolioAssetFiatBuckets>({
  defaultTtlMs: 60_000,
  maxEntries: 180
})
const networkFiatInFlightByKey = new Map<string, Promise<void>>()
const networkFiatFailureUntilByKey = new Map<string, number>()
const NETWORK_FIAT_FAILURE_TTL_MS = 3 * 60_000

function isNetworkFiatFailureCooldownActive(cacheKey: string): boolean {
  const until = Number(networkFiatFailureUntilByKey.get(cacheKey) || 0)
  if (!Number.isFinite(until) || until <= Date.now()) {
    networkFiatFailureUntilByKey.delete(cacheKey)
    return false
  }
  return true
}

function setNetworkFiatFailureCooldown(cacheKey: string, ttlMs = NETWORK_FIAT_FAILURE_TTL_MS): void {
  networkFiatFailureUntilByKey.set(cacheKey, Date.now() + Math.max(5_000, ttlMs))
}

function clearNetworkFiatFailureCooldown(cacheKey: string): void {
  networkFiatFailureUntilByKey.delete(cacheKey)
}

function parseTrackedTronTokensEnv(raw: string | undefined): TrackedTronToken[] {
  const input = String(raw || '').trim()
  if (!input) return []
  const out: TrackedTronToken[] = []
  for (const part of input.split(',').map((v) => v.trim()).filter(Boolean)) {
    const [symbolRaw, contractRaw] = part.split(':').map((v) => String(v || '').trim())
    const symbol = String(symbolRaw || '').trim().toUpperCase()
    const contract = String(contractRaw || '').trim()
    if (!symbol || !contract) continue
    out.push({ symbol, contract })
  }
  return out
}

function resolveTrackedTronTokens(): TrackedTronToken[] {
  const fromEnv = parseTrackedTronTokensEnv((import.meta as any)?.env?.VITE_TRON_TRACKED_TOKENS)
  if (fromEnv.length > 0) return fromEnv

  // Default minimal TRC20 set (extend via VITE_TRON_TRACKED_TOKENS).
  // USDT TRC20 contract is widely used and stable.
  return [{ symbol: 'USDT', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }]
}

function encodeTronContractLogoHint(logo: string, contract: string): string {
  const base = String(logo || '').trim()
  const c = String(contract || '').trim()
  if (!base || !c) return base || ''
  // Keep the original URL intact; store the contract as a fragment hint for later extraction.
  return `${base}#tron-contract=${encodeURIComponent(c)}`
}

function extractTronContractFromLogoHint(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const idx = raw.indexOf('#tron-contract=')
  if (idx < 0) return ''
  try {
    return decodeURIComponent(raw.slice(idx + '#tron-contract='.length)).trim()
  } catch {
    return raw.slice(idx + '#tron-contract='.length).trim()
  }
}

async function cachedFetchChainBalanceAndSync(params: {
  network: Network
  address: string
  rpcConfig: UtxoRpcConfig
  preferAddressIndexBalance?: boolean
  skipChainSyncProbe?: boolean
  zeroBalanceRecheckMs?: number
  force?: boolean
}): Promise<ChainBalanceSyncResult & { balance: string }> {
  const networkId = String(params.network?.id || '').trim()
  const address = String(params.address || '').trim().toLowerCase()
  const backend = String(params.rpcConfig?.bridgeUrl || params.network?.rpcUrl || '').trim().toLowerCase()
  const prefer = params.preferAddressIndexBalance === true ? '1' : '0'
  const syncProbe = params.skipChainSyncProbe === true ? '1' : '0'
  const recheck = Number.isFinite(Number(params.zeroBalanceRecheckMs)) ? String(Math.max(0, Math.trunc(Number(params.zeroBalanceRecheckMs)))) : '0'
  const key = `bal|${networkId}|${address}|${backend}|${prefer}|${syncProbe}|${recheck}`
  return await chainBalanceSnapshotCache.get(
    key,
    async () => await fetchChainBalanceAndSync({
      network: params.network,
      address: params.address,
      rpcConfig: params.rpcConfig,
      preferAddressIndexBalance: params.preferAddressIndexBalance,
      skipChainSyncProbe: params.skipChainSyncProbe,
      zeroBalanceRecheckMs: params.zeroBalanceRecheckMs
    }),
    undefined,
    { force: params.force === true }
  )
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.trunc(limit || 1))
  const out = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (true) {
      const index = cursor
      if (index >= items.length) return
      cursor += 1
      out[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return out
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.trunc(ms))))
}

function formatEvmTopicAddress(address: string): string {
  const stripped = String(address || '').trim().toLowerCase().replace(/^0x/, '')
  return `0x${stripped.padStart(64, '0')}`
}

function toHexBlock(value: bigint): string {
  if (value <= 0n) return '0x0'
  return `0x${value.toString(16)}`
}

function deriveApiBaseFromBridgeUrl(bridgeUrl: string): string {
  const raw = String(bridgeUrl || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  const lower = raw.toLowerCase()
  const idxV1Bridge = lower.indexOf('/v1/bridge/')
  if (idxV1Bridge >= 0) return raw.slice(0, idxV1Bridge)
  const idxBridge = lower.indexOf('/bridge/')
  if (idxBridge >= 0) return raw.slice(0, idxBridge)
  if (/\/v1$/i.test(raw)) return raw.replace(/\/v1$/i, '')
  return raw
}

async function discoverEvmTokenContractsFromAddressAssets(
  rpcConfig: UtxoRpcConfig,
  input: { coin: string; chain: string; ownerAddress: string }
): Promise<string[]> {
  const apiBase = deriveApiBaseFromBridgeUrl(String(rpcConfig.bridgeUrl || ''))
  if (!apiBase) return []

  const coin = String(input.coin || '').trim().toLowerCase()
  const chain = String(input.chain || 'main').trim().toLowerCase() || 'main'
  const ownerAddress = String(input.ownerAddress || '').trim()
  if (!coin || !ownerAddress || !ethers.isAddress(ownerAddress)) return []

  const url = `${apiBase}/v1/address/${encodeURIComponent(ownerAddress)}`
    + `/assets?coin=${encodeURIComponent(coin)}&chain=${encodeURIComponent(chain)}&multichain=1`
  const headers: Record<string, string> = {}
  const apiKey = String((import.meta as any)?.env?.VITE_APP_API_KEY || '').trim()
  if (apiKey) headers['X-API-Key'] = apiKey

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(rpcConfig.timeoutMs ?? 10000))
  try {
    let res: Response
    try {
      res = await fetch(url, { method: 'GET', headers, signal: controller.signal })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Address asset discovery failed [timeout]: ${url}`)
      }
      throw error
    }
    if (!res.ok) {
      const rawText = await res.text().catch(() => '')
      const json = (() => {
        try { return rawText ? JSON.parse(rawText) : null } catch { return null }
      })()
      const detail = compactBridgeAssetErrorText(String(
        json?.error?.message
        || json?.error
        || json?.message
        || rawText
        || `HTTP ${res.status}`
      ))
      throw new Error(`Address asset discovery failed [HTTP ${res.status}]: ${detail}`)
    }
    const json = await res.json().catch(() => null) as any
    const erc20Rows = Array.isArray(json?.assets?.erc20) ? json.assets.erc20 : []
    const out = new Set<string>()
    for (const row of erc20Rows) {
      const candidate = normalizeEvmAddressLoose(String(
        row?.contractAddress
        || row?.tokenAddress
        || row?.TokenAddress
        || ''
      ).trim())
      if (!candidate) continue
      out.add(candidate)
      if (out.size >= 220) break
    }
    return [...out]
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

async function discoverEvmTokenContractsFromLogs(
  rpcConfig: UtxoRpcConfig,
  ownerAddress: string,
  txidsHint?: string[]
): Promise<string[]> {
  const checksumOwner = ethers.getAddress(ownerAddress)
  const cacheKey = `${String(rpcConfig.bridgeUrl || '').trim().toLowerCase()}|${checksumOwner.toLowerCase()}`
  const cached = evmTokenDiscoveryCache.get(cacheKey)
  if (cached && Date.now() - cached.checkedAt <= EVM_TOKEN_DISCOVERY_TTL_MS) {
    return [...cached.addresses]
  }

  const ownerTopic = formatEvmTopicAddress(checksumOwner)
  let latestBlock = 0n
  try {
    const latestRaw = await callBridgeMethod(rpcConfig, 'eth_blockNumber', [])
    latestBlock = BigInt(String(latestRaw || '0x0'))
  } catch {
    latestBlock = 0n
  }

  const windows = Array.from(new Set<bigint>([
    latestBlock > 5000n ? latestBlock - 5000n : 0n,
    latestBlock > 25000n ? latestBlock - 25000n : 0n,
    latestBlock > 50000n ? latestBlock - 50000n : 0n
  ]))

  const discovered = new Set<string>()
  for (const fromBlock of windows) {
    try {
      const incoming = await callBridgeMethod(rpcConfig, 'eth_getLogs', [{
        fromBlock: toHexBlock(fromBlock),
        toBlock: 'latest',
        topics: [EVM_TRANSFER_TOPIC, null, ownerTopic]
      }]) as Array<{ address?: string }> | undefined

      const outgoing = await callBridgeMethod(rpcConfig, 'eth_getLogs', [{
        fromBlock: toHexBlock(fromBlock),
        toBlock: 'latest',
        topics: [EVM_TRANSFER_TOPIC, ownerTopic]
      }]) as Array<{ address?: string }> | undefined

      for (const row of [...(incoming || []), ...(outgoing || [])]) {
        const candidate = String(row?.address || '').trim()
        if (!ethers.isAddress(candidate)) continue
        discovered.add(ethers.getAddress(candidate))
        if (discovered.size >= 120) break
      }
      if (discovered.size >= 120) break
      const incomingCount = Array.isArray(incoming) ? incoming.length : 0
      const outgoingCount = Array.isArray(outgoing) ? outgoing.length : 0
      if (incomingCount > 0 || outgoingCount > 0) break
    } catch {
      // Provider may reject large ranges; try a narrower window.
    }
  }

  // Fallback: discover ERC-20 contracts from recent local activity tx receipts.
  if (discovered.size < 120) {
    const hintedTxids = Array.isArray(txidsHint)
      ? txidsHint
          .map((value) => String(value || '').trim())
          .filter((value) => /^0x[0-9a-f]{64}$/i.test(value))
      : []
    const uniqueTxids = [...new Set(hintedTxids)].slice(0, 36)
    if (uniqueTxids.length > 0) {
      await mapWithConcurrency(uniqueTxids, 6, async (txid) => {
        try {
          const receipt = await callBridgeMethod(rpcConfig, 'eth_getTransactionReceipt', [txid]) as {
            logs?: Array<{ address?: string; topics?: string[] }>
          } | null
          const logs = Array.isArray(receipt?.logs) ? receipt!.logs : []
          for (const log of logs) {
            const topics = Array.isArray(log?.topics) ? log!.topics : []
            const topic0 = String(topics[0] || '').toLowerCase()
            // ERC-20 Transfer(address,address,uint256) has exactly 3 topics.
            if (topic0 !== EVM_TRANSFER_TOPIC.toLowerCase() || topics.length !== 3) continue
            const candidate = String(log?.address || '').trim()
            if (!ethers.isAddress(candidate)) continue
            discovered.add(ethers.getAddress(candidate))
            if (discovered.size >= 120) break
          }
        } catch {
          // Keep reading remaining receipts.
        }
      })
    }
  }

  const out = [...discovered]
  evmTokenDiscoveryCache.set(cacheKey, { checkedAt: Date.now(), addresses: out })
  return out
}

async function readEvmTokenMetadata(
  rpcConfig: UtxoRpcConfig,
  tokenAddress: string
): Promise<{ symbol: string; decimals: number }> {
  const contract = ethers.getAddress(tokenAddress)
  let symbol = shortAddress(contract)
  let decimals = 18

  try {
    const symbolData = EVM_ERC20_METADATA_IFACE.encodeFunctionData('symbol', [])
    const symbolRaw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: contract, data: symbolData }, 'latest'])
    const [value] = EVM_ERC20_METADATA_IFACE.decodeFunctionResult('symbol', String(symbolRaw || '0x'))
    const normalized = String(value || '').trim()
    if (normalized) symbol = normalized.toUpperCase()
  } catch {
    // Some contracts expose bytes32 or non-standard symbol signatures.
  }

  try {
    const decimalsData = EVM_ERC20_METADATA_IFACE.encodeFunctionData('decimals', [])
    const decimalsRaw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: contract, data: decimalsData }, 'latest'])
    const [value] = EVM_ERC20_METADATA_IFACE.decodeFunctionResult('decimals', String(decimalsRaw || '0x'))
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 30) decimals = Math.trunc(parsed)
  } catch {
    // Keep default decimals for non-standard contracts.
  }

  return { symbol, decimals }
}

// Balance refresh should avoid noisy address-index probes on bridges that do not
// support them reliably for unfunded addresses.
function supportsAddressIndexBalance(coinSymbol?: string): boolean {
  const symbol = String(coinSymbol || '').trim().toUpperCase()
  return symbol === 'RTM' || symbol === 'BTCZ' || symbol === 'TIDE' || symbol === 'FIRO'
}

function normalizeNetworkListSymbols(networks: Network[]): Network[] {
  return (Array.isArray(networks) ? networks : []).map((network) => normalizeNetworkSymbol(network))
}

function normalizeServerCatalogSymbols(catalog: ServerCoinCatalogItem[]): ServerCoinCatalogItem[] {
  if (!Array.isArray(catalog)) return []
  return catalog.map((item) => {
    const coinId = String(item.coinId || '').trim().toLowerCase()
    const symbol = String(item.symbol || '').trim().toUpperCase()
    if (coinId !== 'bitcoin' && symbol !== 'BITCOI') return item
    return { ...item, symbol: 'BTC' }
  })
}

const TIDE_LEGACY_ADDRESS_SPEC = {
  bip44CoinType: 200,
  p2pkhVersion: 0x21
} as const

async function deriveSigningKeyForSenderAddress(
  mnemonic: string,
  net: Network,
  accountIndex: number,
  senderAddress: string
): Promise<{ address: string; pubHex: string; privHex: string }> {
  if (!net.coinSymbol) throw new Error('Network missing coinSymbol')
  const normalizedSender = String(senderAddress || '').trim()
  if (!normalizedSender) throw new Error('Sender address is required')

  const canonical = await deriveUtxoAddress(mnemonic, net.coinSymbol, accountIndex, 0, 0)
  if (canonical.address === normalizedSender) return canonical

  if (String(net.coinSymbol).trim().toUpperCase() === 'TIDE') {
    const legacy = await deriveUtxoAddressWithSpec(mnemonic, TIDE_LEGACY_ADDRESS_SPEC, accountIndex, 0, 0)
    if (legacy.address === normalizedSender) {
      console.warn(`[${net.symbol}] using legacy coin-type signing path for address ${normalizedSender}`)
      return legacy
    }
  }

  throw new Error(`Could not derive signing key for ${net.symbol} sender address ${normalizedSender}`)
}

function resolveDerivationIndex(account: Partial<Account>, fallback: number): number {
  if (typeof account.derivationIndex === 'number' && account.derivationIndex >= 0) {
    return account.derivationIndex
  }
  return fallback >= 0 ? fallback : 0
}

function parseOptionalRpcQuantity(value: string | undefined, label: string): bigint | undefined {
  const text = String(value || '').trim()
  if (!text) return undefined
  if (/^\d+$/.test(text)) return BigInt(text)
  if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text)
  throw new Error(`${label} must be a decimal integer or 0x-prefixed hex quantity`)
}

function parseEvmCoinAmountToWei(value: string | undefined, label: string, decimals = 18): bigint {
  const text = String(value || '').trim()
  if (!text) return 0n
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`${label} must be a decimal coin string`)
  }
  return ethers.parseUnits(text, decimals)
}

function getCachedBalanceForNetwork(
  account: Partial<Account> | undefined,
  networkId: string,
  fallbackToLegacy = false
): string {
  if (!account) return '0'
  const normalizedNetworkId = String(networkId || '').trim()
  const byNetwork = String(account.networkBalances?.[normalizedNetworkId] ?? '').trim()
  if (byNetwork) return byNetwork
  if (!fallbackToLegacy) return '0'
  const legacy = String(account.balance ?? '').trim()
  return legacy || '0'
}

function normalizePersistedAccounts(rawAccounts: unknown): Account[] {
  if (!Array.isArray(rawAccounts)) return []

  return rawAccounts.map((raw, index) => {
    const candidate = (raw ?? {}) as Partial<Account>
    const addresses = candidate.addresses ?? ({} as Record<CoinType, string>)
    const networkAddresses = remapNetworkIdKeyedRecord(candidate.networkAddresses ?? {})
    const networkNames = remapNetworkIdKeyedRecord(candidate.networkNames ?? {})
    const networkBalances = remapNetworkIdKeyedRecord(candidate.networkBalances ?? {})

    return {
      id: typeof candidate.id === 'string' ? candidate.id : `acc-${index + 1}`,
      name: typeof candidate.name === 'string' ? candidate.name : `Account ${index + 1}`,
      networkNames: networkNames,
      derivationIndex: resolveDerivationIndex(candidate, index),
      addresses: {
        EVM: addresses.EVM ?? '',
        UTXO: addresses.UTXO ?? '',
        BTC: addresses.BTC ?? '',
        COSMOS: addresses.COSMOS ?? '',
        SOL: addresses.SOL ?? '',
        SUI: addresses.SUI ?? ''
      },
      networkAddresses: networkAddresses,
      networkBalances: networkBalances,
      balance: typeof candidate.balance === 'string' ? candidate.balance : '0'
    }
  })
}

function hasChromeStorageLocal(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function readLocalStorageSafe(name: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(name)
  } catch {
    return null
  }
}

function writeLocalStorageSafe(name: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(name, value)
  } catch {
    // ignore storage write errors
  }
}

function removeLocalStorageSafe(name: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(name)
  } catch {
    // ignore storage remove errors
  }
}

const extensionStateStorage: StateStorage = {
  getItem: async (name) => {
    if (hasChromeStorageLocal()) {
      const stored = await chrome.storage.local.get(name)
      const raw = stored[name]

      if (raw !== undefined) {
        if (typeof raw === 'string') return raw
        if (raw && typeof raw === 'object' && 'state' in (raw as Record<string, unknown>)) {
          return JSON.stringify(raw)
        }
        return JSON.stringify({ state: raw, version: 0 })
      }

      const legacy = readLocalStorageSafe(name)
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy) as unknown
          await chrome.storage.local.set({ [name]: parsed })
          removeLocalStorageSafe(name)
        } catch {
          await chrome.storage.local.set({ [name]: legacy })
        }
      }

      return legacy
    }

    return readLocalStorageSafe(name)
  },

  setItem: async (name, value) => {
    if (hasChromeStorageLocal()) {
      let parsed: unknown = value
      try {
        parsed = JSON.parse(value)
      } catch {
        parsed = value
      }
      await chrome.storage.local.set({ [name]: parsed })
      removeLocalStorageSafe(name)
      return
    }

    writeLocalStorageSafe(name, value)
  },

  removeItem: async (name) => {
    if (hasChromeStorageLocal()) {
      await chrome.storage.local.remove(name)
    }
    removeLocalStorageSafe(name)
  }
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      isInitialized: false,
      hasVault: false,
      isLocked: true,
      vault: null,
      backupConfirmed: false,
      createdAt: null,
      sessionMnemonic: null,
      onboardingCompleted: false,
      
      accounts: [],
      nextAccountIndex: 1,
      activeAccountId: null,
      activeNetworkId: DEFAULT_ACTIVE_NETWORK_ID,
      networks: normalizeNetworkListSymbols(INITIAL_NETWORKS),
      disabledNetworkIds: resolveDefaultDisabledNetworkIds(normalizeNetworkListSymbols(INITIAL_NETWORKS)),
      
      isConnected: false,
      isSyncing: false,
      syncPercent: null,
      lowSyncStreak: 0,
      balanceRefreshNonce: 0,
      networkAssets: {},
      networkAssetLogos: {},
      networkAssetLabels: {},
      evmNftAssets: {},
      accountNetworkAssets: {},
      accountNetworkAssetLogos: {},
      accountNetworkAssetLabels: {},
      accountNetworkEvmNftAssets: {},
      accountNetworkFiatTotals: {},
      accountNetworkFiatNative: {},
      accountNetworkFiatAssets: {},
      serverCoinCatalog: [],
      sendListPreferences: {},
      networkModelPreferences: {},
      authorizedSites: [],
      autolockMinutes: 5,
      donationPercent: MIN_DONATION_PERCENT,
      lastActiveTimestamp: Date.now(),
      activity: [
        {
          id: '1',
          type: 'sent',
          asset: 'RTM',
          amount: '1',
          to: 'RGG...vcFFDFdffd',
          status: 'confirmed',
          timestamp: Date.now() - 3600000,
          networkId: DEFAULT_ACTIVE_NETWORK_ID
        },
        {
          id: '2',
          type: 'sent',
          asset: 'ASSETNAME',
          amount: '1',
          to: 'RGG...vcFFDFdffd',
          status: 'confirmed',
          timestamp: Date.now() - 7200000,
          networkId: DEFAULT_ACTIVE_NETWORK_ID
        }
      ],

      initialize: async (password, mnemonic, options) => {
        const vault = await encryptVaultV1({ password, mnemonic })
        const normalizedMnemonic = mnemonic.trim()

        const networks = get().networks
        const visibilityPatch = options?.startWithEthereumOnly
          ? resolveEthereumOnlyNetworkDefaults(networks)
          : {}
        const derived = await deriveAccountAddresses(normalizedMnemonic, networks, 0)
        const utxoNetworks = networks.filter((n) => n.coinType === 'UTXO')
        const derivedUtxoCount = utxoNetworks.filter((n) => Boolean(derived.networkAddresses[n.id])).length
        if (utxoNetworks.length > 0 && derivedUtxoCount === 0) {
          throw new Error(`Could not derive any wallet address.\n${derived.derivationErrors.join('\n')}`)
        }

        const initialAccount: Account = {
          id: 'acc-1',
          name: 'Account 1',
          networkNames: {},
          derivationIndex: 0,
          addresses: derived.addresses,
          networkAddresses: derived.networkAddresses,
          networkBalances: {},
          balance: '0'
        }

        set({
          isInitialized: true,
          hasVault: true,
          isLocked: false,
          vault,
          backupConfirmed: false,
          createdAt: Date.now(),
          sessionMnemonic: normalizedMnemonic,
          onboardingCompleted: false,
          accounts: [initialAccount],
          nextAccountIndex: 1,
          activeAccountId: 'acc-1',
          lastActiveTimestamp: Date.now(),
          ...visibilityPatch
        })

        void get().refreshActiveBalance().catch((err) => {
          console.warn('Initial balance refresh failed:', err)
        })
      },

      verifyPassword: async (password) => {
        const { vault } = get()
        if (!vault) return false
        try {
          await decryptVaultV1({ password, vault })
          return true
        } catch {
          return false
        }
      },

      signBackendAuthMessage: async (message) => {
        const { isLocked, sessionMnemonic, accounts, activeAccountId } = get()
        if (isExternalEvmSignerEnabled()) {
          const signer = await resolveEvmExternalSigner()
          if (!signer) throw new Error('External EVM signer is not available')
          const address = await signer.getAddress()
          const signature = await signer.signMessage(String(message || ''))
          return { address, signature }
        }
        if (isLocked || !sessionMnemonic) throw new Error('Wallet is locked')

        const activeAccount = accounts.find((a) => a.id === activeAccountId) || accounts[0]
        if (!activeAccount) throw new Error('No active account')

        const fallbackIndex = accounts.findIndex((a) => a.id === activeAccount.id)
        const derivationIndex = resolveDerivationIndex(activeAccount, fallbackIndex)
        const evmWallet = deriveEvmWallet(sessionMnemonic, derivationIndex)
        const signature = await evmWallet.signMessage(String(message || ''))
        return { address: evmWallet.address, signature }
      },

      unlock: async (password) => {
        const { vault } = get()
        if (!vault) return false
        try {
          const plain = await decryptVaultV1({ password, vault })
          const normalizedMnemonic = plain.mnemonic.trim()
          const existingAccounts = get().accounts
          const sourceAccounts: Account[] = existingAccounts.length > 0
            ? existingAccounts
            : [{
              id: 'acc-1',
              name: 'Account 1',
              networkNames: {},
              derivationIndex: 0,
              addresses: { EVM: '', UTXO: '', BTC: '', COSMOS: '', SOL: '', SUI: '' },
              networkAddresses: {},
              networkBalances: {},
              balance: '0'
            }]

          // Fast unlock path: restore persisted account state immediately.
          // Missing per-network addresses are derived lazily via ensureNetworkAddress()
          // when user switches coins/accounts or connecting screen runs.
          const nextAccounts: Account[] = sourceAccounts.map((account, i) => {
            const derivationIndex = resolveDerivationIndex(account, i)
            return {
              ...account,
              derivationIndex,
              addresses: {
                EVM: account.addresses?.EVM || '',
                UTXO: account.addresses?.UTXO || '',
                BTC: account.addresses?.BTC || '',
                COSMOS: account.addresses?.COSMOS || '',
                SOL: account.addresses?.SOL || '',
                SUI: account.addresses?.SUI || ''
              },
              networkNames: { ...(account.networkNames ?? {}) },
              networkAddresses: { ...(account.networkAddresses ?? {}) },
              networkBalances: { ...(account.networkBalances ?? {}) },
              balance: String(account.balance ?? '0')
            }
          })

          const highestDerivationIndex = nextAccounts.reduce(
            (max, account) => Math.max(max, account.derivationIndex),
            -1
          )
          const nextAccountIndex = Math.max(1, highestDerivationIndex + 1)
          const activeAccountId = get().activeAccountId
          const safeActiveAccountId = nextAccounts.some((a) => a.id === activeAccountId)
            ? activeAccountId
            : (nextAccounts[0]?.id ?? null)

          set({
            isLocked: false,
            hasVault: true,
            isInitialized: true,
            sessionMnemonic: normalizedMnemonic,
            createdAt: plain.createdAt ?? Date.now(),
            accounts: nextAccounts,
            nextAccountIndex,
            activeAccountId: safeActiveAccountId,
            lastActiveTimestamp: Date.now()
          })
          return true
        } catch {
          return false
        }
      },

      lock: () => set({ isLocked: true, sessionMnemonic: null }),
      setLocked: (locked) => set({ isLocked: locked }),
      setInitialized: (initialized) => set({ isInitialized: initialized }),
      setBackupConfirmed: (confirmed) => set({ backupConfirmed: confirmed }),
      setOnboardingCompleted: (completed) => set({ onboardingCompleted: completed }),
      wipeVault: () =>
        set({
          isInitialized: false,
          hasVault: false,
          isLocked: true,
          vault: null,
          backupConfirmed: false,
          createdAt: null,
          sessionMnemonic: null,
          onboardingCompleted: false,
          accounts: [],
          nextAccountIndex: 1,
          activeAccountId: null,
          disabledNetworkIds: resolveDefaultDisabledNetworkIds(normalizeNetworkListSymbols(INITIAL_NETWORKS)),
          syncPercent: null,
          lowSyncStreak: 0,
          donationPercent: MIN_DONATION_PERCENT,
          networkAssets: {},
          networkAssetLogos: {},
          networkAssetLabels: {},
          evmNftAssets: {},
          accountNetworkAssets: {},
          accountNetworkAssetLogos: {},
          accountNetworkAssetLabels: {},
          accountNetworkEvmNftAssets: {},
          accountNetworkFiatTotals: {},
          accountNetworkFiatNative: {},
          accountNetworkFiatAssets: {},
          sendListPreferences: {},
          networkModelPreferences: {},
          activity: []
        }),

      setActiveAccount: (id) => {
        const { activeNetworkId } = get()
        set((state) => ({
          activeAccountId: id,
          lastActiveTimestamp: Date.now(),
          accounts: state.accounts.map((account) => (
            account.id === id
              ? { ...account, balance: getCachedBalanceForNetwork(account, activeNetworkId, false) }
              : account
          )),
          ...buildScopedAssetProjection(state, id, activeNetworkId)
        }))
        void (async () => {
          await get().ensureNetworkAddress(activeNetworkId)
          await Promise.allSettled([
            get().refreshActiveBalance(),
            get().fetchNetworkAssets()
          ])
        })()
      },

      ensureNetworkAddress: async (networkId) => {
        const { networks, accounts, activeAccountId, sessionMnemonic, isLocked } = get()
        const net = networks.find(n => n.id === networkId)
        const acc = accounts.find(a => a.id === activeAccountId) || accounts[0]
        if (!net || !acc) return null
        const modelId = resolveNetworkModelId(net)
        const existing = acc.networkAddresses?.[networkId]
        if (existing) {
          if (net.derivation?.status === 'unsupported') return existing
          const forceCanonicalUtxoAddress = net.coinType === 'UTXO' && shouldForceCanonicalUtxoAddress(net.coinSymbol)
          if (forceCanonicalUtxoAddress) {
            // Continue to derivation below to canonicalize persisted legacy paths.
          } else if (net.coinType === 'UTXO' && net.coinSymbol) {
            if (isAddressForCoinSymbol(existing, net.coinSymbol)) return existing
          } else if (
            net.coinType === 'EVM'
            || modelId === 'sol'
            || modelId === 'xlm'
            || modelId === 'tron'
            || modelId === 'cosmos'
            || isCroCosmosModel(net)
          ) {
            const isValidPersisted = await validateChainAddress(net, undefined, existing).catch(() => false)
            if (isValidPersisted) return existing
            console.warn(`[${net.symbol}] persisted address is invalid for ${networkId}; re-deriving canonical address`)
          } else {
            return existing
          }
        }
        if (net.derivation?.status === 'unsupported') {
          // Non-custodial only: if we cannot derive locally, we do not ask the backend wallet for addresses.
          console.warn(`[${net.symbol}] Derivation disabled: ${net.derivation.reason || 'unsupported in this build'}`)
          return null
        }
        const requiresMnemonic = requiresMnemonicForNetwork(net)
        if (isLocked || (requiresMnemonic && !sessionMnemonic)) return null
        const accountIndex = resolveDerivationIndex(acc, accounts.findIndex((a) => a.id === acc.id))
        const forceCanonicalUtxoAddress = net.coinType === 'UTXO' && shouldForceCanonicalUtxoAddress(net.coinSymbol)

        // Derive address on demand
        try {
          const address = await deriveSingleNetworkAddress(sessionMnemonic!, net, accountIndex)
          if (address) {
            if (net.coinType === 'UTXO' && net.coinSymbol) {
              if (forceCanonicalUtxoAddress && existing && existing !== address) {
                console.info(`[${net.symbol}] migrated canonical address ${existing} -> ${address}`)
              } else {
                console.info(`[${net.symbol}] derived address on demand: ${address}`)
              }
            }
            if (existing !== address) {
              get().updateAccount(acc.id, {
                networkAddresses: { ...(acc.networkAddresses ?? {}), [networkId]: address }
              })
            }
            return address
          }
        } catch (err) {
          console.warn(`Failed to derive address for ${networkId}:`, err)
        }
        return null
      },

      setActiveNetwork: async (id, options) => {
        const stateBefore = get()
        const requestedId = resolveKnownNetworkId(stateBefore.networks, id) || normalizeNetworkIdAlias(id)
        const normalizedId = resolveEnabledNetworkId(
          stateBefore.networks,
          stateBefore.disabledNetworkIds,
          requestedId || stateBefore.activeNetworkId
        )
        set((state) => {
          const activeAccount = state.accounts.find((account) => account.id === state.activeAccountId) || state.accounts[0]
          const nextAccounts = activeAccount
            ? state.accounts.map((account) => (
              account.id === activeAccount.id
                ? { ...account, balance: getCachedBalanceForNetwork(account, normalizedId, false) }
                : account
            ))
            : state.accounts

          return {
            activeNetworkId: normalizedId,
            lastActiveTimestamp: Date.now(),
            accounts: nextAccounts,
            ...(activeAccount ? buildScopedAssetProjection(state, activeAccount.id, normalizedId) : {})
          }
        })
        await get().ensureNetworkAddress(normalizedId)
        if (options?.skipRefresh !== true) {
          await get().refreshActiveBalance()
        }
      },

      setConnected: (connected) => set({ isConnected: connected }),
      setSyncing: (syncing) => set({ isSyncing: syncing }),
      fetchNetworkFiat: async (options) => {
        const { networks, activeNetworkId, accounts, activeAccountId } = get()
        const network = networks.find((item) => item.id === activeNetworkId)
        const account = accounts.find((item) => item.id === activeAccountId) || accounts[0]
        if (!network || !account) return

        const requestAccountId = String(account.id || '').trim()
        const requestNetworkId = String(activeNetworkId || '').trim()
        let address = String(account.networkAddresses?.[requestNetworkId] || '').trim()
        if (!address) {
          const ensured = await get().ensureNetworkAddress(requestNetworkId)
          address = String(ensured || '').trim()
        }
        if (!address) return

        const requestMeta = resolvePortfolioRequestMeta(network)
        if (!requestMeta) return

        const cacheKey = `fiat|${requestNetworkId}|${address.toLowerCase()}|usd,eur`
        if (options?.force !== true && isNetworkFiatFailureCooldownActive(cacheKey)) return
        const inFlight = networkFiatInFlightByKey.get(cacheKey)
        if (inFlight) {
          await inFlight
          return
        }

        let resolveInFlight: (() => void) | null = null
        const inFlightSignal = new Promise<void>((resolve) => { resolveInFlight = resolve })
        networkFiatInFlightByKey.set(cacheKey, inFlightSignal)
        try {
          const force = options?.force === true
          if (!force) {
            const cached = networkFiatCache.peek(cacheKey)
            if (cached) {
              const scopeKey = buildAssetStateScopeKey(requestAccountId, requestNetworkId)
              set((state) => ({
                accountNetworkFiatTotals: { ...state.accountNetworkFiatTotals, [scopeKey]: cached.totals },
                accountNetworkFiatNative: { ...state.accountNetworkFiatNative, [scopeKey]: cached.native },
                accountNetworkFiatAssets: { ...state.accountNetworkFiatAssets, [scopeKey]: cached.assets }
              }))
              return
            }
          }

          const requestAddress = await normalizeServerAddress(network, address)
          if (!requestAddress) return
          const params = new URLSearchParams({
            coin: requestMeta.coin,
            chain: requestMeta.chain,
            fiat: 'usd,eur'
          })
          const url = `${requestMeta.apiBase}/v1/address/${encodeURIComponent(requestAddress)}/portfolio?${params.toString()}`
          const headers: Record<string, string> = {}
          if (APP_API_KEY) headers['X-API-Key'] = APP_API_KEY
          const response = await fetch(url, { method: 'GET', headers })
          if (!response.ok) {
            setNetworkFiatFailureCooldown(cacheKey)
            return
          }
          const json = await response.json().catch(() => null) as Record<string, unknown> | null
          const portfolio = (json?.portfolio && typeof json.portfolio === 'object')
            ? json.portfolio as Record<string, unknown>
            : null
          if (!portfolio) {
            setNetworkFiatFailureCooldown(cacheKey)
            return
          }

          const buckets = buildPortfolioFiatBuckets(get(), requestAccountId, network, portfolio)
          const scopeKey = buildAssetStateScopeKey(requestAccountId, requestNetworkId)
          set((state) => ({
            accountNetworkFiatTotals: { ...state.accountNetworkFiatTotals, [scopeKey]: buckets.totals },
            accountNetworkFiatNative: { ...state.accountNetworkFiatNative, [scopeKey]: buckets.native },
            accountNetworkFiatAssets: { ...state.accountNetworkFiatAssets, [scopeKey]: buckets.assets }
          }))
          clearNetworkFiatFailureCooldown(cacheKey)

          networkFiatCache.get(
            cacheKey,
            async () => buckets,
            undefined,
            { force: true }
          ).catch(() => {})
        } catch (error) {
          setNetworkFiatFailureCooldown(cacheKey)
          console.warn(`[${network.symbol}] fetchNetworkFiat failed for ${requestNetworkId} (${address}).`, error)
        } finally {
          if (networkFiatInFlightByKey.get(cacheKey) === inFlightSignal) {
            networkFiatInFlightByKey.delete(cacheKey)
          }
          ;(resolveInFlight as (() => void) | null)?.()
        }
      },

      fetchNetworkAssets: async (options) => {
        const {
          networks,
          activeNetworkId,
          accounts,
          activeAccountId,
          serverCoinCatalog,
          activity
        } = get()
        const net = networks.find(n => n.id === activeNetworkId)
        const acc = accounts.find(a => a.id === activeAccountId) || accounts[0]
        if (!net || !acc) return
        const requestAccountId = String(acc.id || '').trim()
        const requestNetworkId = String(activeNetworkId || '').trim()
        const bridgeCooldownMs = getTransientBridgeCooldownRemainingMs(activeNetworkId)
        if (bridgeCooldownMs > 0 && options?.force !== true) return
        const activeModelId = String(net.runtimeModelId || net.id || '').trim().toLowerCase()
        if (!resolveNetworkCapabilities(net).features.assetLayer) return

        let address = String(acc.networkAddresses?.[activeNetworkId] || '').trim()
        if (!address) {
          const ensured = await get().ensureNetworkAddress(activeNetworkId)
          address = String(ensured || '').trim()
        }
        if (!address) return

        const cacheKey = `assets|${activeNetworkId}|${String(address).trim().toLowerCase()}`
        const inFlight = networkAssetsInFlightByKey.get(cacheKey)
        if (inFlight) {
          await inFlight
          return
        }
        let resolveInFlight: (() => void) | null = null
        const inFlightSignal = new Promise<void>((resolve) => { resolveInFlight = resolve })
        networkAssetsInFlightByKey.set(cacheKey, inFlightSignal)
        try {
          const force = options?.force === true
          if (!force) {
            const cached = networkAssetsCache.peek(cacheKey)
             if (cached) {
               set((state) => buildScopedAssetStateUpdate(state, requestAccountId, requestNetworkId, {
                 assets: cached.assets,
                 logos: cached.logos,
                 labels: cached.labels,
                 evmNfts: cached.evmNfts || {}
               }))
               return
             }
          }

        if (net.coinType === 'EVM') {
          const modelId = String(net.runtimeModelId || net.id || '').trim().toLowerCase()
          const trackedDefaults = await resolveTrackedEvmTokens(net)
          const trackedFromCatalog = resolveCatalogEvmTrackedTokens(serverCoinCatalog, modelId)
          const chainId = resolveEvmChainId(net)
          const trackedByAddress = new Map<string, EvmTrackedToken>()
          for (const token of mergeTrackedEvmTokens(trackedDefaults, trackedFromCatalog)) {
            if (!ethers.isAddress(token.address)) continue
            const checksum = ethers.getAddress(token.address)
            if (trackedByAddress.has(checksum)) continue
            trackedByAddress.set(checksum, { ...token, address: checksum })
          }
          try {
            const baseRpcConfig = await createUtxoRpcConfig(net, {
              secureBridgeSigner: get().signBackendAuthMessage
            })
            const rpcConfig: UtxoRpcConfig = {
              ...baseRpcConfig,
              // EVM asset scans involve many sequential eth_call/getLogs requests.
              // Use a higher read timeout to reduce false AbortError failures.
              timeoutMs: Math.max(Number(baseRpcConfig.timeoutMs ?? 10000), 30000)
            }
            const bridgeCoin = String(
              net.serverCoinId
              || (activeNetworkId === 'eth' ? 'ethereum' : activeNetworkId)
            ).trim().toLowerCase()
            const bridgeChain = String(net.serverChain || 'main').trim().toLowerCase() || 'main'
            let tokenBalanceEndpointUnsupported = isUnsupportedBridgeAssetEndpointCached(activeNetworkId, 'token-balance')
            let addressAssetsEndpointUnsupported = isUnsupportedBridgeAssetEndpointCached(activeNetworkId, 'address-assets')

            if (!tokenBalanceEndpointUnsupported) {
              try {
                await fetchBridgeTokenBalances(rpcConfig, {
                  coin: bridgeCoin,
                  chain: bridgeChain,
                  owner: address,
                  wallet: String(net.rpcWallet || '').trim() || undefined
                })
              } catch (error) {
                if (isUnsupportedBridgeAssetEndpointError(error)) {
                  tokenBalanceEndpointUnsupported = true
                  const firstMark = markUnsupportedBridgeAssetEndpoint(activeNetworkId, 'token-balance')
                  if (firstMark) {
                    console.warn(
                      `[${net.symbol}] bridge token.balance asset endpoint is not implemented for ${activeNetworkId}; `
                      + 'using direct EVM token reads for now.',
                      error
                    )
                  }
                }
                // Fall through to slower RPC/explorer scan.
              }
            }

            const activityTxids = activity
              .filter((entry) =>
                String(entry?.networkId || '').trim() === activeNetworkId
                && String(entry?.status || '').trim().toLowerCase() !== 'rejected'
                && (
                  String(entry?.accountId || '').trim() === String(acc.id || '').trim()
                  || String(entry?.from || '').trim().toLowerCase() === address.toLowerCase()
                  || String(entry?.to || '').trim().toLowerCase() === address.toLowerCase()
                )
              )
              .map((entry) => String(entry?.id || '').trim())
            const discoveredAddresses = await discoverEvmTokenContractsFromLogs(
              rpcConfig,
              address,
              activityTxids
            ).catch(() => [])
            let assetsEndpointContracts: string[] = []
            if (!addressAssetsEndpointUnsupported) {
              try {
                assetsEndpointContracts = await discoverEvmTokenContractsFromAddressAssets(rpcConfig, {
                  coin: bridgeCoin,
                  chain: bridgeChain,
                  ownerAddress: address
                })
              } catch (error) {
                if (isUnsupportedBridgeAssetEndpointError(error)) {
                  addressAssetsEndpointUnsupported = true
                  const firstMark = markUnsupportedBridgeAssetEndpoint(activeNetworkId, 'address-assets')
                  if (firstMark) {
                    console.warn(
                      `[${net.symbol}] address asset discovery endpoint is not implemented for ${activeNetworkId}; `
                      + 'skipping that bridge probe until the backend supports it.',
                      error
                    )
                  }
                }
              }
            }
            for (const discoveredAddress of discoveredAddresses) {
              if (trackedByAddress.has(discoveredAddress)) continue
              trackedByAddress.set(discoveredAddress, {
                address: discoveredAddress,
                symbol: shortAddress(discoveredAddress),
                decimals: 18,
                discovered: true
              })
            }
            for (const discoveredAddress of assetsEndpointContracts) {
              if (trackedByAddress.has(discoveredAddress)) continue
              trackedByAddress.set(discoveredAddress, {
                address: discoveredAddress,
                symbol: shortAddress(discoveredAddress),
                decimals: 18,
                discovered: true
              })
            }

            let mergedTokens = [...trackedByAddress.values()]
            if (discoveredAddresses.length === 0 && assetsEndpointContracts.length === 0 && mergedTokens.length > 80) {
              // Shared/public RPC providers often throttle large token scan bursts.
              // Keep scan bounded when no dynamic discovery source produced candidates.
              mergedTokens = mergedTokens.slice(0, 80)
            }

            // Bridge-first: keep app->server transport consistent with wallet policy.
            const fungibleAssets: Record<string, number> = {}
            const fungibleAssetLogos: Record<string, string> = {}
            const fungibleAssetLabels: Record<string, string> = {}
            const usedAssetKeys = new Set<string>()
            const assetKeyByContract = new Map<string, string>()
            let tokenReadSuccesses = 0
            let tokenReadErrors = 0
            const tokenRows = await mapWithConcurrency(mergedTokens, 6, async (token) => {
              try {
                const balanceCallData = EVM_ERC20_BALANCE_IFACE.encodeFunctionData('balanceOf', [address])
                let rawHex: unknown = null
                let lastError: unknown = null
                for (let attempt = 0; attempt < 3; attempt += 1) {
                  try {
                    rawHex = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: token.address, data: balanceCallData }, 'latest'])
                    lastError = null
                    break
                  } catch (err) {
                    lastError = err
                    if (attempt < 2) await waitMs(120 * (attempt + 1))
                  }
                }
                if (lastError) throw lastError
                tokenReadSuccesses += 1
                const rawBalance = BigInt(String(rawHex || '0x0'))
                if (rawBalance <= 0n) return null

                let symbol = String(token.symbol || token.address.slice(0, 6)).trim().toUpperCase()
                let decimals = token.decimals
                if (token.discovered) {
                  const discoveredMeta = await readEvmTokenMetadata(rpcConfig, token.address).catch(() => null)
                  if (discoveredMeta) {
                    symbol = String(discoveredMeta.symbol || symbol).trim().toUpperCase()
                    decimals = discoveredMeta.decimals
                  }
                }

                const displaySats = toAssetDisplaySats(rawBalance, decimals)
                if (!Number.isFinite(displaySats) || displaySats <= 0) return null

                return {
                  token,
                  symbol,
                  displaySats,
                  logoUri: String(token.logoUri || buildTrustWalletErc20LogoUri(chainId, token.address) || '').trim() || undefined
                }
              } catch {
                // Ignore non-standard/non-ERC20 contracts discovered from Transfer logs.
                tokenReadErrors += 1
                return null
              }
            })

            for (const row of tokenRows) {
              if (!row) continue
              const baseKey = row.token.discovered
                ? `${row.symbol}@${shortAddress(row.token.address)}`
                : row.symbol
              let assetKey = baseKey
              let suffix = 2
              while (usedAssetKeys.has(assetKey)) {
                assetKey = `${baseKey}-${suffix}`
                suffix += 1
              }
              usedAssetKeys.add(assetKey)
              fungibleAssets[assetKey] = row.displaySats
              fungibleAssetLabels[assetKey] = row.symbol
              if (row.logoUri) fungibleAssetLogos[assetKey] = row.logoUri
              assetKeyByContract.set(row.token.address, assetKey)
            }

            const trackedNfts = [...resolveTrackedEvmNfts(net), ...resolveCatalogEvmTrackedNfts(serverCoinCatalog, modelId)]
            const nftByKey = new Map<string, EvmTrackedNft>()
            for (const nft of trackedNfts.slice(0, MAX_TRACKED_EVM_NFTS)) {
              if (!ethers.isAddress(nft.address)) continue
              const checksum = ethers.getAddress(nft.address)
              const tokenId = String(nft.tokenId || '').trim()
              if (!tokenId) continue
              const key = `${checksum}:${tokenId.toLowerCase()}`
              if (nftByKey.has(key)) continue
              nftByKey.set(key, { ...nft, address: checksum })
            }

            const standardCache = new Map<string, EvmNftStandard | null>()
            const collectionCache = new Map<string, string>()
            const nftAssets: Record<string, number> = {}
            const nftLookup: Record<string, EvmNftHolding> = {}

            const readCollectionName = async (contract: string, standard: EvmNftStandard): Promise<string> => {
              const cached = collectionCache.get(contract)
              if (cached) return cached
              const iface = standard === 'erc721' ? EVM_ERC721_IFACE : EVM_ERC1155_IFACE
              for (const fn of ['symbol', 'name'] as const) {
                try {
                  const data = iface.encodeFunctionData(fn, [])
                  const raw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: contract, data }, 'latest'])
                  const [value] = iface.decodeFunctionResult(fn, String(raw || '0x'))
                  const out = String(value || '').trim()
                  if (out) {
                    collectionCache.set(contract, out)
                    return out
                  }
                } catch {
                  // try next accessor
                }
              }
              return 'NFT'
            }

            const resolveStandard = async (nft: EvmTrackedNft): Promise<EvmNftStandard | null> => {
              if (nft.standard === 'erc721' || nft.standard === 'erc1155') return nft.standard
              if (standardCache.has(nft.address)) return standardCache.get(nft.address) ?? null
              const detected = await detectEvmNftStandard(rpcConfig, nft.address)
              standardCache.set(nft.address, detected)
              return detected
            }

            for (const nft of nftByKey.values()) {
              const standard = await resolveStandard(nft)
              if (!standard) continue
              let quantityRaw = 0n
              try {
                if (standard === 'erc721') {
                  const ownerData = EVM_ERC721_IFACE.encodeFunctionData('ownerOf', [tokenIdToBigInt(nft.tokenId)])
                  const ownerRaw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: nft.address, data: ownerData }, 'latest'])
                  const [owner] = EVM_ERC721_IFACE.decodeFunctionResult('ownerOf', String(ownerRaw || '0x'))
                  if (String(owner || '').trim().toLowerCase() !== address.toLowerCase()) continue
                  quantityRaw = 1n
                } else {
                  const balanceData = EVM_ERC1155_IFACE.encodeFunctionData('balanceOf', [address, tokenIdToBigInt(nft.tokenId)])
                  const balanceRaw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: nft.address, data: balanceData }, 'latest'])
                  const [ownedRaw] = EVM_ERC1155_IFACE.decodeFunctionResult('balanceOf', String(balanceRaw || '0x'))
                  quantityRaw = BigInt(String(ownedRaw || '0'))
                  if (quantityRaw <= 0n) continue
                }
              } catch {
                continue
              }

              const collection = nft.label || await readCollectionName(nft.address, standard)
              const tokenIdLabel = formatTokenIdForLabel(nft.tokenId)
              const displayLabel = `${collection} #${tokenIdLabel} Â· ${shortAddress(nft.address)}`
              const assetKey = buildEvmNftAssetKey(nft.address, nft.tokenId, standard)
              const quantitySats = Number(quantityRaw > 9999999999n ? 9999999999n : quantityRaw) * 1e8
              if (!Number.isFinite(quantitySats) || quantitySats <= 0) continue
              nftAssets[assetKey] = quantitySats
              nftLookup[assetKey] = {
                address: nft.address,
                tokenId: nft.tokenId,
                standard,
                label: displayLabel,
                quantityRaw: quantityRaw.toString()
              }
            }

            let bridgeFallbackRowsApplied = 0
            if (!tokenBalanceEndpointUnsupported) {
              try {
                const bridgeRows = await fetchBridgeTokenBalances(rpcConfig, {
                  coin: bridgeCoin,
                  chain: bridgeChain,
                  owner: address,
                  wallet: String(net.rpcWallet || '').trim() || undefined
                })
                for (const row of bridgeRows) {
                  const rawBalanceText = String(row.balanceRaw || '').trim()
                  if (!/^\d+$/.test(rawBalanceText)) continue
                  const rawBalance = BigInt(rawBalanceText)
                  if (rawBalance <= 0n) continue

                  const tokenType = String(row.tokenType || '').trim()
                  if (isBridgeEvmNftTokenType(tokenType)) {
                    const parsedNft = parseBridgeEvmNftReference(row)
                    if (!parsedNft) continue
                    const standard: EvmNftStandard = /1155/i.test(tokenType) ? 'erc1155' : 'erc721'
                    const assetKey = buildEvmNftAssetKey(parsedNft.address, parsedNft.tokenId, standard)
                    const quantitySats = Number(rawBalance > 9999999999n ? 9999999999n : rawBalance) * 1e8
                    if (!Number.isFinite(quantitySats) || quantitySats <= 0) continue
                    const collection = String(row.name || row.symbol || 'NFT').trim() || 'NFT'
                    const displayLabel = `${collection} #${formatTokenIdForLabel(parsedNft.tokenId)} - ${shortAddress(parsedNft.address)}`
                    nftAssets[assetKey] = quantitySats
                    nftLookup[assetKey] = {
                      address: parsedNft.address,
                      tokenId: parsedNft.tokenId,
                      standard,
                      label: displayLabel,
                      quantityRaw: rawBalance.toString()
                    }
                    bridgeFallbackRowsApplied += 1
                    continue
                  }

                  const decimalsRaw = Number(row.decimals)
                  const decimals = Number.isInteger(decimalsRaw) && decimalsRaw >= 0 && decimalsRaw <= 30 ? decimalsRaw : 18
                  const displaySats = toAssetDisplaySats(rawBalance, decimals)
                  if (!Number.isFinite(displaySats) || displaySats <= 0) continue

                  const tokenAddress = normalizeEvmAddressLoose(String(row.tokenAddress || row.tokenId || '').trim())
                  const symbol = String(row.symbol || row.name || '').trim().toUpperCase()
                  const displaySymbol = symbol || (tokenAddress ? shortAddress(tokenAddress) : 'TOKEN')

                  let assetKey = tokenAddress ? String(assetKeyByContract.get(tokenAddress) || '').trim() : ''
                  if (!assetKey) {
                    const baseKey = tokenAddress
                      ? `${displaySymbol}@${shortAddress(tokenAddress)}`
                      : displaySymbol
                    assetKey = baseKey
                    let suffix = 2
                    while (usedAssetKeys.has(assetKey)) {
                      assetKey = `${baseKey}-${suffix}`
                      suffix += 1
                    }
                    usedAssetKeys.add(assetKey)
                    if (tokenAddress) assetKeyByContract.set(tokenAddress, assetKey)
                  }

                  const prev = Number(fungibleAssets[assetKey] || 0)
                  fungibleAssets[assetKey] = Math.max(prev, displaySats)
                  fungibleAssetLabels[assetKey] = displaySymbol
                  if (tokenAddress) {
                    const logoUri = buildTrustWalletErc20LogoUri(chainId, tokenAddress)
                    if (logoUri) fungibleAssetLogos[assetKey] = logoUri
                  }
                  bridgeFallbackRowsApplied += 1
                }
              } catch (bridgeFallbackError) {
                if (isUnsupportedBridgeAssetEndpointError(bridgeFallbackError)) {
                  tokenBalanceEndpointUnsupported = true
                  const firstMark = markUnsupportedBridgeAssetEndpoint(activeNetworkId, 'token-balance')
                  if (firstMark) {
                    console.warn(
                      `[${net.symbol}] bridge token.balance asset endpoint is not implemented for ${activeNetworkId}; `
                      + 'keeping RPC-discovered assets only until backend support is added.',
                      bridgeFallbackError
                    )
                  }
                } else {
                  console.warn(
                    `[${net.symbol}] fetchNetworkAssets bridge token.balance read failed for ${activeNetworkId} (${address}).`,
                    bridgeFallbackError
                  )
                }
              }
            }

            const assets = { ...fungibleAssets, ...nftAssets }

            // Do not wipe visible assets on transient provider failures.
            if (tokenReadSuccesses === 0 && tokenReadErrors > 0 && bridgeFallbackRowsApplied === 0 && Object.keys(assets).length === 0) {
              console.warn(
                `[${net.symbol}] fetchNetworkAssets skipped state update for ${activeNetworkId} (${address}) `
                + `because all ERC20 reads failed (errors=${tokenReadErrors}).`
              )
              return
            }

            set((state) => buildScopedAssetStateUpdate(state, requestAccountId, requestNetworkId, {
              assets,
              logos: fungibleAssetLogos,
              labels: fungibleAssetLabels,
              evmNfts: nftLookup
            }))

            networkAssetsCache.get(
              cacheKey,
              async () => ({ assets, logos: fungibleAssetLogos, labels: fungibleAssetLabels, evmNfts: nftLookup }),
              undefined,
              { force: true }
            ).catch(() => {})
          } catch (err) {
            if (isTransientBridgeFailure(err)) setTransientBridgeCooldown(activeNetworkId)
            console.warn(
              `[${net.symbol}] fetchNetworkAssets failed for ${activeNetworkId} (${address}). `
              + 'Bridge token reads require eth_call to be allowed for this chain.',
              err
            )
          }
          return
        }

        if (activeModelId === 'tron') {
          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })
          try {
            const serverOwner = await normalizeServerAddress(net, address)
            const rows = await fetchBridgeTokenBalances(rpcConfig, {
              coin: 'tron',
              chain: 'main',
              owner: serverOwner || undefined,
              wallet: String(net.rpcWallet || '').trim() || undefined
            })
            const assets: Record<string, number> = {}
            const labels: Record<string, string> = {}
            const usedKeys = new Set<string>()

            for (const row of rows) {
              const tokenType = String(row.tokenType || '').trim().toLowerCase()
              if (tokenType.includes('721') || tokenType.includes('1155') || tokenType.includes('nft')) continue

              const rawBalanceText = String(row.balanceRaw || '').trim()
              if (!/^\d+$/.test(rawBalanceText)) continue
              const rawBalance = BigInt(rawBalanceText)
              if (rawBalance <= 0n) continue

              const decimalsRaw = Number(row.decimals)
              const decimals = Number.isInteger(decimalsRaw) && decimalsRaw >= 0 && decimalsRaw <= 30 ? decimalsRaw : 18
              const displaySats = toAssetDisplaySats(rawBalance, decimals)
              if (!Number.isFinite(displaySats) || displaySats <= 0) continue

              const baseSymbol = String(row.symbol || row.name || row.tokenId || 'TOKEN').trim().toUpperCase()
              let key = baseSymbol
              if (usedKeys.has(key)) {
                let suffix = 2
                while (usedKeys.has(`${baseSymbol} #${suffix}`)) suffix += 1
                key = `${baseSymbol} #${suffix}`
              }
              usedKeys.add(key)
              assets[key] = displaySats
              labels[key] = baseSymbol
            }

            set((state) => buildScopedAssetStateUpdate(state, requestAccountId, requestNetworkId, {
              assets,
              logos: {},
              labels,
              evmNfts: {}
            }))

            networkAssetsCache.get(
              cacheKey,
              async () => ({ assets, logos: {}, labels }),
              undefined,
              { force: true }
            ).catch(() => {})
          } catch {
            set((state) => buildScopedAssetStateUpdate(state, requestAccountId, requestNetworkId, {
              assets: {},
              logos: {},
              labels: {},
              evmNfts: {}
            }))
          }
          return
        }

        if (activeModelId === 'xlm') {
          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })
          try {
            const rows = await fetchBridgeTokenBalances(rpcConfig, {
              coin: 'stellar',
              chain: 'main',
              owner: address,
              wallet: String(net.rpcWallet || '').trim() || undefined
            })
            const assets: Record<string, number> = {}
            const labels: Record<string, string> = {}
            for (const row of rows) {
              const tokenId = String(row.tokenId || '').trim()
              const tokenType = String(row.tokenType || '').trim().toLowerCase()
              if (!tokenId || tokenType === 'native' || tokenId.toLowerCase() === 'native') continue

              const rawBalanceText = String(row.balanceRaw || '').trim()
              let displaySats = 0
              if (/^\d+$/.test(rawBalanceText)) {
                const decimalsRaw = Number(row.decimals)
                const decimals = Number.isInteger(decimalsRaw) && decimalsRaw >= 0 && decimalsRaw <= 18 ? decimalsRaw : 7
                displaySats = toAssetDisplaySats(BigInt(rawBalanceText), decimals)
              } else {
                const balanceUiText = String(row.balance || '0').trim()
                if (!/^\d+(\.\d+)?$/.test(balanceUiText)) continue
                const qty = Number(balanceUiText)
                if (!Number.isFinite(qty) || qty <= 0) continue
                displaySats = Math.round(qty * 1e8)
              }
              if (!Number.isFinite(displaySats) || displaySats <= 0) continue

              assets[tokenId] = displaySats
              labels[tokenId] = String(row.symbol || row.name || tokenId).trim() || tokenId
            }

            set((state) => buildScopedAssetStateUpdate(state, requestAccountId, requestNetworkId, {
              assets,
              logos: {},
              labels,
              evmNfts: {}
            }))

            networkAssetsCache.get(
              cacheKey,
              async () => ({ assets, logos: {}, labels }),
              undefined,
              { force: true }
            ).catch(() => {})
          } catch (err) {
            console.warn(`[${net.symbol}] fetchNetworkAssets (Stellar) failed:`, err)
          }
          return
        }

        if (activeModelId === 'ada') {
          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })
          try {
            const rows = await fetchBridgeTokenBalances(rpcConfig, {
              coin: 'cardano',
              chain: 'main',
              owner: address,
              wallet: String(net.rpcWallet || '').trim() || undefined
            })
            const assets: Record<string, number> = {}
            for (const row of rows) {
              const tokenId = String(row.tokenId || '').trim()
              if (!tokenId) continue
              const rawQtyText = String(row.balanceRaw || row.balance || '0').trim()
              if (!/^\d+(\.\d+)?$/.test(rawQtyText)) continue
              const qty = Number(rawQtyText)
              if (!Number.isFinite(qty) || qty <= 0) continue
              // UI asset renderer expects sat-like integer scale.
              assets[tokenId] = Math.round(qty * 1e8)
            }
            set((state) => buildScopedAssetStateUpdate(state, requestAccountId, requestNetworkId, {
              assets,
              logos: {},
              labels: {},
              evmNfts: {}
            }))

            networkAssetsCache.get(
              cacheKey,
              async () => ({ assets, logos: {}, labels: {} }),
              undefined,
              { force: true }
            ).catch(() => {})
          } catch (err) {
            console.warn(`[${net.symbol}] fetchNetworkAssets (Cardano) failed:`, err)
          }
          return
        }

        if (isCosmosLikeModelId(activeModelId)) {
          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })
          try {
            const cosmosCfg = resolveCosmosNetworkConfig(net)
            const rows = await fetchBridgeTokenBalances(rpcConfig, {
              coin: resolveCosmosBridgeCoinId(net),
              chain: String(net.serverChain || 'main').trim() || 'main',
              owner: address
            })
            const assets: Record<string, number> = {}
            const labels: Record<string, string> = {}
            for (const row of rows) {
              const tokenId = String(row.tokenId || '').trim()
              if (!tokenId) continue
              if (tokenId === cosmosCfg.nativeDenom) continue

              const decimalsRaw = Number(row.decimals)
              const decimals = Number.isInteger(decimalsRaw) && decimalsRaw >= 0 && decimalsRaw <= 30
                ? decimalsRaw
                : cosmosCfg.decimals

              let displaySats = 0
              const balanceRawText = String(row.balanceRaw || '').trim()
              if (/^\d+$/.test(balanceRawText)) {
                displaySats = toAssetDisplaySats(BigInt(balanceRawText), decimals)
              } else {
                const balanceUiText = String(row.balance || '0').trim()
                if (!/^\d+(\.\d+)?$/.test(balanceUiText)) continue
                const qty = Number(balanceUiText)
                if (!Number.isFinite(qty) || qty <= 0) continue
                displaySats = Math.round(qty * 1e8)
              }
              if (!Number.isFinite(displaySats) || displaySats <= 0) continue

              assets[tokenId] = displaySats
              const label = String(row.symbol || row.name || tokenId).trim()
              if (label) labels[tokenId] = label
            }
            set((state) => buildScopedAssetStateUpdate(state, requestAccountId, requestNetworkId, {
              assets,
              logos: {},
              labels,
              evmNfts: {}
            }))

            networkAssetsCache.get(
              cacheKey,
              async () => ({ assets, logos: {}, labels }),
              undefined,
              { force: true }
            ).catch(() => {})
          } catch (err) {
            console.warn(`[${net.symbol}] fetchNetworkAssets (Cosmos) failed:`, err)
          }
          return
        }

        const isSolNetwork =
          activeModelId === 'sol'
          || String(net.coinType || '').trim().toUpperCase() === 'SOL'
          || String(net.serverCoinId || '').trim().toLowerCase().includes('solana')

        if (isSolNetwork) {
          try {
            let rows: Array<{
              tokenId: string
              amountRaw: string
              amountUi: string
              decimals: number
              isNft?: boolean
              tokenType?: string
              symbol?: string
            }> = []

            const env = ((import.meta as any)?.env || {}) as Record<string, unknown>
            const solDirectFallbackFlag = String(env.VITE_SOL_ALLOW_DIRECT_ASSET_RPC_FALLBACK ?? '').trim().toLowerCase()
            const allowDirectAssetRpcFallback =
              solDirectFallbackFlag === '1'
              || solDirectFallbackFlag === 'true'
              || solDirectFallbackFlag === 'yes'
              || solDirectFallbackFlag === 'on'

            try {
              const rpcConfig = await createUtxoRpcConfig(net, {
                secureBridgeSigner: get().signBackendAuthMessage
              })
              const bridgeRows = await fetchBridgeTokenBalances(rpcConfig, {
                coin: String(net.serverCoinId || 'solana').trim() || 'solana',
                chain: String(net.serverChain || 'main').trim() || 'main',
                owner: address,
                wallet: String(net.rpcWallet || '').trim() || undefined
              })
              const normalized: typeof rows = []
              for (const row of bridgeRows) {
                const tokenId = String(row.tokenId || row.tokenAddress || '').trim()
                const amountRaw = String(row.balanceRaw || '').trim()
                if (!tokenId || !/^\d+$/.test(amountRaw)) continue
                const decimals = Number(row.decimals ?? 0)
                normalized.push({
                  tokenId,
                  amountRaw,
                  amountUi: String(row.balance || '0').trim() || '0',
                  decimals: Number.isFinite(decimals) ? Math.max(0, Math.trunc(decimals)) : 0,
                  tokenType: String(row.tokenType || '').trim(),
                  symbol: String(row.symbol || '').trim().toUpperCase() || undefined
                })
              }
              rows = normalized
            } catch {
              rows = []
            }

            if (rows.length === 0 && allowDirectAssetRpcFallback) {
              try {
                const { listSolanaTokenBalances } = await loadSolanaNonCustodialModule()
                const directRows = await listSolanaTokenBalances(net.rpcUrl, address)
                rows = directRows.map((row) => ({
                  tokenId: String(row.tokenId || '').trim(),
                  amountRaw: String(row.amountRaw || '').trim(),
                  amountUi: String(row.amountUi || '').trim(),
                  decimals: Number.isFinite(row.decimals) ? Math.max(0, Math.trunc(row.decimals)) : 0,
                  isNft: Boolean(row.isNft),
                  symbol: String((row as any)?.symbol || '').trim().toUpperCase() || undefined
                }))
              } catch {
                rows = []
              }
            }

            const assets: Record<string, number> = {}
            const logos: Record<string, string> = {}
            const labels: Record<string, string> = {}
            const registry = await getSolanaTokenRegistry()
            for (const row of rows) {
              const tokenId = String(row.tokenId || '').trim()
              const amountRaw = String(row.amountRaw || '').trim()
              if (!tokenId || !/^\d+$/.test(amountRaw)) continue
              const displaySats = toAssetDisplaySats(BigInt(amountRaw), row.decimals)
              if (!Number.isFinite(displaySats) || displaySats <= 0) continue

              const bridgeTokenType = String(row.tokenType || '').trim().toLowerCase()
              const solAssetType = bridgeTokenType.includes('compressed') || bridgeTokenType.includes('cnft')
                ? 'compressed-nft'
                : (row.isNft ? 'spl-nft' : 'spl-token')
              const assetKey = buildSolanaAssetId(tokenId, solAssetType)
              if (!assetKey) continue

              assets[assetKey] = displaySats
              const info = registry[tokenId]
              const onchainSymbol = String(row.symbol || '').trim().toUpperCase()
              const displayTicker = onchainSymbol || String(info?.symbol || '').trim().toUpperCase() || tokenId
              if (solAssetType === 'spl-token') labels[assetKey] = displayTicker
              else if (solAssetType === 'spl-nft') labels[assetKey] = `${displayTicker} (SPL NFT)`
              else labels[assetKey] = `${displayTicker} (Compressed NFT)`
              const logoUri = String(info?.logoURI || '').trim()
              if (logoUri) logos[assetKey] = logoUri
            }
            set((state) => buildScopedAssetStateUpdate(state, requestAccountId, requestNetworkId, {
              assets,
              logos,
              labels,
              evmNfts: {}
            }))

            networkAssetsCache.get(
              cacheKey,
              async () => ({ assets, logos, labels }),
              undefined,
              { force: true }
            ).catch(() => {})
          } catch (err) {
            console.warn(`[${net.symbol}] fetchNetworkAssets (Solana) failed:`, err)
          }
          return
        }

        const rpcConfig = await createUtxoRpcConfig(net, {
          secureBridgeSigner: get().signBackendAuthMessage
        })

        try {
          const assets = await listAssetBalancesByAddress(rpcConfig, address)
          set((state) => buildScopedAssetStateUpdate(state, requestAccountId, requestNetworkId, {
            assets: assets ?? {},
            logos: {},
            labels: {},
            evmNfts: {}
          }))

          networkAssetsCache.get(
            cacheKey,
            async () => ({ assets: assets ?? {}, logos: {}, labels: {} }),
            undefined,
            { force: true }
          ).catch(() => {})
        } catch (err) {
          console.warn(`[${net.symbol}] fetchNetworkAssets failed:`, err)
        }
        } finally {
          if (networkAssetsInFlightByKey.get(cacheKey) === inFlightSignal) {
            networkAssetsInFlightByKey.delete(cacheKey)
          }
          if (resolveInFlight) resolveInFlight()
        }
      },

      fetchAssetDetails: async (assetId) => {
        const normalizedAssetId = String(assetId || '').trim()
        if (!normalizedAssetId) throw new Error('Asset id is required')

        const {
          networks,
          activeNetworkId,
          evmNftAssets,
          networkAssets,
          networkAssetLogos,
          serverCoinCatalog
        } = get()
        const net = networks.find((n) => n.id === activeNetworkId)
        if (!net) throw new Error('Active network not found')
        if (!resolveNetworkCapabilities(net).features.assetLayer) {
          throw new Error('Active network does not support assets')
        }

        const detailsCacheKey = `assetDetails|${activeNetworkId}|${normalizedAssetId}`
        return await assetDetailsCache.get(detailsCacheKey, async () => {

        const modelId = resolveNetworkModelId(net)
        if (modelId === 'tron') {
          const logoUri = String(networkAssetLogos?.[activeNetworkId]?.[normalizedAssetId] || '').trim()
          const hint = extractTronContractFromLogoHint(logoUri)
          const tracked = resolveTrackedTronTokens()
          const trackedMatch = tracked.find((t) => String(t.symbol || '').trim().toUpperCase() === normalizedAssetId.toUpperCase())
          const contract = String(hint || trackedMatch?.contract || '').trim()
          const knownRaw = Number(networkAssets?.[activeNetworkId]?.[normalizedAssetId] ?? 0)
          const amountUi = Number.isFinite(knownRaw) ? (knownRaw / 1e8) : 0
          const explorerBase = String(net.explorerUrl || 'https://tronscan.org').trim().replace(/\/+$/, '')
          const tokenRef = contract ? `${explorerBase}/#/contract/${contract}` : undefined
          return {
            name: normalizedAssetId,
            amount: Number.isFinite(amountUi) ? amountUi : 0,
            units: 0,
            reissuable: false,
            has_ipfs: false,
            ipfs_hash: undefined,
            preview_url: tokenRef || undefined,
            metadata_url: tokenRef || undefined,
            token_id: normalizedAssetId,
            contract_address: contract,
            txid_or_longname: normalizedAssetId,
            ownership_address: ''
          }
        }

        if (net.coinType === 'EVM') {
          const nftLookup = evmNftAssets?.[activeNetworkId] || {}
          const direct = nftLookup[normalizedAssetId]
          const parsedKey = parseEvmNftAssetKey(normalizedAssetId)
          const fallback = parsedKey
            ? {
                address: parsedKey.address,
                tokenId: parsedKey.tokenId,
                standard: parsedKey.standard,
                label: `${parsedKey.standard.toUpperCase()} #${formatTokenIdForLabel(parsedKey.tokenId)} Â· ${shortAddress(parsedKey.address)}`,
                quantityRaw: '1'
              }
            : null
          const nft = direct || fallback
          if (!nft) {
            const modelId = String(net.runtimeModelId || net.id || '').trim().toLowerCase()
            const trackedDefaults = await resolveTrackedEvmTokens(net)
            const trackedFromCatalog = resolveCatalogEvmTrackedTokens(serverCoinCatalog, modelId)
            const trackedTokens = mergeTrackedEvmTokens(trackedDefaults, trackedFromCatalog)
            const alias = parseEvmFungibleAssetAlias(normalizedAssetId)
            const logoUri = String(networkAssetLogos?.[activeNetworkId]?.[normalizedAssetId] || '').trim()
            const knownRaw = Number(networkAssets?.[activeNetworkId]?.[normalizedAssetId] ?? 0)
            const amountUi = Number.isFinite(knownRaw) ? (knownRaw / 1e8) : 0

            let tokenAddress = ''
            if (ethers.isAddress(normalizedAssetId)) {
              tokenAddress = ethers.getAddress(normalizedAssetId)
            } else {
              tokenAddress = extractEvmTokenAddressFromLogoUri(logoUri)
            }
            if (!tokenAddress && alias.symbol) {
              const matches = trackedTokens.filter((token) => String(token.symbol || '').trim().toUpperCase() === alias.symbol)
              if (matches.length > 0) {
                const idx = Math.min(Math.max(alias.ordinal, 1), matches.length) - 1
                tokenAddress = ethers.getAddress(matches[idx].address)
              }
            }

            const explorerBase = String(net.explorerUrl || '').trim().replace(/\/+$/, '')
            const tokenRef = tokenAddress
              ? (explorerBase ? `${explorerBase}/token/${tokenAddress}` : undefined)
              : undefined
            return {
              name: alias.symbol || normalizedAssetId,
              amount: Number.isFinite(amountUi) ? amountUi : 0,
              units: 0,
              reissuable: false,
              has_ipfs: false,
              ipfs_hash: undefined,
              preview_url: tokenRef || logoUri || undefined,
              metadata_url: tokenRef || undefined,
              token_id: normalizedAssetId,
              contract_address: tokenAddress || '',
              txid_or_longname: normalizedAssetId,
              ownership_address: ''
            }
          }

          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })

          const resolveSourceUrls = (uri: string): string[] => {
            const normalized = normalizeAssetUri(uri)
            if (!normalized) return []
            if (/^https?:\/\//i.test(normalized)) return [normalized]
            if (/^data:/i.test(normalized)) return [normalized]
            if (/^ipfs:\/\//i.test(normalized)) {
              const cid = normalized.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '').replace(/^\/+/, '')
              return [
                `https://gateway.pinata.cloud/ipfs/${cid}`,
                `https://ipfs.io/ipfs/${cid}`,
                `https://cloudflare-ipfs.com/ipfs/${cid}`
              ]
            }
            return [normalized]
          }

          const decodeDataJson = (uri: string): Record<string, any> | null => {
            const raw = String(uri || '').trim()
            const m = raw.match(/^data:application\/json(?:;charset=[^;,]+)?(?:;(base64))?,(.*)$/i)
            if (!m) return null
            const payload = String(m[2] || '')
            try {
              const text = m[1] ? atob(payload) : decodeURIComponent(payload)
              const json = JSON.parse(text)
              return json && typeof json === 'object' ? json : null
            } catch {
              return null
            }
          }

          const readUriFromContract = async (): Promise<string> => {
            if (nft.standard === 'erc721') {
              try {
                const data = EVM_ERC721_IFACE.encodeFunctionData('tokenURI', [tokenIdToBigInt(nft.tokenId)])
                const raw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: nft.address, data }, 'latest'])
                const [uri] = EVM_ERC721_IFACE.decodeFunctionResult('tokenURI', String(raw || '0x'))
                return normalizeAssetUri(String(uri || ''))
              } catch {
                // fallback below
              }
            }
            try {
              const data = EVM_ERC1155_IFACE.encodeFunctionData('uri', [tokenIdToBigInt(nft.tokenId)])
              const raw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: nft.address, data }, 'latest'])
              const [uri] = EVM_ERC1155_IFACE.decodeFunctionResult('uri', String(raw || '0x'))
              return renderEip1155Template(String(uri || ''), nft.tokenId)
            } catch {
              // fallback below
            }
            if (nft.standard === 'erc1155') {
              try {
                const data = EVM_ERC721_IFACE.encodeFunctionData('tokenURI', [tokenIdToBigInt(nft.tokenId)])
                const raw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: nft.address, data }, 'latest'])
                const [uri] = EVM_ERC721_IFACE.decodeFunctionResult('tokenURI', String(raw || '0x'))
                return normalizeAssetUri(String(uri || ''))
              } catch {
                // no-op
              }
            }
            return ''
          }

          const metadataUri = await readUriFromContract()
          let metadata: Record<string, any> | null = decodeDataJson(metadataUri)

          if (!metadata && metadataUri) {
            for (const url of resolveSourceUrls(metadataUri)) {
              try {
                const res = await fetch(url)
                if (!res.ok) continue
                const text = await res.text()
                const parsed = JSON.parse(text)
                if (parsed && typeof parsed === 'object') {
                  metadata = parsed as Record<string, any>
                  break
                }
              } catch {
                // try next URL
              }
            }
          }

          const imageUriRaw = String(
            metadata?.image
            || metadata?.image_url
            || metadata?.animation_url
            || metadata?.imageUrl
            || ''
          ).trim()
          const previewUrl = renderEip1155Template(imageUriRaw, nft.tokenId) || metadataUri
          const nameFromMetadata = String(metadata?.name || '').trim()
          const metadataIpfs = /^ipfs:\/\//i.test(metadataUri) ? metadataUri : ''
          const previewIpfs = /^ipfs:\/\//i.test(previewUrl) ? previewUrl : ''

          return {
            name: nameFromMetadata || nft.label,
            amount: Number(nft.quantityRaw || '0'),
            units: 0,
            reissuable: false,
            has_ipfs: Boolean(previewIpfs || metadataIpfs),
            ipfs_hash: previewIpfs || metadataIpfs || undefined,
            preview_url: previewUrl || undefined,
            metadata_url: metadataUri || undefined,
            token_id: nft.tokenId,
            contract_address: nft.address,
            token_standard: nft.standard,
            txid_or_longname: normalizedAssetId,
            ownership_address: ''
          }
        }

        if (String(net.runtimeModelId || net.id || '').trim().toLowerCase() === 'ada') {
          const {
            accounts,
            activeAccountId,
            networkAssets
          } = get()
          const activeAcc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
          const owner = String(activeAcc?.networkAddresses?.[activeNetworkId] || '').trim()
          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })
          const rows = await fetchBridgeTokenBalances(rpcConfig, {
            coin: 'cardano',
            chain: 'main',
            owner: owner || undefined,
            wallet: String(net.rpcWallet || '').trim() || undefined,
            tokenId: normalizedAssetId
          })
          const row = rows.find((r) => String(r.tokenId || '').trim() === normalizedAssetId)
          const [policy = '', assetName = ''] = normalizedAssetId.split('.', 2)
          const knownRaw = Number((networkAssets?.[activeNetworkId]?.[normalizedAssetId] ?? 0))
          const amountUi = knownRaw > 0 ? (knownRaw / 1e8) : Number(String(row?.balanceRaw || row?.balance || '0'))
          const cardanoTokenRef = `https://cardanoscan.io/token/${encodeURIComponent(normalizedAssetId)}`
          return {
            name: String(row?.name || row?.symbol || normalizedAssetId).trim(),
            amount: Number.isFinite(amountUi) ? amountUi : 0,
            units: 0,
            reissuable: false,
            has_ipfs: false,
            ipfs_hash: undefined,
            preview_url: cardanoTokenRef,
            metadata_url: cardanoTokenRef,
            token_id: normalizedAssetId,
            contract_address: '',
            txid_or_longname: normalizedAssetId,
            ownership_address: policy || assetName || ''
          } as RtmAssetDetails
        }

        if (String(net.runtimeModelId || net.id || '').trim().toLowerCase() === 'xlm') {
          const {
            accounts,
            activeAccountId,
            networkAssets
          } = get()
          const activeAcc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
          const owner = String(activeAcc?.networkAddresses?.[activeNetworkId] || '').trim()
          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })
          const rows = await fetchBridgeTokenBalances(rpcConfig, {
            coin: 'stellar',
            chain: 'main',
            owner: owner || undefined,
            wallet: String(net.rpcWallet || '').trim() || undefined,
            tokenId: normalizedAssetId
          })
          const row = rows.find((r) => String(r.tokenId || '').trim() === normalizedAssetId)
          const knownRaw = Number((networkAssets?.[activeNetworkId]?.[normalizedAssetId] ?? 0))
          const amountUi = knownRaw > 0 ? (knownRaw / 1e8) : Number(String(row?.balance || row?.balanceRaw || '0'))
          const tokenRef = `https://stellar.expert/explorer/public/asset/${encodeURIComponent(normalizedAssetId)}`
          return {
            name: String(row?.name || row?.symbol || normalizedAssetId).trim(),
            amount: Number.isFinite(amountUi) ? amountUi : 0,
            units: 0,
            reissuable: false,
            has_ipfs: false,
            ipfs_hash: undefined,
            preview_url: tokenRef,
            metadata_url: tokenRef,
            token_id: normalizedAssetId,
            contract_address: '',
            txid_or_longname: normalizedAssetId,
            ownership_address: String(row?.issuer || '').trim()
          } as RtmAssetDetails
        }

        if (isCosmosLikeModelId(String(net.runtimeModelId || net.id || '').trim().toLowerCase())) {
          const {
            accounts,
            activeAccountId,
            networkAssets
          } = get()
          const activeAcc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
          const owner = String(activeAcc?.networkAddresses?.[activeNetworkId] || '').trim()
              const rpcConfig = await createUtxoRpcConfig(net, {
                secureBridgeSigner: get().signBackendAuthMessage
              })
          const rows = await fetchBridgeTokenBalances(rpcConfig, {
            coin: resolveCosmosBridgeCoinId(net),
            chain: String(net.serverChain || 'main').trim() || 'main',
            owner: owner || undefined,
            tokenId: normalizedAssetId
          })
          const row = rows.find((r) => String(r.tokenId || '').trim() === normalizedAssetId)
          const knownRaw = Number((networkAssets?.[activeNetworkId]?.[normalizedAssetId] ?? 0))
          const amountUi = knownRaw > 0 ? (knownRaw / 1e8) : Number(String(row?.balanceRaw || row?.balance || '0'))
          return {
            name: String(row?.name || row?.symbol || normalizedAssetId).trim(),
            amount: Number.isFinite(amountUi) ? amountUi : 0,
            units: 0,
            reissuable: false,
            has_ipfs: false,
            ipfs_hash: undefined,
            preview_url: undefined,
            metadata_url: undefined,
            token_id: normalizedAssetId,
            contract_address: '',
            txid_or_longname: normalizedAssetId,
            ownership_address: String(row?.issuer || '').trim()
          } as RtmAssetDetails
        }

        if (String(net.runtimeModelId || net.id || '').trim().toLowerCase() === 'sol') {
          const knownRaw = Number(networkAssets?.[activeNetworkId]?.[normalizedAssetId] ?? 0)
          const amountUi = Number.isFinite(knownRaw) ? (knownRaw / 1e8) : 0
          const explorerBase = String(net.explorerUrl || 'https://solscan.io').trim().replace(/\/+$/, '')
          const mint = extractSolanaMintFromAssetId(normalizedAssetId)
          const tokenRef = mint ? `${explorerBase}/token/${encodeURIComponent(mint)}` : undefined

          let symbol = ''
          let logoUri = ''
          try {
            const registry = await getSolanaTokenRegistry()
            const info = registry[mint]
            symbol = String(info?.symbol || '').trim().toUpperCase()
            logoUri = String(info?.logoURI || '').trim()
          } catch {
            // ignore registry failures
          }

          return {
            name: symbol || mint || normalizedAssetId,
            amount: Number.isFinite(amountUi) ? amountUi : 0,
            units: 0,
            reissuable: false,
            has_ipfs: false,
            ipfs_hash: undefined,
            preview_url: logoUri || tokenRef,
            metadata_url: tokenRef,
            token_id: normalizedAssetId,
            contract_address: mint,
            txid_or_longname: normalizedAssetId,
            ownership_address: ''
          } as RtmAssetDetails
        }

        const rpcConfig = await createUtxoRpcConfig(net, {
          secureBridgeSigner: get().signBackendAuthMessage
        })
        const splitMatch = normalizedAssetId.match(/^([^|/#:]+)[|/#:]([^|/#:]+)$/)
        const rootPart = splitMatch?.[1]?.trim() || ''
        const subPart = splitMatch?.[2]?.trim() || ''

        const candidates = Array.from(new Set([
          normalizedAssetId,
          normalizedAssetId.includes('|') ? normalizedAssetId.replace('|', '/') : normalizedAssetId,
          normalizedAssetId.includes('/') ? normalizedAssetId.replace('/', '|') : normalizedAssetId,
          normalizedAssetId.includes('|') ? normalizedAssetId.replace('|', '#') : normalizedAssetId,
          normalizedAssetId.includes('/') ? normalizedAssetId.replace('/', '#') : normalizedAssetId,
          normalizedAssetId.includes('#') ? normalizedAssetId.replace('#', '/') : normalizedAssetId,
          normalizedAssetId.includes('#') ? normalizedAssetId.replace('#', '|') : normalizedAssetId,
          (rootPart && subPart) ? `${rootPart}${subPart}` : normalizedAssetId,
          normalizedAssetId.toUpperCase(),
          ((rootPart && subPart) ? `${rootPart}/${subPart}` : normalizedAssetId).toUpperCase(),
          ((rootPart && subPart) ? `${rootPart}|${subPart}` : normalizedAssetId).toUpperCase(),
          ((rootPart && subPart) ? `${rootPart}#${subPart}` : normalizedAssetId).toUpperCase(),
          ((rootPart && subPart) ? `${rootPart}${subPart}` : normalizedAssetId).toUpperCase()
        ]))

        for (const candidate of candidates) {
          try {
            const details = await getAssetDetailsByName(rpcConfig, candidate)
            if (details) return details
          } catch {
            // try next candidate
          }
        }

        throw new Error(`Asset metadata not found for "${normalizedAssetId}". Tried: ${candidates.join(', ')}`)
        })
      },

      getSendableItems: (options) => {
        const {
          networks,
          activeNetworkId,
          accounts,
          activeAccountId,
          networkAssets,
          networkAssetLogos,
          networkAssetLabels,
          evmNftAssets,
          accountNetworkAssets,
          accountNetworkAssetLogos,
          accountNetworkAssetLabels,
          accountNetworkEvmNftAssets,
          sendListPreferences
        } = get()

        const requestedNetworkId = normalizeNetworkIdAlias(String(options?.networkId || activeNetworkId || '').trim())
        const requestedAccountId = String(options?.accountId || activeAccountId || '').trim()
        const network = networks.find((n) => n.id === requestedNetworkId)
        const account = accounts.find((a) => a.id === requestedAccountId) || accounts[0]
        if (!network || !account) return []

        const includeHidden = options?.includeHidden === true
        const includeZeroBalance = options?.includeZeroBalance === true
        const scopeKey = buildSendListPreferenceScopeKey(account.id, requestedNetworkId)
        const preferenceBucket = normalizeSendListPreferenceBucket(sendListPreferences?.[scopeKey])

        const byId = new Map<string, SendableItem>()
        const aliases = new Map<string, string>()

        const linkAlias = (alias: string, id: string) => {
          const raw = String(alias || '').trim()
          if (!raw) return
          aliases.set(raw, id)
          const normalized = normalizeSendListEntryId(raw)
          if (normalized) aliases.set(normalized, id)
        }

        const addOrMergeItem = (row: SendableItem, entryAliases: string[] = []) => {
          const existing = byId.get(row.id)
          if (!existing) {
            byId.set(row.id, row)
          } else {
            const mergedRaw = Math.max(0, Math.round(Number(existing.rawAmount || 0) + Number(row.rawAmount || 0)))
            byId.set(row.id, {
              ...existing,
              assetId: existing.assetId || row.assetId,
              symbol: existing.symbol || row.symbol,
              label: (existing.label && existing.label !== existing.assetId) ? existing.label : row.label,
              logoUrl: existing.logoUrl || row.logoUrl,
              rawAmount: mergedRaw,
              amount: formatUnits8(mergedRaw / 1e8)
            })
          }

          linkAlias(row.id, row.id)
          if (row.assetId) {
            linkAlias(row.assetId, row.id)
            linkAlias(buildAssetSendEntryId(row.assetId), row.id)
          }
          for (const alias of entryAliases) linkAlias(alias, row.id)
        }

        const nativeEntryId = buildNativeSendEntryId(requestedNetworkId)
        const nativeBalanceText = String(
          account.networkBalances?.[requestedNetworkId]
          || account.balance
          || '0'
        )
        const nativeRaw = toRawSatsLike(nativeBalanceText)
        const nativeRow: SendableItem = {
          id: nativeEntryId,
          requestType: 'native',
          kind: 'native',
          networkId: requestedNetworkId,
          accountId: account.id,
          symbol: String(network.symbol || '').trim().toUpperCase() || String(network.name || '').trim() || 'NATIVE',
          label: String(network.symbol || '').trim().toUpperCase() || String(network.name || '').trim() || 'Native',
          logoUrl: String(network.logo || '').trim() || undefined,
          amount: formatUnits8(nativeRaw / 1e8),
          rawAmount: nativeRaw,
          pinned: false,
          hidden: false
        }
        addOrMergeItem(nativeRow, [requestedNetworkId])

        const isActiveScope = requestedAccountId === String(activeAccountId || '').trim()
        const rawAssets = getScopedAssetBucket(accountNetworkAssets, account.id, requestedNetworkId)
          || (isActiveScope ? (networkAssets?.[requestedNetworkId] || {}) : {})
        const rawLogos = getScopedAssetBucket(accountNetworkAssetLogos, account.id, requestedNetworkId)
          || (isActiveScope ? (networkAssetLogos?.[requestedNetworkId] || {}) : {})
        const rawLabels = getScopedAssetBucket(accountNetworkAssetLabels, account.id, requestedNetworkId)
          || (isActiveScope ? (networkAssetLabels?.[requestedNetworkId] || {}) : {})
        const nftLookup = getScopedAssetBucket(accountNetworkEvmNftAssets, account.id, requestedNetworkId)
          || (isActiveScope ? (evmNftAssets?.[requestedNetworkId] || {}) : {})

        for (const [assetIdRaw, rawAmountValue] of Object.entries(rawAssets)) {
          const assetId = String(assetIdRaw || '').trim()
          if (!assetId) continue
          const rawAmount = Math.max(0, Math.round(Number(rawAmountValue || 0)))
          if (!includeZeroBalance && rawAmount <= 0) continue

          const logoUri = String(rawLogos?.[assetId] || '').trim()
          const normalizedId = resolveSendListAssetEntryId({
            network,
            assetId,
            logoUri
          })
          if (!normalizedId) continue

          const evmNft = parseEvmNftAssetKey(assetId)
          const solNftLike = /^SOLNFT:/i.test(assetId)
          const kind: SendableItemKind = (evmNft || solNftLike) ? 'nft' : 'fungible'
          const label = String(nftLookup?.[assetId]?.label || rawLabels?.[assetId] || assetId).trim() || assetId
          const symbol = kind === 'nft'
            ? 'NFT'
            : (String(rawLabels?.[assetId] || '').trim() || assetId)

          addOrMergeItem({
            id: normalizedId,
            assetId,
            requestType: 'asset',
            kind,
            networkId: requestedNetworkId,
            accountId: account.id,
            symbol,
            label,
            logoUrl: logoUri || getTokenLogoForAsset(label) || undefined,
            amount: formatUnits8(rawAmount / 1e8),
            rawAmount,
            pinned: false,
            hidden: false
          })
        }

        const resolvePreferredId = (value: string): string => {
          const raw = String(value || '').trim()
          if (!raw) return ''
          const normalized = normalizeSendListEntryId(raw)
          return aliases.get(raw) || aliases.get(normalized) || normalized
        }

        const orderedIds = normalizeIdList(preferenceBucket.order).map(resolvePreferredId).filter(Boolean)
        const pinnedIds = normalizeIdList(preferenceBucket.pinned).map(resolvePreferredId).filter(Boolean)
        const hiddenIds = normalizeIdList(preferenceBucket.hidden).map(resolvePreferredId).filter(Boolean)
        const rankById = new Map<string, number>()
        for (const id of orderedIds) {
          if (rankById.has(id)) continue
          rankById.set(id, rankById.size)
        }
        const pinnedSet = new Set<string>(pinnedIds)
        const hiddenSet = new Set<string>(hiddenIds)

        const rows = [...byId.values()].map((row) => ({
          ...row,
          pinned: pinnedSet.has(row.id),
          hidden: hiddenSet.has(row.id)
        }))

        const visibleRows = includeHidden
          ? rows
          : rows.filter((row) => !row.hidden || row.kind === 'native')

        visibleRows.sort((a, b) => {
          const rankA = rankById.has(a.id) ? (rankById.get(a.id) as number) : Number.MAX_SAFE_INTEGER
          const rankB = rankById.has(b.id) ? (rankById.get(b.id) as number) : Number.MAX_SAFE_INTEGER
          if (rankA !== rankB) return rankA - rankB
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
          if (a.kind === 'native' && b.kind !== 'native') return -1
          if (b.kind === 'native' && a.kind !== 'native') return 1
          if (b.rawAmount !== a.rawAmount) return b.rawAmount - a.rawAmount
          return a.label.localeCompare(b.label)
        })

        return visibleRows
      },

      setSendListPreferences: (params) => {
        const {
          accounts,
          activeAccountId,
          networks,
          activeNetworkId,
          sendListPreferences
        } = get()

        const accountId = String(params?.accountId || activeAccountId || accounts[0]?.id || '').trim()
        const networkId = normalizeNetworkIdAlias(String(params?.networkId || activeNetworkId || '').trim())
        if (!accountId || !networkId) return
        if (!accounts.some((a) => a.id === accountId)) return
        if (!networks.some((n) => n.id === networkId)) return

        const scopeKey = buildSendListPreferenceScopeKey(accountId, networkId)
        const current = normalizeSendListPreferenceBucket(sendListPreferences?.[scopeKey])
        const next: SendListPreferenceBucket = {
          order: params?.order ? normalizeIdList(params.order) : current.order,
          pinned: params?.pinned ? normalizeIdList(params.pinned) : current.pinned,
          hidden: params?.hidden ? normalizeIdList(params.hidden) : current.hidden
        }

        set((state) => {
          const updated = { ...state.sendListPreferences }
          if (next.order.length === 0 && next.pinned.length === 0 && next.hidden.length === 0) {
            delete updated[scopeKey]
          } else {
            updated[scopeKey] = next
          }
          return { sendListPreferences: updated }
        })
      },

      getNetworkModelPreferences: (networkId) => {
        const { networks, activeNetworkId, networkModelPreferences } = get()
        const resolvedNetworkId = normalizeNetworkIdAlias(String(networkId || activeNetworkId || '').trim())
        const network = networks.find((row) => row.id === resolvedNetworkId)
        return normalizeNetworkModelPreferences(networkModelPreferences?.[resolvedNetworkId], network)
      },

      setNetworkModelPreferences: (params) => {
        const { networks, activeNetworkId } = get()
        const resolvedNetworkId = normalizeNetworkIdAlias(String(params?.networkId || activeNetworkId || '').trim())
        if (!resolvedNetworkId) return
        const network = networks.find((row) => row.id === resolvedNetworkId)
        if (!network) return

        set((state) => {
          const current = normalizeNetworkModelPreferences(state.networkModelPreferences?.[resolvedNetworkId], network)
          const next = normalizeNetworkModelPreferences(
            { ...current, ...(params?.updates || {}) },
            network
          )
          return {
            networkModelPreferences: {
              ...state.networkModelPreferences,
              [resolvedNetworkId]: next
            }
          }
        })
      },

      resetSendListPreferences: (params) => {
        const {
          accounts,
          activeAccountId,
          networks,
          activeNetworkId
        } = get()
        const accountId = String(params?.accountId || activeAccountId || accounts[0]?.id || '').trim()
        const networkId = normalizeNetworkIdAlias(String(params?.networkId || activeNetworkId || '').trim())
        if (!accountId || !networkId) return
        if (!accounts.some((a) => a.id === accountId)) return
        if (!networks.some((n) => n.id === networkId)) return

        const scopeKey = buildSendListPreferenceScopeKey(accountId, networkId)
        set((state) => {
          if (!(scopeKey in state.sendListPreferences)) return state
          const updated = { ...state.sendListPreferences }
          delete updated[scopeKey]
          return { sendListPreferences: updated }
        })
      },

      sendRtmAsset: async ({ assetId, qty, toAddress, memo = '', changeAddress = '', assetChangeAddress = '' }) => {
        await waitForSendOperationSlot()
        const {
          networks, activeNetworkId, isLocked, sessionMnemonic,
          accounts, activeAccountId, serverCoinCatalog, networkAssetLogos
        } = get()

        const net = networks.find(n => n.id === activeNetworkId)
        const acc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
        if (!net) throw new Error('Active network not found')
        if (net.coinType === 'EVM') {
          if (!isExternalEvmSignerEnabled() && (isLocked || !sessionMnemonic)) throw new Error('Wallet is locked')
        } else if (isLocked || !sessionMnemonic) {
          throw new Error('Wallet is locked')
        }
        if (!acc) throw new Error('No active account')
        const modelId = String(net.runtimeModelId || net.id || '').trim().toLowerCase()
        if (!net.coinSymbol) throw new Error('Network missing coinSymbol')
        if (!resolveNetworkCapabilities(net).features.assetSend) {
          throw new Error('Active network does not support asset transfers')
        }

        const accountIndex = resolveDerivationIndex(acc, accounts.findIndex((a) => a.id === acc.id))
        const senderAddress = acc.networkAddresses?.[activeNetworkId]
          || await get().ensureNetworkAddress(activeNetworkId)
        if (!senderAddress) throw new Error(`No address derived for ${net.name}`)

        if (modelId === 'tron') {
          const recipient = String(toAddress || '').trim()
          const normalizedAssetId = String(assetId || '').trim()
          if (!normalizedAssetId) throw new Error('Token id is required')

          const logoUri = String(networkAssetLogos?.[activeNetworkId]?.[normalizedAssetId] || '').trim()
          const hint = extractTronContractFromLogoHint(logoUri)
          const tracked = resolveTrackedTronTokens()
          const trackedMatch = tracked.find((t) => String(t.symbol || '').trim().toUpperCase() === normalizedAssetId.toUpperCase())
          const contract = String(hint || trackedMatch?.contract || '').trim()
          if (!contract) {
            throw new Error(`Unknown TRC20 contract for ${normalizedAssetId}. Configure VITE_TRON_TRACKED_TOKENS.`)
          }

          const { readTrc20TokenMetadata, parseTrc20UiAmountToRaw, sendTrc20NonCustodial } = await loadTronNonCustodialModule()
          const meta = await readTrc20TokenMetadata(net.rpcUrl, contract)
          const amountRaw = parseTrc20UiAmountToRaw(String(qty || '').trim(), meta.decimals)

          const { deriveTronAddress } = await loadTronAddressModule()
          const derived = await deriveTronAddress(sessionMnemonic!, accountIndex)
          if (String(senderAddress || '').trim() !== derived.address) {
            throw new Error(`Active TRX address does not match derived signer address (${senderAddress} != ${derived.address})`)
          }

          const sent = await sendTrc20NonCustodial({
            rpcUrl: net.rpcUrl,
            contractAddress: contract,
            fromAddress: derived.address,
            toAddress: recipient,
            amountRaw,
            privateKeyHex: derived.privHex
          })
          await get().fetchNetworkAssets()
          return { txid: sent.hash }
        }

        if (net.coinType === 'EVM') {
          const recipient = String(toAddress || '').trim()
          if (!ethers.isAddress(recipient)) throw new Error('Invalid EVM recipient address')

          const normalizedAssetId = String(assetId || '').trim()
          if (!normalizedAssetId) throw new Error('Token id is required')
          const nft = parseEvmNftAssetKey(normalizedAssetId)
          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })
          const modelPreferences = get().getNetworkModelPreferences(activeNetworkId)
          const externalSigner = isExternalEvmSignerEnabled() ? await resolveEvmExternalSigner() : null
          if (isExternalEvmSignerEnabled() && !externalSigner) {
            throw new Error('External EVM signer is not available')
          }
          const wallet = externalSigner ? null : deriveEvmWallet(sessionMnemonic!, accountIndex)
          const fromAddress = externalSigner
            ? await externalSigner.getAddress()
            : String(wallet!.address || '').trim()
          const chainIdHex = await callBridgeMethod(rpcConfig, 'eth_chainId', [])
          const resolvedChainId = Number(BigInt(String(chainIdHex || net.chainId || 1)))
          const expectedChainId = Number(net.chainId || 0)
          if (Number.isFinite(expectedChainId) && expectedChainId > 0 && resolvedChainId !== expectedChainId) {
            throw new Error(
              `Bridge/RPC chain mismatch: selected ${net.name} expects chainId ${expectedChainId}, got ${resolvedChainId}. ` +
              'Stop and verify bridge coin/chain routing before sending.'
            )
          }
          const nonceHex = externalSigner
            ? '0x0'
            : await callBridgeMethod(rpcConfig, 'eth_getTransactionCount', [fromAddress, 'pending'])
          const assertContractDeployedOnActiveChain = async (contractAddress: string, label: string) => {
            const codeRaw = await callBridgeMethod(rpcConfig, 'eth_getCode', [contractAddress, 'latest'])
            const code = String(codeRaw || '').trim().toLowerCase()
            if (!code || code === '0x' || /^0x0+$/i.test(code)) {
              throw new Error(
                `${label} contract is not deployed on ${net.name} (chainId ${resolvedChainId}). ` +
                'Use the correct contract address for this network.'
              )
            }
          }

          if (nft) {
            const tokenAddress = ethers.getAddress(nft.address)
            await assertContractDeployedOnActiveChain(tokenAddress, 'NFT')
            let transferData = ''
            let relayAmount = '1'

            if (nft.standard === 'erc721') {
              const qtyText = String(qty || '').trim()
              if (qtyText && qtyText !== '1') {
                throw new Error('ERC721 transfer quantity must be exactly 1')
              }
              const ownerData = EVM_ERC721_IFACE.encodeFunctionData('ownerOf', [tokenIdToBigInt(nft.tokenId)])
              const ownerRaw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: tokenAddress, data: ownerData }, 'latest'])
              const [owner] = EVM_ERC721_IFACE.decodeFunctionResult('ownerOf', String(ownerRaw || '0x'))
              if (String(owner || '').trim().toLowerCase() !== fromAddress.toLowerCase()) {
                throw new Error(`ERC721 token ${nft.tokenId} is not owned by active address ${fromAddress}`)
              }
              transferData = EVM_ERC721_IFACE.encodeFunctionData('safeTransferFrom', [
                fromAddress,
                recipient,
                tokenIdToBigInt(nft.tokenId)
              ])
              relayAmount = '1'
            } else {
              const qtyText = String(qty || '').trim()
              if (!/^\d+$/.test(qtyText) || BigInt(qtyText) <= 0n) {
                throw new Error('ERC1155 transfer quantity must be a positive integer')
              }
              const quantity = BigInt(qtyText)
              const balanceData = EVM_ERC1155_IFACE.encodeFunctionData('balanceOf', [fromAddress, tokenIdToBigInt(nft.tokenId)])
              const balanceRaw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: tokenAddress, data: balanceData }, 'latest'])
              const [ownedRaw] = EVM_ERC1155_IFACE.decodeFunctionResult('balanceOf', String(balanceRaw || '0x'))
              const owned = BigInt(String(ownedRaw || '0'))
              if (owned < quantity) {
                throw new Error(`Insufficient ERC1155 balance for token ${nft.tokenId}. Available ${owned}, requested ${quantity}`)
              }
              transferData = EVM_ERC1155_IFACE.encodeFunctionData('safeTransferFrom', [
                fromAddress,
                recipient,
                tokenIdToBigInt(nft.tokenId),
                quantity,
                '0x'
              ])
              relayAmount = qtyText
            }

            const feeQuote = await estimateEvmTxFee({
              rpcConfig,
              from: fromAddress,
              to: tokenAddress,
              data: transferData,
              valueWei: 0n,
              fallbackGasLimitHex: '0x30d40',
              lane: modelPreferences.evmGasLane
            })

            if (externalSigner) {
              const sent = await externalSigner.sendTransaction({
                chainId: resolvedChainId,
                to: tokenAddress,
                valueWei: 0n,
                data: transferData,
                gasLimit: feeQuote.gasLimit,
                gasPrice: feeQuote.gasPrice,
                maxFeePerGas: feeQuote.maxFeePerGas,
                maxPriorityFeePerGas: feeQuote.maxPriorityFeePerGas,
                type: feeQuote.type
              })
              await get().fetchNetworkAssets()
              return { txid: sent.hash }
            }

            const txToSign: any = {
              to: tokenAddress,
              value: 0n,
              nonce: Number(BigInt(String(nonceHex || '0x0'))),
              gasLimit: feeQuote.gasLimit,
              chainId: resolvedChainId,
              data: transferData
            }
            if (feeQuote.type === 2) {
              txToSign.type = 2
              txToSign.maxFeePerGas = feeQuote.maxFeePerGas
              txToSign.maxPriorityFeePerGas = feeQuote.maxPriorityFeePerGas
            } else {
              txToSign.gasPrice = feeQuote.gasPrice ?? 1_000_000_000n
            }
            const signedTx = await wallet!.signTransaction(txToSign)
            const sent = await sendBridgeTokenTransfer(rpcConfig, {
              tokenId: nft ? `${tokenAddress}:${nft.tokenId}` : tokenAddress,
              toAddress: recipient,
              amount: relayAmount,
              fromAddress,
              signedTxHex: signedTx,
              signedFormat: 'evm-raw-hex'
            })
            const sentHash = String(sent.txid || '').trim()
            if (!sentHash) throw new Error('EVM token transfer broadcast returned no transaction hash')
            await get().fetchNetworkAssets()
            return { txid: sentHash }
          }

          const alias = parseEvmFungibleAssetAlias(normalizedAssetId)
          const modelId = String(net.runtimeModelId || net.id || '').trim().toLowerCase()
          const trackedDefaults = await resolveTrackedEvmTokens(net)
          const trackedFromCatalog = resolveCatalogEvmTrackedTokens(serverCoinCatalog, modelId)
          const trackedTokens = mergeTrackedEvmTokens(trackedDefaults, trackedFromCatalog)
          const logoUri = String(networkAssetLogos?.[activeNetworkId]?.[normalizedAssetId] || '').trim()

          const exactAddress = ethers.isAddress(normalizedAssetId)
            ? ethers.getAddress(normalizedAssetId)
            : ''
          let tokenAddress = exactAddress || extractEvmTokenAddressFromLogoUri(logoUri)
          if (!tokenAddress) {
            const matches = trackedTokens.filter((token) =>
              String(token.symbol || '').trim().toUpperCase() === alias.symbol
            )
            if (matches.length === 0) {
              throw new Error(`No tracked token contract found for "${normalizedAssetId}" on ${net.name}`)
            }
            if (alias.ordinal > matches.length) {
              throw new Error(`No tracked token contract found for "${normalizedAssetId}" on ${net.name}`)
            }
            if (matches.length > 1 && alias.ordinal === 1 && !/-\d+$/.test(normalizedAssetId)) {
              throw new Error(`Multiple token contracts match "${normalizedAssetId}". Use contract address or the asset key suffix (e.g. -2).`)
            }
            tokenAddress = ethers.getAddress(matches[Math.max(0, alias.ordinal - 1)].address)
          }
          await assertContractDeployedOnActiveChain(tokenAddress, 'Token')

          let decimals = 18
          try {
            const data = EVM_ERC20_TRANSFER_IFACE.encodeFunctionData('decimals', [])
            const raw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: tokenAddress, data }, 'latest'])
            const [value] = EVM_ERC20_TRANSFER_IFACE.decodeFunctionResult('decimals', String(raw || '0x'))
            const n = Number(value)
            if (Number.isFinite(n) && n >= 0 && n <= 30) decimals = Math.trunc(n)
          } catch {
            // Keep default 18
          }

          const amountRaw = ethers.parseUnits(String(qty || '').trim(), decimals)
          if (amountRaw <= 0n) throw new Error('Token amount must be greater than 0')
          const transferData = EVM_ERC20_TRANSFER_IFACE.encodeFunctionData('transfer', [recipient, amountRaw])
          const feeQuote = await estimateEvmTxFee({
            rpcConfig,
            from: fromAddress,
            to: tokenAddress,
            data: transferData,
            valueWei: 0n,
            fallbackGasLimitHex: '0x186a0',
            lane: modelPreferences.evmGasLane
          })
          if (externalSigner) {
            const sent = await externalSigner.sendTransaction({
              chainId: resolvedChainId,
              to: tokenAddress,
              valueWei: 0n,
              data: transferData,
              gasLimit: feeQuote.gasLimit,
              gasPrice: feeQuote.gasPrice,
              maxFeePerGas: feeQuote.maxFeePerGas,
              maxPriorityFeePerGas: feeQuote.maxPriorityFeePerGas,
              type: feeQuote.type
            })
            await get().fetchNetworkAssets()
            return { txid: sent.hash }
          }

          const txToSign: any = {
            to: tokenAddress,
            value: 0n,
            nonce: Number(BigInt(String(nonceHex || '0x0'))),
            gasLimit: feeQuote.gasLimit,
            chainId: resolvedChainId,
            data: transferData
          }
          if (feeQuote.type === 2) {
            txToSign.type = 2
            txToSign.maxFeePerGas = feeQuote.maxFeePerGas
            txToSign.maxPriorityFeePerGas = feeQuote.maxPriorityFeePerGas
          } else {
            txToSign.gasPrice = feeQuote.gasPrice ?? 1_000_000_000n
          }
          const signedTx = await wallet!.signTransaction(txToSign)
          const sent = await sendBridgeTokenTransfer(rpcConfig, {
            tokenId: tokenAddress,
            toAddress: recipient,
            amount: String(qty || '').trim(),
            fromAddress,
            signedTxHex: signedTx,
            signedFormat: 'evm-raw-hex'
          })
          const sentHash = String(sent.txid || '').trim()
          if (!sentHash) throw new Error('EVM token transfer broadcast returned no transaction hash')
          await get().fetchNetworkAssets()
          return { txid: sentHash }
        }

        if (modelId === 'sol') {
          const tokenId = String(assetId || '').trim()
          const recipient = String(toAddress || '').trim()
          if (!tokenId) throw new Error('SPL token mint address is required')
          if (!recipient) throw new Error('Solana recipient address is required')

          const { deriveSolanaAddress } = await loadSolanaAddressModule()
          const derived = await deriveSolanaAddress(sessionMnemonic!, accountIndex)
          if (String(senderAddress || '').trim() !== derived.address) {
            throw new Error(`Active SOL address does not match derived signer address (${senderAddress} != ${derived.address})`)
          }

          const { sendSolanaSplTokenNonCustodial } = await loadSolanaNonCustodialModule()
          const tx = await sendSolanaSplTokenNonCustodial({
            rpcUrl: net.rpcUrl,
            fromAddress: derived.address,
            toAddress: recipient,
            assetId: tokenId,
            amount: String(qty || '').trim(),
            privateKeyHex: derived.privHex
          })
          await get().fetchNetworkAssets()
          return { txid: tx.hash }
        }

        if (modelId === 'ada') {
          if (String(assetId || '').indexOf('.') <= 0) {
            throw new Error('Cardano token id must be in policyId.assetName format')
          }
          const tokenAmountRaw = String(qty || '').trim()
          if (!/^\d+$/.test(tokenAmountRaw) || BigInt(tokenAmountRaw) <= 0n) {
            throw new Error('Cardano token send quantity must be a positive integer')
          }
          const { sendCardanoAssetNonCustodial } = await loadCardanoNonCustodialModule()
          const tx = await sendCardanoAssetNonCustodial({
            network: net,
            mnemonic: sessionMnemonic!,
            accountIndex,
            fromAddress: senderAddress,
            toAddress: String(toAddress || '').trim(),
            tokenId: String(assetId || '').trim(),
            tokenAmountRaw,
            walletId: String(net.rpcWallet || '').trim() || undefined
          })
          await get().fetchNetworkAssets()
          return { txid: tx.hash }
        }

        if (isCosmosLikeModelId(modelId)) {
          const recipient = String(toAddress || '').trim()
          const denom = String(assetId || '').trim()
          const txMemo = String(memo || '').trim()
          const contractAsset = parseCosmosContractAssetId(denom)
          if (!recipient) throw new Error('Cosmos recipient address is required')
          if (!denom) throw new Error('Cosmos token denom is required')
          const cosmosCfg = resolveCosmosNetworkConfig(net)
          if (!isCosmosAddressForHrp(recipient, cosmosCfg.hrp)) {
            throw new Error(`Destination address must be a valid ${cosmosCfg.hrp}1... address`)
          }

          const amountRawText = String(qty || '').trim()
          if (!/^\d+$/.test(amountRawText) || BigInt(amountRawText) <= 0n) {
            throw new Error('Cosmos token send quantity must be a positive integer in raw denom units')
          }

          const derived = await deriveCosmosAddress(sessionMnemonic!, accountIndex, cosmosCfg)
          if (String(senderAddress || '').trim() !== derived.address) {
            throw new Error(`Active COSMOS address does not match derived signer address (${senderAddress} != ${derived.address})`)
          }

          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })
          let signedTxBase64 = ''
          if (contractAsset) {
            if (!isCosmosAddressForHrp(contractAsset.contract, cosmosCfg.hrp)) {
              throw new Error(`Cosmos contract address must be a valid ${cosmosCfg.hrp}1... address`)
            }
            if (contractAsset.kind === 'cw20') {
              const executeMsg = {
                transfer: {
                  recipient,
                  amount: amountRawText
                }
              }
              signedTxBase64 = await signCosmosExecuteContractTxBase64({
                rpcUrl: net.rpcUrl,
                fromAddress: derived.address,
                contractAddress: contractAsset.contract,
                executeMsg,
                privateKeyHex: derived.privHex,
                feeDenom: cosmosCfg.feeDenom,
                feeAmountRaw: cosmosCfg.feeAmountRaw,
                gasLimit: cosmosCfg.gasLimit,
                memo: txMemo
              })
            } else {
              if (amountRawText !== '1') {
                throw new Error('CW721 transfer quantity must be exactly 1')
              }
              const executeMsg = {
                transfer_nft: {
                  recipient,
                  token_id: contractAsset.tokenId
                }
              }
              signedTxBase64 = await signCosmosExecuteContractTxBase64({
                rpcUrl: net.rpcUrl,
                fromAddress: derived.address,
                contractAddress: contractAsset.contract,
                executeMsg,
                privateKeyHex: derived.privHex,
                feeDenom: cosmosCfg.feeDenom,
                feeAmountRaw: cosmosCfg.feeAmountRaw,
                gasLimit: cosmosCfg.gasLimit,
                memo: txMemo
              })
            }
          } else {
            signedTxBase64 = await signCosmosTokenTransferTxBase64({
              rpcUrl: net.rpcUrl,
              fromAddress: derived.address,
              toAddress: recipient,
              denom,
              amountRaw: amountRawText,
              privateKeyHex: derived.privHex,
              feeDenom: cosmosCfg.feeDenom,
              feeAmountRaw: cosmosCfg.feeAmountRaw,
              gasLimit: cosmosCfg.gasLimit,
              memo: txMemo
            })
          }
          const sent = await sendBridgeTokenTransfer(rpcConfig, {
            coin: resolveCosmosBridgeCoinId(net),
            chain: String(net.serverChain || 'main').trim() || 'main',
            tokenId: denom,
            toAddress: recipient,
            fromAddress: derived.address,
            amount: amountRawText,
            signedTxHex: signedTxBase64,
            signedFormat: 'cosmos-tx-base64'
          })
          await get().fetchNetworkAssets()
          return { txid: sent.txid }
        }

        const derived = await deriveUtxoAddress(sessionMnemonic!, net.coinSymbol, accountIndex, 0, 0)

        const rpcConfig = await createUtxoRpcConfig(net, {
          secureBridgeSigner: get().signBackendAuthMessage
        })
        const rawFeePerByteCoins = net.feePerByte ?? estimateNetworkFee(net.id, 1) ?? 0.0000002
        let feePerByteSats = Math.max(1, Math.round(Number(rawFeePerByteCoins) * 1e8))
        if (feePerByteSats > 500) feePerByteSats = Math.max(1, Math.round(feePerByteSats / 1000))

        const txid = await sendRtmAssetNonCustodial(rpcConfig, {
          fromAddress: senderAddress,
          fromPrivateKeyHex: derived.privHex,
          assetId,
          qty,
          toAddress,
          changeAddress,
          assetChangeAddress,
          feePerByteSats
        })
        await get().fetchNetworkAssets()
        return { txid }
      },

      sendAssetTransfer: async (params) => {
        return await get().sendRtmAsset(params)
      },

      fullRestore: async ({ backup, backupPassword, newPassword }) => {
        // 1. Verify & decrypt the backup vault with the original password.
        const plain = await decryptVaultV1({ password: backupPassword, vault: backup.vault })
        const normalizedMnemonic = plain.mnemonic.trim()

        // 2. Re-encrypt with the new password.
        const newVault = await encryptVaultV1({ password: newPassword, mnemonic: normalizedMnemonic })

        // 3. Normalize the persisted accounts so they satisfy the Account shape.
        const restoredAccounts = normalizePersistedAccounts(backup.accounts)

        // 4. Re-derive fresh network addresses for every account so they are
        //    guaranteed to match the restored mnemonic.
        const networks = get().networks
        const reHydratedAccounts: Account[] = []
        for (const acc of restoredAccounts) {
          const derived = await deriveAccountAddresses(normalizedMnemonic, networks, acc.derivationIndex)
          reHydratedAccounts.push({
            ...acc,
            addresses: {
              EVM:  derived.addresses.EVM  || acc.addresses?.EVM  || '',
              UTXO: derived.addresses.UTXO || acc.addresses?.UTXO || '',
              BTC:  acc.addresses?.BTC || '',
              COSMOS: derived.addresses.COSMOS || acc.addresses?.COSMOS || '',
              SOL:  acc.addresses?.SOL || '',
              SUI:  derived.addresses.SUI || acc.addresses?.SUI || ''
            },
            networkAddresses: {
              ...(acc.networkAddresses ?? {}),
              ...derived.networkAddresses
            }
          })
        }

        const safeActiveAccountId = reHydratedAccounts.some(a => a.id === backup.activeAccountId)
          ? backup.activeAccountId
          : (reHydratedAccounts[0]?.id ?? null)

        const normalizedBackupNetworkId = normalizeNetworkIdAlias(String(backup.activeNetworkId || ''))
        const restoredActiveNetworkId = networks.some((network) => network.id === normalizedBackupNetworkId)
          ? normalizedBackupNetworkId
          : get().activeNetworkId
        const normalizedActivity = normalizeActivityList(backup.activity, {
          networks,
          accounts: reHydratedAccounts,
          activeNetworkId: restoredActiveNetworkId,
          activeAccountId: safeActiveAccountId
        })

        // 5. Write everything back into the store.
        set({
          isInitialized:    true,
          hasVault:         true,
          isLocked:         false,
          vault:            newVault,
          backupConfirmed:  backup.backupConfirmed ?? true,
          createdAt:        backup.createdAt ?? Date.now(),
          sessionMnemonic:  normalizedMnemonic,
          onboardingCompleted: backup.onboardingCompleted ?? false,
          accounts:         reHydratedAccounts,
          nextAccountIndex: backup.nextAccountIndex ?? reHydratedAccounts.length,
          activeAccountId:  safeActiveAccountId,
          activeNetworkId:  restoredActiveNetworkId,
          activity:         normalizedActivity,
          authorizedSites:  Array.isArray(backup.authorizedSites) ? backup.authorizedSites : [],
          autolockMinutes:  typeof backup.autolockMinutes === 'number' ? backup.autolockMinutes : 5,
          donationPercent:  clampDonationPercent(Number((backup as any).donationPercent ?? MIN_DONATION_PERCENT)),
          networkAssets:    {},
          accountNetworkAssets: {},
          sendListPreferences: normalizeSendListPreferencesRecord(backup.sendListPreferences ?? {}),
          networkModelPreferences: normalizeNetworkModelPreferencesState(backup.networkModelPreferences ?? {}, networks),
          networkAssetLogos: {},
          accountNetworkAssetLogos: {},
          networkAssetLabels: {},
          accountNetworkAssetLabels: {},
          evmNftAssets: {},
          accountNetworkEvmNftAssets: {},
          accountNetworkFiatTotals: {},
          accountNetworkFiatNative: {},
          accountNetworkFiatAssets: {},
          lastActiveTimestamp: Date.now()
        })
      },

      addAuthorizedSite: (origin) => set((state) => {
        const normalizedOrigin = normalizeDappOrigin(origin)
        if (!normalizedOrigin || normalizedOrigin === 'unknown') return state
        if (state.authorizedSites.includes(normalizedOrigin)) return state
        return { authorizedSites: [...state.authorizedSites, normalizedOrigin] }
      }),
      
      removeAuthorizedSite: (origin) => set((state) => {
        const normalizedOrigin = normalizeDappOrigin(origin)
        return {
          authorizedSites: state.authorizedSites.filter((site) => site !== normalizedOrigin && site !== origin)
        }
      }),

      setAutolock: (minutes) => set({ autolockMinutes: minutes }),
      setDonationPercent: (percent) => set({ donationPercent: clampDonationPercent(Number(percent)) }),
      
      updateLastActive: () => set({ lastActiveTimestamp: Date.now() }),
      
      checkAutolock: () => {
        const { lastActiveTimestamp, autolockMinutes, isLocked, isInitialized, lock } = get()
        if (!isInitialized || isLocked) return

        const now = Date.now()
        if (now - lastActiveTimestamp > autolockMinutes * 60 * 1000) {
          lock()
        }
      },

      addActivity: (item) => set((state) => {
        const normalized = normalizeActivityRecord(
          item,
          {
            networks: state.networks,
            accounts: state.accounts,
            activeNetworkId: state.activeNetworkId,
            activeAccountId: state.activeAccountId
          },
          state.activity.length
        )
        if (!normalized) return state
        return { activity: [normalized, ...state.activity] }
      }),

      trackActivityTransactionStatus: ({ txid, networkId }) => {
        const normalizedTxid = String(txid || '').trim()
        const requestedNetworkId = normalizeNetworkIdAlias(String(networkId || '').trim())
        if (!normalizedTxid || !requestedNetworkId) return

        const pollerKey = buildTrackedActivityStatusKey(requestedNetworkId, normalizedTxid)
        if (trackedActivityStatusPollers.has(pollerKey)) return
        trackedActivityStatusPollers.add(pollerKey)

        void (async () => {
          try {
            for (let attempt = 0; attempt < 45; attempt += 1) {
              const state = get()
              const current = state.activity.find((entry) =>
                String(entry.id || '').trim().toLowerCase() === normalizedTxid.toLowerCase()
                && normalizeNetworkIdAlias(String(entry.networkId || '').trim()) === requestedNetworkId
              )
              if (!current || current.status !== 'pending') return

              const net = state.networks.find((entry) => entry.id === requestedNetworkId)
              if (!net) return

              let rpcConfig: UtxoRpcConfig | null = null
              try {
                rpcConfig = await createUtxoRpcConfig(net, {
                  secureBridgeSigner: get().signBackendAuthMessage
                })
              } catch {
                rpcConfig = null
              }

              if (rpcConfig) {
                const status = await checkOnChainTransactionStatus(net, rpcConfig, normalizedTxid)
                if (status === 'confirmed' || status === 'rejected') {
                  set((prev) => ({
                    activity: prev.activity.map((entry) => {
                      const sameTx = String(entry.id || '').trim().toLowerCase() === normalizedTxid.toLowerCase()
                      const sameNetwork = normalizeNetworkIdAlias(String(entry.networkId || '').trim()) === requestedNetworkId
                      return sameTx && sameNetwork ? { ...entry, status } : entry
                    })
                  }))
                  return
                }
              }

              await waitMs(8000)
            }
          } finally {
            trackedActivityStatusPollers.delete(pollerKey)
          }
        })()
      },

      changePassword: (oldPass, newPass) => {
        // Legacy stub: now we store an encrypted vault, so password change requires re-encrypt.
        // Keep return false for now; will be upgraded once vault wiring is complete.
        return false
      },

      addAccount: async (name, networkId) => {
        const { accounts, networks, activeNetworkId, sessionMnemonic, isLocked, nextAccountIndex } = get()
        if (isLocked || !sessionMnemonic) throw new Error('Unlock wallet first to create an account')
        const normalizedName = name.trim()
        if (!normalizedName) throw new Error('Account name is required')
        const selectedNetworkId = networkId || activeNetworkId
        const selectedNetwork = networks.find((n) => n.id === selectedNetworkId)
        if (!selectedNetwork) throw new Error(`Selected network not found: ${selectedNetworkId}`)
        const selectedModelId = resolveNetworkModelId(selectedNetwork)

        const derivationIndex = nextAccountIndex >= 0 ? nextAccountIndex : accounts.length
        const selectedAddress = await deriveSingleNetworkAddress(sessionMnemonic, selectedNetwork, derivationIndex)

        if (!selectedAddress) {
          throw new Error(`Could not derive ${selectedNetwork.symbol} address for account ${normalizedName}`)
        }

        const addresses: Record<CoinType, string> = { EVM: '', UTXO: '', BTC: '', COSMOS: '', SOL: '', SUI: '' }
        if (selectedNetwork.coinType === 'EVM') addresses.EVM = selectedAddress
        if (selectedNetwork.coinType === 'UTXO') addresses.UTXO = selectedAddress
        if (selectedNetwork.coinType === 'COSMOS') addresses.COSMOS = selectedAddress
        if (selectedModelId === 'sol') addresses.SOL = selectedAddress

        const newAccount: Account = {
          id: `acc-${Date.now()}`,
          name: `Account ${derivationIndex + 1}`,
          networkNames: { [selectedNetwork.id]: normalizedName },
          derivationIndex,
          addresses,
          networkAddresses: { [selectedNetwork.id]: selectedAddress },
          networkBalances: { [selectedNetwork.id]: '0' },
          balance: '0'
        }
        set({
          accounts: [...accounts, newAccount],
          activeAccountId: newAccount.id,
          nextAccountIndex: derivationIndex + 1,
          lastActiveTimestamp: Date.now()
        })
        await get().refreshActiveBalance()
      },

      removeAccount: (id) => {
        const { accounts, activeAccountId } = get()
        if (accounts.length <= 1) return // Don't allow removing the last account
        const filtered = accounts.filter(a => a.id !== id)
        const newActiveId = activeAccountId === id 
          ? (filtered[0]?.id || null)
          : activeAccountId
        set({ 
          accounts: filtered,
          activeAccountId: newActiveId
        })
      },

      updateAccount: (id, updates) => {
        set((state) => ({
          accounts: state.accounts.map(acc => 
            acc.id === id ? { ...acc, ...updates } : acc
          )
        }))
      },

      setNetworkAccountName: (accountId, networkId, name) => {
        const normalizedName = String(name || '').trim()
        if (!normalizedName) throw new Error('Account name is required')
        set((state) => ({
          accounts: state.accounts.map((acc) => (
            acc.id === accountId
              ? {
                  ...acc,
                  networkNames: {
                    ...(acc.networkNames ?? {}),
                    [networkId]: normalizedName
                  }
                }
              : acc
          ))
        }))
      },

      setWatchOnlyAddress: (accountId, networkId, address) => {
        const { accounts, networks } = get()
        const net = networks.find((n) => n.id === networkId)
        if (!net) throw new Error(`Unknown network: ${networkId}`)
        if (net.derivation?.status !== 'unsupported') {
          throw new Error(`${net.name} does not require watch-only import`)
        }

        const validation = validateWatchOnlyAddress(net, address)
        if (!validation.ok) throw new Error(validation.error || 'Invalid watch-only address')

        set({
          accounts: accounts.map((acc) => (
            acc.id === accountId
              ? {
                  ...acc,
                  networkAddresses: {
                    ...(acc.networkAddresses ?? {}),
                    [networkId]: validation.normalized
                  }
                }
              : acc
          ))
        })
      },

      addNetwork: (network) => {
        set((state) => {
          const nextNetwork = normalizeNetworkSymbol(network)
          const nextNetworks = [...state.networks, nextNetwork]
          const normalizedDisabled = normalizeDisabledNetworkIdsForState(state.disabledNetworkIds, nextNetworks)
          const enabledCount = nextNetworks.reduce(
            (count, entry) => count + (normalizedDisabled.includes(entry.id) ? 0 : 1),
            0
          )
          return {
            networks: nextNetworks,
            disabledNetworkIds: enabledCount > MAX_ACTIVE_REFRESH_NETWORKS
              ? clampDisabledNetworkIdsToMaxEnabled([...normalizedDisabled, nextNetwork.id], nextNetworks)
              : normalizedDisabled
          }
        })
      },

      removeNetwork: (id) => {
        const { networks, activeNetworkId, disabledNetworkIds } = get()
        if (networks.length <= 1) return // Don't allow removing the last network
        const filtered = networks.filter(n => n.id !== id)
        const nextDisabled = normalizeDisabledNetworkIdsForState(disabledNetworkIds, filtered)
        const preferredNetworkId = activeNetworkId === id
          ? (filtered[0]?.id || DEFAULT_NETWORK_ID)
          : activeNetworkId
        const newActiveId = resolveEnabledNetworkId(filtered, nextDisabled, preferredNetworkId)
        set({
          networks: filtered,
          activeNetworkId: newActiveId,
          disabledNetworkIds: nextDisabled
        })
      },

      updateNetwork: (id, updates) => {
        set((state) => ({
          networks: state.networks.map(net => 
            net.id === id ? normalizeNetworkSymbol({ ...net, ...updates }) : net
          )
        }))
      },

      setNetworkEnabled: (networkId, enabled) => {
        let shouldRefreshActive = false
        let nextActiveNetworkId: string | null = null

        set((state) => {
          const targetId = resolveKnownNetworkId(state.networks, networkId)
          if (!targetId) return state

          const normalizedDisabled = normalizeDisabledNetworkIdsForState(state.disabledNetworkIds, state.networks)
          const disabledSet = new Set(normalizedDisabled)
          const currentlyDisabled = disabledSet.has(targetId)
          if (enabled && !currentlyDisabled) return state
          if (!enabled && currentlyDisabled) return state

          const enabledCount = state.networks.reduce(
            (count, network) => count + (disabledSet.has(network.id) ? 0 : 1),
            0
          )
          if (enabled && enabledCount >= MAX_ACTIVE_REFRESH_NETWORKS) return state
          if (!enabled && enabledCount <= 1) return state

          const nextDisabled = enabled
            ? normalizedDisabled.filter((id) => id !== targetId)
            : [...normalizedDisabled, targetId]
          const nextActiveId = resolveEnabledNetworkId(state.networks, nextDisabled, state.activeNetworkId)
          nextActiveNetworkId = nextActiveId
          shouldRefreshActive = nextActiveId !== state.activeNetworkId

          const activeAccount = state.accounts.find((account) => account.id === state.activeAccountId) || state.accounts[0]
          const nextAccounts = (activeAccount && shouldRefreshActive)
            ? state.accounts.map((account) => (
              account.id === activeAccount.id
                ? { ...account, balance: getCachedBalanceForNetwork(account, nextActiveId, false) }
                : account
            ))
            : state.accounts

          return {
            disabledNetworkIds: nextDisabled,
            activeNetworkId: nextActiveId,
            accounts: nextAccounts,
            lastActiveTimestamp: Date.now()
          }
        })

        if (shouldRefreshActive && nextActiveNetworkId) {
          void (async () => {
            await get().ensureNetworkAddress(nextActiveNetworkId)
            await get().refreshActiveBalance()
            await get().fetchNetworkAssets().catch(() => {})
          })()
        }
      },

      syncNetworksFromServer: async () => {
        let serverNetworks: Network[] | null = null
        let serverCatalog: ServerCoinCatalogItem[] = []
        try {
          const snapshot = await loadServerRegistrySnapshot()
          serverNetworks = snapshot.networks ? normalizeNetworkListSymbols(snapshot.networks) : null
          serverCatalog = normalizeServerCatalogSymbols(
            Array.isArray(snapshot.catalog) ? snapshot.catalog : []
          )
        } catch (error) {
          console.warn('Failed to sync networks from /v1/coins:', error)
          return
        }
        if ((!serverNetworks || serverNetworks.length === 0) && serverCatalog.length === 0) return
        const syncedNetworks = serverNetworks || []

        set((state) => {
          const localBaseline = normalizeNetworkListSymbols(INITIAL_NETWORKS)
          const allowedNetworkIds = new Set(localBaseline.map((n) => String(n.id || '').trim()))
          const filteredServerNetworks = syncedNetworks.filter((network) => {
            const id = String(network.id || '').trim()
            return allowedNetworkIds.has(id)
          })
          const filteredServerCatalog = serverCatalog.filter((item) => {
            const appNetworkId = String(item.appNetworkId || '').trim()
            return Boolean(appNetworkId) && allowedNetworkIds.has(appNetworkId)
          })
          const serverById = new Map(filteredServerNetworks.map((network) => [network.id, network]))
          const mergedLocal = localBaseline.map((localNetwork) => {
            const serverNetwork = serverById.get(localNetwork.id)
            if (!serverNetwork) return localNetwork
            if (FROZEN_STABLE_NETWORK_IDS.has(localNetwork.id)) return localNetwork

            // If the app build marks a network as unsupported (no non-custodial signer),
            // do not let the server override it into a "working" network. That would
            // trigger bridge RPC calls with the wrong protocol (e.g. Terra/Substrate)
            // and produce misleading runtime errors.
            if (localNetwork.derivation?.status === 'unsupported') return localNetwork

            return serverNetwork
          })
          const networks = mergedLocal
          const normalizedDisabled = clampDisabledNetworkIdsToMaxEnabled(state.disabledNetworkIds, networks)
          const activeNetworkId = resolveEnabledNetworkId(
            networks,
            normalizedDisabled,
            networks.some((n) => n.id === state.activeNetworkId)
              ? state.activeNetworkId
              : (networks[0]?.id || state.activeNetworkId || DEFAULT_ACTIVE_NETWORK_ID)
          )
          return {
            networks,
            activeNetworkId,
            disabledNetworkIds: normalizedDisabled,
            serverCoinCatalog: filteredServerCatalog
          }
        })
      },

      refreshActiveBalance: async (options) => {
        if (refreshActiveBalanceInFlight) {
          refreshActiveBalanceQueuedOptions = mergeRefreshActiveBalanceOptions(
            refreshActiveBalanceQueuedOptions,
            options
          )
          const inFlight = refreshActiveBalanceInFlight
          if (inFlight) await inFlight
          return
        }

        const runner = (async () => {
          let pendingOptions: RefreshActiveBalanceOptions | null = options ?? null
          while (true) {
            const currentOptions = pendingOptions
            pendingOptions = null
            refreshActiveBalanceQueuedOptions = null

            const fastMode = currentOptions?.fast === true
            const skipZeroBalanceRecheck = currentOptions?.skipZeroBalanceRecheck === true
        const { networks, activeNetworkId, accounts, activeAccountId } = get()
        const net = networks.find((n) => n.id === activeNetworkId)
        const acc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
        if (!net || !acc) return
        const bridgeCooldownRemainingMs = getTransientBridgeCooldownRemainingMs(activeNetworkId)
        if (bridgeCooldownRemainingMs > 0 && !fastMode) {
          set((state) => ({
            isSyncing: false,
            isConnected: state.isConnected,
            syncPercent: state.syncPercent,
            lowSyncStreak: state.lowSyncStreak,
            accounts: state.accounts
          }))
          return
        }
        const modelId = resolveNetworkModelId(net)
        const requestStartedAt = Date.now()
        const requestNonce = get().balanceRefreshNonce + 1
        const isStaleRequest = () => {
          const state = get()
          if (state.balanceRefreshNonce !== requestNonce) return true
          if (state.activeNetworkId !== activeNetworkId) return true
          if (state.activeAccountId !== acc.id) return true
          return false
        }
        const waitForUiStabilize = async () => {
          if (fastMode) return
          const elapsed = Date.now() - requestStartedAt
          await delay(Math.max(0, BALANCE_UI_STABILIZE_MS - elapsed))
        }
        set((state) => ({
          balanceRefreshNonce: requestNonce,
          // Keep last known sync status while probing, avoid flashing "Sync ..."
          // on every refresh tick before real chain info is resolved.
          isSyncing: state.isSyncing,
          syncPercent: state.syncPercent,
          accounts: state.accounts
        }))

        if (net.derivation?.status === 'unsupported') {
          console.warn(`[${net.symbol}] Balance refresh skipped: ${net.derivation.reason || 'unsupported in this build'}`)
          await waitForUiStabilize()
          if (isStaleRequest()) return
          set((state) => ({
            isSyncing: false,
            isConnected: false,
            syncPercent: null,
            lowSyncStreak: 0,
            accounts: state.accounts
          }))
          return
        }
        // Ã¢â€â‚¬Ã¢â€â‚¬ Resolve the correct per-network address Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
        // NEVER fall back to acc.addresses.UTXO Ã¢â‚¬â€ that slot holds the FIRST UTXO
        // network's address (RTM) and would show a wrong address on other coins.
        let address: string | null = acc.networkAddresses?.[activeNetworkId] ?? null
        if (
          address
          && net.coinType === 'UTXO'
          && net.coinSymbol
          && modelId !== 'cosmos'
          && !isAddressForCoinSymbol(address, net.coinSymbol)
        ) {
          address = null
        }
        if (!address && net.coinType === 'EVM') address = acc.addresses?.EVM ?? null
        if (
          !address
          || net.coinType === 'UTXO'
          || net.coinType === 'COSMOS'
          || modelId === 'cosmos'
        ) {
          const ensured = await get().ensureNetworkAddress(activeNetworkId)
          if (ensured) address = ensured
        }

        if (!address) {
          console.warn(`No address for ${activeNetworkId} Ã¢â‚¬â€ skipping balance refresh`)
          await waitForUiStabilize()
          if (isStaleRequest()) return
          set({ isSyncing: false, isConnected: false, syncPercent: null, lowSyncStreak: 0 })
          return
        }

        try {
          if (net.coinType === 'EVM') {
            const rpcConfig = await createUtxoRpcConfig(net, {
              secureBridgeSigner: get().signBackendAuthMessage
            })
            const snapshot = await cachedFetchChainBalanceAndSync({
              network: net,
              address,
              rpcConfig,
              force: fastMode
            })
            await waitForUiStabilize()
            if (isStaleRequest()) return
            set((state) => ({
              isSyncing: false,
              isConnected: true,
              syncPercent: 100,
              lowSyncStreak: 0,
              accounts: updateAccountsWithNetworkBalance(state.accounts, acc.id, activeNetworkId, snapshot.balance)
            }))
        } else if (net.coinType === 'COSMOS' || modelId === 'cosmos') {
          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })
          const snapshot = await cachedFetchChainBalanceAndSync({
            network: net,
            address,
            rpcConfig,
            force: fastMode
          })
          await waitForUiStabilize()
          if (isStaleRequest()) return
          set((state) => ({
            isSyncing: snapshot.isSyncing,
            isConnected: true,
            syncPercent: snapshot.syncPercent,
            lowSyncStreak: computeLowSyncStreak(state.lowSyncStreak, snapshot, MIN_SYNC_PERCENT_FOR_SEND),
            accounts: updateAccountsWithNetworkBalance(state.accounts, acc.id, activeNetworkId, snapshot.balance)
          }))
        } else if (net.coinType === 'UTXO') {
        const rpcConfig = await createUtxoRpcConfig(net, {
          secureBridgeSigner: get().signBackendAuthMessage
        })
        const isBtczBridgeMode =
          String(net.coinSymbol || '').trim().toUpperCase() === 'BTCZ'
        const snapshot = await cachedFetchChainBalanceAndSync({
          network: net,
          address,
          rpcConfig,
          skipChainSyncProbe: isBtczBridgeMode,
          preferAddressIndexBalance: supportsAddressIndexBalance(net.coinSymbol),
          zeroBalanceRecheckMs: !skipZeroBalanceRecheck && !fastMode ? UTXO_ZERO_BALANCE_RECHECK_MS : 0,
          force: fastMode
        })
            await waitForUiStabilize()
            if (isStaleRequest()) return
            set((state) => ({
              lowSyncStreak: computeLowSyncStreak(state.lowSyncStreak, snapshot, MIN_SYNC_PERCENT_FOR_SEND),
              isSyncing: snapshot.isSyncing,
              isConnected: true,
              syncPercent: snapshot.syncPercent,
              accounts: updateAccountsWithNetworkBalance(state.accounts, acc.id, activeNetworkId, snapshot.balance)
            }))
          } else if (modelId === 'ada') {
            const rpcConfig = await createUtxoRpcConfig(net, {
              secureBridgeSigner: get().signBackendAuthMessage
            })
            const snapshot = await fetchChainBalanceAndSync({
              network: net,
              address,
              rpcConfig
            })
            await waitForUiStabilize()
            if (isStaleRequest()) return
            set((state) => ({
              isSyncing: snapshot.isSyncing,
              isConnected: true,
              syncPercent: snapshot.syncPercent,
              lowSyncStreak: computeLowSyncStreak(state.lowSyncStreak, snapshot, MIN_SYNC_PERCENT_FOR_SEND),
              accounts: updateAccountsWithNetworkBalance(state.accounts, acc.id, activeNetworkId, snapshot.balance)
            }))
          } else if (modelId === 'sol') {
            const rpcConfig = await createUtxoRpcConfig(net, {
              secureBridgeSigner: get().signBackendAuthMessage
            })
            const snapshot = await fetchChainBalanceAndSync({
              network: net,
              address,
              rpcConfig
            })
            await waitForUiStabilize()
            if (isStaleRequest()) return
            set((state) => ({
              isSyncing: false,
              isConnected: true,
              syncPercent: 100,
              lowSyncStreak: 0,
              accounts: updateAccountsWithNetworkBalance(state.accounts, acc.id, activeNetworkId, snapshot.balance)
            }))
          } else if (modelId === 'sui') {
            const rpcConfig = await createUtxoRpcConfig(net, {
              secureBridgeSigner: get().signBackendAuthMessage
            })
            const snapshot = await fetchChainBalanceAndSync({
              network: net,
              address,
              rpcConfig
            })
            await waitForUiStabilize()
            if (isStaleRequest()) return
            set((state) => ({
              isSyncing: false,
              isConnected: true,
              syncPercent: 100,
              lowSyncStreak: 0,
              accounts: updateAccountsWithNetworkBalance(state.accounts, acc.id, activeNetworkId, snapshot.balance)
            }))
          } else if (modelId === 'xlm') {
            const rpcConfig = await createUtxoRpcConfig(net, {
              secureBridgeSigner: get().signBackendAuthMessage
            })
            const snapshot = await cachedFetchChainBalanceAndSync({
              network: net,
              address,
              rpcConfig,
              force: fastMode
            })
            await waitForUiStabilize()
            if (isStaleRequest()) return
            set((state) => ({
              isSyncing: false,
              isConnected: true,
              syncPercent: 100,
              lowSyncStreak: 0,
              accounts: updateAccountsWithNetworkBalance(state.accounts, acc.id, activeNetworkId, snapshot.balance)
            }))
          } else if (modelId === 'tron') {
            const rpcConfig = await createUtxoRpcConfig(net, {
              secureBridgeSigner: get().signBackendAuthMessage
            })
            const snapshot = await cachedFetchChainBalanceAndSync({
              network: net,
              address,
              rpcConfig,
              force: fastMode
            })
            await waitForUiStabilize()
            if (isStaleRequest()) return
            set((state) => ({
              isSyncing: false,
              isConnected: true,
              syncPercent: 100,
              lowSyncStreak: 0,
              accounts: updateAccountsWithNetworkBalance(state.accounts, acc.id, activeNetworkId, snapshot.balance)
            }))
          } else {
            // Unsupported runtime family in current build.
            await waitForUiStabilize()
            if (isStaleRequest()) return
            set((state) => ({
              isSyncing: false,
              isConnected: false,
              syncPercent: null,
              lowSyncStreak: 0,
              accounts: state.accounts
            }))
          }
        } catch (err) {
          const transientBridgeFailure = isTransientBridgeFailure(err)
          if (transientBridgeFailure) {
            setTransientBridgeCooldown(activeNetworkId)
            console.warn(`[${net?.symbol}] transient bridge failure; preserving previous connection state`, err)
            useApiMonitorStore.getState().clearLastError()
            await waitForUiStabilize()
            if (isStaleRequest()) return
            set((state) => ({
              isSyncing: false,
              isConnected: state.isConnected,
              syncPercent: state.syncPercent,
              lowSyncStreak: state.lowSyncStreak,
              accounts: state.accounts
            }))
            return
          }

          // Non-transient failure Ã¢â€ â€™ mark disconnected.
          console.error(`[${net?.symbol}] all RPC attempts failed:`, err)
          await waitForUiStabilize()
          if (isStaleRequest()) return
          set({ isSyncing: false, isConnected: false, lowSyncStreak: 0 })
        }
            const queuedOptions = refreshActiveBalanceQueuedOptions
            refreshActiveBalanceQueuedOptions = null
            if (!queuedOptions) break
            pendingOptions = queuedOptions
          }
        })()

        refreshActiveBalanceInFlight = runner
        try {
          await runner
        } finally {
          if (refreshActiveBalanceInFlight === runner) refreshActiveBalanceInFlight = null
        }
      },

      probeActiveChainModel: async () => {
        const { networks, activeNetworkId, accounts, activeAccountId } = get()
        const net = networks.find((n) => n.id === activeNetworkId)
        const acc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
        if (!net || !acc) throw new Error('No active account/network')
        const modelId = resolveNetworkModelId(net)

        const profile = getCoinRuntimeProfile(modelId || net.id)
        const sendCustodyMode = resolveChainSendCustodyMode(net)
        const backendMode: ChainModelLiveSnapshot['backendMode'] =
          net.coinType === 'EVM'
            ? 'evm-rpc'
            : 'bridge'

        // For unsupported coins, probing must not call the backend bridge or attempt server-managed derivation.
        let address: string | null = acc.networkAddresses?.[activeNetworkId] ?? null
        if (net.derivation?.status !== 'unsupported') {
          if (
            address
            && net.coinType === 'UTXO'
            && net.coinSymbol
            && modelId !== 'cosmos'
            && !isAddressForCoinSymbol(address, net.coinSymbol)
          ) {
            address = null
          }
          if (!address && net.coinType === 'EVM') address = acc.addresses?.EVM ?? null
          if (!address || net.coinType === 'UTXO') {
            const ensured = await get().ensureNetworkAddress(activeNetworkId)
            if (ensured) address = ensured
          }
        }
        const resolvedAddress = String(address || '').trim()

        const base: ChainModelLiveSnapshot = {
          networkId: net.id,
          symbol: net.symbol,
          protocol: profile?.protocol || 'unknown',
          backendMode,
          address: resolvedAddress,
          addressValid: false,
          balance: getCachedBalanceForNetwork(acc, activeNetworkId, true),
          syncPercent: get().syncPercent,
          isSyncing: get().isSyncing,
          isConnected: get().isConnected,
          nonCustodialCompliant: sendCustodyMode === 'non-custodial',
          sendCustodyMode,
          serverMatched: false,
          checkedAt: Date.now()
        }
        if (net.derivation?.status === 'unsupported') {
          return {
            ...base,
            checkedAt: Date.now(),
            isConnected: false,
            serverMatched: false,
            error: net.derivation.reason || 'Derivation is not supported in this build'
          }
        }
        if (!resolvedAddress) {
          return { ...base, error: 'No active address for network/account' }
        }

        try {
          if (net.coinType === 'EVM') {
            const rpcConfig = await createUtxoRpcConfig(net, {
              secureBridgeSigner: get().signBackendAuthMessage
            })
            const [snapshot, addressValid] = await Promise.all([
              fetchChainBalanceAndSync({
                network: net,
                address: resolvedAddress,
                rpcConfig
              }),
              validateChainAddress(net, undefined, resolvedAddress)
            ])
            return {
              ...base,
              checkedAt: Date.now(),
              addressValid,
              balance: snapshot.balance,
              syncPercent: snapshot.syncPercent,
              isSyncing: snapshot.isSyncing,
              isConnected: true,
              serverMatched: true
            }
          }

          const rpcConfig = await createUtxoRpcConfig(net, {
            secureBridgeSigner: get().signBackendAuthMessage
          })
          const [snapshot, addressValid] = await Promise.all([
            cachedFetchChainBalanceAndSync({
              network: net,
              address: resolvedAddress,
              rpcConfig,
              preferAddressIndexBalance: net.coinType === 'UTXO' ? supportsAddressIndexBalance(net.coinSymbol) : undefined
            }),
            validateChainAddress(net, rpcConfig, resolvedAddress)
          ])
          return {
            ...base,
            checkedAt: Date.now(),
            addressValid,
            balance: snapshot.balance,
            syncPercent: snapshot.syncPercent,
            isSyncing: snapshot.isSyncing,
            isConnected: true,
            serverMatched: true
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return {
            ...base,
            checkedAt: Date.now(),
            isConnected: false,
            serverMatched: false,
            error: message
          }
        }
      },

      sendEvmTransaction: async ({ to, amount, value, data, gasLimit, gasPrice, maxFeePerGas, maxPriorityFeePerGas, type }) => {
        await waitForSendOperationSlot()
        const { networks, activeNetworkId, accounts, activeAccountId, sessionMnemonic, isLocked } = get()

        const net = networks.find((n) => n.id === activeNetworkId)
        const acc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
        const modelPreferences = get().getNetworkModelPreferences(activeNetworkId)
        if (!net || net.coinType !== 'EVM') throw new Error('Active network is not EVM')
        if (!acc?.addresses?.EVM && !isExternalEvmSignerEnabled()) throw new Error('No active account')

        const recipient = String(to || '').trim()
        const txData = String(data || '').trim()
        const isCustomEvmTx = Boolean(txData)
        const valueText = String(value ?? amount ?? '').trim()

        if (isCustomEvmTx) {
          if (recipient && !ethers.isAddress(recipient)) throw new Error('Invalid EVM recipient address')
          if (!/^0x([0-9a-f]{2})*$/i.test(txData)) {
            throw new Error('EVM transaction data must be a 0x-prefixed hex string')
          }
        } else {
          if (!recipient) throw new Error('Destination address is required')
          if (!valueText) throw new Error('Amount is required')
        }

        if (isExternalEvmSignerEnabled()) {
          const signer = await resolveEvmExternalSigner()
          if (!signer) throw new Error('External EVM signer is not available')
          const rpcConfig = await createUtxoRpcConfig(net)
          const fromAddress = await signer.getAddress()
          const valueWei = parseEvmCoinAmountToWei(valueText, isCustomEvmTx ? 'value' : 'amount')
          const manualGasLimit = parseOptionalRpcQuantity(gasLimit, 'gasLimit')
          const manualGasPrice = parseOptionalRpcQuantity(gasPrice, 'gasPrice')
          const manualMaxFeePerGas = parseOptionalRpcQuantity(maxFeePerGas, 'maxFeePerGas')
          const manualMaxPriorityFeePerGas = parseOptionalRpcQuantity(maxPriorityFeePerGas, 'maxPriorityFeePerGas')
          if (manualGasPrice !== undefined && (manualMaxFeePerGas !== undefined || manualMaxPriorityFeePerGas !== undefined)) {
            throw new Error('Use either gasPrice or EIP-1559 fee fields, not both')
          }
          const feeQuote = await estimateEvmTxFee({
            rpcConfig,
            from: fromAddress,
            to: recipient || undefined,
            valueWei,
            data: txData || undefined,
            fallbackGasLimitHex: isCustomEvmTx
              ? (recipient ? '0x30d40' : '0x2dc6c0')
              : '0x5208',
            lane: modelPreferences.evmGasLane
          })
          const resolvedType = manualGasPrice !== undefined
            ? undefined
            : ((type === 2 || manualMaxFeePerGas !== undefined || manualMaxPriorityFeePerGas !== undefined || feeQuote.type === 2) ? 2 : undefined)
          const effectiveMaxFeePerGas = manualMaxFeePerGas ?? feeQuote.maxFeePerGas
          const effectiveMaxPriorityFeePerGas = manualMaxPriorityFeePerGas ?? feeQuote.maxPriorityFeePerGas
          if (resolvedType === 2 && (effectiveMaxFeePerGas === undefined || effectiveMaxPriorityFeePerGas === undefined)) {
            throw new Error('Missing EIP-1559 fee quote for type 2 transaction')
          }
          const sent = await signer.sendTransaction({
            chainId: net.chainId,
            to: recipient || undefined,
            valueWei,
            data: txData || undefined,
            gasLimit: manualGasLimit ?? feeQuote.gasLimit,
            gasPrice: resolvedType === 2 ? undefined : (manualGasPrice ?? feeQuote.gasPrice),
            maxFeePerGas: resolvedType === 2 ? effectiveMaxFeePerGas : undefined,
            maxPriorityFeePerGas: resolvedType === 2 ? effectiveMaxPriorityFeePerGas : undefined,
            type: resolvedType
          })
          return { hash: sent.hash }
        }
        if (isLocked || !sessionMnemonic) throw new Error('Wallet is locked')
        const accountIndex = resolveDerivationIndex(acc, accounts.findIndex((a) => a.id === acc.id))
        const rpcConfig = await createUtxoRpcConfig(net, {
          secureBridgeSigner: get().signBackendAuthMessage
        })
        if (!isCustomEvmTx) {
          return await sendChainTransaction({
            network: net,
            to: recipient,
            amount: valueText,
            rpcConfig,
            evm: {
              mnemonic: sessionMnemonic,
              accountIndex,
              gasLane: modelPreferences.evmGasLane
            }
          })
        }

        const wallet = deriveEvmWallet(sessionMnemonic, accountIndex)
        const fromAddress = String(wallet.address || '').trim()
        const chainIdHex = await callBridgeMethod(rpcConfig, 'eth_chainId', [])
        const resolvedChainId = Number(BigInt(String(chainIdHex || net.chainId || 1)))
        const expectedChainId = Number(net.chainId || 0)
        if (Number.isFinite(expectedChainId) && expectedChainId > 0 && resolvedChainId !== expectedChainId) {
          throw new Error(
            `Bridge/RPC chain mismatch: selected ${net.name} expects chainId ${expectedChainId}, got ${resolvedChainId}. ` +
            'Stop and verify bridge coin/chain routing before sending.'
          )
        }

        const nonceHex = await callBridgeMethod(rpcConfig, 'eth_getTransactionCount', [fromAddress, 'pending'])
        const valueWei = parseEvmCoinAmountToWei(valueText || '0', 'value')
        const manualGasLimit = parseOptionalRpcQuantity(gasLimit, 'gasLimit')
        const manualGasPrice = parseOptionalRpcQuantity(gasPrice, 'gasPrice')
        const manualMaxFeePerGas = parseOptionalRpcQuantity(maxFeePerGas, 'maxFeePerGas')
        const manualMaxPriorityFeePerGas = parseOptionalRpcQuantity(maxPriorityFeePerGas, 'maxPriorityFeePerGas')
        if (manualGasPrice !== undefined && (manualMaxFeePerGas !== undefined || manualMaxPriorityFeePerGas !== undefined)) {
          throw new Error('Use either gasPrice or EIP-1559 fee fields, not both')
        }

        const feeQuote = await estimateEvmTxFee({
          rpcConfig,
          from: fromAddress,
          to: recipient || undefined,
          valueWei,
          data: txData,
          fallbackGasLimitHex: recipient ? '0x30d40' : '0x2dc6c0',
          lane: modelPreferences.evmGasLane
        })
        const resolvedType = manualGasPrice !== undefined
          ? undefined
          : ((type === 2 || manualMaxFeePerGas !== undefined || manualMaxPriorityFeePerGas !== undefined || feeQuote.type === 2) ? 2 : undefined)
        const effectiveMaxFeePerGas = manualMaxFeePerGas ?? feeQuote.maxFeePerGas
        const effectiveMaxPriorityFeePerGas = manualMaxPriorityFeePerGas ?? feeQuote.maxPriorityFeePerGas
        if (resolvedType === 2 && (effectiveMaxFeePerGas === undefined || effectiveMaxPriorityFeePerGas === undefined)) {
          throw new Error('Missing EIP-1559 fee quote for type 2 transaction')
        }
        const txToSign: any = {
          value: valueWei,
          nonce: Number(BigInt(String(nonceHex || '0x0'))),
          gasLimit: manualGasLimit ?? feeQuote.gasLimit,
          chainId: resolvedChainId,
          data: txData
        }
        if (recipient) txToSign.to = recipient
        if (resolvedType === 2) {
          txToSign.type = 2
          txToSign.maxFeePerGas = effectiveMaxFeePerGas
          txToSign.maxPriorityFeePerGas = effectiveMaxPriorityFeePerGas
        } else {
          txToSign.gasPrice = manualGasPrice ?? feeQuote.gasPrice ?? 1_000_000_000n
        }

        const signedTx = await wallet.signTransaction(txToSign)
        const relayed = await sendBridgeEvmSignedRelay(rpcConfig, {
          kind: 'coin',
          signedTxHex: signedTx
        })
        return { hash: String(relayed.txid) }
      },

      sendCardanoTransaction: async ({ to, amount }) => {
        await waitForSendOperationSlot()
        const { networks, activeNetworkId, accounts, activeAccountId, sessionMnemonic, isLocked } = get()
        if (isLocked || !sessionMnemonic) throw new Error('Wallet is locked')
        const net = networks.find((n) => n.id === activeNetworkId)
        const modelId = resolveNetworkModelId(net)
        if (!net || modelId !== 'ada') throw new Error('Active network is not Cardano')
        const acc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
        const accountIndex = resolveDerivationIndex(acc, accounts.findIndex((a) => a.id === acc.id))
        const fromAddress = acc?.networkAddresses?.[activeNetworkId] || await get().ensureNetworkAddress(activeNetworkId)
        if (!fromAddress) throw new Error(`No address derived for ${net.name}`)
        const { sendCardanoNonCustodial } = await loadCardanoNonCustodialModule()
        return await sendCardanoNonCustodial({
          network: net,
          mnemonic: sessionMnemonic,
          accountIndex,
          fromAddress,
          toAddress: to,
          amountAda: amount,
          walletId: String(net.rpcWallet || '').trim() || undefined
        })
      },

      sendSolanaTransaction: async ({ to, amount }) => {
        await waitForSendOperationSlot()
        const { networks, activeNetworkId, accounts, activeAccountId, sessionMnemonic, isLocked } = get()
        if (isLocked || !sessionMnemonic) throw new Error('Wallet is locked')
        const net = networks.find((n) => n.id === activeNetworkId)
        const modelId = resolveNetworkModelId(net)
        if (!net || modelId !== 'sol') throw new Error('Active network is not Solana')
        const acc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
        const accountIndex = resolveDerivationIndex(acc, accounts.findIndex((a) => a.id === acc.id))
        const { deriveSolanaAddress } = await loadSolanaAddressModule()
        const derived = await deriveSolanaAddress(sessionMnemonic, accountIndex)
        const fromAddress = String(acc?.networkAddresses?.[activeNetworkId] || derived.address).trim()
        if (fromAddress !== derived.address) {
          throw new Error(`Active SOL address does not match derived signer address (${fromAddress} != ${derived.address})`)
        }
        const { sendSolanaNonCustodial } = await loadSolanaNonCustodialModule()
        return await sendSolanaNonCustodial({
          rpcUrl: net.rpcUrl,
          fromAddress,
          toAddress: to,
          amountSol: amount,
          privateKeyHex: derived.privHex
        })
      },

      sendStellarTransaction: async ({ to, amount }) => {
        await waitForSendOperationSlot()
        const { networks, activeNetworkId, accounts, activeAccountId, sessionMnemonic, isLocked } = get()
        if (isLocked || !sessionMnemonic) throw new Error('Wallet is locked')
        const net = networks.find((n) => n.id === activeNetworkId)
        const modelId = resolveNetworkModelId(net)
        if (!net || modelId !== 'xlm') throw new Error('Active network is not Stellar')
        const acc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
        const accountIndex = resolveDerivationIndex(acc, accounts.findIndex((a) => a.id === acc.id))
        const { deriveStellarAddress } = await loadStellarAddressModule()
        const derived = await deriveStellarAddress(sessionMnemonic, accountIndex)
        const fromAddress = String(acc?.networkAddresses?.[activeNetworkId] || derived.address).trim()
        if (fromAddress !== derived.address) {
          throw new Error(`Active XLM address does not match derived signer address (${fromAddress} != ${derived.address})`)
        }
        const { sendStellarNonCustodial } = await loadStellarNonCustodialModule()
        return await sendStellarNonCustodial({
          rpcUrl: net.rpcUrl,
          fromAddress,
          toAddress: to,
          amountXlm: amount,
          privateKeyHex: derived.privHex
        })
      },

      sendTronTransaction: async ({ to, amount }) => {
        await waitForSendOperationSlot()
        const { networks, activeNetworkId, accounts, activeAccountId, sessionMnemonic, isLocked } = get()
        if (isLocked || !sessionMnemonic) throw new Error('Wallet is locked')
        const net = networks.find((n) => n.id === activeNetworkId)
        const modelId = resolveNetworkModelId(net)
        if (!net || modelId !== 'tron') throw new Error('Active network is not TRON')
        const acc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
        const accountIndex = resolveDerivationIndex(acc, accounts.findIndex((a) => a.id === acc.id))
        const { deriveTronAddress } = await loadTronAddressModule()
        const derived = await deriveTronAddress(sessionMnemonic, accountIndex)
        const fromAddress = String(acc?.networkAddresses?.[activeNetworkId] || derived.address).trim()
        if (fromAddress !== derived.address) {
          throw new Error(`Active TRX address does not match derived signer address (${fromAddress} != ${derived.address})`)
        }
        const { sendTronNonCustodial } = await loadTronNonCustodialModule()
        return await sendTronNonCustodial({
          rpcUrl: net.rpcUrl,
          fromAddress,
          toAddress: to,
          amountTrx: amount,
          privateKeyHex: derived.privHex
        })
      },

      sendUtxoTransaction: async ({ to, amount, memo, donation }) => {
        await waitForSendOperationSlot()
        const { networks, activeNetworkId, accounts, activeAccountId, sessionMnemonic, isLocked } = get()
        if (isLocked || !sessionMnemonic) throw new Error('Wallet is locked')

        const net = networks.find((n) => n.id === activeNetworkId)
        const modelId = resolveNetworkModelId(net)
        const acc = accounts.find((a) => a.id === activeAccountId) || accounts[0]
        if (!net || (net.coinType !== 'UTXO' && !(net.coinType === 'COSMOS' || modelId === 'cosmos'))) {
          throw new Error('Active network is not UTXO/COSMOS')
        }
        if (!net.coinSymbol) throw new Error('Network missing coinSymbol')
        if (isCroCosmosModel(net)) {
          const cosmosCfg = resolveCosmosNetworkConfig(net)
          if (!isCosmosAddressForHrp(to, cosmosCfg.hrp)) {
            throw new Error(`Destination address must be a valid ${cosmosCfg.hrp}1... address`)
          }
        }
        const accountIndex = resolveDerivationIndex(acc, accounts.findIndex((a) => a.id === acc.id))

        // Always use the network-specific address, not the generic UTXO slot
        const senderAddress = acc?.networkAddresses?.[activeNetworkId]
          || await get().ensureNetworkAddress(activeNetworkId)
        if (!senderAddress) throw new Error(`No address derived for ${net.name}`)

        const rpcConfig = await createUtxoRpcConfig(net, {
          secureBridgeSigner: get().signBackendAuthMessage
        })

        if (modelId === 'cosmos') {
          const cosmosCfg = resolveCosmosNetworkConfig(net)
          const txMemo = String(memo || '').trim()
          const amountRaw = parseDecimalToAtomicUnits(String(amount || ''), cosmosCfg.decimals, net.symbol)
          const derived = await deriveCosmosAddress(sessionMnemonic, accountIndex, cosmosCfg)
          if (String(senderAddress || '').trim() !== derived.address) {
            throw new Error(`Active COSMOS address does not match derived signer address (${senderAddress} != ${derived.address})`)
          }
          const signedTxBase64 = await signCosmosTokenTransferTxBase64({
            rpcUrl: net.rpcUrl,
            fromAddress: derived.address,
            toAddress: String(to || '').trim(),
            denom: cosmosCfg.nativeDenom,
            amountRaw: amountRaw.toString(),
            privateKeyHex: derived.privHex,
            feeDenom: cosmosCfg.feeDenom,
            feeAmountRaw: cosmosCfg.feeAmountRaw,
            gasLimit: cosmosCfg.gasLimit,
            memo: txMemo
          })
          const sent = await sendBridgeTokenTransfer(rpcConfig, {
            coin: String(net.serverCoinId || 'cosmos').trim() || 'cosmos',
            chain: String(net.serverChain || 'main').trim() || 'main',
            tokenId: cosmosCfg.nativeDenom,
            toAddress: String(to || '').trim(),
            fromAddress: derived.address,
            amount: amountRaw.toString(),
            signedTxHex: signedTxBase64,
            signedFormat: 'cosmos-tx-base64'
          })
          return { hash: sent.txid }
        }

        return await sendUtxoNonCustodialTransaction({
          network: net,
          rpcConfig,
          senderAddress,
          to,
          amount,
          donation,
          feePreset: get().getNetworkModelPreferences(activeNetworkId).utxoFeePreset,
          inputStrategy: get().getNetworkModelPreferences(activeNetworkId).utxoInputStrategy,
          deriveSigningKey: async (resolvedSenderAddress) => {
            const derived = await deriveSigningKeyForSenderAddress(
              sessionMnemonic,
              net,
              accountIndex,
              resolvedSenderAddress
            )
            return { privHex: derived.privHex }
          }
        })
      }
    }),
    {
      name: WALLET_STORAGE_KEY,
      storage: createJSONStorage(() => extensionStateStorage),
      partialize: (state) => ({
        isInitialized: state.isInitialized,
        hasVault: state.hasVault,
        isLocked: state.isLocked,
        vault: state.vault,
        backupConfirmed: state.backupConfirmed,
        createdAt: state.createdAt,
        accounts: state.accounts,
        onboardingCompleted: state.onboardingCompleted,
        nextAccountIndex: state.nextAccountIndex,
        activeAccountId: state.activeAccountId,
        activeNetworkId: state.activeNetworkId,
        networks: state.networks,
        disabledNetworkIds: state.disabledNetworkIds,
        isConnected: state.isConnected,
        isSyncing: state.isSyncing,
        syncPercent: state.syncPercent,
        serverCoinCatalog: state.serverCoinCatalog,
        sendListPreferences: state.sendListPreferences,
        networkModelPreferences: state.networkModelPreferences,
        authorizedSites: state.authorizedSites,
        autolockMinutes: state.autolockMinutes,
        donationPercent: state.donationPercent,
        lastActiveTimestamp: state.lastActiveTimestamp,
        activity: state.activity
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<WalletState>
        const merged = { ...currentState, ...persisted } as WalletState
        const accounts = normalizePersistedAccounts(persisted.accounts ?? merged.accounts)
        const highestDerivationIndex = accounts.reduce((max, account) => Math.max(max, account.derivationIndex), -1)
        const nextAccountIndex = Math.max(
          1,
          typeof persisted.nextAccountIndex === 'number'
            ? persisted.nextAccountIndex
            : highestDerivationIndex + 1
        )
        const activeAccountId = accounts.some((a) => a.id === merged.activeAccountId)
          ? merged.activeAccountId
          : (accounts[0]?.id ?? null)
        const normalizedNetworks = normalizeNetworkListSymbols(INITIAL_NETWORKS)
        const normalizedDisabledNetworkIds = clampDisabledNetworkIdsToMaxEnabled(
          (persisted as any).disabledNetworkIds ?? (merged as any).disabledNetworkIds ?? [],
          normalizedNetworks
        )
        const normalizedPersistedNetworkId = normalizeNetworkIdAlias(String(merged.activeNetworkId || ''))
        const activeNetworkId = resolveEnabledNetworkId(
          normalizedNetworks,
          normalizedDisabledNetworkIds,
          INITIAL_NETWORKS.some((n) => n.id === normalizedPersistedNetworkId)
            ? normalizedPersistedNetworkId
            : DEFAULT_ACTIVE_NETWORK_ID
        )
        const accountsWithActiveNetworkBalance = accounts.map((account) => (
          account.id === activeAccountId
            ? { ...account, balance: getCachedBalanceForNetwork(account, activeNetworkId, true) }
            : account
        ))
        const normalizedActivity = normalizeActivityList(persisted.activity ?? merged.activity, {
          networks: normalizedNetworks,
          accounts: accountsWithActiveNetworkBalance,
          activeNetworkId,
          activeAccountId
        })
        const onboardingCompleted =
          typeof (persisted as any).onboardingCompleted === 'boolean'
            ? Boolean((persisted as any).onboardingCompleted)
            : Boolean(merged.isInitialized || merged.hasVault)
        const autolockMinutes = Math.max(1, Number(merged.autolockMinutes ?? 5))
        const lastActiveTimestamp = Number(merged.lastActiveTimestamp ?? Date.now())
        const shouldAutolockOnHydration = Boolean(
          merged.isInitialized
          && !merged.isLocked
          && (Date.now() - lastActiveTimestamp > autolockMinutes * 60 * 1000)
        )

        return {
          ...merged,
          isLocked: shouldAutolockOnHydration ? true : merged.isLocked,
          accounts: accountsWithActiveNetworkBalance,
          onboardingCompleted,
          nextAccountIndex,
          activeAccountId,
          networks: normalizedNetworks,
          disabledNetworkIds: normalizedDisabledNetworkIds,
          activeNetworkId,
          activity: normalizedActivity,
          serverCoinCatalog: normalizeServerCatalogSymbols(
            Array.isArray((persisted as any).serverCoinCatalog)
              ? ((persisted as any).serverCoinCatalog as ServerCoinCatalogItem[])
              : []
          ),
          networkAssets: {},
          networkAssetLogos: {},
          networkAssetLabels: {},
          evmNftAssets: {},
          accountNetworkAssets: {},
          accountNetworkAssetLogos: {},
          accountNetworkAssetLabels: {},
          accountNetworkEvmNftAssets: {},
          accountNetworkFiatTotals: {},
          accountNetworkFiatNative: {},
          accountNetworkFiatAssets: {},
          sendListPreferences: normalizeSendListPreferencesRecord((persisted as any).sendListPreferences),
          networkModelPreferences: normalizeNetworkModelPreferencesState((persisted as any).networkModelPreferences, normalizedNetworks),
          donationPercent: clampDonationPercent(Number((persisted as any).donationPercent ?? merged.donationPercent ?? MIN_DONATION_PERCENT))
        }
      }
    }
  )
)


