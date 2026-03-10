import React, { useState } from 'react'
import { PasswordGate } from '../../components/PasswordGate'
import { Button } from '../../components/Button'
import { useWalletStore, type FullBackupV1 } from '../../store/walletStore'
import {
  IoCopyOutline,
  IoCheckmarkCircle,
  IoDownloadOutline,
  IoLayersOutline,
  IoShieldCheckmarkOutline,
  IoTimeOutline,
  IoPersonOutline,
  IoSwapHorizontalOutline
} from 'react-icons/io5'
import { useToast } from '../../components/Toast'

// ── helpers ────────────────────────────────────────────────────────────────────

function downloadJSON(data: object, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── component ──────────────────────────────────────────────────────────────────

const BackupSettings: React.FC = () => {
  const {
    vault,
    setBackupConfirmed,
    sessionMnemonic,
    accounts,
    activeAccountId,
    activeNetworkId,
    activity,
    authorizedSites,
    autolockMinutes,
    donationPercent,
    backupConfirmed,
    onboardingCompleted,
    networkAssets,
    sendListPreferences,
    networkModelPreferences,
    nextAccountIndex,
    createdAt
  } = useWalletStore()

  const [tab, setTab] = useState<'phrase' | 'full'>('full')
  const [showPhrase, setShowPhrase]   = useState(false)
  const [copied, setCopied]           = useState(false)
  const [fullDownloaded, setFullDownloaded] = useState(false)
  const { showToast } = useToast()

  const mnemonic = sessionMnemonic ?? ''

  // ── phrase backup ──────────────────────────────────────────────────────────

  const handleReveal = () => {
    setShowPhrase(true)
    setBackupConfirmed(true)
  }

  const handleCopyPhrase = () => {
    navigator.clipboard.writeText(mnemonic)
    setCopied(true)
    showToast('Recovery phrase copied', 'success')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadPhrase = () => {
    if (!vault) return
    const payload = {
      type: 'metayoshi-vault',
      v: 1,
      createdAt: Date.now(),
      vault
    }
    downloadJSON(payload, `metayoshi-vault-${Date.now()}.json`)
    showToast('Encrypted vault downloaded', 'success')
  }

  // ── full backup ────────────────────────────────────────────────────────────

  const handleFullBackup = () => {
    if (!vault) {
      showToast('No vault found', 'error')
      return
    }

    const backup: FullBackupV1 = {
      type:             'metayoshi-full-backup',
      version:          1,
      createdAt:        createdAt ?? Date.now(),
      vault,
      accounts,
      nextAccountIndex: nextAccountIndex ?? accounts.length,
      activeAccountId,
      activeNetworkId,
      activity,
      authorizedSites,
      autolockMinutes,
      donationPercent,
      backupConfirmed,
      onboardingCompleted,
      networkAssets,
      sendListPreferences,
      networkModelPreferences
    }

    downloadJSON(backup, `metayoshi-fullbackup-${Date.now()}.json`)
    setFullDownloaded(true)
    setBackupConfirmed(true)
    showToast('Full backup downloaded', 'success')
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <PasswordGate
      title="Backup Wallet"
      description="Enter your password to generate a backup."
    >
      <div className="flex flex-col h-full bg-dark-800 overflow-y-auto custom-scrollbar">

        {/* Hero */}
        <div className="flex flex-col items-center gap-4 pt-8 pb-6 px-8 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden border-2 border-primary bg-gradient-to-b from-primary/35 to-primary/10 shadow-[0_0_18px_rgba(245,132,31,0.24)]">
            <img src="/MetayoshiLogo.png" alt="MetaYoshi" className="w-full h-full object-contain object-center scale-[1.12] translate-y-[2px]" />
          </div>
          <div>
            <h2 className="text-base font-black uppercase tracking-widest">Backup Wallet</h2>
            <p className="text-xs text-gray-500 mt-1">Choose what to back up</p>
          </div>
        </div>

        {/* Tab selector */}
        <div className="px-5 mb-5">
          <div className="grid grid-cols-2 gap-1.5 bg-dark-700/40 p-1 rounded-xl border border-dark-600">
            <button
              type="button"
              onClick={() => setTab('full')}
              className={`py-2 rounded-lg text-xs font-bold transition-colors ${
                tab === 'full'
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Full Backup
            </button>
            <button
              type="button"
              onClick={() => setTab('phrase')}
              className={`py-2 rounded-lg text-xs font-bold transition-colors ${
                tab === 'phrase'
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Recovery Phrase
            </button>
          </div>
        </div>

        {/* ── Full Backup Tab ───────────────────────────────────────────────── */}
        {tab === 'full' && (
          <div className="px-5 pb-8 space-y-4">
            {/* What's included */}
            <div className="rounded-xl border border-dark-600 bg-dark-700/30 overflow-hidden">
              <div className="px-4 pt-3 pb-2 border-b border-dark-600/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  What's included in this backup
                </p>
              </div>
              <div className="divide-y divide-dark-600/30">
                <BackupRow
                  icon={<IoShieldCheckmarkOutline className="w-4 h-4 text-primary" />}
                  label="Encrypted Vault"
                  value="Password-protected mnemonic"
                />
                <BackupRow
                  icon={<IoPersonOutline className="w-4 h-4 text-yellow-400" />}
                  label="Accounts"
                  value={`${accounts.length} account${accounts.length !== 1 ? 's' : ''}`}
                />
                <BackupRow
                  icon={<IoSwapHorizontalOutline className="w-4 h-4 text-blue-400" />}
                  label="Transaction History"
                  value={`${activity.length} record${activity.length !== 1 ? 's' : ''}`}
                />
                <BackupRow
                  icon={<IoLayersOutline className="w-4 h-4 text-green-400" />}
                  label="Asset Balances"
                  value={`${Object.values(networkAssets).reduce((s, n) => s + Object.keys(n).length, 0)} cached`}
                />
                <BackupRow
                  icon={<IoTimeOutline className="w-4 h-4 text-gray-400" />}
                  label="Settings"
                  value={`Autolock ${autolockMinutes}min · ${authorizedSites.length} site${authorizedSites.length !== 1 ? 's' : ''}`}
                />
              </div>
            </div>

            {/* Account list preview */}
            {accounts.length > 0 && (
              <div className="rounded-xl border border-dark-600 bg-dark-700/30 overflow-hidden">
                <div className="px-4 pt-3 pb-2 border-b border-dark-600/50">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    Accounts included
                  </p>
                </div>
                {accounts.map(acc => {
                  const isActive = acc.id === activeAccountId
                  const addrCount = Object.keys(acc.networkAddresses ?? {}).length
                  return (
                    <div key={acc.id} className="flex items-center gap-3 px-4 py-3 border-b border-dark-600/30 last:border-0">
                      <div className={`w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-yellow-400 shrink-0 ${isActive ? 'ring-2 ring-primary' : ''}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-200">{acc.name}</p>
                        <p className="text-[10px] text-gray-500">{addrCount} network address{addrCount !== 1 ? 'es' : ''}</p>
                      </div>
                      {isActive && (
                        <span className="text-[9px] font-bold text-primary uppercase px-1.5 py-0.5 rounded bg-primary/10">Active</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Warning */}
            <div className="flex gap-2.5 p-3 bg-yellow-900/10 rounded-xl border border-yellow-500/20">
              <span className="text-yellow-400 text-base shrink-0">⚠️</span>
              <p className="text-[10px] text-yellow-300/80 leading-relaxed">
                This backup is encrypted with your current wallet password. You will need
                the <strong>same password</strong> to restore it. Store it in a safe place.
              </p>
            </div>

            <Button
              className="w-full btn-primary flex items-center justify-center gap-2"
              onClick={handleFullBackup}
            >
              <IoDownloadOutline className="w-5 h-5" />
              Download Full Backup
            </Button>

            {fullDownloaded && (
              <div className="flex items-center gap-2.5 p-3 bg-green-900/20 border border-green-500/30 rounded-xl">
                <IoCheckmarkCircle className="w-5 h-5 text-green-400 shrink-0" />
                <p className="text-xs font-bold text-green-300">
                  Full backup downloaded — keep it safe!
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Recovery Phrase Tab ───────────────────────────────────────────── */}
        {tab === 'phrase' && (
          <div className="px-5 pb-8 space-y-5">
            <div className="flex gap-2.5 p-3 bg-red-900/10 rounded-xl border border-red-500/20">
              <span className="text-red-400 text-base shrink-0">⚠️</span>
              <p className="text-[10px] text-red-300/80 leading-relaxed">
                Your recovery phrase gives <strong>full access</strong> to your wallet.
                Never share it with anyone and keep it offline.
              </p>
            </div>

            {!showPhrase ? (
              <Button className="w-full btn-primary" onClick={handleReveal}>
                Reveal Recovery Phrase
              </Button>
            ) : (
              <div className="space-y-4">
                <Button variant="outline" className="w-full" onClick={handleDownloadPhrase}>
                  <IoDownloadOutline className="w-4 h-4 mr-2" />
                  Download Encrypted Vault (JSON)
                </Button>

                {/* Word grid */}
                <div className="rounded-xl border border-dark-600 bg-dark-900 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Secret Recovery Phrase
                    </p>
                    <button
                      onClick={handleCopyPhrase}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-dark-700 hover:bg-dark-600 transition-colors"
                    >
                      {copied ? (
                        <>
                          <IoCheckmarkCircle className="w-3.5 h-3.5 text-green-400" />
                          <span className="text-[10px] font-bold text-green-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <IoCopyOutline className="w-3.5 h-3.5 text-gray-400" />
                          <span className="text-[10px] font-bold text-gray-400">Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {mnemonic.split(' ').filter(Boolean).map((word, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-2 py-2 bg-dark-800 rounded-lg border border-dark-600"
                      >
                        <span className="text-[10px] font-bold text-gray-600 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-xs font-bold text-gray-200">{word}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2.5 p-3 bg-yellow-900/10 rounded-xl border border-yellow-500/20">
                  <span className="text-yellow-400 text-base shrink-0">💡</span>
                  <p className="text-[10px] text-yellow-300/80 leading-relaxed">
                    Write these words down on paper in order and keep them in a secure location.
                    This phrase restores your wallet — account names and history are NOT included.
                    Use <strong>Full Backup</strong> to preserve all account data.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PasswordGate>
  )
}

// ── BackupRow ─────────────────────────────────────────────────────────────────

interface BackupRowProps {
  icon: React.ReactNode
  label: string
  value: string
}

const BackupRow: React.FC<BackupRowProps> = ({ icon, label, value }) => (
  <div className="flex items-center gap-3 px-4 py-3">
    <div className="w-7 h-7 rounded-full bg-dark-700/50 flex items-center justify-center shrink-0">
      {icon}
    </div>
    <span className="text-xs font-bold text-gray-300 flex-1">{label}</span>
    <span className="text-[10px] font-bold text-gray-500">{value}</span>
  </div>
)

export default BackupSettings
