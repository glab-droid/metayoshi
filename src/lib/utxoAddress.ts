// UTXO address derivation and utilities
import * as bip39 from 'bip39'
import { HDKey } from '@scure/bip32'
import { getPublicKey } from '@noble/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/ripemd160'
import bs58 from 'bs58'
import {
  DEFAULT_UTXO_COIN_SYMBOL,
  getAllUtxoAddressSpecs,
  getUtxoAddressSpec
} from '../coins'
import type { UtxoAddressSpec } from '../coins/types'

const UTXO_ADDRESS_SPECS = getAllUtxoAddressSpecs()

// BIP44 coin types resolved from per-coin modules.
export const BIP44_COIN_TYPES: Record<string, number> = Object.fromEntries(
  Object.entries(UTXO_ADDRESS_SPECS).map(([symbol, spec]) => [symbol, spec.bip44CoinType])
)

// P2PKH version bytes resolved from per-coin modules.
export const P2PKH_VERSIONS: Record<string, number | number[]> = Object.fromEntries(
  Object.entries(UTXO_ADDRESS_SPECS).map(([symbol, spec]) => [symbol, spec.p2pkhVersion])
)

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const a of arrs) {
    out.set(a, o)
    o += a.length
  }
  return out
}

function base58Check(payload: Uint8Array): string {
  const c1 = sha256(payload)
  const c2 = sha256(c1)
  const checksum = c2.slice(0, 4)
  return bs58.encode(concatBytes(payload, checksum))
}

function versionToBytes(version: number | number[]): Uint8Array {
  if (Array.isArray(version)) {
    if (version.length === 0) throw new Error('Invalid empty version byte array')
    return Uint8Array.from(version)
  }
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Invalid version number: ${version}`)
  }
  if (version <= 0xff) return Uint8Array.of(version)
  if (version <= 0xffff) return Uint8Array.of((version >> 8) & 0xff, version & 0xff)
  if (version <= 0xffffff) return Uint8Array.of((version >> 16) & 0xff, (version >> 8) & 0xff, version & 0xff)
  if (version <= 0xffffffff) {
    return Uint8Array.of((version >> 24) & 0xff, (version >> 16) & 0xff, (version >> 8) & 0xff, version & 0xff)
  }
  throw new Error(`Version number too large: ${version}`)
}

export function privateKeyHexToWif(
  privateKeyHex: string,
  wifVersion: number | number[] = 0x80,
  compressed = true
): string {
  const keyHex = String(privateKeyHex || '').trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error('Invalid private key hex')
  const keyBytes = hexToBytes(keyHex)
  const payload = compressed
    ? concatBytes(versionToBytes(wifVersion), keyBytes, Uint8Array.of(0x01))
    : concatBytes(versionToBytes(wifVersion), keyBytes)
  return base58Check(payload)
}

function checksum4(payload: Uint8Array): Uint8Array {
  const c1 = sha256(payload)
  const c2 = sha256(c1)
  return c2.slice(0, 4)
}

export function pubkeyToP2pkhAddress(
  pubkeyCompressed: Uint8Array,
  p2pkhVersion: number | number[]
): string {
  const h160 = ripemd160(sha256(pubkeyCompressed))
  const payload = concatBytes(versionToBytes(p2pkhVersion), h160)
  return base58Check(payload)
}

export function isAddressForUtxoSpec(address: string, spec: UtxoAddressSpec): boolean {
  try {
    const decoded = bs58.decode(address)
    if (decoded.length < 5) return false

    const payload = decoded.slice(0, -4)
    const checksum = decoded.slice(-4)
    const expectedChecksum = checksum4(payload)
    if (!checksum.every((byte, i) => byte === expectedChecksum[i])) return false

    const version = versionToBytes(spec.p2pkhVersion)
    if (payload.length !== version.length + 20) return false
    for (let i = 0; i < version.length; i++) {
      if (payload[i] !== version[i]) return false
    }
    return true
  } catch {
    return false
  }
}

export function isAddressForCoinSymbol(address: string, coinType: string): boolean {
  const spec = getUtxoAddressSpec(coinType.toUpperCase())
  if (!spec) return false
  return isAddressForUtxoSpec(address, spec)
}

export async function deriveUtxoAddress(
  mnemonic: string,
  coinType: string,
  accountIndex: number = 0,
  changeIndex: number = 0,
  addressIndex: number = 0
): Promise<{ address: string; pubHex: string; privHex: string }> {
  const symbol = coinType.toUpperCase()
  const fallbackSpec = getUtxoAddressSpec(DEFAULT_UTXO_COIN_SYMBOL)
  const spec = getUtxoAddressSpec(symbol) ?? fallbackSpec
  if (!spec) throw new Error(`Unknown UTXO coin type: ${coinType}`)
  return deriveUtxoAddressWithSpec(mnemonic, spec, accountIndex, changeIndex, addressIndex)
}

export async function deriveUtxoAddressWithSpec(
  mnemonic: string,
  spec: UtxoAddressSpec,
  accountIndex: number = 0,
  changeIndex: number = 0,
  addressIndex: number = 0
): Promise<{ address: string; pubHex: string; privHex: string }> {
  const bip44CoinType = spec.bip44CoinType
  const p2pkhVersion = spec.p2pkhVersion

  const seed = await bip39.mnemonicToSeed(mnemonic.trim())
  const root = HDKey.fromMasterSeed(seed)

  // m/44'/{coinType}'/{account}'/{change}/{addressIndex}
  const path = `m/44'/${bip44CoinType}'/${accountIndex}'/${changeIndex}/${addressIndex}`
  const child = root.derive(path)

  if (!child.privateKey) throw new Error('Failed to derive private key')

  const pub = getPublicKey(child.privateKey, true) // compressed
  const pubHex = bytesToHex(pub)
  const privHex = bytesToHex(child.privateKey)

  const address = pubkeyToP2pkhAddress(pub, p2pkhVersion)

  return { address, pubHex, privHex }
}

export async function deriveUtxoAccount0(mnemonic: string, coinType: string): Promise<{
  address: string
  pubHex: string
  privHex: string
}> {
  return deriveUtxoAddress(mnemonic, coinType, 0, 0, 0)
}
