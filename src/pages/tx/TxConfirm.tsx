import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '../../components/Button'
import { PasswordGate } from '../../components/PasswordGate'
import { Tabs } from '../../components/Tabs'
import { formatFiatValue, useWalletStore } from '../../store/walletStore'
import { IoArrowBack, IoArrowForward, IoCheckmarkCircle, IoHomeOutline, IoInformationCircle } from 'react-icons/io5'
import { resolveNetworkCapabilities } from '../../lib/networkCapabilities'
import { getSendBlockedSyncReason, isSendBlockedBySync } from '../../lib/sendSyncPolicy'
import { getAccountDisplayName } from '../../lib/accountName'
import { isCosmosLikeModelId, resolveRuntimeModelId } from '../../lib/runtimeModel'
import { estimateNetworkFeeUi } from '../../lib/estimateNetworkFeeUi'
import { estimateTransactionFeePreview } from '../../lib/transactionFeePreview'
import {
  DAPP_PENDING_REQUEST_STORAGE_KEY,
  parseDappPendingRequest,
  type DappPendingRequest,
  type DappSendEvmTransactionPayload
} from '../../lib/dappPermissions'

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
  dataHex?: string
}

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function isDappEvmTransactionRequest(request: DappPendingRequest['request'] | null | undefined): request is DappSendEvmTransactionPayload {
  return Boolean(request && typeof request === 'object' && 'data' in request)
}

function formatCoinAmount(v: number): string {
  return v.toFixed(8).replace(/\.?0+$/, '')
}

function parseCoinAmount(value: unknown): number {
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

const TxLayout: React.FC<TxLayoutProps> = ({ title, error, isRejectMode }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    accounts,
    activeAccountId,
    networks,
    activeNetworkId,
    setActiveAccount,
    setActiveNetwork,
    addActivity,
    trackActivityTransactionStatus,
    sendEvmTransaction,
    getNetworkModelPreferences,
    sendXrpTransaction,
    sendCardanoTransaction,
    sendMoneroTransaction,
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
    isLocked,
    isSyncing,
    syncPercent,
    lowSyncStreak
  } = useWalletStore()
  const [activeTab, setActiveTab] = useState('details')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [pendingDappRequest, setPendingDappRequest] = useState<DappPendingRequest | null>(null)
  const [loadingDappRequest, setLoadingDappRequest] = useState(false)

  const txState = (location.state as TxState | null) ?? {}
  const dappRequestId = useMemo(() => new URLSearchParams(location.search).get('id') || '', [location.search])
  const isDappTxRoute = useMemo(() => new URLSearchParams(location.search).get('dappRequest') === '1', [location.search])

  useEffect(() => {
    if (!isDappTxRoute || !canUseChromeStorage()) {
      setPendingDappRequest(null)
      setLoadingDappRequest(false)
      return
    }

    let mounted = true
    setLoadingDappRequest(true)

    const applyPendingValue = (rawValue: unknown): void => {
      const parsed = parseDappPendingRequest(rawValue)
      if (!mounted) return
      if (!parsed || (dappRequestId && parsed.id !== dappRequestId)) {
        setPendingDappRequest(null)
        setLoadingDappRequest(false)
        return
      }
      if (
        (parsed.method !== 'wallet_sendTransaction' && parsed.method !== 'wallet_sendAsset')
        || (parsed.status !== 'pending' && parsed.status !== 'approved')
      ) {
        setPendingDappRequest(null)
        setLoadingDappRequest(false)
        return
      }
      setPendingDappRequest(parsed)
      setLoadingDappRequest(false)
    }

    void chrome.storage.local
      .get(DAPP_PENDING_REQUEST_STORAGE_KEY)
      .then((result) => {
        applyPendingValue(result[DAPP_PENDING_REQUEST_STORAGE_KEY])
      })
      .catch(() => {
        if (!mounted) return
        setPendingDappRequest(null)
        setLoadingDappRequest(false)
      })

    const onStorageChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ): void => {
      if (areaName !== 'local' || !changes[DAPP_PENDING_REQUEST_STORAGE_KEY]) return
      applyPendingValue(changes[DAPP_PENDING_REQUEST_STORAGE_KEY].newValue)
    }

    chrome.storage.onChanged.addListener(onStorageChanged)
    return () => {
      mounted = false
      chrome.storage.onChanged.removeListener(onStorageChanged)
    }
  }, [dappRequestId, isDappTxRoute])

  const dappRequestPayload = pendingDappRequest?.request as Record<string, unknown> | undefined
  const dappIsAssetTransfer = pendingDappRequest?.method === 'wallet_sendAsset'
  const dappIsEvmTx = !dappIsAssetTransfer && isDappEvmTransactionRequest(pendingDappRequest?.request)
  const dappAssetId = dappIsAssetTransfer ? String(dappRequestPayload?.assetId || '').trim() : ''
  const dappToAddress = dappIsAssetTransfer
    ? String(dappRequestPayload?.toAddress || '').trim()
    : String(dappRequestPayload?.to || '').trim()
  const dappAmount = dappIsAssetTransfer
    ? String(dappRequestPayload?.qty || '').trim()
    : String(dappRequestPayload?.amount || dappRequestPayload?.value || '').trim()
  const dappMemo = dappIsAssetTransfer
    ? String(dappRequestPayload?.memo || '').trim()
    : String(dappRequestPayload?.memo || '').trim()
  const dappDataHex = dappIsEvmTx
    ? String((pendingDappRequest?.request as DappSendEvmTransactionPayload | undefined)?.data || '').trim()
    : ''
  const dappHasSimpleWalletTx = Boolean(
    pendingDappRequest
    && (dappIsAssetTransfer || (!dappDataHex && dappToAddress && dappAmount))
  )

  const isAssetTransfer = isDappTxRoute && dappHasSimpleWalletTx
    ? dappIsAssetTransfer
    : (txState.requestType === 'asset' || Boolean(String(txState.assetId || '').trim()))
  const assetId = isDappTxRoute && dappHasSimpleWalletTx
    ? dappAssetId
    : String(txState.assetId || '').trim()
  const assetLabel = String(txState.assetLabel || assetId || '').trim()
  const toAddress = isDappTxRoute && dappHasSimpleWalletTx
    ? dappToAddress
    : (txState.to?.trim() ?? '')
  const amount = isDappTxRoute && dappHasSimpleWalletTx
    ? dappAmount
    : (txState.amount?.trim() ?? '')
  const memo = isDappTxRoute && dappHasSimpleWalletTx
    ? dappMemo
    : String(txState.memo || '').trim()
  const displayNetworkId = isDappTxRoute && pendingDappRequest
    ? pendingDappRequest.networkId
    : activeNetworkId
  const displayAccountId = isDappTxRoute && pendingDappRequest
    ? pendingDappRequest.accountId
    : activeAccountId
  const activeAccount = accounts.find(a => a.id === displayAccountId) || accounts[0]
  const activeNetwork = networks.find(n => n.id === displayNetworkId) || networks[0]
  const fromAddress = isDappTxRoute && pendingDappRequest
    ? String(
        activeAccount?.networkAddresses?.[displayNetworkId]
        || (activeNetwork?.coinType === 'EVM' ? activeAccount?.addresses?.EVM : '')
        || (activeNetwork?.coinType === 'XRP' ? activeAccount?.addresses?.XRP : '')
        || txState.from
        || ''
      ).trim()
    : (txState.from?.trim() ?? '')
  const requestOrigin = isDappTxRoute && pendingDappRequest
    ? pendingDappRequest.origin
    : (String(txState.origin ?? '').trim() || 'metayoshi provider')
  const hasTxState = Boolean(toAddress && amount)
  const numericAmount = Number(amount)
  const safeAmount = Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : 0
  const activeModelId = resolveRuntimeModelId(activeNetwork)
  const activeAccountName = getAccountDisplayName(activeAccount, displayNetworkId, 'Account 1')
  const caps = resolveNetworkCapabilities(activeNetwork)
  const sendBlockedBySync = isSendBlockedBySync(isSyncing, syncPercent, isConnected, lowSyncStreak)
  const syncBlockedReason = getSendBlockedSyncReason(isSyncing, syncPercent, isConnected, lowSyncStreak)

  const enteredAmountNumRaw = Number((isDappTxRoute ? amount : txState.enteredAmount) ?? amount)
  const enteredAmount = Number.isFinite(enteredAmountNumRaw) && enteredAmountNumRaw > 0 ? enteredAmountNumRaw : safeAmount
  const donationEnabled = !isDappTxRoute && txState.donationEnabled === true
  const donationPercentRaw = Number(!isDappTxRoute ? txState.donationPercent ?? 0 : 0)
  const donationPercent = Number.isFinite(donationPercentRaw) && donationPercentRaw > 0 ? donationPercentRaw : 0
  const donationMode = txState.donationMode === 'deduct' ? 'deduct' : 'add'
  const donationAmountRaw = Number(txState.donationAmount ?? (donationEnabled ? (enteredAmount * donationPercent) / 100 : 0))
  const donationAmount = Number.isFinite(donationAmountRaw) && donationAmountRaw > 0 ? donationAmountRaw : 0
  const donationAddress = String(txState.donationAddress ?? '').trim()
  const donationRequired = txState.donationRequired === true
  const spendBeforeNetworkFeeRaw = Number(txState.totalBeforeNetworkFee ?? (donationEnabled && donationMode === 'add' ? safeAmount + donationAmount : enteredAmount))
  const spendBeforeNetworkFee = Number.isFinite(spendBeforeNetworkFeeRaw) && spendBeforeNetworkFeeRaw > 0 ? spendBeforeNetworkFeeRaw : safeAmount
  const fallbackEstimatedNetworkFee = estimateNetworkFeeUi(activeNetwork)
  const [estimatedNetworkFee, setEstimatedNetworkFee] = useState<number>(fallbackEstimatedNetworkFee)
  const [isEstimatingNetworkFee, setIsEstimatingNetworkFee] = useState(false)
  const estimatedTotalCost = spendBeforeNetworkFee + estimatedNetworkFee
  const activeNetworkLogos = networkAssetLogos?.[displayNetworkId] || {}
  const dappEvmRequest = isDappTxRoute && isDappEvmTransactionRequest(pendingDappRequest?.request)
    ? pendingDappRequest.request
    : null
  const modelPreferences = getNetworkModelPreferences(displayNetworkId)
  const availableNativeBalance = useMemo(() => {
    const scoped = parseCoinAmount(activeAccount?.networkBalances?.[displayNetworkId])
    if (scoped > 0) return scoped
    return parseCoinAmount(activeAccount?.balance)
  }, [activeAccount?.balance, activeAccount?.networkBalances, displayNetworkId])
  const fiatScopeKey = `${String(activeAccount?.id || '').trim().toLowerCase()}::${String(displayNetworkId || '').trim().toLowerCase()}`
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
      const fallback = estimateNetworkFeeUi(activeNetwork)
      if (activeNetwork.coinType !== 'EVM' || !toAddress || !fromAddress) {
        setEstimatedNetworkFee(fallback)
        setIsEstimatingNetworkFee(false)
        return
      }
      setIsEstimatingNetworkFee(true)
      const preview = await estimateTransactionFeePreview({
        network: activeNetwork,
        fromAddress,
        toAddress,
        amount,
        assetId: assetId || undefined,
        assetLogos: activeNetworkLogos,
        isAssetTransfer,
        dataHex: dappEvmRequest?.data,
        gasLimit: dappEvmRequest?.gasLimit,
        gasPrice: dappEvmRequest?.gasPrice,
        maxFeePerGas: dappEvmRequest?.maxFeePerGas,
        maxPriorityFeePerGas: dappEvmRequest?.maxPriorityFeePerGas,
        type: dappEvmRequest?.type,
        gasLane: modelPreferences.evmGasLane
      })
      if (!cancelled) {
        setEstimatedNetworkFee(preview.fee || fallback)
        setIsEstimatingNetworkFee(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [
    activeNetwork,
    activeNetworkLogos,
    displayNetworkId,
    amount,
    assetId,
    dappEvmRequest,
    fromAddress,
    isAssetTransfer,
    modelPreferences.evmGasLane,
    toAddress
  ])

  const TABS = [
    { id: 'details', label: 'DETAILS' },
    { id: 'data', label: 'DATA' },
    { id: 'hex', label: 'HEX' }
  ]
  const dataTabText = useMemo(() => {
    const payload = isDappTxRoute && pendingDappRequest
      ? {
          origin: pendingDappRequest.origin,
          method: pendingDappRequest.method,
          networkId: pendingDappRequest.networkId,
          accountId: pendingDappRequest.accountId,
          request: pendingDappRequest.request
        }
      : {
          method: isAssetTransfer ? 'send_asset' : 'send',
          params: isAssetTransfer ? [assetId, toAddress || 'N/A', amount || '0'] : [toAddress || 'N/A', amount || '0'],
          ...(memo ? { memo } : {}),
          ...(donationEnabled && !isAssetTransfer
            ? {
                donation: {
                  enabled: true,
                  percent: donationPercent,
                  mode: donationMode,
                  amount: formatCoinAmount(donationAmount),
                  address: donationAddress || 'N/A',
                  required: donationRequired
                }
              }
            : {})
        }
    try {
      return JSON.stringify(payload, null, 2)
    } catch {
      return String(payload)
    }
  }, [
    amount,
    assetId,
    donationAddress,
    donationAmount,
    donationEnabled,
    donationMode,
    donationPercent,
    donationRequired,
    isAssetTransfer,
    isDappTxRoute,
    memo,
    pendingDappRequest,
    toAddress
  ])
  const hexTabText = dappDataHex || String(txState.dataHex || '').trim() || 'No hex data for this transfer'

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
    if (isDappTxRoute && loadingDappRequest) {
      setSubmitError('Loading transaction request')
      return
    }
    if (isDappTxRoute && !pendingDappRequest) {
      setSubmitError('No pending dapp transaction to confirm')
      return
    }
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
    const previousNetworkId = String(activeNetworkId || '').trim()
    const previousAccountId = String(activeAccountId || '').trim()
    const shouldRestoreNetwork = Boolean(isDappTxRoute && pendingDappRequest && previousNetworkId && previousNetworkId !== pendingDappRequest.networkId)
    const shouldRestoreAccount = Boolean(isDappTxRoute && pendingDappRequest && previousAccountId && previousAccountId !== pendingDappRequest.accountId)

    try {
      if (isDappTxRoute && pendingDappRequest) {
        if (!canUseChromeStorage()) {
          throw new Error('Extension storage is unavailable')
        }

        await chrome.storage.local.set({
          [DAPP_PENDING_REQUEST_STORAGE_KEY]: {
            ...pendingDappRequest,
            status: 'approved',
            updatedAt: Date.now()
          }
        })

        if (activeNetworkId !== pendingDappRequest.networkId) {
          await setActiveNetwork(pendingDappRequest.networkId)
        }
        if (activeAccountId !== pendingDappRequest.accountId) {
          setActiveAccount(pendingDappRequest.accountId)
        }
      }

      let txHash = ''
      let txResult: { hash?: string; txid?: string } | null = null
      if (isAssetTransfer) {
        if (!assetId) throw new Error('Asset id missing from transaction request')
        const sent = await sendAssetTransfer({
          assetId,
          qty: amount,
          toAddress: toAddress,
          memo
        })
        txResult = sent
        txHash = String(sent.txid || '').trim()
      } else if (activeNetwork.coinType === 'EVM') {
        const evmRequest = isDappTxRoute && isDappEvmTransactionRequest(pendingDappRequest?.request)
          ? pendingDappRequest.request
          : null
        const res = await sendEvmTransaction(
          evmRequest
            ? {
                to: toAddress || undefined,
                value: amount,
                data: String(evmRequest.data || '').trim() || undefined,
                gasLimit: String(evmRequest.gasLimit || '').trim() || undefined,
                gasPrice: String(evmRequest.gasPrice || '').trim() || undefined,
                maxFeePerGas: String(evmRequest.maxFeePerGas || '').trim() || undefined,
                maxPriorityFeePerGas: String(evmRequest.maxPriorityFeePerGas || '').trim() || undefined,
                type: evmRequest.type
              }
            : { to: toAddress, amount }
        )
        txResult = res
        txHash = String(res.hash || '').trim()
      } else if (activeNetwork.coinType === 'XRP') {
        const res = await sendXrpTransaction({ to: toAddress, amount })
        txResult = res
        txHash = String(res.hash || '').trim()
      } else if (activeModelId === 'ada') {
        const res = await sendCardanoTransaction({ to: toAddress, amount })
        txResult = res
        txHash = String(res.hash || '').trim()
      } else if (activeModelId === 'xmr') {
        const res = await sendMoneroTransaction({ to: toAddress, amount })
        txResult = res
        txHash = String(res.hash || '').trim()
      } else if (activeModelId === 'sol') {
        const res = await sendSolanaTransaction({ to: toAddress, amount })
        txResult = res
        txHash = String(res.hash || '').trim()
      } else if (activeModelId === 'xlm') {
        const res = await sendStellarTransaction({ to: toAddress, amount })
        txResult = res
        txHash = String(res.hash || '').trim()
      } else if (activeModelId === 'tron') {
        const res = await sendTronTransaction({ to: toAddress, amount })
        txResult = res
        txHash = String(res.hash || '').trim()
      } else if (isCosmosLikeModelId(activeModelId)) {
        const res = await sendUtxoTransaction({ to: toAddress, amount, memo })
        txResult = res
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
        txResult = res
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

      if (isDappTxRoute && pendingDappRequest) {
        await chrome.storage.local.set({
          [DAPP_PENDING_REQUEST_STORAGE_KEY]: {
            ...pendingDappRequest,
            status: 'executed',
            result: txResult,
            updatedAt: Date.now()
          }
        })
      }

      if (isDappTxRoute) {
        navigate('/wallet/assets')
        window.close()
        return
      }
      navigate('/connecting')
    } catch (e: any) {
      const message = String(e?.message ?? 'Transaction failed')
      setSubmitError(message)
      if (isDappTxRoute && pendingDappRequest && canUseChromeStorage()) {
        await chrome.storage.local.set({
          [DAPP_PENDING_REQUEST_STORAGE_KEY]: {
            ...pendingDappRequest,
            status: 'failed',
            error: { code: -32603, message },
            updatedAt: Date.now()
          }
        })
        navigate('/wallet/assets')
        window.close()
      }
    } finally {
      if (isDappTxRoute && pendingDappRequest) {
        try {
          if (shouldRestoreAccount) {
            setActiveAccount(previousAccountId)
          }
          if (shouldRestoreNetwork) {
            await setActiveNetwork(previousNetworkId, { skipRefresh: true })
          }
        } catch {
          // Keep the dapp request outcome authoritative even if UI restoration fails.
        }
      }
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (isDappTxRoute && pendingDappRequest && canUseChromeStorage()) {
      await chrome.storage.local.set({
        [DAPP_PENDING_REQUEST_STORAGE_KEY]: {
          ...pendingDappRequest,
          status: 'rejected',
          error: { code: 4001, message: 'User rejected the request' },
          updatedAt: Date.now()
        }
      })
      navigate('/wallet/assets')
      window.close()
      return
    }
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

  const content = (
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
        {isDappTxRoute && loadingDappRequest && (
          <div className="p-3 bg-dark-900/60 border border-dark-600 rounded-xl text-xs text-gray-300">
            Loading dapp transaction request...
          </div>
        )}

        {isDappTxRoute && !loadingDappRequest && !pendingDappRequest && (
          <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-xl text-xs text-red-300">
            No pending dapp transaction request was found.
          </div>
        )}

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
                      {isEstimatingNetworkFee ? 'Updating from network...' : 'Live quote when available'}
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
            <pre className="bg-dark-900 p-4 rounded-xl border border-dark-600 font-mono text-[10px] text-gray-400 whitespace-pre-wrap break-all">{dataTabText}</pre>
          )}

          {activeTab === 'hex' && (
            <div className="bg-dark-900 p-4 rounded-xl border border-dark-600 font-mono text-[10px] text-gray-500 break-all leading-tight">
              {hexTabText}
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
          onClick={() => { void handleReject() }}
        >
          Reject
        </Button>
        <Button
          className="flex-1 btn-primary"
          onClick={handleConfirm}
          disabled={isRejectMode || isSubmitting || loadingDappRequest || !(isAssetTransfer ? caps.features.assetSend : caps.features.nativeSend) || !hasTxState || sendBlockedBySync}
          isLoading={isSubmitting}
        >
          Confirm
        </Button>
      </footer>
    </div>
  )

  if (isDappTxRoute && isLocked) {
    return (
      <PasswordGate
        title="Unlock to confirm transfer"
        description="Unlock your wallet to review this website transfer and press Confirm."
      >
        {content}
      </PasswordGate>
    )
  }

  return content
}

export const TxConfirm: React.FC = () => <TxLayout title="CONFIRM TRANSFER" />
export const TxReject: React.FC = () => <TxLayout title="REJECT" error="Insufficient funds" isRejectMode />

export default TxConfirm

