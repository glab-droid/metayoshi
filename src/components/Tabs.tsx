import React from 'react'
import { clsx } from 'clsx'

interface Tab {
  id: string
  label: string
}

interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onChange: (id: string) => void
  className?: string
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange, className }) => {
  return (
    <div className={clsx("flex border-b border-dark-600 shrink-0", className)}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={clsx(
            "tab-item",
            activeTab === tab.id ? "tab-active" : "tab-inactive"
          )}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </div>
      ))}
    </div>
  )
}
