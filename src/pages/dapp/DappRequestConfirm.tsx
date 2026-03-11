import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { PasswordGate } from '../../components/PasswordGate'
import {
  DAPP_PENDING_REQUEST_STORAGE_KEY,
  parseDappPendingRequest,
  type DappPendingRequest,
  type DappSendEvmTransactionPayload
} from '../../lib/dappPermissions'
import { useWalletStore } from '../../store/walletStore'
import { getSendBlockedSyncReason, isSendBlockedBySync } from '../../lib/sendSyncPolicy'
import { isCosmosLikeModelId, resolveRuntimeModelId } from '../../lib/runtimeModel'
import {
  broadcastCosmosTx,
  signCosmosAmino,
  deriveCosmosKeyData,
  signCosmosDirect,
  signEvmMessage,
  signEvmTransaction,
  signEvmTypedData,
  signAndSendEvmTransaction,
  signSolanaMessage,
  signSolanaTransaction,
  signSolanaTransactions,
  signAndSendSolanaTransaction
} from '../../lib/dappSigning'

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function isDappEvmTransactionRequest(request: DappPendingRequest['request'] | null | undefined): request is DappSendEvmTransactionPayload {
  return Boolean(request && typeof request === 'object' && 'data' in request)
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? value as Record<string, any> : null
}

function previewJson(value: unknown, maxLength = 240): string {
  try {
    const json = JSON.stringify(value)
    if (!json) return ''
    return json.length > maxLength ? `${json.slice(0, maxLength)}...` : json
  } catch {
    return String(value ?? '')
  }
}

const DappRequestConfirm: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    isLocked,
    networks,
    activeNetworkId,
    activeAccountId,
    setActiveNetwork,
    setActiveAccount,
    sendEvmTransaction,
    sendXrpTransaction,
    sendCardanoTransaction,
    sendMoneroTransaction,
    sendSolanaTransaction,
    sendStellarTransaction,
    sendTronTransaction,
    sendUtxoTransaction,
    sendAssetTransfer,
    refreshActiveBalance,
    addActivity,
    trackActivityTransactionStatus,
    isConnected,
    isSyncing,
    syncPercent,
    lowSyncStreak
  } = useWalletStore()
  const [pendingRequest, setPendingRequest] = useState<DappPendingRequest | null>(null)
  const [loadingRequest, setLoadingRequest] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const requestedId = useMemo(
    () => new URLSearchParams(location.search).get('id') || '',
    [location.search]
  )

  const activeNetwork = useMemo(
    () => networks.find((n) => n.id === activeNetworkId) || networks[0],
    [networks, activeNetworkId]
  )
  const requestNetwork = useMemo(
    () => networks.find((n) => n.id === pendingRequest?.networkId) || activeNetwork,
    [networks, pendingRequest, activeNetwork]
  )
  const requestModelId = resolveRuntimeModelId(requestNetwork)
  const requestPayload = asRecord(pendingRequest?.request)
  const requestMethod = String(pendingRequest?.method || '').trim()
  const requestIsAssetSend = pendingRequest?.method === 'wallet_sendAsset'
  const requestIsEvmTx = !requestIsAssetSend && isDappEvmTransactionRequest(pendingRequest?.request)
  const requestIsSignMessage = requestMethod === 'wallet_signMessage'
  const requestIsSignTypedData = requestMethod === 'wallet_signTypedData'
  const requestIsSignTransaction = requestMethod === 'wallet_signTransaction'
  const requestIsSignAllTransactions = requestMethod === 'wallet_signAllTransactions'
  const requestIsSignAndSendTransaction = requestMethod === 'wallet_signAndSendTransaction'
  const requestIsCosmosSignDirect = requestMethod === 'wallet_cosmosSignDirect'
  const requestIsCosmosSignAmino = requestMethod === 'wallet_cosmosSignAmino'
  const requestIsCosmosSendTx = requestMethod === 'wallet_cosmosSendTx'
  const requestIsCosmosGetKey = requestMethod === 'wallet_cosmosGetKey'
  const requestTypeLabel = requestIsAssetSend
    ? 'Asset Transfer'
    : requestIsSignMessage
    ? 'Message Signature'
    : requestIsSignTypedData
    ? 'Typed Data Signature'
    : requestIsSignTransaction
    ? 'Transaction Signature'
    : requestIsSignAllTransactions
    ? 'Batch Transaction Signature'
    : requestIsSignAndSendTransaction
    ? 'Sign And Send Transaction'
    : requestIsCosmosSignDirect
    ? 'Cosmos Direct Signature'
    : requestIsCosmosSignAmino
    ? 'Cosmos Amino Signature'
    : requestIsCosmosGetKey
    ? 'Cosmos Account Access'
    : requestIsCosmosSendTx
    ? 'Cosmos Broadcast'
    : requestIsEvmTx
    ? (String((pendingRequest?.request as DappSendEvmTransactionPayload | undefined)?.to || '').trim() ? 'Contract Call' : 'Contract Deployment')
    : 'Native Coin Transfer'
  const requestTo = requestIsAssetSend
    ? String((pendingRequest?.request as any)?.toAddress || '')
    : requestIsSignMessage
    ? String(requestPayload?.address || requestPayload?.signer || '')
    : requestIsSignTypedData
    ? String(requestPayload?.address || requestPayload?.signer || '')
    : requestIsSignTransaction || requestIsSignAndSendTransaction
    ? String(requestPayload?.to || requestPayload?.address || '').trim() || 'Serialized Transaction'
    : requestIsCosmosSignDirect || requestIsCosmosSignAmino
    ? String(requestPayload?.signerAddress || requestPayload?.address || '')
    : requestIsCosmosGetKey
    ? String(requestPayload?.chainId || '')
    : requestIsCosmosSendTx
    ? String(requestPayload?.chainId || requestPayload?.mode || '').trim() || 'Broadcast'
    : requestIsEvmTx
    ? String((pendingRequest?.request as DappSendEvmTransactionPayload | undefined)?.to || '').trim() || 'Contract Creation'
    : String((pendingRequest?.request as any)?.to || '')
  const requestAmount = requestIsAssetSend
    ? String((pendingRequest?.request as any)?.qty || '')
    : requestIsSignMessage
    ? `${String(requestPayload?.message || '').length} bytes`
    : requestIsSignTypedData
    ? 'Typed payload'
    : requestIsSignTransaction || requestIsSignAndSendTransaction
    ? String(requestPayload?.value || requestPayload?.amount || '')
    : requestIsSignAllTransactions
    ? `${Array.isArray(requestPayload?.serializedTxsBase64) ? requestPayload?.serializedTxsBase64.length : 0} txs`
    : requestIsCosmosSignDirect || requestIsCosmosSignAmino
    ? String(requestPayload?.chainId || '')
    : requestIsCosmosGetKey
    ? 'Account metadata'
    : requestIsCosmosSendTx
    ? String(requestPayload?.mode || '')
    : requestIsEvmTx
    ? String(
      (pendingRequest?.request as DappSendEvmTransactionPayload | undefined)?.value
      || (pendingRequest?.request as DappSendEvmTransactionPayload | undefined)?.amount
      || '0'
    )
    : String((pendingRequest?.request as any)?.amount || '')
  const requestMemo = String((pendingRequest?.request as any)?.memo || '').trim()
  const requestAssetId = requestIsAssetSend
    ? String((pendingRequest?.request as any)?.assetId || '')
    : ''
  const requestData = requestIsEvmTx
    ? String((pendingRequest?.request as DappSendEvmTransactionPayload | undefined)?.data || '').trim()
    : ''
  const requestGasLimit = requestIsEvmTx
    ? String((pendingRequest?.request as DappSendEvmTransactionPayload | undefined)?.gasLimit || '').trim()
    : ''
  const requestGasPrice = requestIsEvmTx
    ? String((pendingRequest?.request as DappSendEvmTransactionPayload | undefined)?.gasPrice || '').trim()
    : ''
  const requestMaxFeePerGas = requestIsEvmTx
    ? String((pendingRequest?.request as DappSendEvmTransactionPayload | undefined)?.maxFeePerGas || '').trim()
    : ''
  const requestMaxPriorityFeePerGas = requestIsEvmTx
    ? String((pendingRequest?.request as DappSendEvmTransactionPayload | undefined)?.maxPriorityFeePerGas || '').trim()
    : ''
  const requestTxType = requestIsEvmTx
    ? (pendingRequest?.request as DappSendEvmTransactionPayload | undefined)?.type
    : undefined
  const requestPreview = requestIsSignMessage
    ? previewJson(requestPayload?.message || '')
    : requestIsSignTypedData
    ? previewJson(requestPayload?.typedData)
    : requestIsSignTransaction || requestIsSignAndSendTransaction
    ? previewJson(requestPayload?.tx || requestPayload)
    : requestIsCosmosSignDirect || requestIsCosmosSignAmino
    ? previewJson(requestPayload?.signDoc || requestPayload)
    : requestIsCosmosGetKey
    ? previewJson({ chainId: requestPayload?.chainId, network: requestNetwork?.name })
    : requestIsCosmosSendTx
    ? previewJson({ mode: requestPayload?.mode, txBytesBase64: String(requestPayload?.txBytesBase64 || '').slice(0, 48) })
    : ''
  const sendBlockedBySync = isSendBlockedBySync(isSyncing, syncPercent, isConnected, lowSyncStreak)
  const syncBlockedReason = getSendBlockedSyncReason(isSyncing, syncPercent, isConnected, lowSyncStreak)

  useEffect(() => {
    if (!canUseChromeStorage()) {
      setLoadingRequest(false)
      return
    }

    let mounted = true

    const applyPendingValue = (rawValue: unknown): void => {
      const parsed = parseDappPendingRequest(rawValue)
      if (!mounted) return
      if (!parsed || (requestedId && parsed.id !== requestedId)) {
        setPendingRequest(null)
        setLoadingRequest(false)
        return
      }
      if (parsed.status !== 'pending' && parsed.status !== 'approved') {
        setPendingRequest(null)
        setLoadingRequest(false)
        return
      }
      setPendingRequest(parsed)
      setLoadingRequest(false)
    }

    void chrome.storage.local
      .get(DAPP_PENDING_REQUEST_STORAGE_KEY)
      .then((result) => {
        applyPendingValue(result[DAPP_PENDING_REQUEST_STORAGE_KEY])
      })
      .catch(() => {
        if (!mounted) return
        setPendingRequest(null)
        setLoadingRequest(false)
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
  }, [requestedId])

  useEffect(() => {
    if (!pendingRequest) return
    const isWalletSendRoute =
      pendingRequest.method === 'wallet_sendAsset'
      || (pendingRequest.method === 'wallet_sendTransaction' && !requestIsEvmTx)
    if (!isWalletSendRoute) return
    navigate(`/tx/confirm?dappRequest=1&id=${encodeURIComponent(pendingRequest.id)}`, { replace: true })
  }, [navigate, pendingRequest, requestIsEvmTx])

  const rejectRequest = async (): Promise<void> => {
    if (canUseChromeStorage() && pendingRequest) {
      await chrome.storage.local.set({
        [DAPP_PENDING_REQUEST_STORAGE_KEY]: {
          ...pendingRequest,
          status: 'rejected',
          error: { code: 4001, message: 'User rejected the request' },
          updatedAt: Date.now()
        }
      })
    }
    navigate('/wallet/assets')
    window.close()
  }

  const approveRequest = async (): Promise<void> => {
    if (!pendingRequest || isSubmitting) return
    setSubmitError('')
    if (sendBlockedBySync) {
      setSubmitError(syncBlockedReason)
      return
    }
    setIsSubmitting(true)
    const previousNetworkId = String(activeNetworkId || '').trim()
    const previousAccountId = String(activeAccountId || '').trim()
    const shouldRestoreNetwork = Boolean(previousNetworkId) && previousNetworkId !== pendingRequest.networkId
    const shouldRestoreAccount = Boolean(previousAccountId) && previousAccountId !== pendingRequest.accountId

    try {
      if (!canUseChromeStorage()) {
        throw new Error('Extension storage is unavailable')
      }

      await chrome.storage.local.set({
        [DAPP_PENDING_REQUEST_STORAGE_KEY]: {
          ...pendingRequest,
          status: 'approved',
          updatedAt: Date.now()
        }
      })

      if (activeNetworkId !== pendingRequest.networkId) {
        await setActiveNetwork(pendingRequest.networkId)
      }
      if (activeAccountId !== pendingRequest.accountId) {
        setActiveAccount(pendingRequest.accountId)
      }

      const latestBeforeRequest = useWalletStore.getState()
      const accountForRequest = latestBeforeRequest.accounts.find((a) => a.id === pendingRequest.accountId) || latestBeforeRequest.accounts[0]
      const accountIndex = Number.isInteger(accountForRequest?.derivationIndex)
        ? Number(accountForRequest?.derivationIndex)
        : Math.max(0, latestBeforeRequest.accounts.findIndex((a) => a.id === pendingRequest.accountId))
      const mnemonic = String(latestBeforeRequest.sessionMnemonic || '').trim()
      if (
        (requestIsSignMessage
          || requestIsSignTypedData
          || requestIsSignTransaction
          || requestIsSignAllTransactions
          || requestIsSignAndSendTransaction
          || requestIsCosmosSignDirect
          || requestIsCosmosSignAmino)
        && !mnemonic
      ) {
        throw new Error('Wallet is locked')
      }

      const tx = requestIsAssetSend
        ? await sendAssetTransfer({
            assetId: requestAssetId,
            qty: requestAmount,
            toAddress: requestTo,
            memo: requestMemo
          })
        : requestIsSignMessage
        ? await (async () => {
            const ecosystem = String(requestPayload?.ecosystem || '').trim().toLowerCase()
            if (ecosystem === 'solana' || requestModelId === 'sol') {
              return await signSolanaMessage({
                mnemonic,
                accountIndex,
                messageBase64: String(requestPayload?.messageBase64 || '')
              })
            }
            return {
              signature: await signEvmMessage({
                mnemonic,
                accountIndex,
                message: String(requestPayload?.message || ''),
                encoding: String(requestPayload?.encoding || 'utf8').trim().toLowerCase() === 'hex' ? 'hex' : 'utf8'
              })
            }
          })()
        : requestIsSignTypedData
        ? {
            signature: await signEvmTypedData({
              mnemonic,
              accountIndex,
              typedData: requestPayload?.typedData
            })
          }
        : requestIsSignTransaction
        ? await (async () => {
            const ecosystem = String(requestPayload?.ecosystem || '').trim().toLowerCase()
            if (ecosystem === 'solana' || requestModelId === 'sol') {
              return {
                signedTxBase64: await signSolanaTransaction({
                  mnemonic,
                  accountIndex,
                  serializedTxBase64: String(requestPayload?.serializedTxBase64 || '')
                })
              }
            }
            return {
              signedTransaction: await signEvmTransaction({
                mnemonic,
                accountIndex,
                tx: requestPayload?.tx || requestPayload || {}
              })
            }
          })()
        : requestIsSignAllTransactions
        ? {
            signedTxsBase64: await signSolanaTransactions({
              mnemonic,
              accountIndex,
              serializedTxsBase64: Array.isArray(requestPayload?.serializedTxsBase64)
                ? requestPayload.serializedTxsBase64.map((row: unknown) => String(row || ''))
                : []
            })
          }
        : requestIsSignAndSendTransaction
        ? await (async () => {
            const ecosystem = String(requestPayload?.ecosystem || '').trim().toLowerCase()
            if (ecosystem === 'evm') {
              return await signAndSendEvmTransaction({
                mnemonic,
                accountIndex,
                rpcUrl: String(requestNetwork?.rpcUrl || ''),
                tx: requestPayload?.tx || requestPayload || {}
              })
            }
            return await signAndSendSolanaTransaction({
              mnemonic,
              accountIndex,
              rpcUrl: String(requestNetwork?.rpcUrl || ''),
              serializedTxBase64: String(requestPayload?.serializedTxBase64 || '')
            })
          })()
        : requestIsCosmosSignDirect
        ? await signCosmosDirect({
            mnemonic,
            accountIndex,
            network: requestNetwork,
            signDoc: requestPayload?.signDoc
          })
        : requestIsCosmosSignAmino
        ? await signCosmosAmino({
            mnemonic,
            accountIndex,
            network: requestNetwork,
            signDoc: requestPayload?.signDoc
          })
        : requestIsCosmosGetKey
        ? await deriveCosmosKeyData({
            mnemonic,
            accountIndex,
            network: requestNetwork
          })
        : requestIsCosmosSendTx
        ? await broadcastCosmosTx({
            rpcUrl: String(requestNetwork?.rpcUrl || ''),
            txBytesBase64: String(requestPayload?.txBytesBase64 || ''),
            mode:
              requestPayload?.mode === 'BROADCAST_MODE_SYNC'
              || requestPayload?.mode === 'BROADCAST_MODE_ASYNC'
              || requestPayload?.mode === 'BROADCAST_MODE_BLOCK'
                ? requestPayload.mode
                : undefined
          })
        : requestNetwork.coinType === 'EVM'
        ? await sendEvmTransaction({
            ...(requestIsEvmTx
              ? {
                  to: requestTo === 'Contract Creation' ? undefined : requestTo,
                  value: requestAmount,
                  data: requestData,
                  gasLimit: requestGasLimit || undefined,
                  gasPrice: requestGasPrice || undefined,
                  maxFeePerGas: requestMaxFeePerGas || undefined,
                  maxPriorityFeePerGas: requestMaxPriorityFeePerGas || undefined,
                  type: requestTxType
                }
              : {
                  to: requestTo,
                  amount: requestAmount
                })
          })
        : requestNetwork.coinType === 'XRP'
        ? await sendXrpTransaction({
            to: requestTo,
            amount: requestAmount
          })
        : requestModelId === 'ada'
        ? await sendCardanoTransaction({
            to: requestTo,
            amount: requestAmount
          })
        : requestModelId === 'xmr'
        ? await sendMoneroTransaction({
            to: requestTo,
            amount: requestAmount
          })
        : requestModelId === 'sol'
        ? await sendSolanaTransaction({
            to: requestTo,
            amount: requestAmount
          })
        : requestModelId === 'xlm'
        ? await sendStellarTransaction({
            to: requestTo,
            amount: requestAmount
          })
        : requestModelId === 'tron'
        ? await sendTronTransaction({
            to: requestTo,
            amount: requestAmount
          })
        : isCosmosLikeModelId(requestModelId)
        ? await sendUtxoTransaction({
            to: requestTo,
            amount: requestAmount,
            memo: requestMemo
          })
        : await sendUtxoTransaction({
          to: requestTo,
          amount: requestAmount,
          memo: requestMemo
        })
      const txHash = String((tx as any)?.hash || (tx as any)?.txid || (tx as any)?.signature || (tx as any)?.txhash || '').trim()

      if (txHash && !requestIsSignMessage && !requestIsSignTypedData && !requestIsSignTransaction && !requestIsSignAllTransactions && !requestIsCosmosSignDirect && !requestIsCosmosSignAmino && !requestIsCosmosGetKey) {
        const latestState = useWalletStore.getState()
        const networkForActivity = latestState.networks.find((n) => n.id === pendingRequest.networkId) || latestState.networks[0]
        const accountForActivity = latestState.accounts.find((a) => a.id === pendingRequest.accountId) || latestState.accounts[0]
        const senderAddress = String(
          accountForActivity?.networkAddresses?.[pendingRequest.networkId]
          || (networkForActivity?.coinType === 'EVM' ? accountForActivity?.addresses?.EVM : '')
          || (networkForActivity?.coinType === 'XRP' ? accountForActivity?.addresses?.XRP : '')
          || ''
        ).trim()

        if (networkForActivity) {
          addActivity({
            id: txHash,
            type: 'sent',
            asset: requestIsAssetSend ? requestAssetId : networkForActivity.symbol,
            amount: requestAmount || '0',
            from: senderAddress,
            to: requestIsEvmTx && requestTo === 'Contract Creation' ? undefined : requestTo || undefined,
            accountId: pendingRequest.accountId,
            status: 'pending',
            timestamp: Date.now(),
            networkId: networkForActivity.id
          })
          trackActivityTransactionStatus({ txid: txHash, networkId: networkForActivity.id })
        }
        await refreshActiveBalance()
      }

      await chrome.storage.local.set({
        [DAPP_PENDING_REQUEST_STORAGE_KEY]: {
          ...pendingRequest,
          status: 'executed',
          result: tx,
          updatedAt: Date.now()
        }
      })

      navigate('/wallet/assets')
      window.close()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || 'Transaction failed')
      setSubmitError(message)

      if (canUseChromeStorage() && pendingRequest) {
        await chrome.storage.local.set({
          [DAPP_PENDING_REQUEST_STORAGE_KEY]: {
            ...pendingRequest,
            status: 'failed',
            error: { code: -32603, message },
            updatedAt: Date.now()
          }
        })
      }
      navigate('/wallet/assets')
      window.close()
    } finally {
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
      setIsSubmitting(false)
    }
  }

  const content = (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="p-4 flex items-center justify-between border-b border-dark-600">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Dapp Transaction Request</span>
      </header>

      <div className="flex-1 p-6 space-y-6 overflow-y-auto custom-scrollbar">
        {loadingRequest ? (
          <div className="text-center text-xs text-gray-400">Loading request...</div>
        ) : null}

        {!loadingRequest && !pendingRequest ? (
          <div className="text-center text-sm text-gray-400">No pending transaction request.</div>
        ) : null}

        {pendingRequest ? (
          <>
            <div className="space-y-2 text-center">
              <h2 className="text-lg font-bold">Approve transaction</h2>
              <p className="text-xs text-gray-400 break-all">{pendingRequest.origin}</p>
            </div>

            <div className="p-4 rounded-xl border border-dark-600 bg-dark-700/50 space-y-3">
              <Row label="Network" value={requestNetwork?.name || pendingRequest.networkId} />
              <Row label="Runtime Model" value={String(requestNetwork?.runtimeModelId || requestNetwork?.id || 'unknown')} mono />
              <Row label="Method" value={requestMethod} mono />
              <Row label="Type" value={requestTypeLabel} />
              {requestTo ? <Row label="To" value={requestTo} mono /> : null}
              {requestIsAssetSend ? <Row label="Asset" value={requestAssetId} mono /> : null}
              {requestAmount ? (
                <Row
                  label={requestIsEvmTx ? 'Value' : 'Amount'}
                  value={`${requestAmount} ${requestIsAssetSend ? '' : (requestNetwork?.symbol || '')}`.trim()}
                />
              ) : null}
              {requestMemo ? <Row label="Memo" value={requestMemo} mono /> : null}
              {requestData ? <Row label="Data" value={requestData} mono /> : null}
              {requestPreview ? <Row label="Preview" value={requestPreview} mono /> : null}
              {requestGasLimit ? <Row label="Gas Limit" value={requestGasLimit} mono /> : null}
              {requestGasPrice ? <Row label="Gas Price" value={requestGasPrice} mono /> : null}
              {requestMaxFeePerGas ? <Row label="Max Fee" value={requestMaxFeePerGas} mono /> : null}
              {requestMaxPriorityFeePerGas ? <Row label="Priority Fee" value={requestMaxPriorityFeePerGas} mono /> : null}
              {requestTxType ? <Row label="Tx Type" value={String(requestTxType)} mono /> : null}
            </div>

            {submitError ? (
              <p className="text-xs text-red-400 break-words">{submitError}</p>
            ) : null}
            {!submitError && sendBlockedBySync ? (
              <p className="text-xs text-yellow-300 break-words">{syncBlockedReason}</p>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="p-4 border-t border-dark-600 flex gap-4">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => { void rejectRequest() }}
          disabled={isSubmitting}
        >
          Reject
        </Button>
        <Button
          className="flex-1 btn-primary"
          onClick={() => { void approveRequest() }}
          isLoading={isSubmitting}
          disabled={!pendingRequest || sendBlockedBySync}
        >
          Approve
        </Button>
      </footer>
    </div>
  )

  if (isLocked) {
    return (
      <PasswordGate
        title="Unlock to approve transaction"
        description="Enter your wallet password to review and approve this dApp request."
      >
        {content}
      </PasswordGate>
    )
  }

  return content
}

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono = false }) => (
  <div className="flex flex-col gap-1">
    <p className="text-[10px] text-gray-500 uppercase tracking-widest">{label}</p>
    <p className={mono ? 'text-xs text-gray-200 font-mono break-all' : 'text-sm text-gray-200'}>{value}</p>
  </div>
)

export default DappRequestConfirm
