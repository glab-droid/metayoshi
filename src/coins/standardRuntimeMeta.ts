export type StandardRuntimeMeta = {
  symbol: string
  coinId: string
  chain?: 'main' | 'test'
}

export const STANDARD_RUNTIME_META: Record<string, StandardRuntimeMeta> = {
  rtm: { symbol: 'RTM', coinId: 'raptoreum' },
  'srv--bitcoin': { symbol: 'BTC', coinId: 'bitcoin' },
  dash: { symbol: 'DASH', coinId: 'dash' },
  btcz: { symbol: 'BTCZ', coinId: 'bitcoinz' },
  firo: { symbol: 'FIRO', coinId: 'firo' },
  doge: { symbol: 'DOGE', coinId: 'dogecoin' },
  cosmos: { symbol: 'ATOM', coinId: 'cosmos' },
  cronos: { symbol: 'CRO', coinId: 'cronos' },
  eth: { symbol: 'ETH', coinId: 'ethereum' },
  arb: { symbol: 'ETH', coinId: 'arbitrum-one' },
  op: { symbol: 'ETH', coinId: 'optimism' },
  base: { symbol: 'ETH', coinId: 'base' },
  bnb: { symbol: 'BNB', coinId: 'bsc' },
  polygon: { symbol: 'MATIC', coinId: 'polygon-bor' },
  avaxc: { symbol: 'AVAX', coinId: 'avalanche-c-chain' },
  sol: { symbol: 'SOL', coinId: 'solana' },
  ada: { symbol: 'ADA', coinId: 'cardano' },
  sui: { symbol: 'SUI', coinId: 'sui' },
  tron: { symbol: 'TRX', coinId: 'tron' },
  xlm: { symbol: 'XLM', coinId: 'stellar' }
}
