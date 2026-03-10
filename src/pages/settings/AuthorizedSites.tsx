import React from 'react'
import { Button } from '../../components/Button'
import { useWalletStore } from '../../store/walletStore'
import { IoTrashOutline } from 'react-icons/io5'

const AuthorizedSites: React.FC = () => {
  const { authorizedSites, removeAuthorizedSite } = useWalletStore()

  return (
    <div className="flex flex-col h-full bg-dark-800">
      <header className="p-4 bg-dark-900 border-b border-dark-600 text-center">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-200">Authorized Sites</h2>
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {authorizedSites.length > 0 ? (
          <div className="divide-y divide-dark-600">
            {authorizedSites.map((site) => (
              <div key={site} className="flex items-center justify-between p-4 hover:bg-dark-700 transition-colors">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-8 h-8 rounded-full bg-dark-700 border border-dark-600 flex items-center justify-center flex-shrink-0">
                    <div className="w-4 h-4 bg-blue-500 rounded-full" />
                  </div>
                  <span className="text-xs font-bold text-gray-200 truncate">{site}</span>
                </div>
                <button 
                  onClick={() => removeAuthorizedSite(site)}
                  className="p-2 text-gray-500 hover:text-red-500 transition-colors"
                >
                  <IoTrashOutline className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-12 text-center space-y-3 opacity-60">
            <div className="w-14 h-14 rounded-full bg-dark-700/50 border border-dark-600 flex items-center justify-center">
              <div className="w-6 h-6 bg-dark-600 rounded-full" />
            </div>
            <p className="text-sm font-medium text-gray-400">No authorized sites</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default AuthorizedSites
