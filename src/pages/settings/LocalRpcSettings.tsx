import React, { useState } from 'react'
import { useWalletStore } from '../../store/walletStore'
import { resolveNetworkCapabilities } from '../../lib/networkCapabilities'
import {
  IoServerOutline,
  IoCheckmarkCircle,
  IoWarningOutline,
  IoInformationCircleOutline,
  IoChevronDown,
  IoChevronUp,
  IoSaveOutline,
  IoFlashOutline
} from 'react-icons/io5'
import { Input } from '../../components/Input'
import { Button } from '../../components/Button'

// ── sensible per-coin local RPC defaults ─────────────────────────────────────
const LOCAL_RPC_DEFAULTS: Record<string, { rpcUrl: string; rpcUsername: string; rpcPassword: string; rpcWallet: string }> = {
  rtm:  { rpcUrl: 'http://127.0.0.1:10225', rpcUsername: 'rpcuser', rpcPassword: 'rpcpass', rpcWallet: 'mainwallet' },
  doge: { rpcUrl: 'http://127.0.0.1:22555', rpcUsername: 'rpcuser', rpcPassword: 'rpcpass', rpcWallet: '' },
  btcz: { rpcUrl: 'http://127.0.0.1:1979',  rpcUsername: 'rpcuser', rpcPassword: 'rpcpass', rpcWallet: '' },
  tide: { rpcUrl: 'http://127.0.0.1:42068', rpcUsername: 'rpcuser', rpcPassword: 'rpcpass', rpcWallet: '' },
  firo: { rpcUrl: 'http://127.0.0.1:8888',  rpcUsername: 'rpcuser', rpcPassword: 'rpcpass', rpcWallet: '' },
  arr:  { rpcUrl: 'http://127.0.0.1:7771',  rpcUsername: 'rpcuser', rpcPassword: 'rpcpass', rpcWallet: '' }
}

// ── NetworkRpcCard ────────────────────────────────────────────────────────────

interface CardState {
  rpcUrl: string
  rpcUsername: string
  rpcPassword: string
  rpcWallet: string
}

interface NetworkRpcCardProps {
  networkId: string
  networkName: string
  networkSymbol: string
  networkLogo?: string
  saved: CardState
  onSave: (v: CardState) => void
  useLocalRpc: boolean
}

const NetworkRpcCard: React.FC<NetworkRpcCardProps> = ({
  networkId, networkName, networkSymbol, networkLogo, saved, onSave, useLocalRpc
}) => {
  const defaults = LOCAL_RPC_DEFAULTS[networkId] ?? { rpcUrl: '', rpcUsername: 'rpcuser', rpcPassword: 'rpcpass', rpcWallet: '' }
  const [open, setOpen]     = useState(false)
  const [form, setForm]     = useState<CardState>(saved)
  const [dirty, setDirty]   = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const update = (field: keyof CardState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
    setDirty(true)
    setTestResult(null)
  }

  const handleSave = () => {
    onSave(form)
    setDirty(false)
    setTestResult(null)
  }

  const handleReset = () => {
    setForm(defaults)
    setDirty(true)
    setTestResult(null)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const url = (form.rpcUrl || defaults.rpcUrl).trim().replace(/\/$/, '')
    const endpoint = form.rpcWallet ? `${url}/wallet/${form.rpcWallet}` : url
    try {
      const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
      if (form.rpcUsername && form.rpcPassword) {
        headers['Authorization'] = `Basic ${btoa(`${form.rpcUsername}:${form.rpcPassword}`)}`
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '1.0', id: 'test', method: 'getblockchaininfo', params: [] }),
        signal: AbortSignal.timeout(5000)
      })
      if (res.ok || res.status === 200) {
        const json = await res.json().catch(() => null)
        if (json?.result) {
          const blocks = json.result.blocks ?? '?'
          const chain  = json.result.chain ?? networkSymbol
          setTestResult({ ok: true, msg: `Connected — ${chain} at block ${blocks}` })
        } else if (json?.error) {
          setTestResult({ ok: false, msg: `RPC error: ${json.error.message ?? json.error}` })
        } else {
          setTestResult({ ok: true, msg: 'Connected (no chain info returned)' })
        }
      } else {
        setTestResult({ ok: false, msg: `HTTP ${res.status}: ${res.statusText}` })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setTestResult({ ok: false, msg: `Connection failed: ${msg}` })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={`rounded-xl border transition-colors ${useLocalRpc ? 'border-primary/40 bg-primary/5' : 'border-dark-600 bg-dark-700/30'}`}>
      {/* header row */}
      <button
        className="w-full flex items-center justify-between p-4 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          {networkLogo
            ? <img src={networkLogo} alt={networkSymbol} className="w-8 h-8 rounded-full object-cover" />
            : <div className="w-8 h-8 rounded-full bg-dark-600 flex items-center justify-center">
                <IoServerOutline className="w-4 h-4 text-gray-500" />
              </div>
          }
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold">{networkName}</span>
            <span className="text-[10px] text-gray-500 font-mono">
              {(saved.rpcUrl || defaults.rpcUrl) || 'not configured'}
            </span>
          </div>
        </div>
        {open ? <IoChevronUp className="w-4 h-4 text-gray-500" /> : <IoChevronDown className="w-4 h-4 text-gray-500" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-dark-600/50 pt-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-0.5">RPC URL</label>
            <Input
              value={form.rpcUrl}
              onChange={update('rpcUrl')}
              placeholder={defaults.rpcUrl}
              className="font-mono text-xs bg-dark-700/60 border-dark-600"
              spellCheck={false}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-0.5">Username</label>
              <Input
                value={form.rpcUsername}
                onChange={update('rpcUsername')}
                placeholder={defaults.rpcUsername}
                className="text-xs bg-dark-700/60 border-dark-600"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-0.5">Password</label>
              <Input
                type="password"
                value={form.rpcPassword}
                onChange={update('rpcPassword')}
                placeholder="rpcpass"
                className="text-xs bg-dark-700/60 border-dark-600"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-0.5">Wallet name (optional)</label>
            <Input
              value={form.rpcWallet}
              onChange={update('rpcWallet')}
              placeholder={defaults.rpcWallet || 'leave empty for default'}
              className="text-xs bg-dark-700/60 border-dark-600"
            />
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 p-2.5 rounded-xl text-xs font-bold border ${
              testResult.ok
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>
              {testResult.ok
                ? <IoCheckmarkCircle className="w-4 h-4 shrink-0 mt-0.5" />
                : <IoWarningOutline className="w-4 h-4 shrink-0 mt-0.5" />
              }
              <span className="leading-relaxed">{testResult.msg}</span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleReset}
              className="text-[10px] font-bold text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded-lg hover:bg-dark-600"
            >
              Reset to defaults
            </button>
            <div className="flex-1" />
            <Button
              variant="outline"
              className="h-8 px-3 text-xs gap-1.5"
              onClick={handleTest}
              isLoading={testing}
              disabled={testing}
            >
              <IoFlashOutline className="w-3.5 h-3.5" />
              Test
            </Button>
            <Button
              className="h-8 px-3 text-xs gap-1.5"
              onClick={handleSave}
              disabled={!dirty}
            >
              <IoSaveOutline className="w-3.5 h-3.5" />
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── LocalRpcSettings (main page) ──────────────────────────────────────────────

const LocalRpcSettings: React.FC = () => {
  const {
    networks,
    useLocalRpc,
    localRpcOverrides,
    setLocalRpcOverride
  } = useWalletStore()

  // Only show UTXO networks that have a local RPC default
  const utxoNetworks = networks.filter((n) => {
    const modelId = String(n.runtimeModelId || n.id || '').trim().toLowerCase()
    const isCosmosLike = modelId === 'cosmos' || modelId === 'cro' || modelId === 'crocosmos'
    return n.coinType === 'UTXO' && !isCosmosLike && resolveNetworkCapabilities(n).features.nativeSend
  })

  const getSaved = (networkId: string) => {
    const saved = localRpcOverrides[networkId]
    const defaults = LOCAL_RPC_DEFAULTS[networkId] ?? { rpcUrl: '', rpcUsername: 'rpcuser', rpcPassword: 'rpcpass', rpcWallet: '' }
    return saved ?? { ...defaults }
  }

  return (
    <div className="flex flex-col">
      <header className="px-4 py-3 text-center border-b border-dark-600">
        <h1 className="text-sm font-black uppercase tracking-widest text-gray-200">Local Node RPC</h1>
      </header>

      <div className="flex flex-col gap-5 p-4">
        {/* Warning when local mode active */}
        {useLocalRpc && (
          <div className="flex gap-3 p-3.5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
            <IoWarningOutline className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-yellow-300 leading-relaxed">
              Local RPC mode is active. Your wallet will call your local node directly.
              Make sure the node is fully synced and the RPC port is reachable.
            </p>
          </div>
        )}

        {/* ── Info note always visible ── */}
        <div className="flex gap-2.5 p-3 bg-dark-700/20 border border-dark-600/60 rounded-xl">
          <IoInformationCircleOutline className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" />
          <p className="text-[10px] text-gray-600 leading-relaxed">
            In Local RPC mode, RTM asset calls are sent directly to your configured node.
            In bridge mode, they are sent through the MetaYoshi gateway.
          </p>
        </div>

        {/* ── Per-network cards ── */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-0.5">
            Node configuration — per network
          </p>
          {utxoNetworks.map(net => (
            <NetworkRpcCard
              key={net.id}
              networkId={net.id}
              networkName={net.name}
              networkSymbol={net.symbol}
              networkLogo={net.logo}
              saved={getSaved(net.id)}
              onSave={v => setLocalRpcOverride(net.id, v)}
              useLocalRpc={useLocalRpc}
            />
          ))}
          {utxoNetworks.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-6">No configurable networks found.</p>
          )}
        </div>

      </div>
    </div>
  )
}

export default LocalRpcSettings

