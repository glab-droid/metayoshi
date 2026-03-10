import * as bip39 from 'bip39'

type CardanoLib = typeof import('@emurgo/cardano-serialization-lib-browser')

let cardanoLibPromise: Promise<CardanoLib> | null = null

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
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16)
  }
  return out
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

export async function deriveCardanoAddress(
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

  const CSL = await loadCardanoLib()
  const entropyHex = bip39.mnemonicToEntropy(normalized)
  const entropyBytes = hexToBytes(entropyHex)
  const emptyPassword = new Uint8Array(0)

  const root = CSL.Bip32PrivateKey.from_bip39_entropy(entropyBytes, emptyPassword)
  const accountKey = root
    .derive(hardened(1852))
    .derive(hardened(1815))
    .derive(hardened(accountIndex))
  const paymentPub = accountKey.derive(0).derive(0).to_public()
  const stakePub = accountKey.derive(2).derive(0).to_public()
  const paymentCred = CSL.Credential.from_keyhash(paymentPub.to_raw_key().hash())
  const stakeCred = CSL.Credential.from_keyhash(stakePub.to_raw_key().hash())
  const networkId = resolveCardanoNetworkId(rpcUrlHint)
  const baseAddress = CSL.BaseAddress.new(networkId, paymentCred, stakeCred).to_address().to_bech32()

  return {
    address: baseAddress,
    path: `m/1852'/1815'/${accountIndex}'/0/0`
  }
}
