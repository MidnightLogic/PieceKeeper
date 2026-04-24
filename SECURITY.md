# Security Policy

## Supported Versions

| Package | Version | Supported |
|---|---|---|
| `@midnightlogic/piecekeeper-crypto` | 1.x | ✅ |
| PieceKeeper PWA | 1.x | ✅ |

Only the latest major version receives security patches. If you are using an older version, please upgrade before reporting.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

If you discover a security issue in PieceKeeper or the `@midnightlogic/piecekeeper-crypto` package, please report it privately:

1. **Email:** Send a detailed report to **midnightlogicsoftware@protonmail.com**
2. **Include:**
   - A clear description of the vulnerability
   - Steps to reproduce the issue
   - The affected version(s)
   - Any potential impact assessment
3. **Response time:** We aim to acknowledge reports within 48 hours and provide a resolution timeline within 7 business days.

We take all reports seriously. Confirmed vulnerabilities will be patched, disclosed responsibly, and credited (with your permission) in the release notes.

## Scope

The following components are in scope:

- **Shamir's Secret Sharing** — polynomial evaluation, Lagrange interpolation, prime field arithmetic
- **AES-256-GCM** — encryption, decryption, AEAD integrity
- **Key Derivation** — Argon2id, scrypt, PBKDF2 parameter handling
- **Binary Share Format** — header parsing, payload construction, checksum validation
- **Content Security Policy** — CSP hash injection, script integrity

## Out of Scope

- Third-party dependencies (report directly to their maintainers)
- Browser-specific bugs unrelated to our code
- Social engineering or phishing attacks
