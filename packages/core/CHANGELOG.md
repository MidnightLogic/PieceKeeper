# Changelog

All notable changes to `@midnightlogic/piecekeeper-crypto` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-04-25

### ⚠️ BREAKING CHANGES

- **`splitSecret` Options Object** — The function now accepts `(secret, n, k, options?)` instead of 7 positional arguments. The `options` object supports `encryptionKey`, `comment`, `stealth`, `schema`, and `kdfOverrides`.
- **camelCase Return Keys** — All share objects returned by `splitSecret` now use camelCase properties: `shareIndex`, `share`, `comment`, `timestamp`, `version`, `isEncrypted` (previously `ShareIndex`, `Share`, `Comment`, `Timestamp`, `Version`, `IsEncrypted`).
- **Throw-Only `reconstructSecret`** — The function now throws typed errors on failure instead of returning `{ success: false, error }`. On success it returns `{ secret, metadata }` (no `success` property).
- **Metadata Key Renames** — `reconstructSecret` metadata uses `comment` (was `note`) and `timestamp` (was `date`).

### Added

- **Typed Error Hierarchy** — 18 exported error classes extending `PieceKeeperError`, each with a machine-readable `.code` property for programmatic `catch` handling. See README for the full hierarchy.
- **`kdfOverrides` Option** — Per-call KDF parameter overrides (e.g., `{ memory_cost: 131072 }`) that merge onto the resolved schema, giving power users fine-grained control without defining custom schemas.
- **`.npmignore`** — Prevents `src/`, `tests/`, and config files from being published to the NPM registry.

### Changed

- **`deriveKey` Error** — Fallback error now throws `UnknownSchemaError` with the schema's `kdf_algorithm` for debuggability (was a vague `'unresolved'` string).
- **`binary.js`** — Invalid Base64 input now throws `InvalidBase64Error` instead of a generic `Error`.
- **Test Suite** — Expanded from 19 to 29 tests covering typed error assertions, kdfOverrides, and camelCase verification.

### Removed

- `{ success: false }` return pattern from `reconstructSecret` — all failures are now exceptions.
- PascalCase share return keys — no backward-compatible aliases.
- Positional arguments beyond `(secret, n, k)` — use the options object.

## [1.0.1] - 2026-04-24

### Added

- **Shamir's Secret Sharing engine** — extracted from the PieceKeeper PWA into a standalone, isomorphic module.
  - `splitSecret()` — splits a secret into N shares with configurable threshold K.
  - `reconstructSecret()` — reconstructs the original secret from K or more shares via Lagrange interpolation.
  - `inspectShare()` — parses share metadata (version, encryption status, family ID, timestamp) without decryption.
- **AES-256-GCM encryption pipeline** — `encryptBytes()` and `decryptBytes()` with AEAD (Additional Authenticated Data) support.
- **Multi-KDF key derivation** via [hash-wasm](https://github.com/nicolo-ribaudo/nicolo-ribaudo):
  - Argon2id (64MB default, 16MB mobile profile)
  - scrypt (N=131072 OWASP baseline)
  - PBKDF2 (100K–2M iterations, SHA-256/SHA-512)
- **5-tier dynamic prime resolution** — automatic prime selection (128-bit to 2048-bit) based on secret size.
- **Stealth mode** — uniform 2048-bit shares with zero-padded payloads.
- **Binary Schema v2.0** — self-describing Base64URL share envelopes with integrity checksums.
- **Pluggable logger** — `setLogger()` for custom logging in consumer applications.
- **Dual-format builds** — ESM (`index.js`), CJS (`index.cjs`), and auto-generated TypeScript declarations (`index.d.ts`).
- **19 regression tests** — covering SSS math, encryption round-trips, threshold enforcement, family ID validation, and KDF correctness.
- **Schema discovery helpers** — `listSchemas()` and `getSchema(key)` for enumerating and inspecting KDF configurations.
- **Named limit exports** — `MAX_SECRET_LENGTH`, `MAX_ENCRYPTION_KEY_LENGTH`, `MAX_COMMENT_LENGTH`, `MAX_SHARES`, `DEFAULT_SCHEMA` for input validation.

### Changed

- **API normalization** — renamed public functions to a cleaner convention:
  - `createCryptographicShares` → `splitSecret`
  - `executeShamirReconstruction` → `reconstructSecret`
  - `parseShareMetadata` → `inspectShare`
- **Config field normalization** — renamed internal `APP_CONFIG` fields for consistency:
  - `APP_VERSION` → `DEFAULT_SCHEMA`
  - `MAX_PASSWORD_LENGTH` → `MAX_SECRET_LENGTH`
  - `MAX_ENCRYPTION_PASSWORD_LENGTH` → `MAX_ENCRYPTION_KEY_LENGTH`
  - `MAX_SHARES_ALLOWED` → `MAX_SHARES`
- **Parameter naming** — `splitSecret()` first parameter renamed from `password` to `secret`.

### Removed

- `SCHEMA_STORAGE_KEY` — moved to the PWA layer (localStorage is a UI concern, not a crypto module concern).

[2.0.0]: https://github.com/MidnightLogic/PieceKeeper/releases/tag/core-v2.0.0
[1.0.1]: https://github.com/MidnightLogic/PieceKeeper/releases/tag/core-v1.0.1
