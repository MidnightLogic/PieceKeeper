# @midnightlogic/piecekeeper-crypto

[![NPM Version](https://img.shields.io/npm/v/@midnightlogic/piecekeeper-crypto?color=success)](https://www.npmjs.com/package/@midnightlogic/piecekeeper-crypto)
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
// No encryption password, with a comment label "backup-key".
const shares = await splitSecret('my-master-password', 5, 3, '', 'backup-key');

console.log(shares.length); // 5

// Each share is a self-describing Base64URL envelope:
console.log(shares[0]);
// {
//   ShareIndex: 1,
//   Share:       "AgAIBABlNq4F...",   ← Base64URL-encoded binary
//   Comment:     "backup-key",
//   Timestamp:   "2026-04-24T09:00:00.000Z",
//   Version:     "2.0",
//   IsEncrypted: false
// }

// The .Share string is what you distribute — print it, QR-encode it, write to NFC, etc.
console.log(shares[0].Share); // "AgAIBABlNq4FYmFja3VwLWtleQMFAa3R..."
console.log(shares[1].Share); // "AgAIBABlNq4FYmFja3VwLWtleQMFAp7X..."
console.log(shares[2].Share); // "AgAIBABlNq4FYmFja3VwLWtleQMFAwkT..."
```

### 2. Inspect a Share (Without Decrypting)

```js
import { inspectShare } from '@midnightlogic/piecekeeper-crypto';

// You can read the metadata of any share without needing the encryption password.
const metadata = inspectShare(shares[0].Share);

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

// Provide any 3 of the 5 shares — order doesn't matter, pick any combination.
const result = await reconstructSecret(
  [shares[0], shares[2], shares[4]],  // shares 1, 3, and 5
  ''                                   // no encryption password
);

console.log(result);
// {
//   success: true,
//   secret:  "my-master-password",     ← the original secret!
//   metadata: {
//     note:      "backup-key",
//     date:      "2026-04-24T09:00:00.000Z",
//     version:   "2.0",
//     kdfSchema: "4",
//     familyId:  "659bae05",
//     n: 5,                            ← total shares generated
//     k: 3                             ← threshold required
//   }
// }

// With fewer than 3 shares, reconstruction fails — no information is leaked:
const fail = await reconstructSecret([shares[0], shares[1]], '');
console.log(fail.success); // false
console.log(fail.error);   // "Insufficient shares for reconstruction."
```

---

## With Two-Factor Encryption

Shares can be encrypted with a password so that physical possession alone isn't enough:

```js
import { splitSecret, reconstructSecret } from '@midnightlogic/piecekeeper-crypto';

// Split with AES-256-GCM encryption (password = "strong-password")
const encrypted = await splitSecret('seed-phrase-word-list', 3, 2, 'strong-password', 'vault');

// Each share is encrypted — inspectShare() still works (metadata is plaintext):
console.log(inspectShare(encrypted[0].Share).isEncrypted); // true

// Reconstruction FAILS without the password:
const noPass = await reconstructSecret(encrypted.slice(0, 2), '');
console.log(noPass.success); // false — "Encryption password required."

// Reconstruction FAILS with wrong password:
const wrongPass = await reconstructSecret(encrypted.slice(0, 2), 'wrong');
console.log(wrongPass.success); // false — "Decryption failed."

// Reconstruction SUCCEEDS with correct password:
const ok = await reconstructSecret(encrypted.slice(0, 2), 'strong-password');
console.log(ok.success); // true
console.log(ok.secret);  // "seed-phrase-word-list"
```

---

## Schema Discovery & Limits

The module ships with 6 KDF schemas and exposes helpers to discover them:

```js
import {
  listSchemas,
  getSchema,
  DEFAULT_SCHEMA,
  MAX_SECRET_LENGTH,
  MAX_ENCRYPTION_KEY_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_SHARES
} from '@midnightlogic/piecekeeper-crypto';

// List all available KDF schemas
console.log(listSchemas());  // ['1', '2', '3', '4', '5', '6']

// Inspect a specific schema
console.log(getSchema('4'));
// {
//   kdf_algorithm: 'Argon2id',
//   memory_cost:   65536,          ← 64MB RAM
//   time_cost:     3,
//   parallelism:   4,
//   aes_algorithm: 'AES-GCM',
//   aes_key_length: 256,
//   salt_bytes:    16,
//   iv_bytes:      12
// }

console.log(getSchema('6'));
// {
//   kdf_algorithm:   'scrypt',
//   cpu_memory_cost: 131072,       ← N parameter
//   block_size:      8,
//   parallelization: 1,
//   ...
// }

// Check the default schema used when no schemaVersion is passed to splitSecret()
console.log(DEFAULT_SCHEMA);          // '4' (Argon2id 64MB)

// System limits — validate user input before calling splitSecret()
console.log(MAX_SECRET_LENGTH);       // 250  (UTF-8 bytes)
console.log(MAX_ENCRYPTION_KEY_LENGTH); // 256 (characters)
console.log(MAX_COMMENT_LENGTH);      // 32   (characters)
console.log(MAX_SHARES);              // 64   (max N)
```

### Selecting a Schema

Pass the schema key as the last argument to `splitSecret()`:

```js
// Use fast PBKDF2 (schema '2') instead of the default Argon2id:
const fast = await splitSecret('my-secret', 3, 2, 'password', 'fast-mode', false, '2');

// Use scrypt (schema '6'):
const scryptShares = await splitSecret('my-secret', 3, 2, 'password', '', false, '6');
```

---

## API Reference

### `splitSecret(secret, n, k, encryptionKey?, comment?, isStealth?, schemaVersion?)`

Splits a secret into `n` shares with threshold `k`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `secret` | `string` | — | The secret text to split (max 250 UTF-8 bytes). |
| `n` | `number` | — | Total shares to generate (1–64). |
| `k` | `number` | — | Minimum threshold for reconstruction. |
| `encryptionKey` | `string` | `''` | AES encryption password. Pass `''` for no encryption. |
| `comment` | `string` | `''` | Metadata comment embedded in each share (max 32 chars). |
| `isStealth` | `boolean` | `false` | Force uniform 2048-bit shares. |
| `schemaVersion` | `string \| null` | `'4'` | KDF schema key. See `listSchemas()`. |

**Returns:** `Promise<Array<{ ShareIndex, Share, Comment, Timestamp, Version, IsEncrypted }>>`

---

### `inspectShare(shareBase64)`

Extracts metadata from a share without decrypting it.

| Parameter | Type | Description |
|---|---|---|
| `shareBase64` | `string` | The Base64URL-encoded share string. |

**Returns:** `ShareMetadata` — `{ isValid, version, familyId, comment, timestamp, isEncrypted, isStealth, primeIndex, kdfSchema, payload, aadBytes, error? }`

---

### `reconstructSecret(sharesInput, encryptionKey?)`

Reconstructs the original secret from `k` or more shares.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sharesInput` | `Array<{ Share: string }>` | — | Array of share objects. |
| `encryptionKey` | `string \| null` | `null` | Decryption password (or `''`/`null` for unencrypted). |

**Returns:** `Promise<{ success, secret?, error?, metadata? }>`

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

---

## Browser Usage

In browser contexts, offload heavy KDF operations (Argon2id, scrypt) to a Web Worker to prevent UI thread blocking. See the [PieceKeeper PWA](https://github.com/MidnightLogic/PieceKeeper/tree/main/packages/pwa) for a production worker bridge implementation.

---

## License

Apache 2.0 — see [LICENSE](https://github.com/MidnightLogic/PieceKeeper/blob/main/LICENSE) for details.
