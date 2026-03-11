import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha512 } from '@noble/hashes/sha512'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { encode, encodeForSigning } from 'ripple-binary-codec'
import type { UtxoRpcConfig } from './utxoRpc'
import { callBridgeMethod } from './utxoRpc'

function toDrops(amountXrp: string): string {
  const raw = String(amountXrp || '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('Invalid XRP amount')
  const [whole, frac = ''] = raw.split('.')
  if (frac.length > 6) throw new Error('XRP supports up to 6 decimals')
  const combined = `${whole}${frac.padEnd(6, '0')}`.replace(/^0+/, '') || '0'
  if (combined === '0') throw new Error('Amount must be greater than 0')
  return combined
}

function resolveAccountInfoPayload(raw: any): any {
  if (raw?.account_data) return raw
  if (raw?.result?.account_data) return raw.result
  if (raw?.result?.result?.account_data) return raw.result.result
  return raw
}

function resolveNumber(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.trunc(num)
}

async function readAccountSequenceAndLedger(config: UtxoRpcConfig, address: string): Promise<{ sequence: number; ledgerCurrentIndex: number | null }> {
  const raw = await callBridgeMethod(config, 'account_info', [{
    account: address,
    ledger_index: 'current',
    strict: true,
    queue: true
  }])
  const payload = resolveAccountInfoPayload(raw)
  const sequence = resolveNumber(payload?.account_data?.Sequence)
  if (sequence === null || sequence < 0) throw new Error('Could not resolve XRP account sequence')
  const ledgerCurrentIndex =
    resolveNumber(payload?.ledger_current_index)
    ?? resolveNumber(payload?.result?.ledger_current_index)
    ?? null
  return { sequence, ledgerCurrentIndex }
}

async function readFeeDrops(config: UtxoRpcConfig): Promise<string> {
  try {
    const raw = await callBridgeMethod(config, 'fee', [])
    const drops =
      raw?.drops?.open_ledger_fee
      ?? raw?.result?.drops?.open_ledger_fee
      ?? raw?.result?.result?.drops?.open_ledger_fee
      ?? raw?.drops?.minimum_fee
      ?? raw?.result?.drops?.minimum_fee
      ?? raw?.result?.result?.drops?.minimum_fee
    const fee = String(drops ?? '').trim()
    if (/^\d+$/.test(fee) && BigInt(fee) > 0n) return fee
  } catch {
    // fall back
  }
  return '12'
}

async function submitSignedBlob(config: UtxoRpcConfig, txBlob: string): Promise<string> {
  const raw = await callBridgeMethod(config, 'submit', [{
    tx_blob: txBlob,
    fail_hard: true
  }])
  const engineResult =
    String(
      raw?.engine_result
      ?? raw?.result?.engine_result
      ?? raw?.result?.result?.engine_result
      ?? ''
    ).trim()
  const engineMessage =
    String(
      raw?.engine_result_message
      ?? raw?.result?.engine_result_message
      ?? raw?.result?.result?.engine_result_message
      ?? ''
    ).trim()
  const txHash =
    String(
      raw?.tx_json?.hash
      ?? raw?.result?.tx_json?.hash
      ?? raw?.result?.result?.tx_json?.hash
      ?? ''
    ).trim()

  if (engineResult && !engineResult.toLowerCase().startsWith('tes')) {
    throw new Error(`XRP submit rejected: ${engineResult}${engineMessage ? ` (${engineMessage})` : ''}`)
  }
  return txHash
}

function normalizeHex(value: string, label: string): string {
  const hex = String(value || '').trim().replace(/^0x/i, '').toUpperCase()
  if (!/^[0-9A-F]+$/.test(hex) || hex.length % 2 !== 0) throw new Error(`Invalid ${label}`)
  return hex
}

function sha512HalfHex(serializedHex: string): string {
  const digest = sha512(hexToBytes(serializedHex)).slice(0, 32)
  return bytesToHex(digest).toUpperCase()
}

export async function sendXrpNonCustodial(params: {
  rpcConfig: UtxoRpcConfig
  fromAddress: string
  toAddress: string
  amountXrp: string
  privateKeyHex: string
  publicKeyHex: string
}): Promise<{ hash: string }> {
  const fromAddress = String(params.fromAddress || '').trim()
  const toAddress = String(params.toAddress || '').trim()
  if (!fromAddress) throw new Error('XRP sender address is required')
  if (!toAddress) throw new Error('XRP destination address is required')

  const amountDrops = toDrops(params.amountXrp)
  const { sequence, ledgerCurrentIndex } = await readAccountSequenceAndLedger(params.rpcConfig, fromAddress)
  const feeDrops = await readFeeDrops(params.rpcConfig)
  const privateKeyHex = normalizeHex(params.privateKeyHex, 'XRP private key')
  const publicKeyHex = normalizeHex(params.publicKeyHex, 'XRP public key')

  const recomputedPublicKey = bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKeyHex), true)).toUpperCase()
  if (recomputedPublicKey !== publicKeyHex) throw new Error('XRP signer keypair mismatch')

  const tx: Record<string, unknown> = {
    TransactionType: 'Payment',
    Account: fromAddress,
    Destination: toAddress,
    Amount: amountDrops,
    Sequence: sequence,
    Fee: feeDrops,
    Flags: 0x80000000,
    SigningPubKey: publicKeyHex
  }
  if (ledgerCurrentIndex !== null && ledgerCurrentIndex > 0) {
    tx.LastLedgerSequence = ledgerCurrentIndex + 20
  }

  const signingHex = encodeForSigning(tx)
  const signingHash = hexToBytes(sha512HalfHex(signingHex))
  const signature = secp256k1.sign(signingHash, hexToBytes(privateKeyHex), {
    lowS: true,
    prehash: false,
    format: 'der'
  })
  tx.TxnSignature = bytesToHex(signature).toUpperCase()

  const txBlob = encode(tx)
  if (!txBlob) throw new Error('Failed to sign XRP transaction')
  const submitHash = await submitSignedBlob(params.rpcConfig, txBlob)
  const hash = String(submitHash || sha512HalfHex(txBlob) || '').trim()
  if (!hash) throw new Error('XRP submit succeeded but tx hash is missing')
  return { hash }
}
