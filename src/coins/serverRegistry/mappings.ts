import { SERVER_SCAFFOLD_SERVER_ID_TO_NETWORK_ID } from '../serverScaffoldCoins'

const TOKEN_MARKERS = new Set([
  'token',
  'erc20',
  'bep20',
  'trc20',
  'spl',
  'usdt',
  'usdc',
  'dai'
])

const TESTNET_ID_MARKERS = /(testnet|sepolia|hoodi|fuji|amoy|minato|blaze)/i
const BLOCKED_SERVER_COIN_IDS = new Set<string>([
  'manta-atlantic',
  'syscoin',
  'syscoin-evm',
  'syscoin-tanenbaum-evm'
])

const SERVER_COIN_TO_NETWORK_ID: Record<string, string> = {
  raptoreum: 'rtm',
  atomone: 'cosmos',
  axelar: 'cosmos',
  babylon: 'cosmos',
  bitcanna: 'cosmos',
  dogecoin: 'doge',
  dash: 'dash',
  bitcoin: 'srv--bitcoin',
  bitcoinz: 'btcz',
  celestia: 'cosmos',
  chihuahua: 'cosmos',
  comdex: 'cosmos',
  cosmos: 'cosmos',
  coreum: 'cosmos',
  evmos: 'cosmos',
  injective: 'cosmos',
  juno: 'cosmos',
  kujira: 'cosmos',
  neutron: 'cosmos',
  osmosis: 'cosmos',
  persistence: 'cosmos',
  quicksilver: 'cosmos',
  regen: 'cosmos',
  sei: 'cosmos',
  stargaze: 'cosmos',
  stride: 'cosmos',
  terra: 'cosmos',
  'terra-classic': 'cosmos',
  tidecoin: 'tide',
  firo: 'firo',
  xrp: 'xrp',
  arr: 'arr',
  cardano: 'ada',
  monero: 'xmr',
  stellar: 'xlm',
  xlm: 'xlm',
  ethereum: 'eth',
  'arbitrum-one': 'arb',
  'arbitrum-nova': 'arb',
  optimism: 'op',
  base: 'base',
  bsc: 'bnb',
  'polygon-bor': 'polygon',
  polygon: 'polygon',
  'avalanche-c-chain': 'avaxc',
  solana: 'sol',
  sui: 'sui',
  tron: 'tron',
  blast: 'eth',
  berachain: 'eth',
  celo: 'eth',
  cronos: 'cronos',
  'cronos-evm': 'cronos',
  'zksync-era': 'zksync',
  fraxtal: 'eth',
  haqq: 'eth',
  mantle: 'eth',
  moonbeam: 'eth',
  moonriver: 'eth',
  'cronos-pos': 'cro',
  avail: 'eth',
  peaq: 'eth',
  'syscoin-tanenbaum-evm': 'eth',
  pulsechain: 'eth',
  scroll: 'eth',
  somnia: 'eth',
  soneium: 'eth',
  sonic: 'eth',
  taiko: 'eth',
  unichain: 'eth',
  'tron-evm': 'eth'
}

const SERVER_SYMBOL_OVERRIDES: Record<string, string> = {
  bitcoin: 'BTC',
  'bitcoin-testnet': 'BTC'
}

const FORCE_DOGE_UTXO_COMPAT_IDS = new Set([
  'bitcoin'
])

const FORCE_AVAXC_COMPAT_IDS = new Set([
  'avalanche-p-chain',
  'avalanche-x-chain'
])

const FORCE_POLYGON_COMPAT_IDS = new Set([
  'polygon-heimdall'
])

const FORCE_ETH_COMPAT_IDS = new Set([
  '0g',
  '0g-beacon',
  'akash',
  'analog',
  'asset-mantle',
  'atomone',
  'axelar',
  'babylon',
  'bitcanna',
  'bitway',
  'celer',
  'celestia',
  'cheqd',
  'chihuahua',
  'chiliz',
  'chiliz-spicy',
  'comdex',
  'coreum',
  'cosmos',
  'dora',
  'dydx',
  'elys',
  'fetch',
  'injective',
  'juno',
  'kujira',
  'kusama',
  'lava',
  'lumera',
  'manta-atlantic',
  'medibloc',
  'neutron',
  'nolus',
  'oraichain',
  'osmosis',
  'passage',
  'persistence',
  'polkadot',
  'quicksilver',
  'rebus',
  'regen',
  'rizon',
  'saga',
  'sentinel',
  'shentu',
  'sifchain',
  'stargaze',
  'stride',
  'teritori',
  'terra',
  'terra-classic'
])

const ETHEREUM_L2_SERVER_COIN_IDS = new Set<string>([
  'arbitrum-one',
  'arbitrum-nova',
  'base',
  'blast',
  'fraxtal',
  'linea',
  'mantle',
  'metis',
  'optimism',
  'scroll',
  'soneium',
  'taiko',
  'unichain',
  'zksync-era'
])

const SERVER_COIN_VARIANT_SUFFIXES = [
  'testnet',
  'sepolia',
  'holesky',
  'hoodi',
  'fuji',
  'amoy',
  'minato',
  'blaze',
  'spicy',
  'tanenbaum'
]

export const EVM_MODEL_NETWORK_IDS = new Set(['eth', 'arb', 'op', 'base', 'bnb', 'polygon', 'avaxc', 'cronos', 'zksync'])
export const COSMOS_MODEL_NETWORK_IDS = new Set(['cosmos', 'cro'])

export function isBlockedServerCoinId(coinId: string): boolean {
  const normalized = String(coinId || '').trim().toLowerCase()
  if (!normalized) return false
  return BLOCKED_SERVER_COIN_IDS.has(normalized) || TESTNET_ID_MARKERS.test(normalized)
}

export function isLikelyTokenServerCoinLike(coinId: string, name: string, symbol: string): boolean {
  const normalizedCoinId = String(coinId || '').trim().toLowerCase()
  const haystack = `${normalizedCoinId} ${String(name || '').trim().toLowerCase()} ${String(symbol || '').trim().toLowerCase()}`
  if (/^0x[0-9a-f]{40}$/i.test(normalizedCoinId)) return true
  if (normalizedCoinId.includes('/token/') || normalizedCoinId.includes('-token-') || normalizedCoinId.endsWith('-token')) return true
  if (normalizedCoinId.includes('contract')) return true
  for (const marker of TOKEN_MARKERS) {
    if (haystack.includes(marker)) return true
  }
  return false
}

export function mapServerCoinIdToNetworkId(coinId: string): string | null {
  const normalized = String(coinId || '').trim().toLowerCase()
  if (normalized === 'btc') return 'srv--bitcoin'
  const direct = SERVER_COIN_TO_NETWORK_ID[normalized]
  if (direct) return direct
  const scaffoldMapped = SERVER_SCAFFOLD_SERVER_ID_TO_NETWORK_ID[normalized]
  if (scaffoldMapped) return scaffoldMapped
  if (normalized === 'ethereum-holesky') return 'eth'
  if (normalized === 'opbnb' || normalized.startsWith('opbnb-')) return 'bnb'
  if (normalized === 'bsc') return 'bnb'
  if (normalized === 'optimism' || normalized.startsWith('optimism-')) return 'op'
  if (normalized === 'polygon' || normalized === 'polygon-bor') return 'polygon'
  if (normalized === 'sui') return 'sui'
  if (normalized.startsWith('avalanche-') && normalized.includes('c-chain')) return 'avaxc'
  if (normalized === 'solana') return 'sol'
  if (normalized === 'tron') return 'tron'
  if (normalized === 'tron-evm') return 'eth'
  if (normalized === 'blast' || normalized.startsWith('blast-')) return 'eth'
  if (normalized === 'berachain' || normalized.startsWith('berachain-')) return 'eth'
  if (normalized === 'celo' || normalized.startsWith('celo-')) return 'eth'
  if (normalized === 'cronos-pos' || normalized.startsWith('cronos-pos')) return 'cro'
  if (normalized === 'cronos' || normalized === 'cronos-evm' || normalized.startsWith('cronos-evm')) return 'cronos'
  if (normalized === 'zksync' || normalized === 'zksync-era' || normalized.startsWith('zksync-era-')) return 'zksync'
  if (normalized === 'fraxtal' || normalized.startsWith('fraxtal-')) return 'eth'
  if (normalized === 'haqq' || normalized.startsWith('haqq-')) return 'eth'
  if (normalized === 'linea') return 'eth'
  if (normalized === 'mantle' || normalized.startsWith('mantle-')) return 'eth'
  if (normalized === 'metis') return 'eth'
  if (normalized === 'moonbeam' || normalized.startsWith('moonbeam-')) return 'eth'
  if (normalized === 'moonriver' || normalized.startsWith('moonriver-')) return 'eth'
  if (normalized === 'pulsechain' || normalized.startsWith('pulsechain-')) return 'eth'
  if (normalized === 'scroll' || normalized.startsWith('scroll-')) return 'eth'
  if (normalized === 'somnia' || normalized.startsWith('somnia-')) return 'eth'
  if (normalized === 'taiko') return 'eth'
  if (normalized === 'unichain') return 'base'
  if (normalized === 'soneium' || normalized.startsWith('soneium-')) return 'eth'
  if (normalized === 'sonic' || normalized.startsWith('sonic-')) return 'eth'
  if (normalized === 'evmos' || normalized.startsWith('evmos-')) return 'eth'
  if (normalized === 'dymension' || normalized.startsWith('dymension-')) return 'eth'
  if (normalized === 'kava' || normalized.startsWith('kava-')) return 'eth'
  if (normalized === 'iris' || normalized.startsWith('iris-')) return 'eth'
  if (normalized === 'nibiru' || normalized.startsWith('nibiru-')) return 'eth'
  if (normalized === 'tenet' || normalized.startsWith('tenet-')) return 'eth'
  if (normalized === 'xpla' || normalized.startsWith('xpla-')) return 'eth'
  if (normalized === 'warden' || normalized.startsWith('warden-')) return 'eth'
  if (normalized === 'syscoin-evm' || normalized.startsWith('syscoin-')) return 'eth'
  if (normalized === 'xpla-evm' || normalized.startsWith('xpla-evm')) return 'eth'
  if (normalized === 'sei-evm' || normalized.startsWith('sei-evm')) return 'eth'
  if (normalized === 'nibiru-evm' || normalized.startsWith('nibiru-evm')) return 'eth'
  if (normalized === 'haqq-evm' || normalized.startsWith('haqq-evm')) return 'eth'
  if (normalized === 'iris-evm' || normalized.startsWith('iris-evm')) return 'eth'
  if (normalized === 'kava-evm' || normalized.startsWith('kava-evm')) return 'eth'
  if (normalized === 'tenet-evm' || normalized.startsWith('tenet-evm')) return 'eth'
  if (normalized === 'dymension-evm' || normalized.startsWith('dymension-evm')) return 'eth'
  if (normalized === 'evmos-evm' || normalized.startsWith('evmos-evm')) return 'eth'
  if (normalized === 'warden-evm' || normalized.startsWith('warden-evm')) return 'eth'
  if (FORCE_DOGE_UTXO_COMPAT_IDS.has(normalized)) return 'doge'
  if (FORCE_AVAXC_COMPAT_IDS.has(normalized)) return 'avaxc'
  if (FORCE_POLYGON_COMPAT_IDS.has(normalized)) return 'polygon'
  if (FORCE_ETH_COMPAT_IDS.has(normalized)) return 'eth'
  return null
}

export function sanitizeServerCoinId(coinId: string): string {
  return String(coinId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function stripServerCoinVariantSuffix(coinId: string): string {
  const normalized = String(coinId || '').trim().toLowerCase()
  if (!normalized) return ''
  for (const suffix of SERVER_COIN_VARIANT_SUFFIXES) {
    const token = `-${suffix}`
    if (normalized.endsWith(token)) return normalized.slice(0, -token.length)
  }
  return normalized
}

function isEthereumLayer2ServerCoinId(coinId: string): boolean {
  const baseId = stripServerCoinVariantSuffix(coinId)
  return ETHEREUM_L2_SERVER_COIN_IDS.has(baseId)
}

export function normalizeServerCoinSymbol(coinId: string, symbol: string, fallback?: string): string {
  const normalizedCoinId = String(coinId || '').trim().toLowerCase()
  const override = SERVER_SYMBOL_OVERRIDES[normalizedCoinId]
  if (override) return override
  const normalized = String(symbol || '').trim().toUpperCase()
  if (normalized) return normalized
  return String(fallback || '').trim().toUpperCase()
}

export function resolveAppNetworkId(baseNetworkId: string, serverCoinId: string): string {
  const normalizedBaseNetworkId = String(baseNetworkId || '').trim().toLowerCase()
  const normalizedServerCoinId = stripServerCoinVariantSuffix(serverCoinId)
  if (normalizedBaseNetworkId.startsWith('srv--')) {
    const parts = normalizedBaseNetworkId.split('--')
    if (parts.length >= 2 && parts[1]) return `srv--${parts[1]}`
    return normalizedBaseNetworkId
  }
  if (EVM_MODEL_NETWORK_IDS.has(normalizedBaseNetworkId)) {
    const canonicalServerIdByModel: Record<string, string> = {
      eth: 'ethereum',
      arb: 'arbitrum-one',
      op: 'optimism',
      base: 'base',
      bnb: 'bsc',
      cronos: 'cronos',
      polygon: 'polygon-bor',
      avaxc: 'avalanche-c-chain',
      zksync: 'zksync-era'
    }

    const canonicalServerId = canonicalServerIdByModel[normalizedBaseNetworkId]
    if (canonicalServerId && normalizedServerCoinId === canonicalServerId) {
      return normalizedBaseNetworkId
    }
    if (isEthereumLayer2ServerCoinId(normalizedServerCoinId)) {
      return `eth-l2--${sanitizeServerCoinId(normalizedServerCoinId)}`
    }
    return `${normalizedBaseNetworkId}--${sanitizeServerCoinId(normalizedServerCoinId)}`
  }
  if (COSMOS_MODEL_NETWORK_IDS.has(normalizedBaseNetworkId)) {
    const canonicalServerIdByModel: Record<string, string> = {
      cosmos: 'cosmos',
      cro: 'cronos-pos'
    }
    if (normalizedServerCoinId === canonicalServerIdByModel[normalizedBaseNetworkId]) {
      return normalizedBaseNetworkId
    }
    return `${normalizedBaseNetworkId}--${sanitizeServerCoinId(normalizedServerCoinId)}`
  }
  return normalizedBaseNetworkId
}

export function validateEthereumLayer2NetworkIdMapping(): void {
  const seen = new Map<string, string>()
  for (const serverCoinId of ETHEREUM_L2_SERVER_COIN_IDS) {
    const model = mapServerCoinIdToNetworkId(serverCoinId) || 'eth'
    const appNetworkId = resolveAppNetworkId(model, serverCoinId)
    const existing = seen.get(appNetworkId)
    if (existing && existing !== serverCoinId) {
      throw new Error(
        `Duplicate appNetworkId "${appNetworkId}" for Ethereum L2 server coin IDs: "${existing}" and "${serverCoinId}".`
      )
    }
    seen.set(appNetworkId, serverCoinId)
  }
}

export function inferRuntimeModelFromTokenLikeCoinId(coinId: string): string | null {
  const normalized = String(coinId || '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized.includes('arbitrum')) return 'arb'
  if (normalized.includes('optimism')) return 'op'
  if (normalized.includes('polygon')) return 'polygon'
  if (normalized.includes('avalanche')) return 'avaxc'
  if (normalized.includes('base')) return 'base'
  if (normalized.includes('bsc') || normalized.includes('bnb')) return 'bnb'
  if (normalized.includes('cronos')) return 'cronos'
  if (normalized.includes('zksync')) return 'zksync'
  if (normalized.includes('sui')) return 'sui'
  if (normalized.includes('ethereum') || normalized.includes('eth')) return 'eth'
  if (normalized.includes('solana') || normalized.includes('spl')) return 'sol'
  if (normalized.includes('tron') || normalized.includes('trc20')) return 'tron'
  return null
}
