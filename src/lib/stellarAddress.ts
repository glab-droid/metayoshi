import * as bip39 from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import { Keypair } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'

export async function deriveStellarAddress(
  mnemonic: string,
  accountIndex = 0
): Promise<{ address: string; pubHex: string; privHex: string }> {
  const normalized = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!bip39.validateMnemonic(normalized)) throw new Error('Invalid mnemonic phrase')
  const seed = await bip39.mnemonicToSeed(normalized)
  const path = `m/44'/148'/${accountIndex}'`
  const { key } = derivePath(path, seed.toString('hex'))
  const secretSeed = Buffer.from(key.slice(0, 32))
  const pair = Keypair.fromRawEd25519Seed(secretSeed)
  return {
    address: pair.publicKey(),
    pubHex: Buffer.from(pair.rawPublicKey()).toString('hex'),
    privHex: Buffer.from(secretSeed).toString('hex')
  }
}
