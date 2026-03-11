import { ethers } from 'ethers'
import * as secp from '@noble/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils'
import nacl from 'tweetnacl'
import {
  Connection,
  Transaction,
  VersionedTransaction,
  Keypair
} from '@solana/web3.js'
import { resolveEvmExternalSigner } from './evmExternalSigner'
import { deriveSolanaAddress } from './solanaAddress'
import { deriveCosmosAddress, resolveCosmosAddressConfig } from './cosmosAddress'
import type { Network } from '../coins'

type JsonObject = Record<string, any>

function utf8(input: string): Uint8Array {
  return new TextEncoder().encode(String(input || ''))
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i])
  return btoa(out)
}

function fromBase64(value: string): Uint8Array {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error('Base64 payload is required')
  const raw = atob(normalized)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

function normalizeHexData(input: string): Uint8Array {
  const value = String(input || '').trim()
  if (!/^0x[0-9a-f]*$/i.test(value) || value.length % 2 !== 0) {
    throw new Error('Expected 0x-prefixed hex data')
  }
  return hexToBytes(value.slice(2))
}

function normalizeMessageBytes(input: string, encoding: 'utf8' | 'hex' | 'base64' = 'utf8'): Uint8Array {
  if (encoding === 'hex') return normalizeHexData(input)
  if (encoding === 'base64') return fromBase64(input)
  return utf8(input)
}

function parseRpcQuantityToBigInt(value: unknown): bigint {
  const raw = String(value ?? '').trim()
  if (!raw) return 0n
  if (/^0x[0-9a-f]+$/i.test(raw)) return BigInt(raw)
  if (/^\d+$/.test(raw)) return BigInt(raw)
  throw new Error(`Invalid RPC quantity: ${raw}`)
}

function evmDerivationPath(accountIndex: number): string {
  return `m/44'/60'/${accountIndex}'/0/0`
}

function deriveEvmWallet(mnemonic: string, accountIndex: number) {
  return ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, evmDerivationPath(accountIndex))
}

function resolveAccountIndex(accountIndex?: number): number {
  return Number.isInteger(accountIndex) && Number(accountIndex) >= 0 ? Number(accountIndex) : 0
}

function parseTypedDataPayload(raw: unknown): { domain: JsonObject; types: JsonObject; message: JsonObject; primaryType?: string } {
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!payload || typeof payload !== 'object') throw new Error('Typed data payload must be an object')
  const typed = payload as JsonObject
  if (!typed.domain || !typed.types || !typed.message) {
    throw new Error('Typed data payload must include domain, types, and message')
  }
  const types = { ...typed.types }
  delete (types as JsonObject).EIP712Domain
  return {
    domain: typed.domain as JsonObject,
    types: types as JsonObject,
    message: typed.message as JsonObject,
    primaryType: typeof typed.primaryType === 'string' ? typed.primaryType : undefined
  }
}

function stableAminoValue(value: any): any {
  if (Array.isArray(value)) return value.map((entry) => stableAminoValue(entry))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, any> = {}
  for (const key of Object.keys(value).sort()) {
    const next = value[key]
    if (next === undefined) continue
    out[key] = stableAminoValue(next)
  }
  return out
}

function encodeVarint(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('Varint value must be unsigned')
  const out: number[] = []
  let n = value
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n))
    n >>= 7n
  }
  out.push(Number(n))
  return new Uint8Array(out)
}

function fieldKey(fieldNo: number, wireType: 0 | 2): Uint8Array {
  return encodeVarint(BigInt((fieldNo << 3) | wireType))
}

function encodeFieldVarint(fieldNo: number, value: bigint): Uint8Array {
  return concatBytes(fieldKey(fieldNo, 0), encodeVarint(value))
}

function encodeFieldBytes(fieldNo: number, bytes: Uint8Array): Uint8Array {
  return concatBytes(fieldKey(fieldNo, 2), encodeVarint(BigInt(bytes.length)), bytes)
}

function encodeFieldString(fieldNo: number, value: string): Uint8Array {
  return encodeFieldBytes(fieldNo, utf8(value))
}

function encodeSignDoc(input: {
  bodyBytes: Uint8Array
  authInfoBytes: Uint8Array
  chainId: string
  accountNumber: bigint
}): Uint8Array {
  return concatBytes(
    encodeFieldBytes(1, input.bodyBytes),
    encodeFieldBytes(2, input.authInfoBytes),
    encodeFieldString(3, input.chainId),
    encodeFieldVarint(4, input.accountNumber)
  )
}

function encodeTxRaw(input: {
  bodyBytes: Uint8Array
  authInfoBytes: Uint8Array
  signature: Uint8Array
}): Uint8Array {
  return concatBytes(
    encodeFieldBytes(1, input.bodyBytes),
    encodeFieldBytes(2, input.authInfoBytes),
    encodeFieldBytes(3, input.signature)
  )
}

function deriveCosmosRestCandidates(rpcUrl: string): string[] {
  const raw = String(rpcUrl || '').trim().replace(/\/+$/, '')
  if (!raw) return []
  const out = new Set<string>([raw])
  try {
    const parsed = new URL(raw)
    const host = String(parsed.host || '').toLowerCase()
    out.add(`${parsed.protocol}//${host.replace('-rpc.publicnode.com', '-rest.publicnode.com')}`)
    out.add(`${parsed.protocol}//${host.replace('-rpc.publicnode.com', '-api.publicnode.com')}`)
  } catch {
    // Keep original URL only.
  }
  return [...out].filter(Boolean)
}

export async function signEvmMessage(input: {
  mnemonic: string
  accountIndex?: number
  message: string
  encoding?: 'utf8' | 'hex'
}): Promise<string> {
  const externalSigner = await resolveEvmExternalSigner()
  const messageBytes = normalizeMessageBytes(input.message, input.encoding || 'utf8')
  if (externalSigner) {
    return externalSigner.signMessage(ethers.getBytes(messageBytes))
  }
  const wallet = deriveEvmWallet(input.mnemonic, resolveAccountIndex(input.accountIndex))
  return wallet.signMessage(messageBytes)
}

export async function signEvmTypedData(input: {
  mnemonic: string
  accountIndex?: number
  typedData: unknown
}): Promise<string> {
  const parsed = parseTypedDataPayload(input.typedData)
  const externalSigner = await resolveEvmExternalSigner()
  if (externalSigner && typeof (externalSigner as any).signTypedData === 'function') {
    return (externalSigner as any).signTypedData(parsed.domain, parsed.types, parsed.message)
  }
  const wallet = deriveEvmWallet(input.mnemonic, resolveAccountIndex(input.accountIndex))
  return wallet.signTypedData(parsed.domain, parsed.types, parsed.message)
}

export async function signEvmTransaction(input: {
  mnemonic: string
  accountIndex?: number
  tx: {
    to?: string
    value?: string
    data?: string
    gasLimit?: string
    gasPrice?: string
    maxFeePerGas?: string
    maxPriorityFeePerGas?: string
    nonce?: string
    chainId?: string | number
    type?: number
  }
}): Promise<string> {
  const wallet = deriveEvmWallet(input.mnemonic, resolveAccountIndex(input.accountIndex))
  const tx = input.tx || {}
  const request: any = {
    data: String(tx.data || '').trim() || undefined,
    to: String(tx.to || '').trim() || undefined,
    value: tx.value !== undefined ? parseRpcQuantityToBigInt(tx.value) : undefined,
    gasLimit: tx.gasLimit !== undefined ? parseRpcQuantityToBigInt(tx.gasLimit) : undefined,
    gasPrice: tx.gasPrice !== undefined ? parseRpcQuantityToBigInt(tx.gasPrice) : undefined,
    maxFeePerGas: tx.maxFeePerGas !== undefined ? parseRpcQuantityToBigInt(tx.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas !== undefined ? parseRpcQuantityToBigInt(tx.maxPriorityFeePerGas) : undefined,
    nonce: tx.nonce !== undefined ? Number(parseRpcQuantityToBigInt(tx.nonce)) : undefined,
    chainId: tx.chainId !== undefined ? Number(parseRpcQuantityToBigInt(tx.chainId)) : undefined,
    type: tx.type === 2 ? 2 : undefined
  }
  return wallet.signTransaction(request)
}

export async function signAndSendEvmTransaction(input: {
  mnemonic: string
  accountIndex?: number
  rpcUrl: string
  tx: {
    to?: string
    value?: string
    data?: string
    gasLimit?: string
    gasPrice?: string
    maxFeePerGas?: string
    maxPriorityFeePerGas?: string
    nonce?: string
    chainId?: string | number
    type?: number
  }
}): Promise<{ hash: string }> {
  const signedTx = await signEvmTransaction({
    mnemonic: input.mnemonic,
    accountIndex: input.accountIndex,
    tx: input.tx
  })
  const provider = new ethers.JsonRpcProvider(String(input.rpcUrl || '').trim())
  const sent = await provider.broadcastTransaction(signedTx)
  return { hash: String(sent.hash || '').trim() }
}

export async function signSolanaMessage(input: {
  mnemonic: string
  accountIndex?: number
  messageBase64: string
}): Promise<{ publicKey: string; signatureBase64: string }> {
  const derived = await deriveSolanaAddress(input.mnemonic, resolveAccountIndex(input.accountIndex))
  const keypair = Keypair.fromSeed(hexToBytes(derived.privHex))
  const messageBytes = fromBase64(input.messageBase64)
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey)
  return {
    publicKey: derived.address,
    signatureBase64: toBase64(signature)
  }
}

function signSolanaSerializedTransaction(serializedTxBase64: string, keypair: Keypair): string {
  const serialized = fromBase64(serializedTxBase64)
  try {
    const tx = VersionedTransaction.deserialize(serialized)
    tx.sign([keypair])
    return toBase64(tx.serialize())
  } catch {
    const tx = Transaction.from(serialized)
    tx.partialSign(keypair)
    return toBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))
  }
}

export async function signSolanaTransaction(input: {
  mnemonic: string
  accountIndex?: number
  serializedTxBase64: string
}): Promise<string> {
  const derived = await deriveSolanaAddress(input.mnemonic, resolveAccountIndex(input.accountIndex))
  const keypair = Keypair.fromSeed(hexToBytes(derived.privHex))
  return signSolanaSerializedTransaction(input.serializedTxBase64, keypair)
}

export async function signSolanaTransactions(input: {
  mnemonic: string
  accountIndex?: number
  serializedTxsBase64: string[]
}): Promise<string[]> {
  const derived = await deriveSolanaAddress(input.mnemonic, resolveAccountIndex(input.accountIndex))
  const keypair = Keypair.fromSeed(hexToBytes(derived.privHex))
  return input.serializedTxsBase64.map((row) => signSolanaSerializedTransaction(row, keypair))
}

export async function signAndSendSolanaTransaction(input: {
  mnemonic: string
  accountIndex?: number
  rpcUrl: string
  serializedTxBase64: string
}): Promise<{ signature: string }> {
  const signed = await signSolanaTransaction({
    mnemonic: input.mnemonic,
    accountIndex: input.accountIndex,
    serializedTxBase64: input.serializedTxBase64
  })
  const connection = new Connection(String(input.rpcUrl || '').trim(), 'confirmed')
  const signature = await connection.sendRawTransaction(fromBase64(signed), {
    skipPreflight: false
  })
  return { signature }
}

export async function signCosmosDirect(input: {
  mnemonic: string
  accountIndex?: number
  network: Network
  signDoc: {
    bodyBytes: string
    authInfoBytes: string
    chainId: string
    accountNumber: string
  }
}): Promise<{
  signed: {
    bodyBytes: string
    authInfoBytes: string
    chainId: string
    accountNumber: string
  }
  signature: {
    pub_key: { type: string; value: string }
    signature: string
  }
}> {
  const config = resolveCosmosAddressConfig(input.network)
  const derived = await deriveCosmosAddress(input.mnemonic, resolveAccountIndex(input.accountIndex), {
    hrp: config.hrp,
    coinType: config.coinType
  })
  const bodyBytes = fromBase64(input.signDoc.bodyBytes)
  const authInfoBytes = fromBase64(input.signDoc.authInfoBytes)
  const signDocBytes = encodeSignDoc({
    bodyBytes,
    authInfoBytes,
    chainId: String(input.signDoc.chainId || '').trim(),
    accountNumber: BigInt(String(input.signDoc.accountNumber || '0'))
  })
  const signatureBytes = secp.sign(sha256(signDocBytes), hexToBytes(derived.privHex), {
    prehash: false,
    lowS: true,
    format: 'compact'
  })
  return {
    signed: {
      bodyBytes: input.signDoc.bodyBytes,
      authInfoBytes: input.signDoc.authInfoBytes,
      chainId: String(input.signDoc.chainId || '').trim(),
      accountNumber: String(input.signDoc.accountNumber || '0')
    },
    signature: {
      pub_key: {
        type: 'tendermint/PubKeySecp256k1',
        value: toBase64(hexToBytes(derived.pubHex))
      },
      signature: toBase64(signatureBytes)
    }
  }
}

export async function deriveCosmosKeyData(input: {
  mnemonic: string
  accountIndex?: number
  network: Network
}): Promise<{
  address: string
  bech32Address: string
  pubKeyBase64: string
  algo: 'secp256k1'
}> {
  const config = resolveCosmosAddressConfig(input.network)
  const derived = await deriveCosmosAddress(input.mnemonic, resolveAccountIndex(input.accountIndex), {
    hrp: config.hrp,
    coinType: config.coinType
  })
  return {
    address: derived.address,
    bech32Address: derived.address,
    pubKeyBase64: toBase64(hexToBytes(derived.pubHex)),
    algo: 'secp256k1'
  }
}

export async function signCosmosAmino(input: {
  mnemonic: string
  accountIndex?: number
  network: Network
  signDoc: any
}): Promise<{
  signed: any
  signature: {
    pub_key: { type: string; value: string }
    signature: string
  }
}> {
  const config = resolveCosmosAddressConfig(input.network)
  const derived = await deriveCosmosAddress(input.mnemonic, resolveAccountIndex(input.accountIndex), {
    hrp: config.hrp,
    coinType: config.coinType
  })
  const canonical = stableAminoValue(input.signDoc)
  const digest = sha256(utf8(JSON.stringify(canonical)))
  const signatureBytes = secp.sign(digest, hexToBytes(derived.privHex), {
    prehash: false,
    lowS: true,
    format: 'compact'
  })
  return {
    signed: canonical,
    signature: {
      pub_key: {
        type: 'tendermint/PubKeySecp256k1',
        value: toBase64(hexToBytes(derived.pubHex))
      },
      signature: toBase64(signatureBytes)
    }
  }
}

export function buildCosmosTxBytesBase64(input: {
  signDoc: { bodyBytes: string; authInfoBytes: string }
  signatureBase64: string
}): string {
  const txRawBytes = encodeTxRaw({
    bodyBytes: fromBase64(input.signDoc.bodyBytes),
    authInfoBytes: fromBase64(input.signDoc.authInfoBytes),
    signature: fromBase64(input.signatureBase64)
  })
  return toBase64(txRawBytes)
}

export async function broadcastCosmosTx(input: {
  rpcUrl: string
  txBytesBase64: string
  mode?: 'BROADCAST_MODE_SYNC' | 'BROADCAST_MODE_ASYNC' | 'BROADCAST_MODE_BLOCK'
}): Promise<{ txhash: string; rawLog?: string }> {
  const mode = input.mode || 'BROADCAST_MODE_SYNC'
  let lastError: unknown = null
  for (const base of deriveCosmosRestCandidates(input.rpcUrl)) {
    try {
      const response = await fetch(`${base}/cosmos/tx/v1beta1/txs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tx_bytes: input.txBytesBase64,
          mode
        })
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.tx_response) {
        throw new Error(String(json?.message || json?.error || `Cosmos broadcast failed (HTTP ${response.status})`))
      }
      const txhash = String(json.tx_response.txhash || '').trim()
      if (!txhash) throw new Error('Cosmos broadcast returned no txhash')
      return {
        txhash,
        rawLog: typeof json.tx_response.raw_log === 'string' ? json.tx_response.raw_log : undefined
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Unable to broadcast Cosmos transaction')
}

export function toBase64String(value: Uint8Array): string {
  return toBase64(value)
}

export function fromBase64String(value: string): Uint8Array {
  return fromBase64(value)
}

export function hexBytesToBase64(hexValue: string): string {
  return toBase64(hexToBytes(String(hexValue || '').trim().replace(/^0x/i, '')))
}

export function bytesToHexString(bytes: Uint8Array): string {
  return bytesToHex(bytes)
}
