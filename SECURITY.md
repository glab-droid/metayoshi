# Security Policy

## Overview

MetaYoshi Wallet is a non-custodial browser extension wallet. Security is a core product requirement. We treat vulnerabilities affecting key safety, signing flows, dapp permissions, provider behavior, storage, extension packaging, and browser messaging as high priority.

If you believe you have found a security issue, report it privately. Do not publish exploit details until we have had a reasonable opportunity to investigate, validate, and release a fix.

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.8 | Yes |
| < 0.1.8 | No |

Security fixes are prioritized for the latest public release.

## How To Report A Vulnerability

Report vulnerabilities privately to:

- Security contact: `security@metayoshi.example`
- Backup contact: `admin@metayoshi.example`

Replace these placeholders with your real contact addresses before publishing.

Include as much of the following as possible:

- A clear description of the issue
- Affected version
- Affected component or file
- Steps to reproduce
- Proof of concept, screenshots, logs, or video if useful
- Impact assessment
- Any suggested remediation

For wallet-related reports, never send:

- Seed phrases
- Private keys
- Real wallet passwords
- Unredacted production secrets
- Sensitive user data that is not required to prove the issue

Use test wallets and scrubbed data whenever possible.

## Scope

The following areas are in scope:

- Browser extension background, content, and inpage scripts
- Injected provider behavior exposed to dapps
- Account access, permission prompts, and approval flows
- Transaction signing and send flows
- Vault encryption and wallet unlock behavior
- Local storage and persisted state handling
- Network and RPC request handling
- Origin validation and message bridge security
- Manifest, packaging, and release artifacts
- Website or public docs only when they create a wallet security risk

## High Severity Examples

Examples of issues we consider high severity:

- Private key, seed phrase, or secret exposure
- Unauthorized transaction signing
- Silent approval bypasses
- Dapp permission escalation
- Origin spoofing in provider or bridge flows
- Arbitrary website access to privileged wallet actions
- Background/content/inpage message injection
- Storage bypass leading to wallet compromise
- Dangerous default credentials or production-like secret fallback
- Packaging changes that weaken extension isolation or integrity

## Out Of Scope

The following are generally out of scope unless they directly lead to privilege escalation, signing abuse, or secret exposure:

- Missing best-practice headers on unrelated pages
- Generic rate limiting issues without security impact
- Denial of service requiring local developer setup only
- Vulnerabilities in third-party services outside our control
- Social engineering
- Reports based only on outdated dependencies without exploitability
- UI copy issues without a security consequence
- Test-only or mock-only code paths that are not shipped

## Disclosure Expectations

Please follow responsible disclosure:

- Do not publicly disclose the issue before coordination
- Do not access, modify, or destroy data you do not own
- Do not exfiltrate secrets or user funds
- Do not run high-volume or destructive tests against production systems
- Stop testing immediately if you believe user data or funds may be at risk

We will aim to:

- Acknowledge receipt within 3 business days
- Provide an initial triage decision within 7 business days
- Keep you informed on remediation status for valid reports

Resolution time depends on severity, exploitability, and release risk.

## Safe Harbor

We will not pursue action against researchers who:

- Act in good faith
- Avoid privacy violations, data destruction, and service disruption
- Report issues privately and give us reasonable time to respond
- Test only within the scope described in this policy

This safe harbor does not apply to illegal activity, extortion, theft, or disclosure of sensitive user information.

## No Bug Bounty

Unless explicitly announced elsewhere, MetaYoshi Wallet does not currently operate a paid bug bounty program. Valid reports are still appreciated and will be reviewed.

## Security Principles

MetaYoshi Wallet follows these principles:

- Non-custodial by default
- Explicit user approval for sensitive actions
- No silent fallback for secrets or bridge credentials
- Deterministic behavior over hidden magic
- Minimal attack surface in extension and dapp bridge layers
- Clear separation between chain-specific logic and shared wallet behavior

## User Safety Note

MetaYoshi staff will never ask for your seed phrase or private keys. If anyone requests them, treat it as malicious.
