import * as bip39 from 'bip39'
import type { Network } from '../coins'

type CardanoLib = typeof import('@emurgo/cardano-serialization-lib-browser')

let cardanoLibPromise: Promise<CardanoLib> | null = null
const DEFAULT_API_BASE_URL = 'https://api.metayoshi.app'

function loadCardanoLib(): Promise<CardanoLib> {
  if (!cardanoLibPromise) {
    cardanoLibPromise = import('@emurgo/cardano-serialization-lib-browser')
  }
  return cardanoLibPromise
}

function normalizeMnemonic(input: string): string {
  return String(input || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function hexToBytes(hex: string): Uint8Array {
  const clean = String(hex || '').trim().replace(/^0x/i, '')
  if (!/^[0-9a-f]*$/i.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Invalid hex input')
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hardened(index: number): number {
  return (0x80000000 | index) >>> 0
}

function resolveCardanoNetworkId(rpcUrl?: string): number {
  const env = String(import.meta.env.VITE_ADA_NETWORK || '').trim().toLowerCase()
  if (env === 'testnet' || env === 'preprod' || env === 'preview') return 0
  if (env === 'mainnet') return 1
  const hint = String(rpcUrl || '').toLowerCase()
  return /testnet|preprod|preview/.test(hint) ? 0 : 1
}

function resolveApiBaseUrl(network: Network): string {
  const explicit = String(import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '')
  if (explicit) return explicit
  const bridge = String(network.bridgeUrl || '').trim()
  if (bridge) {
    try {
      const parsed = new URL(bridge)
      return parsed.origin
    } catch {
      // fall through
    }
  }
  return DEFAULT_API_BASE_URL
}

function resolveApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = String(import.meta.env.VITE_APP_API_KEY || '').trim()
  if (apiKey) headers['X-API-Key'] = apiKey
  return headers
}

function ensureHex(value: unknown, label: string): string {
  const hex = String(value || '').trim().replace(/^0x/i, '')
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error(`${label} is not valid hex`)
  return hex
}

function lovelaceFromAdaAmount(amount: string): number {
  const raw = String(amount || '').trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('Invalid ADA amount')
  const [whole, frac = ''] = raw.split('.')
  if (frac.length > 6) throw new Error('ADA supports up to 6 decimals')
  const combined = `${whole}${frac.padEnd(6, '0')}`
  const lovelace = Number(combined)
  if (!Number.isFinite(lovelace) || lovelace <= 0) throw new Error('ADA amount must be greater than 0')
  return lovelace
}

type CardanoConstructResponse = {
  unsignedTxCborHex: string
  inputAddresses: string[]
  feeLovelace?: number
}

type CardanoConstructAsset = {
  policyId: string
  assetName: string
  quantity: string
}

async function requestCardanoConstruct(
  network: Network,
  payload: {
    walletId?: string
    fromAddress: string
    toAddress: string
    amountLovelace: number
    changeAddress: string
    assets?: CardanoConstructAsset[]
  }
): Promise<CardanoConstructResponse> {
  const apiBase = resolveApiBaseUrl(network)
  const chain = /testnet|preprod|preview/i.test(String(network.rpcUrl || '')) ? 'test' : 'main'
  const res = await fetch(`${apiBase}/v1/cardano/${chain}/tx/construct`, {
    method: 'POST',
    headers: resolveApiHeaders(),
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.ok) {
    const detail = String(json?.error || `Cardano construct failed (HTTP ${res.status})`)
    throw new Error(detail)
  }
  const unsignedTxCborHex = ensureHex(
    json?.unsignedTxCborHex ?? json?.unsignedTxHex ?? json?.transaction,
    'Constructed transaction'
  )
  const inputAddresses = Array.isArray(json?.inputAddresses)
    ? json.inputAddresses.map((v: unknown) => String(v || '').trim()).filter(Boolean)
    : []
  return {
    unsignedTxCborHex,
    inputAddresses,
    feeLovelace: Number.isFinite(Number(json?.feeLovelace)) ? Number(json.feeLovelace) : undefined
  }
}

async function submitCardanoSignedTx(
  network: Network,
  payload: {
    walletId?: string
    signedTxCborHex: string
  }
): Promise<string> {
  const apiBase = resolveApiBaseUrl(network)
  const chain = /testnet|preprod|preview/i.test(String(network.rpcUrl || '')) ? 'test' : 'main'
  const res = await fetch(`${apiBase}/v1/cardano/${chain}/tx/submit`, {
    method: 'POST',
    headers: resolveApiHeaders(),
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.ok) {
    const detail = String(json?.error || `Cardano submit failed (HTTP ${res.status})`)
    throw new Error(detail)
  }
  const txid = String(json?.txid || json?.hash || '').trim()
  if (!txid) throw new Error('Cardano submit succeeded but txid is missing')
  return txid
}

async function deriveAddressAndRawKey(
  CSL: CardanoLib,
  entropyBytes: Uint8Array,
  accountIndex: number,
  role: number,
  index: number,
  networkId: number
): Promise<{ address: string; rawKey: any }> {
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(entropyBytes, new Uint8Array(0))
  const accountKey = root
    .derive(hardened(1852))
    .derive(hardened(1815))
    .derive(hardened(accountIndex))
  const payment = accountKey.derive(role).derive(index)
  const stake = accountKey.derive(2).derive(0)
  const paymentPub = payment.to_public()
  const stakePub = stake.to_public()
  const paymentCred = CSL.Credential.from_keyhash(paymentPub.to_raw_key().hash())
  const stakeCred = CSL.Credential.from_keyhash(stakePub.to_raw_key().hash())
  const address = CSL.BaseAddress.new(networkId, paymentCred, stakeCred).to_address().to_bech32()
  return { address, rawKey: payment.to_raw_key() }
}

async function findWitnessKeys(
  CSL: CardanoLib,
  mnemonic: string,
  accountIndex: number,
  rpcUrlHint: string | undefined,
  candidateAddresses: string[]
): Promise<any[]> {
  const normalized = normalizeMnemonic(mnemonic)
  if (!bip39.validateMnemonic(normalized)) throw new Error('Invalid mnemonic phrase')
  const entropyHex = bip39.mnemonicToEntropy(normalized)
  const entropyBytes = hexToBytes(entropyHex)
  const networkId = resolveCardanoNetworkId(rpcUrlHint)
  const wanted = new Set(candidateAddresses.map((a) => String(a || '').trim()).filter(Boolean))
  const keys: any[] = []
  const seenAddresses = new Set<string>()

  for (const role of [0, 1]) {
    for (let idx = 0; idx <= 120; idx += 1) {
      const derived = await deriveAddressAndRawKey(CSL, entropyBytes, accountIndex, role, idx, networkId)
      if (!wanted.has(derived.address)) continue
      if (seenAddresses.has(derived.address)) continue
      seenAddresses.add(derived.address)
      keys.push(derived.rawKey)
    }
  }
  return keys
}

function mergeUniqueAddresses(values: string[]): string[] {
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

function parseCardanoTokenId(tokenId: string): { policyId: string; assetName: string } {
  const normalized = String(tokenId || '').trim()
  if (!normalized) throw new Error('Cardano token id is required')
  const dot = normalized.indexOf('.')
  if (dot <= 0 || dot >= normalized.length - 1) {
    throw new Error('Cardano token id must be in policyId.assetName format')
  }
  const policyId = normalized.slice(0, dot).trim()
  const assetName = normalized.slice(dot + 1).trim()
  if (!/^[0-9a-f]{56}$/i.test(policyId)) {
    throw new Error('Cardano token policy id must be 56 hex chars')
  }
  if (!/^[0-9a-f]+$/i.test(assetName)) {
    throw new Error('Cardano token asset name must be hex')
  }
  return { policyId: policyId.toLowerCase(), assetName: assetName.toLowerCase() }
}

function parseCardanoTokenAmountRaw(value: string): string {
  const raw = String(value || '').trim()
  if (!/^\d+$/.test(raw)) throw new Error('Cardano token amount must be a positive integer')
  const qty = BigInt(raw)
  if (qty <= 0n) throw new Error('Cardano token amount must be greater than 0')
  return qty.toString()
}

function signCardanoUnsignedTx(
  CSL: CardanoLib,
  unsignedTxHex: string,
  signingKeys: any[]
): string {
  if (signingKeys.length <= 0) throw new Error('No signing keys available for Cardano transaction inputs')
  const tx = CSL.Transaction.from_bytes(hexToBytes(unsignedTxHex))
  const body = tx.body()
  const txHash = (CSL as any).hash_transaction(body)
  const witnessSet = tx.witness_set()
  const vkeys = witnessSet.vkeys() ?? CSL.Vkeywitnesses.new()
  const seenVkeys = new Set<string>()

  for (let i = 0; i < vkeys.len(); i += 1) {
    const existing = vkeys.get(i)
    if (!existing) continue
    seenVkeys.add(bytesToHex(existing.vkey().public_key().as_bytes()))
  }

  for (const sk of signingKeys) {
    const witness = CSL.make_vkey_witness(txHash, sk)
    const pubHex = bytesToHex(witness.vkey().public_key().as_bytes())
    if (seenVkeys.has(pubHex)) continue
    vkeys.add(witness)
    seenVkeys.add(pubHex)
  }
  witnessSet.set_vkeys(vkeys)
  const signed = CSL.Transaction.new(body, witnessSet, tx.auxiliary_data())
  return bytesToHex(signed.to_bytes())
}

export async function sendCardanoNonCustodial(params: {
  network: Network
  mnemonic: string
  accountIndex: number
  fromAddress: string
  toAddress: string
  amountAda: string
  walletId?: string
}): Promise<{ hash: string; feeLovelace?: number }> {
  const fromAddress = String(params.fromAddress || '').trim()
  const toAddress = String(params.toAddress || '').trim()
  if (!fromAddress) throw new Error('Cardano sender address is required')
  if (!toAddress) throw new Error('Cardano destination address is required')
  const amountLovelace = lovelaceFromAdaAmount(params.amountAda)

  const constructed = await requestCardanoConstruct(params.network, {
    walletId: String(params.walletId || '').trim() || undefined,
    fromAddress,
    toAddress,
    amountLovelace,
    changeAddress: fromAddress
  })
  const CSL = await loadCardanoLib()
  const witnessAddresses = mergeUniqueAddresses([fromAddress, ...constructed.inputAddresses])
  const signingKeys = await findWitnessKeys(
    CSL,
    params.mnemonic,
    params.accountIndex,
    params.network.rpcUrl,
    witnessAddresses
  )
  const signedTxCborHex = signCardanoUnsignedTx(CSL, constructed.unsignedTxCborHex, signingKeys)
  const txid = await submitCardanoSignedTx(params.network, {
    walletId: String(params.walletId || '').trim() || undefined,
    signedTxCborHex
  })
  return { hash: txid, feeLovelace: constructed.feeLovelace }
}

export async function sendCardanoAssetNonCustodial(params: {
  network: Network
  mnemonic: string
  accountIndex: number
  fromAddress: string
  toAddress: string
  tokenId: string
  tokenAmountRaw: string
  minAdaLovelace?: number
  walletId?: string
}): Promise<{ hash: string; feeLovelace?: number }> {
  const fromAddress = String(params.fromAddress || '').trim()
  const toAddress = String(params.toAddress || '').trim()
  if (!fromAddress) throw new Error('Cardano sender address is required')
  if (!toAddress) throw new Error('Cardano destination address is required')

  const { policyId, assetName } = parseCardanoTokenId(params.tokenId)
  const tokenQty = parseCardanoTokenAmountRaw(params.tokenAmountRaw)
  const minAdaLovelaceRaw = Number(params.minAdaLovelace ?? 1_500_000)
  const minAdaLovelace = Number.isFinite(minAdaLovelaceRaw) && minAdaLovelaceRaw > 0
    ? Math.trunc(minAdaLovelaceRaw)
    : 1_500_000

  const constructed = await requestCardanoConstruct(params.network, {
    walletId: String(params.walletId || '').trim() || undefined,
    fromAddress,
    toAddress,
    amountLovelace: minAdaLovelace,
    changeAddress: fromAddress,
    assets: [{
      policyId,
      assetName,
      quantity: tokenQty
    }]
  })

  const CSL = await loadCardanoLib()
  const witnessAddresses = mergeUniqueAddresses([fromAddress, ...constructed.inputAddresses])
  const signingKeys = await findWitnessKeys(
    CSL,
    params.mnemonic,
    params.accountIndex,
    params.network.rpcUrl,
    witnessAddresses
  )
  const signedTxCborHex = signCardanoUnsignedTx(CSL, constructed.unsignedTxCborHex, signingKeys)
  const txid = await submitCardanoSignedTx(params.network, {
    walletId: String(params.walletId || '').trim() || undefined,
    signedTxCborHex
  })
  return { hash: txid, feeLovelace: constructed.feeLovelace }
}
