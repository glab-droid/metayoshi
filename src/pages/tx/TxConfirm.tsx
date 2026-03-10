import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ethers } from 'ethers'
import { Button } from '../../components/Button'
import { Tabs } from '../../components/Tabs'
import { formatFiatValue, useWalletStore } from '../../store/walletStore'
import { IoArrowBack, IoArrowForward, IoCheckmarkCircle, IoHomeOutline, IoInformationCircle } from 'react-icons/io5'
import { resolveNetworkCapabilities } from '../../lib/networkCapabilities'
import { getSendBlockedSyncReason, isSendBlockedBySync } from '../../lib/sendSyncPolicy'
import { getAccountDisplayName } from '../../lib/accountName'
import { callBridgeMethod, type UtxoRpcConfig } from '../../lib/utxoRpc'
import { estimateEvmTxFee } from '../../lib/evmFee'
import { isCosmosLikeModelId, resolveRuntimeModelId } from '../../lib/runtimeModel'

interface TxLayoutProps {
  title: string
  error?: string
  isRejectMode?: boolean
}

interface TxState {
  requestType?: 'native' | 'asset'
  assetId?: string
  assetLabel?: string
  to?: string
  amount?: string
  memo?: string
  from?: string
  origin?: string
  enteredAmount?: string
  donationEnabled?: boolean
  donationPercent?: number
  donationMode?: 'add' | 'deduct'
  donationAmount?: string
  donationAddress?: string
  donationRequired?: boolean
  totalBeforeNetworkFee?: string
}

function formatCoinAmount(v: number): string {
  return v.toFixed(8).replace(/\.?0+$/, '')
}

function parseCoinAmount(value: unknown): number {
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function estimateTransferFee(network: { coinType: string; feePerByte?: number }): number {
  const modelId = String((network as any)?.runtimeModelId || (network as any)?.id || '').trim().toLowerCase()
  if (modelId === 'cosmos') return 0.0025
  if (network.coinType === 'UTXO') {
    const rawFeePerByteCoins = Number(network.feePerByte ?? 0.0000002)
    let feePerByteSats = Math.max(1, Math.round(rawFeePerByteCoins * 1e8))
    if (feePerByteSats > 500) feePerByteSats = Math.max(1, Math.round(feePerByteSats / 1000))
    const estimatedBytes = 10 + (148 * 2) + (34 * 3)
    return (estimatedBytes * feePerByteSats) / 1e8
  }
  return 0.002151
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

function buildRpcPreviewConfig(network: {
  id: string
  symbol: string
  rpcUrl: string
  rpcWallet?: string
  rpcUsername?: string
  rpcPassword?: string
  bridgeUrl?: string
  bridgeUsername?: string
  bridgePassword?: string
}): UtxoRpcConfig {
  return {
    networkId: network.id,
    coinSymbol: network.symbol,
    rpcUrl: network.rpcUrl,
    rpcWallet: network.rpcWallet,
    rpcUsername: network.rpcUsername,
    rpcPassword: network.rpcPassword,
    bridgeUrl: network.bridgeUrl,
    bridgeUsername: network.bridgeUsername,
    bridgePassword: network.bridgePassword
  }
}

const TxLayout: React.FC<TxLayoutProps> = ({ title, error, isRejectMode }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    accounts,
    activeAccountId,
    networks,
    activeNetworkId,
    addActivity,
    trackActivityTransactionStatus,
    sendEvmTransaction,
    sendCardanoTransaction,
    sendSolanaTransaction,
    sendStellarTransaction,
    sendTronTransaction,
    sendUtxoTransaction,
    sendAssetTransfer,
    refreshActiveBalance,
    networkAssetLogos,
    accountNetworkAssets,
    accountNetworkFiatNative,
    accountNetworkFiatAssets,
    isConnected,
    isSyncing,
    syncPercent,
    lowSyncStreak
  } = useWalletStore()
  const [activeTab, setActiveTab] = useState('details')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const txState = (location.state as TxState | null) ?? {}
  const isAssetTransfer = txState.requestType === 'asset' || Boolean(String(txState.assetId || '').trim())
  const assetId = String(txState.assetId || '').trim()
  const assetLabel = String(txState.assetLabel || assetId || '').trim()
  const toAddress = txState.to?.trim() ?? ''
  const amount = txState.amount?.trim() ?? ''
  const memo = String(txState.memo || '').trim()
  const fromAddress = txState.from?.trim() ?? ''
  const requestOrigin = String(txState.origin ?? '').trim() || 'metayoshi provider'
  const hasTxState = Boolean(toAddress && amount)
  const numericAmount = Number(amount)
  const safeAmount = Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : 0
  const activeAccount = accounts.find(a => a.id === activeAccountId) || accounts[0]
  const activeNetwork = networks.find(n => n.id === activeNetworkId) || networks[0]
  const activeModelId = resolveRuntimeModelId(activeNetwork)
  const activeAccountName = getAccountDisplayName(activeAccount, activeNetworkId, 'Account 1')
  const caps = resolveNetworkCapabilities(activeNetwork)
  const sendBlockedBySync = isSendBlockedBySync(isSyncing, syncPercent, isConnected, lowSyncStreak)
  const syncBlockedReason = getSendBlockedSyncReason(isSyncing, syncPercent, isConnected, lowSyncStreak)

  const enteredAmountNumRaw = Number(txState.enteredAmount ?? amount)
  const enteredAmount = Number.isFinite(enteredAmountNumRaw) && enteredAmountNumRaw > 0 ? enteredAmountNumRaw : safeAmount
  const donationEnabled = txState.donationEnabled === true
  const donationPercentRaw = Number(txState.donationPercent ?? 0)
  const donationPercent = Number.isFinite(donationPercentRaw) && donationPercentRaw > 0 ? donationPercentRaw : 0
  const donationMode = txState.donationMode === 'deduct' ? 'deduct' : 'add'
  const donationAmountRaw = Number(txState.donationAmount ?? (donationEnabled ? (enteredAmount * donationPercent) / 100 : 0))
  const donationAmount = Number.isFinite(donationAmountRaw) && donationAmountRaw > 0 ? donationAmountRaw : 0
  const donationAddress = String(txState.donationAddress ?? '').trim()
  const donationRequired = txState.donationRequired === true
  const spendBeforeNetworkFeeRaw = Number(txState.totalBeforeNetworkFee ?? (donationEnabled && donationMode === 'add' ? safeAmount + donationAmount : enteredAmount))
  const spendBeforeNetworkFee = Number.isFinite(spendBeforeNetworkFeeRaw) && spendBeforeNetworkFeeRaw > 0 ? spendBeforeNetworkFeeRaw : safeAmount
  const fallbackEstimatedNetworkFee = estimateTransferFee(activeNetwork)
  const [estimatedNetworkFee, setEstimatedNetworkFee] = useState<number>(fallbackEstimatedNetworkFee)
  const [isEstimatingNetworkFee, setIsEstimatingNetworkFee] = useState(false)
  const estimatedTotalCost = spendBeforeNetworkFee + estimatedNetworkFee
  const activeNetworkLogos = networkAssetLogos?.[activeNetworkId] || {}
  const evmNativeValueWei = useMemo(() => {
    if (activeNetwork.coinType !== 'EVM' || isAssetTransfer) return 0n
    try {
      return ethers.parseEther(String(safeAmount || 0))
    } catch {
      return 0n
    }
  }, [activeNetwork.coinType, isAssetTransfer, safeAmount])
  const availableNativeBalance = useMemo(() => {
    const scoped = parseCoinAmount(activeAccount?.networkBalances?.[activeNetworkId])
    if (scoped > 0) return scoped
    return parseCoinAmount(activeAccount?.balance)
  }, [activeAccount?.balance, activeAccount?.networkBalances, activeNetworkId])
  const fiatScopeKey = `${String(activeAccount?.id || '').trim().toLowerCase()}::${String(activeNetworkId || '').trim().toLowerCase()}`
  const scopedNativeFiatUsd = Number(accountNetworkFiatNative?.[fiatScopeKey]?.usd)
  const scopedAssetFiatUsd = Number(accountNetworkFiatAssets?.[fiatScopeKey]?.[assetId]?.usd)
  const scopedAssetRaw = Number(accountNetworkAssets?.[fiatScopeKey]?.[assetId] ?? 0)
  const nativeUsdPerCoin = useMemo(() => {
    if (!Number.isFinite(scopedNativeFiatUsd) || scopedNativeFiatUsd <= 0) return null
    if (!Number.isFinite(availableNativeBalance) || availableNativeBalance <= 0) return null
    return scopedNativeFiatUsd / availableNativeBalance
  }, [availableNativeBalance, scopedNativeFiatUsd])
  const assetUsdPerUnit = useMemo(() => {
    if (!isAssetTransfer) return null
    if (!Number.isFinite(scopedAssetFiatUsd) || scopedAssetFiatUsd <= 0) return null
    const scopedAssetUnits = scopedAssetRaw / 1e8
    if (!Number.isFinite(scopedAssetUnits) || scopedAssetUnits <= 0) return null
    return scopedAssetFiatUsd / scopedAssetUnits
  }, [isAssetTransfer, scopedAssetFiatUsd, scopedAssetRaw])
  const estimatedNetworkFeeFiat = nativeUsdPerCoin ? estimatedNetworkFee * nativeUsdPerCoin : null
  const recipientAmountFiat = isAssetTransfer
    ? (assetUsdPerUnit ? safeAmount * assetUsdPerUnit : null)
    : (nativeUsdPerCoin ? safeAmount * nativeUsdPerCoin : null)
  const donationFiat = nativeUsdPerCoin ? (donationEnabled ? donationAmount : 0) * nativeUsdPerCoin : null
  const estimatedTotalCostFiat = nativeUsdPerCoin ? estimatedTotalCost * nativeUsdPerCoin : null

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const fallback = estimateTransferFee(activeNetwork)
      if (activeNetwork.coinType !== 'EVM' || !toAddress || !fromAddress) {
        setEstimatedNetworkFee(fallback)
        setIsEstimatingNetworkFee(false)
        return
      }
      setIsEstimatingNetworkFee(true)
      try {
        const rpcConfig = buildRpcPreviewConfig(activeNetwork)
        if (isAssetTransfer) {
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
              fallbackGasLimitHex: nft.standard === 'erc721' ? '0x30d40' : '0x30d40'
            })
            if (!cancelled) setEstimatedNetworkFee(Number(ethers.formatEther(quote.estimatedFeeWei)))
          } else {
            let tokenAddress = ethers.isAddress(assetId) ? ethers.getAddress(assetId) : ''
            if (!tokenAddress) {
              tokenAddress = extractEvmTokenAddressFromLogoUri(String(activeNetworkLogos?.[assetId] || ''))
            }
            if (!tokenAddress) throw new Error('Unable to resolve token contract address for fee estimation')

            let decimals = 18
            try {
              const data = EVM_ERC20_IFACE.encodeFunctionData('decimals', [])
              const raw = await callBridgeMethod(rpcConfig, 'eth_call', [{ to: tokenAddress, data }, 'latest'])
              const [value] = EVM_ERC20_IFACE.decodeFunctionResult('decimals', String(raw || '0x'))
              const n = Number(value)
              if (Number.isFinite(n) && n >= 0 && n <= 30) decimals = Math.trunc(n)
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
              fallbackGasLimitHex: '0x186a0'
            })
            if (!cancelled) setEstimatedNetworkFee(Number(ethers.formatEther(quote.estimatedFeeWei)))
          }
        } else {
          const quote = await estimateEvmTxFee({
            rpcConfig,
            from: fromAddress,
            to: toAddress,
            valueWei: evmNativeValueWei,
            fallbackGasLimitHex: '0x5208'
          })
          if (!cancelled) setEstimatedNetworkFee(Number(ethers.formatEther(quote.estimatedFeeWei)))
        }
      } catch {
        if (!cancelled) setEstimatedNetworkFee(fallback)
      } finally {
        if (!cancelled) setIsEstimatingNetworkFee(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [
    activeNetwork,
    activeNetworkLogos,
    activeNetworkId,
    amount,
    assetId,
    evmNativeValueWei,
    fromAddress,
    isAssetTransfer,
    toAddress
  ])

  const TABS = [
    { id: 'details', label: 'DETAILS' },
    { id: 'data', label: 'DATA' },
    { id: 'hex', label: 'HEX' }
  ]

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/wallet/assets')
  }

  const handleHome = () => {
    navigate('/wallet/assets')
  }

  const handleConfirm = async () => {
    if (isRejectMode) return
    setSubmitError('')
    if (!hasTxState) {
      setSubmitError('No pending transaction to confirm')
      return
    }
    if (!toAddress || safeAmount <= 0) {
      setSubmitError('Transaction data is invalid')
      return
    }
    if (isAssetTransfer && !caps.features.assetSend) {
      setSubmitError(`${activeNetwork.name} does not support asset transfers in this wallet`)
      return
    }
    if (!isAssetTransfer && !caps.features.nativeSend) {
      setSubmitError(`${activeNetwork.name} does not support native coin transfers in this wallet`)
      return
    }
    if (sendBlockedBySync) {
      setSubmitError(syncBlockedReason)
      return
    }
    if (isAssetTransfer && availableNativeBalance + 1e-12 < estimatedNetworkFee) {
      setSubmitError(`Insufficient ${activeNetwork.symbol} for network fee. Required ~${formatCoinAmount(estimatedNetworkFee)} ${activeNetwork.symbol}, available ${formatCoinAmount(availableNativeBalance)} ${activeNetwork.symbol}.`)
      return
    }
    if (!isAssetTransfer && availableNativeBalance + 1e-12 < estimatedTotalCost) {
      setSubmitError(`Insufficient balance for amount + fee. Required ~${formatCoinAmount(estimatedTotalCost)} ${activeNetwork.symbol}, available ${formatCoinAmount(availableNativeBalance)} ${activeNetwork.symbol}.`)
      return
    }
    if (activeNetwork.coinType === 'UTXO' && donationEnabled && donationRequired && donationAmount > 0 && !donationAddress) {
      setSubmitError('Donation address missing from server policy/config')
      return
    }
    setIsSubmitting(true)

    try {
      let txHash = ''
      if (isAssetTransfer) {
        if (!assetId) throw new Error('Asset id missing from transaction request')
        const sent = await sendAssetTransfer({
          assetId,
          qty: amount,
          toAddress: toAddress,
          memo
        })
        txHash = String(sent.txid || '').trim()
      } else if (activeNetwork.coinType === 'EVM') {
        const res = await sendEvmTransaction({ to: toAddress, amount })
        txHash = String(res.hash || '').trim()
      } else if (activeModelId === 'ada') {
        const res = await sendCardanoTransaction({ to: toAddress, amount })
        txHash = String(res.hash || '').trim()
      } else if (activeModelId === 'sol') {
        const res = await sendSolanaTransaction({ to: toAddress, amount })
        txHash = String(res.hash || '').trim()
      } else if (activeModelId === 'xlm') {
        const res = await sendStellarTransaction({ to: toAddress, amount })
        txHash = String(res.hash || '').trim()
      } else if (activeModelId === 'tron') {
        const res = await sendTronTransaction({ to: toAddress, amount })
        txHash = String(res.hash || '').trim()
      } else if (isCosmosLikeModelId(activeModelId)) {
        const res = await sendUtxoTransaction({ to: toAddress, amount, memo })
        txHash = String(res.hash || '').trim()
      } else if (activeNetwork.coinType === 'UTXO') {
        const res = await sendUtxoTransaction({
          to: toAddress,
          amount,
          memo,
          donation: donationEnabled
            ? {
                address: donationAddress,
                amount: formatCoinAmount(donationAmount),
                required: donationRequired
              }
            : undefined
        })
        txHash = String(res.hash || '').trim()
      } else {
        throw new Error(`Unsupported coin type: ${activeNetwork.coinType}`)
      }
      if (!txHash) throw new Error('Transaction sent but hash is missing')
      
      addActivity({
        id: txHash,
        type: 'sent',
        asset: isAssetTransfer ? (assetLabel || assetId || 'ASSET') : activeNetwork.symbol,
        amount: amount,
        from: fromAddress || '',
        to: toAddress,
        accountId: activeAccount?.id,
        status: 'pending',
        timestamp: Date.now(),
        networkId: activeNetwork.id
      })
      trackActivityTransactionStatus({ txid: txHash, networkId: activeNetwork.id })
      void refreshActiveBalance({ fast: true, skipZeroBalanceRecheck: true }).catch((err) => {
        console.warn('Post-send fast balance refresh failed:', err)
      })
      navigate('/connecting')
    } catch (e: any) {
      setSubmitError(String(e?.message ?? 'Transaction failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = () => {
    if (!hasTxState) {
      navigate('/wallet/activity')
      return
    }
    addActivity({
      id: Math.random().toString(36).substr(2, 9),
      type: 'sent',
      asset: isAssetTransfer ? (assetLabel || assetId || 'ASSET') : activeNetwork.symbol,
      amount: amount,
      from: fromAddress || '',
      to: toAddress,
      accountId: activeAccount?.id,
      status: 'rejected',
      timestamp: Date.now(),
      networkId: activeNetwork.id
    })
    navigate('/wallet/activity')
  }

  return (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="px-4 py-2 bg-dark-900 border-b border-dark-600 flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dark-600 bg-dark-700/40 hover:bg-dark-700 text-gray-200"
          title="Go back"
        >
          <IoArrowBack className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Back</span>
        </button>
        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">{title}</span>
        <button
          type="button"
          onClick={handleHome}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary"
          title="Go to home"
        >
          <IoHomeOutline className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Home</span>
        </button>
      </header>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto custom-scrollbar">
        <div className="p-4 rounded-xl border border-dark-600 bg-dark-700/30 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-yellow-500" />
              <span className="text-xs font-bold">{activeAccountName}</span>
            </div>
            <div className="px-2 py-0.5 rounded-full bg-dark-700/50 border border-dark-600 flex items-center gap-1.5">
               <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
               <span className="text-[9px] font-bold text-gray-300 uppercase">{activeNetwork.name}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
             <span className="text-[11px] font-mono text-gray-400">
               {fromAddress && fromAddress.length > 12
                 ? `${fromAddress.slice(0, 6)}...${fromAddress.slice(-6)}`
                 : activeAccountName}
             </span>
             <IoArrowForward className="text-gray-600 w-3 h-3" />
             <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full bg-purple-500" />
                <span className="text-[11px] font-mono text-gray-200">
                  {toAddress.length > 12 ? `${toAddress.slice(0, 6)}...${toAddress.slice(-6)}` : (toAddress || '—')}
                </span>
             </div>
          </div>

          <div className="divider" />

          <div className="space-y-1">
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">Origin</p>
            <p className="text-[11px] font-medium text-primary break-all">{requestOrigin}</p>
          </div>

          <div className="p-3 bg-dark-800 rounded-xl border border-dark-600 space-y-1">
            <p className="text-[11px] font-mono text-blue-400 font-bold break-all">
              {toAddress || 'No recipient provided'}
            </p>
            <p className="text-[11px] font-mono text-gray-300">
              {safeAmount > 0 ? `${safeAmount} ${isAssetTransfer ? (assetLabel || 'ASSET') : activeNetwork.symbol}` : 'No amount provided'}
            </p>
            {memo && (
              <p className="text-[11px] font-mono text-gray-400 break-all">Memo: {memo}</p>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-yellow-500" />
          </div>
        </div>

        <Tabs 
          tabs={TABS} 
          activeTab={activeTab} 
          onChange={setActiveTab} 
          className="px-2" 
        />

        <div className="p-2 space-y-4">
          {activeTab === 'details' && (
            <div className="space-y-6">
              <div className="flex justify-between items-start">
                 <div className="space-y-0.5">
                    <p className="text-[11px] font-bold">Network fee estimate</p>
                    <p className="text-[10px] text-gray-500">Based on current wallet defaults</p>
                 </div>
                 <div className="text-right">
                    <p className="text-xs font-bold">{formatCoinAmount(estimatedNetworkFee)}</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">{activeNetwork.symbol}</p>
                    {estimatedNetworkFeeFiat !== null && (
                      <p className="text-[10px] text-gray-400">{formatFiatValue(estimatedNetworkFeeFiat)}</p>
                    )}
                    <p className="text-[9px] text-gray-500">
                      {isEstimatingNetworkFee ? 'Updating from network…' : 'Est. fee only'}
                    </p>
                 </div>
              </div>

              {donationEnabled && !isAssetTransfer && (
                <>
                  <div className="divider" />
                  <div className="flex justify-between items-start">
                     <div className="space-y-0.5">
                        <p className="text-[11px] font-bold">Donation</p>
                        <p className="text-[10px] text-gray-500">
                          {donationPercent}% ({donationMode === 'add' ? 'added on top' : 'deducted from entered amount'}){donationRequired ? ' · server-enforced' : ''}
                        </p>
                     </div>
                     <div className="text-right">
                        <p className="text-xs font-bold">{formatCoinAmount(donationAmount)}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">{activeNetwork.symbol}</p>
                        {donationAddress && (
                          <p className="text-[9px] text-gray-500">
                            To: <span className="font-bold">{donationAddress.slice(0, 8)}...{donationAddress.slice(-6)}</span>
                          </p>
                        )}
                     </div>
                  </div>
                </>
              )}

              <div className="divider" />

              <div className="flex justify-between items-start">
                 <div className="space-y-0.5">
                    <p className="text-[12px] font-bold">{isAssetTransfer ? 'Asset amount' : 'Recipient gets'}</p>
                    <p className="text-[10px] text-gray-500">{isAssetTransfer ? 'Asset transfer quantity' : 'Final transfer amount'}</p>
                 </div>
                 <div className="text-right">
                    <p className="text-sm font-bold">{formatCoinAmount(safeAmount)}</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">{isAssetTransfer ? (assetLabel || 'ASSET') : activeNetwork.symbol}</p>
                    {recipientAmountFiat !== null && (
                      <p className="text-[10px] text-gray-400">{formatFiatValue(recipientAmountFiat)}</p>
                    )}
                    {donationEnabled && donationMode === 'deduct' && !isAssetTransfer && (
                      <p className="text-[9px] text-gray-500">Entered: <span className="font-bold">{formatCoinAmount(enteredAmount)} {activeNetwork.symbol}</span></p>
                    )}
                  </div>
              </div>

              {memo && (
                <>
                  <div className="divider" />

                  <div className="flex justify-between items-start gap-4">
                     <div className="space-y-0.5">
                        <p className="text-[12px] font-bold">Memo</p>
                        <p className="text-[10px] text-gray-500">Included in the signed on-chain payload</p>
                     </div>
                     <div className="text-right">
                        <p className="text-[11px] font-mono break-all max-w-[180px] text-gray-300">{memo}</p>
                     </div>
                  </div>
                </>
              )}

              {!isAssetTransfer && (
                <>
                  <div className="divider" />

                  <div className="flex justify-between items-start">
                     <div className="space-y-0.5">
                        <p className="text-[12px] font-bold">Estimated total cost</p>
                        <p className="text-[10px] text-gray-500">Spend + network fee</p>
                     </div>
                     <div className="text-right">
                        <p className="text-sm font-bold">{formatCoinAmount(estimatedTotalCost)}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">{activeNetwork.symbol}</p>
                        {estimatedTotalCostFiat !== null && (
                          <p className="text-[10px] text-gray-400">{formatFiatValue(estimatedTotalCostFiat)}</p>
                        )}
                        <p className="text-[9px] text-gray-500">
                          Network fee: <span className="font-bold">{formatCoinAmount(estimatedNetworkFee)} {activeNetwork.symbol}</span>
                          {estimatedNetworkFeeFiat !== null ? <span className="font-bold"> ({formatFiatValue(estimatedNetworkFeeFiat)})</span> : null}
                        </p>
                        {donationEnabled && (
                          <p className="text-[9px] text-gray-500">
                            Additional donation: <span className="font-bold">{formatCoinAmount(donationAmount)} {activeNetwork.symbol}</span>
                            {donationFiat !== null ? <span className="font-bold"> ({formatFiatValue(donationFiat)})</span> : null}
                          </p>
                        )}
                     </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'data' && (
            <div className="bg-dark-900 p-4 rounded-xl border border-dark-600 font-mono text-[10px] text-gray-500">
              <p>{"{"}</p>
              <p className="ml-4">"method": "{isAssetTransfer ? 'send_asset' : 'send'}",</p>
              <p className="ml-4">"params": [{isAssetTransfer ? `"${assetId}", ` : ''}"{toAddress || 'N/A'}", "{amount || '0'}"]</p>
              {memo && <p className="ml-4">"memo": "{memo}",</p>}
              {donationEnabled && !isAssetTransfer && (
                <>
                  <p className="ml-4">"donation": {"{"}</p>
                  <p className="ml-8">"enabled": true,</p>
                  <p className="ml-8">"percent": {donationPercent},</p>
                  <p className="ml-8">"mode": "{donationMode}",</p>
                  <p className="ml-8">"amount": "{formatCoinAmount(donationAmount)}",</p>
                  <p className="ml-8">"address": "{donationAddress || 'N/A'}",</p>
                  <p className="ml-8">"required": {donationRequired ? 'true' : 'false'}</p>
                  <p className="ml-4">{"}"}</p>
                </>
              )}
              <p>{"}"}</p>
            </div>
          )}

          {activeTab === 'hex' && (
            <div className="bg-dark-900 p-4 rounded-xl border border-dark-600 font-mono text-[10px] text-gray-500 break-all leading-tight">
              0x095ea7b3000000000000000000000000010e...202e0000000000000000000000000000000000000000000000000000000001438a00
            </div>
          )}
        </div>

        {error && (
          <div className="mx-2 p-3 bg-red-900/20 border border-red-500/30 rounded-xl flex items-center gap-2">
            <IoInformationCircle className="text-red-400 w-4 h-4 shrink-0" />
            <span className="text-xs font-bold text-red-300">{error}</span>
          </div>
        )}

        {submitError && (
          <div className="mx-2 p-3 bg-red-900/20 border border-red-500/30 rounded-xl flex items-center gap-2">
            <IoInformationCircle className="text-red-400 w-4 h-4 shrink-0" />
            <span className="text-xs font-bold text-red-300">{submitError}</span>
          </div>
        )}

        {!submitError && sendBlockedBySync && (
          <div className="mx-2 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-xl flex items-center gap-2">
            <IoInformationCircle className="text-yellow-300 w-4 h-4 shrink-0" />
            <span className="text-xs font-bold text-yellow-200">{syncBlockedReason}</span>
          </div>
        )}
      </div>

      <footer className="p-4 border-t border-dark-600 flex gap-4 mt-auto">
        <Button 
          variant="outline" 
          className="flex-1 btn-outline"
          onClick={handleReject}
        >
          Reject
        </Button>
        <Button
          className="flex-1 btn-primary"
          onClick={handleConfirm}
          disabled={isRejectMode || isSubmitting || !(isAssetTransfer ? caps.features.assetSend : caps.features.nativeSend) || !hasTxState || sendBlockedBySync}
          isLoading={isSubmitting}
        >
          Confirm
        </Button>
      </footer>
    </div>
  )
}

export const TxConfirm: React.FC = () => <TxLayout title="CONFIRM TRANSFER" />
export const TxReject: React.FC = () => <TxLayout title="REJECT" error="Insufficient funds" isRejectMode />

export default TxConfirm
