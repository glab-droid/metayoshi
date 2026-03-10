export type CoinChain = 'main' | 'test'

export interface JsonRpcEnvelope {
  jsonrpc: '1.0'
  id: string
  method: string
  params: unknown[]
}

export interface UtxoTxInputRef {
  txid: string
  vout: number
}

export interface CoinPayloadBuilders {
  getBlockchainInfo: (id?: string) => JsonRpcEnvelope
  getWalletInfo: (id?: string) => JsonRpcEnvelope
  validateAddress: (address: string, id?: string) => JsonRpcEnvelope
  listUnspent: (address?: string, minConf?: number, maxConf?: number, id?: string) => JsonRpcEnvelope
  scanTxOutSet: (address: string, id?: string) => JsonRpcEnvelope
  createRawTransaction: (inputs: UtxoTxInputRef[], outputs: Record<string, number>, id?: string) => JsonRpcEnvelope
  sendRawTransaction: (hex: string, id?: string) => JsonRpcEnvelope
  sendAsset: (
    assetId: string,
    qty: number,
    toAddress: string,
    changeAddress?: string,
    assetChangeAddress?: string,
    id?: string
  ) => JsonRpcEnvelope
}

export interface CoinHelperPayloadExamples {
  sendCoin: {
    to: string
    amount: number
    subtractFeeFromAmount: boolean
  }
  sendAsset: {
    assetId: string
    qty: number
    toAddress: string
    changeAddress: string
    assetChangeAddress: string
  }
}

/** Per-coin payload contract.
 *  Keep this as the canonical payload map for app<->bridge calls. */
export interface CoinPayloadCatalog {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
  builders: CoinPayloadBuilders
  helperExamples: CoinHelperPayloadExamples
}

