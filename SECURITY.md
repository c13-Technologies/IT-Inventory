# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| older   | :x:                |

Only the latest commit on `main` is actively supported with security updates. Older commits are not.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Report them privately through **one** of the following channels (in order of preference):

1. **GitHub Private Vulnerability Reporting** — on this repository, click the **Security** tab → **Advisories** → **New draft security advisory**. This is the fastest and most secure channel.
2. **Email** — `security@c13-technologies.com` (replace with your org's security contact if different)

Please **do not** include the vulnerability details in the email subject line — keep the subject generic ("Security report for IT-Inventory") and put the details in the body.

## What to Include

The more of the following you can provide, the faster we can triage and fix:

- **Type of issue** — e.g. SQL injection, XSS, authentication bypass, IDOR, SSRF, RCE
- **Affected component** — URL, route, file path, model, or feature
- **Affected version / commit** — e.g. `a11237a` or `main @ 2026-07-07`
- **Reproduction steps** — minimal, step-by-step
- **Proof-of-concept** — curl command, screenshot, or exploit code
- **Impact** — what an attacker could achieve, and how likely
- **Environment** — OS, browser, Node version, Postgres version (if relevant)

## Response Times

| Stage | Target |
| --- | --- |
| Acknowledge your report | within **48 hours** |
| Triage + initial assessment | within **5 business days** |
| Patch released (for high/critical issues) | within **30 days** |
| Patch released (for medium/low) | within **90 days** |
| Public advisory | after the fix is shipped and users have had time to update |

If you don't hear back within 48 hours, please follow up — your first message may have been caught in spam filters.

## Disclosure Process

1. You submit a private vulnerability report (via one of the channels above)
2. We confirm receipt and start the investigation
3. We work on a fix in a private fork
4. We release the fix on `main` and tag a security release if appropriate
5. We publish a GitHub Security Advisory with CVE (if applicable) and credit you as the reporter (unless you prefer to remain anonymous)
6. We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure) — please give us a reasonable amount of time to fix the issue before any public disclosure

## Out of Scope

The following are not considered security vulnerabilities:

- Lack of a specific HTTP security header (unless it's actively exploitable)
- Vulnerabilities in third-party libraries that are already fixed upstream (please file those with the upstream maintainer and link here)
- Self-XSS or other issues that require the user to already be authenticated and have full access
- Rate limiting gaps on non-sensitive endpoints
- Clickjacking on pages that don't perform sensitive actions
- Best-practice violations without a concrete exploit path

## Security Best Practices for Contributors

- Never commit secrets, API keys, or credentials — use `.env` (gitignored) and reference via `process.env`
- Use parameterized queries (Prisma handles this; never use raw SQL with user input)
- Validate all user input with `zod` (or similar) at the API boundary
- Use the `version` column for optimistic locking on every update
- Run `npm audit` before opening a PR; address any high/critical findings
- Don't disable security headers (helmet, CSP) without a strong reason

## Contact

For anything not covered above, reach out to the maintainers via the standard GitHub channels (Discussions, Issues). For sensitive matters, use the disclosure channels at the top of this document.

Thank you for helping keep IT-Inventory and its users safe.
