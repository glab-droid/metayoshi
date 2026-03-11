import type { Network } from '../coins'

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/
const ADA_RE = /^(addr1|addr_test1)[0-9a-z]{20,}$/

export interface WatchOnlyValidationResult {
  ok: boolean
  normalized: string
  error?: string
}

export function validateWatchOnlyAddress(network: Network, rawAddress: string): WatchOnlyValidationResult {
  const input = String(rawAddress || '').trim()
  if (!input) return { ok: false, normalized: '', error: 'Address is required' }

  if (network.id === 'ada' || network.coinSymbol === 'ADA') {
    const normalized = input.toLowerCase()
    if (!ADA_RE.test(normalized)) {
      return {
        ok: false,
        normalized,
        error: 'Invalid Cardano watch-only address. Expected a bech32 payment address (addr1... or addr_test1...).'
      }
    }
    return { ok: true, normalized }
  }

  if (network.id === 'xmr' || network.coinSymbol === 'XMR') {
    const normalized = input
    const len = normalized.length
    const startsOk = normalized.startsWith('4') || normalized.startsWith('8') || normalized.startsWith('9')
    const lengthOk = len === 95 || len === 106
    const charsetOk = BASE58_RE.test(normalized)
    if (!startsOk || !lengthOk || !charsetOk) {
      return {
        ok: false,
        normalized,
        error: 'Invalid Monero watch-only address. Expected a base58 primary/sub/integrated address.'
      }
    }
    return { ok: true, normalized }
  }

  return { ok: false, normalized: input, error: `${network.name} does not support watch-only import here` }
}

