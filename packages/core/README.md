# @midnightlogic/piecekeeper-crypto

[![NPM Version](https://img.shields.io/npm/v/@midnightlogic/piecekeeper-crypto?color=success)](https://www.npmjs.com/package/@midnightlogic/piecekeeper-crypto)
[![CI](https://github.com/MidnightLogic/PieceKeeper/actions/workflows/publish-npm.yml/badge.svg)](https://github.com/MidnightLogic/PieceKeeper/actions/workflows/publish-npm.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://github.com/MidnightLogic/PieceKeeper/blob/main/LICENSE)

Isomorphic Shamir's Secret Sharing + AES-256-GCM encryption for Node.js and browsers.

Split any secret into `n` shares with a configurable threshold `k` — the secret can only be reconstructed when `k` or more shares are combined. Any fewer reveals **zero information** about the original secret (information-theoretic security).

---

## Features

- **Shamir's Secret Sharing (SSS)** — 5-tier dynamic prime resolution (128-bit to 2048-bit Galois Fields).
- **AES-256-GCM** — Authenticated encryption with AEAD for optional two-factor password protection.
- **Memory-Hard KDFs** — Argon2id, scrypt, and PBKDF2 via [hash-wasm](https://github.com/nicolo-ribaudo/nicolo-ribaudo) (zero native dependencies).
- **Isomorphic** — Works identically in Node.js 18+ and all modern browsers. Ships ESM, CJS, and full TypeScript declarations.
- **Stealth Mode** — Forces uniform 2048-bit shares that reveal nothing about the secret's actual size.
- **Integrity Checksums** — SHA-256 truncated checksums detect corrupted or tampered shares during reconstruction.
- **Typed Error Hierarchy** — 18 exported error classes with machine-readable `.code` properties for programmatic `catch` handling.
- **Per-Call KDF Overrides** — Power users can override individual KDF parameters (memory, iterations) without defining custom schemas.

---

## Installation

```bash
npm install @midnightlogic/piecekeeper-crypto
```

---

## Quick Start

### 1. Split a Secret into Shares

```js
import { splitSecret } from '@midnightlogic/piecekeeper-crypto';

// Split "my-master-password" into 5 shares, requiring any 3 to reconstruct.
const shares = await splitSecret('my-master-password', 5, 3, {
  comment: 'backup-key'
});

console.log(shares.length); // 5

// Each share is a self-describing Base64URL envelope:
console.log(shares[0]);
// {
//   shareIndex:  1,
//   share:       "AgAIBABlNq4F...",   ← Base64URL-encoded binary
//   comment:     "backup-key",
//   timestamp:   "2026-04-24T09:00:00.000Z",
//   version:     "2.0",
//   isEncrypted: false
// }

// The .share string is what you distribute — print it, QR-encode it, write to NFC, etc.
console.log(shares[0].share); // "AgAIBABlNq4FYmFja3VwLWtleQMFAa3R..."
```

### 2. Inspect a Share (Without Decrypting)

```js
import { inspectShare } from '@midnightlogic/piecekeeper-crypto';

// Read metadata without needing the encryption password.
const metadata = inspectShare(shares[0].share);

console.log(metadata);
// {
//   isValid:     true,
//   version:     "2.0",
//   familyId:    "659bae05",         ← all shares in a set share this ID
//   comment:     "backup-key",
//   timestamp:   "2026-04-24T09:00:00.000Z",
//   isEncrypted: false,
//   isStealth:   false,
//   primeIndex:  0,                  ← 128-bit prime tier (auto-selected)
//   kdfSchema:   "4",
//   payload:     Uint8Array [...],   ← the cryptographic payload
//   aadBytes:    Uint8Array [...]    ← the authenticated header
// }
```

### 3. Reconstruct the Secret

```js
import { reconstructSecret } from '@midnightlogic/piecekeeper-crypto';

// Provide any 3 of the 5 shares — order doesn't matter.
const result = await reconstructSecret(
  [shares[0], shares[2], shares[4]],  // shares 1, 3, and 5
  ''                                   // no encryption password
);

console.log(result);
// {
//   secret:  "my-master-password",     ← the original secret!
//   metadata: {
//     comment:   "backup-key",
//     timestamp: "2026-04-24T09:00:00.000Z",
//     version:   "2.0",
//     kdfSchema: "4",
//     familyId:  "659bae05",
//     n: 5,                            ← total shares generated
//     k: 3                             ← threshold required
//   }
// }

// With fewer than 3 shares, reconstruction throws:
import { InsufficientSharesError } from '@midnightlogic/piecekeeper-crypto';

try {
  await reconstructSecret([shares[0], shares[1]], '');
} catch (e) {
  if (e instanceof InsufficientSharesError) {
    console.log(e.required); // 3
    console.log(e.provided); // 2
    console.log(e.code);     // "INSUFFICIENT_SHARES"
  }
}
```

---

## With Two-Factor Encryption

Shares can be encrypted with a password so that physical possession alone isn't enough:

```js
import {
  splitSecret, reconstructSecret,
  PasswordRequiredError, WrongPasswordError
} from '@midnightlogic/piecekeeper-crypto';

// Split with AES-256-GCM encryption (password = "strong-password")
const encrypted = await splitSecret('seed-phrase-word-list', 3, 2, {
  encryptionKey: 'strong-password',
  comment: 'vault'
});

// Each share is encrypted — inspectShare() still works (metadata is plaintext):
console.log(inspectShare(encrypted[0].share).isEncrypted); // true

// Reconstruction THROWS without the password:
try {
  await reconstructSecret(encrypted.slice(0, 2), '');
} catch (e) {
  console.log(e instanceof PasswordRequiredError); // true
}

// Reconstruction THROWS with wrong password:
try {
  await reconstructSecret(encrypted.slice(0, 2), 'wrong');
} catch (e) {
  console.log(e instanceof WrongPasswordError); // true
}

// Reconstruction SUCCEEDS with correct password:
const ok = await reconstructSecret(encrypted.slice(0, 2), 'strong-password');
console.log(ok.secret); // "seed-phrase-word-list"
```

---

## `splitSecret` Options Object

The fourth argument accepts an options object for clean, extensible configuration:

```js
const shares = await splitSecret('my-secret', 5, 3, {
  encryptionKey: 'optional-password',   // default: '' (no encryption)
  comment:       'vault-backup',        // default: '' (max 32 chars)
  stealth:       true,                  // default: false (uniform 2048-bit shares)
  schema:        '4',                   // default: DEFAULT_SCHEMA ('4' = Argon2id 64MB)
  kdfOverrides:  { memory_cost: 131072 } // default: null (override individual KDF params)
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `encryptionKey` | `string` | `''` | AES-256-GCM password. Empty = no encryption. |
| `comment` | `string` | `''` | Metadata label embedded in each share (max 32 chars). |
| `stealth` | `boolean` | `false` | Force uniform 2048-bit shares regardless of secret size. |
| `schema` | `string` | `'4'` | KDF schema key. See `listSchemas()`. |
| `kdfOverrides` | `Object` | `null` | Per-call KDF parameter overrides (see below). |

### `kdfOverrides` — Power User KDF Tuning

Override individual KDF parameters without defining a custom schema:

```js
// Double the default Argon2id memory from 64MB to 128MB
const hardened = await splitSecret('high-value-secret', 5, 3, {
  encryptionKey: 'pass',
  schema: '4',
  kdfOverrides: {
    memory_cost: 131072,  // 128MB instead of 64MB
    time_cost: 5,         // 5 passes instead of 3
  }
});
```

> **⚠️ Important:** `kdfOverrides` changes the KDF parameters used during encryption, but the share header still records the base schema ID. This means reconstruction will use the base schema's default parameters. `kdfOverrides` is designed for advanced scenarios where you control both the split and reconstruct environments.

---

## Typed Error Handling

All errors extend `PieceKeeperError` with a machine-readable `.code` property:

```js
import {
  splitSecret, reconstructSecret,
  PieceKeeperError,
  SecretEmptyError,
  ThresholdExceededError,
  InsufficientSharesError,
  PasswordRequiredError,
  WrongPasswordError,
  IntegrityCheckError,
  SetMismatchError,
} from '@midnightlogic/piecekeeper-crypto';

try {
  const result = await reconstructSecret(shares, password);
} catch (e) {
  if (e instanceof PasswordRequiredError) showPasswordPrompt();
  else if (e instanceof InsufficientSharesError) {
    console.log(`Need ${e.required - e.provided} more shares`);
  }
  else if (e instanceof WrongPasswordError) showWrongPasswordFeedback();
  else if (e instanceof IntegrityCheckError) showCorruptionWarning();
  else if (e instanceof SetMismatchError) showMismatchWarning();
  else throw e; // unexpected
}
```

### Error Hierarchy

```
PieceKeeperError (base — .code, .message, .name)
├── ValidationError
│   ├── SecretEmptyError          (SECRET_EMPTY)
│   ├── SecretTooLongError        (SECRET_TOO_LONG)       .maxBytes, .actualBytes
│   ├── ThresholdExceededError    (THRESHOLD_EXCEEDED)    .n, .k
│   └── EncryptionKeyTooLongError (ENCRYPTION_KEY_TOO_LONG) .maxLength
├── ShareFormatError
│   ├── InvalidBase64Error        (INVALID_BASE64)
│   ├── UnsupportedVersionError   (UNSUPPORTED_VERSION)   .version
│   └── CorruptedShareError       (CORRUPTED_SHARE)
├── ReconstructionError
│   ├── InsufficientSharesError   (INSUFFICIENT_SHARES)   .required, .provided
│   ├── SetMismatchError          (SET_MISMATCH)
│   ├── IntegrityCheckError       (INTEGRITY_CHECK_FAILED)
│   └── PasswordRequiredError     (PASSWORD_REQUIRED)
├── DecryptionError
│   ├── WrongPasswordError        (WRONG_PASSWORD)
│   └── DataTooShortError         (DATA_TOO_SHORT)
└── SchemaError
    └── UnknownSchemaError        (UNKNOWN_SCHEMA)        .schemaKey
```

---

## Schema Discovery & Limits

```js
import {
  listSchemas, getSchema, DEFAULT_SCHEMA,
  MAX_SECRET_LENGTH, MAX_ENCRYPTION_KEY_LENGTH, MAX_COMMENT_LENGTH, MAX_SHARES
} from '@midnightlogic/piecekeeper-crypto';

console.log(listSchemas());     // ['1', '2', '3', '4', '5', '6']
console.log(DEFAULT_SCHEMA);    // '4' (Argon2id 64MB)

console.log(getSchema('4'));
// { kdf_algorithm: 'Argon2id', memory_cost: 65536, time_cost: 3, parallelism: 4, ... }

console.log(MAX_SECRET_LENGTH);        // 250 (UTF-8 bytes)
console.log(MAX_ENCRYPTION_KEY_LENGTH); // 256 (characters)
console.log(MAX_COMMENT_LENGTH);       // 32  (characters)
console.log(MAX_SHARES);              // 64
```

### Selecting a Schema

```js
// Use fast PBKDF2 (schema '2') instead of the default Argon2id:
const fast = await splitSecret('my-secret', 3, 2, {
  encryptionKey: 'password',
  schema: '2'
});

// Use scrypt (schema '6'):
const scryptShares = await splitSecret('my-secret', 3, 2, {
  encryptionKey: 'password',
  schema: '6'
});
```

---

## Stealth Mode (Uniform Share Size)

By default, the engine auto-selects the smallest prime field that fits your secret. An attacker who intercepts a share could estimate the secret's length from its size.

**Stealth mode** forces all shares to the maximum 2048-bit prime field with zero-padded payloads:

```js
import { splitSecret, inspectShare } from '@midnightlogic/piecekeeper-crypto';

// Normal mode — share size reflects secret length
const normal = await splitSecret('short', 3, 2, { comment: 'normal-test' });
console.log(normal[0].share.length);  // ~60 characters (128-bit prime)

// Stealth mode — fixed large shares regardless of secret size
const stealth = await splitSecret('short', 3, 2, {
  stealth: true,
  comment: 'stealth-test'
});
console.log(stealth[0].share.length); // ~470 characters (2048-bit prime)

// Metadata reveals stealth was used:
console.log(inspectShare(stealth[0].share).isStealth);  // true
```

> **When to use:** High-security scenarios where share size could leak information about the secret (e.g., distinguishing a short PIN from a long seed phrase).

---

## Integrity & Corruption Detection

Each share contains a truncated SHA-256 checksum. Corrupted or mismatched shares throw typed errors:

```js
import {
  splitSecret, reconstructSecret,
  IntegrityCheckError, SetMismatchError
} from '@midnightlogic/piecekeeper-crypto';

const shares = await splitSecret('my-secret', 3, 2, { comment: 'test' });

// Tamper with a share string
const corrupted = { ...shares[0], share: shares[0].share.slice(0, -10) + 'XXXXXXXXXX' };
try {
  await reconstructSecret([corrupted, shares[1]], '');
} catch (e) {
  console.log(e instanceof IntegrityCheckError); // true
}

// Mix shares from two different sets
const otherShares = await splitSecret('other-secret', 3, 2, { comment: 'other' });
try {
  await reconstructSecret([shares[0], otherShares[1]], '');
} catch (e) {
  console.log(e instanceof SetMismatchError); // true
}
```

---

## Custom Logging

By default the module logs nothing. Inject a logger to trace cryptographic operations:

```js
import { setLogger, splitSecret } from '@midnightlogic/piecekeeper-crypto';

setLogger({
  info:  (...args) => console.log('[PK]', ...args),
  warn:  (...args) => console.warn('[PK]', ...args),
  error: (...args) => console.error('[PK]', ...args),
});

const shares = await splitSecret('test', 3, 2);
// [PK] [Engine] Forging polynomial share 1/3 (x-intercept: 1)
// [PK] [Engine] Forging polynomial share 2/3 (x-intercept: 2)
// [PK] [Engine] Forging polynomial share 3/3 (x-intercept: 3)
```

---

## API Reference

### `splitSecret(secret, n, k, options?)`

Splits a secret into `n` shares with threshold `k`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `secret` | `string` | — | The secret text to split (max 250 UTF-8 bytes). |
| `n` | `number` | — | Total shares to generate (1–64). |
| `k` | `number` | — | Minimum threshold for reconstruction. |
| `options` | `SplitOptions` | `{}` | See [Options Object](#splitsecret-options-object). |

**Returns:** `Promise<Array<{ shareIndex, share, comment, timestamp, version, isEncrypted }>>`

**Throws:** `SecretEmptyError`, `SecretTooLongError`, `ThresholdExceededError`, `ValidationError`, `EncryptionKeyTooLongError`

---

### `reconstructSecret(sharesInput, encryptionKey?)`

Reconstructs the original secret from `k` or more shares. **Throws on failure** (never returns `{ success: false }`).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sharesInput` | `Array<{ share: string }>` | — | Array of share objects. |
| `encryptionKey` | `string` | `''` | Decryption password (or `''` for unencrypted). |

**Returns:** `Promise<{ secret: string, metadata: { comment, timestamp, version, kdfSchema, familyId, n, k } }>`

**Throws:** `PasswordRequiredError`, `WrongPasswordError`, `InsufficientSharesError`, `SetMismatchError`, `IntegrityCheckError`, `CorruptedShareError`

---

### `inspectShare(shareBase64)`

Extracts metadata from a share without decrypting it.

| Parameter | Type | Description |
|---|---|---|
| `shareBase64` | `string` | The Base64URL-encoded share string. |

**Returns:** `{ isValid, version, familyId, comment, timestamp, isEncrypted, isStealth, primeIndex, kdfSchema, payload, aadBytes, error? }`

---

### Additional Exports

| Export | Description |
|---|---|
| `deriveKey(password, salt, schema)` | Derives a 32-byte AES key using the specified KDF schema. |
| `encryptBytes(data, key, aad?, schema?)` | Encrypts a `Uint8Array` with AES-256-GCM. |
| `decryptBytes(data, key, isEncrypted, schema, aad?)` | Decrypts AES-256-GCM ciphertext. |
| `bytesToBase64(bytes)` / `base64ToBytes(b64)` | Base64URL encoding/decoding. |
| `listSchemas()` | Returns all available KDF schema keys. |
| `getSchema(key)` | Returns the full config for a schema key. |
| `DEFAULT_SCHEMA` | Default KDF schema key (`'4'`). |
| `MAX_SECRET_LENGTH` | Max secret size (250 bytes). |
| `MAX_ENCRYPTION_KEY_LENGTH` | Max encryption password (256 chars). |
| `MAX_COMMENT_LENGTH` | Max comment length (32 chars). |
| `MAX_SHARES` | Max shares per split (64). |
| `APP_CONFIG` | Full configuration object (advanced use). |
| `setLogger(logger)` | Injects a custom `{ info, warn, error }` logger. |
| `PieceKeeperError`, ... | See [Typed Error Handling](#typed-error-handling). |

---

## Browser Usage

In browser contexts, offload heavy KDF operations (Argon2id, scrypt) to a Web Worker to prevent UI thread blocking. See the [PieceKeeper PWA](https://github.com/MidnightLogic/PieceKeeper/tree/main/packages/pwa) for a production worker bridge implementation.

---

## License

Apache 2.0 — see [LICENSE](https://github.com/MidnightLogic/PieceKeeper/blob/main/LICENSE) for details.
