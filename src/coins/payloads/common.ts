import type {
  CardanoPayloadCatalog,
  CoinChain,
  CosmosPayloadCatalog,
  EvmPayloadCatalog,
  GenericPayloadCatalog,
  SolanaPayloadCatalog,
  StellarPayloadCatalog,
  SuiPayloadCatalog,
  TronPayloadCatalog,
  UtxoPayloadCatalog,
  UtxoTxInputRef
} from './types'

function rpc(method: string, params: unknown[], id = 'metayoshi', jsonrpc: '1.0' | '2.0' = '2.0') {
  return { jsonrpc, id, method, params }
}

function rest(method: 'GET' | 'POST', path: string, body?: unknown, query?: Record<string, string | number | boolean>) {
  return { transport: 'rest' as const, method, path, body, query }
}

export function createUtxoPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
}): UtxoPayloadCatalog {
  return {
    ...input,
    family: 'utxo',
    builders: {
      getBlockchainInfo: (id = 'metayoshi') => rpc('getblockchaininfo', [], id, '1.0'),
      getWalletInfo: (id = 'metayoshi') => rpc('getwalletinfo', [], id, '1.0'),
      validateAddress: (address: string, id = 'metayoshi') => rpc('validateaddress', [address], id, '1.0'),
      listUnspent: (address?: string, minConf = 1, maxConf = 9999999, id = 'metayoshi') => {
        const params: unknown[] = [minConf, maxConf]
        if (address) params.push([address])
        return rpc('listunspent', params, id, '1.0')
      },
      scanTxOutSet: (address: string, id = 'metayoshi') => rpc('scantxoutset', ['start', [`addr(${address})`]], id, '1.0'),
      createRawTransaction: (inputs: UtxoTxInputRef[], outputs: Record<string, number>, id = 'metayoshi') =>
        rpc('createrawtransaction', [inputs, outputs], id, '1.0'),
      sendRawTransaction: (hex: string, id = 'metayoshi') => rpc('sendrawtransaction', [hex], id, '1.0'),
      sendAsset: (
        assetId: string,
        qty: number,
        toAddress: string,
        changeAddress = '',
        assetChangeAddress = '',
        id = 'metayoshi'
      ) => rpc('sendasset', [assetId, qty, toAddress, changeAddress, assetChangeAddress], id, '1.0')
    },
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

export function createEvmPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
  chainId?: number
}): EvmPayloadCatalog {
  return {
    ...input,
    family: 'evm',
    builders: {
      chainId: (id = 'metayoshi') => rpc('eth_chainId', [], id),
      getBalance: (address: string, blockTag = 'latest', id = 'metayoshi') => rpc('eth_getBalance', [address, blockTag], id),
      getTransactionCount: (address: string, blockTag = 'latest', id = 'metayoshi') =>
        rpc('eth_getTransactionCount', [address, blockTag], id),
      estimateGas: (tx: Record<string, unknown>, id = 'metayoshi') => rpc('eth_estimateGas', [tx], id),
      sendRawTransaction: (signedTxHex: string, id = 'metayoshi') => rpc('eth_sendRawTransaction', [signedTxHex], id),
      call: (tx: Record<string, unknown>, blockTag = 'latest', id = 'metayoshi') => rpc('eth_call', [tx, blockTag], id)
    },
    helperExamples: {
      sendTransaction: {
        to: '0x1111111111111111111111111111111111111111',
        value: '0x2386f26fc10000'
      },
      signMessage: {
        message: 'MetaYoshi',
        encoding: 'utf8'
      },
      signTypedData: {
        typedData: {
          domain: { name: 'MetaYoshi', version: '1', chainId: input.chainId ?? 1 },
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' }
            ],
            Mail: [{ name: 'contents', type: 'string' }]
          },
          primaryType: 'Mail',
          message: { contents: 'Hello from MetaYoshi' }
        }
      }
    }
  }
}

export function createSolanaPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
}): SolanaPayloadCatalog {
  return {
    ...input,
    family: 'solana',
    builders: {
      getBalance: (address: string, id = 'metayoshi') => rpc('getBalance', [address], id),
      getLatestBlockhash: (id = 'metayoshi') => rpc('getLatestBlockhash', [], id),
      getAccountInfo: (address: string, id = 'metayoshi') => rpc('getAccountInfo', [address], id),
      simulateTransaction: (serializedTxBase64: string, id = 'metayoshi') => rpc('simulateTransaction', [serializedTxBase64], id),
      sendTransaction: (serializedTxBase64: string, id = 'metayoshi') => rpc('sendTransaction', [serializedTxBase64], id)
    },
    helperExamples: {
      signMessage: {
        messageBase64: 'SGVsbG8gZnJvbSBNZXRhWW9zaGk='
      },
      signTransaction: {
        serializedTxBase64: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ=='
      },
      signAndSendTransaction: {
        serializedTxBase64: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ=='
      }
    }
  }
}

export function createCosmosPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
}): CosmosPayloadCatalog {
  return {
    ...input,
    family: 'cosmos',
    builders: {
      status: () => rest('GET', '/v1/status'),
      account: (address: string) => rest('GET', `/cosmos/auth/v1beta1/accounts/${encodeURIComponent(address)}`),
      balances: (address: string) => rest('GET', `/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`),
      simulate: (txBytesBase64: string) => rest('POST', '/cosmos/tx/v1beta1/simulate', { tx_bytes: txBytesBase64 }),
      broadcast: (txBytesBase64: string, mode = 'BROADCAST_MODE_SYNC') =>
        rest('POST', '/cosmos/tx/v1beta1/txs', { tx_bytes: txBytesBase64, mode })
    },
    helperExamples: {
      signDirect: {
        chainId: 'cosmoshub-4',
        signerAddress: 'cosmos1skjwj5whet0l6v8j6r8f8v9h99h4m9es7r5s9h',
        signDoc: {
          bodyBytes: 'Cg==',
          authInfoBytes: 'Cg==',
          accountNumber: '1'
        }
      },
      signAmino: {
        chainId: 'cosmoshub-4',
        signerAddress: 'cosmos1skjwj5whet0l6v8j6r8f8v9h99h4m9es7r5s9h',
        signDoc: {
          fee: { amount: [], gas: '200000' },
          msgs: [],
          memo: ''
        }
      },
      sendTx: {
        txBytesBase64: 'Cg==',
        mode: 'BROADCAST_MODE_SYNC'
      }
    }
  }
}

export function createTronPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
}): TronPayloadCatalog {
  return {
    ...input,
    family: 'tron',
    builders: {
      getAccount: (address: string) => rest('POST', '/wallet/getaccount', { address }),
      getNowBlock: () => rest('POST', '/wallet/getnowblock'),
      createTransferTransaction: (ownerAddress: string, toAddress: string, amountSun: number) =>
        rest('POST', '/wallet/createtransaction', {
          owner_address: ownerAddress,
          to_address: toAddress,
          amount: amountSun
        }),
      broadcastTransaction: (signedTransaction: Record<string, unknown>) =>
        rest('POST', '/wallet/broadcasttransaction', signedTransaction)
    },
    helperExamples: {
      sendTransaction: {
        to: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
        amountTrx: '1'
      },
      sendAsset: {
        contractAddress: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
        to: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
        amountRaw: '1000000'
      }
    }
  }
}

export function createCardanoPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
}): CardanoPayloadCatalog {
  return {
    ...input,
    family: 'cardano',
    builders: {
      constructTransaction: (payload) => rest('POST', `/v1/cardano/${input.chain}/tx/construct`, payload),
      submitTransaction: (payload) => rest('POST', `/v1/cardano/${input.chain}/tx/submit`, payload)
    },
    helperExamples: {
      signTransaction: {
        unsignedTxCborHex: '84a40081825820',
        partialSign: true
      },
      submitTransaction: {
        signedTxCborHex: '84a40081825820'
      }
    }
  }
}

export function createSuiPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
}): SuiPayloadCatalog {
  return {
    ...input,
    family: 'sui',
    builders: {
      getBalance: (address: string, coinType = '0x2::sui::SUI', id = 'metayoshi') => rpc('suix_getBalance', [address, coinType], id),
      getAllBalances: (address: string, id = 'metayoshi') => rpc('suix_getAllBalances', [address], id),
      dryRunTransactionBlock: (txBytesBase64: string, id = 'metayoshi') =>
        rpc('sui_dryRunTransactionBlock', [txBytesBase64], id),
      executeTransactionBlock: (signedTxBytesBase64: string, signatureBase64: string, id = 'metayoshi') =>
        rpc('sui_executeTransactionBlock', [signedTxBytesBase64, [signatureBase64]], id)
    },
    helperExamples: {
      signTransaction: {
        txBytesBase64: 'AA=='
      },
      executeTransaction: {
        txBytesBase64: 'AA==',
        signatureBase64: 'AA=='
      }
    }
  }
}

export function createStellarPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
}): StellarPayloadCatalog {
  return {
    ...input,
    family: 'stellar',
    builders: {
      getAccount: (address: string) => rest('GET', `/accounts/${encodeURIComponent(address)}`),
      submitTransaction: (txEnvelopeXdrBase64: string) =>
        rest('POST', '/transactions', undefined, { tx: txEnvelopeXdrBase64 })
    },
    helperExamples: {
      submitTransaction: {
        txEnvelopeXdrBase64: 'AAAAAgAAAAB'
      }
    }
  }
}

export function createGenericPayloadCatalog(input: {
  networkId: string
  symbol: string
  coinId: string
  chain: CoinChain
}): GenericPayloadCatalog {
  return {
    ...input,
    family: 'generic',
    builders: {
      ping: (id = 'metayoshi') => rpc('ping', [], id)
    },
    helperExamples: {
      request: {
        method: 'ping',
        params: []
      }
    }
  }
}
