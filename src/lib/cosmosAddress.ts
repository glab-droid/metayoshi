import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { bech32 } from '@scure/base'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { bytesToHex } from '@noble/hashes/utils'
import { getPublicKey } from '@noble/secp256k1'

export interface CosmosAddressResult {
  path: string
  address: string
  pubHex: string
  privHex: string
}

export interface CosmosAddressConfig {
  hrp: string
  coinType: number
  decimals: number
  nativeDenom: string
  feeDenom: string
  feeAmountRaw: string
  gasLimit: string
  symbol: string
  envPrefix: string
}

const CRO_COIN_TYPE = 394
const CRO_HRP = 'cro'
const CRO_DECIMALS = 8
const COSMOS_COIN_TYPE = 118
const COSMOS_HRP = 'cosmos'
const COSMOS_DECIMALS = 6

const CRO_CONFIG: CosmosAddressConfig = {
  hrp: CRO_HRP,
  coinType: CRO_COIN_TYPE,
  decimals: CRO_DECIMALS,
  nativeDenom: 'basecro',
  feeDenom: 'basecro',
  feeAmountRaw: '2500',
  gasLimit: '180000',
  symbol: 'CRO',
  envPrefix: 'CRO'
}

const COSMOS_CONFIG: CosmosAddressConfig = {
  hrp: COSMOS_HRP,
  coinType: COSMOS_COIN_TYPE,
  decimals: COSMOS_DECIMALS,
  nativeDenom: 'uatom',
  feeDenom: 'uatom',
  feeAmountRaw: '2500',
  gasLimit: '180000',
  symbol: 'ATOM',
  envPrefix: 'COSMOS'
}

const COSMOS_NETWORK_CONFIGS: Record<string, CosmosAddressConfig> = {
  atomone: {
    hrp: 'atone',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'uatone',
    feeDenom: 'uatone',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'ATONE',
    envPrefix: 'ATOMONE'
  },
  axelar: {
    hrp: 'axelar',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'uaxl',
    feeDenom: 'uaxl',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'AXL',
    envPrefix: 'AXELAR'
  },
  babylon: {
    hrp: 'bbn',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'ubbn',
    feeDenom: 'ubbn',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'BBN',
    envPrefix: 'BABYLON'
  },
  bitcanna: {
    hrp: 'bcna',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'ubcna',
    feeDenom: 'ubcna',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'BCNA',
    envPrefix: 'BITCANNA'
  },
  celestia: {
    hrp: 'celestia',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'utia',
    feeDenom: 'utia',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'TIA',
    envPrefix: 'CELESTIA'
  },
  chihuahua: {
    hrp: 'chihuahua',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'uhuahua',
    feeDenom: 'uhuahua',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'HUAHUA',
    envPrefix: 'CHIHUAHUA'
  },
  comdex: {
    hrp: 'comdex',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'ucmdx',
    feeDenom: 'ucmdx',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'CMDX',
    envPrefix: 'COMDEX'
  },
  coreum: {
    hrp: 'core',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'ucore',
    feeDenom: 'ucore',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'COREUM',
    envPrefix: 'COREUM'
  },
  cosmos: COSMOS_CONFIG,
  cro: CRO_CONFIG,
  'cronos-pos': CRO_CONFIG,
  evmos: {
    hrp: 'evmos',
    coinType: 60,
    decimals: 18,
    nativeDenom: 'aevmos',
    feeDenom: 'aevmos',
    feeAmountRaw: '500000000000000',
    gasLimit: '180000',
    symbol: 'EVMOS',
    envPrefix: 'EVMOS'
  },
  injective: {
    hrp: 'inj',
    coinType: 60,
    decimals: 18,
    nativeDenom: 'inj',
    feeDenom: 'inj',
    feeAmountRaw: '500000000000000',
    gasLimit: '180000',
    symbol: 'INJ',
    envPrefix: 'INJECTIVE'
  },
  juno: {
    hrp: 'juno',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'ujuno',
    feeDenom: 'ujuno',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'JUNO',
    envPrefix: 'JUNO'
  },
  kujira: {
    hrp: 'kujira',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'ukuji',
    feeDenom: 'ukuji',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'KUJI',
    envPrefix: 'KUJIRA'
  },
  neutron: {
    hrp: 'neutron',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'untrn',
    feeDenom: 'untrn',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'NTRN',
    envPrefix: 'NEUTRON'
  },
  osmosis: {
    hrp: 'osmo',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'uosmo',
    feeDenom: 'uosmo',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'OSMO',
    envPrefix: 'OSMOSIS'
  },
  persistence: {
    hrp: 'persistence',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'uxprt',
    feeDenom: 'uxprt',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'XPRT',
    envPrefix: 'PERSISTENCE'
  },
  quicksilver: {
    hrp: 'quick',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'uqck',
    feeDenom: 'uqck',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'QCK',
    envPrefix: 'QUICKSILVER'
  },
  regen: {
    hrp: 'regen',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'uregen',
    feeDenom: 'uregen',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'REGEN',
    envPrefix: 'REGEN'
  },
  sei: {
    hrp: 'sei',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'usei',
    feeDenom: 'usei',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'SEI',
    envPrefix: 'SEI'
  },
  stargaze: {
    hrp: 'stars',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'ustars',
    feeDenom: 'ustars',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'STARS',
    envPrefix: 'STARGAZE'
  },
  stride: {
    hrp: 'stride',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'ustrd',
    feeDenom: 'ustrd',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'STRD',
    envPrefix: 'STRIDE'
  },
  terra: {
    hrp: 'terra',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'uluna',
    feeDenom: 'uluna',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'LUNA',
    envPrefix: 'TERRA'
  },
  'terra-classic': {
    hrp: 'terra',
    coinType: COSMOS_COIN_TYPE,
    decimals: 6,
    nativeDenom: 'uluna',
    feeDenom: 'uluna',
    feeAmountRaw: '2500',
    gasLimit: '180000',
    symbol: 'LUNC',
    envPrefix: 'TERRA_CLASSIC'
  }
}

function normalizeCosmosConfigKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^cosmos--/, '')
    .replace(/^cro--/, '')
}

function getEnvOverride(config: CosmosAddressConfig): Partial<CosmosAddressConfig> {
  const env = (import.meta as any)?.env || {}
  const prefix = String(config.envPrefix || '').trim()
  if (!prefix) return {}

  const out: Partial<CosmosAddressConfig> = {}
  const coinTypeRaw = String(env[`VITE_${prefix}_COIN_TYPE`] ?? '').trim()
  const decimalsRaw = String(env[`VITE_${prefix}_DECIMALS`] ?? '').trim()
  const nativeDenom = String(env[`VITE_${prefix}_NATIVE_DENOM`] ?? '').trim()
  const feeDenom = String(env[`VITE_${prefix}_FEE_DENOM`] ?? '').trim()
  const feeAmountRaw = String(env[`VITE_${prefix}_FEE_AMOUNT_RAW`] ?? '').trim()
  const gasLimit = String(env[`VITE_${prefix}_GAS_LIMIT`] ?? '').trim()
  const hrp = String(env[`VITE_${prefix}_HRP`] ?? '').trim()
  const symbol = String(env[`VITE_${prefix}_SYMBOL`] ?? '').trim()
  const coinType = coinTypeRaw ? Number(coinTypeRaw) : NaN
  const decimals = decimalsRaw ? Number(decimalsRaw) : NaN

  if (hrp) out.hrp = hrp
  if (Number.isInteger(coinType) && coinType > 0) out.coinType = coinType
  if (Number.isInteger(decimals) && decimals >= 0) out.decimals = decimals
  if (nativeDenom) out.nativeDenom = nativeDenom
  if (feeDenom) out.feeDenom = feeDenom
  if (feeAmountRaw) out.feeAmountRaw = feeAmountRaw
  if (gasLimit) out.gasLimit = gasLimit
  if (symbol) out.symbol = symbol
  return out
}

function toCosmosAddress(hrp: string, compressedPubKey: Uint8Array): string {
  const sha = sha256(compressedPubKey)
  const hash160 = ripemd160(sha)
  return bech32.encode(hrp, bech32.toWords(hash160))
}

export async function deriveCosmosAddress(
  mnemonic: string,
  accountIndex = 0,
  opts?: { hrp?: string; coinType?: number }
): Promise<CosmosAddressResult> {
  const hrp = String(opts?.hrp || CRO_HRP).trim() || CRO_HRP
  const coinType = Number.isInteger(opts?.coinType) ? Number(opts?.coinType) : CRO_COIN_TYPE
  const path = `m/44'/${coinType}'/${accountIndex}'/0/0`
  const seed = mnemonicToSeedSync(mnemonic.trim())
  const root = HDKey.fromMasterSeed(seed)
  const child = root.derive(path)
  if (!child.privateKey) throw new Error('Failed to derive Cosmos private key')
  const compressedPub = getPublicKey(child.privateKey, true)
  const address = toCosmosAddress(hrp, compressedPub)
  return {
    path,
    address,
    pubHex: bytesToHex(compressedPub),
    privHex: bytesToHex(child.privateKey)
  }
}

export function resolveCosmosAddressConfig(input?: {
  runtimeModelId?: string
  serverCoinId?: string
  id?: string
} | null): CosmosAddressConfig {
  const modelId = String(input?.runtimeModelId || '').trim().toLowerCase()
  const serverCoinId = String(input?.serverCoinId || '').trim().toLowerCase()
  const networkId = String(input?.id || '').trim().toLowerCase()
  const candidates = [
    normalizeCosmosConfigKey(serverCoinId),
    normalizeCosmosConfigKey(networkId),
    normalizeCosmosConfigKey(modelId)
  ].filter(Boolean)

  let resolved = COSMOS_CONFIG
  for (const candidate of candidates) {
    const match = COSMOS_NETWORK_CONFIGS[candidate]
    if (match) {
      resolved = match
      break
    }
  }

  return {
    ...resolved,
    ...getEnvOverride(resolved)
  }
}

export function isCosmosAddressForHrp(value: string, hrp: string): boolean {
  const input = String(value || '').trim()
  const expectedHrp = String(hrp || '').trim().toLowerCase()
  if (!input || !expectedHrp) return false
  try {
    const decoded = bech32.decode(input as `${string}1${string}`)
    return decoded.prefix === expectedHrp && decoded.words.length > 0
  } catch {
    return false
  }
}

export function isCroCosmosAddress(value: string): boolean {
  return isCosmosAddressForHrp(value, CRO_HRP)
}
