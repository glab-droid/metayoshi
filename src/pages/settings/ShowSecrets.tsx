import React, { useEffect, useMemo, useState } from 'react'
import { PasswordGate } from '../../components/PasswordGate'
import { useWalletStore } from '../../store/walletStore'
import { Button } from '../../components/Button'
import {
  IoAlertCircleOutline,
  IoCheckmarkCircle,
  IoCopyOutline,
  IoDownloadOutline,
  IoEyeOffOutline,
  IoEyeOutline
} from 'react-icons/io5'
import { useToast } from '../../components/Toast'
import { ethers } from 'ethers'
import { deriveCosmosAddress, resolveCosmosAddressConfig } from '../../lib/cosmosAddress'
import { deriveSuiAddress } from '../../lib/suiAddress'
import { deriveUtxoAddress } from '../../lib/utxoAddress'
import { getAccountDisplayName } from '../../lib/accountName'
import { isCosmosLikeModelId, resolveRuntimeModelId } from '../../lib/runtimeModel'

const ShowSecrets: React.FC = () => {
  const { sessionMnemonic, accounts, activeAccountId, networks, activeNetworkId } = useWalletStore()
  const [showMnemonic, setShowMnemonic] = useState(false)
  const [showPrivKey, setShowPrivKey] = useState(false)
  const [derivedPrivKey, setDerivedPrivKey] = useState('')
  const [downloaded, setDownloaded] = useState(false)
  const { showToast } = useToast()

  const decryptedMnemonic = sessionMnemonic ?? ''
  const activeAccount = accounts.find((a) => a.id === activeAccountId) || accounts[0]
  const activeNetwork = networks.find((n) => n.id === activeNetworkId) || networks[0]
  const activeAccountName = getAccountDisplayName(activeAccount, activeNetworkId, 'Account')

  const accountListIndex = useMemo(
    () => accounts.findIndex((a) => a.id === activeAccount?.id),
    [accounts, activeAccount]
  )

  const derivationIndex = useMemo(() => {
    if (!activeAccount) return 0
    if (typeof activeAccount.derivationIndex === 'number' && activeAccount.derivationIndex >= 0) {
      return activeAccount.derivationIndex
    }
    return accountListIndex >= 0 ? accountListIndex : 0
  }, [activeAccount, accountListIndex])

  useEffect(() => {
    let cancelled = false

    const deriveSelectedKey = async () => {
      if (!decryptedMnemonic || !activeNetwork) {
        if (!cancelled) setDerivedPrivKey('')
        return
      }

      try {
        const modelId = resolveRuntimeModelId(activeNetwork)
        if (activeNetwork.coinType === 'EVM') {
          const path = `m/44'/60'/${derivationIndex}'/0/0`
          const wallet = ethers.HDNodeWallet.fromPhrase(decryptedMnemonic, undefined, path)
          if (!cancelled) setDerivedPrivKey(wallet.privateKey)
          return
        }

        if (isCosmosLikeModelId(modelId)) {
          const cosmosCfg = resolveCosmosAddressConfig({
            runtimeModelId: activeNetwork.runtimeModelId,
            serverCoinId: activeNetwork.serverCoinId,
            id: activeNetwork.id
          })
          const derived = await deriveCosmosAddress(decryptedMnemonic, derivationIndex, cosmosCfg)
          if (!cancelled) setDerivedPrivKey(derived.privHex)
          return
        }

        if (modelId === 'sui') {
          const derived = await deriveSuiAddress(decryptedMnemonic, derivationIndex)
          if (!cancelled) setDerivedPrivKey(derived.privHex)
          return
        }

        if (activeNetwork.coinType === 'UTXO' && activeNetwork.coinSymbol) {
          const derived = await deriveUtxoAddress(decryptedMnemonic, activeNetwork.coinSymbol, derivationIndex, 0, 0)
          if (!cancelled) setDerivedPrivKey(derived.privHex)
          return
        }

        if (!cancelled) setDerivedPrivKey('')
      } catch {
        if (!cancelled) setDerivedPrivKey('')
      }
    }

    void deriveSelectedKey()
    return () => {
      cancelled = true
    }
  }, [activeNetwork, decryptedMnemonic, derivationIndex])

  const publicKey = activeAccount?.addresses?.EVM || ''
  const privateKeyLabel = activeNetwork
    ? `Private Key (${activeNetwork.symbol} - ${activeAccountName})`
    : 'Private Key'

  const copyToClipboard = (text: string, message = 'Copied to clipboard') => {
    if (!text) return
    navigator.clipboard.writeText(text)
    showToast(message, 'success')
  }

  const handleDownload = () => {
    const keysData = {
      mnemonic: decryptedMnemonic,
      privateKey: derivedPrivKey,
      privateKeyNetwork: activeNetwork?.symbol || '',
      privateKeyAccount: activeAccountName,
      publicKey,
      accounts: accounts.map((acc) => ({
        name: acc.name,
        addresses: acc.addresses
      })),
      timestamp: new Date().toISOString(),
      warning: 'NEVER share these keys with anyone. Keep this file secure.'
    }

    const blob = new Blob([JSON.stringify(keysData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `metayoshi-keys-${Date.now()}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)

    setDownloaded(true)
    showToast('Keys downloaded successfully', 'success')
  }

  const handleCopyAll = () => {
    const keysText =
      `MetaYoshi Wallet Keys\n\n`
      + `Mnemonic: ${decryptedMnemonic}\n`
      + `${privateKeyLabel}: ${derivedPrivKey || 'Unavailable'}\n`
      + `Public Key (EVM): ${publicKey}\n\n`
      + `Downloaded: ${new Date().toISOString()}\n\n`
      + `WARNING: NEVER share these keys with anyone!`

    navigator.clipboard.writeText(keysText)
    showToast('All keys copied to clipboard', 'success')
  }

  return (
    <PasswordGate
      title="Show / Download Keys"
      description="Enter password to reveal and export your recovery phrase and private key."
    >
      <div className="flex flex-col h-full bg-dark-800 p-6 space-y-8 overflow-y-auto custom-scrollbar">
        <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl flex items-start gap-3">
          <IoAlertCircleOutline className="text-red-500 w-6 h-6 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-red-200 leading-normal uppercase tracking-tight">
            Never share your secret recovery phrase or private key. Anyone with these secrets can take your funds forever.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Secret Recovery Phrase</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setShowMnemonic(!showMnemonic)}
                className="p-1.5 bg-dark-700 rounded-lg text-gray-400 hover:text-white transition-colors"
              >
                {showMnemonic ? <IoEyeOffOutline className="w-4 h-4" /> : <IoEyeOutline className="w-4 h-4" />}
              </button>
              <button
                onClick={() => copyToClipboard(decryptedMnemonic)}
                className="p-1.5 bg-dark-700 rounded-lg text-gray-400 hover:text-white transition-colors"
              >
                <IoCopyOutline className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="p-4 bg-dark-900 rounded-xl border border-dark-600 relative overflow-hidden min-h-[100px] flex items-center justify-center">
            {showMnemonic ? (
              <p className="text-sm font-bold text-center leading-relaxed font-mono">{decryptedMnemonic}</p>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="flex gap-1 flex-wrap justify-center blur-sm select-none">
                  {decryptedMnemonic.split(' ').map((word, index) => (
                    <span key={index} className="px-2 py-1 bg-dark-700 rounded text-[10px]">{word}</span>
                  ))}
                </div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Hidden</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">{privateKeyLabel}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPrivKey(!showPrivKey)}
                className="p-1.5 bg-dark-700 rounded-lg text-gray-400 hover:text-white transition-colors"
              >
                {showPrivKey ? <IoEyeOffOutline className="w-4 h-4" /> : <IoEyeOutline className="w-4 h-4" />}
              </button>
              <button
                onClick={() => copyToClipboard(derivedPrivKey)}
                className="p-1.5 bg-dark-700 rounded-lg text-gray-400 hover:text-white transition-colors"
              >
                <IoCopyOutline className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="p-4 bg-dark-900 rounded-xl border border-dark-600 font-mono text-xs break-all min-h-[60px] flex items-center justify-center">
            {showPrivKey ? (derivedPrivKey || 'Unavailable for selected account/network') : '****************************************************************'}
          </div>
        </div>

        <div className="space-y-2 p-4 bg-dark-900 rounded-xl border border-dark-600">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Public Key (EVM)</p>
          <p className="text-xs font-mono text-gray-300 break-all">{publicKey || 'Unavailable'}</p>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            className="w-full btn-primary flex items-center justify-center gap-2"
            onClick={handleDownload}
          >
            <IoDownloadOutline className="w-5 h-5" />
            Download Keys as JSON
          </Button>
          <Button
            variant="outline"
            className="w-full flex items-center justify-center gap-2"
            onClick={handleCopyAll}
          >
            <IoCopyOutline className="w-5 h-5" />
            Copy All to Clipboard
          </Button>
        </div>

        {downloaded && (
          <div className="p-3 bg-green-900/20 border border-green-500/30 rounded-xl flex items-center gap-2">
            <IoCheckmarkCircle className="text-green-500 w-5 h-5 flex-shrink-0" />
            <p className="text-xs font-bold text-green-200">Keys downloaded successfully. Keep the file secure.</p>
          </div>
        )}
      </div>
    </PasswordGate>
  )
}

export default ShowSecrets
