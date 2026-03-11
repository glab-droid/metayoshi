import * as bip39 from 'bip39'
import { HDKey } from '@scure/bip32'
import { getPublicKey } from '@noble/secp256k1'
import { bytesToHex } from '@noble/hashes/utils'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { sha256 } from '@noble/hashes/sha256'

const XRP_COIN_TYPE = 144
const XRP_BASE58_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdefghijkmnoqtuvAxyz'

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((sum, arr) => sum + arr.length, 0)
  const out = new Uint8Array(len)
  let offset = 0
  for (const arr of arrs) {
    out.set(arr, offset)
    offset += arr.length
  }
  return out
}

function checksum4(payload: Uint8Array): Uint8Array {
  return sha256(sha256(payload)).slice(0, 4)
}

function base58EncodeWithAlphabet(data: Uint8Array, alphabet: string): string {
  if (data.length === 0) return ''
  const base = BigInt(58)
  let value = 0n
  for (const byte of data) value = (value << 8n) + BigInt(byte)

  let encoded = ''
  while (value > 0n) {
    const mod = Number(value % base)
    encoded = alphabet[mod] + encoded
    value /= base
  }

  for (let i = 0; i < data.length && data[i] === 0; i++) {
    encoded = alphabet[0] + encoded
  }
  return encoded || alphabet[0]
}

function pubkeyToXrpClassicAddress(pubkeyCompressed: Uint8Array): string {
  const accountId = ripemd160(sha256(pubkeyCompressed))
  const payload = concatBytes(Uint8Array.of(0x00), accountId)
  const withChecksum = concatBytes(payload, checksum4(payload))
  return base58EncodeWithAlphabet(withChecksum, XRP_BASE58_ALPHABET)
}

export async function deriveXrpAddress(
  mnemonic: string,
  accountIndex = 0
): Promise<{ address: string; pubHex: string; privHex: string }> {
  const seed = await bip39.mnemonicToSeed(mnemonic.trim())
  const root = HDKey.fromMasterSeed(seed)
  const path = `m/44'/${XRP_COIN_TYPE}'/${accountIndex}'/0/0`
  const child = root.derive(path)
  if (!child.privateKey) throw new Error('Failed to derive XRP private key')

  const pub = getPublicKey(child.privateKey, true)
  const address = pubkeyToXrpClassicAddress(pub)
  return {
    address,
    pubHex: bytesToHex(pub),
    privHex: bytesToHex(child.privateKey)
  }
}
