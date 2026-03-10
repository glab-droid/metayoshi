import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageTransition } from '../components/PageTransition'
import { Button } from '../components/Button'

type TermSection = {
  id: string
  title: string
  body: React.ReactNode
}

const SECTIONS: TermSection[] = [
  {
    id: 'acceptance',
    title: '1. Acceptance of Terms',
    body: (
      <p>
        By using MetaYoshi, you agree to these Terms of Service. If you do not agree, do not use the application.
      </p>
    ),
  },
  {
    id: 'services',
    title: '2. The Services',
    body: (
      <p>
        MetaYoshi provides non-custodial wallet software and related tooling that helps you interact with multiple
        blockchain networks. Some functionality may rely on bridge/API endpoints, third-party nodes, or RPC providers.
      </p>
    ),
  },
  {
    id: 'non-custodial',
    title: '3. Non-Custodial Notice',
    body: (
      <div className="space-y-2">
        <p>You control your private keys, seed phrase, and signing environment.</p>
        <p>MetaYoshi cannot recover, reset, or restore your wallet if you lose your recovery data.</p>
      </div>
    ),
  },
  {
    id: 'responsibility',
    title: '4. Your Responsibilities',
    body: (
      <div className="space-y-2">
        <p>
          You are responsible for verifying addresses, amounts, network selection, and any transaction or signature
          details before approving.
        </p>
        <p>
          Blockchain transactions are often irreversible. Mistakes, phishing, malware, or compromised devices can lead
          to permanent loss of assets.
        </p>
      </div>
    ),
  },
  {
    id: 'security',
    title: '5. Security of Your Device',
    body: (
      <p>
        You are responsible for device security (malware protection, OS/browser updates, password strength, and physical
        access). Unauthorized access to your device or browser profile may result in loss of assets.
      </p>
    ),
  },
  {
    id: 'compliance',
    title: '6. Eligibility and Compliance',
    body: (
      <p>
        You are responsible for ensuring your use is legal in your jurisdiction, including any sanctions, tax, and
        regulatory compliance obligations.
      </p>
    ),
  },
  {
    id: 'acceptable-use',
    title: '7. Acceptable Use',
    body: (
      <div className="space-y-2">
        <p>You agree not to misuse MetaYoshi or any related endpoints, including by:</p>
        <ul className="list-disc pl-5 space-y-1 text-gray-300">
          <li>attempting to bypass security, rate limits, or access controls</li>
          <li>probing, scanning, or exploiting systems, dependencies, or infrastructure</li>
          <li>using the Services for fraud, theft, malware, or other unlawful activity</li>
          <li>overloading endpoints with excessive automated requests</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'third-parties',
    title: '8. Third-Party Networks and Services',
    body: (
      <p>
        MetaYoshi may interact with third-party blockchain networks, validators, RPC providers, nodes, explorers, and
        protocols. Those third parties are not controlled by MetaYoshi and may have their own terms, policies, fees,
        and availability constraints.
      </p>
    ),
  },
  {
    id: 'no-advice',
    title: '9. No Professional Advice',
    body: (
      <p>
        MetaYoshi does not provide financial, legal, tax, or investment advice. Any decision to use digital assets,
        protocols, or networks is entirely your own.
      </p>
    ),
  },
  {
    id: 'availability',
    title: '10. Availability and Changes',
    body: (
      <p>
        MetaYoshi may change, suspend, or discontinue features at any time. We do not guarantee that any chain, feature,
        endpoint, or integration will be available or supported indefinitely.
      </p>
    ),
  },
  {
    id: 'disclaimers',
    title: '11. Disclaimers',
    body: (
      <p>
        MetaYoshi is provided on an "as is" and "as available" basis without warranties of any kind. Blockchain
        software involves risk, including risk of loss of digital assets due to user error, software defects, network
        conditions, or third-party actions.
      </p>
    ),
  },
  {
    id: 'liability',
    title: '12. Limitation of Liability',
    body: (
      <p>
        To the maximum extent permitted by law, MetaYoshi is not liable for any indirect, incidental, special,
        consequential, or punitive damages, or any loss of profits, data, or digital assets arising out of or related to
        your use of MetaYoshi.
      </p>
    ),
  },
  {
    id: 'privacy',
    title: '13. Privacy',
    body: (
      <p>
        Privacy details for MetaYoshi websites and bridge endpoints are published at <code>metayoshi.app/privacy.html</code>.
      </p>
    ),
  },
  {
    id: 'contact',
    title: '14. Contact',
    body: (
      <p>
        Questions about these Terms can be sent to <code>support@metayoshi.app</code>.
      </p>
    ),
  },
]

const TermsAndRules: React.FC = () => {
  const navigate = useNavigate()
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null)

  const toggleSection = (sectionId: string) => {
    setExpandedSectionId((current) => (current === sectionId ? null : sectionId))
  }

  return (
    <PageTransition>
      <div className="flex flex-col h-full p-6 bg-dark-800 text-left overflow-y-auto hide-scrollbar">
        <div className="space-y-2 mb-5">
          <h1 className="text-xl font-black uppercase tracking-tight text-white">Terms of Service</h1>
          <p className="text-xs text-gray-400">
            Last updated: February 28, 2026
          </p>
        </div>

        <div className="space-y-2 text-[12px] leading-relaxed">
          {SECTIONS.map((section) => {
            const isExpanded = expandedSectionId === section.id
            return (
              <section key={section.id} className="rounded-lg border border-dark-600 bg-dark-700/40">
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left flex items-center justify-between gap-3"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isExpanded}
                  aria-controls={`section-content-${section.id}`}
                >
                  <h2 className="text-xs font-bold uppercase tracking-widest text-gray-300">{section.title}</h2>
                  <span className="text-[11px] text-gray-400">{isExpanded ? '-' : '+'}</span>
                </button>
                {isExpanded && (
                  <div id={`section-content-${section.id}`} className="px-3 pb-3 text-gray-300">
                    <div className="space-y-2">{section.body}</div>
                  </div>
                )}
              </section>
            )
          })}
        </div>

        <div className="mt-6">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate(-1)}
          >
            Back
          </Button>
        </div>
      </div>
    </PageTransition>
  )
}

export default TermsAndRules
