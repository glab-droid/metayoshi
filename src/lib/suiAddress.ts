import * as bip39 from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import { blake2b } from '@noble/hashes/blake2b'
import { bytesToHex } from '@noble/hashes/utils'
import nacl from 'tweetnacl'

const SUI_ED25519_FLAG = 0x00

export function normalizeSuiAddress(value: string): string {
  const raw = String(value || '').trim().toLowerCase()
  const body = raw.replace(/^0x/, '')
  if (!/^[0-9a-f]{1,64}$/.test(body)) throw new Error('Invalid Sui address')
  return `0x${body.padStart(64, '0')}`
}

export function isSuiAddress(value: string): boolean {
  try {
    void normalizeSuiAddress(value)
    return true
  } catch {
    return false
  }
}

export async function deriveSuiAddress(
  mnemonic: string,
  accountIndex = 0
): Promise<{ address: string; pubHex: string; privHex: string }> {
  const normalized = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!bip39.validateMnemonic(normalized)) throw new Error('Invalid mnemonic phrase')
  const seed = await bip39.mnemonicToSeed(normalized)
  const path = `m/44'/784'/${accountIndex}'/0'/0'`
  const { key } = derivePath(path, seed.toString('hex'))
  const secretSeed = Uint8Array.from(key.slice(0, 32))
  const keyPair = nacl.sign.keyPair.fromSeed(secretSeed)
  const addressBytes = blake2b(Uint8Array.from([SUI_ED25519_FLAG, ...keyPair.publicKey]), { dkLen: 32 })
  return {
    address: `0x${bytesToHex(addressBytes)}`,
    pubHex: bytesToHex(keyPair.publicKey),
    privHex: bytesToHex(secretSeed)
  }
}
