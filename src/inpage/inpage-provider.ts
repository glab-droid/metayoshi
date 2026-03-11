// Inpage Provider Script - Injected into web pages
// Provides window.metayoshi API for DApps

const IP_CONTENT_CHANNEL = 'metayoshi:content'
const IP_INPAGE_CHANNEL = 'metayoshi:inpage'
const INIT_EVENT = 'metayoshi#initialized'
const PROVIDER_STATE_METHOD = 'metayoshi_getProviderState'
const PROVIDER_ENABLE_METHOD = 'metayoshi_requestAccounts'
const CONNECT_METHOD = 'metayoshi_connect'
const GET_NETWORKS_METHOD = 'metayoshi_getNetworks'
const GET_CAPABILITIES_METHOD = 'metayoshi_getCapabilities'
const SIGN_MESSAGE_METHOD = 'metayoshi_signMessage'
const SIGN_TYPED_DATA_METHOD = 'metayoshi_signTypedData'
const SIGN_TRANSACTION_METHOD = 'metayoshi_signTransaction'
const SIGN_ALL_TRANSACTIONS_METHOD = 'wallet_signAllTransactions'
const SIGN_AND_SEND_TRANSACTION_METHOD = 'wallet_signAndSendTransaction'
const SEND_TRANSACTION_METHOD = 'metayoshi_sendTransaction'
const SEND_ASSET_METHOD = 'metayoshi_sendAsset'
const SWITCH_NETWORK_METHOD = 'metayoshi_switchNetwork'
const COSMOS_GET_KEY_METHOD = 'wallet_cosmosGetKey'
const COSMOS_SIGN_DIRECT_METHOD = 'wallet_cosmosSignDirect'
const COSMOS_SIGN_AMINO_METHOD = 'wallet_cosmosSignAmino'
const COSMOS_SEND_TX_METHOD = 'wallet_cosmosSendTx'

const REQUEST_ACCOUNTS_METHODS = new Set(['wallet_requestAccounts', 'metayoshi_requestAccounts', 'rtm_requestAccounts'])
const ACCOUNTS_METHODS = new Set(['wallet_accounts', 'metayoshi_accounts', 'rtm_accounts'])
const CONNECT_METHODS = new Set(['wallet_connect', 'metayoshi_connect', 'rtm_connect'])
const SELECT_ACCOUNT_METHODS = new Set(['wallet_selectAccount', 'metayoshi_selectAccount', 'rtm_selectAccount'])
const PROVIDER_STATE_METHODS = new Set(['wallet_getProviderState', 'metayoshi_getProviderState', 'rtm_getProviderState'])

type Listener = (payload: any) => void

type ProviderState = {
  connected: boolean
  unlocked: boolean
  coinId: string | null
  coinName: string | null
  coinSymbol: string | null
  coinDecimals: number | null
  chainId: string | null
  networkLabel: string | null
  accounts: string[]
  selectedAddress: string | null
}

type ProviderNetwork = {
  id: string
  runtimeModelId: string | null
  name: string
  symbol: string
  coinType: string
  chainId: number | null
  active: boolean
  capabilities: {
    nativeSend: boolean
    assetLayer: boolean
    assetSend: boolean
    activity: boolean
  }
}

type ProviderCapabilities = {
  wallet: {
    isMetaYoshi: boolean
    connected: boolean
    unlocked: boolean
  }
  network: {
    id: string | null
    runtimeModelId: string | null
    name: string | null
    symbol: string | null
    coinType: string | null
  }
  features: {
    nativeSend: boolean
    signMessage: boolean
    assetLayer: boolean
    assetSend: boolean
  }
  scopes: {
    read: boolean
    sign: boolean
    send_coin: boolean
    send_asset: boolean
    select_account: boolean
    switch_network: boolean
  }
  methods: string[]
  networks: ProviderNetwork[]
}

type ProviderNetworkRequest = {
  networkId?: string
  coinId?: string
  coin?: string
  symbol?: string
  chainId?: string | number
}

type ProviderSendCoinParams = {
  to: string
  amount: string
  memo?: string
}

type ProviderSendEvmTransactionParams = {
  to?: string
  value?: string
  amount?: string
  data: string
  gasLimit?: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
  type?: 2
}

const listeners = new Map<string, Set<Listener>>()
const pending = new Map<number, { method: string; resolve: (value: any) => void; reject: (err: any) => void }>()
let nextId = 1

const state: ProviderState = {
  connected: false,
  unlocked: false,
  coinId: null,
  coinName: null,
  coinSymbol: null,
  coinDecimals: null,
  chainId: null,
  networkLabel: null,
  accounts: [],
  selectedAddress: null
}

function emit(event: string, payload: any): void {
  const set = listeners.get(event)
  if (!set) return
  for (const listener of set) {
    try {
      listener(payload)
    } catch {
      // ignore listener errors
    }
  }
}

function on(event: string, listener: Listener): void {
  const set = listeners.get(event) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(event, set)
}

function removeListener(event: string, listener: Listener): void {
  const set = listeners.get(event)
  if (!set) return
  set.delete(listener)
  if (!set.size) listeners.delete(event)
}

function once(event: string, listener: Listener): void {
  const wrap: Listener = (payload) => {
    removeListener(event, wrap)
    listener(payload)
  }
  on(event, wrap)
}

function updateAccounts(addresses: string[]): void {
  state.accounts = Array.isArray(addresses) ? addresses : []
  state.selectedAddress = state.accounts[0] ?? null
}

function normalizeAccountAddresses(rawAccounts: unknown): string[] {
  if (!Array.isArray(rawAccounts)) return []
  const out: string[] = []
  for (const entry of rawAccounts) {
    if (typeof entry === 'string') {
      const addr = entry.trim()
      if (addr) out.push(addr)
      continue
    }
    if (entry && typeof entry === 'object') {
      const addr = String((entry as any).address ?? '').trim()
      if (addr) out.push(addr)
    }
  }
  return out
}

function applyProviderState(next: any): void {
  if (!next || typeof next !== 'object') return
  state.connected = !!next.connected
  state.unlocked = !!next.unlocked
  state.coinId = next.coinId ?? state.coinId
  state.coinName = next.coinName ?? state.coinName
  state.coinSymbol = next.coinSymbol ?? state.coinSymbol
  state.coinDecimals = next.coinDecimals ?? state.coinDecimals
  state.chainId = next.chainId ?? next.networkId ?? state.chainId
  state.networkLabel = next.networkLabel ?? state.networkLabel
  updateAccounts(normalizeAccountAddresses(next.accounts))
  if (next.selectedAddress) {
    state.selectedAddress = String(next.selectedAddress)
  }
}

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i])
  return btoa(out)
}

function fromBase64(value: string): Uint8Array {
  const raw = atob(String(value || '').trim())
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

function normalizeBytesLike(value: Uint8Array | ArrayBuffer | number[]): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return Uint8Array.from(value)
  throw new Error('Expected byte array input')
}

function toHexChainId(value: unknown): string | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  if (/^0x[0-9a-f]+$/.test(raw)) return raw
  if (/^\d+$/.test(raw)) return `0x${Number.parseInt(raw, 10).toString(16)}`
  return null
}

function createPublicKeyLike(address: string) {
  const normalized = String(address || '').trim()
  return {
    toString: () => normalized,
    toBase58: () => normalized,
    toJSON: () => normalized
  }
}

function serializeSolanaTransactionLike(tx: any): string {
  if (!tx || typeof tx !== 'object') throw new Error('Transaction is required')
  if (typeof tx.serialize === 'function') {
    try {
      return toBase64(normalizeBytesLike(tx.serialize({ requireAllSignatures: false, verifySignatures: false })))
    } catch {
      return toBase64(normalizeBytesLike(tx.serialize()))
    }
  }
  throw new Error('Unsupported Solana transaction object')
}

function deserializeSolanaTransactionLike(original: any, serializedBase64: string): any {
  const bytes = fromBase64(serializedBase64)
  const ctor = original?.constructor as any
  if (ctor?.deserialize && typeof ctor.deserialize === 'function') {
    return ctor.deserialize(bytes)
  }
  if (ctor?.from && typeof ctor.from === 'function') {
    return ctor.from(bytes)
  }
  return original
}

function request({ method, params }: { method: string; params?: any }): Promise<any> {
  if (!method || typeof method !== 'string') {
    return Promise.reject(new Error('method is required'))
  }
  const id = nextId++
  const payload = {
    jsonrpc: '2.0',
    id,
    method,
    params
  }
  return new Promise((resolve, reject) => {
    pending.set(id, { method, resolve, reject })
    window.postMessage({ target: IP_CONTENT_CHANNEL, type: 'request', id, request: payload }, '*')
  }).then(async (result: any) => {
    if (REQUEST_ACCOUNTS_METHODS.has(method)) {
      state.connected = true
      updateAccounts(normalizeAccountAddresses(result))
      const scopedState = await request({ method: PROVIDER_STATE_METHOD, params }).catch(() => null)
      if (scopedState) applyProviderState(scopedState)
    }
    if (ACCOUNTS_METHODS.has(method)) {
      updateAccounts(normalizeAccountAddresses(result))
    }
    if (CONNECT_METHODS.has(method) && (result as any)?.connected) {
      state.connected = true
      applyProviderState(result)
    }
    if (SELECT_ACCOUNT_METHODS.has(method) && (result as any)?.selectedAddress) {
      state.selectedAddress = String((result as any).selectedAddress)
    }
    if (PROVIDER_STATE_METHODS.has(method)) {
      applyProviderState(result)
    }
    return result
  })
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data as any
  if (!data || data.target !== IP_INPAGE_CHANNEL) return
  
  if (data.type === 'response') {
    const response = data.response
    const id = response?.id ?? data.id
    if (typeof id !== 'number') return
    const pendingReq = pending.get(id)
    if (!pendingReq) return
    pending.delete(id)
    if (response?.error) {
      const err: any = new Error(response.error.message ?? 'Request failed')
      err.code = response.error.code
      err.data = response.error.data
      pendingReq.reject(err)
      return
    }
    pendingReq.resolve(response?.result)
    return
  }
  
  if (data.type === 'bridge_error') {
    const bridgeError = data.error ?? {}
    const err: any = new Error(String(bridgeError.message ?? 'Extension context invalidated'))
    err.code = Number(bridgeError.code ?? 4900)
    err.data = bridgeError.data
    
    // Reject all pending requests
    const pendingEntries = Array.from(pending.values())
    pending.clear()
    for (const req of pendingEntries) {
      try {
        req.reject(err)
      } catch {
        // ignore
      }
    }
    return
  }
  
  if (data.type === 'event') {
    const eventName = String(data.event ?? '')
    const payload = data.payload ?? {}
    
    if (eventName === 'accountsChanged') {
      if (Array.isArray(payload.accounts)) {
        updateAccounts(payload.accounts.map((a: any) => String(a.address ?? a)))
      } else if (payload.address) {
        updateAccounts([String(payload.address)])
      }
      if (payload.address) {
        state.selectedAddress = String(payload.address)
      }
      state.connected = state.accounts.length > 0
      emit('accountsChanged', payload)
      emit('ethereum#accountsChanged', state.accounts)
    }
    
    if (eventName === 'networkChanged') {
      state.chainId = payload.networkId ?? state.chainId
      state.networkLabel = payload.networkLabel ?? state.networkLabel
      if (payload.coinId !== undefined) state.coinId = payload.coinId ?? state.coinId
      if (payload.coinName !== undefined) state.coinName = payload.coinName ?? state.coinName
      if (payload.coinSymbol !== undefined) state.coinSymbol = payload.coinSymbol ?? state.coinSymbol
      if (payload.coinDecimals !== undefined) state.coinDecimals = payload.coinDecimals ?? state.coinDecimals
      
      // Refresh provider state
      void request({ method: PROVIDER_STATE_METHOD })
        .then((providerState) => applyProviderState(providerState))
        .catch(() => {})
      
      emit('networkChanged', payload)
      const hexChainId = toHexChainId(payload.chainId ?? state.chainId)
      if (hexChainId) emit('chainChanged', hexChainId)
    }
    
    if (eventName === 'lockChanged') {
      state.unlocked = !!payload.unlocked
      if (!state.unlocked) {
        state.connected = false
        state.accounts = []
        state.selectedAddress = null
      }
      emit('lockChanged', payload)
      if (!state.unlocked) emit('disconnect', { code: 4900, message: 'Wallet locked' })
    }
    
    emit(eventName, payload)
  }
})

function initState(): void {
  request({ method: PROVIDER_STATE_METHOD }).catch(() => {
    // ignore on init
  })
}

// MetaYoshi provider interface (multi-chain)
const provider = {
  isMetaYoshi: true,
  isRtm: true,
  isMultiChain: true,
  
  // Coin/Network info
  get coinId() {
    return state.coinId
  },
  get coinName() {
    return state.coinName
  },
  get coinSymbol() {
    return state.coinSymbol
  },
  get coinDecimals() {
    return state.coinDecimals
  },
  get chainId() {
    return state.chainId
  },
  get networkId() {
    return state.chainId
  },
  get networkLabel() {
    return state.networkLabel
  },
  
  // Account info
  get selectedAddress() {
    return state.selectedAddress
  },
  get accounts() {
    return [...state.accounts]
  },
  get isConnected() {
    return state.connected
  },
  get isUnlocked() {
    return state.unlocked
  },
  
  // RPC methods
  request,
  send: request,
  enable: (params?: ProviderNetworkRequest) => request({ method: PROVIDER_ENABLE_METHOD, params }),
  connect: (params?: ProviderNetworkRequest) => request({ method: CONNECT_METHOD, params }),
  getProviderState: (params?: ProviderNetworkRequest) => request({ method: PROVIDER_STATE_METHOD, params }),
  getNetworks: (): Promise<ProviderNetwork[]> => request({ method: GET_NETWORKS_METHOD }),
  getCapabilities: (params?: ProviderNetworkRequest): Promise<ProviderCapabilities> => request({ method: GET_CAPABILITIES_METHOD, params }),
  signMessage: (params: { message: string; encoding?: 'utf8' | 'hex' } & ProviderNetworkRequest) =>
    request({ method: SIGN_MESSAGE_METHOD, params }),
  signTypedData: (params: { typedData: unknown } & ProviderNetworkRequest) =>
    request({ method: SIGN_TYPED_DATA_METHOD, params }),
  signTransaction: (params: { ecosystem?: 'evm' | 'solana'; tx?: Record<string, unknown>; serializedTxBase64?: string } & ProviderNetworkRequest) =>
    request({ method: SIGN_TRANSACTION_METHOD, params }),
  sendTransaction: (params: (ProviderSendCoinParams | ProviderSendEvmTransactionParams) & ProviderNetworkRequest) =>
    request({ method: SEND_TRANSACTION_METHOD, params }),
  sendAsset: (params: { assetId: string; qty: string; toAddress: string; memo?: string } & ProviderNetworkRequest) =>
    request({ method: SEND_ASSET_METHOD, params }),
  sdkInfo: async (params?: ProviderNetworkRequest) => {
    const [stateSnapshot, capabilities, networks] = await Promise.all([
      request({ method: PROVIDER_STATE_METHOD, params }),
      request({ method: GET_CAPABILITIES_METHOD, params }),
      request({ method: GET_NETWORKS_METHOD })
    ])
    return {
      provider: 'metayoshi',
      state: stateSnapshot,
      capabilities,
      networks
    }
  },
  
  // Event methods
  on,
  removeListener,
  off: removeListener,
  once,
  
  // Multi-chain methods
  switchNetwork: (networkId: string) => {
    return request({ method: SWITCH_NETWORK_METHOD, params: { networkId } })
  },
  
  // Metadata
  _metayoshi: {
    hardwareWallet: String((import.meta as any)?.env?.VITE_EVM_SIGNER_MODE || '').trim().toLowerCase() === 'hardware',
    version: import.meta.env.VITE_APP_VERSION ?? 'metayoshi-0.1.8',
    multiChain: true
  }
}

const ethereumProvider = {
  isMetaYoshi: true,
  isMetaMask: false,
  get selectedAddress() {
    return state.selectedAddress
  },
  get chainId() {
    return toHexChainId(state.chainId)
  },
  request: ({ method, params }: { method: string; params?: any }) => request({ method, params }),
  send: (payload: { method: string; params?: any }) => request({ method: payload.method, params: payload.params }),
  enable: () => request({ method: 'eth_requestAccounts' }),
  on,
  removeListener,
  off: removeListener,
  isConnected: () => state.connected,
  _metayoshi: provider._metayoshi
}

const solanaProvider = {
  isMetaYoshi: true,
  isPhantom: false,
  get publicKey() {
    return state.selectedAddress ? createPublicKeyLike(state.selectedAddress) : null
  },
  get isConnected() {
    return state.connected
  },
  connect: async () => {
    const accounts = await request({ method: PROVIDER_ENABLE_METHOD, params: { networkId: 'sol' } })
    const address = Array.isArray(accounts) ? String(accounts[0] || '').trim() : String(state.selectedAddress || '').trim()
    const payload = { publicKey: createPublicKeyLike(address) }
    emit('connect', payload)
    return payload
  },
  disconnect: async () => {
    state.connected = false
    state.accounts = []
    state.selectedAddress = null
    emit('disconnect', { code: 4900, message: 'Disconnected' })
  },
  signMessage: async (message: Uint8Array | ArrayBuffer | number[]) => {
    const result = await request({
      method: SIGN_MESSAGE_METHOD,
      params: {
        ecosystem: 'solana',
        messageBase64: toBase64(normalizeBytesLike(message))
      }
    })
    return {
      publicKey: createPublicKeyLike(String(result?.publicKey || state.selectedAddress || '')),
      signature: fromBase64(String(result?.signatureBase64 || ''))
    }
  },
  signTransaction: async (transaction: any) => {
    const result = await request({
      method: SIGN_TRANSACTION_METHOD,
      params: {
        ecosystem: 'solana',
        serializedTxBase64: serializeSolanaTransactionLike(transaction)
      }
    })
    return deserializeSolanaTransactionLike(transaction, String(result?.signedTxBase64 || ''))
  },
  signAllTransactions: async (transactions: any[]) => {
    const result = await request({
      method: SIGN_ALL_TRANSACTIONS_METHOD,
      params: {
        serializedTxsBase64: Array.isArray(transactions) ? transactions.map((tx) => serializeSolanaTransactionLike(tx)) : []
      }
    })
    const signed = Array.isArray(result?.signedTxsBase64) ? result.signedTxsBase64 : []
    return transactions.map((tx, index) => deserializeSolanaTransactionLike(tx, String(signed[index] || '')))
  },
  signAndSendTransaction: async (transaction: any) => {
    const result = await request({
      method: SIGN_AND_SEND_TRANSACTION_METHOD,
      params: {
        ecosystem: 'solana',
        serializedTxBase64: serializeSolanaTransactionLike(transaction)
      }
    })
    return {
      signature: String(result?.signature || '')
    }
  },
  on,
  removeListener,
  off: removeListener
}

const keplrProvider = {
  isMetaYoshi: true,
  enable: async (_chainId: string | string[]) => {
    await request({ method: PROVIDER_ENABLE_METHOD, params: { networkId: 'cosmos' } })
  },
  getKey: async (_chainId: string) => {
    const key = await request({ method: COSMOS_GET_KEY_METHOD, params: { networkId: 'cosmos' } })
    const bech32Address = String(key?.bech32Address || key?.address || '')
    return {
      name: 'MetaYoshi',
      algo: String(key?.algo || 'secp256k1'),
      pubKey: fromBase64(String(key?.pubKeyBase64 || '')),
      address: new TextEncoder().encode(bech32Address),
      bech32Address
    }
  },
  signDirect: async (_chainId: string, signer: string, signDoc: any) =>
    request({
      method: COSMOS_SIGN_DIRECT_METHOD,
      params: { networkId: 'cosmos', signerAddress: signer, signDoc }
    }),
  signAmino: async (_chainId: string, signer: string, signDoc: any) =>
    request({
      method: COSMOS_SIGN_AMINO_METHOD,
      params: { networkId: 'cosmos', signerAddress: signer, signDoc }
    }),
  sendTx: async (_chainId: string, tx: Uint8Array | ArrayBuffer | number[], mode: 'sync' | 'async' | 'block' = 'sync') => {
    const mappedMode = mode === 'block'
      ? 'BROADCAST_MODE_BLOCK'
      : (mode === 'async' ? 'BROADCAST_MODE_ASYNC' : 'BROADCAST_MODE_SYNC')
    const result = await request({
      method: COSMOS_SEND_TX_METHOD,
      params: {
        networkId: 'cosmos',
        txBytesBase64: toBase64(normalizeBytesLike(tx)),
        mode: mappedMode
      }
    })
    const txhash = String(result?.txhash || '').trim()
    if (/^[0-9a-f]+$/i.test(txhash) && txhash.length % 2 === 0) {
      const out = new Uint8Array(txhash.length / 2)
      for (let i = 0; i < txhash.length; i += 2) {
        out[i / 2] = Number.parseInt(txhash.slice(i, i + 2), 16)
      }
      return out
    }
    return new TextEncoder().encode(txhash)
  },
  getOfflineSigner: (_chainId: string) => ({
    getAccounts: async () => {
      const key = await request({ method: COSMOS_GET_KEY_METHOD, params: { networkId: 'cosmos' } })
      return [{
        address: String(key?.bech32Address || key?.address || ''),
        algo: String(key?.algo || 'secp256k1'),
        pubkey: fromBase64(String(key?.pubKeyBase64 || ''))
      }]
    },
    signAmino: async (signerAddress: string, signDoc: any) => keplrProvider.signAmino('', signerAddress, signDoc),
    signDirect: async (signerAddress: string, signDoc: any) => keplrProvider.signDirect('', signerAddress, signDoc)
  }),
  getOfflineSignerOnlyAmino: (_chainId: string) => ({
    getAccounts: async () => {
      const signer = keplrProvider.getOfflineSigner(_chainId)
      return signer.getAccounts()
    },
    signAmino: async (signerAddress: string, signDoc: any) => keplrProvider.signAmino('', signerAddress, signDoc)
  })
}

Object.defineProperties(provider, {
  evm: {
    value: ethereumProvider,
    writable: false,
    configurable: false
  },
  ethereum: {
    value: ethereumProvider,
    writable: false,
    configurable: false
  },
  solana: {
    value: solanaProvider,
    writable: false,
    configurable: false
  },
  keplr: {
    value: keplrProvider,
    writable: false,
    configurable: false
  },
  cosmos: {
    value: keplrProvider,
    writable: false,
    configurable: false
  }
})

// Inject only proprietary globals to avoid colliding with other extension wallets.
if (!(window as any).metayoshi) {
  Object.defineProperty(window, 'metayoshi', {
    value: provider,
    writable: false,
    configurable: false
  })
}

if (!(window as any).rtm) {
  Object.defineProperty(window, 'rtm', {
    value: provider,
    writable: false,
    configurable: false
  })
}

// Dispatch initialization event
window.dispatchEvent(new Event(INIT_EVENT))
initState()

export {}
