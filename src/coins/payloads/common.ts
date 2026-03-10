import type {
  CoinChain,
  CoinPayloadCatalog,
  CoinPayloadBuilders,
  UtxoTxInputRef
} from './types'

function envelope(method: string, params: unknown[], id = 'metayoshi'): {
  jsonrpc: '1.0'
  id: string
  method: string
  params: unknown[]
} {
  return { jsonrpc: '1.0', id, method, params }
}

/** Factory for UTXO-style bridge payloads.
 *  Most supported coins share the same RPC payload structure. */
export function createUtxoPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
}): CoinPayloadCatalog {
  const builders: CoinPayloadBuilders = {
    getBlockchainInfo: (id = 'metayoshi') => envelope('getblockchaininfo', [], id),
    getWalletInfo: (id = 'metayoshi') => envelope('getwalletinfo', [], id),
    validateAddress: (address: string, id = 'metayoshi') => envelope('validateaddress', [address], id),
    listUnspent: (address?: string, minConf = 1, maxConf = 9999999, id = 'metayoshi') => {
      const params: unknown[] = [minConf, maxConf]
      if (address) params.push([address])
      return envelope('listunspent', params, id)
    },
    scanTxOutSet: (address: string, id = 'metayoshi') => envelope('scantxoutset', ['start', [`addr(${address})`]], id),
    createRawTransaction: (inputs: UtxoTxInputRef[], outputs: Record<string, number>, id = 'metayoshi') =>
      envelope('createrawtransaction', [inputs, outputs], id),
    sendRawTransaction: (hex: string, id = 'metayoshi') => envelope('sendrawtransaction', [hex], id),
    sendAsset: (
      assetId: string,
      qty: number,
      toAddress: string,
      changeAddress = '',
      assetChangeAddress = '',
      id = 'metayoshi'
    ) => envelope('sendasset', [assetId, qty, toAddress, changeAddress, assetChangeAddress], id)
  }

  return {
    ...input,
    builders,
    helperExamples: {
      sendCoin: {
        to: 'RXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        amount: 0.1,
        subtractFeeFromAmount: false
      },
      sendAsset: {
        assetId: 'ROOT|SUB',
        qty: 1,
        toAddress: 'RXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        changeAddress: '',
        assetChangeAddress: ''
      }
    }
  }
}

export type ScaffoldPayloadModel = 'evm' | 'sol' | 'cosmos' | 'utxo'

function modelHelperSendCoin(model: ScaffoldPayloadModel) {
  if (model === 'evm') {
    return {
      to: '0x1111111111111111111111111111111111111111',
      amount: 0.01,
      subtractFeeFromAmount: false
    }
  }
  if (model === 'sol') {
    return {
      to: 'So11111111111111111111111111111111111111112',
      amount: 0.01,
      subtractFeeFromAmount: false
    }
  }
  if (model === 'cosmos') {
    return {
      to: 'cosmos1skjwj5whet0l6v8j6r8f8v9h99h4m9es7r5s9h',
      amount: 0.1,
      subtractFeeFromAmount: false
    }
  }
  return {
    to: 'RXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    amount: 0.1,
    subtractFeeFromAmount: false
  }
}

function modelHelperSendAsset(model: ScaffoldPayloadModel) {
  if (model === 'evm') {
    return {
      assetId: '0x0000000000000000000000000000000000000000',
      qty: 1,
      toAddress: '0x1111111111111111111111111111111111111111',
      changeAddress: '',
      assetChangeAddress: ''
    }
  }
  if (model === 'sol') {
    return {
      assetId: 'So11111111111111111111111111111111111111112',
      qty: 1,
      toAddress: 'So11111111111111111111111111111111111111112',
      changeAddress: '',
      assetChangeAddress: ''
    }
  }
  if (model === 'cosmos') {
    return {
      assetId: 'ibc/0000000000000000000000000000000000000000000000000000000000000000',
      qty: 1,
      toAddress: 'cosmos1skjwj5whet0l6v8j6r8f8v9h99h4m9es7r5s9h',
      changeAddress: '',
      assetChangeAddress: ''
    }
  }
  return {
    assetId: 'ROOT|SUB',
    qty: 1,
    toAddress: 'RXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    changeAddress: '',
    assetChangeAddress: ''
  }
}

/** Model-aware scaffold payload catalog.
 *  Keeps transport-compatible payload builders while adapting helper examples
 *  to the chain family used by the scaffolded coin. */
export function createModelPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
  model: ScaffoldPayloadModel
}): CoinPayloadCatalog {
  const base = createUtxoPayloadCatalog({
    networkId: input.networkId,
    symbol: input.symbol,
    coinId: input.coinId,
    chain: input.chain
  })
  return {
    ...base,
    helperExamples: {
      sendCoin: modelHelperSendCoin(input.model),
      sendAsset: modelHelperSendAsset(input.model)
    }
  }
}

