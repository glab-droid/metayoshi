import { ethers } from 'ethers'
import type { Network } from '../coins'
import type { EvmGasLane } from './coinFeatureModel'
import { estimateNetworkFeeUi } from './estimateNetworkFeeUi'
import { estimateEvmTxFee, type EvmFeeQuote } from './evmFee'
import { callBridgeMethod, type UtxoRpcConfig } from './utxoRpc'

export type TransactionFeePreviewSource = 'live' | 'fallback'

export interface TransactionFeePreviewResult {
  fee: number
  source: TransactionFeePreviewSource
}

type PreviewNetwork = Pick<
  Network,
  | 'id'
  | 'symbol'
  | 'rpcUrl'
  | 'rpcWallet'
  | 'rpcUsername'
  | 'rpcPassword'
  | 'bridgeUrl'
  | 'bridgeUsername'
  | 'bridgePassword'
  | 'coinType'
  | 'feePerByte'
  | 'runtimeModelId'
>

export interface EstimateTransactionFeePreviewInput {
  network: PreviewNetwork
  fromAddress?: string
  toAddress?: string
  amount?: string
  assetId?: string
  assetLogos?: Record<string, string>
  isAssetTransfer?: boolean
  dataHex?: string
  gasLimit?: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
  type?: 2
  gasLane?: EvmGasLane
}

const EVM_ERC20_IFACE = new ethers.Interface([
  'function transfer(address to, uint256 value) returns (bool)',
  'function decimals() view returns (uint8)'
])
const EVM_ERC721_IFACE = new ethers.Interface([
  'function safeTransferFrom(address from, address to, uint256 tokenId)'
])
const EVM_ERC1155_IFACE = new ethers.Interface([
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)'
])

function buildRpcPreviewConfig(network: PreviewNetwork): UtxoRpcConfig {
  return {
    networkId: network.id,
    coinSymbol: network.symbol,
    rpcUrl: network.rpcUrl,
    rpcWallet: network.rpcWallet,
    rpcUsername: network.rpcUsername,
    rpcPassword: network.rpcPassword,
    bridgeUrl: network.bridgeUrl,
    bridgeUsername: network.bridgeUsername,
    bridgePassword: network.bridgePassword,
    useLocalRpc: false
  }
}

function parseOptionalRpcQuantity(value: string | undefined, label: string): bigint | undefined {
  const text = String(value || '').trim()
  if (!text) return undefined
  if (/^\d+$/.test(text)) return BigInt(text)
  if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text)
  throw new Error(`${label} must be a decimal integer or 0x-prefixed hex quantity`)
}

function parseEvmNftAssetKey(assetId: string): { standard: 'erc721' | 'erc1155'; address: string; tokenId: string } | null {
  const m = String(assetId || '').trim().match(/^EVMNFT:(erc721|erc1155):(0x[a-fA-F0-9]{40}):(.+)$/)
  if (!m) return null
  return {
    standard: m[1] as 'erc721' | 'erc1155',
    address: ethers.getAddress(m[2]),
    tokenId: m[3]
  }
}

function extractEvmTokenAddressFromLogoUri(logoUri: string): string {
  const raw = String(logoUri || '').trim()
  if (!raw) return ''
  const m = raw.match(/\/assets\/(0x[a-fA-F0-9]{40})\/logo\.(?:png|svg|webp|jpg|jpeg)$/i)
  if (!m) return ''
  return ethers.isAddress(m[1]) ? ethers.getAddress(m[1]) : ''
}

function estimateFeeFromResolvedEvmQuote(
  quote: EvmFeeQuote,
  input: Pick<
    EstimateTransactionFeePreviewInput,
    'gasLimit' | 'gasPrice' | 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'type'
  >
): bigint {
  const manualGasLimit = parseOptionalRpcQuantity(input.gasLimit, 'gasLimit')
  const manualGasPrice = parseOptionalRpcQuantity(input.gasPrice, 'gasPrice')
  const manualMaxFeePerGas = parseOptionalRpcQuantity(input.maxFeePerGas, 'maxFeePerGas')
  const manualMaxPriorityFeePerGas = parseOptionalRpcQuantity(input.maxPriorityFeePerGas, 'maxPriorityFeePerGas')

  if (manualGasPrice !== undefined && (manualMaxFeePerGas !== undefined || manualMaxPriorityFeePerGas !== undefined)) {
    throw new Error('Use either gasPrice or EIP-1559 fee fields, not both')
  }

  const resolvedGasLimit = manualGasLimit ?? quote.gasLimit
  const resolvedType = manualGasPrice !== undefined
    ? undefined
    : ((input.type === 2 || manualMaxFeePerGas !== undefined || manualMaxPriorityFeePerGas !== undefined || quote.type === 2) ? 2 : undefined)

  if (resolvedType === 2) {
    const effectiveMaxFeePerGas = manualMaxFeePerGas ?? quote.maxFeePerGas
    const effectiveMaxPriorityFeePerGas = manualMaxPriorityFeePerGas ?? quote.maxPriorityFeePerGas
    if (effectiveMaxFeePerGas === undefined || effectiveMaxPriorityFeePerGas === undefined) {
      throw new Error('Missing EIP-1559 fee quote for type 2 transaction')
    }
    return resolvedGasLimit * effectiveMaxFeePerGas
  }

  const effectiveGasPrice = manualGasPrice ?? quote.gasPrice ?? 1_000_000_000n
  return resolvedGasLimit * effectiveGasPrice
}

async function estimateEvmAssetTransferFee(input: EstimateTransactionFeePreviewInput): Promise<bigint> {
  const rpcConfig = buildRpcPreviewConfig(input.network)
  const fromAddress = String(input.fromAddress || '').trim()
  const toAddress = String(input.toAddress || '').trim()
  const assetId = String(input.assetId || '').trim()
  const amount = String(input.amount || '').trim()
  const assetLogos = input.assetLogos || {}
  const nft = parseEvmNftAssetKey(assetId)

  if (nft) {
    const transferData = nft.standard === 'erc721'
      ? EVM_ERC721_IFACE.encodeFunctionData('safeTransferFrom', [fromAddress, toAddress, BigInt(nft.tokenId)])
      : EVM_ERC1155_IFACE.encodeFunctionData('safeTransferFrom', [
          fromAddress,
          toAddress,
          BigInt(nft.tokenId),
          BigInt(String(Math.max(1, Math.trunc(Number(amount) || 1)))),
          '0x'
        ])
    const quote = await estimateEvmTxFee({
      rpcConfig,
      from: fromAddress,
      to: nft.address,
      data: transferData,
      valueWei: 0n,
      fallbackGasLimitHex: '0x30d40',
      lane: input.gasLane
    })
    return estimateFeeFromResolvedEvmQuote(quote, input)
  }

  let tokenAddress = ethers.isAddress(assetId) ? ethers.getAddress(assetId) : ''
  if (!tokenAddress) {
    tokenAddress = extractEvmTokenAddressFromLogoUri(String(assetLogos[assetId] || ''))
  }
  if (!tokenAddress) {
    throw new Error('Unable to resolve token contract address for fee estimation')
  }

  let decimals = 18
  try {
    const data = EVM_ERC20_IFACE.encodeFunctionData('decimals', [])
    const raw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: tokenAddress, data }, 'latest'])
    const [value] = EVM_ERC20_IFACE.decodeFunctionResult('decimals', String(raw || '0x'))
    const nextDecimals = Number(value)
    if (Number.isFinite(nextDecimals) && nextDecimals >= 0 && nextDecimals <= 30) {
      decimals = Math.trunc(nextDecimals)
    }
  } catch {
    // Keep fallback decimals.
  }

  const amountRaw = ethers.parseUnits(String(amount || '0'), decimals)
  const transferData = EVM_ERC20_IFACE.encodeFunctionData('transfer', [toAddress, amountRaw])
  const quote = await estimateEvmTxFee({
    rpcConfig,
    from: fromAddress,
    to: tokenAddress,
    data: transferData,
    valueWei: 0n,
    fallbackGasLimitHex: '0x186a0',
    lane: input.gasLane
  })
  return estimateFeeFromResolvedEvmQuote(quote, input)
}

async function estimateEvmNativeTransferFee(input: EstimateTransactionFeePreviewInput): Promise<bigint> {
  const rpcConfig = buildRpcPreviewConfig(input.network)
  const amount = String(input.amount || '0').trim() || '0'
  const valueWei = ethers.parseEther(amount)
  const quote = await estimateEvmTxFee({
    rpcConfig,
    from: String(input.fromAddress || '').trim(),
    to: String(input.toAddress || '').trim() || undefined,
    valueWei,
    data: String(input.dataHex || '').trim() || undefined,
    fallbackGasLimitHex: String(input.dataHex || '').trim() ? '0x30d40' : '0x5208',
    lane: input.gasLane
  })
  return estimateFeeFromResolvedEvmQuote(quote, input)
}

export async function estimateTransactionFeePreview(
  input: EstimateTransactionFeePreviewInput
): Promise<TransactionFeePreviewResult> {
  const fallback = estimateNetworkFeeUi(input.network as Network)
  const fromAddress = String(input.fromAddress || '').trim()
  const toAddress = String(input.toAddress || '').trim()

  if (input.network.coinType !== 'EVM' || !fromAddress || (!toAddress && !String(input.dataHex || '').trim())) {
    return { fee: fallback, source: 'fallback' }
  }

  try {
    const estimatedFeeWei = input.isAssetTransfer
      ? await estimateEvmAssetTransferFee(input)
      : await estimateEvmNativeTransferFee(input)
    return {
      fee: Number(ethers.formatEther(estimatedFeeWei)),
      source: 'live'
    }
  } catch {
    return { fee: fallback, source: 'fallback' }
  }
}
