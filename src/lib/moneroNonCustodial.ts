import type { Network } from '../coins'
import { deriveMoneroAddress } from './moneroAddress'

type MoneroSignerRuntime = {
  selfTest?: () => Promise<{ ok: boolean; details?: string }>
  signTransfer: (input: {
    mnemonic: string
    accountIndex: number
    fromAddress: string
    toAddress: string
    amountAtomic: string
    network: 'main' | 'test' | 'stage'
    rpcUrl?: string
    rpcUsername?: string
    rpcPassword?: string
  }) => Promise<{ signedTxBlobHex: string; txHash?: string }>
}

type GlobalWithMoneroRuntime = typeof globalThis & {
  __METAYOSHI_MONERO_RUNTIME__?: MoneroSignerRuntime
}

const MONERO_VECTOR_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const MONERO_VECTOR_ACCOUNT_INDEX = 0
const MONERO_VECTOR_MAINNET_ADDRESS = '47tzKY2Vh8CYBZCKnXqScTdvYad5xYtrg9asoJwP8di3AAmjRTeGHCgJ2vqwDeccNGMSseokR36gwjgHJJjy3HAHKmTUhpb'

let moneroSelfTestPromise: Promise<void> | null = null

function normalizeHex(value: string): string {
  return String(value || '').trim().replace(/^0x/i, '').toLowerCase()
}

function isHex(value: string): boolean {
  return /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0
}

function resolveApiBaseUrl(network: Network): string {
  const explicit = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  const bridge = String(network.bridgeUrl || '').trim()
  if (bridge) {
    try {
      const parsed = new URL(bridge)
      return parsed.origin
    } catch {
      // ignore
    }
  }
  throw new Error('VITE_API_BASE_URL is required for Monero non-custodial submit flow')
}

function resolveApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = String(import.meta.env.VITE_APP_API_KEY || '').trim()
  if (!apiKey) throw new Error('VITE_APP_API_KEY is required for Monero non-custodial submit flow')
  headers['X-API-Key'] = apiKey
  return headers
}

function resolveMoneroChain(rpcUrl?: string): 'main' | 'test' | 'stage' {
  const env = String((import.meta as any)?.env?.VITE_XMR_NETWORK || '').trim().toLowerCase()
  if (env === 'testnet') return 'test'
  if (env === 'stagenet') return 'stage'
  const hint = String(rpcUrl || '').toLowerCase()
  if (hint.includes('testnet')) return 'test'
  if (hint.includes('stagenet')) return 'stage'
  return 'main'
}

function resolveMoneroSubmitChain(rpcUrl?: string): 'main' | 'test' {
  const chain = resolveMoneroChain(rpcUrl)
  return chain === 'main' ? 'main' : 'test'
}

function xmrToAtomicString(amount: string): string {
  const raw = String(amount || '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('Invalid XMR amount')
  const [whole, frac = ''] = raw.split('.')
  if (frac.length > 12) throw new Error('XMR supports up to 12 decimals')
  const combined = `${whole}${frac.padEnd(12, '0')}`.replace(/^0+/, '') || '0'
  if (combined === '0') throw new Error('XMR amount must be greater than 0')
  return combined
}

function getMoneroRuntime(): MoneroSignerRuntime {
  const runtime = (globalThis as GlobalWithMoneroRuntime).__METAYOSHI_MONERO_RUNTIME__
  if (!runtime || typeof runtime.signTransfer !== 'function') {
    throw new Error(
      'Monero non-custodial runtime is not installed. Provide window.__METAYOSHI_MONERO_RUNTIME__.signTransfer(...)'
    )
  }
  return runtime
}

export async function runMoneroDeterministicSelfTest(): Promise<void> {
  const derived = await deriveMoneroAddress(MONERO_VECTOR_MNEMONIC, MONERO_VECTOR_ACCOUNT_INDEX, 'mainnet')
  if (derived.address !== MONERO_VECTOR_MAINNET_ADDRESS) {
    throw new Error('Monero deterministic vector check failed for deriveMoneroAddress')
  }
}

export async function ensureMoneroNonCustodialRuntimeReady(): Promise<void> {
  if (!moneroSelfTestPromise) {
    moneroSelfTestPromise = (async () => {
      await runMoneroDeterministicSelfTest()
      const runtime = getMoneroRuntime()
      if (typeof runtime.selfTest === 'function') {
        const result = await runtime.selfTest()
        if (!result?.ok) {
          throw new Error(`Monero runtime self-test failed${result?.details ? `: ${result.details}` : ''}`)
        }
      }
    })()
  }
  return moneroSelfTestPromise
}

async function submitSignedMoneroTx(params: {
  network: Network
  signedTxBlobHex: string
  txHash?: string
}): Promise<string> {
  const chain = resolveMoneroSubmitChain(params.network.rpcUrl)
  const apiBase = resolveApiBaseUrl(params.network)
  const res = await fetch(`${apiBase}/v1/monero/${chain}/tx/submit`, {
    method: 'POST',
    headers: resolveApiHeaders(),
    body: JSON.stringify({
      signedTxBlobHex: params.signedTxBlobHex,
      txHash: params.txHash || ''
    })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.ok) {
    throw new Error(String(json?.error || `Monero submit failed (HTTP ${res.status})`))
  }
  const hash = String(json?.txid || json?.txHash || params.txHash || '').trim()
  if (!hash) throw new Error('Monero submit succeeded but txid is missing')
  return hash
}

export async function sendMoneroNonCustodial(params: {
  network: Network
  mnemonic: string
  accountIndex: number
  fromAddress: string
  toAddress: string
  amountXmr: string
}): Promise<{ hash: string }> {
  await ensureMoneroNonCustodialRuntimeReady()
  const runtime = getMoneroRuntime()
  const amountAtomic = xmrToAtomicString(params.amountXmr)

  const signed = await runtime.signTransfer({
    mnemonic: String(params.mnemonic || '').trim(),
    accountIndex: params.accountIndex,
    fromAddress: String(params.fromAddress || '').trim(),
    toAddress: String(params.toAddress || '').trim(),
    amountAtomic,
    network: resolveMoneroChain(params.network.rpcUrl),
    rpcUrl: String(params.network.rpcUrl || '').trim(),
    rpcUsername: String(params.network.rpcUsername || '').trim(),
    rpcPassword: String(params.network.rpcPassword || '').trim()
  })

  const signedTxBlobHex = normalizeHex(String(signed?.signedTxBlobHex || ''))
  if (!isHex(signedTxBlobHex)) throw new Error('Monero signer returned invalid signed tx blob hex')
  const txHash = String(signed?.txHash || '').trim()
  const hash = await submitSignedMoneroTx({
    network: params.network,
    signedTxBlobHex,
    txHash
  })
  return { hash }
}
