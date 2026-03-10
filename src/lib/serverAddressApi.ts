import type { Network } from '../coins'
import { resolveRuntimeModelId as resolveNetworkModelId } from './runtimeModel'

const APP_API_KEY = String((import.meta as any)?.env?.VITE_APP_API_KEY || '').trim()

let tronWebModulePromise: Promise<typeof import('tronweb')> | null = null

function loadTronWebModule() {
  if (!tronWebModulePromise) tronWebModulePromise = import('tronweb')
  return tronWebModulePromise
}

export function deriveServerApiBaseUrl(network: Network): string {
  const envBase = String((import.meta as any)?.env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
  if (envBase) return envBase

  const bridgeUrl = String(network.bridgeUrl || '').trim().replace(/\/+$/, '')
  if (bridgeUrl) {
    const lower = bridgeUrl.toLowerCase()
    const idxV1Bridge = lower.indexOf('/v1/bridge/')
    if (idxV1Bridge >= 0) return bridgeUrl.slice(0, idxV1Bridge)
    const idxBridge = lower.indexOf('/bridge/')
    if (idxBridge >= 0) return bridgeUrl.slice(0, idxBridge)
    if (/\/v1$/i.test(bridgeUrl)) return bridgeUrl.replace(/\/v1$/i, '')
    return bridgeUrl
  }

  return String(network.rpcUrl || '').trim().replace(/\/+$/, '')
}

export function resolveServerCoinChain(network: Network): { coin: string; chain: string } | null {
  const coin = String(network.serverCoinId || network.id || '').trim().toLowerCase()
  if (!coin) return null
  const chain = String(network.serverChain || 'main').trim().toLowerCase() || 'main'
  return { coin, chain }
}

async function normalizeTronServerAddress(address: string): Promise<string> {
  const trimmed = String(address || '').trim()
  if (!trimmed) return ''
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^41[0-9a-fA-F]{40}$/.test(trimmed)) return `0x${trimmed.slice(2).toLowerCase()}`

  const { TronWeb } = await loadTronWebModule()
  if (!TronWeb.isAddress(trimmed)) return trimmed
  const hex = String(TronWeb.address.toHex(trimmed) || '').trim()
  if (!/^41[0-9a-fA-F]{40}$/.test(hex)) return trimmed
  return `0x${hex.slice(2).toLowerCase()}`
}

export async function normalizeServerAddress(network: Network, address: string): Promise<string> {
  const trimmed = String(address || '').trim()
  if (!trimmed) return ''
  const modelId = String(resolveNetworkModelId(network) || network.id || '').trim().toLowerCase()
  if (modelId === 'tron') return await normalizeTronServerAddress(trimmed)
  return trimmed
}

export async function fetchServerAddressJson(
  network: Network,
  address: string,
  route: 'balance' | 'assets' | 'history' | 'portfolio' | 'price',
  extraParams: Record<string, string> = {},
  options: { timeoutMs?: number } = {}
): Promise<{
  address: string
  url: string
  ok: boolean
  status: number
  json: Record<string, unknown> | null
  text: string
}> {
  const apiBase = deriveServerApiBaseUrl(network)
  if (!apiBase) throw new Error('Server API base URL is not configured')

  const coinChain = resolveServerCoinChain(network)
  if (!coinChain) throw new Error('Server coin id is not configured')

  const requestAddress = await normalizeServerAddress(network, address)
  if (!requestAddress) throw new Error('Server address is required')

  const params = new URLSearchParams({
    coin: coinChain.coin,
    chain: coinChain.chain
  })
  for (const [key, value] of Object.entries(extraParams)) {
    const normalized = String(value || '').trim()
    if (normalized) params.set(key, normalized)
  }

  const url = `${apiBase}/v1/address/${encodeURIComponent(requestAddress)}/${route}?${params.toString()}`
  const headers: Record<string, string> = {}
  if (APP_API_KEY) headers['X-API-Key'] = APP_API_KEY

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs ?? 15000))
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    })
    const text = await response.text().catch(() => '')
    const json = (() => {
      try { return text ? JSON.parse(text) as Record<string, unknown> : null } catch { return null }
    })()
    return {
      address: requestAddress,
      url,
      ok: response.ok,
      status: response.status,
      json,
      text
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Server ${route} request timed out: ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
