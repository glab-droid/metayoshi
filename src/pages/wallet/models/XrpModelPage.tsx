import React, { useState } from 'react'
import { IoPricetagOutline, IoTimerOutline } from 'react-icons/io5'

const XrpModelPage: React.FC = () => {
  const [useDestinationTag, setUseDestinationTag] = useState(false)
  const [tag, setTag] = useState('')

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
      <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-dark-700/90 to-dark-900 p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">XRP Ledger Desk</p>
        <p className="text-[11px] text-gray-400 mt-2">Reserve-aware account model with destination tag controls.</p>
      </section>

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase text-gray-300">
          <IoTimerOutline className="w-4 h-4 text-primary" />
          Reserve Snapshot
        </div>
        <p className="text-[11px] text-gray-500">
          Reserve values are not available from current XRP adapter payloads.
        </p>
      </section>

      <section className="rounded-xl border border-dark-600 bg-dark-800/60 p-3 space-y-2">
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-2 text-xs font-bold uppercase text-gray-300">
            <IoPricetagOutline className="w-4 h-4 text-primary" />
            Destination Tag
          </div>
          <input
            type="checkbox"
            checked={useDestinationTag}
            onChange={(e) => setUseDestinationTag(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
        </label>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value.replace(/[^\d]/g, ''))}
          disabled={!useDestinationTag}
          placeholder="Enter numeric tag"
          className="w-full bg-dark-700/60 border border-dark-600 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-primary disabled:opacity-50"
        />
      </section>

    </div>
  )
}

export default XrpModelPage
