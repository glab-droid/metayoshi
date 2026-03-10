import type {
  CoinApiInfo,
  CoinApiInterceptor,
  RpcInterceptorErrorContext,
  RpcInterceptorRequest
} from './types'

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error ?? 'Unknown error'))
}

function normalizeRequestUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '')
}

/** Creates a light-weight interceptor that keeps network-specific metadata together
 *  and applies consistent error prefixes for logs and UI surfaces. */
export function createCoinApiInterceptor(info: CoinApiInfo): CoinApiInterceptor {
  return {
    info,
    onRequest: (request: RpcInterceptorRequest): RpcInterceptorRequest => ({
      ...request,
      url: normalizeRequestUrl(request.url)
    }),
    onError: (ctx: RpcInterceptorErrorContext): Error => {
      const base = normalizeError(ctx.error)
      return new Error(`[${info.symbol}] ${base.message}`)
    }
  }
}

