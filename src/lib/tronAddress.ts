import * as bip39 from 'bip39'
import { HDKey } from '@scure/bip32'
import { TronWeb } from 'tronweb'
import { Buffer } from 'buffer'

export async function deriveTronAddress(
  mnemonic: string,
  accountIndex = 0
): Promise<{ address: string; pubHex: string; privHex: string }> {
  const normalized = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!bip39.validateMnemonic(normalized)) throw new Error('Invalid mnemonic phrase')
  const seed = await bip39.mnemonicToSeed(normalized)
  const root = HDKey.fromMasterSeed(seed)
  const child = root.derive(`m/44'/195'/${accountIndex}'/0/0`)
  if (!child.privateKey || !child.publicKey) throw new Error('Failed to derive TRON private key')
  const privHex = Buffer.from(child.privateKey).toString('hex')
  const pubHex = Buffer.from(child.publicKey).toString('hex')
  const address = TronWeb.address.fromPrivateKey(privHex)
  if (!address) throw new Error('Failed to derive TRON address')
  return { address, pubHex, privHex }
}
