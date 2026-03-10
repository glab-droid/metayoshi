import React, { useEffect, useState } from 'react'
import { IoInformationCircleOutline, IoKeyOutline, IoSaveOutline, IoTrashOutline } from 'react-icons/io5'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { clearBridgeTxAuthConfig, getBridgeTxAuthConfig, setBridgeTxAuthConfig } from '../../lib/bridgeAuth'

const BridgeTxAuthSettings: React.FC = () => {
  const [secret, setSecret] = useState('')
  const [rotateByDate, setRotateByDate] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const cfg = await getBridgeTxAuthConfig()
        if (!mounted) return
        setSecret(String(cfg.secret || ''))
        setRotateByDate(cfg.rotateByDate !== false)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (mounted) setIsLoading(false)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  const onSave = async (): Promise<void> => {
    setError('')
    setStatus('')
    setIsSaving(true)
    try {
      await setBridgeTxAuthConfig({
        secret: secret.trim(),
        rotateByDate
      })
      setStatus(secret.trim() ? 'Bridge tx auth saved.' : 'Bridge tx auth cleared.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }

  const onClear = async (): Promise<void> => {
    setError('')
    setStatus('')
    setIsSaving(true)
    try {
      await clearBridgeTxAuthConfig()
      setSecret('')
      setRotateByDate(true)
      setStatus('Bridge tx auth cleared.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 text-xs text-gray-400">Loading bridge tx auth settings...</div>
    )
  }

  return (
    <div className="flex flex-col">
      <header className="px-4 py-3 text-center border-b border-dark-600">
        <h1 className="text-sm font-black uppercase tracking-widest text-gray-200">Bridge Tx Auth</h1>
      </header>

      <div className="p-4 space-y-4">
        <div className="flex gap-2.5 p-3 bg-dark-700/20 border border-dark-600/60 rounded-xl">
          <IoInformationCircleOutline className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" />
          <p className="text-[10px] text-gray-600 leading-relaxed">
            Required only if your bridge enforces `X-Bridge-Tx-Key` for write operations.
            Secret stays in extension storage and is never exported by default.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-0.5">
            Bridge tx auth secret
          </label>
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="BRIDGE_TX_AUTH_KEY"
            className="text-xs bg-dark-700/60 border-dark-600 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <label className="flex items-center justify-between p-3 rounded-xl border border-dark-600 bg-dark-700/30 cursor-pointer">
          <span className="text-xs font-bold text-gray-300">Rotate key by UTC date</span>
          <input
            type="checkbox"
            checked={rotateByDate}
            onChange={(e) => setRotateByDate(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
        </label>

        {status && (
          <div className="text-[11px] font-bold text-green-400">{status}</div>
        )}
        {error && (
          <div className="text-[11px] font-bold text-red-400">{error}</div>
        )}

        <div className="flex gap-2">
          <Button className="flex-1 h-9 text-xs gap-1.5" onClick={() => { void onSave() }} isLoading={isSaving}>
            <IoSaveOutline className="w-3.5 h-3.5" />
            Save
          </Button>
          <Button variant="outline" className="flex-1 h-9 text-xs gap-1.5" onClick={() => { void onClear() }} isLoading={isSaving}>
            <IoTrashOutline className="w-3.5 h-3.5" />
            Clear
          </Button>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <IoKeyOutline className="w-3.5 h-3.5" />
          <span>Used for bridge write calls (send coin/send asset/broadcast).</span>
        </div>
      </div>
    </div>
  )
}

export default BridgeTxAuthSettings
