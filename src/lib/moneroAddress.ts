import * as bip39 from 'bip39'
import { keccak_256 } from '@noble/hashes/sha3'
import { hmac } from '@noble/hashes/hmac'
import { sha512 } from '@noble/hashes/sha512'
import { ed25519 } from '@noble/curves/ed25519.js'

const MONERO_B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const MONERO_B58_ENCODED_BLOCK_SIZES = [0, 2, 3, 5, 6, 7, 9, 10, 11]
const MONERO_CURVE_ORDER = (1n << 252n) + 27742317777372353535851937790883648493n

function normalizeMnemonic(input: string): string {
  return String(input || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function ser32be(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
}

function parseHardenedPath(path: string): number[] {
  const parts = String(path || '').trim().split('/')
  if (parts[0] !== 'm') throw new Error(`Invalid derivation path: ${path}`)
  const out: number[] = []
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    if (!p.endsWith("'")) throw new Error(`Non-hardened path segment is not supported for ed25519: ${p}`)
    const n = Number(p.slice(0, -1))
    if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) throw new Error(`Invalid path segment: ${p}`)
    out.push((0x80000000 | n) >>> 0)
  }
  return out
}

function deriveEd25519Slip10(seed: Uint8Array, path: string): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed)
  let key = I.slice(0, 32)
  let chainCode = I.slice(32)

  const indices = parseHardenedPath(path)
  for (const idx of indices) {
    const data = concatBytes(Uint8Array.of(0x00), key, ser32be(idx))
    I = hmac(sha512, chainCode, data)
    key = I.slice(0, 32)
    chainCode = I.slice(32)
  }
  return key
}

function leBytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (let i = bytes.length - 1; i >= 0; i--) {
    value = (value << 8n) | BigInt(bytes[i])
  }
  return value
}

function bigIntToLeBytes(value: bigint, size: number): Uint8Array {
  const out = new Uint8Array(size)
  let v = value
  for (let i = 0; i < size; i++) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

function reduce32(input32: Uint8Array): Uint8Array {
  const n = leBytesToBigInt(input32) % MONERO_CURVE_ORDER
  return bigIntToLeBytes(n, 32)
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function encodeBase58Block(block: Uint8Array): string {
  let value = 0n
  for (let i = 0; i < block.length; i++) {
    value = (value << 8n) | BigInt(block[i])
  }

  let out = ''
  while (value > 0n) {
    const rem = Number(value % 58n)
    out = MONERO_B58_ALPHABET[rem] + out
    value /= 58n
  }

  const targetLen = MONERO_B58_ENCODED_BLOCK_SIZES[block.length]
  while (out.length < targetLen) out = `1${out}`
  return out
}

function moneroBase58Encode(data: Uint8Array): string {
  let out = ''
  for (let i = 0; i < data.length; i += 8) {
    const block = data.slice(i, Math.min(i + 8, data.length))
    out += encodeBase58Block(block)
  }
  return out
}

function resolveMoneroAddressPrefix(rpcUrlHint?: string): number {
  const env = String((import.meta as any)?.env?.VITE_XMR_NETWORK || '').trim().toLowerCase()
  if (env === 'testnet') return 53
  if (env === 'stagenet') return 24
  if (env === 'mainnet') return 18

  const hint = String(rpcUrlHint || '').toLowerCase()
  if (hint.includes('testnet')) return 53
  if (hint.includes('stagenet')) return 24
  return 18
}

export async function deriveMoneroAddress(
  mnemonic: string,
  accountIndex = 0,
  rpcUrlHint?: string
): Promise<{ address: string; path: string }> {
  const normalized = normalizeMnemonic(mnemonic)
  if (!bip39.validateMnemonic(normalized)) {
    throw new Error('Invalid mnemonic phrase')
  }
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error('Invalid account index')
  }

  const seed = await bip39.mnemonicToSeed(normalized)
  const path = `m/44'/128'/${accountIndex}'`
  const slip10Key = deriveEd25519Slip10(Uint8Array.from(seed), path)
  const spendSecret = reduce32(keccak_256(slip10Key))
  const viewSecret = reduce32(keccak_256(spendSecret))

  const spendScalar = leBytesToBigInt(spendSecret)
  const viewScalar = leBytesToBigInt(viewSecret)
  if (spendScalar === 0n || viewScalar === 0n) {
    throw new Error('Failed to derive Monero scalar keys')
  }

  const spendPub = ed25519.Point.BASE.multiply(spendScalar).toBytes()
  const viewPub = ed25519.Point.BASE.multiply(viewScalar).toBytes()

  const prefix = Uint8Array.of(resolveMoneroAddressPrefix(rpcUrlHint))
  const payload = concatBytes(prefix, spendPub, viewPub)
  const checksum = keccak_256(payload).slice(0, 4)
  const address = moneroBase58Encode(concatBytes(payload, checksum))

  return { address, path: `${path}/0/0` }
}
