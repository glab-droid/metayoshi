import React, { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IoArrowBack, IoCheckmarkCircle } from 'react-icons/io5'
import { Button } from '../../components/Button'
import {
  DAPP_PENDING_APPROVAL_STORAGE_KEY,
  type DappScope
} from '../../lib/dappPermissions'
import { getAccountDisplayName } from '../../lib/accountName'
import { useWalletStore } from '../../store/walletStore'
import DappApprovalStatus from './DappApprovalStatus'
import { canUseChromeStorage, usePendingDappApproval } from './usePendingDappApproval'

function scopeLabel(scope: DappScope): string {
  if (scope === 'read') return 'View your wallet address and balances'
  if (scope === 'sign') return 'Request message signatures (currently disabled in SDK)'
  if (scope === 'send_coin') return 'Suggest native coin transactions'
  if (scope === 'select_account') return 'Request to switch your active wallet account'
  if (scope === 'switch_network') return 'Switch the active wallet network'
  return 'Suggest token and NFT transfer transactions'
}

const DappConnectStep2: React.FC = () => {
  const navigate = useNavigate()
  const { addAuthorizedSite, accounts, activeAccountId, activeNetworkId, networks } = useWalletStore()
  const { pendingApproval, loadingApproval } = usePendingDappApproval()

  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeAccountId) || accounts[0],
    [accounts, activeAccountId]
  )
  const approvalNetworkId = String(pendingApproval?.networkId || activeNetworkId || '').trim()
  const approvalNetwork = useMemo(
    () => networks.find((network) => network.id === approvalNetworkId) || networks.find((network) => network.id === activeNetworkId) || networks[0],
    [networks, approvalNetworkId, activeNetworkId]
  )
  const activeAccountName = useMemo(
    () => getAccountDisplayName(activeAccount, approvalNetworkId || activeNetworkId, 'Account'),
    [activeAccount, approvalNetworkId, activeNetworkId]
  )
  const approvalAddress = useMemo(() => {
    if (!activeAccount) return ''

    const networkAddress = String(activeAccount.networkAddresses?.[approvalNetworkId] || '').trim()
    if (networkAddress) return networkAddress

    if (approvalNetwork?.coinType === 'EVM') return String(activeAccount.addresses?.EVM || '').trim()
    if (approvalNetwork?.coinType === 'XRP') return String(activeAccount.addresses?.XRP || '').trim()
    if (approvalNetwork?.coinType === 'COSMOS') return String(activeAccount.addresses?.COSMOS || '').trim()
    if (approvalNetwork?.coinType === 'UTXO') return String(activeAccount.addresses?.UTXO || '').trim()

    return String(activeAccount.addresses?.UTXO || activeAccount.addresses?.EVM || '').trim()
  }, [activeAccount, approvalNetwork, approvalNetworkId])

  const finishApproval = async (status: 'approved' | 'rejected'): Promise<void> => {
    if (!pendingApproval || !canUseChromeStorage()) {
      navigate('/wallet/assets')
      return
    }

    if (status === 'approved') {
      addAuthorizedSite(pendingApproval.origin)
    }

    await chrome.storage.local.set({
      [DAPP_PENDING_APPROVAL_STORAGE_KEY]: {
        ...pendingApproval,
        status,
        updatedAt: Date.now()
      }
    })

    navigate('/wallet/assets')
    window.close()
  }

  if (loadingApproval || !pendingApproval) {
    return <DappApprovalStatus loading={loadingApproval} onBack={() => navigate('/wallet/assets')} />
  }

  const content = (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="p-4 flex items-center justify-between border-b border-dark-600">
        <div className="flex items-center gap-2">
          <Link to="/dapp/connect/1" className="text-gray-400 hover:text-white">
            <IoArrowBack className="w-5 h-5" />
          </Link>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Connecting Wallet with Dapp</span>
        </div>
        <span className="text-xs font-bold text-primary">2 of 2</span>
      </header>

      <div className="flex-1 p-6 space-y-6 overflow-y-auto custom-scrollbar">
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-16 h-16 rounded-full bg-dark-700 border border-dark-600 flex items-center justify-center overflow-hidden">
            <div className="w-8 h-8 bg-blue-500 rounded-full" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold">Connect to {activeAccountName}</h2>
            <p className="text-xs text-gray-400">{pendingApproval.origin}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-dark-600 bg-dark-700/50">
            <p className="text-xs font-bold text-gray-400 uppercase mb-4">Permissions requested:</p>
            <ul className="space-y-3">
              {pendingApproval.scopes.map((scope) => (
                <PermissionItem key={scope} label={scopeLabel(scope)} />
              ))}
            </ul>
          </div>

          <div className="p-4 rounded-xl border border-dark-600 bg-dark-700/50 space-y-3">
            <p className="text-xs font-bold text-gray-400 uppercase">Connection summary</p>
            <p className="text-xs text-gray-300 leading-relaxed">
              This site will connect to your active wallet account on {approvalNetwork?.name || 'the requested network'}.
              It will not receive a custom list of selected accounts from this approval.
            </p>
            <p className="break-all rounded-lg bg-dark-900/70 px-3 py-2 font-mono text-[10px] text-gray-300">
              {approvalAddress || 'No address available on the requested network'}
            </p>
            <p className="text-[10px] text-gray-500 leading-tight">
              If the site later requests an account change, MetaYoshi will prompt again before switching your active
              wallet account.
            </p>
          </div>

          <p className="text-[10px] text-gray-500 leading-tight">
            Only connect with trusted sites. Asset scope includes ERC20/ERC721/ERC1155 on EVM, SPL Tokens/SPL NFTs/Compressed NFTs on Solana, Cosmos denom/CW20/CW721 where enabled, and other network-native asset layers.
          </p>
        </div>
      </div>

      <footer className="p-4 border-t border-dark-600 flex gap-4">
        <Button variant="outline" className="flex-1" onClick={() => { void finishApproval('rejected') }}>
          Cancel
        </Button>
        <Button className="flex-1 btn-primary" onClick={() => { void finishApproval('approved') }} disabled={!approvalAddress}>
          Connect
        </Button>
      </footer>
    </div>
  )

  return content
}

const PermissionItem: React.FC<{ label: string }> = ({ label }) => (
  <li className="flex items-center gap-2 text-xs font-medium text-gray-200">
    <IoCheckmarkCircle className="text-primary w-4 h-4 flex-shrink-0" />
    {label}
  </li>
)

export default DappConnectStep2
