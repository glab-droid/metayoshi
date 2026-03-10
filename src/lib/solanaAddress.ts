import * as bip39 from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import { bytesToHex } from '@noble/hashes/utils'
import { Keypair } from '@solana/web3.js'

export async function deriveSolanaAddress(
  mnemonic: string,
  accountIndex = 0
): Promise<{ address: string; pubHex: string; privHex: string }> {
  const normalized = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!bip39.validateMnemonic(normalized)) throw new Error('Invalid mnemonic phrase')
  const seed = await bip39.mnemonicToSeed(normalized)
  const path = `m/44'/501'/${accountIndex}'/0'`
  const { key } = derivePath(path, seed.toString('hex'))
  const secretSeed = Uint8Array.from(key.slice(0, 32))
  const kp = Keypair.fromSeed(secretSeed)
  return {
    address: kp.publicKey.toBase58(),
    pubHex: bytesToHex(kp.publicKey.toBytes()),
    privHex: bytesToHex(secretSeed)
  }
}

