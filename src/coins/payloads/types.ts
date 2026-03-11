import type { CoinProtocolFamily } from '../registryTypes'

export type CoinChain = 'main' | 'test'

export interface JsonRpcEnvelope {
  jsonrpc: '1.0' | '2.0'
  id: string
  method: string
  params: unknown[]
}

export interface RestEnvelope {
  transport: 'rest'
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, string | number | boolean>
  body?: unknown
}

export interface UtxoTxInputRef {
  txid: string
  vout: number
}

interface CoinPayloadCatalogBase<TFamily extends CoinProtocolFamily, TBuilders, TExamples> {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
  family: TFamily
  builders: TBuilders
  helperExamples: TExamples
}

export interface UtxoPayloadBuilders {
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

export interface UtxoPayloadExamples {
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

export interface EvmPayloadBuilders {
  chainId: () => JsonRpcEnvelope
  getBalance: (address: string, blockTag?: string, id?: string) => JsonRpcEnvelope
  getTransactionCount: (address: string, blockTag?: string, id?: string) => JsonRpcEnvelope
  estimateGas: (tx: Record<string, unknown>, id?: string) => JsonRpcEnvelope
  sendRawTransaction: (signedTxHex: string, id?: string) => JsonRpcEnvelope
  call: (tx: Record<string, unknown>, blockTag?: string, id?: string) => JsonRpcEnvelope
}

export interface EvmPayloadExamples {
  sendTransaction: {
    to: string
    value: string
    data?: string
  }
  signMessage: {
    message: string
    encoding: 'utf8' | 'hex'
  }
  signTypedData: {
    typedData: Record<string, unknown>
  }
}

export interface SolanaPayloadBuilders {
  getBalance: (address: string, id?: string) => JsonRpcEnvelope
  getLatestBlockhash: (id?: string) => JsonRpcEnvelope
  getAccountInfo: (address: string, id?: string) => JsonRpcEnvelope
  simulateTransaction: (serializedTxBase64: string, id?: string) => JsonRpcEnvelope
  sendTransaction: (serializedTxBase64: string, id?: string) => JsonRpcEnvelope
}

export interface SolanaPayloadExamples {
  signMessage: {
    messageBase64: string
  }
  signTransaction: {
    serializedTxBase64: string
  }
  signAndSendTransaction: {
    serializedTxBase64: string
  }
}

export interface CosmosPayloadBuilders {
  status: () => RestEnvelope
  account: (address: string) => RestEnvelope
  balances: (address: string) => RestEnvelope
  simulate: (txBytesBase64: string) => RestEnvelope
  broadcast: (txBytesBase64: string, mode?: 'BROADCAST_MODE_SYNC' | 'BROADCAST_MODE_ASYNC' | 'BROADCAST_MODE_BLOCK') => RestEnvelope
}

export interface CosmosPayloadExamples {
  signDirect: {
    chainId: string
    signerAddress: string
    signDoc: Record<string, unknown>
  }
  signAmino: {
    chainId: string
    signerAddress: string
    signDoc: Record<string, unknown>
  }
  sendTx: {
    txBytesBase64: string
    mode: 'BROADCAST_MODE_SYNC'
  }
}

export interface TronPayloadBuilders {
  getAccount: (address: string) => RestEnvelope
  getNowBlock: () => RestEnvelope
  createTransferTransaction: (ownerAddress: string, toAddress: string, amountSun: number) => RestEnvelope
  broadcastTransaction: (signedTransaction: Record<string, unknown>) => RestEnvelope
}

export interface TronPayloadExamples {
  sendTransaction: {
    to: string
    amountTrx: string
  }
  sendAsset: {
    contractAddress: string
    to: string
    amountRaw: string
  }
}

export interface CardanoPayloadBuilders {
  constructTransaction: (payload: {
    walletId?: string
    fromAddress: string
    toAddress: string
    amountLovelace: number
    changeAddress: string
    assets?: Array<{ policyId: string; assetName: string; quantity: string }>
  }) => RestEnvelope
  submitTransaction: (payload: { walletId?: string; signedTxCborHex: string }) => RestEnvelope
}

export interface CardanoPayloadExamples {
  signTransaction: {
    unsignedTxCborHex: string
    partialSign: boolean
  }
  submitTransaction: {
    signedTxCborHex: string
  }
}

export interface SuiPayloadBuilders {
  getBalance: (address: string, coinType?: string, id?: string) => JsonRpcEnvelope
  getAllBalances: (address: string, id?: string) => JsonRpcEnvelope
  dryRunTransactionBlock: (txBytesBase64: string, id?: string) => JsonRpcEnvelope
  executeTransactionBlock: (signedTxBytesBase64: string, signatureBase64: string, id?: string) => JsonRpcEnvelope
}

export interface SuiPayloadExamples {
  signTransaction: {
    txBytesBase64: string
  }
  executeTransaction: {
    txBytesBase64: string
    signatureBase64: string
  }
}

export interface StellarPayloadBuilders {
  getAccount: (address: string) => RestEnvelope
  submitTransaction: (txEnvelopeXdrBase64: string) => RestEnvelope
}

export interface StellarPayloadExamples {
  submitTransaction: {
    txEnvelopeXdrBase64: string
  }
}

export interface GenericPayloadBuilders {
  ping: (id?: string) => JsonRpcEnvelope
}

export interface GenericPayloadExamples {
  request: {
    method: string
    params: unknown[]
  }
}

export type UtxoPayloadCatalog = CoinPayloadCatalogBase<'utxo' | 'xrp' | 'monero', UtxoPayloadBuilders, UtxoPayloadExamples>
export type EvmPayloadCatalog = CoinPayloadCatalogBase<'evm', EvmPayloadBuilders, EvmPayloadExamples>
export type SolanaPayloadCatalog = CoinPayloadCatalogBase<'solana', SolanaPayloadBuilders, SolanaPayloadExamples>
export type CosmosPayloadCatalog = CoinPayloadCatalogBase<'cosmos', CosmosPayloadBuilders, CosmosPayloadExamples>
export type TronPayloadCatalog = CoinPayloadCatalogBase<'tron', TronPayloadBuilders, TronPayloadExamples>
export type CardanoPayloadCatalog = CoinPayloadCatalogBase<'cardano', CardanoPayloadBuilders, CardanoPayloadExamples>
export type SuiPayloadCatalog = CoinPayloadCatalogBase<'sui', SuiPayloadBuilders, SuiPayloadExamples>
export type StellarPayloadCatalog = CoinPayloadCatalogBase<'stellar', StellarPayloadBuilders, StellarPayloadExamples>
export type GenericPayloadCatalog = CoinPayloadCatalogBase<'generic', GenericPayloadBuilders, GenericPayloadExamples>

export type CoinPayloadCatalog =
  | UtxoPayloadCatalog
  | EvmPayloadCatalog
  | SolanaPayloadCatalog
  | CosmosPayloadCatalog
  | TronPayloadCatalog
  | CardanoPayloadCatalog
  | SuiPayloadCatalog
  | StellarPayloadCatalog
  | GenericPayloadCatalog
