import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IoArrowForward,
  IoColorPaletteOutline,
  IoEyeOffOutline,
  IoLayersOutline,
  IoMoonOutline,
  IoPinOutline,
  IoResizeOutline,
  IoRocketOutline,
  IoSendOutline,
  IoSettingsOutline,
  IoSunnyOutline,
  IoSwapHorizontalOutline
} from 'react-icons/io5'
import { Button } from '../components/Button'
import { PageTransition } from '../components/PageTransition'
import { getEnabledNetworks } from '../lib/networkVisibility'
import { getStoredThemeMode, setThemeMode, type ThemeMode } from '../lib/themeMode'
import { useWalletStore } from '../store/walletStore'
import { MAX_ACTIVE_REFRESH_NETWORKS } from '../store/walletStoreStateUtils'

const WelcomeGuide: React.FC = () => {
  const navigate = useNavigate()
  const {
    networks,
    disabledNetworkIds,
    setOnboardingCompleted
  } = useWalletStore()
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getStoredThemeMode())
  const isLight = themeMode === 'light'

  const enabledNetworks = useMemo(
    () => getEnabledNetworks(networks, disabledNetworkIds),
    [networks, disabledNetworkIds]
  )
  const featuredNetworks = enabledNetworks.slice(0, 6)

  const finishGuide = (nextRoute: string) => {
    setOnboardingCompleted(true)
    navigate(nextRoute, { replace: true })
  }

  const toggleTheme = () => {
    const next = themeMode === 'dark' ? 'light' : 'dark'
    setThemeMode(next)
    setThemeModeState(next)
  }

  return (
    <PageTransition>
      <div className={`relative h-full overflow-y-auto hide-scrollbar ${isLight ? 'bg-slate-50' : 'bg-dark-800'}`}>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-20 -right-12 w-44 h-44 rounded-full bg-primary/12 blur-3xl" />
          <div className="absolute top-44 -left-16 w-36 h-36 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute bottom-8 right-0 w-40 h-40 rounded-full bg-yellow-500/10 blur-3xl" />
        </div>

        <div className="relative px-5 pt-5 pb-6 space-y-4">
          <section className={`rounded-[28px] border p-5 overflow-hidden ${
            isLight
              ? 'border-primary/25 bg-gradient-to-br from-white via-orange-50 to-slate-100 shadow-[0_18px_40px_rgba(15,23,42,0.08)]'
              : 'border-primary/30 bg-gradient-to-br from-dark-700/95 via-dark-800 to-dark-900'
          }`}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-primary">MetaYoshi Flight Deck</p>
                <h1 className={`text-[22px] leading-[1.05] font-black uppercase tracking-tight ${isLight ? 'text-slate-950' : 'text-gray-100'}`}>
                  Wallet Ready.
                  <br />
                  Use It Fast.
                </h1>
                <p className={`max-w-[240px] text-[11px] leading-relaxed ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
                  Short guide for the features you will use most: theme mode, networks, Send Hub, coin tools, send and receive.
                </p>
              </div>
              <div className="relative w-20 h-20 shrink-0">
                <div className={`absolute inset-0 rounded-full border ${isLight ? 'border-primary/35' : 'border-primary/30'}`} />
                <div className={`absolute inset-2 rounded-full border ${isLight ? 'border-blue-500/20' : 'border-blue-400/20'}`} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className={`w-12 h-12 rounded-full border flex items-center justify-center shadow-[0_0_22px_rgba(245,132,31,0.18)] ${
                    isLight ? 'border-primary/35 bg-white/90' : 'border-primary/40 bg-primary/10'
                  }`}>
                    <img src="/MetayoshiLogo.png" alt="MetaYoshi" className="w-9 h-9 object-contain" />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {[
                { label: 'Theme', icon: <IoColorPaletteOutline className="w-4 h-4" /> },
                { label: 'Networks', icon: <IoLayersOutline className="w-4 h-4" /> },
                { label: 'Send Hub', icon: <IoSwapHorizontalOutline className="w-4 h-4" /> },
                { label: 'Send', icon: <IoSendOutline className="w-4 h-4" /> }
              ].map((item) => (
                <div key={item.label} className={`rounded-2xl border px-2 py-2 flex flex-col items-center gap-1 text-center ${
                  isLight ? 'border-slate-200 bg-white/80' : 'border-dark-600 bg-dark-700/35'
                }`}>
                  <span className="text-primary">{item.icon}</span>
                  <span className={`text-[9px] font-black uppercase tracking-[0.14em] ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>{item.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={`rounded-3xl border p-4 space-y-3 ${isLight ? 'border-slate-200 bg-white/90' : 'border-dark-600 bg-dark-800/70'}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Theme Mode</p>
                <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>Settings has the same switch. You can test it here now.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={themeMode === 'light'}
                aria-label="Toggle light and dark mode"
                onClick={toggleTheme}
                className={`relative inline-flex h-8 w-16 items-center rounded-full border transition-colors ${
                  themeMode === 'dark'
                    ? 'bg-dark-700 border-dark-600'
                    : 'bg-primary/15 border-primary/35'
                }`}
              >
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-black shadow-sm transition-transform ${
                    themeMode === 'dark' ? 'translate-x-0.5' : 'translate-x-8'
                  }`}
                >
                  {themeMode === 'dark' ? <IoMoonOutline className="w-4 h-4" /> : <IoSunnyOutline className="w-4 h-4" />}
                </span>
              </button>
            </div>
            <div className={`rounded-2xl border px-3 py-3 ${isLight ? 'border-slate-200 bg-slate-50' : 'border-dark-600 bg-dark-700/30'}`}>
              <p className={`text-[11px] ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>
                Path: <span className={`font-black ${isLight ? 'text-slate-950' : 'text-gray-100'}`}>Settings</span> {'>'} <span className={`font-black ${isLight ? 'text-slate-950' : 'text-gray-100'}`}>Theme mode</span>
              </p>
            </div>
          </section>

          <section className={`rounded-3xl border p-4 space-y-3 ${isLight ? 'border-slate-200 bg-white/90' : 'border-dark-600 bg-dark-800/70'}`}>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Enable Networks</p>
              <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
                Use <span className={`font-bold ${isLight ? 'text-slate-800' : 'text-gray-200'}`}>Settings {'>'} Manage blockchain visibility</span> to turn blockchains on or off.
              </p>
            </div>
            <div className={`rounded-2xl border p-3 space-y-3 ${isLight ? 'border-slate-200 bg-slate-50' : 'border-dark-600 bg-dark-700/30'}`}>
              <div className="flex items-center justify-between">
                <p className={`text-[10px] font-black uppercase tracking-[0.14em] ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>Active Now</p>
                <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-gray-500'}`}>{enabledNetworks.length} / {MAX_ACTIVE_REFRESH_NETWORKS}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {featuredNetworks.map((network) => (
                  <span key={network.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                    isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-dark-600 bg-dark-800/70 text-gray-200'
                  }`}>
                    {network.logo
                      ? <img src={network.logo} alt={network.name} className="w-4 h-4 rounded-full object-cover" />
                      : <span className="w-2 h-2 rounded-full bg-primary" />}
                    {network.symbol}
                  </span>
                ))}
              </div>
              <p className={`text-[11px] ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
                Keep only the chains you use often. The wallet starts with tested blockchains enabled and refreshes up to {MAX_ACTIVE_REFRESH_NETWORKS} active networks at once.
              </p>
            </div>
          </section>

          <section className={`rounded-3xl border p-4 space-y-3 ${isLight ? 'border-slate-200 bg-white/90' : 'border-dark-600 bg-dark-800/70'}`}>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Send Hub</p>
              <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
                Send Hub scans enabled chains, groups holdings, and lets you act from one place.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <GuideBadge icon={<IoResizeOutline className="w-4 h-4" />} label="Drag to move" isLight={isLight} />
              <GuideBadge icon={<IoPinOutline className="w-4 h-4" />} label="Pin to top" isLight={isLight} />
              <GuideBadge icon={<IoRocketOutline className="w-4 h-4" />} label="Batch when possible" isLight={isLight} />
            </div>
            <div className={`rounded-2xl border p-3 space-y-2 ${isLight ? 'border-slate-200 bg-slate-50' : 'border-dark-600 bg-dark-700/30'}`}>
              <GuideRow label="Open" value="Wallet -> Send Hub" isLight={isLight} />
              <GuideRow label="Use" value="Refresh to scan, expand rows, send one holder or many." isLight={isLight} />
            </div>
          </section>

          <section className={`rounded-3xl border p-4 space-y-3 ${isLight ? 'border-slate-200 bg-white/90' : 'border-dark-600 bg-dark-800/70'}`}>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Coin Page Tools</p>
              <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
                On the asset rows, use the eye button to hide a coin from Send Hub. It does not delete the asset.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className={`rounded-2xl border p-3 space-y-2 ${isLight ? 'border-slate-200 bg-slate-50' : 'border-dark-600 bg-dark-700/30'}`}>
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${isLight ? 'border-yellow-400/35 bg-yellow-50' : 'border-yellow-500/30 bg-yellow-500/10'}`}>
                  <IoEyeOffOutline className="w-4.5 h-4.5 text-yellow-300" />
                </div>
                <p className={`text-[11px] font-bold ${isLight ? 'text-slate-900' : 'text-gray-200'}`}>Hide from Send Hub</p>
                <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-gray-500'}`}>Use this on the coin page when you want a cleaner send list.</p>
              </div>
              <div className={`rounded-2xl border p-3 space-y-2 ${isLight ? 'border-slate-200 bg-slate-50' : 'border-dark-600 bg-dark-700/30'}`}>
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${isLight ? 'border-primary/30 bg-orange-50' : 'border-primary/40 bg-primary/10'}`}>
                  <IoLayersOutline className="w-4.5 h-4.5 text-primary" />
                </div>
                <p className={`text-[11px] font-bold ${isLight ? 'text-slate-900' : 'text-gray-200'}`}>Preview and inspect</p>
                <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-gray-500'}`}>Open asset previews where available before you send.</p>
              </div>
            </div>
          </section>

          <section className={`rounded-3xl border p-4 space-y-3 ${isLight ? 'border-slate-200 bg-white/90' : 'border-dark-600 bg-dark-800/70'}`}>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Send And Receive</p>
              <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
                Switch the active network first, then send or receive on that exact chain.
              </p>
            </div>
            <div className={`rounded-2xl border p-3 space-y-2 ${isLight ? 'border-slate-200 bg-slate-50' : 'border-dark-600 bg-dark-700/30'}`}>
              <GuideRow label="Receive" value="Use the header receive action to open the QR and copy the current chain address." isLight={isLight} />
              <GuideRow label="Send" value="Open Send Hub or choose a coin from Assets, then confirm the network before sending." isLight={isLight} />
            </div>
          </section>

          <section className={`rounded-[28px] border p-4 space-y-3 ${
            isLight
              ? 'border-primary/25 bg-gradient-to-br from-white via-orange-50 to-slate-100 shadow-[0_18px_40px_rgba(15,23,42,0.08)]'
              : 'border-primary/30 bg-gradient-to-br from-dark-700/90 to-dark-900'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Start Here</p>
                <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>Pick where you want to land first. This guide will not open again after you continue.</p>
              </div>
              <IoArrowForward className="w-5 h-5 text-primary shrink-0" />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Button className="w-full btn-primary rounded-2xl" onClick={() => finishGuide('/wallet/assets')}>
                Open Wallet
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="w-full rounded-2xl" onClick={() => finishGuide('/wallet/send')}>
                  Send Hub
                </Button>
                <Button variant="outline" className="w-full rounded-2xl" onClick={() => finishGuide('/settings')}>
                  Settings
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </PageTransition>
  )
}

const GuideBadge: React.FC<{ icon: React.ReactNode; label: string; isLight: boolean }> = ({ icon, label, isLight }) => (
  <div className={`rounded-2xl border px-2 py-3 flex flex-col items-center gap-1.5 text-center ${
    isLight ? 'border-slate-200 bg-slate-50' : 'border-dark-600 bg-dark-700/30'
  }`}>
    <span className="text-primary">{icon}</span>
    <span className={`text-[9px] font-black uppercase tracking-[0.12em] ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>{label}</span>
  </div>
)

const GuideRow: React.FC<{ label: string; value: string; isLight: boolean }> = ({ label, value, isLight }) => (
  <div className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${
    isLight ? 'border-slate-200 bg-white' : 'border-dark-600 bg-dark-800/60'
  }`}>
    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-primary shrink-0 mt-0.5">{label}</span>
    <p className={`text-[11px] leading-relaxed ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>{value}</p>
  </div>
)

export default WelcomeGuide
