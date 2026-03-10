import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { useWalletStore } from '../../store/walletStore'
import { IoAdd, IoTrashOutline, IoCheckmarkCircle } from 'react-icons/io5'
import { useToast } from '../../components/Toast'
import { validateWatchOnlyAddress } from '../../lib/watchOnlyAddress'
import { getAccountDisplayName } from '../../lib/accountName'

const AccountManager: React.FC = () => {
  const {
    accounts,
    activeAccountId,
    activeNetworkId,
    networks,
    setActiveAccount,
    addAccount,
    removeAccount,
    setNetworkAccountName,
    setWatchOnlyAddress,
    refreshActiveBalance
  } = useWalletStore()
  const [showAdd, setShowAdd] = useState(false)
  const [accountName, setAccountName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')
  const [watchOnlyAddress, setWatchOnlyAddressInput] = useState('')
  const [watchOnlyError, setWatchOnlyError] = useState('')
  const [isSavingWatchOnly, setIsSavingWatchOnly] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const { showToast } = useToast()
  const navigate = useNavigate()
  const activeNetwork = networks.find((n) => n.id === activeNetworkId) || networks[0]
  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeAccountId) || accounts[0],
    [accounts, activeAccountId]
  )
  const watchOnlyImportEnabled = activeNetwork?.derivation?.status === 'unsupported'

  useEffect(() => {
    if (!watchOnlyImportEnabled || !activeAccount || !activeNetwork) {
      setWatchOnlyAddressInput('')
      setWatchOnlyError('')
      return
    }
    setWatchOnlyAddressInput(activeAccount.networkAddresses?.[activeNetwork.id] || '')
    setWatchOnlyError('')
  }, [watchOnlyImportEnabled, activeAccount, activeNetwork])

  useEffect(() => {
    if (!activeAccount || !activeNetwork) {
      setRenameValue('')
      return
    }
    setRenameValue(getAccountDisplayName(activeAccount, activeNetwork.id, 'Account'))
  }, [activeAccount, activeNetwork])

  const handleAddAccount = async () => {
    setError('')
    
    if (!accountName.trim()) {
      setError('Account name is required')
      return
    }

    if (accounts.some(a => getAccountDisplayName(a, activeNetworkId, '').toLowerCase() === accountName.toLowerCase())) {
      setError('Account with this name already exists')
      return
    }

    setIsCreating(true)
    try {
      await addAccount(accountName.trim(), activeNetworkId)
      showToast(`${activeNetwork?.symbol || 'Network'} account created successfully`, 'success')
      setAccountName('')
      setShowAdd(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setIsCreating(false)
    }
  }

  const handleRemove = (id: string) => {
    if (accounts.length <= 1) {
      showToast('Cannot remove the last account', 'error')
      return
    }
    removeAccount(id)
    showToast('Account removed', 'success')
  }

  const handleSaveWatchOnly = async () => {
    if (!activeAccount || !activeNetwork || !watchOnlyImportEnabled) return
    setWatchOnlyError('')
    const validation = validateWatchOnlyAddress(activeNetwork, watchOnlyAddress)
    if (!validation.ok) {
      setWatchOnlyError(validation.error || 'Invalid address')
      return
    }
    setIsSavingWatchOnly(true)
    try {
      setWatchOnlyAddress(activeAccount.id, activeNetwork.id, validation.normalized)
      setWatchOnlyAddressInput(validation.normalized)
      await refreshActiveBalance()
      showToast(`${activeNetwork.symbol} watch-only address saved`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setWatchOnlyError(message)
    } finally {
      setIsSavingWatchOnly(false)
    }
  }

  const handleRenameActive = async () => {
    if (!activeAccount || !activeNetwork) return
    const nextName = String(renameValue || '').trim()
    if (!nextName) {
      showToast('Account name is required', 'error')
      return
    }
    const duplicate = accounts.some((a) => (
      a.id !== activeAccount.id
      && getAccountDisplayName(a, activeNetwork.id, '').toLowerCase() === nextName.toLowerCase()
    ))
    if (duplicate) {
      showToast(`Another ${activeNetwork.symbol} account already uses this name`, 'error')
      return
    }
    setIsRenaming(true)
    try {
      setNetworkAccountName(activeAccount.id, activeNetwork.id, nextName)
      showToast(`${activeNetwork.symbol} account renamed`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setIsRenaming(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="p-4 bg-dark-900 border-b border-dark-600 text-center flex items-center justify-between">
        <button 
          onClick={() => navigate('/settings')}
          className="w-8"
        />
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-200">Account Manager</h2>
        <button 
          onClick={() => {
            setShowAdd(!showAdd)
            setError('')
          }}
          className="w-8 h-8 flex items-center justify-center text-primary hover:bg-dark-700 rounded-full transition-colors"
        >
          <IoAdd className="w-6 h-6" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {watchOnlyImportEnabled && activeAccount && activeNetwork && (
          <div className="p-4 border-b border-dark-600 bg-dark-900/40 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
              {activeNetwork.symbol} Watch-Only Import
            </p>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Seed derivation is disabled for {activeNetwork.name} in this build. Import a public address for account{' '}
              <span className="text-gray-200 font-bold">{getAccountDisplayName(activeAccount, activeNetwork.id, activeAccount.name)}</span>.
            </p>
            <Input
              label={`${activeNetwork.name} Address`}
              placeholder={activeNetwork.id === 'ada' ? 'addr1...' : '4...'}
              value={watchOnlyAddress}
              onChange={(e) => setWatchOnlyAddressInput(e.target.value)}
              className="font-mono text-xs"
              error={watchOnlyError || undefined}
            />
            <Button className="w-full" onClick={() => void handleSaveWatchOnly()} isLoading={isSavingWatchOnly}>
              Save Watch-Only Address
            </Button>
          </div>
        )}

        {!showAdd && activeAccount && activeNetwork && (
          <div className="p-4 border-b border-dark-600 bg-dark-900/30 space-y-3">
            <Input
              label={`${activeNetwork.symbol} Account Name`}
              placeholder="Account name for this coin"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
            <Button className="w-full" onClick={() => void handleRenameActive()} isLoading={isRenaming}>
              Save {activeNetwork.symbol} Name
            </Button>
          </div>
        )}

        {showAdd ? (
          <div className="p-6 space-y-6">
            <h3 className="text-sm font-bold text-gray-200">Create New Account</h3>
            <div className="space-y-4">
              <Input 
                label="Account Name" 
                placeholder="Account 2" 
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            </div>
            {error && <p className="text-xs text-red-500 font-bold text-center">{error}</p>}
            <div className="flex gap-4 pt-4">
              <Button 
                variant="outline" 
                className="flex-1" 
                onClick={() => {
                  setShowAdd(false)
                  setError('')
                }}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button className="flex-1" onClick={() => void handleAddAccount()} isLoading={isCreating}>Create</Button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-dark-600">
            {accounts.map((account) => (
              <div 
                key={account.id} 
                className={`flex items-center justify-between p-4 cursor-pointer hover:bg-dark-700 transition-colors ${
                  activeAccountId === account.id ? 'bg-primary/5' : ''
                }`}
                onClick={() => setActiveAccount(account.id)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-yellow-500 flex-shrink-0" />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-200">{getAccountDisplayName(account, activeNetworkId, account.name)}</span>
                      {activeAccountId === account.id && <IoCheckmarkCircle className="text-primary w-4 h-4 flex-shrink-0" />}
                    </div>
                    <span className="text-[10px] text-gray-500 font-mono truncate">
                      {(() => {
                        const addr =
                          account.networkAddresses?.[activeNetworkId]
                          || (activeNetwork?.coinType === 'EVM' ? account.addresses.EVM : account.addresses.UTXO)
                          || ''
                        return addr ? `${addr.slice(0, 10)}...${addr.slice(-8)}` : 'No address on this coin yet'
                      })()}
                    </span>
                  </div>
                </div>
                {accounts.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(account.id)
                    }}
                    className="p-2 text-gray-500 hover:text-red-500 transition-colors ml-2"
                  >
                    <IoTrashOutline className="w-5 h-5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default AccountManager
