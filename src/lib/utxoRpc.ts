import { getCoinApiInterceptor } from '../coins/interceptors'
import type { CoinApiInterceptor, RpcInterceptorErrorContext } from '../coins/interceptors/types'
import { useApiMonitorStore } from '../store/apiMonitorStore'
import { recordRuntimeError } from './runtimeErrorMonitor'
import { signLegacyP2pkhTransaction, type UnsignedTxInput } from './utxoSign'
import { getBuildFeatureFlag } from '../buildConfig'
import { assertBridgeCredentialsConfigured } from './bridgeCredentials'

// UTXO JSON-RPC client — all production connections go through the public bridge gateway.
//
// Bridge mode (mandatory when bridgeUrl is set):
//   https://<coin>.metayoshi.app/v1/bridge[/wallet/<name>]  — Content-Type: application/json

export interface UtxoRpcConfig {
  // Used to resolve the coin interceptor/profile automatically.
  networkId?: string
  coinSymbol?: string

  // ── Local / direct RPC ────────────────────────────────────────────────────
  rpcUrl: string
  rpcWallet?: string      // appended as /wallet/<rpcWallet> to rpcUrl when present
  rpcUsername?: string
  rpcPassword?: string

  // ── Public bridge gateway ─────────────────────────────────────────────────
  bridgeUrl?: string      // full URL incl. wallet path, e.g. https://rtm.metayoshi.app/v1/bridge/wallet/mainwallet
  bridgeUsername?: string
  bridgePassword?: string
  bridgeTxKey?: string    // optional X-Bridge-Tx-Key for write policies
  bridgeTxKeyCandidates?: string[] // optional key candidates for server rotation/s skew
  secureBridgeApiBaseUrl?: string
  secureBridgeWritesEnabled?: boolean
  secureBridgeSigner?: (message: string) => Promise<{ address: string; signature: string }>
  timeoutMs?: number      // request timeout (default 10000ms)
  apiInterceptor?: CoinApiInterceptor

  /** Internal-only bridge bypass for controlled direct RPC fallbacks. */
  useDirectRpc?: boolean
}

type SecureBridgeSession = {
  token: string
  address: string
  expiresAtMs: number
}

/** Build the effective direct-RPC endpoint URL. */
export function buildRpcUrl(config: UtxoRpcConfig): string {
  const base = config.rpcUrl.trim().replace(/\/$/, '')
  return config.rpcWallet ? `${base}/wallet/${config.rpcWallet}` : base
}

/** Resolve the URL and auth credentials to use. */
function resolveConnection(config: UtxoRpcConfig): {
  url: string
  username: string | undefined
  password: string | undefined
  isBridge: boolean
} {
  // Internal direct-RPC mode: bypass the bridge and call the configured RPC endpoint.
  if (config.useDirectRpc) {
    const url = buildRpcUrl(config)
    if (!url) throw new Error('Direct RPC URL is not configured for this network.')
    return {
      url,
      username: config.rpcUsername,
      password: config.rpcPassword,
      isBridge: false
    }
  }

  // Default: MetaYoshi bridge
  if (!config.bridgeUrl) {
    throw new Error('Bridge URL is not configured for this network.')
  }
  assertBridgeCredentialsConfigured({
    bridgeUrl: config.bridgeUrl,
    bridgeUsername: config.bridgeUsername,
    bridgePassword: config.bridgePassword,
    name: config.networkId || config.coinSymbol || 'bridge transport'
  })
  return {
    url: config.bridgeUrl.trim(),
    username: config.bridgeUsername,
    password: config.bridgePassword,
    isBridge: true
  }
}

function applyBridgeBasicAuthHeaders(
  headers: Record<string, string>,
  config: UtxoRpcConfig,
  label: string
): void {
  assertBridgeCredentialsConfigured({
    bridgeUrl: config.bridgeUrl,
    bridgeUsername: config.bridgeUsername,
    bridgePassword: config.bridgePassword,
    name: label
  })
  headers['Authorization'] = `Basic ${btoa(`${config.bridgeUsername!}:${config.bridgePassword!}`)}`
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error ?? 'Unknown error'))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function compactErrorText(value: string, maxLen = 260): string {
  const withoutTags = String(value || '').replace(/<[^>]*>/g, ' ')
  const compact = withoutTags.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length > maxLen ? `${compact.slice(0, maxLen)}...` : compact
}

function dedupeStringList(values: Array<string | undefined>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function isBridgeTxAuthRejection(status: number, bodyText: string): boolean {
  if (status !== 401 && status !== 403) return false
  return /missing or invalid transaction authorization key|x-bridge-tx-key|tx[- ]?key/i.test(String(bodyText || ''))
}

function parseRpcDecimalAmount(input: string | number, maxDecimals = 8, label = 'Amount'): number {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error(`${label} is required`)

  // Accept common locale patterns:
  // 1,234.56 | 1.234,56 | 1234,56 | 1234.56
  const compact = raw.replace(/\s+/g, '')
  const dotPos = compact.lastIndexOf('.')
  const commaPos = compact.lastIndexOf(',')

  let normalized = compact
  if (dotPos >= 0 && commaPos >= 0) {
    const decimalSep = dotPos > commaPos ? '.' : ','
    normalized = decimalSep === '.'
      ? compact.replace(/,/g, '')
      : compact.replace(/\./g, '').replace(',', '.')
  } else if (commaPos >= 0) {
    normalized = compact.replace(',', '.')
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`${label} format is invalid`)
  }

  const [, fractional = ''] = normalized.split('.')
  if (fractional.length > maxDecimals) {
    throw new Error(`${label} supports up to ${maxDecimals} decimals`)
  }

  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than 0`)
  }

  return Number(value.toFixed(maxDecimals))
}

function isAssetMetadataNotFoundMessage(value: string): boolean {
  return /asset metadata not found/i.test(String(value || ''))
}

function parseBridgeCooldownMs(value: string): number | null {
  const match = String(value || '').match(/cooldown active\s*\((\d+)s\)/i)
  if (!match) return null
  const seconds = Number(match[1])
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return seconds * 1000
}

function isBridgeAssetMetadataNotFoundError(error: unknown): boolean {
  const msg = asError(error).message
  return /rpc call failed \[bridge\]/i.test(msg) && isAssetMetadataNotFoundMessage(msg)
}

function resolveApiInterceptor(config: UtxoRpcConfig): CoinApiInterceptor | undefined {
  if (config.apiInterceptor) return config.apiInterceptor
  return getCoinApiInterceptor(config.networkId)
}

function deriveBridgeApiBaseUrl(bridgeUrl: string): string {
  const raw = String(bridgeUrl || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  const idx = raw.indexOf('/v1/bridge')
  return idx >= 0 ? raw.slice(0, idx) : raw
}

function resolveBridgeCoinChainHint(config: UtxoRpcConfig): { coin?: string; chain?: string } {
  const info = resolveApiInterceptor(config)?.info
  const hintedCoin = String(info?.coinId || '').trim()
  const hintedChain = String(info?.chain || '').trim()
  if (hintedCoin && hintedChain) return { coin: hintedCoin, chain: hintedChain }

  const raw = String(config.bridgeUrl || '').trim().replace(/\/+$/, '')
  const m1 = raw.match(/\/v1\/bridge\/([^/]+)\/([^/]+)(?:\/|$)/i)
  if (m1) return { coin: String(m1[1] || '').trim(), chain: String(m1[2] || '').trim() }
  return {}
}

function resolveBridgeWalletHint(config: UtxoRpcConfig): string {
  const walletFromConfig = String(config.rpcWallet || '').trim()
  if (walletFromConfig) return walletFromConfig

  const raw = String(config.bridgeUrl || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  const withWallet = raw.match(/\/v1\/bridge\/[^/]+\/[^/]+\/wallet\/([^/?#]+)$/i)
  if (withWallet) return decodeURIComponent(String(withWallet[1] || '').trim())
  const walletOnly = raw.match(/\/v1\/bridge\/wallet\/([^/?#]+)$/i)
  if (walletOnly) return decodeURIComponent(String(walletOnly[1] || '').trim())
  return ''
}

function deriveBridgeChainEndpointUrl(config: UtxoRpcConfig): string | null {
  const baseUrl = String(config.bridgeUrl || '').trim().replace(/\/+$/, '')
  if (!baseUrl) return null

  const bridgeWithWallet = baseUrl.match(/^(.*)\/v1\/bridge\/([^/]+)\/([^/]+)\/wallet\/([^/]+)$/i)
  if (bridgeWithWallet) {
    const [, host, coin, chain] = bridgeWithWallet
    return `${host}/v1/bridge/${coin}/${chain}`
  }

  const bridgeWalletOnly = baseUrl.match(/^(.*)\/v1\/bridge\/wallet\/([^/]+)$/i)
  if (bridgeWalletOnly) {
    const [, host] = bridgeWalletOnly
    const hint = resolveBridgeCoinChainHint(config)
    if (hint.coin && hint.chain) return `${host}/v1/bridge/${hint.coin}/${hint.chain}`
  }

  return null
}

const BRIDGE_WRITE_METHODS = new Set([
  'sendtoaddress',
  'sendmany',
  'sendasset',
  'transfer',
  'sendrawtransaction',
  'createasset',
  'updateasset',
  'importprivkey',
  'rescanblockchain',
  'loadwallet'
])

const secureBridgeSessionCache = new Map<string, SecureBridgeSession>()
const EVM_BRIDGE_READ_BYPASS_TTL_MS = 2 * 60 * 1000
const evmBridgeReadBypassUntil = new Map<string, number>()

function parseBoolWithDefault(value: unknown, fallback: boolean): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function isSecureBridgeWriteMethod(method: string): boolean {
  return BRIDGE_WRITE_METHODS.has(String(method || '').trim().toLowerCase())
}

function isSecureBridgeWritesEnabled(config: UtxoRpcConfig): boolean {
  if (typeof config.secureBridgeWritesEnabled === 'boolean') return config.secureBridgeWritesEnabled
  return getBuildFeatureFlag('bridgeSecureWritesEnabled', 'VITE_BRIDGE_SECURE_WRITES_ENABLED', true)
}

function resolveSecureBridgeApiBase(config: UtxoRpcConfig, bridgeUrl: string): string {
  const explicit = String(config.secureBridgeApiBaseUrl || '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  return deriveBridgeApiBaseUrl(bridgeUrl)
}

function isSecureBridgeUnavailableStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 501
}

function isLegacyApiKeyUnauthorized(status: number, json: any, text: string): boolean {
  if (status !== 401) return false
  const detail = String(json?.error || json?.error?.message || text || '').trim().toLowerCase()
  if (!detail) return false
  return detail === 'unauthorized' || detail.includes('x-api-key') || detail.includes('api key')
}

function isSecureBridgeUnavailableError(error: unknown): boolean {
  const message = asError(error).message
  return message.startsWith('[secure-bridge-unavailable]')
}

function asSecureUnavailable(message: string): Error {
  return new Error(`[secure-bridge-unavailable] ${message}`)
}

async function fetchJsonWithStatus(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const res = await fetch(url, init)
  const text = await res.text().catch(() => '')
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, json, text }
}

async function getSecureBridgeSession(
  config: UtxoRpcConfig,
  bridgeUrl: string
): Promise<{ token: string; address: string; apiBase: string }> {
  const apiBase = resolveSecureBridgeApiBase(config, bridgeUrl)
  if (!apiBase) throw asSecureUnavailable('Bridge API base URL is not available')

  const signer = config.secureBridgeSigner
  if (!signer) {
    throw new Error(
      'Secure bridge signer is unavailable. Unlock wallet and retry.'
    )
  }

  const now = Date.now()
  const cached = secureBridgeSessionCache.get(apiBase)
  if (cached && cached.expiresAtMs - now > 12_000) {
    return { token: cached.token, address: cached.address, apiBase }
  }

  let signerProbe: { address: string; signature: string }
  try {
    signerProbe = await signer('MetaYoshi secure bridge auth address probe')
  } catch (error) {
    throw new Error(`Secure bridge signer failed: ${asError(error).message}`)
  }

  const address = String(signerProbe?.address || '').trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('Secure bridge signer returned an invalid EVM address')
  }

  const challengeRes = await fetchJsonWithStatus(`${apiBase}/v1/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address })
  }).catch((error) => {
    throw asSecureUnavailable(`Auth challenge request failed: ${asError(error).message}`)
  })

  if (!challengeRes.ok) {
    if (isLegacyApiKeyUnauthorized(challengeRes.status, challengeRes.json, challengeRes.text)) {
      throw asSecureUnavailable('Auth challenge requires API key on this server')
    }
    if (isSecureBridgeUnavailableStatus(challengeRes.status)) {
      throw asSecureUnavailable(`Auth challenge endpoint unavailable (HTTP ${challengeRes.status})`)
    }
    const detail = String(challengeRes.json?.error || challengeRes.text || `HTTP ${challengeRes.status}`)
    throw new Error(`Secure bridge auth challenge failed: ${compactErrorText(detail)}`)
  }

  const nonce = String(challengeRes.json?.nonce || '').trim()
  const message = String(challengeRes.json?.message || '').trim()
  if (!nonce || !message) throw new Error('Secure bridge auth challenge response is invalid')

  let signatureResult: { address: string; signature: string }
  try {
    signatureResult = await signer(message)
  } catch (error) {
    throw new Error(`Secure bridge challenge signing failed: ${asError(error).message}`)
  }

  const signedAddress = String(signatureResult?.address || '').trim().toLowerCase()
  if (signedAddress !== address.toLowerCase()) {
    throw new Error('Secure bridge signer address mismatch during challenge verification')
  }

  const verifyRes = await fetchJsonWithStatus(`${apiBase}/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address,
      nonce,
      signature: signatureResult.signature
    })
  }).catch((error) => {
    throw asSecureUnavailable(`Auth verify request failed: ${asError(error).message}`)
  })

  if (!verifyRes.ok) {
    if (isLegacyApiKeyUnauthorized(verifyRes.status, verifyRes.json, verifyRes.text)) {
      throw asSecureUnavailable('Auth verify requires API key on this server')
    }
    if (isSecureBridgeUnavailableStatus(verifyRes.status)) {
      throw asSecureUnavailable(`Auth verify endpoint unavailable (HTTP ${verifyRes.status})`)
    }
    const detail = String(verifyRes.json?.error || verifyRes.text || `HTTP ${verifyRes.status}`)
    throw new Error(`Secure bridge auth verify failed: ${compactErrorText(detail)}`)
  }

  const token = String(verifyRes.json?.sessionToken || '').trim()
  const expiresInSecRaw = Number(verifyRes.json?.expiresInSec ?? 0)
  const expiresInSec = Number.isFinite(expiresInSecRaw) ? Math.max(10, Math.trunc(expiresInSecRaw)) : 60
  if (!token) throw new Error('Secure bridge auth verify response is missing session token')

  secureBridgeSessionCache.set(apiBase, {
    token,
    address: address.toLowerCase(),
    expiresAtMs: now + expiresInSec * 1000
  })

  return { token, address: address.toLowerCase(), apiBase }
}

async function executeSecureBridgeWriteRpc(
  config: UtxoRpcConfig,
  bridgeUrl: string,
  method: string,
  params: any[]
): Promise<any> {
  const session = await getSecureBridgeSession(config, bridgeUrl)
  const { coin, chain } = resolveBridgeCoinChainHint(config)
  const operation: Record<string, unknown> = {
    coin: coin || 'raptoreum',
    chain: chain || 'main',
    method,
    params: Array.isArray(params) ? params : []
  }
  const wallet = resolveBridgeWalletHint(config)
  if (wallet) operation.wallet = wallet

  const opTokenRes = await fetchJsonWithStatus(`${session.apiBase}/v1/auth/op-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({ operation })
  }).catch((error) => {
    throw asSecureUnavailable(`Operation token request failed: ${asError(error).message}`)
  })

  if (!opTokenRes.ok) {
    if (isLegacyApiKeyUnauthorized(opTokenRes.status, opTokenRes.json, opTokenRes.text)) {
      throw asSecureUnavailable('Operation token endpoint requires API key on this server')
    }
    if (isSecureBridgeUnavailableStatus(opTokenRes.status)) {
      throw asSecureUnavailable(`Operation token endpoint unavailable (HTTP ${opTokenRes.status})`)
    }
    const detail = String(opTokenRes.json?.error || opTokenRes.text || `HTTP ${opTokenRes.status}`)
    throw new Error(`Secure bridge operation token failed: ${compactErrorText(detail)}`)
  }

  const opToken = String(opTokenRes.json?.opToken || '').trim()
  if (!opToken) throw new Error('Secure bridge operation token response is invalid')

  const rpcRes = await fetchJsonWithStatus(`${session.apiBase}/v1/secure/bridge/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({ operation, opToken })
  }).catch((error) => {
    throw asSecureUnavailable(`Secure bridge execute request failed: ${asError(error).message}`)
  })

  if (!rpcRes.ok) {
    if (isLegacyApiKeyUnauthorized(rpcRes.status, rpcRes.json, rpcRes.text)) {
      throw asSecureUnavailable('Secure bridge write endpoint requires API key on this server')
    }
    if (isSecureBridgeUnavailableStatus(rpcRes.status)) {
      throw asSecureUnavailable(`Secure bridge write endpoint unavailable (HTTP ${rpcRes.status})`)
    }
    const detail = String(
      rpcRes.json?.error?.message
      || rpcRes.json?.error
      || rpcRes.text
      || `HTTP ${rpcRes.status}`
    )
    throw new Error(`Secure bridge write failed: ${compactErrorText(detail)}`)
  }

  if (rpcRes.json?.error) {
    const detail = String(rpcRes.json.error?.message || rpcRes.json.error || 'Secure bridge RPC error')
    throw new Error(`Secure bridge RPC error: ${compactErrorText(detail)}`)
  }

  return rpcRes.json?.result
}

async function fetchBridgeAddressAssetUtxos(
  config: UtxoRpcConfig,
  address: string
): Promise<RtmUnspentAsset[]> {
  if (!config.bridgeUrl) return []
  const apiBase = deriveBridgeApiBaseUrl(config.bridgeUrl)
  if (!apiBase) return []

  const { coin, chain } = resolveBridgeCoinChainHint(config)
  const params = new URLSearchParams()
  if (coin) params.set('coin', coin)
  if (chain) params.set('chain', chain)

  const url = `${apiBase}/v1/address/${encodeURIComponent(address)}/assets/utxos${params.toString() ? `?${params.toString()}` : ''}`
  const headers: Record<string, string> = {}
  applyBridgeBasicAuthHeaders(headers, config, config.networkId || config.coinSymbol || 'asset UTXO lookup')

  const res = await fetch(url, { method: 'GET', headers })
  if (!res.ok) return []
  const json = await res.json().catch(() => null)
  if (!json?.ok) return []
  const assets = Array.isArray(json?.assets) ? json.assets : []

  return assets.map((row: any) => ({
    txid: String(row?.txid || ''),
    vout: Number(row?.vout),
    address: String(row?.address || address),
    assetName: String(row?.assetName || row?.assetId || ''),
    assetId: String(row?.assetId || ''),
    scriptPubKey: String(row?.scriptPubKey || ''),
    amount: Number(row?.amount ?? 0),
    satoshis: Number(row?.amount ?? row?.satoshis ?? 0),
    confirmations: Number(row?.confirmations ?? 0),
    spendable: row?.spendable !== false
  })).filter((row: RtmUnspentAsset) =>
    Boolean(row.txid)
    && Number.isFinite(row.vout)
    && Boolean(row.scriptPubKey)
    && Number.isFinite(row.amount)
    && row.amount > 0
  )
}

async function fetchBridgeAddressBalance(
  config: UtxoRpcConfig,
  address: string
): Promise<UtxoBalance | null> {
  if (!config.bridgeUrl) return null
  const apiBase = deriveBridgeApiBaseUrl(config.bridgeUrl)
  if (!apiBase) return null

  const { coin, chain } = resolveBridgeCoinChainHint(config)
  if (!coin) return null

  const params = new URLSearchParams()
  params.set('coin', coin)
  params.set('chain', chain || 'main')
  const url = `${apiBase}/v1/address/${encodeURIComponent(address)}/balance?${params.toString()}`

  const controller = new AbortController()
  const timeoutMs = Math.max(3000, Number(config.timeoutMs ?? 10000))
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    if (!json?.ok) return null

    const balanceSat = Number(json?.balanceSat)
    const unconfirmedBalanceSat = Number(json?.unconfirmedBalanceSat)
    if (Number.isFinite(balanceSat) || Number.isFinite(unconfirmedBalanceSat)) {
      const confirmed = Number(((Number.isFinite(balanceSat) ? balanceSat : 0) / 1e8).toFixed(8))
      const unconfirmed = Number(((Number.isFinite(unconfirmedBalanceSat) ? unconfirmedBalanceSat : 0) / 1e8).toFixed(8))
      return {
        confirmed,
        unconfirmed,
        total: Number((confirmed + unconfirmed).toFixed(8))
      }
    }

    const confirmed = Number(json?.balance)
    const unconfirmed = Number(json?.unconfirmedBalance)
    if (Number.isFinite(confirmed) || Number.isFinite(unconfirmed)) {
      const safeConfirmed = Number.isFinite(confirmed) ? Number(confirmed.toFixed(8)) : 0
      const safeUnconfirmed = Number.isFinite(unconfirmed) ? Number(unconfirmed.toFixed(8)) : 0
      return {
        confirmed: safeConfirmed,
        unconfirmed: safeUnconfirmed,
        total: Number((safeConfirmed + safeUnconfirmed).toFixed(8))
      }
    }

    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchBridgeAddressUtxos(
  config: UtxoRpcConfig,
  address: string,
  minConf = 0
): Promise<UtxoUnspent[] | null> {
  if (!config.bridgeUrl) return null
  const apiBase = deriveBridgeApiBaseUrl(config.bridgeUrl)
  if (!apiBase) return null

  const { coin, chain } = resolveBridgeCoinChainHint(config)
  if (!coin) return null

  const params = new URLSearchParams()
  params.set('coin', coin)
  params.set('chain', chain || 'main')
  const url = `${apiBase}/v1/address/${encodeURIComponent(address)}/assets/utxos?${params.toString()}`

  const controller = new AbortController()
  const timeoutMs = Math.max(3000, Number(config.timeoutMs ?? 10000))
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    if (!json?.ok) return null

    const rows = Array.isArray(json?.assets)
      ? json.assets
      : Array.isArray(json?.utxos)
        ? json.utxos
        : []

    const mapped = rows.map((row: any) => {
      const satoshis = Number(row?.satoshis ?? row?.value ?? row?.amountSat ?? 0)
      const amount = Number.isFinite(satoshis) && satoshis > 0
        ? satoshis / 1e8
        : Number(row?.amount ?? 0)
      return {
        txid: String(row?.txid || ''),
        vout: Number(row?.vout),
        address: String(row?.address || address),
        scriptPubKey: String(row?.scriptPubKey || row?.script || ''),
        amount,
        confirmations: Number(row?.confirmations ?? 0)
      } satisfies UtxoUnspent
    }).filter((row: UtxoUnspent) =>
      Boolean(row.txid)
      && Number.isFinite(row.vout)
      && Number.isFinite(row.amount)
      && row.amount > 0
      && row.confirmations >= minConf
    )

    return mapped
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function withInterceptorError(
  interceptor: CoinApiInterceptor | undefined,
  context: Omit<RpcInterceptorErrorContext, 'error'> & { error: unknown }
): Error {
  if (!interceptor?.onError) return asError(context.error)
  try {
    return interceptor.onError(context)
  } catch (interceptorError) {
    return asError(interceptorError)
  }
}

async function jsonRpcCall(
  config: UtxoRpcConfig,
  method: string,
  params: any[] = []
): Promise<any> {
  const { url, username, password, isBridge } = resolveConnection(config)
  const interceptor = resolveApiInterceptor(config)
  if (!url) throw new Error('RPC URL is required')
  const timeoutMs = Number(config.timeoutMs ?? 10000)

  const headers: Record<string, string> = {
    // Bitcoin nodes need text/plain for direct; bridge accepts application/json
    'Content-Type': isBridge ? 'application/json' : 'text/plain'
  }

  if (username && password) {
    headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`
  }
  const bridgeTxKeyCandidates = isBridge
    ? dedupeStringList([...(config.bridgeTxKeyCandidates || []), config.bridgeTxKey])
    : []
  let bridgeTxKeyIndex = 0
  if (isBridge && bridgeTxKeyCandidates.length > 0) {
    headers['X-Bridge-Tx-Key'] = bridgeTxKeyCandidates[bridgeTxKeyIndex]
  }

  const body = JSON.stringify({
    jsonrpc: '1.0',
    id: 'metayoshi',
    method,
    params
  })
  // The interceptor hook gives each coin a dedicated place to shape requests
  // and normalize failures without changing call-sites in wallet logic.
  let request = { url, method, params, headers, body, timeoutMs }
  if (interceptor?.onRequest) {
    try {
      request = await interceptor.onRequest(request)
    } catch (requestError) {
      throw withInterceptorError(interceptor, {
        phase: 'request',
        url,
        method,
        params,
        error: requestError
      })
    }
  }
  const monitorRequestId = useApiMonitorStore.getState().beginRequest({
    networkId: config.networkId,
    rpcMethod: method,
    url: request.url
  })

  const failAndThrow = (
    phase: Omit<RpcInterceptorErrorContext, 'url' | 'method' | 'params' | 'error'>['phase'],
    error: unknown,
    httpStatus?: number
  ): never => {
    const wrapped = withInterceptorError(interceptor, {
      phase,
      url: request.url,
      method,
      params,
      error
    })
    useApiMonitorStore.getState().failRequest(monitorRequestId, {
      errorMessage: wrapped.message,
      httpStatus
    })
    void recordRuntimeError(`rpc-${config.networkId || config.coinSymbol || 'unknown'}`, wrapped, {
      kind: 'rpc-failure',
      phase,
      method,
      url: request.url,
      httpStatus
    })
    throw wrapped
  }

  if (
    isBridge
    && isSecureBridgeWritesEnabled(config)
    && isSecureBridgeWriteMethod(method)
    && !config.useDirectRpc
  ) {
    try {
      const secureResult = await executeSecureBridgeWriteRpc(config, request.url, method, params)
      useApiMonitorStore.getState().completeRequest(monitorRequestId, { httpStatus: 200 })
      return secureResult
    } catch (error) {
      if (!isSecureBridgeUnavailableError(error)) {
        failAndThrow('http', error, 502)
      }
      // Fallback: if secure endpoint is unavailable on this server,
      // continue with legacy bridge path and tx-auth headers.
    }
  }

  let res: Response | null = null
  let responseBodyText = ''
  while (true) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), request.timeoutMs)
    try {
      res = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const mode = isBridge ? 'bridge' : 'direct'
        failAndThrow('transport', new Error(`RPC call timed out [${mode}] after ${request.timeoutMs}ms — ${request.url}`))
      }
      failAndThrow('transport', err)
    } finally {
      clearTimeout(timer)
    }

    if (!res) {
      failAndThrow('transport', new Error('RPC transport failed before receiving a response'))
    }
    const currentResponse = res as Response

    if (
      !currentResponse.ok &&
      isBridge &&
      bridgeTxKeyCandidates.length > bridgeTxKeyIndex + 1
    ) {
      responseBodyText = await currentResponse.text().catch(() => '')
      if (isBridgeTxAuthRejection(currentResponse.status, responseBodyText)) {
        bridgeTxKeyIndex += 1
        request.headers['X-Bridge-Tx-Key'] = bridgeTxKeyCandidates[bridgeTxKeyIndex]
        continue
      }
    }
    break
  }
  const response = res as Response

  if (!response.ok) {
    const mode = isBridge ? 'bridge' : 'direct'
    let bodyText = responseBodyText
    let rpcErrorMessage = ''
    try {
      if (!bodyText) bodyText = await response.text()
      if (bodyText) {
        const parsed = JSON.parse(bodyText)
        rpcErrorMessage = parsed?.error?.message ? String(parsed.error.message) : ''
      }
    } catch {
      // Keep fallback generic HTTP error if body is not JSON/parsable.
    }

    const detail = rpcErrorMessage ? ` | ${rpcErrorMessage}` : ''
    const txAuthRejected = isBridge
      && response.status === 403
      && /transaction authorization key|x-bridge-tx-key/i.test(`${rpcErrorMessage} ${bodyText}`)
    const txAuthHint = txAuthRejected
      ? ' | Configure bridge tx auth in Settings -> Bridge tx auth (runtime storage only; never bundle shared secrets).'
      : ''
    const coinDisabled = /coin is disabled(?::| in registry:)/i.test(`${rpcErrorMessage} ${bodyText}`)
    const coinDisabledHint = coinDisabled
      ? ' | Server disabled this coin. Check server env DISABLE_<COIN>=true / DISABLED_COINS, or coin registry enabled=false.'
      : ''
    const mempoolConflict = /txn-mempool-conflict|\(code\s*18\)|code\s*18/i.test(`${rpcErrorMessage} ${bodyText}`)
    const mempoolConflictHint = mempoolConflict
      ? ' | Inputs are already used by a pending mempool transaction. Wait for confirmation, then retry.'
      : ''
    failAndThrow('http', new Error(`RPC call failed [${mode}]: HTTP ${response.status} ${response.statusText} — ${request.url}${detail}${txAuthHint}${coinDisabledHint}${mempoolConflictHint}`), response.status)
  }

  let json: any
  try {
    json = await response.json()
  } catch (parseError) {
    failAndThrow('parse', parseError, response.status)
  }

  if (json.error) {
    failAndThrow('rpc', new Error(`RPC error [${method}]: ${json.error.message || JSON.stringify(json.error)}`), response.status)
  }

  let result: unknown
  if (!interceptor?.onResponse) {
    result = json.result
  } else {
    try {
      result = await interceptor.onResponse({
        url: request.url,
        method,
        params,
        status: response.status,
        payload: json.result
      })
    } catch (responseError) {
      failAndThrow('rpc', responseError, response.status)
    }
  }

  useApiMonitorStore.getState().completeRequest(monitorRequestId, { httpStatus: response.status })
  return result
}

function isListUnspentRestrictedMessage(message: string): boolean {
  const text = String(message || '').toLowerCase()
  return text.includes('method listunspent is not allowed')
    || (text.includes('listunspent') && text.includes('not allowed'))
}

export async function callBridgeMethod(
  config: UtxoRpcConfig,
  method: string,
  params: any[] = []
): Promise<any> {
  const normalizedMethod = String(method || '').trim().toLowerCase()
  if (!isEvmBridgeReadMethod(normalizedMethod) || !String(config.bridgeUrl || '').trim()) {
    return await jsonRpcCall(config, method, params)
  }

  const bypassKey = resolveEvmBridgeBypassKey(config)
  if (isEvmBridgeBypassActive(bypassKey)) {
    const directConfig = createEvmDirectRpcConfig(config)
    return await jsonRpcCall(directConfig, method, params)
  }

  try {
    const result = await jsonRpcCall(config, method, params)
    clearEvmBridgeBypass(bypassKey)
    return result
  } catch (bridgeError) {
    if (!isBridgeFallbackEligibleError(bridgeError)) throw bridgeError
    const directConfig = createEvmDirectRpcConfig(config)
    try {
      const result = await jsonRpcCall(directConfig, method, params)
      setEvmBridgeBypass(bypassKey)
      return result
    } catch (directError) {
      const bridgeMessage = asError(bridgeError).message
      const directMessage = asError(directError).message
      throw new Error(`${bridgeMessage} | Direct EVM RPC fallback failed: ${directMessage}`)
    }
  }
}

function isEvmBridgeReadMethod(method: string): boolean {
  if (!method.startsWith('eth_')) return false
  const writeOrSensitiveMethods = new Set([
    'eth_sendrawtransaction',
    'eth_sendtransaction',
    'eth_sign',
    'eth_signtypeddata',
    'eth_signtypeddata_v3',
    'eth_signtypeddata_v4',
    'eth_signtransaction'
  ])
  return !writeOrSensitiveMethods.has(method)
}

function resolveEvmBridgeBypassKey(config: UtxoRpcConfig): string {
  return String(config.bridgeUrl || '').trim().toLowerCase()
}

function isEvmBridgeBypassActive(key: string): boolean {
  if (!key) return false
  const until = Number(evmBridgeReadBypassUntil.get(key) || 0)
  if (!Number.isFinite(until) || until <= Date.now()) {
    evmBridgeReadBypassUntil.delete(key)
    return false
  }
  return true
}

function setEvmBridgeBypass(key: string): void {
  if (!key) return
  evmBridgeReadBypassUntil.set(key, Date.now() + EVM_BRIDGE_READ_BYPASS_TTL_MS)
}

function clearEvmBridgeBypass(key: string): void {
  if (!key) return
  evmBridgeReadBypassUntil.delete(key)
}

function isBridgeFallbackEligibleError(error: unknown): boolean {
  const message = asError(error).message
  return (
    /rpc call failed \[bridge\]: http 5\d\d/i.test(message)
    || /secure bridge .*http 5\d\d/i.test(message)
    || /bad gateway/i.test(message)
    || /rpc error \[[^\]]+\]: fetch failed/i.test(message)
    || /rpc call failed \[bridge\]:.*\bfetch failed\b/i.test(message)
    || /rpc call timed out \[bridge\]/i.test(message)
    || /\baborterror\b/i.test(message)
    || /signal is aborted/i.test(message)
    || /returned a non-quantity value/i.test(message)
    || /rpc endpoint appears incompatible/i.test(message)
    || /deprecated v1 endpoint/i.test(message)
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

function createEvmDirectRpcConfig(config: UtxoRpcConfig): UtxoRpcConfig {
  const rpcUrl = String(config.rpcUrl || '').trim()
  if (!rpcUrl) {
    throw new Error('Direct EVM RPC fallback is unavailable: rpcUrl is not configured.')
  }
  if (isBlockedDirectEvmRpcUrl(rpcUrl)) {
    throw new Error(
      `Direct EVM RPC fallback is disabled by policy for ${rpcUrl}. ` +
      'Bridge/server transport is required for this network.'
    )
  }
  if (isLikelyExplorerApiUrl(rpcUrl)) {
    throw new Error(
      `Direct EVM RPC fallback is misconfigured: rpcUrl points to an explorer API (${rpcUrl}). `
      + 'Configure a JSON-RPC endpoint (for example https://ethereum-rpc.publicnode.com).'
    )
  }
  return {
    ...config,
    bridgeUrl: undefined,
    bridgeUsername: undefined,
    bridgePassword: undefined,
    useDirectRpc: true
  }
}

export interface UtxoUnspent {
  txid: string
  vout: number
  address: string
  scriptPubKey: string
  amount: number       // in coins (not sats)
  confirmations: number
}

interface ScantxoutUnspent {
  txid: string
  vout: number
  scriptPubKey?: string
  amount: number | string
  height?: number
}

export interface UtxoBalance {
  confirmed: number    // in coins
  unconfirmed: number  // in coins
  total: number        // in coins
}

const BTCZ_EXPLORER_FALLBACK_BASE = 'https://explorer.btcz.rocks'
const BTC_EXPLORER_MAINNET_BASE = 'https://mempool.space/api'
const BTC_EXPLORER_TESTNET_BASE = 'https://mempool.space/testnet/api'
const BTC_EXPLORER_TESTNET4_BASE = 'https://mempool.space/testnet4/api'

interface BtczExplorerAddressSummary {
  balance?: number | string
  balanceSat?: number | string
  unconfirmedBalance?: number | string
  unconfirmedBalanceSat?: number | string
}

interface BtczExplorerUtxoRow {
  txid?: string
  vout?: number | string
  address?: string
  scriptPubKey?: string
  amount?: number | string
  satoshis?: number | string
  confirmations?: number | string
}

interface BitcoinExplorerAddressSummary {
  chain_stats?: {
    funded_txo_sum?: number | string
    spent_txo_sum?: number | string
  }
  mempool_stats?: {
    funded_txo_sum?: number | string
    spent_txo_sum?: number | string
  }
}

interface BitcoinExplorerUtxoRow {
  txid?: string
  vout?: number | string
  value?: number | string
  status?: {
    confirmed?: boolean
  }
}

interface BitcoinExplorerTxVoutRow {
  n?: number | string
  scriptpubkey?: string
}

interface BitcoinExplorerTxRow {
  vout?: BitcoinExplorerTxVoutRow[]
}

function isBtczConfig(config: UtxoRpcConfig): boolean {
  const networkId = String(config.networkId || '').trim().toLowerCase()
  const symbol = String(config.coinSymbol || '').trim().toUpperCase()
  return networkId === 'btcz' || symbol === 'BTCZ'
}

function isBitcoinTestnetConfig(config: UtxoRpcConfig): boolean {
  const networkId = String(config.networkId || '').trim().toLowerCase()
  if (networkId === 'srv--bitcoin-testnet' || networkId === 'bitcoin-testnet') return true
  const bridgeUrl = String(config.bridgeUrl || '').trim().toLowerCase()
  return bridgeUrl.includes('/bridge/bitcoin-testnet/')
}

function isBitcoinConfig(config: UtxoRpcConfig): boolean {
  if (config.useDirectRpc) return false

  const networkId = String(config.networkId || '').trim().toLowerCase()
  if (
    networkId === 'srv--bitcoin'
    || networkId === 'bitcoin'
    || networkId === 'srv--bitcoin-testnet'
    || networkId === 'bitcoin-testnet'
  ) {
    return true
  }

  const bridgeUrl = String(config.bridgeUrl || '').trim().toLowerCase()
  if (bridgeUrl.includes('/bridge/bitcoin/') || bridgeUrl.includes('/bridge/bitcoin-testnet/')) {
    return true
  }

  return String(config.coinSymbol || '').trim().toUpperCase() === 'BTC'
}

function isDogecoinConfig(config: UtxoRpcConfig): boolean {
  if (config.useDirectRpc) return false

  const networkId = String(config.networkId || '').trim().toLowerCase()
  if (networkId === 'doge' || networkId === 'dogecoin') return true

  const bridgeUrl = String(config.bridgeUrl || '').trim().toLowerCase()
  if (bridgeUrl.includes('/bridge/dogecoin/')) return true

  return String(config.coinSymbol || '').trim().toUpperCase() === 'DOGE'
}

function buildBtczExplorerAddressUrls(address: string, suffix = ''): string[] {
  const encodedAddress = encodeURIComponent(address)
  const configuredBase = String(import.meta.env.VITE_BTCZ_EXPLORER || '').trim()
  const bases = dedupeStringList([configuredBase, BTCZ_EXPLORER_FALLBACK_BASE])
  const urls: string[] = []

  for (const rawBase of bases) {
    const base = rawBase.replace(/\/+$/, '')
    if (!base) continue
    if (/\/api$/i.test(base)) {
      urls.push(`${base}/addr/${encodedAddress}${suffix}`)
    } else {
      urls.push(`${base}/api/addr/${encodedAddress}${suffix}`)
      urls.push(`${base}/addr/${encodedAddress}${suffix}`)
    }
  }

  return Array.from(new Set(urls))
}

async function fetchBtczExplorerJson(config: UtxoRpcConfig, url: string): Promise<any | null> {
  const controller = new AbortController()
  const timeoutMs = Math.max(3000, Number(config.timeoutMs ?? 10000))
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function buildBitcoinExplorerBases(config: UtxoRpcConfig): string[] {
  const customMain = String(import.meta.env.VITE_BTC_EXPLORER || '').trim()
  const customTest = String(import.meta.env.VITE_BTC_TESTNET_EXPLORER || '').trim()
  const isTestnet = isBitcoinTestnetConfig(config)
  if (isTestnet) {
    return dedupeStringList([customTest, BTC_EXPLORER_TESTNET_BASE, BTC_EXPLORER_TESTNET4_BASE])
  }
  return dedupeStringList([customMain, BTC_EXPLORER_MAINNET_BASE])
}

function buildBitcoinExplorerAddressUrls(config: UtxoRpcConfig, address: string, suffix = ''): string[] {
  const encodedAddress = encodeURIComponent(address)
  return buildBitcoinExplorerBases(config)
    .map((base) => `${base.replace(/\/+$/, '')}/address/${encodedAddress}${suffix}`)
}

function buildBitcoinExplorerTxUrls(config: UtxoRpcConfig, txid: string): string[] {
  const encodedTxId = encodeURIComponent(txid)
  return buildBitcoinExplorerBases(config)
    .map((base) => `${base.replace(/\/+$/, '')}/tx/${encodedTxId}`)
}

async function fetchBitcoinExplorerJson(config: UtxoRpcConfig, url: string): Promise<any | null> {
  const controller = new AbortController()
  const timeoutMs = Math.max(3000, Number(config.timeoutMs ?? 10000))
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchBitcoinExplorerBalance(
  config: UtxoRpcConfig,
  address: string
): Promise<UtxoBalance | null> {
  if (!isBitcoinConfig(config)) return null

  for (const url of buildBitcoinExplorerAddressUrls(config, address)) {
    const json: BitcoinExplorerAddressSummary | null = await fetchBitcoinExplorerJson(config, url)
    if (!json || typeof json !== 'object') continue

    const chainFunded = Number(json.chain_stats?.funded_txo_sum ?? NaN)
    const chainSpent = Number(json.chain_stats?.spent_txo_sum ?? NaN)
    const mempoolFunded = Number(json.mempool_stats?.funded_txo_sum ?? 0)
    const mempoolSpent = Number(json.mempool_stats?.spent_txo_sum ?? 0)
    if (!Number.isFinite(chainFunded) || !Number.isFinite(chainSpent)) continue

    const confirmedSats = Math.max(0, chainFunded - chainSpent)
    const unconfirmedSats = Number.isFinite(mempoolFunded) && Number.isFinite(mempoolSpent)
      ? Math.max(0, mempoolFunded - mempoolSpent)
      : 0
    const totalSats = confirmedSats + unconfirmedSats
    return {
      confirmed: Number((confirmedSats / 1e8).toFixed(8)),
      unconfirmed: Number((unconfirmedSats / 1e8).toFixed(8)),
      total: Number((totalSats / 1e8).toFixed(8))
    }
  }

  return null
}

async function fetchBitcoinTxOutputScriptPubKey(
  config: UtxoRpcConfig,
  txid: string,
  vout: number
): Promise<string> {
  if (!txid || !Number.isFinite(vout) || vout < 0) return ''

  for (const url of buildBitcoinExplorerTxUrls(config, txid)) {
    const json: BitcoinExplorerTxRow | null = await fetchBitcoinExplorerJson(config, url)
    if (!json || typeof json !== 'object') continue
    const outputs = Array.isArray(json.vout) ? json.vout : []
    const match = outputs.find((row) => Number(row?.n) === vout)
    const scriptPubKey = String(match?.scriptpubkey || '').trim()
    if (scriptPubKey) return scriptPubKey
  }

  return ''
}

async function fetchBitcoinExplorerUtxos(
  config: UtxoRpcConfig,
  address: string,
  minConf = 1
): Promise<UtxoUnspent[] | null> {
  if (!isBitcoinConfig(config)) return null

  for (const url of buildBitcoinExplorerAddressUrls(config, address, '/utxo')) {
    const json: BitcoinExplorerUtxoRow[] | null = await fetchBitcoinExplorerJson(config, url)
    if (!Array.isArray(json)) continue

    const rows = json
      .map((row) => ({
        txid: String(row?.txid || '').trim(),
        vout: Number(row?.vout),
        valueSats: Number(row?.value ?? NaN),
        confirmed: Boolean(row?.status?.confirmed)
      }))
      .filter((row) =>
        Boolean(row.txid)
        && Number.isFinite(row.vout)
        && row.vout >= 0
        && Number.isFinite(row.valueSats)
        && row.valueSats > 0
        && (minConf <= 0 || row.confirmed)
      )

    const mapped = await Promise.all(rows.map(async (row) => {
      const scriptPubKey = await fetchBitcoinTxOutputScriptPubKey(config, row.txid, row.vout)
      if (!scriptPubKey) return null
      return {
        txid: row.txid,
        vout: row.vout,
        address,
        scriptPubKey,
        amount: row.valueSats / 1e8,
        confirmations: row.confirmed ? Math.max(1, minConf) : 0
      } satisfies UtxoUnspent
    }))

    return mapped.filter((row): row is UtxoUnspent => Boolean(row))
  }

  return null
}

async function fetchBtczExplorerBalance(
  config: UtxoRpcConfig,
  address: string
): Promise<UtxoBalance | null> {
  if (!isBtczConfig(config)) return null
  for (const url of buildBtczExplorerAddressUrls(address)) {
    const json: BtczExplorerAddressSummary | null = await fetchBtczExplorerJson(config, url)
    if (!json || typeof json !== 'object') continue

    const confirmedCandidate = Number(
      json.balance ?? (
        Number.isFinite(Number(json.balanceSat))
          ? Number(json.balanceSat) / 1e8
          : NaN
      )
    )
    const unconfirmedCandidate = Number(
      json.unconfirmedBalance ?? (
        Number.isFinite(Number(json.unconfirmedBalanceSat))
          ? Number(json.unconfirmedBalanceSat) / 1e8
          : 0
      )
    )
    if (!Number.isFinite(confirmedCandidate) || !Number.isFinite(unconfirmedCandidate)) continue

    const confirmed = Number(confirmedCandidate.toFixed(8))
    const unconfirmed = Number(unconfirmedCandidate.toFixed(8))
    const total = Number((confirmed + unconfirmed).toFixed(8))
    return { confirmed, unconfirmed, total }
  }
  return null
}

async function fetchBtczExplorerUtxos(
  config: UtxoRpcConfig,
  address: string,
  minConf = 1
): Promise<UtxoUnspent[] | null> {
  if (!isBtczConfig(config)) return null
  for (const url of buildBtczExplorerAddressUrls(address, '/utxo')) {
    const json: BtczExplorerUtxoRow[] | null = await fetchBtczExplorerJson(config, url)
    if (!Array.isArray(json)) continue

    const mapped = json
      .map((row) => {
        const satoshis = Number(row?.satoshis)
        const amountRaw = Number(row?.amount)
        const amount = Number.isFinite(amountRaw)
          ? amountRaw
          : (Number.isFinite(satoshis) ? satoshis / 1e8 : NaN)
        const confirmations = Number(row?.confirmations ?? 0)
        return {
          txid: String(row?.txid || ''),
          vout: Number(row?.vout),
          address: String(row?.address || address),
          scriptPubKey: String(row?.scriptPubKey || ''),
          amount,
          confirmations
        } satisfies UtxoUnspent
      })
      .filter((row) =>
        Boolean(row.txid)
        && Number.isFinite(row.vout)
        && Number.isFinite(row.amount)
        && row.amount > 0
        && Boolean(row.scriptPubKey)
        && Number.isFinite(row.confirmations)
        && row.confirmations >= minConf
      )

    return mapped
  }

  return null
}

export async function getUtxoBalance(
  config: UtxoRpcConfig,
  address?: string,
  options?: { preferAddressIndex?: boolean }
): Promise<UtxoBalance> {
  // BTCZ bridge often has address-index RPC disabled; use explorer first to avoid
  // a slow failing probe on every balance refresh.
  if (address && isBtczConfig(config)) {
    const btczExplorerBalance = await fetchBtczExplorerBalance(config, address)
    if (btczExplorerBalance) return btczExplorerBalance
  }
  if (address && isBitcoinConfig(config)) {
    const btcExplorerBalance = await fetchBitcoinExplorerBalance(config, address)
    if (btcExplorerBalance) return btcExplorerBalance
  }
  if (address && isDogecoinConfig(config)) {
    const dogeBridgeBalance = await fetchBridgeAddressBalance(config, address)
    if (dogeBridgeBalance) return dogeBridgeBalance
  }

  let addressIndexFailed = false
  // Address-indexed balance path (Raptoreum family): works for non-wallet addresses.
  // Response fields are typically in satoshi-like integer units (8 decimals).
  if (address && options?.preferAddressIndex) {
    try {
      const byAddress = await jsonRpcCall(config, 'getaddressbalance', [{ addresses: [address] }])
      const spendableRaw = Number(byAddress?.balance_spendable ?? byAddress?.balance ?? 0)
      const totalRaw = Number(byAddress?.balance ?? spendableRaw)
      if (Number.isFinite(spendableRaw) && Number.isFinite(totalRaw)) {
        const confirmed = spendableRaw / 100000000
        const total = totalRaw / 100000000
        const unconfirmed = Math.max(0, total - confirmed)
        return { confirmed, unconfirmed, total }
      }
    } catch {
      addressIndexFailed = true
      // fall through to wallet/listunspent path
    }
  }

  if (!address) {
    try {
      const balance = await jsonRpcCall(config, 'getbalance', [])
      return { confirmed: balance || 0, unconfirmed: 0, total: balance || 0 }
    } catch {
      // fall through to listunspent
    }
  }

  const params = address ? [0, 9999999, [address]] : [0, 9999999]
  let unspent: UtxoUnspent[] = []
  try {
    unspent = await jsonRpcCall(config, 'listunspent', params)
  } catch (error) {
    const errorMessage = asError(error).message
    if (address) {
      // Shared providers can block wallet-index methods like listunspent.
      // Try address-index and generic balance fallbacks before failing hard.
      try {
        const byAddressUtxos = await getAddressUtxos(config, address, 0)
        if (byAddressUtxos.length > 0) {
          let addrConfirmed = 0
          let addrUnconfirmed = 0
          for (const utxo of byAddressUtxos) {
            if (utxo.confirmations >= 1) addrConfirmed += utxo.amount
            else addrUnconfirmed += utxo.amount
          }
          return {
            confirmed: Number(addrConfirmed.toFixed(8)),
            unconfirmed: Number(addrUnconfirmed.toFixed(8)),
            total: Number((addrConfirmed + addrUnconfirmed).toFixed(8))
          }
        }
      } catch {
        // continue
      }

      try {
        const received = Number(await jsonRpcCall(config, 'getreceivedbyaddress', [address, 0]))
        if (Number.isFinite(received) && received >= 0) {
          return {
            confirmed: Number(received.toFixed(8)),
            unconfirmed: 0,
            total: Number(received.toFixed(8))
          }
        }
      } catch {
        // continue
      }

      try {
        const walletBalance = Number(await jsonRpcCall(config, 'getbalance', []))
        if (Number.isFinite(walletBalance) && walletBalance >= 0) {
          return {
            confirmed: Number(walletBalance.toFixed(8)),
            unconfirmed: 0,
            total: Number(walletBalance.toFixed(8))
          }
        }
      } catch {
        // continue
      }

      const btcExplorerBalance = await fetchBitcoinExplorerBalance(config, address)
      if (btcExplorerBalance) return btcExplorerBalance
      const btcExplorerUtxos = await fetchBitcoinExplorerUtxos(config, address, 0)
      if (btcExplorerUtxos !== null) {
        let btcConfirmed = 0
        let btcUnconfirmed = 0
        for (const utxo of btcExplorerUtxos) {
          if (utxo.confirmations >= 1) btcConfirmed += utxo.amount
          else btcUnconfirmed += utxo.amount
        }
        const btcTotal = btcConfirmed + btcUnconfirmed
        return {
          confirmed: Number(btcConfirmed.toFixed(8)),
          unconfirmed: Number(btcUnconfirmed.toFixed(8)),
          total: Number(btcTotal.toFixed(8))
        }
      }
      if (isListUnspentRestrictedMessage(errorMessage)) {
        const scanned = await scanAddressUnspent(config, address).catch(() => [])
        if (scanned.length > 0) {
          let scanTotal = 0
          for (const utxo of scanned) scanTotal += utxo.amount
          const total = Number(scanTotal.toFixed(8))
          return { confirmed: total, unconfirmed: 0, total }
        }
        throw new Error(
          'Bridge provider blocks listunspent on shared nodes and no chainstate scan is available. ' +
          'Use a dedicated node/full RPC access for spendable UTXO operations.'
        )
      }
    }
    throw error
  }

  let confirmed = 0
  let unconfirmed = 0
  for (const utxo of unspent) {
    if (utxo.confirmations >= 1) confirmed += utxo.amount
    else unconfirmed += utxo.amount
  }

  const total = confirmed + unconfirmed
  if (address && total <= 0) {
    try {
      if (options?.preferAddressIndex) {
        const byAddressUtxos = await getAddressUtxos(config, address, 0)
        if (byAddressUtxos.length > 0) {
          let addrConfirmed = 0
          let addrUnconfirmed = 0
          for (const utxo of byAddressUtxos) {
            if (utxo.confirmations >= 1) addrConfirmed += utxo.amount
            else addrUnconfirmed += utxo.amount
          }
          return {
            confirmed: Number(addrConfirmed.toFixed(8)),
            unconfirmed: Number(addrUnconfirmed.toFixed(8)),
            total: Number((addrConfirmed + addrUnconfirmed).toFixed(8))
          }
        }
      }
    } catch {
      // BTCZ can still recover via explorer summary fallback below.
    }

    const btczExplorerBalance = await fetchBtczExplorerBalance(config, address)
    if (btczExplorerBalance) return btczExplorerBalance
    const btcExplorerBalance = await fetchBitcoinExplorerBalance(config, address)
    if (btcExplorerBalance) return btcExplorerBalance

    if (addressIndexFailed && isBtczConfig(config)) {
      throw new Error('BTCZ address-index RPC is disabled and explorer fallback is unavailable')
    }
  }

  return { confirmed, unconfirmed, total }
}

/** List unspent outputs via the wallet index.
 *  Only returns UTXOs for addresses that are imported into the node wallet.
 *  For HD-derived addresses use getAddressUtxos() instead.
 *  @param minConf  Minimum confirmations (default 0 → includes unconfirmed).
 *                  Use 1 when selecting inputs for a new transaction. */
export async function listUtxoUnspent(
  config: UtxoRpcConfig,
  address?: string,
  minConf = 0
): Promise<UtxoUnspent[]> {
  if (address && isBtczConfig(config)) {
    const btczExplorer = await fetchBtczExplorerUtxos(config, address, minConf)
    if (btczExplorer !== null) return btczExplorer
  }
  if (address && isBitcoinConfig(config)) {
    const btcExplorer = await fetchBitcoinExplorerUtxos(config, address, minConf)
    if (btcExplorer !== null) return btcExplorer
  }
  if (address && isDogecoinConfig(config)) {
    const dogeBridgeUtxos = await fetchBridgeAddressUtxos(config, address, minConf)
    if (dogeBridgeUtxos !== null) return dogeBridgeUtxos
  }

  const params = address ? [minConf, 9999999, [address]] : [minConf, 9999999]
  try {
    return await jsonRpcCall(config, 'listunspent', params)
  } catch (error) {
    const message = asError(error).message
    if (address) {
      try {
        const byAddress = await getAddressUtxos(config, address, minConf)
        if (byAddress.length > 0) return byAddress
      } catch {
        // continue fallback chain
      }
      // Shared providers can block wallet-index methods like listunspent.
      // Fall back to chainstate scans (confirmed only) to keep non-custodial sends functional.
      if (isListUnspentRestrictedMessage(message)) {
        const scanned = await scanAddressUnspent(config, address).catch(() => [])
        if (scanned.length > 0) return scanned
      }
      const btczExplorer = await fetchBtczExplorerUtxos(config, address, minConf)
      if (btczExplorer !== null) return btczExplorer
      const btcExplorer = await fetchBitcoinExplorerUtxos(config, address, minConf)
      if (btcExplorer !== null) return btcExplorer
      if (isListUnspentRestrictedMessage(message)) {
        throw new Error(
          'Bridge provider blocks listunspent on shared nodes. ' +
          'Use a dedicated node/full RPC access for spendable UTXO operations.'
        )
      }
    }
    throw error
  }
}

/**
 * Fetch confirmed UTXOs for an address using the address index
 * (getaddressutxos — requires -addressindex=1 on the node, RTM has this).
 *
 * Unlike listunspent this works for ANY address, wallet-imported or not.
 * Each returned entry includes scriptPubKey so client-side signing can proceed.
 */
export async function getAddressUtxos(
  config: UtxoRpcConfig,
  address: string,
  minConf = 1
): Promise<UtxoUnspent[]> {
  interface AddressUtxoEntry {
    address: string
    txid: string
    outputIndex: number
    script: string     // scriptPubKey hex
    satoshis: number   // in satoshis
    height: number
  }

  if (isBtczConfig(config)) {
    const btczExplorer = await fetchBtczExplorerUtxos(config, address, minConf)
    if (btczExplorer !== null) return btczExplorer
  }
  if (isBitcoinConfig(config)) {
    const btcExplorer = await fetchBitcoinExplorerUtxos(config, address, minConf)
    if (btcExplorer !== null) return btcExplorer
  }
  if (isDogecoinConfig(config)) {
    const dogeBridgeUtxos = await fetchBridgeAddressUtxos(config, address, minConf)
    if (dogeBridgeUtxos !== null) return dogeBridgeUtxos
  }

  let raw: AddressUtxoEntry[] = []
  try {
    raw = await jsonRpcCall(
      config,
      'getaddressutxos',
      [{ addresses: [address] }]
    )
  } catch (error) {
    const btczExplorer = await fetchBtczExplorerUtxos(config, address, minConf)
    if (btczExplorer !== null) return btczExplorer
    const btcExplorer = await fetchBitcoinExplorerUtxos(config, address, minConf)
    if (btcExplorer !== null) return btcExplorer
    throw error
  }

  if (!Array.isArray(raw)) return []

  return raw
    .filter(u => u.txid && typeof u.outputIndex === 'number' && u.satoshis > 0 && u.script)
    .map(u => ({
      txid:          u.txid,
      vout:          u.outputIndex,
      address:       u.address ?? address,
      scriptPubKey:  u.script,
      amount:        u.satoshis / 1e8,
      // Address-index UTXOs are all confirmed; filter by minConf via block height.
      // height > 0 means confirmed; height === 0 is mempool (treat as unconfirmed).
      confirmations: u.height > 0 ? minConf : 0
    }))
    .filter(u => u.confirmations >= minConf)
}

/** Outpoints currently consumed by mempool spends for an address.
 *  Useful with address-index UTXO discovery to avoid mempool conflicts (code 18). */
export async function getAddressMempoolSpentOutpoints(
  config: UtxoRpcConfig,
  address: string
): Promise<Set<string>> {
  interface AddressMempoolEntry {
    prevtxid?: string
    prevout?: number
    previndex?: number
    txid?: string
    index?: number
    satoshis?: number
  }

  const outpoints = new Set<string>()
  const raw: AddressMempoolEntry[] = await jsonRpcCall(
    config,
    'getaddressmempool',
    [{ addresses: [address] }]
  )

  if (!Array.isArray(raw)) return outpoints

  for (const row of raw) {
    const prevTxId = String(row?.prevtxid || '').trim()
    const prevOutRaw = Number(row?.prevout ?? row?.previndex)
    if (!prevTxId || !Number.isFinite(prevOutRaw) || prevOutRaw < 0) continue
    outpoints.add(`${prevTxId}:${Math.trunc(prevOutRaw)}`)
  }

  return outpoints
}

/** Scan confirmed UTXOs for an address from chainstate (does not require wallet import). */
export async function scanAddressUnspent(
  config: UtxoRpcConfig,
  address: string
): Promise<UtxoUnspent[]> {
  // Chainstate scans can be slow on large datasets; use a longer timeout.
  const scanConfig: UtxoRpcConfig = {
    ...config,
    timeoutMs: Math.max(Number(config.timeoutMs ?? 10000), 45000)
  }

  const parseScanResult = (res: any): UtxoUnspent[] => {
    const unspents = Array.isArray(res?.unspents) ? (res.unspents as ScantxoutUnspent[]) : []
    return unspents
      .map((u) => ({
        txid: String(u.txid),
        vout: Number(u.vout),
        address,
        scriptPubKey: String(u.scriptPubKey || ''),
        amount: Number(u.amount),
        // UTXO set is confirmed chainstate data; treat as confirmed.
        confirmations: 1
      }))
      .filter((u) => Boolean(u.txid) && Number.isFinite(u.vout) && Number.isFinite(u.amount) && u.amount > 0 && Boolean(u.scriptPubKey))
  }

  try {
    const res = await jsonRpcCall(scanConfig, 'scantxoutset', ['start', [`addr(${address})`]])
    const parsed = parseScanResult(res)
    if (parsed.length > 0) return parsed
  } catch {
    // try non-wallet bridge route fallback
  }

  try {
      const bridgeUrl = String(config.bridgeUrl || '')
      if (bridgeUrl.includes('/wallet/')) {
        const baseBridgeUrl = bridgeUrl.replace(/\/wallet\/[^/]+\/?$/, '')
        const res = await jsonRpcCall({ ...scanConfig, bridgeUrl: baseBridgeUrl }, 'scantxoutset', ['start', [`addr(${address})`]])
        return parseScanResult(res)
      }
  } catch {
    // final fallback below
  }

  const btczExplorer = await fetchBtczExplorerUtxos(config, address, 1)
  if (btczExplorer !== null) return btczExplorer
  const btcExplorer = await fetchBitcoinExplorerUtxos(config, address, 1)
  if (btcExplorer !== null) return btcExplorer

  return []
}

export async function createRawTransaction(
  config: UtxoRpcConfig,
  inputs: Array<{ txid: string; vout: number }>,
  outputs: Record<string, number>
): Promise<string> {
  // Normalize amounts to satoshi precision (8 decimals) to avoid floating-point
  // artifacts like 2.9909600000000003 that make the node reject "Invalid amount".
  const normalizedOutputs = Object.fromEntries(
    Object.entries(outputs).map(([address, amount]) => {
      const sats = Math.round(Number(amount) * 1e8)
      return [address, Number((sats / 1e8).toFixed(8))]
    })
  ) as Record<string, number>

  return await jsonRpcCall(config, 'createrawtransaction', [inputs, normalizedOutputs])
}

export async function sendRawTransaction(config: UtxoRpcConfig, hex: string): Promise<string> {
  return await jsonRpcCall(config, 'sendrawtransaction', [hex])
}

/** Simple send using the node's own wallet (requires the node to hold the private key). */
export async function sendToAddress(
  config: UtxoRpcConfig,
  toAddress: string,
  amount: number,
  comment = '',
  commentTo = ''
): Promise<string> {
  return await jsonRpcCall(config, 'sendtoaddress', [toAddress, amount, comment, commentTo])
}

/** Fund a raw transaction: the node adds inputs, fee, and a change output.
 *  Requires the address involved to be in the node wallet (watch-only or full). */
export async function fundRawTransaction(
  config: UtxoRpcConfig,
  rawHex: string,
  options?: { changeAddress?: string; feeRate?: number }
): Promise<{ hex: string; fee: number; changepos: number }> {
  const params: any[] = [rawHex]
  if (options) params.push(options)
  return await jsonRpcCall(config, 'fundrawtransaction', params)
}

/** Decode a raw transaction hex into a human-readable object. */
export async function decodeRawTransaction(
  config: UtxoRpcConfig,
  hex: string
): Promise<Record<string, any>> {
  return await jsonRpcCall(config, 'decoderawtransaction', [hex])
}

/** Fetch a full transaction by txid.
 *  @param verbose  true → decoded JSON; false → raw hex string */
export async function getRawTransaction(
  config: UtxoRpcConfig,
  txid: string,
  verbose = true
): Promise<any> {
  return await jsonRpcCall(config, 'getrawtransaction', [txid, verbose ? 1 : 0])
}

/** Total received by an address (cumulative, never decreases).
 *  @param minConf  Minimum confirmations (default 1). */
export async function getReceivedByAddress(
  config: UtxoRpcConfig,
  address: string,
  minConf = 1
): Promise<number> {
  return await jsonRpcCall(config, 'getreceivedbyaddress', [address, minConf])
}

/** Node wallet info (balance, txcount, keypoolsize, etc.). */
export async function getWalletInfo(config: UtxoRpcConfig): Promise<Record<string, any>> {
  return await jsonRpcCall(config, 'getwalletinfo', [])
}

export async function getNewAddress(config: UtxoRpcConfig, label?: string): Promise<string> {
  return await jsonRpcCall(config, 'getnewaddress', label ? [label] : [])
}

export async function validateAddress(config: UtxoRpcConfig, address: string): Promise<{
  isvalid: boolean; address: string; scriptPubKey?: string; ismine?: boolean; isscript?: boolean
}> {
  return await jsonRpcCall(config, 'validateaddress', [address])
}

export interface BlockchainInfo {
  chain?: string
  blocks?: number
  headers?: number
  verificationprogress?: number
  initialblockdownload?: boolean
  [key: string]: unknown
}

export async function getBlockchainInfo(config: UtxoRpcConfig): Promise<BlockchainInfo> {
  return await jsonRpcCall(config, 'getblockchaininfo', [])
}

// ── Raptoreum Asset Layer ─────────────────────────────────────────────────────
// RTM supports ROOT and ROOT/SUB assets. Amounts from the node are in satoshi-like
// integer units (8 decimal places by default).  e.g. 100_000_000 = 1.00000000

export interface RtmAssetDetails {
  name: string
  amount: number          // total supply in sats
  units: number           // decimal places (usually 8)
  reissuable: boolean
  has_ipfs: boolean
  ipfs_hash?: string
  preview_url?: string
  metadata_url?: string
  token_id?: string
  contract_address?: string
  token_standard?: 'erc721' | 'erc1155'
  txid_or_longname: string
  ownership_address?: string
  Asset_id?: string
  Asset_name?: string
  Decimalpoint?: number
}

export interface RtmUnspentAsset {
  txid: string
  vout: number
  address: string
  assetName: string
  assetId?: string
  scriptPubKey?: string
  amount: number          // in sats
  satoshis: number
  confirmations: number
  spendable?: boolean
}

interface NonCustodialAssetSpendInput {
  txid: string
  vout: number
  scriptPubKey: string
  amountSats: number
}

interface NonCustodialAssetSendParams {
  fromAddress: string
  fromPrivateKeyHex: string
  assetId: string
  qty: string
  toAddress: string
  changeAddress?: string
  assetChangeAddress?: string
  feePerByteSats?: number
}

interface ResolvedAssetIdentity {
  canonicalName: string
  canonicalId: string
  decimalPoint: number
}

function normalizeHexKey(value: string): string {
  const hex = String(value || '').trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Invalid private key format')
  return hex.toLowerCase()
}

function fractionalDigits(raw: string): number {
  const compact = String(raw || '').trim().replace(/\s+/g, '')
  const normalized = compact.replace(',', '.')
  const dot = normalized.indexOf('.')
  return dot >= 0 ? normalized.length - dot - 1 : 0
}

function coinsToSats(coins: number): number {
  return Math.round(Number(coins) * 1e8)
}

function satsToCoins8(sats: number): number {
  return Number((sats / 1e8).toFixed(8))
}

function normalizeAssetToken(value: string): string {
  return String(value || '').trim().toUpperCase().replace(/[|#:]/g, '/')
}

function getAssetNameVariants(input: string): string[] {
  const normalized = String(input || '').trim()
  if (!normalized) return []
  const split = normalized.match(/^([^|/#:]+)[|/#:]([^|/#:]+)$/)
  const root = split?.[1]?.trim() || ''
  const sub = split?.[2]?.trim() || ''
  return Array.from(new Set([
    normalized,
    normalized.includes('|') ? normalized.replace('|', '/') : normalized,
    normalized.includes('/') ? normalized.replace('/', '|') : normalized,
    normalized.includes('#') ? normalized.replace('#', '/') : normalized,
    normalized.includes('/') ? normalized.replace('/', '#') : normalized,
    (root && sub) ? `${root}/${sub}` : normalized,
    (root && sub) ? `${root}|${sub}` : normalized,
    (root && sub) ? `${root}#${sub}` : normalized,
    normalized.toUpperCase(),
    ((root && sub) ? `${root}/${sub}` : normalized).toUpperCase(),
    ((root && sub) ? `${root}|${sub}` : normalized).toUpperCase()
  ]))
}

async function resolveAssetIdentity(config: UtxoRpcConfig, requestedAssetId: string): Promise<ResolvedAssetIdentity> {
  const candidates = getAssetNameVariants(requestedAssetId)
  if (candidates.length === 0) throw new Error('Asset id is required')

  for (const candidate of candidates) {
    try {
      const details = await getAssetDetailsByName(config, candidate)
      const canonicalName = String((details as any)?.name ?? (details as any)?.Asset_name ?? candidate).trim()
      const canonicalId = String((details as any)?.assetId ?? (details as any)?.Asset_id ?? '').trim()
      const decimalPointRaw = Number((details as any)?.units ?? (details as any)?.Decimalpoint ?? 8)
      const decimalPoint = Number.isFinite(decimalPointRaw)
        ? Math.max(0, Math.min(8, Math.trunc(decimalPointRaw)))
        : 8

      return {
        canonicalName: canonicalName || candidate,
        canonicalId,
        decimalPoint
      }
    } catch {
      // try next spelling variant
    }
  }

  return {
    canonicalName: requestedAssetId.trim(),
    canonicalId: '',
    decimalPoint: 8
  }
}

function buildMixedOutputsObject(params: {
  toAddress: string
  assetId: string
  qtyCoins: number
  assetChangeAddress: string
  assetChangeCoins: number
  coinChangeAddress: string
  coinChangeCoins: number
}): Record<string, number | { assetid: string; amount: number }> {
  const out: Record<string, number | { assetid: string; amount: number }> = {}

  const addAsset = (address: string, amountCoins: number) => {
    if (amountCoins <= 0) return
    const existing = out[address]
    if (existing === undefined) {
      out[address] = { assetid: params.assetId, amount: Number(amountCoins.toFixed(8)) }
      return
    }
    if (typeof existing === 'number') {
      throw new Error(
        `Cannot place both coin and asset outputs on ${address}. ` +
        'Provide a different RTM change address for this transfer.'
      )
    }
    if (normalizeAssetToken(existing.assetid) !== normalizeAssetToken(params.assetId)) {
      throw new Error(`Address ${address} already contains a different asset output in this transaction.`)
    }
    existing.amount = Number((existing.amount + amountCoins).toFixed(8))
  }

  const addCoin = (address: string, amountCoins: number) => {
    if (amountCoins <= 0) return
    const existing = out[address]
    if (existing === undefined) {
      out[address] = Number(amountCoins.toFixed(8))
      return
    }
    if (typeof existing !== 'number') {
      throw new Error(
        `Cannot place both coin and asset outputs on ${address}. ` +
        'Provide a different RTM change address for this transfer.'
      )
    }
    out[address] = Number((existing + amountCoins).toFixed(8))
  }

  addAsset(params.toAddress, params.qtyCoins)
  addAsset(params.assetChangeAddress, params.assetChangeCoins)
  addCoin(params.coinChangeAddress, params.coinChangeCoins)

  return out
}

/**
 * Option B (strict non-custodial):
 *   - collect spendable asset inputs + fee inputs
 *   - build raw asset tx client-side
 *   - sign client-side with account private key
 *   - broadcast signed hex via sendrawtransaction
 */
export async function sendRtmAssetNonCustodial(
  config: UtxoRpcConfig,
  params: NonCustodialAssetSendParams
): Promise<string> {
  const fromAddress = String(params.fromAddress || '').trim()
  const toAddress = String(params.toAddress || '').trim()
  if (!fromAddress) throw new Error('Sender address is required')
  if (!toAddress) throw new Error('Destination address is required')

  const privateKeyHex = normalizeHexKey(params.fromPrivateKeyHex)
  const qtyNum = parseRpcDecimalAmount(params.qty, 8, 'Asset quantity')
  const assetIdentity = await resolveAssetIdentity(config, params.assetId)

  if (fractionalDigits(params.qty) > assetIdentity.decimalPoint) {
    throw new Error(
      `Asset quantity has too many decimals for ${assetIdentity.canonicalName}. ` +
      `Supported decimals: ${assetIdentity.decimalPoint}.`
    )
  }

  const requestedAssetNames = new Set(getAssetNameVariants(params.assetId).map(normalizeAssetToken))
  requestedAssetNames.add(normalizeAssetToken(assetIdentity.canonicalName))

  const qtyRawSats = coinsToSats(qtyNum)
  if (qtyRawSats <= 0) throw new Error('Asset quantity must be greater than zero')

  let allAssetUtxos = await listUnspentAssets(config, fromAddress).catch(() => [])
  if (allAssetUtxos.length === 0 && !config.useDirectRpc) {
    const byAddressApi = await fetchBridgeAddressAssetUtxos(config, fromAddress).catch(() => [])
    if (byAddressApi.length > 0) allAssetUtxos = byAddressApi
  }
  const spendableAssetUtxos: NonCustodialAssetSpendInput[] = []
  const spendableAssetUtxosCoinUnits: NonCustodialAssetSpendInput[] = []

  for (const row of allAssetUtxos) {
    if (String((row as any)?.address ?? '').trim() !== fromAddress) continue
    if ((row as any)?.spendable === false) continue
    if (Number((row as any)?.confirmations ?? 0) < 1) continue

    const rowAssetId = String((row as any)?.assetId ?? '').trim()
    const rowAssetName = String((row as any)?.assetName ?? '').trim()

    const idMatches =
      !!assetIdentity.canonicalId
      && rowAssetId
      && rowAssetId.toLowerCase() === assetIdentity.canonicalId.toLowerCase()

    const nameMatches = rowAssetName && requestedAssetNames.has(normalizeAssetToken(rowAssetName))
    if (!idMatches && !nameMatches) continue

    const scriptPubKey = String((row as any)?.scriptPubKey ?? '').trim()
    const rawAmt = Number((row as any)?.amount ?? (row as any)?.satoshis ?? 0)
    if (!scriptPubKey || !Number.isFinite(rawAmt) || rawAmt <= 0) continue

    spendableAssetUtxos.push({
      txid: String((row as any)?.txid),
      vout: Number((row as any)?.vout),
      scriptPubKey,
      amountSats: Math.trunc(rawAmt)
    })
    spendableAssetUtxosCoinUnits.push({
      txid: String((row as any)?.txid),
      vout: Number((row as any)?.vout),
      scriptPubKey,
      amountSats: Math.round(rawAmt * 1e8)
    })
  }

  if (spendableAssetUtxos.length === 0) {
    throw new Error(
      `No spendable asset UTXOs found for ${assetIdentity.canonicalName} on ${fromAddress}. ` +
      'Bridge listunspentassets is empty for this address; import key on server (Path A) or enable asset UTXO exposure for strict Option B.'
    )
  }

  // Some bridge/index fallbacks return asset amounts in coin-style units
  // (1 == one token) instead of raw sat-style units (100000000 == one token).
  // Detect and normalize dynamically.
  const totalAsRaw = spendableAssetUtxos.reduce((sum, u) => sum + u.amountSats, 0)
  const totalAsCoinUnits = spendableAssetUtxosCoinUnits.reduce((sum, u) => sum + u.amountSats, 0)
  const normalizedAssetUtxos =
    totalAsRaw < qtyRawSats && totalAsCoinUnits >= qtyRawSats
      ? spendableAssetUtxosCoinUnits
      : spendableAssetUtxos

  const selectedAssetInputs: NonCustodialAssetSpendInput[] = []
  let assetAccumSats = 0
  for (const utxo of normalizedAssetUtxos.sort((a, b) => b.amountSats - a.amountSats)) {
    selectedAssetInputs.push(utxo)
    assetAccumSats += utxo.amountSats
    if (assetAccumSats >= qtyRawSats) break
  }
  if (assetAccumSats < qtyRawSats) {
    throw new Error(
      `Insufficient ${assetIdentity.canonicalName} balance in spendable UTXOs. ` +
      `Need ${(qtyRawSats / 1e8).toFixed(8)}, found ${(assetAccumSats / 1e8).toFixed(8)}.`
    )
  }

  let feeCoins: UtxoUnspent[] = []
  try {
    feeCoins = await getAddressUtxos(config, fromAddress, 1)
  } catch {
    // fall back below
  }
  if (feeCoins.length === 0) {
    try {
      feeCoins = await listUtxoUnspent(config, fromAddress, 1)
    } catch {
      // fall back below
    }
  }
  if (feeCoins.length === 0) {
    feeCoins = await scanAddressUnspent(config, fromAddress)
  }
  if (feeCoins.length === 0) {
    throw new Error('No confirmed RTM UTXOs available to pay network fee for asset transfer')
  }

  const feePerByteSats = Math.max(1, Math.trunc(Number(params.feePerByteSats ?? 2)))
  const DUST_SATS = 1000
  const OVERHEAD_BYTES = 10
  const INPUT_BYTES = 148
  const OUTPUT_BYTES = 34
  const MAX_REASONABLE_FEE_SATS = 10_000_000

  const assetChangeAddr = String(params.assetChangeAddress || '').trim() || fromAddress
  const rtmChangeAddr = String(params.changeAddress || '').trim() || fromAddress

  const assetOutCount = qtyRawSats < assetAccumSats ? 2 : 1
  const selectedFeeInputs: UtxoUnspent[] = []
  let feeInputAccumSats = 0
  let finalFeeSats = 0
  let finalChangeSats = 0

  const sortedFeeCoins = [...feeCoins].sort((a, b) => b.amount - a.amount)
  for (const utxo of sortedFeeCoins) {
    selectedFeeInputs.push(utxo)
    feeInputAccumSats += coinsToSats(utxo.amount)

    const inputCount = selectedAssetInputs.length + selectedFeeInputs.length
    const withChangeBytes = OVERHEAD_BYTES + INPUT_BYTES * inputCount + OUTPUT_BYTES * (assetOutCount + 1)
    const withChangeFee = withChangeBytes * feePerByteSats
    const withChangeLeft = feeInputAccumSats - withChangeFee

    if (withChangeLeft >= DUST_SATS) {
      finalFeeSats = withChangeFee
      finalChangeSats = withChangeLeft
      break
    }

    const noChangeBytes = OVERHEAD_BYTES + INPUT_BYTES * inputCount + OUTPUT_BYTES * assetOutCount
    const noChangeFee = noChangeBytes * feePerByteSats
    if (feeInputAccumSats >= noChangeFee) {
      finalFeeSats = noChangeFee
      finalChangeSats = 0
      break
    }

    if (selectedFeeInputs.length >= 25) break
  }

  if (finalFeeSats <= 0 || feeInputAccumSats < finalFeeSats) {
    throw new Error('Insufficient RTM inputs to pay asset transfer network fee')
  }
  if (finalFeeSats > MAX_REASONABLE_FEE_SATS) {
    throw new Error(`Estimated fee too high: ${(finalFeeSats / 1e8).toFixed(8)} RTM`)
  }

  const assetSendCoins = satsToCoins8(qtyRawSats)
  const assetChangeCoins = satsToCoins8(Math.max(0, assetAccumSats - qtyRawSats))
  const coinChangeCoins = satsToCoins8(finalChangeSats)
  const outputAssetId = assetIdentity.canonicalId || assetIdentity.canonicalName

  const outputs = buildMixedOutputsObject({
    toAddress,
    assetId: outputAssetId,
    qtyCoins: assetSendCoins,
    assetChangeAddress: assetChangeAddr,
    assetChangeCoins,
    coinChangeAddress: rtmChangeAddr,
    coinChangeCoins
  })

  const inputs = [
    ...selectedAssetInputs.map((u) => ({ txid: u.txid, vout: u.vout })),
    ...selectedFeeInputs.map((u) => ({ txid: u.txid, vout: u.vout }))
  ]

  const createRawTxViaBestBridgeRoute = async (): Promise<string> => {
    const rpcConfigs: UtxoRpcConfig[] = [config]
    const chainBridgeUrl = deriveBridgeChainEndpointUrl(config)
    if (
      chainBridgeUrl
      && String(chainBridgeUrl).trim().toLowerCase() !== String(config.bridgeUrl || '').trim().toLowerCase()
    ) {
      rpcConfigs.push({ ...config, bridgeUrl: chainBridgeUrl })
    }

    const maxAttempts = 4
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      for (let cfgIndex = 0; cfgIndex < rpcConfigs.length; cfgIndex += 1) {
        const rpcConfig = rpcConfigs[cfgIndex]
        try {
          const created = await jsonRpcCall(rpcConfig, 'createrawtransaction', [inputs, outputs])
          return String(created)
        } catch (error) {
          const wrapped = asError(error)
          lastError = wrapped
          const msg = wrapped.message

          const hasMoreEndpointCandidates = cfgIndex < rpcConfigs.length - 1
          const hasMoreAttempts = attempt < maxAttempts - 1
          if (!hasMoreEndpointCandidates && !hasMoreAttempts) break

          const cooldownMs = parseBridgeCooldownMs(msg)
          if (cooldownMs !== null) {
            await sleep(cooldownMs + 250)
            continue
          }

          const transientBridgeFailure =
            isBridgeFallbackEligibleError(wrapped)
            || /upstream rpc fetch failed/i.test(msg)
            || /rpc call failed \[bridge\].*\bhttp\s*5\d\d\b/i.test(msg)
          if (transientBridgeFailure) continue

          throw wrapped
        }
      }

      if (attempt < maxAttempts - 1) {
        await sleep(400 * (attempt + 1))
      }
    }

    const detail = lastError?.message || 'unknown error'
    throw new Error(
      `Failed to build RTM asset transaction on bridge after ${maxAttempts} attempts: ${detail}. ` +
      'Server bridge upstream is unstable; verify RTM daemon/RPC health on server.'
    )
  }

  const rawHex = await createRawTxViaBestBridgeRoute()

  const signingInputs: UnsignedTxInput[] = [
    ...selectedAssetInputs.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      scriptPubKeyHex: u.scriptPubKey,
      amountSats: 0
    })),
    ...selectedFeeInputs.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      scriptPubKeyHex: u.scriptPubKey,
      amountSats: coinsToSats(u.amount)
    }))
  ]

  const signedHex = await signLegacyP2pkhTransaction(String(rawHex), signingInputs, privateKeyHex)
  return await sendRawTransaction(config, signedHex)
}

/** List all asset balances held by a single address.
 *  Response: { "ROOT": 100000000, "ROOT/SUB": 50000000, … } */
export async function listAssetBalancesByAddress(
  config: UtxoRpcConfig,
  address: string
): Promise<Record<string, number>> {
  try {
    const result = await jsonRpcCall(config, 'listassetbalancesbyaddress', [address])
    return (result ?? {}) as Record<string, number>
  } catch (error) {
    // Some bridge nodes return 502 "Asset metadata not found" for this method
    // when one asset in the set has broken metadata. Recover balances from UTXOs.
    if (!isBridgeAssetMetadataNotFoundError(error)) throw error
    const unspent = await listUnspentAssets(config, address).catch(() => [])
    const balances: Record<string, number> = {}
    for (const row of unspent) {
      const assetName = String(row?.assetName ?? '').trim()
      const rawAmount = Number(row?.amount ?? row?.satoshis ?? 0)
      if (!assetName || !Number.isFinite(rawAmount) || rawAmount <= 0) continue
      balances[assetName] = (balances[assetName] ?? 0) + Math.trunc(rawAmount)
    }
    return balances
  }
}

/** Fetch metadata for a named asset (ROOT or ROOT/SUB). */
export async function getAssetDetailsByName(
  config: UtxoRpcConfig,
  assetName: string
): Promise<RtmAssetDetails> {
  return await jsonRpcCall(config, 'getassetdetailsbyname', [assetName])
}

/** List addresses that hold a given asset. */
export async function listAddressesByAsset(
  config: UtxoRpcConfig,
  assetName: string
): Promise<Record<string, number>> {
  return await jsonRpcCall(config, 'listaddressesbyasset', [assetName])
}

/** List unspent asset UTXOs for an address. */
export async function listUnspentAssets(
  config: UtxoRpcConfig,
  address: string
): Promise<RtmUnspentAsset[]> {
  return await jsonRpcCall(config, 'listunspentassets', [1, 9999999, [address]])
}

/** Send a ROOT or ROOT/SUB asset.
 *  @param assetId          "ROOT" or "ROOT/SUBNAME"
 *  @param qty              Human-readable quantity, e.g. "1" or "10.5"
 *  @param toAddress        Destination RTM address
 *  @param changeAddress    Where leftover RTM coin change goes (empty = auto)
 *  @param assetChangeAddr  Where leftover asset change goes (empty = auto)
 *  @returns transaction id */
/**
 * Send a RTM ROOT or ROOT/SUB asset.
 *
 * Strategy (bridge mode):
 *   POST to the bridge's dedicated /v1/bridge/send/asset/:coin/:chain/wallet/:wallet
 *   endpoint which handles wallet-side signing server-side. This is required because
 *   the `sendasset` node RPC method needs the private key in the node wallet, which
 *   is not available for HD-derived client-side addresses.
 *
 * Strategy (direct RPC fallback):
 *   Falls back to the raw `sendasset` RPC call against the configured RPC endpoint.
 */
export async function sendRtmAsset(
  config: UtxoRpcConfig,
  assetId: string,
  qty: string,
  toAddress: string,
  changeAddress = '',
  assetChangeAddr = ''
): Promise<string> {
  const assetConfig: UtxoRpcConfig = config

  const qtyNum = parseRpcDecimalAmount(qty, 8, 'Asset quantity')
  const normalizedAssetId = assetId.trim()
  if (!normalizedAssetId) throw new Error('Asset id is required')

  const splitMatch = normalizedAssetId.match(/^([^|/#:]+)[|/#:]([^|/#:]+)$/)
  const rootPart = splitMatch?.[1]?.trim() || ''
  const subPart = splitMatch?.[2]?.trim() || ''

  const assetIdCandidates = Array.from(new Set([
    normalizedAssetId,
    normalizedAssetId.includes('|') ? normalizedAssetId.replace('|', '/') : normalizedAssetId,
    normalizedAssetId.includes('/') ? normalizedAssetId.replace('/', '|') : normalizedAssetId,
    normalizedAssetId.includes('|') ? normalizedAssetId.replace('|', '#') : normalizedAssetId,
    normalizedAssetId.includes('/') ? normalizedAssetId.replace('/', '#') : normalizedAssetId,
    normalizedAssetId.includes('#') ? normalizedAssetId.replace('#', '/') : normalizedAssetId,
    normalizedAssetId.includes('#') ? normalizedAssetId.replace('#', '|') : normalizedAssetId,
    (rootPart && subPart) ? `${rootPart}${subPart}` : normalizedAssetId,
    (rootPart && subPart) ? `${rootPart}/${subPart}` : normalizedAssetId,
    (rootPart && subPart) ? `${rootPart}|${subPart}` : normalizedAssetId,
    (rootPart && subPart) ? `${rootPart}#${subPart}` : normalizedAssetId,
    normalizedAssetId.toUpperCase(),
    ((rootPart && subPart) ? `${rootPart}/${subPart}` : normalizedAssetId).toUpperCase(),
    ((rootPart && subPart) ? `${rootPart}|${subPart}` : normalizedAssetId).toUpperCase(),
    ((rootPart && subPart) ? `${rootPart}#${subPart}` : normalizedAssetId).toUpperCase(),
    ((rootPart && subPart) ? `${rootPart}${subPart}` : normalizedAssetId).toUpperCase()
  ]))

  // Resolve the canonical asset name accepted by the upstream node before sending.
  // This avoids repeated "Asset metadata not found" failures and bridge cooldowns.
  let canonicalAssetId = ''
  for (const candidateAssetId of assetIdCandidates) {
    try {
      const details = await getAssetDetailsByName(assetConfig, candidateAssetId)
      const resolved = String(details?.name || candidateAssetId).trim()
      if (resolved) {
        canonicalAssetId = resolved
        break
      }
    } catch (error) {
      // Bridge can temporarily return "cooldown active (15s)" after an upstream
      // metadata failure. Wait once before trying the next candidate.
      const msg = asError(error).message
      const cooldownMs = parseBridgeCooldownMs(msg)
      if (cooldownMs !== null) {
        await sleep(cooldownMs + 250)
      }
    }
  }
  // Metadata lookup can be flaky on some bridge deployments; do not block send attempts
  // if canonical resolution fails. Continue with normalized/candidate variants.
  if (!canonicalAssetId) {
    canonicalAssetId = normalizedAssetId
  }
  const sendAssetCandidates = Array.from(new Set([
    // Always try the canonical metadata-resolved name first.
    canonicalAssetId,
    canonicalAssetId.includes('|') ? canonicalAssetId.replace('|', '/') : canonicalAssetId,
    canonicalAssetId.includes('/') ? canonicalAssetId.replace('/', '|') : canonicalAssetId,
    canonicalAssetId.includes('|') ? canonicalAssetId.replace('|', '#') : canonicalAssetId,
    canonicalAssetId.includes('/') ? canonicalAssetId.replace('/', '#') : canonicalAssetId,
    canonicalAssetId.includes('#') ? canonicalAssetId.replace('#', '/') : canonicalAssetId,
    canonicalAssetId.includes('#') ? canonicalAssetId.replace('#', '|') : canonicalAssetId,
    canonicalAssetId.toUpperCase(),
    canonicalAssetId.includes('|') ? canonicalAssetId.replace('|', '/').toUpperCase() : canonicalAssetId.toUpperCase(),
    canonicalAssetId.includes('/') ? canonicalAssetId.replace('/', '|').toUpperCase() : canonicalAssetId.toUpperCase(),
    canonicalAssetId.includes('|') ? canonicalAssetId.replace('|', '#').toUpperCase() : canonicalAssetId.toUpperCase(),
    canonicalAssetId.includes('/') ? canonicalAssetId.replace('/', '#').toUpperCase() : canonicalAssetId.toUpperCase(),
    // Keep original user-provided format last as fallback.
    normalizedAssetId
  ]))

  // Direct RPC fallback mode
  if (assetConfig.useDirectRpc) {
    let localLastErr = ''
    for (let i = 0; i < sendAssetCandidates.length; i += 1) {
      const candidateAssetId = sendAssetCandidates[i]
      try {
        return await jsonRpcCall(assetConfig, 'sendasset', [
          candidateAssetId, qtyNum, toAddress, changeAddress, assetChangeAddr
        ])
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        localLastErr = msg
        const cooldownMs = parseBridgeCooldownMs(msg)
        if (cooldownMs !== null && i < sendAssetCandidates.length - 1) {
          await sleep(cooldownMs + 250)
        }
      }
    }
    throw new Error(localLastErr || 'Asset send failed')
  }

  // Secure bridge mode: route write RPC via backend-issued one-time operation tokens.
  if (isSecureBridgeWritesEnabled(assetConfig)) {
    let secureLastErr = ''
    for (let i = 0; i < sendAssetCandidates.length; i += 1) {
      const candidateAssetId = sendAssetCandidates[i]
      try {
        return await jsonRpcCall(assetConfig, 'sendasset', [
          candidateAssetId, qtyNum, toAddress, changeAddress, assetChangeAddr
        ])
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        secureLastErr = msg
        const cooldownMs = parseBridgeCooldownMs(msg)
        if (cooldownMs !== null && i < sendAssetCandidates.length - 1) {
          await sleep(cooldownMs + 250)
          continue
        }
        if (isAssetMetadataNotFoundMessage(msg) && i < sendAssetCandidates.length - 1) {
          await sleep(15_250)
          continue
        }
      }
    }
    if (secureLastErr) {
      throw new Error(secureLastErr)
    }
  }

  // Bridge mode: use the dedicated bridge send/asset HTTP endpoint.
  // The bridge handles the sendasset call against its wallet server-side.
  if (!assetConfig.bridgeUrl) throw new Error('Bridge URL is required for asset send.')

  // Derive compatible bridge send-asset paths from bridgeUrl.
  // Documented helper route:
  //   /v1/bridge/send/asset/:coin/:chain/:wallet
  // App settings may hold bridge endpoints in one of these shapes:
  //   /v1/bridge/:coin/:chain/wallet/:wallet
  //   /v1/bridge/:coin/:chain
  //   /v1/bridge/wallet/:wallet (host/subdomain mapped)
  //   /v1/bridge                 (host/subdomain mapped)
  const baseUrl = assetConfig.bridgeUrl.trim().replace(/\/+$/, '')
  const sendUrlCandidates: string[] = []
  const pushSendCandidates = (host: string, coin: string, chain: string, wallet: string) => {
    sendUrlCandidates.push(`${host}/v1/bridge/send/asset/${coin}/${chain}/${wallet}`)
    // Legacy compatibility fallbacks.
    sendUrlCandidates.push(`${host}/v1/bridge/send/asset/${coin}/${chain}/wallet/${wallet}`)
    sendUrlCandidates.push(`${host}/v1/bridge/send/asset/${coin}/${chain}?wallet=${encodeURIComponent(wallet)}`)
    sendUrlCandidates.push(`${host}/v1/bridge/send/asset/${coin}/${chain}`)
  }

  const apiInfo = resolveApiInterceptor(assetConfig)?.info
  const coinHint = String(apiInfo?.coinId || '').trim()
  const chainHint = String(apiInfo?.chain || '').trim()

  // If bridgeUrl is already a send/asset endpoint, normalize from it.
  const sendWithWallet = baseUrl.match(/^(.*)\/v1\/bridge\/send\/asset\/([^/]+)\/([^/]+)\/wallet\/([^/]+)$/)
  const sendCompact = baseUrl.match(/^(.*)\/v1\/bridge\/send\/asset\/([^/]+)\/([^/]+)\/([^/]+)$/)
  // Standard bridge JSON-RPC endpoint shapes.
  const bridgeWithWallet = baseUrl.match(/^(.*)\/v1\/bridge\/([^/]+)\/([^/]+)\/wallet\/([^/]+)$/)
  const bridgeCompact = baseUrl.match(/^(.*)\/v1\/bridge\/([^/]+)\/([^/]+)\/([^/]+)$/)
  const bridgeChainOnly = baseUrl.match(/^(.*)\/v1\/bridge\/([^/]+)\/([^/]+)$/)
  const bridgeWalletOnly = baseUrl.match(/^(.*)\/v1\/bridge\/wallet\/([^/]+)$/)
  const bridgeHostOnly = baseUrl.match(/^(.*)\/v1\/bridge$/)

  let walletHint = assetConfig.rpcWallet ? String(assetConfig.rpcWallet).trim() : ''

  if (sendWithWallet) {
    const [, host, coin, chain, wallet] = sendWithWallet
    walletHint = walletHint || decodeURIComponent(wallet)
    pushSendCandidates(host, coin, chain, wallet)
  } else if (sendCompact) {
    const [, host, coin, chain, wallet] = sendCompact
    walletHint = walletHint || decodeURIComponent(wallet)
    pushSendCandidates(host, coin, chain, wallet)
  } else if (bridgeWithWallet) {
    const [, host, coin, chain, wallet] = bridgeWithWallet
    walletHint = walletHint || decodeURIComponent(wallet)
    pushSendCandidates(host, coin, chain, wallet)
  } else if (bridgeCompact) {
    const [, host, coin, chain, wallet] = bridgeCompact
    walletHint = walletHint || decodeURIComponent(wallet)
    pushSendCandidates(host, coin, chain, wallet)
  } else if (bridgeChainOnly) {
    const [, host, coin, chain] = bridgeChainOnly
    if (walletHint) {
      pushSendCandidates(host, coin, chain, walletHint)
    } else {
      sendUrlCandidates.push(baseUrl)
    }
  } else if (bridgeWalletOnly) {
    const [, host, wallet] = bridgeWalletOnly
    walletHint = walletHint || decodeURIComponent(wallet)
    if (coinHint && chainHint && walletHint) {
      pushSendCandidates(host, coinHint, chainHint, walletHint)
    } else {
      sendUrlCandidates.push(baseUrl)
    }
  } else if (bridgeHostOnly) {
    const [, host] = bridgeHostOnly
    if (coinHint && chainHint && walletHint) {
      pushSendCandidates(host, coinHint, chainHint, walletHint)
    } else {
      sendUrlCandidates.push(baseUrl)
    }
  } else {
    sendUrlCandidates.push(baseUrl)
  }

  const dedupedSendUrls = Array.from(new Set(sendUrlCandidates))

  const baseHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  applyBridgeBasicAuthHeaders(baseHeaders, assetConfig, assetConfig.networkId || assetConfig.coinSymbol || 'asset transfer')
  const bridgeTxKeyCandidates = dedupeStringList([
    ...(assetConfig.bridgeTxKeyCandidates || []),
    assetConfig.bridgeTxKey
  ])
  const txKeyAttempts = bridgeTxKeyCandidates.length > 0 ? bridgeTxKeyCandidates : ['']

  let lastError = ''
  for (const sendUrl of dedupedSendUrls) {
    for (const candidateAssetId of sendAssetCandidates) {
      const hasWalletInPath =
        /\/v1\/bridge\/send\/asset\/[^/]+\/[^/]+\/wallet\/[^/?#]+$/i.test(sendUrl)
        || /\/v1\/bridge\/send\/asset\/[^/]+\/[^/]+\/[^/?#]+$/i.test(sendUrl)

      const payload: Record<string, unknown> = {
        assetId: candidateAssetId,
        qty: qtyNum,
        toAddress,
        changeAddress: changeAddress || undefined,
        assetChangeAddress: assetChangeAddr || undefined
      }
      if (!hasWalletInPath && walletHint) payload.wallet = walletHint

      const candidateBody = JSON.stringify(payload)
      for (let txKeyIdx = 0; txKeyIdx < txKeyAttempts.length; txKeyIdx += 1) {
        const headers: Record<string, string> = { ...baseHeaders }
        const txKey = txKeyAttempts[txKeyIdx]
        if (txKey) headers['X-Bridge-Tx-Key'] = txKey

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Number(assetConfig.timeoutMs ?? 15000))
        let res: Response
        try {
          res = await fetch(sendUrl, { method: 'POST', headers, body: candidateBody, signal: controller.signal })
        } catch (err) {
          clearTimeout(timer)
          lastError = `Asset send request failed: ${err instanceof Error ? err.message : String(err)}`
          continue
        } finally {
          clearTimeout(timer)
        }

        const rawText = await res.text().catch(() => '')
        const json = (() => {
          try { return rawText ? JSON.parse(rawText) : null } catch { return null }
        })()

        if (res.ok) {
          // Helper routes are API-style and may return HTTP 200 with { ok:false, error }.
          if (json?.ok === false) {
            const apiError = compactErrorText(String(json?.error || json?.message || 'Asset send failed'))
            throw new Error(`Asset send failed via ${sendUrl}: ${apiError}`)
          }
          // Some bridge wrappers return JSON-RPC style envelopes on helper routes.
          if (json?.error) {
            const rpcError = compactErrorText(
              typeof json.error === 'string' ? json.error : String(json.error?.message || JSON.stringify(json.error))
            )
            throw new Error(`Asset send failed via ${sendUrl}: ${rpcError}`)
          }
          const txid = json?.txid ?? json?.result
          if (!txid) throw new Error('Asset send succeeded but no txid returned from bridge')
          return String(txid)
        }

        const errorVal = json?.error
        const detailRaw = (typeof errorVal === 'string' ? errorVal : errorVal?.message)
          ?? json?.message
          ?? (rawText || res.statusText)
        const detail = compactErrorText(detailRaw)
        lastError = `Asset send failed [HTTP ${res.status}] via ${sendUrl}: ${detail}`

        const shouldRetryTxKey = txKeyAttempts.length > txKeyIdx + 1
          && isBridgeTxAuthRejection(res.status, `${detail} ${rawText}`)
        if (shouldRetryTxKey) continue

        // If route not found / cannot post, try next endpoint candidate.
        const notFoundLike = res.status === 404 || /cannot post/i.test(rawText)
        if (notFoundLike) break
        const wrongRouteLike =
          res.status === 400 && (
            /use strict route/i.test(detail)
            || /coin\s*\+\s*chain.*url path/i.test(detail)
            || /missing method/i.test(detail)
            || /params.*array/i.test(detail)
          )
        if (wrongRouteLike) break

        const cooldownMs = parseBridgeCooldownMs(detail)
        if (cooldownMs !== null) {
          await sleep(cooldownMs + 250)
          continue
        }

        // If metadata lookup failed, try next asset-id candidate delimiter.
        if (isAssetMetadataNotFoundMessage(detail)) {
          // Bridge typically enforces a 15s cooldown after this upstream error.
          await sleep(15_250)
          continue
        }

        // Treat 5xx responses as transient upstream bridge failures and keep trying
        // endpoint / asset-id candidates, then fallback to JSON-RPC sendasset.
        if (res.status >= 500) {
          continue
        }

        // Any other error is a real upstream error; stop retries and surface it.
        throw new Error(lastError)
      }
    }
  }

  // Final fallback: match legacy app behavior by invoking sendasset via bridge JSON-RPC
  // on the configured bridgeUrl (instead of helper /send/asset endpoint).
  for (let i = 0; i < sendAssetCandidates.length; i += 1) {
    const candidateAssetId = sendAssetCandidates[i]
    try {
      return await jsonRpcCall(assetConfig, 'sendasset', [
        candidateAssetId, qtyNum, toAddress, changeAddress, assetChangeAddr
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError = lastError ? `${lastError} | fallback sendasset: ${msg}` : `fallback sendasset: ${msg}`

      const cooldownMs = parseBridgeCooldownMs(msg)
      if (cooldownMs !== null && i < sendAssetCandidates.length - 1) {
        await sleep(cooldownMs + 250)
        continue
      }

      if (isAssetMetadataNotFoundMessage(msg) && i < sendAssetCandidates.length - 1) {
        await sleep(15_250)
      }
    }
  }

  if (isAssetMetadataNotFoundMessage(lastError) || parseBridgeCooldownMs(lastError) !== null) {
    throw new Error(
      `Asset send is unavailable on the bridge for "${canonicalAssetId || normalizedAssetId}". ` +
      'Bridge upstream returned asset metadata/cooldown errors. Retry in ~15s and verify bridge connectivity.'
    )
  }

  if (/cannot post\s+\/v1\/bridge\/send\/asset/i.test(lastError)) {
    throw new Error(
      'Bridge asset-send endpoint is not available on this server. ' +
      'Verify the bridge URL and credentials for this network.'
    )
  }

  throw new Error(lastError || 'Asset send failed: no compatible bridge endpoint found')
}

export async function sendBridgeTokenTransfer(
  config: UtxoRpcConfig,
  input: {
    tokenId: string
    toAddress: string
    amount: string | number
    signedTxHex: string
    fromAddress?: string
    coin?: string
    chain?: string
    wallet?: string
    signedFormat?: 'evm-raw-hex' | 'cardano-cbor-hex' | 'cosmos-tx-base64'
  }
): Promise<{ txid: string; relayed?: boolean }> {
  if (!config.bridgeUrl) throw new Error('Bridge URL is required for token transfer')
  const apiBase = deriveBridgeApiBaseUrl(config.bridgeUrl)
  if (!apiBase) throw new Error('Bridge API base URL is not available')

  const hinted = resolveBridgeCoinChainHint(config)
  const coin = String(input.coin || hinted.coin || '').trim()
  const chain = String(input.chain || hinted.chain || 'main').trim()
  const tokenId = String(input.tokenId || '').trim()
  const toAddress = String(input.toAddress || '').trim()
  const signedTxHex = String(input.signedTxHex || '').trim()
  const amountNum = Number(input.amount)
  const wallet = String(input.wallet || '').trim()
  const signedFormat = String(
    input.signedFormat
    || (coin === 'cardano'
      ? 'cardano-cbor-hex'
      : (coin === 'cosmos' ? 'cosmos-tx-base64' : 'evm-raw-hex'))
  ).trim().toLowerCase()

  if (!coin) throw new Error('Bridge coin is required for token transfer')
  if (!chain) throw new Error('Bridge chain is required for token transfer')
  if (!tokenId) throw new Error('Token id is required for token transfer')
  if (!toAddress) throw new Error('Destination address is required for token transfer')
  if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error('Token amount must be a positive number')
  if (signedFormat === 'evm-raw-hex') {
    if (!/^0x[0-9a-f]+$/i.test(signedTxHex)) throw new Error('Signed token transaction must be 0x-prefixed hex')
  } else if (signedFormat === 'cardano-cbor-hex') {
    if (!/^[0-9a-f]+$/i.test(signedTxHex)) throw new Error('Signed Cardano transaction must be CBOR hex')
    if (!wallet) throw new Error('wallet is required for Cardano token transfer')
  } else if (signedFormat === 'cosmos-tx-base64') {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signedTxHex)) {
      throw new Error('Signed Cosmos transaction must be base64')
    }
  } else {
    throw new Error(`Unsupported token signed format: ${signedFormat}`)
  }

  const url = `${apiBase}/v1/bridge/token/transfer/${encodeURIComponent(coin)}/${encodeURIComponent(chain)}`
  const baseHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  applyBridgeBasicAuthHeaders(baseHeaders, config, config.networkId || config.coinSymbol || 'token transfer')

  const txKeyCandidates = dedupeStringList([
    ...(config.bridgeTxKeyCandidates || []),
    config.bridgeTxKey
  ])
  const txKeyAttempts = txKeyCandidates.length > 0 ? txKeyCandidates : ['']

  let lastError = 'Token transfer failed'
  for (let i = 0; i < txKeyAttempts.length; i += 1) {
    const txKey = txKeyAttempts[i]
    const headers: Record<string, string> = { ...baseHeaders }
    if (txKey) headers['X-Bridge-Tx-Key'] = txKey

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Number(config.timeoutMs ?? 15000))
    let res: Response
    try {
      const requestBody = signedFormat === 'evm-raw-hex'
        ? {
            id: `tok-${Date.now()}`,
            fromAddress: String(input.fromAddress || '').trim() || undefined,
            toAddress,
            tokenId,
            amount: amountNum,
            wallet: wallet || undefined,
            signedTx: signedTxHex,
            signedTxHex,
            rawTx: signedTxHex
          }
        : {
            id: `tok-${Date.now()}`,
            transfer: {
              fromAddress: String(input.fromAddress || '').trim(),
              toAddress,
              tokenId,
              amount: amountNum,
              wallet: wallet || undefined,
              signed: {
                format: signedFormat,
                payload: signedTxHex
              }
            }
          }
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })
    } catch (err) {
      clearTimeout(timer)
      lastError = `Token transfer request failed: ${err instanceof Error ? err.message : String(err)}`
      continue
    } finally {
      clearTimeout(timer)
    }

    const rawText = await res.text().catch(() => '')
    const json = (() => {
      try { return rawText ? JSON.parse(rawText) : null } catch { return null }
    })()

    if (res.ok) {
      if (json?.error) {
        const errText = compactErrorText(String(json?.error?.message || json?.error || 'Token transfer failed'))
        throw new Error(`Token transfer failed: ${errText}`)
      }
      const txid = String(json?.result?.txid || json?.txid || '').trim()
      if (!txid) throw new Error('Token transfer succeeded but no txid returned from bridge')
      return { txid, relayed: Boolean(json?.result?.relayed) }
    }

    const detail = compactErrorText(String(
      json?.error?.message
      || json?.error
      || json?.message
      || rawText
      || res.statusText
      || `HTTP ${res.status}`
    ))
    lastError = `Token transfer failed [HTTP ${res.status}]: ${detail}`
    const shouldRetryTxKey = txKeyAttempts.length > i + 1
      && isBridgeTxAuthRejection(res.status, `${detail} ${rawText}`)
    if (shouldRetryTxKey) continue
    throw new Error(lastError)
  }

  throw new Error(lastError)
}

export async function sendBridgeEvmSignedRelay(
  config: UtxoRpcConfig,
  input: {
    kind: 'coin' | 'asset'
    signedTxHex: string
    coin?: string
    chain?: string
    wallet?: string
  }
): Promise<{ txid: string; relayed?: boolean; nonCustodial?: boolean }> {
  if (!config.bridgeUrl) throw new Error('Bridge URL is required for EVM relay')
  const apiBase = deriveBridgeApiBaseUrl(config.bridgeUrl)
  if (!apiBase) throw new Error('Bridge API base URL is not available')

  const hinted = resolveBridgeCoinChainHint(config)
  const coin = String(input.coin || hinted.coin || '').trim()
  const chain = String(input.chain || hinted.chain || 'main').trim()
  const wallet = String(input.wallet || '').trim()
  const signedTxHex = String(input.signedTxHex || '').trim()
  if (!coin) throw new Error('Bridge coin is required for EVM relay')
  if (!chain) throw new Error('Bridge chain is required for EVM relay')
  if (!signedTxHex) throw new Error('signedTx is required for EVM relay')
  if (!/^0x[0-9a-f]+$/i.test(signedTxHex)) throw new Error('signedTx must be 0x-prefixed hex')

  const baseUrl = `${apiBase}/v1/bridge/send/${input.kind}/${encodeURIComponent(coin)}/${encodeURIComponent(chain)}`
  const url = wallet ? `${baseUrl}/${encodeURIComponent(wallet)}` : baseUrl
  const baseHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  applyBridgeBasicAuthHeaders(baseHeaders, config, config.networkId || config.coinSymbol || `evm relay ${input.kind}`)

  const txKeyCandidates = dedupeStringList([
    ...(config.bridgeTxKeyCandidates || []),
    config.bridgeTxKey
  ])
  const txKeyAttempts = txKeyCandidates.length > 0 ? txKeyCandidates : ['']

  let lastError = `EVM relay ${input.kind} failed`
  for (let i = 0; i < txKeyAttempts.length; i += 1) {
    const txKey = txKeyAttempts[i]
    const headers: Record<string, string> = { ...baseHeaders }
    if (txKey) headers['X-Bridge-Tx-Key'] = txKey

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Number(config.timeoutMs ?? 15000))
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          signedTx: signedTxHex,
          signedTxHex,
          rawTx: signedTxHex
        }),
        signal: controller.signal
      })
    } catch (err) {
      clearTimeout(timer)
      lastError = `EVM relay ${input.kind} request failed: ${err instanceof Error ? err.message : String(err)}`
      continue
    } finally {
      clearTimeout(timer)
    }

    const rawText = await res.text().catch(() => '')
    const json = (() => {
      try { return rawText ? JSON.parse(rawText) : null } catch { return null }
    })()

    if (res.ok) {
      if (json?.error) {
        const errText = compactErrorText(String(json?.error?.message || json?.error || `EVM relay ${input.kind} failed`))
        throw new Error(`EVM relay ${input.kind} failed: ${errText}`)
      }
      const txid = String(json?.result?.txid || json?.txid || '').trim()
      if (!txid) throw new Error(`EVM relay ${input.kind} succeeded but no txid returned`)
      return {
        txid,
        relayed: Boolean(json?.result?.relayed),
        nonCustodial: Boolean(json?.result?.nonCustodial)
      }
    }

    const detail = compactErrorText(String(
      json?.error?.message
      || json?.error
      || json?.message
      || rawText
      || res.statusText
      || `HTTP ${res.status}`
    ))
    lastError = `EVM relay ${input.kind} failed [HTTP ${res.status}]: ${detail}`
    const shouldRetryTxKey = txKeyAttempts.length > i + 1
      && isBridgeTxAuthRejection(res.status, `${detail} ${rawText}`)
    if (shouldRetryTxKey) continue
    throw new Error(lastError)
  }

  throw new Error(lastError)
}

export type BridgeTokenBalanceRow = {
  tokenType?: string
  tokenId: string
  tokenAddress?: string
  symbol?: string
  name?: string
  issuer?: string
  decimals?: number | null
  balanceRaw?: string
  balance?: string
}

export async function fetchBridgeTokenBalances(
  config: UtxoRpcConfig,
  input: {
    coin?: string
    chain?: string
    owner?: string
    wallet?: string
    tokenId?: string
  } = {}
): Promise<BridgeTokenBalanceRow[]> {
  if (!config.bridgeUrl) throw new Error('Bridge URL is required for token balance')
  const apiBase = deriveBridgeApiBaseUrl(config.bridgeUrl)
  if (!apiBase) throw new Error('Bridge API base URL is not available')

  const hinted = resolveBridgeCoinChainHint(config)
  const coin = String(input.coin || hinted.coin || '').trim()
  const chain = String(input.chain || hinted.chain || 'main').trim()
  if (!coin) throw new Error('Bridge coin is required for token balance')
  if (!chain) throw new Error('Bridge chain is required for token balance')

  const url = `${apiBase}/v1/bridge/token/balance/${encodeURIComponent(coin)}/${encodeURIComponent(chain)}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  applyBridgeBasicAuthHeaders(headers, config, config.networkId || config.coinSymbol || 'token balance')

  const body: Record<string, unknown> = { id: `tok-bal-${Date.now()}` }
  const owner = String(input.owner || '').trim()
  const wallet = String(input.wallet || config.rpcWallet || '').trim()
  const tokenId = String(input.tokenId || '').trim()
  if (owner) {
    body.owner = owner
    // Some bridge deployments expect `address` instead of `owner`.
    body.address = owner
  }
  if (wallet) body.wallet = wallet
  if (tokenId) body.tokenId = tokenId

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(config.timeoutMs ?? 15000))
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Token balance failed [timeout]: ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }

  const rawText = await res.text().catch(() => '')
  const json = (() => {
    try { return rawText ? JSON.parse(rawText) : null } catch { return null }
  })()

  if (!res.ok) {
    const detail = compactErrorText(String(
      json?.error?.message
      || json?.error
      || json?.message
      || rawText
      || `HTTP ${res.status}`
    ))
    throw new Error(`Token balance failed [HTTP ${res.status}]: ${detail}`)
  }

  const result = json?.result ?? json?.payload?.data ?? json ?? {}
  const balances = Array.isArray(result?.balances) ? result.balances : []
  return balances
    .map((row: any) => ({
      tokenType: String(row?.tokenType || '').trim() || undefined,
      tokenId: String(row?.tokenId || '').trim(),
      tokenAddress: String(row?.tokenAddress || '').trim() || undefined,
      symbol: String(row?.symbol || '').trim() || undefined,
      name: String(row?.name || '').trim() || undefined,
      issuer: String(row?.issuer || '').trim() || undefined,
      decimals: Number.isFinite(Number(row?.decimals)) ? Number(row.decimals) : null,
      balanceRaw: String(row?.balanceRaw ?? '').trim() || undefined,
      balance: String(row?.balance ?? '').trim() || undefined
    }))
    .filter((row: BridgeTokenBalanceRow) => Boolean(row.tokenId))
}

/** Quick reachability probe — resolves true if node responds, false otherwise. */
export async function pingRpc(config: UtxoRpcConfig): Promise<boolean> {
  try {
    await jsonRpcCall(config, 'getblockchaininfo', [])
    return true
  } catch {
    try {
      await jsonRpcCall(config, 'getinfo', [])
      return true
    } catch {
      return false
    }
  }
}

export async function getRpcInfo(config: UtxoRpcConfig): Promise<{
  version?: number; protocolversion?: number; walletversion?: number; balance?: number
  blocks?: number; timeoffset?: number; connections?: number; proxy?: string
  difficulty?: number; testnet?: boolean; keypoololdest?: number; keypoolsize?: number
  paytxfee?: number; relayfee?: number; errors?: string
}> {
  try {
    return await jsonRpcCall(config, 'getinfo', [])
  } catch {
    try {
      const info = await jsonRpcCall(config, 'getblockchaininfo', [])
      return {
        blocks: info.blocks,
        difficulty: info.difficulty,
        testnet: info.chain === 'test' || info.chain === 'testnet'
      }
    } catch {
      return {}
    }
  }
}
