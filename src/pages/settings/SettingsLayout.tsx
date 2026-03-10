import React from 'react'
import { Outlet, useNavigate, Link } from 'react-router-dom'
import { IoArrowBack } from 'react-icons/io5'
import { PageTransition } from '../../components/PageTransition'

const SettingsLayout: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-full bg-dark-800 overflow-hidden">
      <header className="px-4 py-2 bg-dark-900 border-b border-dark-600 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/wallet/assets')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <IoArrowBack className="w-5 h-5" />
          </button>
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Settings</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </div>
    </div>
  )
}

export default SettingsLayout
