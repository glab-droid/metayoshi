import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useWalletStore, type Network, type SendableItem } from '../../store/walletStore'
import { Input } from '../../components/Input'
import SendTransferForm from '../../components/send/SendTransferForm'
import { resolveNetworkCapabilities } from '../../lib/networkCapabilities'
import { getAccountDisplayName } from '../../lib/accountName'
import { getEnabledNetworks } from '../../lib/networkVisibility'
import { EVM_ETHEREUM_L2_COIN_IDS } from '../../coins/coinSelection'
import { getUnifiedLogoByName } from '../../coins/logos'
import { findBundledTokenLogoForAsset, getTokenLogoForAsset } from '../../coins/tokenlogos'
import {
  IoArrowBackOutline,
  IoChevronDownOutline,
  IoChevronForwardOutline,
  IoInformationCircleOutline,
  IoLayersOutline,
  IoPin,
  IoRefreshOutline,
  IoSearchOutline
} from 'react-icons/io5'
import { isCosmosLikeModelId, resolveRuntimeModelId } from '../../lib/runtimeModel'

function formatUnits8(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 })
}

function formatUnits8Plain(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return value.toFixed(8).replace(/\.?0+$/, '')
}

function formatRawAmountPlain(rawAmount: number): string {
  return formatUnits8Plain(Math.max(0, Number(rawAmount || 0)) / 1e8)
}

function parseCoinAmount(value: unknown): number {
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function estimateNativeSendFee(network: { coinType: string; feePerByte?: number }): number {
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

function shortAddress(address: string): string {
  const raw = String(address || '').trim()
  if (!raw) return 'Address unavailable'
  if (raw.length <= 14) return raw
  return `${raw.slice(0, 8)}...${raw.slice(-6)}`
}

type TokenCircleLogoProps = {
  logoUrl?: string
  assetName: string
  alt: string
  className: string
}

const TokenCircleLogo: React.FC<TokenCircleLogoProps> = ({ logoUrl, assetName, alt, className }) => {
  const bundledLogo = useMemo(() => findBundledTokenLogoForAsset(assetName), [assetName])
  const fallbackLogo = useMemo(() => getTokenLogoForAsset(assetName), [assetName])
  const remoteLogo = String(logoUrl || '').trim()
  const [resolvedSrc, setResolvedSrc] = useState(bundledLogo || fallbackLogo)

  useEffect(() => {
    if (bundledLogo) {
      setResolvedSrc(bundledLogo)
      return
    }

    if (!remoteLogo) {
      setResolvedSrc(fallbackLogo)
      return
    }

    let cancelled = false
    const probe = new Image()
    probe.onload = () => {
      if (!cancelled) setResolvedSrc(remoteLogo)
    }
    probe.onerror = () => {
      if (!cancelled) setResolvedSrc(fallbackLogo)
    }
    probe.src = remoteLogo

    return () => {
      cancelled = true
      probe.onload = null
      probe.onerror = null
    }
  }, [bundledLogo, remoteLogo, fallbackLogo])

  if (!resolvedSrc) {
    return <IoLayersOutline className="w-4.5 h-4.5 text-gray-300" />
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={() => setResolvedSrc(fallbackLogo)}
    />
  )
}

type SendRouteState = {
  assetId?: string
  sendEntryId?: string
  quickSendNative?: boolean
  hubMode?: 'global'
  autoScan?: boolean
}
type GlobalScanMode = 'auto' | 'manual'
type GlobalScanOptions = {
  reason?: string
  mode?: GlobalScanMode
  refreshBalances?: boolean
  forceAssetRefresh?: boolean
  resumeIfAvailable?: boolean
}
type SendHubScanDiagnostics = {
  mode: GlobalScanMode
  reason: string
  startedAt: number
  finishedAt: number
  durationMs: number
  totalSteps: number
  succeededSteps: number
  failedSteps: number
  lastFailure?: string
}

type ScanHolder = {
  key: string
  networkId: string
  networkSymbol: string
  accountId: string
  accountLabel: string
  address: string
  itemId: string
  assetId?: string
  requestType: 'native' | 'asset'
  kind: SendableItem['kind']
  label: string
  symbol: string
  logoUrl?: string
  rawAmount: number
  amount: string
}

type AggregatedScanRow = {
  key: string
  networkId: string
  networkSymbol: string
  networkName: string
  networkLogo?: string
  itemId: string
  assetId?: string
  requestType: 'native' | 'asset'
  kind: SendableItem['kind']
  label: string
  symbol: string
  logoUrl?: string
  rawAmount: number
  amount: string
  holders: ScanHolder[]
}

type SendHubScanCheckpoint = {
  mode: GlobalScanMode
  reason: string
  startedAt: number
  total: number
  done: number
  nextAccountIndex: number
  nextNetworkIndex: number
  accountIds: string[]
  networkIds: string[]
  originalActiveAccountId: string | null
  originalActiveNetworkId: string | null
}

type CachedScanPayload = {
  rows: AggregatedScanRow[]
  updatedAt: number
  checkpoint: SendHubScanCheckpoint | null
}

type BatchPlanRow = {
  holder: ScanHolder
  amountRaw: number
  amount: string
  skippedReason?: string
}

type BatchSendResult = {
  holder: ScanHolder
  amount: string
  ok: boolean
  txid?: string
  error?: string
}

type SendHubPreferences = {
  order: string[]
  pinned: string[]
}

const SEND_HUB_SCAN_CACHE_KEY = 'metayoshi:send-hub:global-scan:v1'
const SEND_HUB_PREFERENCES_KEY = 'metayoshi:send-hub:prefs:v1'
const SEND_HUB_SCAN_STALE_MS = 30_000
const SEND_HUB_SCAN_MAX_TPS = 5
const SEND_HUB_SCAN_STEP_DELAY_MS = Math.max(1, Math.trunc(1000 / SEND_HUB_SCAN_MAX_TPS))
const SEND_HUB_SCAN_STEP_TIMEOUT_MS = 20_000

function normalizeKeyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of raw) {
    const key = String(value || '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function readSendHubPreferences(): SendHubPreferences {
  try {
    const raw = localStorage.getItem(SEND_HUB_PREFERENCES_KEY)
    if (!raw) return { order: [], pinned: [] }
    const parsed = JSON.parse(raw) as Partial<SendHubPreferences>
    return {
      order: normalizeKeyList(parsed?.order),
      pinned: normalizeKeyList(parsed?.pinned)
    }
  } catch {
    return { order: [], pinned: [] }
  }
}

function writeSendHubPreferences(value: SendHubPreferences): void {
  try {
    localStorage.setItem(SEND_HUB_PREFERENCES_KEY, JSON.stringify({
      order: normalizeKeyList(value.order),
      pinned: normalizeKeyList(value.pinned)
    }))
  } catch {
    // ignore local storage failures
  }
}

function normalizeSendHubPreferencesForRows(
  value: SendHubPreferences,
  rows: AggregatedScanRow[]
): SendHubPreferences {
  const known = new Set(rows.map((row) => row.key))
  return {
    order: normalizeKeyList(value.order).filter((key) => known.has(key)),
    pinned: normalizeKeyList(value.pinned).filter((key) => known.has(key))
  }
}

function moveRowKeyBefore(keys: string[], draggedKey: string, targetKey: string): string[] {
  const dragged = String(draggedKey || '').trim()
  const target = String(targetKey || '').trim()
  if (!dragged || !target || dragged === target) return [...keys]
  const withoutDragged = keys.filter((key) => key !== dragged)
  const targetIndex = withoutDragged.indexOf(target)
  if (targetIndex < 0) return [...keys]
  withoutDragged.splice(targetIndex, 0, dragged)
  return withoutDragged
}

function applySendHubPreferences(
  rows: AggregatedScanRow[],
  preferences: SendHubPreferences
): AggregatedScanRow[] {
  const rankByKey = new Map<string, number>()
  normalizeKeyList(preferences.order).forEach((key) => {
    if (rankByKey.has(key)) return
    rankByKey.set(key, rankByKey.size)
  })
  const pinnedSet = new Set(normalizeKeyList(preferences.pinned))
  const baseIndexByKey = new Map<string, number>()
  rows.forEach((row, index) => {
    baseIndexByKey.set(row.key, index)
  })

  return [...rows].sort((a, b) => {
    const aPinned = pinnedSet.has(a.key)
    const bPinned = pinnedSet.has(b.key)
    if (aPinned !== bPinned) return aPinned ? -1 : 1

    const rankA = rankByKey.get(a.key)
    const rankB = rankByKey.get(b.key)
    const hasA = typeof rankA === 'number'
    const hasB = typeof rankB === 'number'
    if (hasA && hasB && rankA !== rankB) return rankA - rankB
    if (hasA !== hasB) return hasA ? -1 : 1

    return (baseIndexByKey.get(a.key) || 0) - (baseIndexByKey.get(b.key) || 0)
  })
}

type WriteCachedScanRowsOptions = {
  checkpoint?: SendHubScanCheckpoint | null
  preserveExistingCheckpoint?: boolean
}

function normalizeCachedScanCheckpoint(raw: unknown): SendHubScanCheckpoint | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<SendHubScanCheckpoint>
  const mode = value.mode === 'manual' ? 'manual' : (value.mode === 'auto' ? 'auto' : null)
  if (!mode) return null

  const accountIds = normalizeKeyList(value.accountIds)
  const networkIds = normalizeKeyList(value.networkIds)
  const startedAt = Number(value.startedAt || 0)
  const total = Math.max(0, Math.trunc(Number(value.total || 0)))
  const done = Math.max(0, Math.trunc(Number(value.done || 0)))
  const nextAccountIndex = Math.max(0, Math.trunc(Number(value.nextAccountIndex || 0)))
  const nextNetworkIndex = Math.max(0, Math.trunc(Number(value.nextNetworkIndex || 0)))

  return {
    mode,
    reason: String(value.reason || '').trim(),
    startedAt: Number.isFinite(startedAt) ? startedAt : 0,
    total,
    done,
    nextAccountIndex,
    nextNetworkIndex,
    accountIds,
    networkIds,
    originalActiveAccountId: String(value.originalActiveAccountId || '').trim() || null,
    originalActiveNetworkId: String(value.originalActiveNetworkId || '').trim() || null
  }
}

function readCachedScanRows(): CachedScanPayload | null {
  try {
    const raw = localStorage.getItem(SEND_HUB_SCAN_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedScanPayload>
    if (!Array.isArray(parsed?.rows)) return null
    const updatedAt = Number(parsed?.updatedAt || 0)
    return {
      rows: parsed.rows,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      checkpoint: normalizeCachedScanCheckpoint(parsed?.checkpoint)
    }
  } catch {
    return null
  }
}

function writeCachedScanRows(rows: AggregatedScanRow[], options?: WriteCachedScanRowsOptions): void {
  try {
    const checkpoint = options?.checkpoint !== undefined
      ? options.checkpoint
      : (options?.preserveExistingCheckpoint ? (readCachedScanRows()?.checkpoint || null) : null)
    const payload: CachedScanPayload = {
      rows,
      updatedAt: Date.now(),
      checkpoint
    }
    localStorage.setItem(SEND_HUB_SCAN_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // ignore storage quota/runtime failures
  }
}

function getNextScanCursor(accountIndex: number, networkIndex: number, networkCount: number): {
  nextAccountIndex: number
  nextNetworkIndex: number
} {
  if (networkCount <= 0) {
    return {
      nextAccountIndex: accountIndex + 1,
      nextNetworkIndex: 0
    }
  }
  if (networkIndex + 1 < networkCount) {
    return {
      nextAccountIndex: accountIndex,
      nextNetworkIndex: networkIndex + 1
    }
  }
  return {
    nextAccountIndex: accountIndex + 1,
    nextNetworkIndex: 0
  }
}

function getResumableScanCheckpoint(
  checkpoint: SendHubScanCheckpoint | null,
  scanAccounts: Array<{ id: string }>,
  scanNetworks: Array<{ id: string }>
): SendHubScanCheckpoint | null {
  if (!checkpoint) return null
  const accountIds = scanAccounts.map((account) => account.id)
  const networkIds = scanNetworks.map((network) => network.id)
  if (checkpoint.accountIds.length !== accountIds.length) return null
  if (checkpoint.networkIds.length !== networkIds.length) return null
  if (!checkpoint.accountIds.every((id, index) => id === accountIds[index])) return null
  if (!checkpoint.networkIds.every((id, index) => id === networkIds[index])) return null
  if (checkpoint.nextAccountIndex < 0 || checkpoint.nextAccountIndex >= scanAccounts.length) return null
  if (scanNetworks.length > 0 && (checkpoint.nextNetworkIndex < 0 || checkpoint.nextNetworkIndex >= scanNetworks.length)) {
    return null
  }
  const total = Math.max(1, accountIds.length * networkIds.length)
  return {
    ...checkpoint,
    total,
    done: Math.min(Math.max(0, checkpoint.done), total)
  }
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timeoutHandle = window.setTimeout(() => {
      if (settled) return
      // Do not start the next scan step while this one is still running.
      // We cannot hard-cancel deep store/rpc work here, so drain it first.
      void task
        .catch(() => undefined)
        .finally(() => {
          if (settled) return
          settled = true
          reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`))
        })
    }, timeoutMs)

    task
      .then((result) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeoutHandle)
        resolve(result)
      })
      .catch((error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeoutHandle)
        reject(error)
      })
  })
}

function sortAggregatedScanRows(rows: AggregatedScanRow[]): AggregatedScanRow[] {
  return [...rows]
    .map((row) => ({
      ...row,
      holders: [...row.holders].sort((a, b) => b.rawAmount - a.rawAmount)
    }))
    .sort((a, b) => {
      if (b.rawAmount !== a.rawAmount) return b.rawAmount - a.rawAmount
      if (a.networkName !== b.networkName) return a.networkName.localeCompare(b.networkName)
      return a.label.localeCompare(b.label)
    })
}

function formatDurationMs(value: number): string {
  const ms = Math.max(0, Math.round(Number(value || 0)))
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`
}

function buildNativeSweepAmountRaw(holderRawAmount: number, network?: Pick<Network, 'coinType' | 'feePerByte'>): number {
  const raw = Math.max(0, Math.round(Number(holderRawAmount || 0)))
  if (!network) return raw
  const estimatedFeeRaw = Math.max(0, Math.round(estimateNativeSendFee(network) * 1e8))
  return Math.max(0, raw - estimatedFeeRaw)
}

type SendBatchSweepFormProps = {
  row: AggregatedScanRow
  networkById: Map<string, Network>
  onBack: () => void
  onComplete?: () => void
}

const SendBatchSweepForm: React.FC<SendBatchSweepFormProps> = ({ row, networkById, onBack, onComplete }) => {
  const {
    networks,
    activeAccountId,
    activeNetworkId,
    setActiveAccount,
    setActiveNetwork,
    sendEvmTransaction,
    sendCardanoTransaction,
    sendSolanaTransaction,
    sendStellarTransaction,
    sendTronTransaction,
    sendUtxoTransaction,
    sendAssetTransfer,
    addActivity,
    trackActivityTransactionStatus,
    refreshActiveBalance
  } = useWalletStore()

  const [recipient, setRecipient] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<BatchSendResult[] | null>(null)

  const rowNetwork = networkById.get(row.networkId) || networks.find((network) => network.id === row.networkId) || networks[0]
  const rowCaps = resolveNetworkCapabilities(rowNetwork)
  const rowCanSend = row.requestType === 'native'
    ? rowCaps.features.nativeSend
    : rowCaps.features.assetSend

  const planRows = useMemo<BatchPlanRow[]>(() => (
    row.holders.map((holder) => {
      if (holder.requestType !== row.requestType) {
        return {
          holder,
          amountRaw: 0,
          amount: '0',
          skippedReason: 'Holder request type does not match the aggregated row.'
        }
      }

      if (row.requestType === 'asset') {
        const amountRaw = Math.max(0, Math.round(Number(holder.rawAmount || 0)))
        return {
          holder,
          amountRaw,
          amount: formatRawAmountPlain(amountRaw),
          skippedReason: amountRaw <= 0 ? 'No spendable asset balance for this holder.' : undefined
        }
      }

      const holderNetwork = networkById.get(holder.networkId) || networks.find((network) => network.id === holder.networkId)
      const amountRaw = buildNativeSweepAmountRaw(holder.rawAmount, holderNetwork)
      return {
        holder,
        amountRaw,
        amount: formatRawAmountPlain(amountRaw),
        skippedReason: amountRaw <= 0
          ? 'Balance too low after reserving estimated network fee.'
          : undefined
      }
    })
  ), [networkById, networks, row])

  const executablePlanRows = useMemo(
    () => planRows.filter((entry) => !entry.skippedReason && entry.amountRaw > 0),
    [planRows]
  )

  const totalPlannedRaw = useMemo(
    () => planRows.reduce((sum, entry) => sum + Math.max(0, entry.amountRaw), 0),
    [planRows]
  )

  const runBatchSend = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setResults(null)

    const toAddress = String(recipient || '').trim()
    if (!toAddress) {
      setError('Recipient address is required.')
      return
    }
    if (!rowCanSend) {
      setError(
        row.requestType === 'native'
          ? `${rowNetwork?.name || row.networkSymbol} does not support native coin sends.`
          : `${rowNetwork?.name || row.networkSymbol} does not support asset sends.`
      )
      return
    }
    if (executablePlanRows.length === 0) {
      setError('No spendable holder balances found for this merged send.')
      return
    }

    setIsSubmitting(true)

    const restoreAccountId = activeAccountId
    const restoreNetworkId = activeNetworkId
    const nextResults: BatchSendResult[] = []

    try {
      for (const plan of planRows) {
        if (plan.skippedReason || plan.amountRaw <= 0) {
          nextResults.push({
            holder: plan.holder,
            amount: plan.amount,
            ok: false,
            error: plan.skippedReason || 'No spendable balance.'
          })
          continue
        }

        try {
          const latest = useWalletStore.getState()
          if (!latest.accounts.some((account) => account.id === plan.holder.accountId)) {
            throw new Error('Account is no longer available in wallet state.')
          }
          if (!latest.networks.some((network) => network.id === plan.holder.networkId)) {
            throw new Error('Network is no longer available in wallet state.')
          }

          setActiveAccount(plan.holder.accountId)
          await setActiveNetwork(plan.holder.networkId)

          const scopedState = useWalletStore.getState()
          const scopedNetwork = scopedState.networks.find((network) => network.id === plan.holder.networkId) || rowNetwork
          const scopedModelId = resolveRuntimeModelId(scopedNetwork)
          const amountText = plan.amount
          let txHash = ''

          if (plan.holder.requestType === 'asset') {
            const senderAccount = scopedState.accounts.find((account) => account.id === plan.holder.accountId)
            const senderNativeBalance = parseCoinAmount(
              senderAccount?.networkBalances?.[plan.holder.networkId] ?? senderAccount?.balance
            )
            const requiredFee = estimateNativeSendFee(scopedNetwork)
            if (senderNativeBalance + 1e-12 < requiredFee) {
              throw new Error(
                `Insufficient ${scopedNetwork.symbol} for network fee on ${plan.holder.accountLabel}. Required ~${formatUnits8Plain(requiredFee)} ${scopedNetwork.symbol}, available ${formatUnits8Plain(senderNativeBalance)} ${scopedNetwork.symbol}.`
              )
            }
            const assetId = String(plan.holder.assetId || row.assetId || '').trim()
            if (!assetId) throw new Error('Missing asset id for merged asset send.')
            const tx = await sendAssetTransfer({
              assetId,
              qty: amountText,
              toAddress
            })
            txHash = String(tx.txid || '').trim()
          } else if (scopedNetwork.coinType === 'EVM') {
            const tx = await sendEvmTransaction({ to: toAddress, amount: amountText })
            txHash = String(tx.hash || '').trim()
          } else if (scopedModelId === 'ada') {
            const tx = await sendCardanoTransaction({ to: toAddress, amount: amountText })
            txHash = String(tx.hash || '').trim()
          } else if (scopedModelId === 'sol') {
            const tx = await sendSolanaTransaction({ to: toAddress, amount: amountText })
            txHash = String(tx.hash || '').trim()
          } else if (scopedModelId === 'xlm') {
            const tx = await sendStellarTransaction({ to: toAddress, amount: amountText })
            txHash = String(tx.hash || '').trim()
          } else if (scopedModelId === 'tron') {
            const tx = await sendTronTransaction({ to: toAddress, amount: amountText })
            txHash = String(tx.hash || '').trim()
          } else if (isCosmosLikeModelId(scopedModelId)) {
            const tx = await sendUtxoTransaction({ to: toAddress, amount: amountText })
            txHash = String(tx.hash || '').trim()
          } else if (scopedNetwork.coinType === 'UTXO') {
            const tx = await sendUtxoTransaction({ to: toAddress, amount: amountText })
            txHash = String(tx.hash || '').trim()
          } else {
            throw new Error(`Unsupported network for merged send: ${scopedNetwork.name}`)
          }

          if (!txHash) throw new Error('Transaction hash missing from wallet response.')

          addActivity({
            id: txHash,
            type: 'sent',
            asset: plan.holder.requestType === 'asset'
              ? (row.label || row.symbol || row.assetId || 'ASSET')
              : String(scopedNetwork.symbol || row.networkSymbol || '').trim() || 'COIN',
            amount: amountText,
            from: plan.holder.address,
            to: toAddress,
            accountId: plan.holder.accountId,
            status: 'pending',
            timestamp: Date.now(),
            networkId: plan.holder.networkId
          })
          trackActivityTransactionStatus({ txid: txHash, networkId: plan.holder.networkId })

          nextResults.push({
            holder: plan.holder,
            amount: amountText,
            ok: true,
            txid: txHash
          })
        } catch (err) {
          nextResults.push({
            holder: plan.holder,
            amount: plan.amount,
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }
    } finally {
      try {
        if (restoreAccountId) setActiveAccount(restoreAccountId)
        if (restoreNetworkId) {
          await setActiveNetwork(restoreNetworkId, { skipRefresh: true }).catch(() => {})
        }
        await refreshActiveBalance({ fast: true, skipZeroBalanceRecheck: true }).catch(() => {})
      } finally {
        setIsSubmitting(false)
      }
    }

    setResults(nextResults)
    if (nextResults.some((entry) => entry.ok)) {
      onComplete?.()
    }
  }

  return (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="p-4 border-b border-dark-600 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors" disabled={isSubmitting}>
          <IoArrowBackOutline className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-black uppercase tracking-widest text-gray-200 truncate">Merged Send</h1>
      </header>

      <form onSubmit={runBatchSend} className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        <div className="rounded-xl border border-dark-600 bg-dark-700/30 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{row.label}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                {row.holders.length} holder{row.holders.length === 1 ? '' : 's'} on {row.networkName}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold font-mono">{formatUnits8(totalPlannedRaw / 1e8)}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                {row.kind === 'native' ? row.networkSymbol : row.symbol}
              </p>
            </div>
          </div>
          {row.requestType === 'native' && totalPlannedRaw < row.rawAmount && (
            <p className="text-[10px] text-gray-500">
              Per-holder amount reserves estimated network fee to keep the batch send non-custodial and spendable.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Recipient Address</label>
          <Input
            placeholder={`Enter ${row.networkName} recipient`}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            className="bg-dark-700/50 border-dark-600 font-mono text-xs"
            disabled={isSubmitting}
          />
        </div>

        <div className="rounded-xl border border-dark-600/70 bg-dark-700/20 p-3 flex gap-2.5">
          <IoInformationCircleOutline className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
          <p className="text-[10px] text-gray-500 leading-relaxed">
            This is a non-custodial batch sweep. The wallet signs one transaction per holder locally and never hands
            private keys to server infrastructure.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
            <p className="text-[11px] font-bold text-red-300">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          {planRows.map((plan) => (
            <div
              key={plan.holder.key}
              className={`p-2 rounded-xl border flex items-center justify-between gap-3 ${
                plan.skippedReason
                  ? 'border-yellow-500/30 bg-yellow-500/10'
                  : 'border-dark-600 bg-dark-700/40'
              }`}
            >
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">{plan.holder.accountLabel}</p>
                <p className="text-[10px] text-gray-500 font-mono truncate">{shortAddress(plan.holder.address)}</p>
                {plan.skippedReason && (
                  <p className="text-[10px] text-yellow-200 mt-0.5">{plan.skippedReason}</p>
                )}
              </div>
              <p className="text-xs font-bold font-mono shrink-0">{plan.amount}</p>
            </div>
          ))}
        </div>

        {results && (
          <div className="space-y-2 rounded-xl border border-dark-600 bg-dark-700/30 p-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Batch Result</p>
            {results.map((result) => (
              <div key={`result-${result.holder.key}`} className="flex items-start justify-between gap-3 text-[11px]">
                <div className="min-w-0">
                  <p className="font-bold truncate">{result.holder.accountLabel}</p>
                  <p className={`truncate ${result.ok ? 'text-green-300' : 'text-red-300'}`}>
                    {result.ok ? `Sent (${result.txid})` : `Failed: ${result.error || 'Unknown error'}`}
                  </p>
                </div>
                <p className="font-mono shrink-0">{result.amount}</p>
              </div>
            ))}
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting || executablePlanRows.length === 0 || !rowCanSend}
            className="w-full px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest border border-primary/40 bg-primary/20 text-primary hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? 'Sending...'
              : `Send all holders (${executablePlanRows.length} tx${executablePlanRows.length === 1 ? '' : 's'})`}
          </button>
        </div>
      </form>
    </div>
  )
}

const Send: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const hasDirectRouteRequest = useMemo(() => {
    const route = (location.state as SendRouteState | null) || null
    return (
      route?.quickSendNative === true
      || Boolean(String(route?.assetId || '').trim())
      || Boolean(String(route?.sendEntryId || '').trim())
    )
  }, [location.state])
  const {
    accounts,
    networks,
    disabledNetworkIds,
    activeAccountId,
    activeNetworkId,
    networkAssets,
    sendListPreferences,
    getNetworkModelPreferences,
    getSendableItems,
    setActiveAccount,
    setActiveNetwork,
    fetchNetworkAssets
  } = useWalletStore()

  const enabledNetworks = useMemo(
    () => getEnabledNetworks(networks, disabledNetworkIds),
    [networks, disabledNetworkIds]
  )
  const enabledNetworkIds = useMemo(
    () => new Set(enabledNetworks.map((network) => network.id)),
    [enabledNetworks]
  )
  const activeNetwork = enabledNetworks.find((n) => n.id === activeNetworkId) || enabledNetworks[0]
  const networkById = useMemo(() => new Map(networks.map((network) => [network.id, network])), [networks])

  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedBatchKey, setSelectedBatchKey] = useState<string | null>(null)
  const [hubPreferences, setHubPreferences] = useState<SendHubPreferences>(() => readSendHubPreferences())
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null)
  const [dragOverRowKey, setDragOverRowKey] = useState<string | null>(null)
  const [isScanningAll, setIsScanningAll] = useState(false)
  const [, setScanProgress] = useState<{ done: number; total: number; label: string }>({
    done: 0,
    total: 0,
    label: ''
  })
  const [, setScanDiagnostics] = useState<SendHubScanDiagnostics | null>(null)
  const [scanError, setScanError] = useState('')
  const [scanRows, setScanRows] = useState<AggregatedScanRow[]>(() => {
    const cached = readCachedScanRows()
    return cached?.rows || []
  })
  const scanRowsRef = useRef<AggregatedScanRow[]>(scanRows)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const handledDeepLinkRef = useRef<string>('')
  const scanRunIdRef = useRef(0)
  const isScanningRef = useRef(false)
  const scanRestoreSelectionRef = useRef<{ accountId: string | null; networkId: string | null } | null>(null)
  const initialAutoScanTriggeredRef = useRef(false)

  const allItems = getSendableItems({ includeHidden: true })
  const activePairItems = useMemo(() => {
    if (!activeAccountId || !activeNetworkId) return [] as SendableItem[]
    return getSendableItems({
      accountId: activeAccountId,
      networkId: activeNetworkId,
      includeHidden: true,
      includeZeroBalance: true
    })
  }, [activeAccountId, activeNetworkId, accounts, networkAssets, getSendableItems])
  const activePairItemByKey = useMemo(() => {
    const out = new Map<string, SendableItem>()
    for (const item of activePairItems) {
      out.set(item.id, item)
      if (item.assetId) out.set(`asset:${item.assetId}`, item)
    }
    return out
  }, [activePairItems])
  const hiddenItemIdsByScope = useMemo(() => {
    const out = new Map<string, Set<string>>()
    for (const account of accounts) {
      for (const network of enabledNetworks) {
        const scopeKey = `${account.id}::${network.id}`.toLowerCase()
        const preferredHidden = sendListPreferences?.[scopeKey]?.hidden
        if (!Array.isArray(preferredHidden) || preferredHidden.length === 0) continue
        const items = getSendableItems({
          accountId: account.id,
          networkId: network.id,
          includeHidden: true,
          includeZeroBalance: true
        })
        const hiddenIds = new Set(
          items
            .filter((item) => item.requestType === 'asset' && item.hidden)
            .map((item) => item.id)
        )
        if (hiddenIds.size > 0) out.set(scopeKey, hiddenIds)
      }
    }
    return out
  }, [accounts, enabledNetworks, sendListPreferences, getSendableItems, networkAssets])
  const visibleScanRows = useMemo(() => {
    const nextRows: AggregatedScanRow[] = []
    for (const row of scanRows) {
      if (!enabledNetworkIds.has(row.networkId)) continue
      if (row.requestType !== 'asset') {
        nextRows.push(row)
        continue
      }
      const holders = row.holders.filter((holder) => {
        const scopeKey = `${holder.accountId}::${holder.networkId}`.toLowerCase()
        const hiddenIds = hiddenItemIdsByScope.get(scopeKey)
        return !hiddenIds?.has(holder.itemId)
      })
      if (holders.length === 0) continue
      const rawAmount = holders.reduce((sum, holder) => sum + Math.max(0, Number(holder.rawAmount || 0)), 0)
      nextRows.push({
        ...row,
        holders,
        rawAmount,
        amount: formatUnits8(rawAmount / 1e8)
      })
    }
    return nextRows
  }, [scanRows, enabledNetworkIds, hiddenItemIdsByScope])

  useEffect(() => {
    scanRowsRef.current = scanRows
  }, [scanRows])
  const orderedScanRows = useMemo(
    () => applySendHubPreferences(visibleScanRows, hubPreferences),
    [visibleScanRows, hubPreferences]
  )
  const pinnedRowKeys = useMemo(() => new Set(hubPreferences.pinned), [hubPreferences.pinned])

  const filteredScanRows = useMemo(() => {
    const query = String(search || '').trim().toLowerCase()
    if (!query) return orderedScanRows
    return orderedScanRows.filter((row) => {
      const holderHaystack = row.holders
        .map((holder) => `${holder.accountLabel} ${holder.address}`.toLowerCase())
        .join(' ')
      const haystack = `${row.label} ${row.symbol} ${row.networkSymbol} ${row.networkName} ${row.assetId || ''} ${holderHaystack}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [orderedScanRows, search])

  const selectedItem = useMemo(
    () => allItems.find((row) => row.id === selectedId) || null,
    [allItems, selectedId]
  )
  const selectedBatchRow = useMemo(
    () => visibleScanRows.find((row) => row.key === selectedBatchKey) || null,
    [visibleScanRows, selectedBatchKey]
  )

  useEffect(() => {
    setHubPreferences((current) => {
      const normalized = normalizeSendHubPreferencesForRows(current, visibleScanRows)
      const sameOrder = normalized.order.length === current.order.length
        && normalized.order.every((key, index) => key === current.order[index])
      const samePinned = normalized.pinned.length === current.pinned.length
        && normalized.pinned.every((key, index) => key === current.pinned[index])
      return (sameOrder && samePinned) ? current : normalized
    })
  }, [visibleScanRows])

  useEffect(() => {
    writeSendHubPreferences(hubPreferences)
  }, [hubPreferences])

  useEffect(() => {
    if (!activeAccountId || !activeNetworkId) return
    if (isScanningRef.current) return
    if (scanRows.length === 0) return

    setScanRows((current) => {
      let changed = false
      const nextRows: AggregatedScanRow[] = []

      for (const row of current) {
        if (row.networkId !== activeNetworkId) {
          nextRows.push(row)
          continue
        }

        let rowChanged = false
        const nextHolders: ScanHolder[] = []

        for (const holder of row.holders) {
          if (holder.accountId !== activeAccountId) {
            nextHolders.push(holder)
            continue
          }

          const latest = activePairItemByKey.get(holder.itemId)
            || (holder.assetId ? activePairItemByKey.get(`asset:${holder.assetId}`) : undefined)
          const latestRawAmount = Math.max(0, Math.round(Number(latest?.rawAmount || 0)))

          if (latestRawAmount <= 0) {
            changed = true
            rowChanged = true
            continue
          }

          const latestAmount = formatUnits8(latestRawAmount / 1e8)
          if (latestRawAmount !== holder.rawAmount || latestAmount !== holder.amount) {
            changed = true
            rowChanged = true
            nextHolders.push({
              ...holder,
              rawAmount: latestRawAmount,
              amount: latestAmount
            })
            continue
          }

          nextHolders.push(holder)
        }

        if (!rowChanged) {
          nextRows.push(row)
          continue
        }

        const nextRowRaw = nextHolders.reduce((sum, holder) => sum + Math.max(0, holder.rawAmount), 0)
        if (nextRowRaw <= 0) {
          changed = true
          continue
        }

        nextRows.push({
          ...row,
          rawAmount: nextRowRaw,
          amount: formatUnits8(nextRowRaw / 1e8),
          holders: [...nextHolders].sort((a, b) => b.rawAmount - a.rawAmount)
        })
      }

      if (!changed) return current
      const sorted = sortAggregatedScanRows(nextRows)
      writeCachedScanRows(sorted, { preserveExistingCheckpoint: true })
      return sorted
    })
  }, [activeAccountId, activeNetworkId, activePairItemByKey, scanRows.length])

  useEffect(() => {
    const routeState = (location.state as SendRouteState | null) || null
    const requestedAssetId = String(routeState?.assetId || '').trim()
    const requestedEntryId = String(routeState?.sendEntryId || '').trim()
    const requestedQuickNative = routeState?.quickSendNative === true
    if (!requestedAssetId && !requestedEntryId && !requestedQuickNative) return
    if (allItems.length === 0) return

    const dedupeKey = `${requestedEntryId}|${requestedAssetId}|${requestedQuickNative ? 'native' : ''}`
    if (handledDeepLinkRef.current === dedupeKey) return

    const composerPreference = getNetworkModelPreferences(activeNetworkId).utxoTransferComposer
    if (requestedAssetId && composerPreference === 'batch') {
      const batchMatch = visibleScanRows.find((row) => (
        row.networkId === activeNetworkId
        && row.assetId === requestedAssetId
        && row.holders.length > 1
      ))
      if (batchMatch) {
        handledDeepLinkRef.current = dedupeKey
        setSelectedId(null)
        setSelectedBatchKey(batchMatch.key)
        navigate('/wallet/send', { replace: true, state: null })
        return
      }
    }

    const match = allItems.find((item) => (
      (requestedEntryId && item.id === requestedEntryId)
      || (requestedAssetId && item.assetId === requestedAssetId)
      || (requestedQuickNative && item.requestType === 'native')
    ))
    if (match) {
      handledDeepLinkRef.current = dedupeKey
      setSelectedId(match.id)
      setSelectedBatchKey(null)
    }

    if (!match) handledDeepLinkRef.current = dedupeKey
    navigate('/wallet/send', { replace: true, state: null })
  }, [location.state, allItems, navigate, activeNetworkId, getNetworkModelPreferences, visibleScanRows])

  const runGlobalScan = useCallback(async (options?: GlobalScanOptions) => {
    if (isScanningRef.current) return
    setScanError('')
    setIsScanningAll(true)
    isScanningRef.current = true
    const runId = scanRunIdRef.current + 1
    scanRunIdRef.current = runId
    const mode: GlobalScanMode = options?.mode === 'manual' ? 'manual' : 'auto'
    const includeBalanceRefresh = options?.refreshBalances ?? (mode === 'manual')
    const forceAssetRefresh = options?.forceAssetRefresh ?? (mode === 'manual')
    const reason = String(options?.reason || '').trim()

    const stateBefore = useWalletStore.getState()
    const shouldCancel = () => scanRunIdRef.current !== runId
    const scanAccounts = [...stateBefore.accounts]
    const scanNetworks = stateBefore.networks.filter((network) => {
      if (!enabledNetworkIds.has(network.id)) return false
      const networkCaps = resolveNetworkCapabilities(network)
      return networkCaps.features.nativeSend || networkCaps.features.assetLayer || networkCaps.features.assetSend
    })
    const cached = options?.resumeIfAvailable ? readCachedScanRows() : null
    const resumeCheckpoint = getResumableScanCheckpoint(cached?.checkpoint || null, scanAccounts, scanNetworks)
    const startedAt = resumeCheckpoint?.startedAt || Date.now()
    const originalActiveAccountId = resumeCheckpoint?.originalActiveAccountId ?? stateBefore.activeAccountId
    const originalActiveNetworkId = resumeCheckpoint?.originalActiveNetworkId ?? stateBefore.activeNetworkId
    scanRestoreSelectionRef.current = {
      accountId: originalActiveAccountId,
      networkId: originalActiveNetworkId
    }

    const total = Math.max(1, scanAccounts.length * scanNetworks.length)
    const startAccountIndex = resumeCheckpoint?.nextAccountIndex ?? 0
    const startNetworkIndex = resumeCheckpoint?.nextNetworkIndex ?? 0
    setScanProgress({
      done: Math.min(total, resumeCheckpoint ? (resumeCheckpoint.done + 1) : 0),
      total,
      label: resumeCheckpoint
        ? `Resuming ${mode === 'manual' ? 'full' : 'background'} scan (${Math.min(total, resumeCheckpoint.done + 1)}/${total})...`
        : (reason
          ? `Preparing ${mode === 'manual' ? 'full' : 'background'} scan (${reason})...`
          : `Preparing ${mode === 'manual' ? 'full' : 'background'} scan...`)
    })
    const aggregate = new Map<string, AggregatedScanRow>()
    const seedRows = (resumeCheckpoint ? cached?.rows : null) || scanRowsRef.current
    for (const row of seedRows) {
      aggregate.set(row.key, {
        ...row,
        holders: [...row.holders]
      })
    }
    let done = resumeCheckpoint?.done || 0
    let succeededSteps = 0
    let failedSteps = 0
    let lastFailure = ''
    let lastPublishAt = 0
    const stepDelayMs = mode === 'manual' ? Math.min(SEND_HUB_SCAN_STEP_DELAY_MS, 80) : 0
    const scanAccountIds = scanAccounts.map((account) => account.id)
    const scanNetworkIds = scanNetworks.map((network) => network.id)

    const publishProgressRows = (rows: AggregatedScanRow[], force = false) => {
      const now = Date.now()
      if (!force && now - lastPublishAt < 180) return
      lastPublishAt = now
      setScanRows(rows)
    }

    const buildCheckpoint = (
      nextAccountIndex: number,
      nextNetworkIndex: number
    ): SendHubScanCheckpoint | null => {
      if (scanAccounts.length === 0 || scanNetworks.length === 0) return null
      if (nextAccountIndex < 0 || nextAccountIndex >= scanAccounts.length) return null
      return {
        mode,
        reason,
        startedAt,
        total,
        done,
        nextAccountIndex,
        nextNetworkIndex,
        accountIds: scanAccountIds,
        networkIds: scanNetworkIds,
        originalActiveAccountId,
        originalActiveNetworkId
      }
    }

    const persistScanSnapshot = (
      rows: AggregatedScanRow[],
      nextAccountIndex: number,
      nextNetworkIndex: number
    ) => {
      writeCachedScanRows(rows, {
        checkpoint: buildCheckpoint(nextAccountIndex, nextNetworkIndex)
      })
    }

    const replaceAccountNetworkSlice = (networkId: string, accountId: string) => {
      for (const [rowKey, row] of aggregate.entries()) {
        if (row.networkId !== networkId) continue
        const kept = row.holders.filter((holder) => !(holder.networkId === networkId && holder.accountId === accountId))
        if (kept.length === row.holders.length) continue
        if (kept.length <= 0) {
          aggregate.delete(rowKey)
          continue
        }
        const nextRaw = kept.reduce((sum, holder) => sum + Math.max(0, holder.rawAmount), 0)
        if (nextRaw <= 0) {
          aggregate.delete(rowKey)
          continue
        }
        aggregate.set(rowKey, {
          ...row,
          rawAmount: nextRaw,
          amount: formatUnits8(nextRaw / 1e8),
          holders: kept.sort((a, b) => b.rawAmount - a.rawAmount)
        })
      }
    }

    try {
      const initialRows = sortAggregatedScanRows([...aggregate.values()])
      publishProgressRows(initialRows, true)
      persistScanSnapshot(initialRows, startAccountIndex, startNetworkIndex)

      for (let accountIndex = startAccountIndex; accountIndex < scanAccounts.length; accountIndex += 1) {
        const account = scanAccounts[accountIndex]
        if (shouldCancel()) throw new Error('[cancelled]')
        useWalletStore.setState((state) => ({
          activeAccountId: account.id
        }))
        if (shouldCancel()) throw new Error('[cancelled]')

        const networkStartIndex = accountIndex === startAccountIndex ? startNetworkIndex : 0
        for (let networkIndex = networkStartIndex; networkIndex < scanNetworks.length; networkIndex += 1) {
          const network = scanNetworks[networkIndex]
          if (shouldCancel()) throw new Error('[cancelled]')
          const progressStep = Math.min(total, done + 1)
          setScanProgress({
            done: progressStep,
            total,
            label: failedSteps > 0
              ? `Scanning ${account.name} on ${network.symbol} (${progressStep}/${total})... ${failedSteps} issue${failedSteps === 1 ? '' : 's'}`
              : `Scanning ${account.name} on ${network.symbol} (${progressStep}/${total})...`
          })

          try {
            await withTimeout(
              setActiveNetwork(
                network.id,
                includeBalanceRefresh ? undefined : { skipRefresh: true }
              ),
              SEND_HUB_SCAN_STEP_TIMEOUT_MS,
              `[${network.symbol}] network switch`
            )
            if (shouldCancel()) throw new Error('[cancelled]')

            useWalletStore.setState((state) => ({
              networkAssets: { ...state.networkAssets, [network.id]: {} },
              networkAssetLogos: { ...state.networkAssetLogos, [network.id]: {} },
              networkAssetLabels: { ...state.networkAssetLabels, [network.id]: {} },
              evmNftAssets: { ...state.evmNftAssets, [network.id]: {} }
            }))
            if (shouldCancel()) throw new Error('[cancelled]')

            if (resolveNetworkCapabilities(network).features.assetLayer) {
              await withTimeout(
                fetchNetworkAssets({ force: forceAssetRefresh }),
                SEND_HUB_SCAN_STEP_TIMEOUT_MS,
                `[${network.symbol}] asset refresh`
              )
              if (shouldCancel()) throw new Error('[cancelled]')
            }

            const scanState = useWalletStore.getState()
            const refreshedAccount = scanState.accounts.find((row) => row.id === account.id) || account
            const address = String(
              refreshedAccount.networkAddresses?.[network.id]
              || (network.coinType === 'EVM' ? refreshedAccount.addresses?.EVM : '')
              || ''
            ).trim()
            const itemRows = scanState.getSendableItems({
              accountId: account.id,
              networkId: network.id,
              includeHidden: true,
              includeZeroBalance: false
            })

            // Keep existing rows visible until this exact account+network slice is refreshed.
            // After refresh, replace that slice; if fresh balance is zero it disappears.
            replaceAccountNetworkSlice(network.id, account.id)

            for (const item of itemRows) {
              const rawAmount = Math.max(0, Math.round(Number(item.rawAmount || 0)))
              if (rawAmount <= 0) continue
              const key = `${network.id}::${item.id}`
              const holderKey = `${account.id}::${network.id}::${item.id}`
              const holder: ScanHolder = {
                key: holderKey,
                networkId: network.id,
                networkSymbol: network.symbol,
                accountId: account.id,
                accountLabel: getAccountDisplayName(refreshedAccount, network.id, refreshedAccount.name),
                address,
                itemId: item.id,
                assetId: item.assetId,
                requestType: item.requestType,
                kind: item.kind,
                label: item.label,
                symbol: item.symbol,
                logoUrl: item.logoUrl,
                rawAmount,
                amount: formatUnits8(rawAmount / 1e8)
              }
              const existing = aggregate.get(key)
              if (!existing) {
                aggregate.set(key, {
                  key,
                  networkId: network.id,
                  networkSymbol: network.symbol,
                  networkName: network.name,
                  networkLogo: network.logo,
                  itemId: item.id,
                  assetId: item.assetId,
                  requestType: item.requestType,
                  kind: item.kind,
                  label: item.label,
                  symbol: item.symbol,
                  logoUrl: item.logoUrl,
                  rawAmount,
                  amount: formatUnits8(rawAmount / 1e8),
                  holders: [holder]
                })
                continue
              }
              existing.rawAmount += rawAmount
              existing.amount = formatUnits8(existing.rawAmount / 1e8)
              const holderExists = existing.holders.some((row) => row.key === holder.key)
              if (!holderExists) existing.holders.push(holder)
            }
            succeededSteps += 1
          } catch (stepError) {
            const message = stepError instanceof Error ? stepError.message : String(stepError)
            if (message === '[cancelled]') throw stepError
            failedSteps += 1
            lastFailure = `[${network.symbol}] ${message}`
          }

          done += 1
          const nextCursor = getNextScanCursor(accountIndex, networkIndex, scanNetworks.length)
          const rows = sortAggregatedScanRows([...aggregate.values()])
          publishProgressRows(rows)
          persistScanSnapshot(rows, nextCursor.nextAccountIndex, nextCursor.nextNetworkIndex)
          if (shouldCancel()) throw new Error('[cancelled]')
          if (stepDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, stepDelayMs))
          }
        }
      }

      if (shouldCancel()) throw new Error('[cancelled]')

      const rows = sortAggregatedScanRows([...aggregate.values()])
      publishProgressRows(rows, true)
      writeCachedScanRows(rows, { checkpoint: null })
      setExpandedRows({})
      const finishedAt = Date.now()
      setScanDiagnostics({
        mode,
        reason,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        totalSteps: total,
        succeededSteps,
        failedSteps,
        lastFailure: lastFailure || undefined
      })
      if (failedSteps > 0) {
        setScanError(`Partial scan: ${failedSteps}/${total} checks failed. Last: ${lastFailure}`)
      }
      if (rows.length === 0) {
        setScanProgress({
          done: total,
          total,
          label: `${mode === 'manual' ? 'Full scan' : 'Auto-update'} complete in ${formatDurationMs(finishedAt - startedAt)}. No balances found.`
        })
      } else {
        setScanProgress({
          done: total,
          total,
          label: `${mode === 'manual' ? 'Full scan' : 'Auto-update'} complete in ${formatDurationMs(finishedAt - startedAt)}. ${rows.length} holdings${failedSteps > 0 ? `, ${failedSteps} issue${failedSteps === 1 ? '' : 's'}` : ''}.`
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message !== '[cancelled]') {
        setScanError(`Global scan failed: ${message}`)
        const finishedAt = Date.now()
        setScanDiagnostics({
          mode,
          reason,
          startedAt,
          finishedAt,
          durationMs: Math.max(0, finishedAt - startedAt),
          totalSteps: total,
          succeededSteps,
          failedSteps: Math.max(failedSteps, 1),
          lastFailure: message
        })
      }
    } finally {
      const cancelled = shouldCancel()
      if (!cancelled) {
        if (originalActiveAccountId) {
          useWalletStore.setState({ activeAccountId: originalActiveAccountId })
        }
        if (originalActiveNetworkId) {
          await withTimeout(
            useWalletStore.getState().setActiveNetwork(
              originalActiveNetworkId,
              includeBalanceRefresh ? undefined : { skipRefresh: true }
            ),
            SEND_HUB_SCAN_STEP_TIMEOUT_MS,
            '[restore] network switch'
          ).catch(() => {})
          await useWalletStore.getState().fetchNetworkAssets({ force: forceAssetRefresh }).catch(() => {})
        }
      }
      if (scanRunIdRef.current === runId) {
        isScanningRef.current = false
        setIsScanningAll(false)
      }
      if (!cancelled) {
        scanRestoreSelectionRef.current = null
      }
    }
  }, [enabledNetworkIds, fetchNetworkAssets, setActiveNetwork])

  useEffect(() => {
    return () => {
      const wasScanning = isScanningRef.current
      scanRunIdRef.current += 1
      isScanningRef.current = false
      if (!wasScanning) return

      const restore = scanRestoreSelectionRef.current
      if (restore?.accountId) {
        useWalletStore.setState({ activeAccountId: restore.accountId })
      }
      if (restore?.networkId) {
        void useWalletStore.getState().setActiveNetwork(restore.networkId, { skipRefresh: true }).catch(() => {})
      }
      scanRestoreSelectionRef.current = null
    }
  }, [])

  useEffect(() => {
    if (hasDirectRouteRequest || selectedId || selectedBatchKey) return
    const cached = readCachedScanRows()
    const cacheAgeMs = cached ? Math.max(0, Date.now() - cached.updatedAt) : Number.POSITIVE_INFINITY
    if (visibleScanRows.length === 0 && cached?.rows?.length) {
      setScanRows(cached.rows)
    }
    if (initialAutoScanTriggeredRef.current) return
    if (cached?.checkpoint && !isScanningRef.current) {
      initialAutoScanTriggeredRef.current = true
      void runGlobalScan({
        mode: cached.checkpoint.mode,
        reason: cached.checkpoint.reason || 'resume checkpoint',
        refreshBalances: true,
        resumeIfAvailable: true
      })
      return
    }
    if ((!cached || cacheAgeMs > SEND_HUB_SCAN_STALE_MS || visibleScanRows.length === 0) && !isScanningRef.current) {
      initialAutoScanTriggeredRef.current = true
      void runGlobalScan({ mode: 'auto', reason: 'initial load', refreshBalances: true })
    }
  }, [hasDirectRouteRequest, runGlobalScan, selectedBatchKey, selectedId, visibleScanRows.length])

  useEffect(() => {
    const routeState = (location.state as SendRouteState | null) || null
    const requestedModeRaw = String(routeState?.hubMode || '').trim().toLowerCase()
    if (requestedModeRaw !== 'global') return

    if (routeState?.autoScan === true && visibleScanRows.length === 0 && !isScanningAll) {
      void runGlobalScan({ mode: 'auto', reason: 'global network entry', resumeIfAvailable: true })
    }

    navigate('/wallet/send', { replace: true, state: null })
  }, [location.state, navigate, visibleScanRows.length, isScanningAll, runGlobalScan])

  const handleManualRefresh = useCallback(() => {
    if (isScanningRef.current) return
    setScanError('')
    void runGlobalScan({
      mode: 'manual',
      reason: 'manual refresh',
      refreshBalances: true,
      forceAssetRefresh: true
    })
  }, [runGlobalScan])

  const openSendFromScanHolder = async (holder: ScanHolder) => {
    setScanError('')
    // Stop any in-flight background scan before switching account/network for send.
    scanRunIdRef.current += 1
    isScanningRef.current = false
    setIsScanningAll(false)
    scanRestoreSelectionRef.current = null

    try {
      setSelectedBatchKey(null)
      setActiveAccount(holder.accountId)
      await setActiveNetwork(holder.networkId)
      const latestState = useWalletStore.getState()
      const candidates = latestState.getSendableItems({
        accountId: holder.accountId,
        networkId: holder.networkId,
        includeHidden: true,
        includeZeroBalance: false
      })
      const target = candidates.find((item) => (
        item.id === holder.itemId
        || (holder.assetId && item.assetId === holder.assetId)
      ))
      if (!target) {
        setScanError(`Cannot open send form for ${holder.label} on ${holder.networkSymbol}. Run scan again.`)
        return
      }
      setSelectedId(target.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setScanError(`Cannot prepare send form: ${message}`)
    }
  }

  const togglePinRow = (rowKey: string) => {
    const key = String(rowKey || '').trim()
    if (!key) return
    setHubPreferences((current) => {
      const pinned = new Set(normalizeKeyList(current.pinned))
      if (pinned.has(key)) pinned.delete(key)
      else pinned.add(key)
      return {
        order: normalizeKeyList(current.order),
        pinned: [...pinned]
      }
    })
  }

  const applyDragReorder = (draggedKey: string, targetKey: string) => {
    const dragged = String(draggedKey || '').trim()
    const target = String(targetKey || '').trim()
    if (!dragged || !target || dragged === target) return

    setHubPreferences((current) => {
      const currentOrderedKeys = applySendHubPreferences(scanRows, current).map((row) => row.key)
      const nextOrder = moveRowKeyBefore(currentOrderedKeys, dragged, target)
      return {
        order: normalizeKeyList(nextOrder),
        pinned: normalizeKeyList(current.pinned)
      }
    })
  }

  const handleRowDragStart = (rowKey: string, event: React.DragEvent<HTMLDivElement>) => {
    if (search.trim()) return
    const key = String(rowKey || '').trim()
    if (!key) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', key)
    setDraggingRowKey(key)
    setDragOverRowKey(null)
  }

  const handleRowDragOver = (rowKey: string, event: React.DragEvent<HTMLDivElement>) => {
    if (search.trim()) return
    if (!draggingRowKey || draggingRowKey === rowKey) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverRowKey(rowKey)
  }

  const handleRowDrop = (targetRowKey: string, event: React.DragEvent<HTMLDivElement>) => {
    if (search.trim()) return
    event.preventDefault()
    const dragged = String(draggingRowKey || event.dataTransfer.getData('text/plain') || '').trim()
    if (!dragged || dragged === targetRowKey) {
      setDragOverRowKey(null)
      setDraggingRowKey(null)
      return
    }
    applyDragReorder(dragged, targetRowKey)
    setDragOverRowKey(null)
    setDraggingRowKey(null)
  }

  const clearDragState = () => {
    setDragOverRowKey(null)
    setDraggingRowKey(null)
  }

  if (selectedBatchRow) {
    return (
      <SendBatchSweepForm
        row={selectedBatchRow}
        networkById={networkById}
        onBack={() => {
          setSelectedBatchKey(null)
        }}
        onComplete={() => {
          void runGlobalScan({ mode: 'manual', reason: 'post merged send', refreshBalances: true, forceAssetRefresh: true })
        }}
      />
    )
  }

  if (selectedItem) {
    return (
      <SendTransferForm
        item={selectedItem}
        onBack={() => {
          setSelectedId(null)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="p-4 border-b border-dark-600 flex items-center gap-3">
        <button onClick={() => navigate('/wallet/assets')} className="text-gray-400 hover:text-white transition-colors">
          <IoArrowBackOutline className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-black uppercase tracking-widest text-gray-200 flex-1">Send Hub</h1>
        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={isScanningAll}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dark-500 bg-dark-700/40 text-[11px] font-bold uppercase tracking-wide text-gray-200 hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Refresh Send Hub scan"
        >
          <IoRefreshOutline className={`w-3.5 h-3.5 ${isScanningAll ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      <div className="p-4 border-b border-dark-600/60 space-y-3">
        <div className="relative">
          <IoSearchOutline className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
          <Input
            placeholder="Search token, account, address, blockchain..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9 bg-dark-700/50 border-dark-600 text-sm"
          />
        </div>

        {scanError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
            <p className="text-[11px] font-bold text-red-300">{scanError}</p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredScanRows.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center px-6 text-center text-sm text-gray-400 gap-3">
            <p>
              {isScanningAll
                ? 'Loading global holdings...'
                : (search.trim()
                  ? `No scan rows for "${search}".`
                  : 'No holdings loaded yet. Use Refresh to run a global scan.')}
            </p>
          </div>
        )}

        {filteredScanRows.map((row) => {
          const expanded = expandedRows[row.key] === true
          const rowNetwork = networkById.get(row.networkId) || activeNetwork
          const rowModelId = resolveRuntimeModelId(rowNetwork)
          const isEthereumL2NativeRow = row.requestType === 'native' && EVM_ETHEREUM_L2_COIN_IDS.has(rowModelId)
          const rowPrimaryLogoUrl = isEthereumL2NativeRow ? row.networkLogo : row.logoUrl
          const rowPrimaryAssetName = isEthereumL2NativeRow
            ? (rowNetwork?.name || row.networkName || row.label || row.symbol)
            : (row.label || row.symbol)
          const rowPrimaryAlt = isEthereumL2NativeRow
            ? (rowNetwork?.name || row.networkName || row.label)
            : row.label
          const rowBadgeLogo = isEthereumL2NativeRow ? getUnifiedLogoByName('ethereum') : row.networkLogo
          const rowBadgeSymbol = isEthereumL2NativeRow ? 'ETH' : row.networkSymbol
          const mergedRawAmount = row.holders.reduce((sum, holder) => sum + Math.max(0, Number(holder.rawAmount || 0)), 0)
          const rowCaps = resolveNetworkCapabilities(rowNetwork)
          const rowCanBatchSend = row.requestType === 'native'
            ? rowCaps.features.nativeSend
            : rowCaps.features.assetSend
          const rowBatchPreferred = row.requestType === 'asset'
            && getNetworkModelPreferences(row.networkId).utxoTransferComposer === 'batch'
          const rowPinned = pinnedRowKeys.has(row.key)
          return (
            <div
              key={row.key}
              draggable={!search.trim()}
              onDragStart={(event) => handleRowDragStart(row.key, event)}
              onDragOver={(event) => handleRowDragOver(row.key, event)}
              onDrop={(event) => handleRowDrop(row.key, event)}
              onDragEnd={clearDragState}
              className={`px-3 py-2 border-b border-dark-600/40 ${draggingRowKey === row.key ? 'opacity-60' : ''}`}
            >
              <button
                type="button"
                onClick={() => setExpandedRows((prev) => ({ ...prev, [row.key]: !expanded }))}
                className="w-full text-left flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-full border border-dark-600 bg-dark-700/60 overflow-hidden flex items-center justify-center shrink-0">
                  <TokenCircleLogo
                    logoUrl={rowPrimaryLogoUrl}
                    assetName={rowPrimaryAssetName}
                    alt={rowPrimaryAlt}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-bold truncate">{row.label}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-dark-500 text-gray-300 font-bold uppercase">
                      {row.holders.length} {row.holders.length === 1 ? 'holder' : 'holders'}
                    </span>
                    {rowPinned && (
                      <span
                        className="inline-flex items-center justify-center p-1 rounded-full border border-yellow-500/40 text-yellow-200"
                        aria-label="Pinned"
                        title="Pinned"
                      >
                        <IoPin className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">
                      {row.kind === 'native' ? row.networkSymbol : row.symbol}
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-blue-500/30 bg-blue-500/10 text-[9px] font-bold uppercase text-blue-200">
                      {rowBadgeLogo
                        ? <img src={rowBadgeLogo} alt={rowBadgeSymbol} className="w-3 h-3 rounded-full object-cover" />
                        : <span className="w-2 h-2 rounded-full bg-blue-300" />}
                      {rowBadgeSymbol}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold font-mono">{formatUnits8(mergedRawAmount / 1e8)}</p>
                  <div className="flex justify-end">
                    {expanded ? (
                      <IoChevronDownOutline className="w-4 h-4 text-gray-500" />
                    ) : (
                      <IoChevronForwardOutline className="w-4 h-4 text-gray-500" />
                    )}
                  </div>
                </div>
              </button>

              {expanded && (
                <div className="mt-2 space-y-2 pl-12">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => togglePinRow(row.key)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase border ${
                        rowPinned
                          ? 'border-yellow-500/40 bg-yellow-500/20 text-yellow-200 hover:text-white'
                          : 'border-dark-500 bg-dark-700/40 text-gray-300 hover:text-white'
                      }`}
                    >
                      {rowPinned ? 'Unpin' : 'Pin to Top'}
                    </button>
                    {row.holders.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(null)
                          setSelectedBatchKey(row.key)
                        }}
                        disabled={!rowCanBatchSend}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase border disabled:opacity-60 disabled:cursor-not-allowed ${
                          rowBatchPreferred
                            ? 'border-primary/40 bg-primary/20 text-primary hover:text-white'
                            : 'border-blue-400/40 bg-blue-500/20 text-blue-200 hover:text-white'
                        }`}
                      >
                        {rowBatchPreferred ? 'Preferred Batch' : 'Send All Holders'}
                      </button>
                    )}
                  </div>
                  {row.holders.map((holder) => {
                    const holderNetwork = networkById.get(holder.networkId)
                    const holderCaps = resolveNetworkCapabilities(holderNetwork || activeNetwork)
                    const holderCanSend = holder.requestType === 'native'
                      ? holderCaps.features.nativeSend
                      : holderCaps.features.assetSend
                    return (
                      <div key={holder.key} className="p-2 rounded-xl border border-dark-600 bg-dark-700/40 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold truncate">{holder.accountLabel}</p>
                          <p className="text-[10px] text-gray-500 font-mono truncate">{shortAddress(holder.address)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold font-mono">{holder.amount}</p>
                          <button
                            type="button"
                            onClick={() => void openSendFromScanHolder(holder)}
                            disabled={!holderCanSend}
                            className="mt-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase border border-primary/40 bg-primary/20 text-primary hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Send
