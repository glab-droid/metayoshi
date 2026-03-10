import React from 'react'
import { useNavigate } from 'react-router-dom'
import { IoChevronForward, IoMoonOutline, IoSunnyOutline } from 'react-icons/io5'
import { getStoredThemeMode, setThemeMode, type ThemeMode } from '../../lib/themeMode'

const MainSettings: React.FC = () => {
  const navigate = useNavigate()
  const [themeMode, setThemeModeState] = React.useState<ThemeMode>(() => getStoredThemeMode())

  const toggleThemeMode = () => {
    const next = themeMode === 'dark' ? 'light' : 'dark'
    setThemeMode(next)
    setThemeModeState(next)
  }

  const SECTIONS = [
    {
      title: 'ACCOUNT SETTINGS',
      items: [
        { label: 'Manage accounts', path: '/settings/accounts' },
        { label: 'Change wallet password', path: '/settings/password' },
        { label: 'Change wallet Autolock', path: '/settings/autolock' },
        { label: 'Change donation %', path: '/settings/donation' },
      ]
    },
    {
      title: 'BACKUP / RESTORE',
      items: [
        { label: 'Backup wallet', path: '/settings/backup' },
        { label: 'Restore wallet', path: '/settings/restore' },
      ]
    },
    {
      title: 'SHOW / DOWNLOAD KEYS',
      items: [
        { label: 'Show / download recovery phrase and private key', path: '/settings/show-secrets' },
      ]
    },
    {
      title: 'DAPP AUTH CONNECTOR MANAGER',
      items: [
        { label: 'Show authorized websites', path: '/settings/authorized-sites' },
      ]
    },
    {
      title: 'PERFORMANCE / CLEAN MENU',
      items: [
        { label: 'Manage blockchain visibility', path: '/settings/blockchains' },
      ]
    }
  ]

  return (
    <div className="flex flex-col">
      <header className="px-4 py-3 text-center border-b border-dark-600">
        <h1 className="text-sm font-black uppercase tracking-widest text-gray-200">Settings</h1>
      </header>

      <div className="flex-1">
        <div className="mb-4">
          <div className="px-4 py-2 mt-4">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none">APPEARANCE</p>
          </div>
          <div className="space-y-0.5 border-t border-b border-dark-600/50">
            <div className="flex items-center justify-between p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-gray-300">Theme mode</span>
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  {themeMode === 'dark' ? 'Dark' : 'Light'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={themeMode === 'light'}
                aria-label="Toggle light and dark mode"
                onClick={toggleThemeMode}
                className={`relative inline-flex h-7 w-14 items-center rounded-full border transition-colors ${
                  themeMode === 'dark'
                    ? 'bg-dark-700 border-dark-600'
                    : 'bg-primary/20 border-primary/40'
                }`}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-black shadow-sm transition-transform ${
                    themeMode === 'dark' ? 'translate-x-0.5' : 'translate-x-7'
                  }`}
                >
                  {themeMode === 'dark' ? <IoMoonOutline className="w-3.5 h-3.5" /> : <IoSunnyOutline className="w-3.5 h-3.5" />}
                </span>
              </button>
            </div>
          </div>
        </div>

        {SECTIONS.map((section, idx) => (
          <div key={idx} className="mb-4">
             <div className="px-4 py-2 mt-4">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none">{section.title}</p>
             </div>
             <div className="space-y-0.5 border-t border-b border-dark-600/50">
               {section.items.map((item, iidx) => (
                 <div 
                   key={iidx}
                   className="flex items-center justify-between p-4 hover:bg-dark-700 cursor-pointer transition-colors"
                   onClick={() => navigate(item.path)}
                 >
                   <span className="text-xs font-bold text-gray-300">{item.label}</span>
                   <IoChevronForward className="text-gray-600 w-4 h-4" />
                 </div>
               ))}
             </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default MainSettings
