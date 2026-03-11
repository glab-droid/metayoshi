import { adaCoin } from './ada'
import { arbCoin } from './arb'
import { avaxcCoin } from './avaxc'
import { baseCoin } from './base'
import { bnbCoin } from './bnb'
import { bnbTestnetCoin } from './bnbTestnet'
import { btcCoin } from './btc'
import { btczCoin } from './btcz'
import { cosmosCoin } from './cosmos'
import { croCoin } from './cro'
import { cronosCoin } from './cronos'
import { dashCoin } from './dash'
import { dogeCoin } from './doge'
import { ethCoin } from './eth'
import { firoCoin } from './firo'
import { opCoin } from './op'
import { polygonCoin } from './polygon'
import { rtmCoin } from './rtm'
import { solCoin } from './sol'
import { suiCoin } from './sui'
import { tronCoin } from './tron'
import { xlmCoin } from './xlm'
import { zksyncCoin } from './zksync'
import type { BundledCoinRegistryEntry } from './registryTypes'

export const BUNDLED_COIN_REGISTRY: BundledCoinRegistryEntry[] = [
  {
    manifest: {
      id: 'rtm',
      runtimeModelId: 'rtm',
      protocolFamily: 'utxo',
      coinId: 'raptoreum',
      chain: 'main',
      aliases: ['rtm', 'raptoreum'],
      testedByDefault: true,
      visibleByDefault: true
    },
    coin: rtmCoin
  },
  {
    manifest: {
      id: 'srv--bitcoin',
      runtimeModelId: 'srv--bitcoin',
      protocolFamily: 'utxo',
      coinId: 'bitcoin',
      chain: 'main',
      aliases: ['srv--bitcoin', 'srv--btc', 'btc', 'bitcoin'],
      visibleByDefault: true
    },
    coin: btcCoin
  },
  {
    manifest: {
      id: 'eth',
      runtimeModelId: 'eth',
      protocolFamily: 'evm',
      coinId: 'ethereum',
      chain: 'main',
      aliases: ['eth', 'ethereum', 'srv--ethereum', 'ethereum-mainnet', 'mainnet-ethereum'],
      chainId: 1,
      includeInEvmSet: true,
      testedByDefault: true,
      visibleByDefault: true
    },
    coin: ethCoin
  },
  {
    manifest: {
      id: 'bnb',
      runtimeModelId: 'bnb',
      protocolFamily: 'evm',
      coinId: 'bsc',
      chain: 'main',
      aliases: [
        'bnb',
        'bsc',
        'srv--bnb',
        'bnb-mainnet',
        'mainnet-bnb',
        'bsc-mainnet',
        'mainnet-bsc',
        'bnb-smart-chain',
        'binance-smart-chain',
        'bnb-smart-chain-mainnet',
        'binance-smart-chain-mainnet'
      ],
      chainId: 56,
      includeInEvmSet: true,
      testedByDefault: true,
      visibleByDefault: true
    },
    coin: bnbCoin
  },
  {
    manifest: {
      id: 'bnb-testnet',
      runtimeModelId: 'bnb',
      protocolFamily: 'evm',
      coinId: 'bsc-testnet',
      chain: 'test',
      aliases: [
        'bnb-testnet',
        'bnbt',
        'bsc-testnet',
        'chapel',
        'testnet-bnb',
        'bnb-smart-chain-testnet',
        'binance-smart-chain-testnet'
      ],
      chainId: 97,
      testedByDefault: true
    },
    coin: bnbTestnetCoin
  },
  {
    manifest: {
      id: 'arb',
      runtimeModelId: 'arb',
      protocolFamily: 'evm',
      coinId: 'arbitrum-one',
      chain: 'main',
      aliases: ['arb', 'arbitrum', 'arbitrum-one', 'mainnet-arbitrum'],
      chainId: 42161,
      includeInEvmSet: true,
      isEthereumLayer2: true
    },
    coin: arbCoin
  },
  {
    manifest: {
      id: 'op',
      runtimeModelId: 'op',
      protocolFamily: 'evm',
      coinId: 'optimism',
      chain: 'main',
      aliases: ['op', 'optimism', 'optimism-mainnet', 'mainnet-optimism', 'eth-l2--optimism'],
      chainId: 10,
      includeInEvmSet: true,
      isEthereumLayer2: true,
      visibleByDefault: true
    },
    coin: opCoin
  },
  {
    manifest: {
      id: 'base',
      runtimeModelId: 'base',
      protocolFamily: 'evm',
      coinId: 'base',
      chain: 'main',
      aliases: ['base', 'srv--base', 'base-mainnet', 'mainnet-base'],
      chainId: 8453,
      includeInEvmSet: true,
      isEthereumLayer2: true,
      testedByDefault: true,
      visibleByDefault: true
    },
    coin: baseCoin
  },
  {
    manifest: {
      id: 'polygon',
      runtimeModelId: 'polygon',
      protocolFamily: 'evm',
      coinId: 'polygon-bor',
      chain: 'main',
      aliases: ['polygon', 'polygon-pos', 'polygon-mainnet', 'polygon-bor', 'mainnet-polygon'],
      chainId: 137,
      includeInEvmSet: true
    },
    coin: polygonCoin
  },
  {
    manifest: {
      id: 'avaxc',
      runtimeModelId: 'avaxc',
      protocolFamily: 'evm',
      coinId: 'avalanche-c-chain',
      chain: 'main',
      aliases: ['avax', 'avaxc', 'avalanche', 'avalanche-c-chain', 'mainnet-avalanche'],
      chainId: 43114,
      includeInEvmSet: true
    },
    coin: avaxcCoin
  },
  {
    manifest: {
      id: 'cronos',
      runtimeModelId: 'cronos',
      protocolFamily: 'evm',
      coinId: 'cronos',
      chain: 'main',
      aliases: ['cronos', 'cronos-mainnet', 'cronos-evm', 'mainnet-cronos'],
      chainId: 25,
      includeInEvmSet: true
    },
    coin: cronosCoin
  },
  {
    manifest: {
      id: 'cosmos',
      runtimeModelId: 'cosmos',
      protocolFamily: 'cosmos',
      coinId: 'cosmos',
      chain: 'main',
      aliases: ['cosmos', 'cosmos-hub'],
      testedByDefault: true,
      visibleByDefault: true
    },
    coin: cosmosCoin
  },
  {
    manifest: {
      id: 'cro',
      runtimeModelId: 'cro',
      protocolFamily: 'cosmos',
      coinId: 'cronos-pos',
      chain: 'main',
      aliases: ['cro', 'cronos-pos', 'crocosmos']
    },
    coin: croCoin
  },
  {
    manifest: {
      id: 'tron',
      runtimeModelId: 'tron',
      protocolFamily: 'tron',
      coinId: 'tron',
      chain: 'main',
      aliases: ['trx', 'tron']
    },
    coin: tronCoin
  },
  {
    manifest: {
      id: 'sol',
      runtimeModelId: 'sol',
      protocolFamily: 'solana',
      coinId: 'solana',
      chain: 'main',
      aliases: ['sol', 'solana'],
      visibleByDefault: true
    },
    coin: solCoin
  },
  {
    manifest: {
      id: 'ada',
      runtimeModelId: 'ada',
      protocolFamily: 'cardano',
      coinId: 'cardano',
      chain: 'main',
      aliases: ['ada', 'cardano']
    },
    coin: adaCoin
  },
  {
    manifest: {
      id: 'sui',
      runtimeModelId: 'sui',
      protocolFamily: 'sui',
      coinId: 'sui',
      chain: 'main',
      aliases: ['sui']
    },
    coin: suiCoin
  },
  {
    manifest: {
      id: 'xlm',
      runtimeModelId: 'xlm',
      protocolFamily: 'stellar',
      coinId: 'stellar',
      chain: 'main',
      aliases: ['xlm', 'stellar']
    },
    coin: xlmCoin
  },
  {
    manifest: {
      id: 'doge',
      runtimeModelId: 'doge',
      protocolFamily: 'utxo',
      coinId: 'dogecoin',
      chain: 'main',
      aliases: ['doge', 'dogecoin']
    },
    coin: dogeCoin
  },
  {
    manifest: {
      id: 'firo',
      runtimeModelId: 'firo',
      protocolFamily: 'utxo',
      coinId: 'firo',
      chain: 'main',
      aliases: ['firo']
    },
    coin: firoCoin
  },
  {
    manifest: {
      id: 'dash',
      runtimeModelId: 'dash',
      protocolFamily: 'utxo',
      coinId: 'dash',
      chain: 'main',
      aliases: ['dash', 'sdash', 'srv--dash'],
      testedByDefault: true,
      visibleByDefault: true
    },
    coin: dashCoin
  },
  {
    manifest: {
      id: 'btcz',
      runtimeModelId: 'btcz',
      protocolFamily: 'utxo',
      coinId: 'bitcoinz',
      chain: 'main',
      aliases: ['btcz', 'bitcoinz'],
      testedByDefault: true,
      visibleByDefault: true
    },
    coin: btczCoin
  },
  {
    manifest: {
      id: 'zksync',
      runtimeModelId: 'zksync',
      protocolFamily: 'evm',
      coinId: 'zksync-era',
      chain: 'main',
      aliases: ['zksync', 'zksync-era', 'zksync-mainnet', 'mainnet-zksync'],
      chainId: 324,
      includeInEvmSet: true,
      isEthereumLayer2: true
    },
    coin: zksyncCoin
  }
]
