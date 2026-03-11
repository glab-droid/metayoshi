export const DAPP_PERMISSIONS_STORAGE_KEY = 'metayoshi-dapp-permissions-v1'
export const DAPP_PENDING_APPROVAL_STORAGE_KEY = 'metayoshi-dapp-pending-approval-v1'
export const DAPP_PENDING_REQUEST_STORAGE_KEY = 'metayoshi-dapp-pending-request-v1'
export const DAPP_APPROVAL_TIMEOUT_MS = 2 * 60 * 1000
export const DAPP_BLOCKED_INTERNAL_ORIGIN_MESSAGE = 'Blocked internal application origin'

export type DappScope = 'read' | 'sign' | 'send_coin' | 'send_asset' | 'select_account' | 'switch_network'
export type DappApprovalStatus = 'pending' | 'approved' | 'rejected'
export type DappRequestStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'
export type DappRequestMethod =
  | 'wallet_sendTransaction'
  | 'wallet_sendAsset'
  | 'wallet_signMessage'
  | 'wallet_signTypedData'
  | 'wallet_signTransaction'
  | 'wallet_signAllTransactions'
  | 'wallet_signAndSendTransaction'
  | 'wallet_cosmosGetKey'
  | 'wallet_cosmosSignDirect'
  | 'wallet_cosmosSignAmino'
  | 'wallet_cosmosSendTx'

export interface DappPermission {
  origin: string
  scopes: DappScope[]
  updatedAt: number
  lastConnectedAt?: number
}

export interface DappPendingApproval {
  id: string
  origin: string
  scopes: DappScope[]
  networkId?: string
  status: DappApprovalStatus
  requestedAt: number
  updatedAt: number
  expiresAt: number
}

export interface DappSendCoinRequestPayload {
  to: string
  amount: string
  memo?: string
}

export interface DappSendEvmTransactionPayload {
  to?: string
  amount?: string
  value?: string
  data: string
  gasLimit?: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
  type?: 2
}

export type DappSendRequestPayload = DappSendCoinRequestPayload | DappSendEvmTransactionPayload

export interface DappSendAssetRequestPayload {
  assetId: string
  qty: string
  toAddress: string
  memo?: string
}

export interface DappRequestError {
  code: number
  message: string
}

export interface DappPendingRequest {
  id: string
  origin: string
  method: DappRequestMethod
  networkId: string
  accountId: string
  request: unknown
  status: DappRequestStatus
  requestedAt: number
  updatedAt: number
  expiresAt: number
  result?: unknown
  error?: DappRequestError
}

export const DAPP_REQUEST_METHODS: DappRequestMethod[] = [
  'wallet_sendTransaction',
  'wallet_sendAsset',
  'wallet_signMessage',
  'wallet_signTypedData',
  'wallet_signTransaction',
  'wallet_signAllTransactions',
  'wallet_signAndSendTransaction',
  'wallet_cosmosGetKey',
  'wallet_cosmosSignDirect',
  'wallet_cosmosSignAmino',
  'wallet_cosmosSendTx'
]

const VALID_SCOPES: DappScope[] = ['read', 'sign', 'send_coin', 'send_asset', 'select_account', 'switch_network']

function isDappScope(value: unknown): value is DappScope {
  return VALID_SCOPES.includes(value as DappScope)
}

export function normalizeDappOrigin(input: string): string {
  const value = String(input || '').trim()
  if (!value) return 'unknown'
  if (value === 'null') return 'unknown'
  if (value.startsWith('chrome-extension://')) return value

  try {
    return new URL(value).origin
  } catch {
    return value.toLowerCase()
  }
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const value = Number(part)
    if (!Number.isInteger(value) || value < 0 || value > 255) return null
    octets.push(value)
  }
  return octets
}

function isPrivateOrLoopbackIpv4(hostname: string): boolean {
  const octets = parseIpv4(hostname)
  if (!octets) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}

function normalizeIpv6(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

function isPrivateOrLoopbackIpv6(hostname: string): boolean {
  const normalized = normalizeIpv6(hostname)
  if (!normalized.includes(':')) return false
  if (normalized === '::1') return true
  if (normalized === '::') return true
  if (normalized.startsWith('fe80:')) return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  return false
}

export function isBlockedInternalDappOrigin(input: string): boolean {
  const origin = normalizeDappOrigin(input)
  if (!origin || origin === 'unknown') return false
  if (origin.startsWith('chrome-extension://')) return false

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }

  const hostname = String(parsed.hostname || '').trim().toLowerCase()
  if (!hostname) return false

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname === 'local' || hostname.endsWith('.local')) return true
  if (isPrivateOrLoopbackIpv4(hostname)) return true
  if (isPrivateOrLoopbackIpv6(hostname)) return true
  return false
}

export function uniqDappScopes(scopes: readonly DappScope[]): DappScope[] {
  const unique = new Set<DappScope>()
  for (const scope of scopes) {
    if (isDappScope(scope)) unique.add(scope)
  }
  return Array.from(unique)
}

export function parseDappPermissions(raw: unknown): Record<string, DappPermission> {
  if (!raw || typeof raw !== 'object') return {}

  const out: Record<string, DappPermission> = {}
  const entries = Object.entries(raw as Record<string, unknown>)
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue
    const candidate = value as Partial<DappPermission>
    const origin = normalizeDappOrigin(typeof candidate.origin === 'string' ? candidate.origin : key)
    const scopes = Array.isArray(candidate.scopes)
      ? uniqDappScopes(candidate.scopes.filter(isDappScope))
      : []
    if (!origin || scopes.length === 0) continue
    out[origin] = {
      origin,
      scopes,
      updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
      lastConnectedAt: typeof candidate.lastConnectedAt === 'number' ? candidate.lastConnectedAt : undefined
    }
  }

  return out
}

export function parseDappPendingApproval(raw: unknown): DappPendingApproval | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<DappPendingApproval>
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null

  const origin = normalizeDappOrigin(String(candidate.origin || ''))
  const scopes = Array.isArray(candidate.scopes)
    ? uniqDappScopes(candidate.scopes.filter(isDappScope))
    : []
  if (!origin || origin === 'unknown' || scopes.length === 0) return null

  const status: DappApprovalStatus = candidate.status === 'approved' || candidate.status === 'rejected'
    ? candidate.status
    : 'pending'

  const now = Date.now()
  const requestedAt = typeof candidate.requestedAt === 'number' ? candidate.requestedAt : now
  const updatedAt = typeof candidate.updatedAt === 'number' ? candidate.updatedAt : requestedAt
  const expiresAt = typeof candidate.expiresAt === 'number' ? candidate.expiresAt : requestedAt + DAPP_APPROVAL_TIMEOUT_MS
  const networkId = typeof candidate.networkId === 'string' && candidate.networkId.trim()
    ? candidate.networkId.trim()
    : undefined

  return {
    id: candidate.id,
    origin,
    scopes,
    networkId,
    status,
    requestedAt,
    updatedAt,
    expiresAt
  }
}

function parseDappRequestStatus(raw: unknown): DappRequestStatus {
  if (raw === 'approved' || raw === 'rejected' || raw === 'executed' || raw === 'failed') {
    return raw
  }
  return 'pending'
}

function parseOptionalNonEmptyString(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}

function parseOptionalTxType(value: unknown): 2 | undefined {
  if (value === 2 || value === '2') return 2
  return undefined
}

function parseDappSendRequest(raw: unknown): DappSendRequestPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<DappSendRequestPayload>
  const data = String((candidate as Partial<DappSendEvmTransactionPayload>).data || '').trim()
  if (data) {
    const to = parseOptionalNonEmptyString((candidate as Partial<DappSendEvmTransactionPayload>).to)
    const amount = parseOptionalNonEmptyString((candidate as Partial<DappSendEvmTransactionPayload>).amount)
    const value = parseOptionalNonEmptyString((candidate as Partial<DappSendEvmTransactionPayload>).value)
    const gasLimit = parseOptionalNonEmptyString((candidate as Partial<DappSendEvmTransactionPayload>).gasLimit)
    const gasPrice = parseOptionalNonEmptyString((candidate as Partial<DappSendEvmTransactionPayload>).gasPrice)
    const maxFeePerGas = parseOptionalNonEmptyString((candidate as Partial<DappSendEvmTransactionPayload>).maxFeePerGas)
    const maxPriorityFeePerGas = parseOptionalNonEmptyString((candidate as Partial<DappSendEvmTransactionPayload>).maxPriorityFeePerGas)
    const type = parseOptionalTxType((candidate as Partial<DappSendEvmTransactionPayload>).type)

    return {
      data,
      ...(to ? { to } : {}),
      ...(amount ? { amount } : {}),
      ...(value ? { value } : {}),
      ...(gasLimit ? { gasLimit } : {}),
      ...(gasPrice ? { gasPrice } : {}),
      ...(maxFeePerGas ? { maxFeePerGas } : {}),
      ...(maxPriorityFeePerGas ? { maxPriorityFeePerGas } : {}),
      ...(type ? { type } : {})
    }
  }

  const to = String((candidate as Partial<DappSendCoinRequestPayload>).to || '').trim()
  const amount = String((candidate as Partial<DappSendCoinRequestPayload>).amount || '').trim()
  const memo = String((candidate as Partial<DappSendCoinRequestPayload>).memo || '').trim()
  if (!to || !amount) return null
  return memo ? { to, amount, memo } : { to, amount }
}

function parseDappSendAssetRequest(raw: unknown): DappSendAssetRequestPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<DappSendAssetRequestPayload>
  const assetId = String(candidate.assetId || '').trim()
  const qty = String(candidate.qty || '').trim()
  const toAddress = String(candidate.toAddress || '').trim()
  const memo = String(candidate.memo || '').trim()
  if (!assetId || !qty || !toAddress) return null
  return memo ? { assetId, qty, toAddress, memo } : { assetId, qty, toAddress }
}

function parseDappRequestError(raw: unknown): DappRequestError | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const candidate = raw as Partial<DappRequestError>
  const code = typeof candidate.code === 'number' ? candidate.code : -32603
  const message = String(candidate.message || '').trim()
  if (!message) return undefined
  return { code, message }
}

export function parseDappPendingRequest(raw: unknown): DappPendingRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<DappPendingRequest>

  const id = String(candidate.id || '').trim()
  if (!id) return null
  const origin = normalizeDappOrigin(String(candidate.origin || ''))
  if (!origin || origin === 'unknown') return null
  const method = String(candidate.method || '').trim()
  if (!DAPP_REQUEST_METHODS.includes(method as DappRequestMethod)) return null

  const networkId = String(candidate.networkId || '').trim()
  const accountId = String(candidate.accountId || '').trim()
  if (!networkId || !accountId) return null

  let request: unknown = candidate.request
  if (method === 'wallet_sendAsset') {
    request = parseDappSendAssetRequest(candidate.request)
    if (!request) return null
  } else if (method === 'wallet_sendTransaction') {
    request = parseDappSendRequest(candidate.request)
    if (!request) return null
  }

  const now = Date.now()
  const requestedAt = typeof candidate.requestedAt === 'number' ? candidate.requestedAt : now
  const updatedAt = typeof candidate.updatedAt === 'number' ? candidate.updatedAt : requestedAt
  const expiresAt = typeof candidate.expiresAt === 'number' ? candidate.expiresAt : requestedAt + DAPP_APPROVAL_TIMEOUT_MS

  return {
    id,
    origin,
    method: method as DappRequestMethod,
    networkId,
    accountId,
    request,
    status: parseDappRequestStatus(candidate.status),
    requestedAt,
    updatedAt,
    expiresAt,
    result: candidate.result,
    error: parseDappRequestError(candidate.error)
  }
}
