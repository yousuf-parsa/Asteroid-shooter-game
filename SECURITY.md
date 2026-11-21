# Security Policy

## Architecture & Security Model

Void Shatter is a purely client-side HTML5 Canvas and Web Audio API game with:

- Zero external dependencies, CDNs, trackers, cookies, or third-party scripts
- Zero runtime network requests (`connect-src 'none'`)
- A strict Content Security Policy (`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none';`)
- No dynamic code evaluation (`eval`, `new Function`) or HTML string injection (`innerHTML`, `document.write`)
- Strictly validated `localStorage` usage limited to local high score and audio mute preference

## Reporting a Vulnerability

If you discover a security issue in this repository or its live deployment, please report it privately using **GitHub Private Vulnerability Reporting** under the repository's **Security → Advisories** tab rather than opening a public issue.

Please include:

- A clear description of the issue and potential impact
- Steps to reproduce (browser, device, and URL if applicable)
- Any suggested fix or mitigation
