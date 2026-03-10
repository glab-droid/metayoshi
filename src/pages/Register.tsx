import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IoCheckmarkCircle,
  IoCloudUploadOutline,
  IoCopyOutline,
  IoDocumentTextOutline,
  IoKeyOutline,
  IoLockClosedOutline,
  IoRefreshOutline,
  IoShieldCheckmarkOutline,
  IoSparklesOutline,
  IoWalletOutline
} from 'react-icons/io5'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { useWalletStore, type FullBackupV1 } from '../store/walletStore'
import { PageTransition } from '../components/PageTransition'
import * as bip39 from 'bip39'

type ImportMethod = 'phrase' | 'backup'

function isFullBackup(value: unknown): value is FullBackupV1 {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return obj.type === 'metayoshi-full-backup' && Number(obj.version) === 1 && Boolean(obj.vault)
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

const Register: React.FC = () => {
  const navigate = useNavigate()
  const { initialize, fullRestore, hasVault, isInitialized } = useWalletStore()

  const [mode, setMode] = useState<'create' | 'import'>('create')
  const [importMethod, setImportMethod] = useState<ImportMethod>('phrase')
  const [mnemonic, setMnemonic] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [ack, setAck] = useState(false)
  const [termsAck, setTermsAck] = useState(false)
  const [createStep, setCreateStep] = useState<'form' | 'verify'>('form')
  const [challengeIndex, setChallengeIndex] = useState<number | null>(null)
  const [challengeInput, setChallengeInput] = useState('')
  const [backupPassword, setBackupPassword] = useState('')
  const [fullBackupJson, setFullBackupJson] = useState('')
  const [parsedBackup, setParsedBackup] = useState<FullBackupV1 | null>(null)
  const [backupParseError, setBackupParseError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedPhrase, setCopiedPhrase] = useState(false)
  const backupFileRef = useRef<HTMLInputElement>(null)

  const normalizedMnemonic = useMemo(
    () => mnemonic.trim().toLowerCase().replace(/\s+/g, ' '),
    [mnemonic]
  )
  const mnemonicWords = useMemo(
    () => normalizedMnemonic ? normalizedMnemonic.split(' ') : [],
    [normalizedMnemonic]
  )

  const showPhrasePanel = mode === 'create' || (mode === 'import' && importMethod === 'phrase')
  const needsPhraseAck = mode === 'create' || (mode === 'import' && importMethod === 'phrase')
  const backupAccountCount = parsedBackup ? (Array.isArray(parsedBackup.accounts) ? parsedBackup.accounts.length : 0) : 0
  const backupActivityCount = parsedBackup ? (Array.isArray(parsedBackup.activity) ? parsedBackup.activity.length : 0) : 0

  const openTermsInInternalTab = () => {
    navigate('/terms')
    try {
      if (typeof chrome !== 'undefined' && chrome.windows?.getCurrent) {
        chrome.windows.getCurrent({}, (win) => {
          const id = win?.id
          if (typeof id !== 'number' || !chrome.windows?.update) return
          chrome.windows.update(id, {
            width: 520,
            height: 700,
            focused: true
          })
        })
      }
    } catch {
      // no-op
    }
  }

  useEffect(() => {
    if (hasVault || isInitialized) {
      navigate('/unlock', { replace: true })
    }
  }, [hasVault, isInitialized, navigate])

  useEffect(() => {
    if (mode !== 'create') return
    setCreateStep('form')
    setChallengeIndex(null)
    setChallengeInput('')
    if (!mnemonic.trim()) {
      setMnemonic(bip39.generateMnemonic())
    }
  }, [mode, mnemonic])

  useEffect(() => {
    if (!copiedPhrase) return
    const timeoutId = window.setTimeout(() => setCopiedPhrase(false), 1800)
    return () => window.clearTimeout(timeoutId)
  }, [copiedPhrase])

  const parseFullBackupText = (text: string) => {
    setFullBackupJson(text)
    setParsedBackup(null)
    setBackupParseError('')
    if (!text.trim()) return
    try {
      const parsed = JSON.parse(text)
      if (!isFullBackup(parsed)) {
        setBackupParseError('File is not a valid MetaYoshi full backup')
        return
      }
      setParsedBackup(parsed)
    } catch {
      setBackupParseError('Invalid backup JSON')
    }
  }

  const handleBackupFile = async (file: File) => {
    try {
      const text = await readFileAsText(file)
      parseFullBackupText(text)
    } catch {
      setParsedBackup(null)
      setBackupParseError('Could not read backup file')
    }
  }

  const copyPhraseToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(normalizedMnemonic)
      setCopiedPhrase(true)
    } catch {
      // clipboard may be unavailable in some extension contexts
    }
  }

  const resetCreateVerification = () => {
    setError('')
    setCreateStep('form')
    setChallengeIndex(null)
    setChallengeInput('')
  }

  const createVaultFromMnemonic = async () => {
    setBusy(true)
    try {
      await initialize(password, normalizedMnemonic)
      navigate('/connecting')
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to create vault'))
    } finally {
      setBusy(false)
    }
  }

  const createVaultFromBackup = async () => {
    if (!parsedBackup) {
      setError('Please load a valid backup file')
      return
    }
    if (!backupPassword.trim()) {
      setError('Backup file password is required')
      return
    }
    setBusy(true)
    try {
      await fullRestore({
        backup: parsedBackup,
        backupPassword: backupPassword.trim(),
        newPassword: password
      })
      navigate('/connecting')
    } catch (e: any) {
      setError(String(e?.message ?? 'Failed to import backup file'))
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = async () => {
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (!termsAck) {
      setError('Please accept MetaYoshi Terms of Service')
      return
    }

    if (mode === 'import' && importMethod === 'backup') {
      await createVaultFromBackup()
      return
    }

    if (!bip39.validateMnemonic(normalizedMnemonic)) {
      setError('Invalid mnemonic phrase')
      return
    }
    if (needsPhraseAck && !ack) {
      setError('Please confirm you saved your recovery phrase')
      return
    }

    if (mode === 'create') {
      const words = normalizedMnemonic.split(' ')
      if (!words.length) {
        setError('Invalid mnemonic phrase')
        return
      }
      setChallengeIndex(Math.floor(Math.random() * words.length))
      setChallengeInput('')
      setCreateStep('verify')
      return
    }

    await createVaultFromMnemonic()
  }

  const handleVerifyAndCreate = async () => {
    if (challengeIndex === null) {
      setError('Verification is not ready. Please go back and try again.')
      return
    }
    const words = normalizedMnemonic.split(' ')
    const expectedWord = words[challengeIndex]
    const typedWord = challengeInput.trim().toLowerCase()
    if (typedWord !== expectedWord) {
      setError('Incorrect word. Try again or go back to restart.')
      return
    }
    setError('')
    await createVaultFromMnemonic()
  }

  return (
    <PageTransition>
      <div className="relative h-full overflow-y-auto hide-scrollbar bg-dark-800">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-20 right-[-68px] h-48 w-48 rounded-full bg-primary/12 blur-3xl" />
          <div className="absolute top-44 left-[-64px] h-40 w-40 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute bottom-8 right-[-32px] h-40 w-40 rounded-full bg-yellow-500/10 blur-3xl" />
        </div>

        <div className="relative space-y-4 px-5 pb-6 pt-5">
          <section className="overflow-hidden rounded-[28px] border border-primary/30 bg-gradient-to-br from-dark-700/95 via-dark-800 to-dark-900 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-primary">MetaYoshi Onboarding</p>
                <h1 className="text-[24px] font-black uppercase tracking-tight leading-[1.02] text-gray-100">
                  {mode === 'create' ? 'Build Your Vault.' : 'Bring It Back Fast.'}
                </h1>
                <p className="max-w-[220px] text-[11px] leading-relaxed text-gray-400">
                  {mode === 'create'
                    ? 'Start with a secure recovery phrase, set your password, and enter the wallet with Ethereum ready first.'
                    : importMethod === 'backup'
                      ? 'Restore a full MetaYoshi backup with accounts and activity in one pass.'
                      : 'Reconnect an existing wallet from your recovery phrase without changing the core flow.'}
                </p>
              </div>

              <div className="relative h-20 w-20 shrink-0">
                <div className="absolute inset-0 rounded-full border border-primary/35" />
                <div className="absolute inset-2 rounded-full border border-blue-400/20" />
                <div className="absolute inset-4 rounded-full border border-dark-600" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-primary/10 shadow-[0_0_22px_rgba(245,132,31,0.18)]">
                    <img src="/MetayoshiLogo.png" alt="MetaYoshi" className="h-9 w-9 object-contain" />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <HeroBadge icon={<IoShieldCheckmarkOutline className="h-4 w-4" />} label="Non-custodial" />
              <HeroBadge icon={<IoKeyOutline className="h-4 w-4" />} label="Phrase secured" />
              <HeroBadge icon={<IoSparklesOutline className="h-4 w-4" />} label="Extension ready" />
            </div>
          </section>

          <section className="space-y-3 rounded-3xl border border-dark-600 bg-dark-800/70 p-3">
            <SectionHeader
              eyebrow="Access Mode"
              title="Choose how you want to start"
              description="The flow stays familiar. The page now makes each path easier to scan."
            />
            <div className="grid grid-cols-2 gap-2">
              <ModeCard
                active={mode === 'create'}
                icon={<IoWalletOutline className="h-5 w-5" />}
                title="Create"
                description="Generate a new phrase and secure a fresh vault."
                onClick={() => {
                  setMode('create')
                  setImportMethod('phrase')
                  setError('')
                  resetCreateVerification()
                }}
              />
              <ModeCard
                active={mode === 'import'}
                icon={<IoCloudUploadOutline className="h-5 w-5" />}
                title="Import"
                description="Use a phrase or a full backup file from MetaYoshi."
                onClick={() => {
                  setMode('import')
                  setError('')
                }}
              />
            </div>
          </section>

          {mode === 'create' && createStep === 'verify' ? (
            <>
              <section className="space-y-4 rounded-[28px] border border-primary/30 bg-gradient-to-br from-dark-700/90 via-dark-800 to-dark-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">Recovery Check</p>
                    <h2 className="mt-1 text-lg font-black uppercase tracking-tight text-gray-100">One last confirmation</h2>
                    <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                      Before creating the vault, type the requested recovery word exactly as shown in your phrase.
                    </p>
                  </div>
                  <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-orange-200">
                    Step 2 of 2
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <StatCard label="Requested word" value={challengeIndex !== null ? `#${challengeIndex + 1}` : 'Pending'} tone="primary" />
                  <StatCard label="Phrase length" value={`${mnemonicWords.length || 0} words`} tone="neutral" />
                </div>

                <div className="space-y-3 rounded-2xl border border-dark-600 bg-dark-800/60 p-3">
                  <Input
                    type="text"
                    placeholder={challengeIndex !== null ? `Enter word #${challengeIndex + 1}` : 'Enter requested word'}
                    value={challengeInput}
                    onChange={(e) => setChallengeInput(e.target.value)}
                    className="h-12 border-dark-600 bg-dark-700/50 text-center"
                    autoComplete="off"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      className="w-full rounded-2xl"
                      onClick={resetCreateVerification}
                      disabled={busy}
                    >
                      Restart
                    </Button>
                    <Button className="w-full rounded-2xl btn-primary" onClick={handleVerifyAndCreate} isLoading={busy}>
                      Verify & Create
                    </Button>
                  </div>
                </div>
              </section>

              {error && (
                <div className="rounded-2xl border border-red-500/35 bg-red-500/10 px-3 py-3 text-[11px] font-bold text-red-300">
                  {error}
                </div>
              )}
            </>
          ) : (
            <>
              {mode === 'import' && (
                <section className="space-y-3 rounded-3xl border border-dark-600 bg-dark-800/70 p-3">
                  <SectionHeader
                    eyebrow="Import Source"
                    title="Pick a restore method"
                    description="Phrase restore is universal. Full backup keeps more MetaYoshi context."
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <ModeCard
                      active={importMethod === 'phrase'}
                      icon={<IoKeyOutline className="h-5 w-5" />}
                      title="Phrase"
                      description="Enter 12 or 24 words."
                      onClick={() => {
                        setImportMethod('phrase')
                        setError('')
                      }}
                    />
                    <ModeCard
                      active={importMethod === 'backup'}
                      icon={<IoDocumentTextOutline className="h-5 w-5" />}
                      title="Backup File"
                      description="Restore accounts and activity."
                      onClick={() => {
                        setImportMethod('backup')
                        setError('')
                      }}
                    />
                  </div>
                </section>
              )}

              {showPhrasePanel && (
                <section className="space-y-3 rounded-3xl border border-dark-600 bg-dark-800/70 p-4">
                  <SectionHeader
                    eyebrow={mode === 'create' ? 'Recovery Phrase' : 'Recovery Phrase Import'}
                    title={mode === 'create' ? 'Secure this phrase before you continue' : 'Paste your existing recovery phrase'}
                    description={mode === 'create'
                      ? 'This is the only way to recover the vault if the extension is lost or reset.'
                      : 'Use lowercase words separated by spaces. Extra spacing is normalized automatically.'}
                  />

                  {mode === 'create' ? (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        {mnemonicWords.map((word, index) => (
                          <RecoveryWordChip key={`${word}-${index}`} index={index + 1} word={word} />
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          className="w-full rounded-2xl"
                          onClick={() => {
                            setMnemonic(bip39.generateMnemonic())
                            setError('')
                            setAck(false)
                            setCopiedPhrase(false)
                          }}
                        >
                          <IoRefreshOutline className="h-4 w-4" />
                          Regenerate
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full rounded-2xl"
                          onClick={() => void copyPhraseToClipboard()}
                        >
                          {copiedPhrase ? <IoCheckmarkCircle className="h-4 w-4" /> : <IoCopyOutline className="h-4 w-4" />}
                          {copiedPhrase ? 'Copied' : 'Copy Phrase'}
                        </Button>
                      </div>

                      <div className="rounded-2xl border border-primary/25 bg-primary/10 px-3 py-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary">Backup Rule</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-orange-100">
                          Save the phrase offline and in order. Anyone who sees it can control the wallet.
                        </p>
                      </div>
                    </>
                  ) : (
                    <textarea
                      className="input-field min-h-[110px] resize-none py-3 text-xs font-mono leading-relaxed"
                      value={mnemonic}
                      onChange={(e) => setMnemonic(e.target.value)}
                      placeholder="Enter 12 or 24 words separated by spaces"
                    />
                  )}
                </section>
              )}

              {mode === 'import' && importMethod === 'backup' && (
                <section className="space-y-3 rounded-3xl border border-dark-600 bg-dark-800/70 p-4">
                  <SectionHeader
                    eyebrow="Full Backup"
                    title="Load a MetaYoshi backup file"
                    description="Use a .json backup to restore wallet data and then unlock it with the backup password."
                  />

                  <div
                    className={`cursor-pointer rounded-[24px] border-2 border-dashed p-4 text-center transition-colors ${
                      parsedBackup
                        ? 'border-green-500/40 bg-green-900/10'
                        : backupParseError
                          ? 'border-red-500/40 bg-red-900/10'
                          : 'border-dark-600 bg-dark-700/30 hover:border-primary/40'
                    }`}
                    onClick={() => backupFileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      const file = e.dataTransfer.files?.[0]
                      if (file) void handleBackupFile(file)
                    }}
                  >
                    <input
                      ref={backupFileRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void handleBackupFile(file)
                        e.target.value = ''
                      }}
                    />

                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-dark-600 bg-dark-800/70">
                      <IoDocumentTextOutline className="h-5 w-5 text-primary" />
                    </div>

                    {parsedBackup ? (
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-green-300">Backup ready to restore</p>
                        <div className="flex flex-wrap justify-center gap-2">
                          <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-[10px] font-bold uppercase text-green-200">
                            {backupAccountCount} account{backupAccountCount === 1 ? '' : 's'}
                          </span>
                          <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-[10px] font-bold uppercase text-green-200">
                            {backupActivityCount} activity row{backupActivityCount === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                    ) : backupParseError ? (
                      <p className="text-xs font-bold text-red-300">{backupParseError}</p>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-gray-300">Drop backup file here or click to browse</p>
                        <p className="text-[10px] text-gray-500">You can also paste raw JSON below.</p>
                      </div>
                    )}
                  </div>

                  {!parsedBackup && (
                    <textarea
                      className="input-field min-h-[80px] resize-none py-2.5 text-[10px] font-mono leading-relaxed"
                      placeholder='{"type":"metayoshi-full-backup","version":1,...}'
                      value={fullBackupJson}
                      onChange={(e) => parseFullBackupText(e.target.value)}
                    />
                  )}

                  {parsedBackup && (
                    <button
                      type="button"
                      onClick={() => {
                        setParsedBackup(null)
                        setFullBackupJson('')
                        setBackupParseError('')
                        setBackupPassword('')
                      }}
                      className="w-full rounded-2xl border border-dark-600 bg-dark-700/40 px-3 py-2 text-[11px] font-bold uppercase text-gray-400 transition-colors hover:text-white"
                    >
                      Remove Backup
                    </button>
                  )}

                  <Input
                    type="password"
                    placeholder="Backup file password"
                    value={backupPassword}
                    onChange={(e) => setBackupPassword(e.target.value)}
                    className="h-12 border-dark-600 bg-dark-700/50 text-center"
                  />
                </section>
              )}

              <section className="space-y-3 rounded-3xl border border-dark-600 bg-dark-800/70 p-4">
                <SectionHeader
                  eyebrow="Wallet Lock"
                  title={mode === 'import' && importMethod === 'backup' ? 'Set your new wallet password' : 'Set your wallet password'}
                  description="Use at least 8 characters. This unlocks the extension on this device and does not replace the recovery phrase."
                />
                <div className="space-y-3">
                  <Input
                    type="password"
                    placeholder={mode === 'import' && importMethod === 'backup' ? 'New wallet password' : 'Password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 border-dark-600 bg-dark-700/50 text-center"
                  />
                  <Input
                    type="password"
                    placeholder={mode === 'import' && importMethod === 'backup' ? 'Confirm new wallet password' : 'Confirm password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-12 border-dark-600 bg-dark-700/50 text-center"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MiniFeature icon={<IoLockClosedOutline className="h-4 w-4" />} label="Local unlock" />
                  <MiniFeature icon={<IoShieldCheckmarkOutline className="h-4 w-4" />} label="No remote custody" />
                </div>
              </section>

              {needsPhraseAck && (
                <label className="flex cursor-pointer select-none items-start gap-3 rounded-2xl border border-dark-600 bg-dark-800/70 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span className="text-[11px] font-bold leading-relaxed text-gray-300">
                    I saved my recovery phrase securely and understand MetaYoshi cannot recover it for me.
                  </span>
                </label>
              )}

              <section className="space-y-3 rounded-3xl border border-dark-600 bg-dark-800/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <SectionHeader
                    eyebrow="Terms Of Service"
                    title="Open the full terms"
                    description="Use the canonical terms page before accepting."
                  />
                  <button
                    type="button"
                    onClick={openTermsInInternalTab}
                    className="shrink-0 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-primary transition-colors hover:bg-primary/15"
                  >
                    Show Terms
                  </button>
                </div>
              </section>

              <label className="flex cursor-pointer select-none items-start gap-3 rounded-2xl border border-dark-600 bg-dark-800/70 px-3 py-3">
                <input
                  type="checkbox"
                  checked={termsAck}
                  onChange={(e) => setTermsAck(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span className="text-[11px] font-bold leading-relaxed text-gray-300">
                  I accept the MetaYoshi Terms of Service.
                </span>
              </label>

              {error && (
                <div className="rounded-2xl border border-red-500/35 bg-red-500/10 px-3 py-3 text-[11px] font-bold text-red-300">
                  {error}
                </div>
              )}

              <section className="space-y-3 rounded-[28px] border border-primary/30 bg-gradient-to-br from-dark-700/90 via-dark-800 to-dark-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Final Step</p>
                    <p className="mt-1 text-[11px] text-gray-400">
                      {mode === 'create'
                        ? 'MetaYoshi will verify your phrase knowledge before creating the vault.'
                        : importMethod === 'backup'
                          ? 'The wallet will restore your MetaYoshi backup and then open the connection flow.'
                          : 'The wallet will import the phrase and open the connection flow.'}
                    </p>
                  </div>
                  <span className="rounded-full border border-dark-600 bg-dark-800/70 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-gray-300">
                    {mode === 'create' ? 'Create' : 'Restore'}
                  </span>
                </div>

                <Button
                  className="w-full rounded-2xl btn-primary"
                  onClick={handleSubmit}
                  isLoading={busy}
                  disabled={busy || (mode === 'import' && importMethod === 'backup' && !parsedBackup)}
                >
                  {mode === 'create'
                    ? 'Create Vault'
                    : importMethod === 'backup'
                      ? 'Import from Backup File'
                      : 'Import from Phrase'}
                </Button>
              </section>
            </>
          )}

          <footer className="pb-1 pt-1 text-center text-[11px] text-gray-500">
            Need help?{' '}
            <button type="button" className="font-bold text-primary transition-colors hover:text-orange-300">
              Contact MetaYoshi
            </button>
          </footer>
        </div>
      </div>
    </PageTransition>
  )
}

const SectionHeader: React.FC<{ eyebrow: string; title: string; description: string }> = ({ eyebrow, title, description }) => (
  <div>
    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
    <h2 className="mt-1 text-sm font-black uppercase tracking-tight text-gray-100">{title}</h2>
    <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{description}</p>
  </div>
)

const HeroBadge: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="flex flex-col items-center gap-1 rounded-2xl border border-dark-600 bg-dark-700/35 px-2 py-2 text-center">
    <span className="text-primary">{icon}</span>
    <span className="text-[9px] font-black uppercase tracking-[0.12em] text-gray-300">{label}</span>
  </div>
)

const ModeCard: React.FC<{
  active: boolean
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}> = ({ active, icon, title, description, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-[22px] border p-3 text-left transition-colors ${
      active
        ? 'border-primary/40 bg-primary/10 shadow-[0_0_24px_rgba(245,132,31,0.08)]'
        : 'border-dark-600 bg-dark-700/25 hover:border-primary/25'
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${
        active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-dark-600 bg-dark-800/70 text-gray-400'
      }`}>
        {icon}
      </div>
      {active && <IoCheckmarkCircle className="h-4 w-4 shrink-0 text-primary" />}
    </div>
    <p className="mt-3 text-sm font-black uppercase tracking-tight text-gray-100">{title}</p>
    <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{description}</p>
  </button>
)

const RecoveryWordChip: React.FC<{ index: number; word: string }> = ({ index, word }) => (
  <div className="rounded-2xl border border-dark-600 bg-dark-700/35 px-2.5 py-2.5">
    <p className="text-[9px] font-black uppercase tracking-[0.14em] text-primary">{String(index).padStart(2, '0')}</p>
    <p className="mt-1 truncate text-[11px] font-bold lowercase text-gray-200">{word}</p>
  </div>
)

const StatCard: React.FC<{ label: string; value: string; tone: 'primary' | 'neutral' }> = ({ label, value, tone }) => (
  <div className={`rounded-2xl border px-3 py-3 ${
    tone === 'primary'
      ? 'border-primary/35 bg-primary/10'
      : 'border-dark-600 bg-dark-800/60'
  }`}>
    <p className={`text-[9px] font-black uppercase tracking-[0.14em] ${
      tone === 'primary' ? 'text-primary' : 'text-gray-500'
    }`}>
      {label}
    </p>
    <p className="mt-1 text-sm font-black uppercase tracking-tight text-gray-100">{value}</p>
  </div>
)

const MiniFeature: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="flex items-center gap-2 rounded-2xl border border-dark-600 bg-dark-700/30 px-3 py-2">
    <span className="text-primary">{icon}</span>
    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-gray-300">{label}</span>
  </div>
)

export default Register
