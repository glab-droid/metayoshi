import type { CoinModule } from './types'

const ALL_SERVER_SCAFFOLD_COIN_MODULES: CoinModule[] = []

const ALL_SERVER_SCAFFOLD_SERVER_ID_TO_NETWORK_ID: Record<string, string> = {
  dash: 'dash',
  sdash: 'dash'
}

export const SERVER_SCAFFOLD_COIN_MODULES: CoinModule[] = [...ALL_SERVER_SCAFFOLD_COIN_MODULES]

export const SERVER_SCAFFOLD_SERVER_ID_TO_NETWORK_ID: Record<string, string> = {
  ...ALL_SERVER_SCAFFOLD_SERVER_ID_TO_NETWORK_ID
}
