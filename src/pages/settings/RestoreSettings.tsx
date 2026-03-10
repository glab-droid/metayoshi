import React, { useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { useWalletStore, type FullBackupV1 } from '../../store/walletStore'
import { useNavigate } from 'react-router-dom'
import { decryptVaultV1, type EncryptedVaultV1 } from '../../lib/vaultCrypto'
import {
  IoCloudUploadOutline,
  IoCheckmarkCircle,
  IoDocumentTextOutline,
  IoShieldCheckmarkOutline,
  IoPersonOutline,
  IoSwapHorizontalOutline,
  IoLayersOutline,
  IoTimeOutline,
  IoCloseCircleOutline,
  IoWarningOutline
} from 'react-icons/io5'

// ── helpers ────────────────────────────────────────────────────────────────────

function isFullBackup(v: unknown): v is FullBackupV1 {
  if (!v || typeof v !== 'object') return false
  const obj = v as Record<string, unknown>
  return obj.type === 'metayoshi-full-backup' && obj.version === 1 && Boolean(obj.vault)
}

function isVaultBackup(v: unknown): v is { vault: EncryptedVaultV1 } {
  if (!v || typeof v !== 'object') return false
  const obj = v as Record<string, unknown>
  return Boolean(obj.vault) && !('type' in obj && obj.type === 'metayoshi-full-backup')
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

// ── component ──────────────────────────────────────────────────────────────────

type Mode = 'full' | 'phrase' | 'vault'

const RestoreSettings: React.FC = () => {
  const navigate  = useNavigate()
  const { initialize, fullRestore } = useWalletStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>('full')

  // shared password fields
  const [backupPassword,     setBackupPassword]     = useState('')
  const [newPassword,        setNewPassword]         = useState('')
  const [confirmNewPassword, setConfirmNewPassword]  = useState('')

  // full backup mode
  const [fullBackupJson,   setFullBackupJson]   = useState('')
  const [parsedBackup,     setParsedBackup]     = useState<FullBackupV1 | null>(null)
  const [backupParseError, setBackupParseError] = useState('')

  // phrase mode
  const [mnemonic, setMnemonic] = useState('')

  // vault JSON mode
  const [vaultJson, setVaultJson] = useState('')

  // status
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')

  // ── helpers ──────────────────────────────────────────────────────────────────

  const resetForm = () => {
    setBackupPassword('')
    setNewPassword('')
    setConfirmNewPassword('')
    setFullBackupJson('')
    setParsedBackup(null)
    setBackupParseError('')
    setMnemonic('')
    setVaultJson('')
    setError('')
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    resetForm()
  }

  // Validate and parse the pasted / dropped full backup JSON
  const parseFullBackupText = (text: string) => {
    setFullBackupJson(text)
    setBackupParseError('')
    setParsedBackup(null)
    if (!text.trim()) return
    try {
      const parsed = JSON.parse(text)
      if (!isFullBackup(parsed)) {
        setBackupParseError('File is not a MetaYoshi Full Backup (v1)')
        return
      }
      setParsedBackup(parsed)
    } catch {
      setBackupParseError('Invalid JSON — check the file contents')
    }
  }

  // Handle file drag-and-drop or picker
  const handleFile = async (file: File) => {
    try {
      const text = await readFileAsText(file)
      if (mode === 'full') {
        parseFullBackupText(text)
      } else if (mode === 'vault') {
        setVaultJson(text)
      }
    } catch {
      setBackupParseError('Could not read file')
    }
  }

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  // ── password validation ───────────────────────────────────────────────────

  const validatePasswords = () => {
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return false
    }
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match')
      return false
    }
    return true
  }

  // ── restore handlers ──────────────────────────────────────────────────────

  const handleRestoreFull = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!parsedBackup) { setError('Please load a valid full backup file'); return }
    if (!backupPassword) { setError('Backup password is required'); return }
    if (!validatePasswords()) return

    setBusy(true)
    try {
      await fullRestore({ backup: parsedBackup, backupPassword, newPassword })
      navigate('/connecting')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRestorePhrase = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const words = mnemonic.trim().split(/\s+/)
    if (words.length !== 12 && words.length !== 24) {
      setError('Recovery phrase must be 12 or 24 words')
      return
    }
    if (!validatePasswords()) return

    setBusy(true)
    try {
      await initialize(newPassword, mnemonic.trim())
      navigate('/connecting')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRestoreVault = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validatePasswords()) return

    try {
      const parsed = JSON.parse(vaultJson.trim()) as unknown
      if (!isVaultBackup(parsed)) {
        setError('Invalid vault backup JSON')
        return
      }
      if (!backupPassword) { setError('Backup password is required'); return }

      setBusy(true)
      const plain = await decryptVaultV1({ password: backupPassword, vault: parsed.vault })
      await initialize(newPassword, plain.mnemonic)
      navigate('/connecting')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    if (mode === 'full')   return handleRestoreFull(e)
    if (mode === 'phrase') return handleRestorePhrase(e)
    return handleRestoreVault(e)
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-dark-800 overflow-y-auto custom-scrollbar">

      {/* Hero */}
      <div className="flex flex-col items-center gap-4 pt-8 pb-6 px-8 text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden border-2 border-primary bg-gradient-to-b from-primary/35 to-primary/10 shadow-[0_0_18px_rgba(245,132,31,0.24)]">
          <img src="/MetayoshiLogo.png" alt="MetaYoshi" className="w-full h-full object-contain object-center scale-[1.12] translate-y-[2px]" />
        </div>
        <div>
          <h2 className="text-base font-black uppercase tracking-widest">Restore Wallet</h2>
          <p className="text-xs text-gray-500 mt-1">Choose your restore method</p>
        </div>
      </div>

      {/* Tab selector */}
      <div className="px-5 mb-5">
        <div className="grid grid-cols-3 gap-1 bg-dark-700/40 p-1 rounded-xl border border-dark-600">
          {([
            ['full',   'Full Backup'],
            ['phrase', 'Phrase'],
            ['vault',  'Vault JSON']
          ] as [Mode, string][]).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`py-2 rounded-lg text-[11px] font-bold transition-colors ${
                mode === m
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-5 pb-8 space-y-4">

        {/* ── FULL BACKUP ── */}
        {mode === 'full' && (
          <>
            {/* Drop zone / file picker */}
            <div
              className={`rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition-colors ${
                parsedBackup
                  ? 'border-green-500/40 bg-green-900/10'
                  : backupParseError
                    ? 'border-red-500/40 bg-red-900/10'
                    : 'border-dark-600 bg-dark-700/30 hover:border-primary/40 hover:bg-dark-700/50'
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={onDrop}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={onFileInputChange}
              />
              {parsedBackup ? (
                <div className="flex flex-col items-center gap-2">
                  <IoCheckmarkCircle className="w-8 h-8 text-green-400" />
                  <p className="text-xs font-bold text-green-400">Backup loaded</p>
                  <p className="text-[10px] text-gray-500">
                    {parsedBackup.accounts.length} account{parsedBackup.accounts.length !== 1 ? 's' : ''} ·{' '}
                    {parsedBackup.activity.length} tx records ·{' '}
                    {new Date(parsedBackup.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ) : backupParseError ? (
                <div className="flex flex-col items-center gap-2">
                  <IoCloseCircleOutline className="w-8 h-8 text-red-400" />
                  <p className="text-xs font-bold text-red-300">{backupParseError}</p>
                  <p className="text-[10px] text-gray-500">Click to try another file</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <IoCloudUploadOutline className="w-8 h-8 text-gray-500" />
                  <p className="text-xs font-bold text-gray-300">Drop your backup file here</p>
                  <p className="text-[10px] text-gray-600">or click to browse · .json</p>
                </div>
              )}
            </div>

            {/* Or paste JSON */}
            {!parsedBackup && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                  Or paste JSON
                </label>
                <textarea
                  className="input-field min-h-[80px] resize-none text-[10px] font-mono leading-relaxed py-2.5"
                  placeholder='{"type":"metayoshi-full-backup","version":1,...}'
                  value={fullBackupJson}
                  onChange={e => parseFullBackupText(e.target.value)}
                />
              </div>
            )}

            {/* Backup contents preview (when loaded) */}
            {parsedBackup && (
              <div className="rounded-xl border border-dark-600 bg-dark-700/30 overflow-hidden">
                <div className="px-4 pt-3 pb-2 border-b border-dark-600/50">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    This backup contains
                  </p>
                </div>
                <div className="divide-y divide-dark-600/30">
                  <PreviewRow icon={<IoShieldCheckmarkOutline className="w-3.5 h-3.5 text-primary" />}
                    label="Vault" value="Encrypted mnemonic" />
                  <PreviewRow icon={<IoPersonOutline className="w-3.5 h-3.5 text-yellow-400" />}
                    label="Accounts" value={`${parsedBackup.accounts.length}`} />
                  <PreviewRow icon={<IoSwapHorizontalOutline className="w-3.5 h-3.5 text-blue-400" />}
                    label="Transactions" value={`${parsedBackup.activity.length}`} />
                  <PreviewRow icon={<IoLayersOutline className="w-3.5 h-3.5 text-green-400" />}
                    label="Asset balances" value={`${Object.values(parsedBackup.networkAssets ?? {}).reduce((s, n) => s + Object.keys(n).length, 0)} cached`} />
                  <PreviewRow icon={<IoTimeOutline className="w-3.5 h-3.5 text-gray-400" />}
                    label="Created" value={new Date(parsedBackup.createdAt).toLocaleString()} />
                </div>

                {/* Account names */}
                {parsedBackup.accounts.length > 0 && (
                  <div className="px-4 py-3 border-t border-dark-600/30 space-y-1.5">
                    {parsedBackup.accounts.map(acc => (
                      <div key={acc.id} className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-blue-600 to-yellow-400 shrink-0" />
                        <span className="text-[10px] font-bold text-gray-300">{acc.name}</span>
                        {acc.id === parsedBackup.activeAccountId && (
                          <span className="text-[9px] text-primary font-bold">· Active</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Clear backup */}
                <button
                  type="button"
                  onClick={() => { setParsedBackup(null); setFullBackupJson('') }}
                  className="w-full px-4 py-2 text-[10px] font-bold text-gray-600 hover:text-gray-400 transition-colors border-t border-dark-600/30"
                >
                  Remove backup file
                </button>
              </div>
            )}

            <Input
              type="password"
              label="Backup Password"
              placeholder="Password used when backup was created"
              value={backupPassword}
              onChange={e => setBackupPassword(e.target.value)}
              className="bg-dark-700/50 border-dark-600"
            />
          </>
        )}

        {/* ── RECOVERY PHRASE ── */}
        {mode === 'phrase' && (
          <>
            <div className="flex gap-2.5 p-3 bg-yellow-900/10 rounded-xl border border-yellow-500/20">
              <IoWarningOutline className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-yellow-300/80 leading-relaxed">
                Restoring from a recovery phrase creates a fresh wallet — only coin addresses
                are derived. Account names, transaction history, and settings are <strong>not recovered</strong>.
                Use <strong>Full Backup</strong> to restore everything.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                Secret Recovery Phrase
              </label>
              <textarea
                className="input-field min-h-[100px] resize-none text-xs leading-relaxed py-3 font-mono"
                placeholder="Enter 12 or 24 words separated by spaces"
                value={mnemonic}
                onChange={e => setMnemonic(e.target.value)}
              />
            </div>
          </>
        )}

        {/* ── VAULT JSON ── */}
        {mode === 'vault' && (
          <>
            <div className="flex gap-2.5 p-3 bg-blue-900/10 rounded-xl border border-blue-500/20">
              <IoDocumentTextOutline className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-blue-300/80 leading-relaxed">
                Paste the encrypted vault JSON (from "Download Encrypted Vault"). Restores the
                mnemonic only — account names and history are <strong>not included</strong>.
              </p>
            </div>
            <div
              className="rounded-xl border-2 border-dashed border-dark-600 bg-dark-700/30 hover:border-primary/40 hover:bg-dark-700/50 p-5 text-center cursor-pointer transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={onDrop}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={onFileInputChange}
              />
              <IoCloudUploadOutline className="w-7 h-7 text-gray-500 mx-auto mb-2" />
              <p className="text-xs font-bold text-gray-400">Drop vault JSON or click to browse</p>
            </div>
            {vaultJson && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                  Vault JSON
                </label>
                <textarea
                  className="input-field min-h-[80px] resize-none text-[10px] font-mono leading-relaxed py-2.5"
                  value={vaultJson}
                  onChange={e => setVaultJson(e.target.value)}
                />
              </div>
            )}
            {!vaultJson && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                  Or paste JSON
                </label>
                <textarea
                  className="input-field min-h-[80px] resize-none text-[10px] font-mono leading-relaxed py-2.5"
                  placeholder='{"type":"metayoshi-vault","vault":{...}}'
                  value={vaultJson}
                  onChange={e => setVaultJson(e.target.value)}
                />
              </div>
            )}
            <Input
              type="password"
              label="Backup Password"
              placeholder="Password used when vault was created"
              value={backupPassword}
              onChange={e => setBackupPassword(e.target.value)}
              className="bg-dark-700/50 border-dark-600"
            />
          </>
        )}

        {/* ── New password (all modes) ── */}
        <div className="space-y-3 pt-1">
          <Input
            type="password"
            label="New Wallet Password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="bg-dark-700/50 border-dark-600"
          />
          <Input
            type="password"
            label="Confirm New Password"
            placeholder="Repeat new password"
            value={confirmNewPassword}
            onChange={e => setConfirmNewPassword(e.target.value)}
            className="bg-dark-700/50 border-dark-600"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2.5 p-3 bg-red-900/20 border border-red-500/30 rounded-xl">
            <IoCloseCircleOutline className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-xs font-bold text-red-300">{error}</p>
          </div>
        )}

        <Button
          type="submit"
          className="w-full btn-primary"
          isLoading={busy}
          disabled={busy || (mode === 'full' && !parsedBackup)}
        >
          {mode === 'full'   ? 'Restore Full Backup' :
           mode === 'phrase' ? 'Restore from Phrase' :
                               'Restore from Vault JSON'}
        </Button>
      </form>
    </div>
  )
}

// ── PreviewRow ────────────────────────────────────────────────────────────────

interface PreviewRowProps {
  icon: React.ReactNode
  label: string
  value: string
}

const PreviewRow: React.FC<PreviewRowProps> = ({ icon, label, value }) => (
  <div className="flex items-center gap-3 px-4 py-2.5">
    <div className="w-6 h-6 rounded-full bg-dark-700/50 flex items-center justify-center shrink-0">
      {icon}
    </div>
    <span className="text-[11px] font-bold text-gray-400 flex-1">{label}</span>
    <span className="text-[11px] font-bold text-gray-300">{value}</span>
  </div>
)

export default RestoreSettings
