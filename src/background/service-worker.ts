// Background Service Worker for MetaYoshi Wallet Extension
// Handles DApp RPC requests and message passing

import {
  clearRuntimeErrorLog,
  getRuntimeErrorLog,
  installGlobalErrorMonitor,
  recordRuntimeError
} from '../lib/runtimeErrorMonitor'
import {
  clearBridgeTraceLog,
  getBridgeTraceLog,
  recordBridgeTrace
} from '../lib/bridgeTrace'
import {
  DAPP_BLOCKED_INTERNAL_ORIGIN_MESSAGE,
  DAPP_APPROVAL_TIMEOUT_MS,
  DAPP_PENDING_APPROVAL_STORAGE_KEY,
  DAPP_PENDING_REQUEST_STORAGE_KEY,
  DAPP_PERMISSIONS_STORAGE_KEY,
  isBlockedInternalDappOrigin,
  normalizeDappOrigin,
  parseDappPendingApproval,
  parseDappPendingRequest,
  parseDappPermissions,
  uniqDappScopes,
  type DappPendingApproval,
  type DappPendingRequest,
  type DappPermission,
  type DappRequestError,
  type DappRequestMethod,
  type DappScope
} from '../lib/dappPermissions'
import { isPersistedStateEnvelope, unwrapPersistedState, WALLET_STORAGE_KEY } from '../lib/walletStorage'
import { resolveNetworkCapabilities } from '../lib/networkCapabilities'

const BG_EVENT_PORT_NAME = 'metayoshi-inpage-events'
const DEFAULT_NETWORK_ID = String(import.meta.env.VITE_DEFAULT_NETWORK || 'rtm').trim() || 'rtm'
const APP_POPUP_WIDTH = 380
// Chrome window bounds use integer pixels; 663.2px requested by product is rounded to 663px.
const APP_POPUP_HEIGHT = 663
const APP_ENTRY_PATH = 'app/src/ui/index.html'
const managedPopupWindowIds = new Set<number>()
let managedPopupWindowId: number | null = null
let managedPopupOpenQueue: Promise<void> = Promise.resolve()

type JsonRpcRequest = {
  id?: string | number | null
  jsonrpc?: '2.0'
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

type DappRequest = {
  type: 'DAPP_INTERNAL_RPC'
  request: JsonRpcRequest
  origin?: string
}

type MonitorRequest =
  | { type: 'METAYOSHI_MONITOR_GET_ERRORS' }
  | { type: 'METAYOSHI_MONITOR_CLEAR_ERRORS' }
  | { type: 'METAYOSHI_MONITOR_GET_BRIDGE_TRACE' }
  | { type: 'METAYOSHI_MONITOR_CLEAR_BRIDGE_TRACE' }

type SendTransactionParams =
  | {
      to: string
      amount: string
      memo?: string
    }
  | {
      to?: string
      value?: string
      data: string
      gasLimit?: string
      gasPrice?: string
      maxFeePerGas?: string
      maxPriorityFeePerGas?: string
      type?: 2
    };

type SendAssetParams = {
  assetId: string
  qty: string
  toAddress: string
  memo?: string
}

const PROVIDER_STATE_METHODS = new Set(['wallet_getProviderState', 'metayoshi_getProviderState', 'rtm_getProviderState'])
const CONNECT_METHODS = new Set(['wallet_connect', 'metayoshi_connect', 'rtm_connect'])
const CAPABILITIES_METHODS = new Set(['wallet_getCapabilities', 'metayoshi_getCapabilities', 'rtm_getCapabilities'])
const NETWORKS_METHODS = new Set(['wallet_getNetworks', 'metayoshi_getNetworks', 'rtm_getNetworks'])
const REQUEST_ACCOUNTS_METHODS = new Set(['wallet_requestAccounts', 'metayoshi_requestAccounts', 'rtm_requestAccounts'])
const ACCOUNTS_METHODS = new Set(['wallet_accounts', 'metayoshi_accounts', 'rtm_accounts'])
const SIGN_MESSAGE_METHODS = new Set(['wallet_signMessage', 'metayoshi_signMessage', 'rtm_signMessage'])
const SIGN_TYPED_DATA_METHODS = new Set(['wallet_signTypedData'])
const SIGN_TRANSACTION_METHODS = new Set(['wallet_signTransaction'])
const SIGN_ALL_TRANSACTIONS_METHODS = new Set(['wallet_signAllTransactions'])
const SIGN_AND_SEND_TRANSACTION_METHODS = new Set(['wallet_signAndSendTransaction'])
const COSMOS_GET_KEY_METHODS = new Set(['wallet_cosmosGetKey'])
const COSMOS_SIGN_DIRECT_METHODS = new Set(['wallet_cosmosSignDirect'])
const COSMOS_SIGN_AMINO_METHODS = new Set(['wallet_cosmosSignAmino'])
const COSMOS_SEND_TX_METHODS = new Set(['wallet_cosmosSendTx'])
const SEND_TRANSACTION_METHODS = new Set(['wallet_sendTransaction', 'metayoshi_sendTransaction', 'rtm_sendTransaction'])
const SEND_ASSET_METHODS = new Set(['wallet_sendAsset', 'metayoshi_sendAsset', 'rtm_sendAsset'])
const SELECT_ACCOUNT_METHODS = new Set(['wallet_selectAccount', 'metayoshi_selectAccount', 'rtm_selectAccount'])
const SWITCH_NETWORK_METHODS = new Set(['wallet_switchNetwork', 'metayoshi_switchNetwork', 'rtm_switchNetwork'])
const ETHEREUM_ACCOUNTS_METHODS = new Set(['eth_accounts'])
const ETHEREUM_REQUEST_ACCOUNTS_METHODS = new Set(['eth_requestAccounts'])
const ETHEREUM_CHAIN_ID_METHODS = new Set(['eth_chainId'])
const ETHEREUM_SWITCH_CHAIN_METHODS = new Set(['wallet_switchEthereumChain'])
const ETHEREUM_ADD_CHAIN_METHODS = new Set(['wallet_addEthereumChain'])
const ETHEREUM_SEND_TRANSACTION_METHODS = new Set(['eth_sendTransaction'])
const ETHEREUM_SIGN_METHODS = new Set(['personal_sign', 'eth_sign'])
const ETHEREUM_SIGN_TYPED_DATA_METHODS = new Set(['eth_signTypedData', 'eth_signTypedData_v3', 'eth_signTypedData_v4'])
// Event ports for broadcasting events to content scripts
const eventPorts = new Set<chrome.runtime.Port>()

interface WalletState {
  isInitialized?: boolean
  isLocked?: boolean
  hasVault?: boolean
  accounts?: Array<{
    id: string
    addresses: { EVM?: string; UTXO?: string; XRP?: string; COSMOS?: string }
    networkAddresses?: Record<string, string>
  }>
  activeAccountId?: string | null
  activeNetworkId?: string
  authorizedSites?: string[]
  networks?: Array<{ id: string; runtimeModelId?: string; coinType: string; name: string; symbol: string; chainId?: number; capabilities?: any }>
}

type DappNetworkEntry = { id: string; runtimeModelId?: string; coinType: string; name: string; symbol: string; chainId?: number; capabilities?: any }

type DappNetworkDescriptor = {
  id: string
  runtimeModelId: string | null
  name: string
  symbol: string
  coinType: string
  chainId: number | null
  capabilities: {
    nativeSend: boolean
    assetLayer: boolean
    assetSend: boolean
    activity: boolean
  }
}

type DappMethodMatrix = {
  signMessage: boolean
  signTypedData: boolean
  signTransaction: boolean
  signAllTransactions: boolean
  signAndSendTransaction: boolean
  cosmosGetKey: boolean
  cosmosSignDirect: boolean
  cosmosSignAmino: boolean
  cosmosSendTx: boolean
  methods: string[]
}

type DappProtocol = 'evm-jsonrpc' | 'solana-jsonrpc' | 'cosmos-rest-bridge' | 'generic'

function buildDappNetworkDescriptor(
  network: DappNetworkEntry,
  active: boolean
): DappNetworkDescriptor & { active: boolean } {
  const caps = resolveNetworkCapabilities(network || {})
  return {
    id: String(network?.id || '').trim(),
    runtimeModelId: String(network?.runtimeModelId || '').trim() || null,
    name: String(network?.name || '').trim(),
    symbol: String(network?.symbol || '').trim(),
    coinType: String(network?.coinType || '').trim(),
    chainId: typeof network?.chainId === 'number' ? network.chainId : null,
    active,
    capabilities: {
      nativeSend: Boolean(caps.features.nativeSend),
      assetLayer: Boolean(caps.features.assetLayer),
      assetSend: Boolean(caps.features.assetSend),
      activity: Boolean(caps.features.activity)
    }
  }
}

function resolveDappNetworks(state: WalletState): DappNetworkEntry[] {
  return (state.networks || []).filter((network) => {
    const id = String(network?.id || '').trim()
    return Boolean(id)
  })
}

function getRpcParamObject(params: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') return null
  return candidate as Record<string, unknown>
}

function resolveDappProtocol(network?: DappNetworkEntry | null): DappProtocol {
  const coinType = String(network?.coinType || '').trim().toUpperCase()
  const runtimeModelId = String(network?.runtimeModelId || '').trim().toLowerCase()
  const networkId = String(network?.id || '').trim().toLowerCase()

  if (coinType === 'EVM') return 'evm-jsonrpc'
  if (
    coinType === 'SOL'
    || runtimeModelId === 'sol'
    || runtimeModelId === 'solana'
    || networkId === 'sol'
    || networkId === 'solana'
    || networkId === 'srv--solana-testnet'
  ) {
    return 'solana-jsonrpc'
  }
  if (
    coinType === 'COSMOS'
    || runtimeModelId === 'cosmos'
    || runtimeModelId === 'cro'
    || networkId === 'cosmos'
    || networkId === 'cro'
  ) {
    return 'cosmos-rest-bridge'
  }

  return 'generic'
}

function parseRequestedChainId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (/^0x[0-9a-f]+$/i.test(normalized)) {
    const parsed = Number.parseInt(normalized, 16)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
  }
  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
  }
  return null
}

function resolveRequestedDappNetwork(
  dappNetworks: DappNetworkEntry[],
  params: unknown
): { network?: DappNetworkEntry; hintProvided: boolean; hintSummary: string | null } {
  const payload = getRpcParamObject(params)
  if (!payload) return { network: undefined, hintProvided: false, hintSummary: null }

  const textHints = [
    payload.networkId,
    payload.coinId,
    payload.coin,
    payload.symbol,
    payload.runtimeModelId,
    payload.network,
    payload.blockchain
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
  const requestedChainId = parseRequestedChainId(payload.chainId)
  const hintProvided = textHints.length > 0 || requestedChainId !== null
  if (!hintProvided) {
    return { network: undefined, hintProvided: false, hintSummary: null }
  }

  const normalizedTextHints = textHints.map((value) => value.toLowerCase())
  const symbolHints = textHints.map((value) => value.toUpperCase())
  const network = dappNetworks.find((entry) => {
    const id = String(entry.id || '').trim().toLowerCase()
    const runtimeModelId = String(entry.runtimeModelId || '').trim().toLowerCase()
    const name = String(entry.name || '').trim().toLowerCase()
    const symbol = String(entry.symbol || '').trim().toUpperCase()
    const entryChainId = typeof entry.chainId === 'number' ? entry.chainId : null

    if (normalizedTextHints.includes(id)) return true
    if (runtimeModelId && normalizedTextHints.includes(runtimeModelId)) return true
    if (name && normalizedTextHints.includes(name)) return true
    if (symbol && symbolHints.includes(symbol)) return true
    if (requestedChainId !== null && entryChainId === requestedChainId) return true
    return false
  })

  const hintSummary = [
    ...textHints,
    ...(requestedChainId !== null ? [String(requestedChainId)] : [])
  ].join(', ') || null

  return { network, hintProvided: true, hintSummary }
}

function resolveCoinDecimals(network?: { coinType?: string; symbol?: string; id?: string }): number {
  const symbol = String(network?.symbol || '').trim().toUpperCase()
  const id = String(network?.id || '').trim().toLowerCase()
  if (network?.coinType === 'EVM') return 18
  if (network?.coinType === 'XRP') return 6
  if (network?.coinType === 'SOL' || symbol === 'SOL' || id === 'sol' || id === 'solana' || id === 'srv--solana-testnet') return 9
  if (symbol === 'XLM' || id === 'xlm' || id === 'stellar') return 7
  if (symbol === 'TRX' || id === 'tron') return 6
  if (symbol === 'ADA' || id === 'ada') return 6
  if (symbol === 'XMR' || id === 'xmr') return 12
  return 8
}

installGlobalErrorMonitor('background-sw')

function createDefaultWalletState(): WalletState {
  return {
    isInitialized: false,
    isLocked: true,
    hasVault: false,
    accounts: [],
    activeAccountId: null,
    activeNetworkId: DEFAULT_NETWORK_ID,
    authorizedSites: [],
    networks: []
  }
}

async function getWalletStorageRecord(): Promise<unknown> {
  try {
    const stored = await chrome.storage.local.get(WALLET_STORAGE_KEY)
    return stored[WALLET_STORAGE_KEY]
  } catch {
    return null
  }
}

function normalizeAuthorizedSites(rawSites: unknown): string[] {
  if (!Array.isArray(rawSites)) return []
  return Array.from(
    new Set(
      rawSites
        .map((site) => normalizeDappOrigin(String(site || '')))
        .filter((site) => site && site !== 'unknown')
    )
  )
}

// Get wallet state from storage
async function getWalletState(): Promise<WalletState> {
  const raw = await getWalletStorageRecord()
  const parsed = unwrapPersistedState<WalletState>(raw)
  if (!parsed) return createDefaultWalletState()

  return {
    ...createDefaultWalletState(),
    ...parsed,
    authorizedSites: normalizeAuthorizedSites(parsed.authorizedSites)
  }
}

async function updateWalletStateInStorage(
  updater: (current: WalletState) => WalletState
): Promise<WalletState> {
  const record = await getWalletStorageRecord()
  const current = await getWalletState()
  const nextState = updater(current)

  const nextRecord = isPersistedStateEnvelope<WalletState>(record)
    ? { ...(record as { state: WalletState; version?: number }), state: nextState }
    : nextState

  await chrome.storage.local.set({ [WALLET_STORAGE_KEY]: nextRecord })
  return nextState
}

function getActiveAddressFromState(state: WalletState, networkId: string): string | null {
  const normalizedNetworkId = String(networkId || '').trim()
  const network = state.networks?.find((n) => n.id === normalizedNetworkId)
  const account = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
  if (!network || !account) return null

  const networkAddress = String(account.networkAddresses?.[normalizedNetworkId] || '').trim()
  if (networkAddress) return networkAddress

  if (network.coinType === 'EVM') {
    return account.addresses?.EVM || null
  }
  if (network.coinType === 'XRP') {
    return account.addresses?.XRP || null
  }
  if (network.coinType === 'COSMOS') {
    return account.addresses?.COSMOS || null
  }
  if (network.coinType === 'UTXO') {
    return account.addresses?.UTXO || null
  }
  if (network.coinType === 'SOL') {
    return (account.addresses as any)?.SOL || null
  }
  if (network.coinType === 'SUI') {
    return (account.addresses as any)?.SUI || null
  }
  return null
}

function findNetworkByCoinType(state: WalletState, coinType: string): DappNetworkEntry | undefined {
  const normalizedCoinType = String(coinType || '').trim().toUpperCase()
  const dappNetworks = resolveDappNetworks(state)
  const active = dappNetworks.find((entry) => entry.id === state.activeNetworkId && String(entry.coinType || '').trim().toUpperCase() === normalizedCoinType)
  if (active) return active
  return dappNetworks.find((entry) => String(entry.coinType || '').trim().toUpperCase() === normalizedCoinType)
}

function findNetworkByRuntimeModel(state: WalletState, modelId: string): DappNetworkEntry | undefined {
  const normalizedModelId = String(modelId || '').trim().toLowerCase()
  const dappNetworks = resolveDappNetworks(state)
  const active = dappNetworks.find((entry) => entry.id === state.activeNetworkId && String(entry.runtimeModelId || '').trim().toLowerCase() === normalizedModelId)
  if (active) return active
  return dappNetworks.find((entry) => String(entry.runtimeModelId || '').trim().toLowerCase() === normalizedModelId)
}

// Get active account address based on network type
async function getActiveAddress(networkId: string): Promise<string | null> {
  const state = await getWalletState()
  return getActiveAddressFromState(state, networkId)
}

async function requireDappScopes(origin: string | undefined, scopes: DappScope[]): Promise<string> {
  const normalizedOrigin = normalizeDappOrigin(String(origin || ''))
  if (!normalizedOrigin || normalizedOrigin === 'unknown') {
    throw { code: 4001, message: 'Untrusted origin' }
  }

  const approved = await requestScopes(normalizedOrigin, scopes)
  if (!approved) {
    throw { code: 4001, message: 'User rejected the request' }
  }

  await touchLastConnected(normalizedOrigin)
  return normalizedOrigin
}

async function getDappPermissionMap(): Promise<Record<string, DappPermission>> {
  try {
    const stored = await chrome.storage.local.get(DAPP_PERMISSIONS_STORAGE_KEY)
    return parseDappPermissions(stored[DAPP_PERMISSIONS_STORAGE_KEY])
  } catch {
    return {}
  }
}

async function setDappPermissionMap(next: Record<string, DappPermission>): Promise<void> {
  await chrome.storage.local.set({ [DAPP_PERMISSIONS_STORAGE_KEY]: next })
}

async function getPendingApproval(): Promise<DappPendingApproval | null> {
  try {
    const stored = await chrome.storage.local.get(DAPP_PENDING_APPROVAL_STORAGE_KEY)
    return parseDappPendingApproval(stored[DAPP_PENDING_APPROVAL_STORAGE_KEY])
  } catch {
    return null
  }
}

async function setPendingApproval(pending: DappPendingApproval): Promise<void> {
  await chrome.storage.local.set({ [DAPP_PENDING_APPROVAL_STORAGE_KEY]: pending })
}

async function clearPendingApprovalIfMatch(id: string): Promise<void> {
  const pending = await getPendingApproval()
  if (!pending || pending.id !== id) return
  await chrome.storage.local.remove(DAPP_PENDING_APPROVAL_STORAGE_KEY)
}

async function getPendingRequest(): Promise<DappPendingRequest | null> {
  try {
    const stored = await chrome.storage.local.get(DAPP_PENDING_REQUEST_STORAGE_KEY)
    return parseDappPendingRequest(stored[DAPP_PENDING_REQUEST_STORAGE_KEY])
  } catch {
    return null
  }
}

async function setPendingRequest(pending: DappPendingRequest): Promise<void> {
  await chrome.storage.local.set({ [DAPP_PENDING_REQUEST_STORAGE_KEY]: pending })
}

async function clearPendingRequestIfMatch(id: string): Promise<void> {
  const pending = await getPendingRequest()
  if (!pending || pending.id !== id) return
  await chrome.storage.local.remove(DAPP_PENDING_REQUEST_STORAGE_KEY)
}

async function ensureAuthorizedSite(origin: string): Promise<void> {
  await updateWalletStateInStorage((current) => {
    const sites = normalizeAuthorizedSites(current.authorizedSites)
    if (sites.includes(origin)) return { ...current, authorizedSites: sites }
    return { ...current, authorizedSites: [...sites, origin] }
  })
}

function hasAuthorizedSite(state: WalletState, origin: string): boolean {
  return normalizeAuthorizedSites(state.authorizedSites).includes(origin)
}

async function hasScope(origin: string, scope: DappScope): Promise<boolean> {
  const normalizedOrigin = normalizeDappOrigin(origin)
  if (!normalizedOrigin || normalizedOrigin === 'unknown') return false

  const [permissionMap, walletState] = await Promise.all([
    getDappPermissionMap(),
    getWalletState()
  ])
  const permission = permissionMap[normalizedOrigin]
  if (!permission) return false
  if (!hasAuthorizedSite(walletState, normalizedOrigin)) return false
  return permission.scopes.includes(scope)
}

async function grantScopes(origin: string, scopes: DappScope[]): Promise<void> {
  const normalizedOrigin = normalizeDappOrigin(origin)
  if (!normalizedOrigin || normalizedOrigin === 'unknown') return

  const permissionMap = await getDappPermissionMap()
  const previous = permissionMap[normalizedOrigin]

  permissionMap[normalizedOrigin] = {
    origin: normalizedOrigin,
    scopes: uniqDappScopes([...(previous?.scopes ?? []), ...scopes]),
    updatedAt: Date.now(),
    lastConnectedAt: previous?.lastConnectedAt
  }

  await setDappPermissionMap(permissionMap)
  await ensureAuthorizedSite(normalizedOrigin)
}

async function touchLastConnected(origin: string): Promise<void> {
  const normalizedOrigin = normalizeDappOrigin(origin)
  if (!normalizedOrigin || normalizedOrigin === 'unknown') return

  const permissionMap = await getDappPermissionMap()
  const permission = permissionMap[normalizedOrigin]
  if (!permission) return

  permissionMap[normalizedOrigin] = {
    ...permission,
    updatedAt: Date.now(),
    lastConnectedAt: Date.now()
  }
  await setDappPermissionMap(permissionMap)
}

function buildApprovalPopupUrl(): string {
  return buildPopupRouteUrl('/dapp/connect/1')
}

function isWalletTxConfirmRequest(
  method: DappRequestMethod,
  request: unknown
): boolean {
  if (method === 'wallet_sendAsset') return true
  if (method !== 'wallet_sendTransaction' || !request || typeof request !== 'object') return false

  const candidate = request as Record<string, unknown>
  const data = String(candidate.data || '').trim()
  if (data) return false

  const to = String(candidate.to || '').trim()
  const amount = String(candidate.amount || candidate.value || '').trim()
  return Boolean(to && amount)
}

function buildRequestPopupUrl(requestId: string, method: DappRequestMethod, request: unknown): string {
  if (isWalletTxConfirmRequest(method, request)) {
    return buildPopupRouteUrl(`/tx/confirm?dappRequest=1&id=${encodeURIComponent(requestId)}`)
  }
  return buildPopupRouteUrl(`/dapp/request/confirm?id=${encodeURIComponent(requestId)}`)
}

function buildPopupRouteUrl(route: string): string {
  const normalizedRoute = String(route || '').trim()
  const hashRoute = normalizedRoute.startsWith('/') ? normalizedRoute : `/${normalizedRoute}`
  return `${chrome.runtime.getURL(APP_ENTRY_PATH)}#${hashRoute}`
}

function buildWalletHomePopupUrl(): string {
  return buildPopupRouteUrl('/')
}

async function openWalletHomePopup(): Promise<void> {
  await openManagedPopup(buildWalletHomePopupUrl())
}

async function openApprovalPopup(): Promise<void> {
  await openManagedPopup(buildApprovalPopupUrl())
}

async function openRequestPopup(requestId: string, method: DappRequestMethod, request: unknown): Promise<void> {
  await openManagedPopup(buildRequestPopupUrl(requestId, method, request))
}

async function openManagedPopup(url: string): Promise<void> {
  const nextTask = managedPopupOpenQueue
    .catch(() => {
      // Keep queue alive after prior failure.
    })
    .then(() => openManagedPopupInternal(url))
  managedPopupOpenQueue = nextTask
  await nextTask
}

async function openManagedPopupInternal(url: string): Promise<void> {
  const left = await resolvePopupLeft()
  const top = await resolvePopupTop()

  const existingWindow = await findManagedPopupWindow()
  if (existingWindow?.id !== undefined) {
    const windowId = existingWindow.id
    managedPopupWindowId = windowId
    managedPopupWindowIds.add(windowId)
    await chrome.windows.update(windowId, {
      width: APP_POPUP_WIDTH,
      height: APP_POPUP_HEIGHT,
      state: 'normal',
      left,
      top,
      focused: true
    })
    await updateManagedPopupWindowRoute(windowId, url)
    return
  }

  const created = await chrome.windows.create({
    url,
    type: 'popup',
    width: APP_POPUP_WIDTH,
    height: APP_POPUP_HEIGHT,
    state: 'normal',
    left,
    top,
    focused: true
  })
  if (created && typeof created.id === 'number') {
    managedPopupWindowId = created.id
    managedPopupWindowIds.add(created.id)
  }
}

function isManagedPopupUrl(url: string | undefined): boolean {
  if (!url) return false
  const base = chrome.runtime.getURL(APP_ENTRY_PATH)
  return url.startsWith(base)
}

function windowHasManagedPopupTab(win: chrome.windows.Window | null | undefined): boolean {
  if (!win || win.type !== 'popup') return false
  const tabs = Array.isArray(win.tabs) ? win.tabs : []
  return tabs.some((tab) => isManagedPopupUrl(tab?.url))
}

async function findManagedPopupWindow(): Promise<chrome.windows.Window | null> {
  if (typeof managedPopupWindowId === 'number') {
    try {
      const win = await chrome.windows.get(managedPopupWindowId, { populate: true })
      if (windowHasManagedPopupTab(win)) {
        return win
      }
    } catch {
      managedPopupWindowId = null
    }
  }

  try {
    const all = await chrome.windows.getAll({ populate: true })
    const managed = all.filter((win) => windowHasManagedPopupTab(win))
    if (managed.length === 0) return null

    const [primary, ...duplicates] = managed
    if (typeof primary.id === 'number') {
      managedPopupWindowId = primary.id
      managedPopupWindowIds.add(primary.id)
    }
    for (const dup of duplicates) {
      if (typeof dup.id === 'number') {
        managedPopupWindowIds.delete(dup.id)
        try {
          await chrome.windows.remove(dup.id)
        } catch {
          // Ignore close races.
        }
      }
    }
    return primary
  } catch {
    return null
  }
}

async function enforceSingleManagedPopupWindow(): Promise<void> {
  try {
    const all = await chrome.windows.getAll({ populate: true })
    const managed = all.filter((win) => windowHasManagedPopupTab(win))
    if (managed.length === 0) return

    let primary = managed[0]
    for (const candidate of managed) {
      const candidateFocused = candidate.focused === true
      const primaryFocused = primary.focused === true
      if (candidateFocused && !primaryFocused) {
        primary = candidate
      } else if (candidateFocused === primaryFocused) {
        const cId = typeof candidate.id === 'number' ? candidate.id : Number.MAX_SAFE_INTEGER
        const pId = typeof primary.id === 'number' ? primary.id : Number.MAX_SAFE_INTEGER
        if (cId < pId) primary = candidate
      }
    }

    if (typeof primary.id === 'number') {
      managedPopupWindowId = primary.id
      managedPopupWindowIds.add(primary.id)
    }

    for (const win of managed) {
      if (win.id === primary.id) continue
      if (typeof win.id !== 'number') continue
      managedPopupWindowIds.delete(win.id)
      try {
        await chrome.windows.remove(win.id)
      } catch {
        // Ignore close races.
      }
    }
  } catch {
    // Ignore transient window query errors.
  }
}

async function updateManagedPopupWindowRoute(windowId: number, url: string): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ windowId })
    const targetTab = tabs[0]
    if (targetTab?.id !== undefined) {
      await chrome.tabs.update(targetTab.id, { url, active: true })
      return
    }
    await chrome.tabs.create({ windowId, url, active: true })
  } catch {
    // Ignore tab update/create races.
  }
}

async function resolvePopupLeft(): Promise<number | undefined> {
  try {
    const base = await chrome.windows.getLastFocused()
    const baseLeft = Number(base.left)
    const baseWidth = Number(base.width)
    if (!Number.isFinite(baseLeft) || !Number.isFinite(baseWidth)) return undefined
    return Math.max(0, Math.round(baseLeft + (baseWidth - APP_POPUP_WIDTH) / 2))
  } catch {
    return undefined
  }
}

async function resolvePopupTop(): Promise<number | undefined> {
  try {
    const base = await chrome.windows.getLastFocused()
    const baseTop = Number(base.top)
    const baseHeight = Number(base.height)
    if (!Number.isFinite(baseTop) || !Number.isFinite(baseHeight)) return undefined
    return Math.max(0, Math.round(baseTop + (baseHeight - APP_POPUP_HEIGHT) / 2))
  } catch {
    return undefined
  }
}

async function enforceManagedPopupBounds(windowId: number): Promise<void> {
  try {
    const win = await chrome.windows.get(windowId)
    if (win.type !== 'popup') return
    const nextBounds: chrome.windows.UpdateInfo = {}
    if (typeof win.width === 'number' && win.width !== APP_POPUP_WIDTH) {
      nextBounds.width = APP_POPUP_WIDTH
    }
    if (typeof win.height === 'number' && win.height !== APP_POPUP_HEIGHT) {
      nextBounds.height = APP_POPUP_HEIGHT
    }
    if (win.state && win.state !== 'normal') {
      nextBounds.state = 'normal'
    }
    if (Object.keys(nextBounds).length > 0) {
      await chrome.windows.update(windowId, nextBounds)
    }
  } catch {
    // Ignore transient failures (window closed/race).
  }
}

type ApprovalDecision = 'approved' | 'rejected' | 'timeout'
type RequestDecision = 'executed' | 'failed' | 'rejected' | 'timeout'

function stableStringifyForComparison(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringifyForComparison(entry)).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringifyForComparison(entryValue)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(String(value))
}

function areRequestsEquivalent(left: unknown, right: unknown): boolean {
  return stableStringifyForComparison(left) === stableStringifyForComparison(right)
}

function getPendingTimeoutMs(expiresAt: number, fallbackMs: number): number {
  const remainingMs = Math.max(1000, Math.trunc(Number(expiresAt || 0) - Date.now()))
  return Number.isFinite(remainingMs) ? remainingMs : fallbackMs
}

function summarizeTraceValue(value: unknown, maxLength = 180): string | undefined {
  if (value === undefined) return undefined
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (!text) return undefined
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  } catch {
    const text = String(value)
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  }
}

async function waitForApprovalDecision(id: string, timeoutMs: number): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    let settled = false

    const finish = (decision: ApprovalDecision): void => {
      if (settled) return
      settled = true
      chrome.storage.onChanged.removeListener(onStorageChanged)
      clearTimeout(timeout)
      resolve(decision)
    }

    const onStorageChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ): void => {
      if (areaName !== 'local' || !changes[DAPP_PENDING_APPROVAL_STORAGE_KEY]) return
      const next = parseDappPendingApproval(changes[DAPP_PENDING_APPROVAL_STORAGE_KEY].newValue)
      if (!next || next.id !== id) return
      if (next.status === 'approved') finish('approved')
      if (next.status === 'rejected') finish('rejected')
    }

    const timeout = setTimeout(() => finish('timeout'), Math.max(1000, timeoutMs))
    chrome.storage.onChanged.addListener(onStorageChanged)

    void getPendingApproval().then((pending) => {
      if (!pending || pending.id !== id) return
      if (pending.status === 'approved') finish('approved')
      if (pending.status === 'rejected') finish('rejected')
    })
  })
}

async function waitForRequestDecision(
  id: string,
  timeoutMs: number
): Promise<{ decision: RequestDecision; result?: unknown; error?: DappRequestError }> {
  return new Promise((resolve) => {
    let settled = false

    const finish = (
      decision: RequestDecision,
      result?: unknown,
      error?: DappRequestError
    ): void => {
      if (settled) return
      settled = true
      chrome.storage.onChanged.removeListener(onStorageChanged)
      clearTimeout(timeout)
      resolve({ decision, result, error })
    }

    const applyPending = (pending: DappPendingRequest | null): void => {
      if (!pending || pending.id !== id) return
      if (pending.status === 'executed' && pending.result) {
        finish('executed', pending.result)
        return
      }
      if (pending.status === 'failed') {
        finish('failed', undefined, pending.error || { code: -32603, message: 'Transaction failed' })
        return
      }
      if (pending.status === 'rejected') {
        finish('rejected')
      }
    }

    const onStorageChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ): void => {
      if (areaName !== 'local' || !changes[DAPP_PENDING_REQUEST_STORAGE_KEY]) return
      const next = parseDappPendingRequest(changes[DAPP_PENDING_REQUEST_STORAGE_KEY].newValue)
      applyPending(next)
    }

    const timeout = setTimeout(() => finish('timeout'), Math.max(1000, timeoutMs))
    chrome.storage.onChanged.addListener(onStorageChanged)

    void getPendingRequest().then((pending) => applyPending(pending))
  })
}

function normalizeDecimalCoinAmount(
  value: unknown,
  maxDecimals: number,
  label: string,
  options?: { required?: boolean; allowZero?: boolean }
): string | undefined {
  const required = options?.required ?? true
  const allowZero = options?.allowZero ?? false
  const amount = typeof value === 'string'
    ? value.trim()
    : (typeof value === 'number' ? String(value) : '')

  if (!amount) {
    if (required) {
      throw { code: -32602, message: `wallet_sendTransaction requires \`${label}\` as a decimal coin string` }
    }
    return undefined
  }
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw { code: -32602, message: `wallet_sendTransaction ${label} must be a positive decimal string` }
  }
  if (amount.includes('.') && amount.split('.')[1].length > maxDecimals) {
    throw { code: -32602, message: `wallet_sendTransaction supports up to ${maxDecimals} decimal places` }
  }
  if (!allowZero && Number(amount) <= 0) {
    throw { code: -32602, message: `wallet_sendTransaction ${label} must be greater than zero` }
  }
  if (allowZero && Number(amount) < 0) {
    throw { code: -32602, message: `wallet_sendTransaction ${label} must be zero or greater` }
  }
  return amount
}

function normalizeRpcQuantity(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw { code: -32602, message: `wallet_sendTransaction ${label} must be a non-negative integer or hex quantity` }
    }
    return String(value)
  }

  const text = String(value).trim()
  if (!text) return undefined
  if (/^\d+$/.test(text)) return text
  if (/^0x[0-9a-f]+$/i.test(text)) return text.toLowerCase()
  throw { code: -32602, message: `wallet_sendTransaction ${label} must be a non-negative integer or hex quantity` }
}

function parseSendTransactionParams(
  params: unknown,
  network: DappNetworkEntry | undefined,
  maxDecimals = 8
): SendTransactionParams {
  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') {
    throw { code: -32602, message: 'wallet_sendTransaction requires params { to, amount } or EVM tx params { data, value? }' }
  }

  const payload = candidate as Record<string, unknown>
  const data = String(payload.data ?? '').trim()
  if (data) {
    if (network?.coinType !== 'EVM') {
      throw { code: -32602, message: 'wallet_sendTransaction EVM tx payloads are only supported on EVM networks' }
    }
    if (!/^0x([0-9a-f]{2})*$/i.test(data)) {
      throw { code: -32602, message: 'wallet_sendTransaction data must be a 0x-prefixed hex string' }
    }

    const to = String(payload.to ?? payload.address ?? '').trim()
    const value = normalizeDecimalCoinAmount(payload.value ?? payload.amount ?? '0', maxDecimals, 'value', {
      required: false,
      allowZero: true
    }) || '0'
    const parsedGasLimit = normalizeRpcQuantity(payload.gasLimit, 'gasLimit')
    const parsedGasPrice = normalizeRpcQuantity(payload.gasPrice, 'gasPrice')
    const parsedMaxFeePerGas = normalizeRpcQuantity(payload.maxFeePerGas, 'maxFeePerGas')
    const parsedMaxPriorityFeePerGas = normalizeRpcQuantity(payload.maxPriorityFeePerGas, 'maxPriorityFeePerGas')
    const txTypeRaw = payload.type
    const txType = txTypeRaw === 2 || txTypeRaw === '2'
      ? 2
      : undefined
    if (txTypeRaw !== undefined && txType === undefined) {
      throw { code: -32602, message: 'wallet_sendTransaction only supports EVM transaction type 2' }
    }

    return {
      ...(to ? { to } : {}),
      value,
      data,
      ...(parsedGasLimit ? { gasLimit: parsedGasLimit } : {}),
      ...(parsedGasPrice ? { gasPrice: parsedGasPrice } : {}),
      ...(parsedMaxFeePerGas ? { maxFeePerGas: parsedMaxFeePerGas } : {}),
      ...(parsedMaxPriorityFeePerGas ? { maxPriorityFeePerGas: parsedMaxPriorityFeePerGas } : {}),
      ...(txType ? { type: txType } : {})
    }
  }

  const to = String(payload.to ?? payload.address ?? '').trim()
  if (!to) {
    throw { code: -32602, message: 'wallet_sendTransaction requires a recipient `to` address' }
  }

  const amount = normalizeDecimalCoinAmount(payload.amount ?? payload.value, maxDecimals, 'amount')
  if (!amount) {
    throw { code: -32602, message: 'wallet_sendTransaction requires `amount` as a decimal coin string' }
  }
  const memo = String(payload.memo ?? '').trim()

  return memo ? { to, amount, memo } : { to, amount }
}

function parseSendAssetParams(params: unknown): SendAssetParams {
  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') {
    throw { code: -32602, message: 'wallet_sendAsset requires params { assetId, qty, toAddress }' }
  }

  const payload = candidate as Record<string, unknown>
  const assetId = String(payload.assetId ?? payload.asset ?? payload.tokenId ?? '').trim()
  const toAddress = String(payload.toAddress ?? payload.to ?? payload.address ?? '').trim()
  const qtyRaw = payload.qty ?? payload.amount ?? payload.value
  const qty = typeof qtyRaw === 'string'
    ? qtyRaw.trim()
    : (typeof qtyRaw === 'number' ? String(qtyRaw) : '')
  const memo = String(payload.memo ?? '').trim()

  if (!assetId) throw { code: -32602, message: 'wallet_sendAsset requires `assetId`' }
  if (!toAddress) throw { code: -32602, message: 'wallet_sendAsset requires recipient `toAddress`' }
  if (!qty) throw { code: -32602, message: 'wallet_sendAsset requires `qty` as a decimal string' }
  if (!/^\d+(\.\d+)?$/.test(qty)) throw { code: -32602, message: 'wallet_sendAsset qty must be a positive decimal string' }
  if (Number(qty) <= 0) throw { code: -32602, message: 'wallet_sendAsset qty must be greater than zero' }

  return memo ? { assetId, qty, toAddress, memo } : { assetId, qty, toAddress }
}

function parseSignMessageParams(params: unknown): {
  ecosystem: 'evm' | 'solana'
  message?: string
  messageBase64?: string
  encoding?: 'utf8' | 'hex'
} {
  if (Array.isArray(params) && params.length >= 2) {
    const [first, second] = params
    const firstText = String(first ?? '').trim()
    const secondText = String(second ?? '').trim()
    const firstLooksAddress = /^0x[0-9a-f]{40}$/i.test(firstText)
    const message = firstLooksAddress ? secondText : firstText
    return {
      ecosystem: 'evm',
      message,
      encoding: /^0x[0-9a-f]*$/i.test(message) ? 'hex' : 'utf8'
    }
  }

  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') {
    throw { code: -32602, message: 'wallet_signMessage requires message params' }
  }

  const payload = candidate as Record<string, unknown>
  const ecosystem = String(payload.ecosystem || '').trim().toLowerCase() === 'solana' ? 'solana' : 'evm'
  if (ecosystem === 'solana') {
    const messageBase64 = String(payload.messageBase64 || '').trim()
    if (!messageBase64) {
      throw { code: -32602, message: 'wallet_signMessage requires `messageBase64` for Solana payloads' }
    }
    return { ecosystem, messageBase64 }
  }

  const message = String(payload.message ?? payload.data ?? '').trim()
  if (!message) {
    throw { code: -32602, message: 'wallet_signMessage requires `message`' }
  }
  return {
    ecosystem,
    message,
    encoding: String(payload.encoding || '').trim().toLowerCase() === 'hex' || /^0x[0-9a-f]*$/i.test(message) ? 'hex' : 'utf8'
  }
}

function resolveDappMethodMatrix(network?: DappNetworkEntry | null): DappMethodMatrix {
  const methods = new Set<string>([
    'wallet_getProviderState',
    'metayoshi_getProviderState',
    'rtm_getProviderState',
    'wallet_requestAccounts',
    'metayoshi_requestAccounts',
    'rtm_requestAccounts',
    'wallet_accounts',
    'metayoshi_accounts',
    'rtm_accounts',
    'wallet_connect',
    'metayoshi_connect',
    'rtm_connect',
    'wallet_selectAccount',
    'metayoshi_selectAccount',
    'rtm_selectAccount',
    'wallet_switchNetwork',
    'metayoshi_switchNetwork',
    'rtm_switchNetwork',
    'wallet_getNetworks',
    'metayoshi_getNetworks',
    'rtm_getNetworks',
    'wallet_getCapabilities',
    'metayoshi_getCapabilities',
    'rtm_getCapabilities',
    'wallet_sendTransaction',
    'metayoshi_sendTransaction',
    'rtm_sendTransaction',
    'wallet_sendAsset',
    'metayoshi_sendAsset',
    'rtm_sendAsset'
  ])
  const protocol = resolveDappProtocol(network)
  const matrix: DappMethodMatrix = {
    signMessage: false,
    signTypedData: false,
    signTransaction: false,
    signAllTransactions: false,
    signAndSendTransaction: false,
    cosmosGetKey: false,
    cosmosSignDirect: false,
    cosmosSignAmino: false,
    cosmosSendTx: false,
    methods: []
  }

  if (protocol === 'evm-jsonrpc') {
    matrix.signMessage = true
    matrix.signTypedData = true
    matrix.signTransaction = true
    matrix.signAndSendTransaction = true
    ;[
      'wallet_signMessage',
      'wallet_signTypedData',
      'wallet_signTransaction',
      'wallet_signAndSendTransaction',
      'eth_accounts',
      'eth_requestAccounts',
      'eth_chainId',
      'wallet_switchEthereumChain',
      'wallet_addEthereumChain',
      'eth_sendTransaction',
      'personal_sign',
      'eth_sign',
      'eth_signTypedData',
      'eth_signTypedData_v3',
      'eth_signTypedData_v4'
    ].forEach((method) => methods.add(method))
  } else if (protocol === 'solana-jsonrpc') {
    matrix.signMessage = true
    matrix.signTransaction = true
    matrix.signAllTransactions = true
    matrix.signAndSendTransaction = true
    ;[
      'wallet_signMessage',
      'wallet_signTransaction',
      'wallet_signAllTransactions',
      'wallet_signAndSendTransaction'
    ].forEach((method) => methods.add(method))
  } else if (protocol === 'cosmos-rest-bridge') {
    matrix.cosmosGetKey = true
    matrix.cosmosSignDirect = true
    matrix.cosmosSignAmino = true
    matrix.cosmosSendTx = true
    ;[
      'wallet_cosmosGetKey',
      'wallet_cosmosSignDirect',
      'wallet_cosmosSignAmino',
      'wallet_cosmosSendTx'
    ].forEach((method) => methods.add(method))
  }

  matrix.methods = [...methods]
  return matrix
}

function parseSignTypedDataParams(params: unknown): { typedData: unknown } {
  const payload = Array.isArray(params)
    ? (params.length >= 2 ? params[1] : params[0])
    : params
  if (payload === undefined || payload === null) {
    throw { code: -32602, message: 'wallet_signTypedData requires typed data params' }
  }
  return { typedData: payload }
}

function parseEvmTransactionRequest(params: unknown): { tx: Record<string, unknown> } {
  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') {
    throw { code: -32602, message: 'eth_sendTransaction requires a transaction object' }
  }
  return { tx: candidate as Record<string, unknown> }
}

function parseSignTransactionParams(params: unknown): { ecosystem: 'evm' | 'solana'; tx?: Record<string, unknown>; serializedTxBase64?: string } {
  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') {
    throw { code: -32602, message: 'wallet_signTransaction requires params' }
  }
  const payload = candidate as Record<string, unknown>
  const ecosystem = String(payload.ecosystem || '').trim().toLowerCase() === 'solana' ? 'solana' : 'evm'
  if (ecosystem === 'solana') {
    const serializedTxBase64 = String(payload.serializedTxBase64 || '').trim()
    if (!serializedTxBase64) throw { code: -32602, message: 'wallet_signTransaction requires `serializedTxBase64` for Solana payloads' }
    return { ecosystem, serializedTxBase64 }
  }
  return { ecosystem, tx: payload.tx && typeof payload.tx === 'object' ? payload.tx as Record<string, unknown> : payload }
}

function parseSignAllTransactionsParams(params: unknown): { ecosystem: 'solana'; serializedTxsBase64: string[] } {
  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') {
    throw { code: -32602, message: 'wallet_signAllTransactions requires params' }
  }
  const payload = candidate as Record<string, unknown>
  const serializedTxsBase64 = Array.isArray(payload.serializedTxsBase64)
    ? payload.serializedTxsBase64.map((entry) => String(entry || '').trim()).filter(Boolean)
    : []
  if (serializedTxsBase64.length === 0) {
    throw { code: -32602, message: 'wallet_signAllTransactions requires `serializedTxsBase64`' }
  }
  return { ecosystem: 'solana', serializedTxsBase64 }
}

function parseSignAndSendTransactionParams(params: unknown): { ecosystem: 'solana'; serializedTxBase64: string } {
  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') {
    throw { code: -32602, message: 'wallet_signAndSendTransaction requires params' }
  }
  const payload = candidate as Record<string, unknown>
  const serializedTxBase64 = String(payload.serializedTxBase64 || '').trim()
  if (!serializedTxBase64) {
    throw { code: -32602, message: 'wallet_signAndSendTransaction requires `serializedTxBase64`' }
  }
  return { ecosystem: 'solana', serializedTxBase64 }
}

function parseCosmosSignDirectParams(params: unknown): { signDoc: any } {
  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') {
    throw { code: -32602, message: 'wallet_cosmosSignDirect requires params' }
  }
  const payload = candidate as Record<string, unknown>
  if (!payload.signDoc || typeof payload.signDoc !== 'object') {
    throw { code: -32602, message: 'wallet_cosmosSignDirect requires `signDoc`' }
  }
  return { signDoc: payload.signDoc }
}

function parseCosmosSignAminoParams(params: unknown): { signDoc: any } {
  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') {
    throw { code: -32602, message: 'wallet_cosmosSignAmino requires params' }
  }
  const payload = candidate as Record<string, unknown>
  if (!payload.signDoc || typeof payload.signDoc !== 'object') {
    throw { code: -32602, message: 'wallet_cosmosSignAmino requires `signDoc`' }
  }
  return { signDoc: payload.signDoc }
}

function parseCosmosSendTxParams(params: unknown): { txBytesBase64: string; mode?: 'BROADCAST_MODE_SYNC' | 'BROADCAST_MODE_ASYNC' | 'BROADCAST_MODE_BLOCK' } {
  const candidate = Array.isArray(params) ? params[0] : params
  if (!candidate || typeof candidate !== 'object') {
    throw { code: -32602, message: 'wallet_cosmosSendTx requires params' }
  }
  const payload = candidate as Record<string, unknown>
  const txBytesBase64 = String(payload.txBytesBase64 || payload.tx || '').trim()
  if (!txBytesBase64) {
    throw { code: -32602, message: 'wallet_cosmosSendTx requires `txBytesBase64`' }
  }
  const modeRaw = String(payload.mode || '').trim().toUpperCase()
  const mode = modeRaw === 'BROADCAST_MODE_BLOCK' || modeRaw === 'BROADCAST_MODE_ASYNC' || modeRaw === 'BROADCAST_MODE_SYNC'
    ? modeRaw as 'BROADCAST_MODE_SYNC' | 'BROADCAST_MODE_ASYNC' | 'BROADCAST_MODE_BLOCK'
    : undefined
  return { txBytesBase64, ...(mode ? { mode } : {}) }
}

async function requestDappActionApproval(
  origin: string,
  networkId: string,
  accountId: string,
  method: DappRequestMethod,
  request: unknown
): Promise<unknown> {
  const normalizedOrigin = normalizeDappOrigin(origin)
  if (!normalizedOrigin || normalizedOrigin === 'unknown') {
    throw { code: 4001, message: 'Untrusted origin' }
  }

  const now = Date.now()
  const pending = await getPendingRequest()
  const pendingRequestActive =
    Boolean(pending)
    && (pending?.status === 'pending' || pending?.status === 'approved')
    && pending.expiresAt > now

  if (pending && pendingRequestActive) {
    const sameRequest =
      pending.origin === normalizedOrigin
      && pending.networkId === networkId
      && pending.accountId === accountId
      && pending.method === method
      && areRequestsEquivalent(pending.request, request)

    if (sameRequest) {
      void recordBridgeTrace('background-sw', 'request-approval-reuse', {
        requestId: pending.id,
        origin: normalizedOrigin,
        method,
        status: pending.status
      })
      const existingPopup = pending.status === 'pending' ? await findManagedPopupWindow() : null
      if (pending.status === 'pending' && !existingPopup?.id) {
        try {
          await openRequestPopup(pending.id, pending.method, pending.request)
        } catch {
          // Preserve the original pending request and keep waiting for it.
        }
      }
      const decision = await waitForRequestDecision(
        pending.id,
        getPendingTimeoutMs(pending.expiresAt, DAPP_APPROVAL_TIMEOUT_MS)
      )
      if (decision.decision === 'executed' && decision.result) {
        await clearPendingRequestIfMatch(pending.id)
        return decision.result
      }
      await clearPendingRequestIfMatch(pending.id)
      if (decision.decision === 'rejected' || decision.decision === 'timeout') {
        throw { code: 4001, message: 'User rejected the request' }
      }
      throw {
        code: decision.error?.code ?? -32603,
        message: decision.error?.message ?? 'Transaction failed'
      }
    }
    throw { code: 4001, message: 'Another wallet request is already pending approval' }
  }

  const requestId = globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(16).slice(2)}`
  const nextPending: DappPendingRequest = {
    id: requestId,
    origin: normalizedOrigin,
    method,
    networkId,
    accountId,
    request,
    status: 'pending',
    requestedAt: now,
    updatedAt: now,
    expiresAt: now + DAPP_APPROVAL_TIMEOUT_MS
  }

  await setPendingRequest(nextPending)
  void recordBridgeTrace('background-sw', 'request-approval-created', {
    requestId,
    origin: normalizedOrigin,
    method,
    networkId,
    accountId,
    request: summarizeTraceValue(request)
  })

  try {
    await openRequestPopup(requestId, method, request)
  } catch {
    await clearPendingRequestIfMatch(requestId)
    throw { code: 4001, message: 'Unable to open wallet approval popup' }
  }

  const decision = await waitForRequestDecision(requestId, DAPP_APPROVAL_TIMEOUT_MS)
  void recordBridgeTrace('background-sw', 'request-approval-decision', {
    requestId,
    decision: decision.decision,
    errorCode: decision.error?.code,
    errorMessage: decision.error?.message
  })
  if (decision.decision === 'executed' && decision.result) {
    await clearPendingRequestIfMatch(requestId)
    return decision.result
  }
  await clearPendingRequestIfMatch(requestId)
  if (decision.decision === 'rejected' || decision.decision === 'timeout') {
    throw { code: 4001, message: 'User rejected the request' }
  }
  throw {
    code: decision.error?.code ?? -32603,
    message: decision.error?.message ?? 'Transaction failed'
  }
}

// Request scope permission(s) in a single approval popup.
async function requestScopes(
  origin: string,
  scopes: DappScope[],
  options?: { networkId?: string }
): Promise<boolean> {
  const normalizedOrigin = normalizeDappOrigin(origin)
  if (!normalizedOrigin || normalizedOrigin === 'unknown') return false

  const desiredScopes = uniqDappScopes(scopes)
  if (desiredScopes.length === 0) return false

  const missingScopes: DappScope[] = []
  for (const scope of desiredScopes) {
    if (!(await hasScope(normalizedOrigin, scope))) {
      missingScopes.push(scope)
    }
  }
  if (missingScopes.length === 0) {
    return true
  }

  const now = Date.now()
  const pending = await getPendingApproval()
  const reuseExistingApproval =
    Boolean(pending)
    && pending?.status === 'pending'
    && pending?.origin === normalizedOrigin
    && pending.expiresAt > now

  if (
    pending &&
    pending.status === 'pending' &&
    pending.origin !== normalizedOrigin &&
    pending.expiresAt > now
  ) {
    return false
  }

  const approvalId = pending?.origin === normalizedOrigin && pending.status === 'pending'
    ? pending.id
    : (globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(16).slice(2)}`)

  const nextPending: DappPendingApproval = {
    id: approvalId,
    origin: normalizedOrigin,
    scopes: uniqDappScopes([...(pending?.origin === normalizedOrigin ? pending.scopes : []), ...missingScopes]),
    networkId: String(options?.networkId || '').trim() || undefined,
    status: 'pending',
    requestedAt: pending?.origin === normalizedOrigin ? pending.requestedAt : now,
    updatedAt: now,
    expiresAt: now + DAPP_APPROVAL_TIMEOUT_MS
  }

  await setPendingApproval(nextPending)
  void recordBridgeTrace('background-sw', 'scope-approval-upsert', {
    approvalId,
    origin: normalizedOrigin,
    scopes: nextPending.scopes,
    networkId: nextPending.networkId,
    reused: reuseExistingApproval
  })

  try {
    const existingPopup = reuseExistingApproval ? await findManagedPopupWindow() : null
    if (!existingPopup?.id) {
      await openApprovalPopup()
    }
  } catch {
    await clearPendingApprovalIfMatch(approvalId)
    return false
  }

  const decision = await waitForApprovalDecision(
    approvalId,
    reuseExistingApproval
      ? getPendingTimeoutMs(nextPending.expiresAt, DAPP_APPROVAL_TIMEOUT_MS)
      : DAPP_APPROVAL_TIMEOUT_MS
  )
  void recordBridgeTrace('background-sw', 'scope-approval-decision', {
    approvalId,
    origin: normalizedOrigin,
    decision
  })
  if (decision !== 'approved') {
    await clearPendingApprovalIfMatch(approvalId)
    return false
  }

  await grantScopes(normalizedOrigin, nextPending.scopes)
  await clearPendingApprovalIfMatch(approvalId)
  return true
}

// Request one scope helper
async function requestScope(origin: string, scope: DappScope): Promise<boolean> {
  return requestScopes(origin, [scope])
}

type DappRuntimeContext = {
  state: WalletState
  dappNetworks: DappNetworkEntry[]
  network: DappNetworkEntry | undefined
  effectiveNetworkId: string
  address: string | null
  connected: boolean
  unlocked: boolean
  providerState: {
    connected: boolean
    unlocked: boolean
    coinId: string | null
    coinName: string | null
    coinSymbol: string | null
    coinDecimals: number
    chainId: string | null
    networkId: string | null
    networkLabel: string | null
    accounts: string[]
    selectedAddress: string | null
  }
}

function buildDappRuntimeContext(state: WalletState, requestedNetworkId?: string): DappRuntimeContext {
  const dappNetworks = resolveDappNetworks(state)
  const normalizedRequestedNetworkId = String(requestedNetworkId || '').trim()
  const network = dappNetworks.find((n) => n.id === normalizedRequestedNetworkId)
    || dappNetworks.find((n) => n.id === state.activeNetworkId)
    || dappNetworks[0]
  const effectiveNetworkId = network?.id || DEFAULT_NETWORK_ID
  const address = getActiveAddressFromState(state, effectiveNetworkId)
  const connected = !(state.isLocked ?? true) && (state.isInitialized ?? false) && address !== null
  const unlocked = !(state.isLocked ?? true) && (state.isInitialized ?? false)

  return {
    state,
    dappNetworks,
    network,
    effectiveNetworkId,
    address,
    connected,
    unlocked,
    providerState: {
      connected,
      unlocked,
      coinId: network?.id || null,
      coinName: network?.name || null,
      coinSymbol: network?.symbol || null,
      coinDecimals: resolveCoinDecimals(network),
      chainId: network?.chainId?.toString() || network?.id || null,
      networkId: network?.id || null,
      networkLabel: network?.name || null,
      accounts: address ? [address] : [],
      selectedAddress: address
    }
  }
}

// Handle RPC methods
async function handleRpcMethod(method: string, params: any, origin?: string): Promise<any> {
  const normalizedOrigin = origin ? normalizeDappOrigin(origin) : null
  if (normalizedOrigin && isBlockedInternalDappOrigin(normalizedOrigin)) {
    throw { code: 4001, message: DAPP_BLOCKED_INTERNAL_ORIGIN_MESSAGE }
  }

  const walletState = await getWalletState()
  const dappNetworks = resolveDappNetworks(walletState)
  const requestedNetwork = resolveRequestedDappNetwork(dappNetworks, params)
  if (requestedNetwork.hintProvided && !requestedNetwork.network) {
    throw {
      code: -32602,
      message: `Unsupported network for MetaYoshi DApp SDK: ${requestedNetwork.hintSummary || 'unknown'}`
    }
  }

  let runtimeNetworkId = requestedNetwork.network?.id
  if (!runtimeNetworkId && (
    ETHEREUM_ACCOUNTS_METHODS.has(method)
    || ETHEREUM_REQUEST_ACCOUNTS_METHODS.has(method)
    || ETHEREUM_CHAIN_ID_METHODS.has(method)
    || ETHEREUM_SWITCH_CHAIN_METHODS.has(method)
    || ETHEREUM_ADD_CHAIN_METHODS.has(method)
    || ETHEREUM_SEND_TRANSACTION_METHODS.has(method)
    || ETHEREUM_SIGN_METHODS.has(method)
    || ETHEREUM_SIGN_TYPED_DATA_METHODS.has(method)
  )) {
    runtimeNetworkId = findNetworkByCoinType(walletState, 'EVM')?.id
  }
  if (!runtimeNetworkId && (
    SIGN_TRANSACTION_METHODS.has(method)
    || SIGN_ALL_TRANSACTIONS_METHODS.has(method)
    || SIGN_AND_SEND_TRANSACTION_METHODS.has(method)
  )) {
    runtimeNetworkId = findNetworkByRuntimeModel(walletState, 'sol')?.id || findNetworkByCoinType(walletState, 'SOL')?.id
  }
  if (!runtimeNetworkId && (
    COSMOS_GET_KEY_METHODS.has(method)
    || COSMOS_SIGN_DIRECT_METHODS.has(method)
    || COSMOS_SIGN_AMINO_METHODS.has(method)
    || COSMOS_SEND_TX_METHODS.has(method)
  )) {
    runtimeNetworkId = findNetworkByCoinType(walletState, 'COSMOS')?.id || findNetworkByRuntimeModel(walletState, 'cosmos')?.id
  }

  const runtime = buildDappRuntimeContext(walletState, runtimeNetworkId)
  const {
    state,
    network,
    effectiveNetworkId,
    address,
    connected,
    unlocked,
    providerState
  } = runtime
  
  // Provider state methods
  if (PROVIDER_STATE_METHODS.has(method)) {
    return providerState
  }

  if (CONNECT_METHODS.has(method)) {
    if (origin) {
      const approved = await requestScopes(origin, ['read'], { networkId: effectiveNetworkId })
      if (!approved) {
        throw { code: 4001, message: 'User rejected the request' }
      }
      await touchLastConnected(origin)
    }

    const refreshed = buildDappRuntimeContext(await getWalletState(), network?.id)
    if (!(refreshed.state.isInitialized ?? false) || !(refreshed.state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!refreshed.address) {
      throw { code: -32603, message: 'No account available' }
    }
    return refreshed.providerState
  }

  if (CAPABILITIES_METHODS.has(method)) {
    const netCaps = resolveNetworkCapabilities(network || {})
    const methodMatrix = resolveDappMethodMatrix(network)
    const features = {
      nativeSend: Boolean(netCaps.features.nativeSend),
      signMessage: Boolean(
        methodMatrix.signMessage
        || methodMatrix.signTypedData
        || methodMatrix.signTransaction
        || methodMatrix.signAllTransactions
        || methodMatrix.signAndSendTransaction
        || methodMatrix.cosmosGetKey
        || methodMatrix.cosmosSignDirect
        || methodMatrix.cosmosSignAmino
      ),
      assetLayer: Boolean(netCaps.features.assetLayer),
      assetSend: Boolean(netCaps.features.assetSend)
    }
    return {
      wallet: { isMetaYoshi: true, connected, unlocked },
      network: {
        id: network?.id || null,
        runtimeModelId: String((network as any)?.runtimeModelId || '').trim() || null,
        name: network?.name || null,
        symbol: network?.symbol || null,
        coinType: network?.coinType || null
      },
      features,
      scopes: {
        read: true,
        sign: features.signMessage,
        send_coin: features.nativeSend,
        send_asset: features.assetSend,
        select_account: true,
        switch_network: true
      },
      methods: methodMatrix.methods,
      networks: dappNetworks.map((n) => buildDappNetworkDescriptor(n, n.id === effectiveNetworkId))
    }
  }

  if (NETWORKS_METHODS.has(method)) {
    return dappNetworks.map((n) => buildDappNetworkDescriptor(n, n.id === effectiveNetworkId))
  }
  
  // Request accounts / enable
  if (REQUEST_ACCOUNTS_METHODS.has(method)) {
    if (origin) {
      const approved = await requestScopes(origin, ['read'], { networkId: effectiveNetworkId })
      if (!approved) {
        throw { code: 4001, message: 'User rejected the request' }
      }
      await touchLastConnected(origin)
    }

    const refreshed = buildDappRuntimeContext(await getWalletState(), network?.id)
    if (!(refreshed.state.isInitialized ?? false) || !(refreshed.state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!refreshed.address) {
      throw { code: -32603, message: 'No account available' }
    }

    return [refreshed.address]
  }
  
  // Get accounts
  if (ACCOUNTS_METHODS.has(method)) {
    if ((state.isLocked ?? true) || !(state.isInitialized ?? false)) {
      return []
    }

    const currentAddress = getActiveAddressFromState(state, effectiveNetworkId)
    return currentAddress ? [currentAddress] : []
  }

  if (ETHEREUM_CHAIN_ID_METHODS.has(method)) {
    if (!network || network.coinType !== 'EVM') {
      throw { code: 4900, message: 'No EVM network is available' }
    }
    return `0x${Number(network.chainId || 0).toString(16)}`
  }

  if (ETHEREUM_ACCOUNTS_METHODS.has(method)) {
    if ((state.isLocked ?? true) || !(state.isInitialized ?? false) || !network || network.coinType !== 'EVM') {
      return []
    }
    return address ? [address] : []
  }

  if (ETHEREUM_REQUEST_ACCOUNTS_METHODS.has(method)) {
    const approvedOrigin = await requireDappScopes(origin, ['read'])
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    const refreshed = buildDappRuntimeContext(await getWalletState(), network?.id)
    if (!refreshed.network || refreshed.network.coinType !== 'EVM') {
      throw { code: 4900, message: 'No EVM network is available' }
    }
    await touchLastConnected(approvedOrigin)
    return refreshed.address ? [refreshed.address] : []
  }

  if (ETHEREUM_SWITCH_CHAIN_METHODS.has(method)) {
    const approvedOrigin = await requireDappScopes(origin, ['read', 'switch_network'])
    const payload = Array.isArray(params) ? params[0] : params
    const chainId = parseRequestedChainId((payload as Record<string, unknown> | null)?.chainId)
    if (chainId === null) {
      throw { code: -32602, message: 'wallet_switchEthereumChain requires `chainId`' }
    }
    const nextNetwork = resolveDappNetworks(state).find((entry) => entry.coinType === 'EVM' && entry.chainId === chainId)
    if (!nextNetwork) {
      throw { code: 4902, message: `Unknown EVM chain ${chainId}` }
    }
    await updateWalletStateInStorage((current) => ({
      ...current,
      activeNetworkId: nextNetwork.id
    }))
    await touchLastConnected(approvedOrigin)
    broadcastEvent('networkChanged', {
      networkId: nextNetwork.id,
      networkLabel: nextNetwork.name,
      coinId: nextNetwork.id,
      coinName: nextNetwork.name,
      coinSymbol: nextNetwork.symbol,
      coinDecimals: resolveCoinDecimals(nextNetwork)
    })
    return null
  }

  if (ETHEREUM_ADD_CHAIN_METHODS.has(method)) {
    const payload = Array.isArray(params) ? params[0] : params
    const chainId = parseRequestedChainId((payload as Record<string, unknown> | null)?.chainId)
    if (chainId === null) {
      throw { code: -32602, message: 'wallet_addEthereumChain requires `chainId`' }
    }
    const knownNetwork = resolveDappNetworks(state).find((entry) => entry.coinType === 'EVM' && entry.chainId === chainId)
    if (!knownNetwork) {
      throw { code: 4902, message: `Unknown EVM chain ${chainId}` }
    }
    return null
  }

  if (SIGN_MESSAGE_METHODS.has(method) || ETHEREUM_SIGN_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network) {
      throw { code: 4900, message: 'No network is available' }
    }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) {
      throw { code: -32603, message: 'No account available' }
    }
    const scopes: DappScope[] = ['read', 'sign']
    if (origin) {
      const approved = await requestScopes(origin, scopes, { networkId: effectiveNetworkId })
      if (!approved) throw { code: 4001, message: 'User rejected the request' }
      await touchLastConnected(origin)
    }
    const signPayload = parseSignMessageParams(params)
    return await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_signMessage',
      signPayload
    )
  }

  if (SIGN_TYPED_DATA_METHODS.has(method) || ETHEREUM_SIGN_TYPED_DATA_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network || network.coinType !== 'EVM') {
      throw { code: 4900, message: 'No EVM network is available' }
    }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) {
      throw { code: -32603, message: 'No account available' }
    }
    if (origin) {
      const approved = await requestScopes(origin, ['read', 'sign'], { networkId: effectiveNetworkId })
      if (!approved) throw { code: 4001, message: 'User rejected the request' }
      await touchLastConnected(origin)
    }
    return await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_signTypedData',
      parseSignTypedDataParams(params)
    )
  }

  if (SIGN_TRANSACTION_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network) throw { code: 4900, message: 'No network is available' }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) throw { code: -32603, message: 'No account available' }
    if (origin) {
      const approved = await requestScopes(origin, ['read', 'sign'], { networkId: effectiveNetworkId })
      if (!approved) throw { code: 4001, message: 'User rejected the request' }
      await touchLastConnected(origin)
    }
    return await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_signTransaction',
      parseSignTransactionParams(params)
    )
  }

  if (SIGN_ALL_TRANSACTIONS_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network) throw { code: 4900, message: 'No network is available' }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) throw { code: -32603, message: 'No account available' }
    if (origin) {
      const approved = await requestScopes(origin, ['read', 'sign'], { networkId: effectiveNetworkId })
      if (!approved) throw { code: 4001, message: 'User rejected the request' }
      await touchLastConnected(origin)
    }
    return await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_signAllTransactions',
      parseSignAllTransactionsParams(params)
    )
  }

  if (SIGN_AND_SEND_TRANSACTION_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network) throw { code: 4900, message: 'No network is available' }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) throw { code: -32603, message: 'No account available' }
    if (origin) {
      const approved = await requestScopes(origin, ['read', 'sign', 'send_coin'], { networkId: effectiveNetworkId })
      if (!approved) throw { code: 4001, message: 'User rejected the request' }
      await touchLastConnected(origin)
    }
    return await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_signAndSendTransaction',
      parseSignAndSendTransactionParams(params)
    )
  }

  if (COSMOS_GET_KEY_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network) throw { code: 4900, message: 'No network is available' }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) throw { code: -32603, message: 'No account available' }
    if (origin) {
      const approved = await requestScopes(origin, ['read'], { networkId: effectiveNetworkId })
      if (!approved) throw { code: 4001, message: 'User rejected the request' }
      await touchLastConnected(origin)
    }
    return await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_cosmosGetKey',
      { chainId: String((params as any)?.chainId || '') }
    )
  }

  if (COSMOS_SIGN_DIRECT_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network) throw { code: 4900, message: 'No network is available' }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) throw { code: -32603, message: 'No account available' }
    if (origin) {
      const approved = await requestScopes(origin, ['read', 'sign'], { networkId: effectiveNetworkId })
      if (!approved) throw { code: 4001, message: 'User rejected the request' }
      await touchLastConnected(origin)
    }
    return await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_cosmosSignDirect',
      parseCosmosSignDirectParams(params)
    )
  }

  if (COSMOS_SIGN_AMINO_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network) throw { code: 4900, message: 'No network is available' }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) throw { code: -32603, message: 'No account available' }
    if (origin) {
      const approved = await requestScopes(origin, ['read', 'sign'], { networkId: effectiveNetworkId })
      if (!approved) throw { code: 4001, message: 'User rejected the request' }
      await touchLastConnected(origin)
    }
    return await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_cosmosSignAmino',
      parseCosmosSignAminoParams(params)
    )
  }

  if (COSMOS_SEND_TX_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network) throw { code: 4900, message: 'No network is available' }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) throw { code: -32603, message: 'No account available' }
    if (origin) {
      const approved = await requestScopes(origin, ['read', 'send_coin'], { networkId: effectiveNetworkId })
      if (!approved) throw { code: 4001, message: 'User rejected the request' }
      await touchLastConnected(origin)
    }
    return await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_cosmosSendTx',
      parseCosmosSendTxParams(params)
    )
  }

  if (ETHEREUM_SEND_TRANSACTION_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network || network.coinType !== 'EVM') {
      throw { code: 4900, message: 'No EVM network is available' }
    }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) throw { code: -32603, message: 'No account available' }
    if (origin) {
      const approved = await requestScopes(origin, ['read', 'send_coin'], { networkId: effectiveNetworkId })
      if (!approved) throw { code: 4001, message: 'User rejected the request' }
      await touchLastConnected(origin)
    }
    return await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_signAndSendTransaction',
      { ecosystem: 'evm', ...parseEvmTransactionRequest(params) }
    )
  }

  if (SEND_TRANSACTION_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network || !resolveNetworkCapabilities(network).features.nativeSend) {
      throw { code: -32603, message: 'No supported send-capable network selected' }
    }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) {
      throw { code: -32603, message: 'No account available' }
    }

    if (origin) {
      const approved = await requestScopes(origin, ['read', 'send_coin'], { networkId: effectiveNetworkId })
      if (!approved) {
        throw { code: 4001, message: 'User rejected the request' }
      }
      await touchLastConnected(origin)
    }

    const parsedSend = parseSendTransactionParams(params, network, resolveCoinDecimals(network))
    const result = await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_sendTransaction',
      parsedSend
    )
    return result
  }

  if (SEND_ASSET_METHODS.has(method)) {
    if (!(state.isInitialized ?? false) || !(state.hasVault ?? false)) {
      throw { code: -32603, message: 'Wallet is not initialized' }
    }
    if (!network || !resolveNetworkCapabilities(network).features.assetSend) {
      throw { code: -32603, message: 'No supported asset-send network selected' }
    }
    const activeAccount = state.accounts?.find((a) => a.id === state.activeAccountId) || state.accounts?.[0]
    if (!activeAccount) {
      throw { code: -32603, message: 'No account available' }
    }

    if (origin) {
      const approved = await requestScopes(origin, ['read', 'send_asset'], { networkId: effectiveNetworkId })
      if (!approved) {
        throw { code: 4001, message: 'User rejected the request' }
      }
      await touchLastConnected(origin)
    }

    const parsedSendAsset = parseSendAssetParams(params)
    const result = await requestDappActionApproval(
      origin || 'unknown',
      network.id,
      activeAccount.id,
      'wallet_sendAsset',
      parsedSendAsset
    )
    return result
  }
  
  // Select account
  if (SELECT_ACCOUNT_METHODS.has(method)) {
    await requireDappScopes(origin, ['read', 'select_account'])

    const { index } = params || {}
    if (typeof index !== 'number') {
      throw { code: -32602, message: 'Account index is required' }
    }
    
    const currentState = await getWalletState()
    const account = currentState.accounts?.[index]
    if (!account) {
      throw { code: -32602, message: 'Invalid account index' }
    }
    
    // Update active account in storage
    await updateWalletStateInStorage((current) => ({
      ...current,
      activeAccountId: account.id
    }))

    const refreshedState = await getWalletState()
    const address = getActiveAddressFromState(refreshedState, refreshedState.activeNetworkId || DEFAULT_NETWORK_ID)
    broadcastEvent('accountsChanged', {
      accounts: address ? [address] : [],
      address
    })
    return {
      selectedAddress: address,
      accounts: address ? [address] : []
    }
  }
  
  // Switch network
  if (SWITCH_NETWORK_METHODS.has(method)) {
    await requireDappScopes(origin, ['read', 'switch_network'])

    const { networkId } = params || {}
    if (!networkId) {
      throw { code: -32602, message: 'Network ID is required' }
    }
    
    const currentState = await getWalletState()
    const normalizedNetworkId = String(networkId).trim()
    const network = resolveDappNetworks(currentState).find((n) => n.id === normalizedNetworkId)
    if (!network) {
      throw { code: -32602, message: `Unsupported network for MetaYoshi DApp SDK: ${networkId}` }
    }
    
    // Update active network in storage
    await updateWalletStateInStorage((current) => ({
      ...current,
      activeNetworkId: normalizedNetworkId
    }))
    
    // Broadcast network change event
    broadcastEvent('networkChanged', {
      networkId: normalizedNetworkId,
      networkLabel: network.name,
      coinId: network.id,
      coinName: network.name,
      coinSymbol: network.symbol,
      coinDecimals: resolveCoinDecimals(network)
    })
    
    return { networkId: normalizedNetworkId, networkLabel: network.name }
  }
  
  // Unsupported method
  throw { code: -32601, message: `Method not found: ${method}` }
}

// Broadcast event to all connected content scripts
function broadcastEvent(event: string, payload: any): void {
  if (eventPorts.size === 0) return
  const message = { type: 'event', event, payload }
  for (const port of eventPorts) {
    try {
      port.postMessage(message)
    } catch (err) {
      // Port closed, remove it
      eventPorts.delete(port)
    }
  }
}

function handleWalletStorageBroadcast(
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
): void {
  if (eventPorts.size === 0) return
  if (areaName !== 'local' || !changes[WALLET_STORAGE_KEY]) return

  const newValue = changes[WALLET_STORAGE_KEY].newValue
  const oldValue = changes[WALLET_STORAGE_KEY].oldValue
  const newState = unwrapPersistedState<WalletState>(newValue)
  const oldState = unwrapPersistedState<WalletState>(oldValue)

  if (!newState || !oldState) return

  const dappNetworks = resolveDappNetworks(newState)
  const activeDappNetwork = dappNetworks.find((n) => n.id === newState.activeNetworkId) || dappNetworks[0]
  const activeDappNetworkId = activeDappNetwork?.id || DEFAULT_NETWORK_ID

  if (
    newState.activeAccountId !== oldState.activeAccountId ||
    JSON.stringify(newState.accounts) !== JSON.stringify(oldState.accounts)
  ) {
    const address = getActiveAddressFromState(newState, activeDappNetworkId)
    broadcastEvent('accountsChanged', {
      accounts: address ? [address] : [],
      address
    })
  }

  if (newState.activeNetworkId !== oldState.activeNetworkId) {
    const network = resolveDappNetworks(newState).find((n) => n.id === newState.activeNetworkId)
    if (network && String(network.id || '').trim()) {
      broadcastEvent('networkChanged', {
        networkId: network.id,
        networkLabel: network.name,
        coinId: network.id,
        coinName: network.name,
        coinSymbol: network.symbol,
        coinDecimals: resolveCoinDecimals(network)
      })
    }
  }

  if (newState.isLocked !== oldState.isLocked) {
    broadcastEvent('lockChanged', {
      unlocked: !(newState.isLocked ?? true)
    })

    if (newState.isLocked) {
      broadcastEvent('accountsChanged', {
        accounts: [],
        address: null
      })
    }
  }
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message: DappRequest | MonitorRequest, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) => {
  if (message?.type === 'METAYOSHI_MONITOR_GET_ERRORS') {
    void getRuntimeErrorLog()
      .then((errors) => sendResponse({ ok: true, errors }))
      .catch((err) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      })
    return true
  }

  if (message?.type === 'METAYOSHI_MONITOR_CLEAR_ERRORS') {
    void clearRuntimeErrorLog()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      })
    return true
  }

  if (message?.type === 'METAYOSHI_MONITOR_GET_BRIDGE_TRACE') {
    void getBridgeTraceLog()
      .then((entries) => sendResponse({ ok: true, entries }))
      .catch((err) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      })
    return true
  }

  if (message?.type === 'METAYOSHI_MONITOR_CLEAR_BRIDGE_TRACE') {
    void clearBridgeTraceLog()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      })
    return true
  }

  if (message.type === 'DAPP_INTERNAL_RPC') {
    const { request, origin } = message
    const originUrl = origin || sender?.origin || sender?.url || 'unknown'

    void recordBridgeTrace('background-sw', 'rpc-received', {
      method: request?.method,
      origin: originUrl,
      requestId: request?.id ?? null,
      params: summarizeTraceValue(request?.params),
      senderOrigin: sender?.origin || null,
      senderUrl: sender?.url || null
    })
    
    handleRpcMethod(request.method, request.params, originUrl)
      .then((result) => {
        void recordBridgeTrace('background-sw', 'rpc-result', {
          method: request?.method,
          origin: originUrl,
          requestId: request?.id ?? null,
          result: summarizeTraceValue(result)
        })
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result
        }
        sendResponse({ ok: true, jsonRpc: response })
      })
      .catch((err) => {
        void recordRuntimeError('background-sw', err, {
          kind: 'dapp-rpc',
          method: request.method,
          origin: originUrl
        })
        void recordBridgeTrace('background-sw', 'rpc-error', {
          method: request?.method,
          origin: originUrl,
          requestId: request?.id ?? null,
          code: err?.code ?? null,
          message: err?.message ?? String(err ?? 'Unknown error'),
          data: summarizeTraceValue(err?.data)
        })
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: request.id ?? null,
          error: {
            code: err.code || -32603,
            message: err.message || 'Internal error',
            data: err.data
          }
        }
        sendResponse({ ok: true, jsonRpc: response })
      })
    
    return true // Keep channel open for async response
  }
  
  return false
})

// Handle event port connections
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name === BG_EVENT_PORT_NAME) {
    eventPorts.add(port)
    
    port.onDisconnect.addListener(() => {
      eventPorts.delete(port)
    })
    
    // Send ready event
    port.postMessage({
      type: 'ready',
      events: ['accountsChanged', 'networkChanged', 'lockChanged']
    })
  }
})

if (!chrome.storage.onChanged.hasListener(handleWalletStorageBroadcast)) {
  chrome.storage.onChanged.addListener(handleWalletStorageBroadcast)
}

if (chrome.windows?.onBoundsChanged?.addListener) {
  chrome.windows.onBoundsChanged.addListener((win) => {
    if (typeof win.id !== 'number') return
    if (!managedPopupWindowIds.has(win.id)) return
    void enforceManagedPopupBounds(win.id)
    void enforceSingleManagedPopupWindow()
  })
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (managedPopupWindowId === windowId) {
    managedPopupWindowId = null
  }
  managedPopupWindowIds.delete(windowId)
})

if (chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(() => {
    void enforceSingleManagedPopupWindow()
    void openWalletHomePopup().catch((err) => {
      void recordRuntimeError('background-sw', err, { kind: 'open-wallet-popup' })
    })
  })
}

// Safety sweep: enforce singleton popup even if duplicate windows are created by races
// outside the normal openManagedPopup flow.
void enforceSingleManagedPopupWindow()
setInterval(() => {
  void enforceSingleManagedPopupWindow()
}, 1500)

