import type { CoinApiInfo, CoinApiInterceptor } from './types'
import { dashApiInterceptor, DASH_API_INFO } from './dash'

type ServerScaffoldDefinition = {
  networkId: string
  apiInfo: CoinApiInfo
  interceptor: CoinApiInterceptor
}

const SERVER_SCAFFOLD_DEFINITIONS: ReadonlyArray<ServerScaffoldDefinition> = [
  {
    networkId: 'dash',
    apiInfo: DASH_API_INFO,
    interceptor: dashApiInterceptor
  }
]

export const SERVER_SCAFFOLD_API_INFO_BY_NETWORK_ID: Record<string, CoinApiInfo> = Object.fromEntries(
  SERVER_SCAFFOLD_DEFINITIONS.map((entry) => [entry.networkId, entry.apiInfo])
)

export const SERVER_SCAFFOLD_INTERCEPTOR_BY_NETWORK_ID: Record<string, CoinApiInterceptor> = Object.fromEntries(
  SERVER_SCAFFOLD_DEFINITIONS.map((entry) => [entry.networkId, entry.interceptor])
)
