/**
 * @midnightlogic/piecekeeper-crypto — Core Test Suite (v2.0.0)
 *
 * Isolated tests that validate SSS math, encryption, and reconstruction
 * without any DOM, browser, or PWA dependencies.
 */

import { describe, it, expect } from 'vitest';
import {
    splitSecret,
    reconstructSecret,
    inspectShare,
    bytesToBase64,
    base64ToBytes,
    deriveKey,
    APP_CONFIG,
    setLogger,
    getCryptoRandomBigInt,
    modularInverse,
    bigIntToBytes,
    bytesToBigInt,
    // Typed errors
    PieceKeeperError,
    SecretEmptyError,
    SecretTooLongError,
    ThresholdExceededError,
    EncryptionKeyTooLongError,
    InsufficientSharesError,
    SetMismatchError,
    IntegrityCheckError,
    PasswordRequiredError,
    WrongPasswordError,
    ValidationError,
    InvalidBase64Error,
} from '../src/index.js';

// Inject a test-friendly logger
setLogger({
    info: () => {},
    warn: (...args) => console.warn('[TEST WARN]', ...args),
    error: (...args) => console.error('[TEST ERROR]', ...args),
});

// ── Math Utilities ──────────────────────────────────────────────────────

describe('Math Utilities', () => {
    it('getCryptoRandomBigInt returns values in range [0, max)', () => {
        const max = 1000n;
        for (let i = 0; i < 50; i++) {
            const val = getCryptoRandomBigInt(max);
            expect(val).toBeGreaterThanOrEqual(0n);
            expect(val).toBeLessThan(max);
        }
    });

    it('modularInverse satisfies (a * a^-1) mod p === 1', () => {
        const p = 7919n; // A known prime
        for (const a of [1n, 2n, 100n, 7918n]) {
            const inv = modularInverse(a, p);
            expect((a * inv) % p).toBe(1n);
        }
    });

    it('bigIntToBytes and bytesToBigInt are inverse operations', () => {
        const values = [0n, 1n, 255n, 256n, 65535n, (1n << 128n) + 51n];
        for (const val of values) {
            const bytes = bigIntToBytes(val);
            const recovered = bytesToBigInt(bytes);
            expect(recovered).toBe(val);
        }
    });
});

// ── Binary Utilities ────────────────────────────────────────────────────

describe('Binary Utilities', () => {
    it('bytesToBase64 and base64ToBytes are inverse operations', () => {
        const original = new Uint8Array([0, 1, 127, 128, 255, 42, 99]);
        const encoded = bytesToBase64(original);
        const decoded = base64ToBytes(encoded);
        expect(decoded).toEqual(original);
    });

    it('Base64URL encoding uses - and _ instead of + and /', () => {
        // 0xFB, 0xEF, 0xBE → standard Base64: "+++++/" with + and /
        const bytes = new Uint8Array([251, 239, 190]);
        const encoded = bytesToBase64(bytes);
        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');
        expect(encoded).not.toContain('=');
    });
});

// ── Share Parsing ───────────────────────────────────────────────────────

describe('inspectShare', () => {
    it('returns isValid: false for data shorter than 14 bytes', () => {
        const shortData = bytesToBase64(new Uint8Array(10));
        const result = inspectShare(shortData);
        expect(result.isValid).toBe(false);
    });

    it('returns isValid: false for wrong schema major version', () => {
        const badHeader = new Uint8Array(20);
        badHeader[0] = 99; // Wrong major version
        const result = inspectShare(bytesToBase64(badHeader));
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Unsupported share format');
    });

    it('throws InvalidBase64Error for non-Base64 input', () => {
        expect(() => inspectShare('!!!not-base64!!!')).toThrow(InvalidBase64Error);
    });
});

// ── Shamir's Secret Sharing ─────────────────────────────────────────────

describe('Shamir Secret Sharing — Unencrypted', () => {
    it('Basic 3-of-5: generates 5 shares and reconstructs with any 3', async () => {
        const shares = await splitSecret('MySimplePassword123', 5, 3, { comment: 'Test Comment 1' });
        expect(shares).toHaveLength(5);

        // Verify camelCase return shape
        expect(shares[0]).toHaveProperty('shareIndex');
        expect(shares[0]).toHaveProperty('share');
        expect(shares[0]).toHaveProperty('comment');
        expect(shares[0]).toHaveProperty('timestamp');
        expect(shares[0]).toHaveProperty('version');
        expect(shares[0]).toHaveProperty('isEncrypted');

        // Reconstruct with first 3 shares
        const result = await reconstructSecret(shares.slice(0, 3));
        expect(result.secret).toBe('MySimplePassword123');
        expect(result.metadata.comment).toBe('Test Comment 1');

        // Reconstruct with non-adjacent shares [1, 3, 5]
        const result2 = await reconstructSecret([shares[0], shares[2], shares[4]]);
        expect(result2.secret).toBe('MySimplePassword123');
    });

    it('Throws InsufficientSharesError with too few shares (2 of 3 needed)', async () => {
        const shares = await splitSecret('MySimplePassword123', 5, 3, { comment: 'Test' });
        await expect(reconstructSecret(shares.slice(0, 2))).rejects.toThrow(InsufficientSharesError);
    });

    it('Edge case: k=1 (single share reconstruction)', async () => {
        const shares = await splitSecret('k_is_one', 2, 1, { comment: 'k=1 test' });
        const r = await reconstructSecret([shares[1]]);
        expect(r.secret).toBe('k_is_one');
    });

    it('UTF-8 special characters survive round-trip', async () => {
        const secret = '🔑 αβγ ✅ € ™ 你好 π≈3.14';
        const shares = await splitSecret(secret, 4, 2, { comment: 'UTF8' });
        const r = await reconstructSecret(shares.slice(0, 2));
        expect(r.secret).toBe(secret);
    });

    it('Duplicate shares are de-duplicated (throws InsufficientSharesError)', async () => {
        const shares = await splitSecret('DuplicateTest', 3, 3, { comment: 'Dup Test' });
        await expect(
            reconstructSecret([shares[0], shares[0], shares[1]])
        ).rejects.toThrow(InsufficientSharesError);
    });

    it('Mismatched family IDs throw SetMismatchError', async () => {
        const sharesA = await splitSecret('SecretA', 3, 2, { comment: 'Set A' });
        const sharesB = await splitSecret('SecretB', 3, 2, { comment: 'Set B' });
        await expect(
            reconstructSecret([sharesA[0], sharesB[1]])
        ).rejects.toThrow(SetMismatchError);
    });

    it('Corrupted share data throws an error', async () => {
        const shares = await splitSecret('CorruptTest', 3, 2, { comment: 'Corrupt' });
        const corruptedStr = shares[0].share.substring(0, shares[0].share.length - 10) + '!!!!!!!!';
        await expect(
            reconstructSecret([{ shareIndex: 1, share: corruptedStr }, shares[1]])
        ).rejects.toThrow(PieceKeeperError);
    });
});

// ── Typed Error Validation ──────────────────────────────────────────────

describe('Typed Error Validation', () => {
    it('Throws SecretEmptyError for empty secret', async () => {
        await expect(splitSecret('', 3, 2)).rejects.toThrow(SecretEmptyError);
    });

    it('Throws ThresholdExceededError when k > n', async () => {
        await expect(splitSecret('test', 2, 5)).rejects.toThrow(ThresholdExceededError);
    });

    it('Throws ValidationError when k < 1', async () => {
        await expect(splitSecret('test', 3, 0)).rejects.toThrow(ValidationError);
    });

    it('Throws ValidationError for empty shares array', async () => {
        await expect(reconstructSecret([])).rejects.toThrow(ValidationError);
    });

    it('Error codes are machine-readable strings', async () => {
        try {
            await splitSecret('test', 2, 5);
        } catch (e) {
            expect(e.code).toBe('THRESHOLD_EXCEEDED');
            expect(e.n).toBe(2);
            expect(e.k).toBe(5);
        }
    });
});

// ── Encrypted Shares ────────────────────────────────────────────────────

describe('Shamir Secret Sharing — Encrypted (PBKDF2)', () => {
    it('Encrypted 2-of-3: throws without password, succeeds with correct password', async () => {
        // Use schema '2' (fast PBKDF2) to keep tests quick
        const shares = await splitSecret('Another!@#Secret', 3, 2, {
            encryptionKey: 'myEncKey123',
            comment: 'Encrypted Test',
            schema: '2',
        });

        // Throws PasswordRequiredError without password
        await expect(
            reconstructSecret(shares.slice(0, 2))
        ).rejects.toThrow(PasswordRequiredError);

        // Throws WrongPasswordError with wrong password
        await expect(
            reconstructSecret(shares.slice(0, 2), 'wrongKey')
        ).rejects.toThrow(WrongPasswordError);

        // Succeeds with correct password
        const result = await reconstructSecret(shares.slice(0, 2), 'myEncKey123');
        expect(result.secret).toBe('Another!@#Secret');
    });
});

// ── KDF deriveKey ───────────────────────────────────────────────────────

describe('deriveKey', () => {
    it('PBKDF2 schema produces 32-byte key', async () => {
        const schema = APP_CONFIG.CRYPTO_SCHEMAS['2']; // Fast PBKDF2
        const salt = new Uint8Array(16);
        const key = await deriveKey('test-password', salt, schema);
        expect(key).toBeInstanceOf(Uint8Array);
        expect(key.length).toBe(32);
    });

    it('Argon2id schema produces 32-byte key', async () => {
        const schema = APP_CONFIG.CRYPTO_SCHEMAS['5']; // Light Argon2id (16MB)
        const salt = new Uint8Array(16);
        const key = await deriveKey('test-password', salt, schema);
        expect(key).toBeInstanceOf(Uint8Array);
        expect(key.length).toBe(32);
    });

    it('scrypt schema produces 32-byte key', async () => {
        const schema = APP_CONFIG.CRYPTO_SCHEMAS['6'];
        const salt = new Uint8Array(16);
        const key = await deriveKey('test-password', salt, schema);
        expect(key).toBeInstanceOf(Uint8Array);
        expect(key.length).toBe(32);
    });

    it('Same inputs produce identical keys (deterministic)', async () => {
        const schema = APP_CONFIG.CRYPTO_SCHEMAS['2'];
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key1 = await deriveKey('determinism', salt, schema);
        const key2 = await deriveKey('determinism', salt, schema);
        expect(key1).toEqual(key2);
    });
});

// ── Options Object & kdfOverrides ───────────────────────────────────────

describe('splitSecret Options Object', () => {
    it('Works with no options (defaults)', async () => {
        const shares = await splitSecret('bare-minimum', 3, 2);
        expect(shares).toHaveLength(3);
        expect(shares[0].isEncrypted).toBe(false);
        expect(shares[0].comment).toBe('');
    });

    it('Stealth mode produces uniform-length shares', async () => {
        const normal = await splitSecret('short', 3, 2, { comment: 'normal' });
        const stealth = await splitSecret('short', 3, 2, { stealth: true, comment: 'stealth' });
        // Stealth shares should be significantly longer (2048-bit prime)
        expect(stealth[0].share.length).toBeGreaterThan(normal[0].share.length);
    });

    it('kdfOverrides are accepted and do not break unencrypted flow', async () => {
        // kdfOverrides has no effect on unencrypted shares (no KDF is invoked),
        // but verifies the option is accepted without error.
        const shares = await splitSecret('override-test', 3, 2, {
            comment: 'kdf-override',
            schema: '2',
            kdfOverrides: { pbkdf2_iterations: 10000 },
        });
        expect(shares).toHaveLength(3);

        const result = await reconstructSecret(shares.slice(0, 2));
        expect(result.secret).toBe('override-test');
    });

    it('kdfOverrides with encryption changes the derived key', async () => {
        // This verifies the override actually takes effect: encrypting with
        // non-default iterations produces shares that CANNOT be reconstructed
        // using the base schema (because the header schema ID still says '2').
        const shares = await splitSecret('override-enc', 3, 2, {
            encryptionKey: 'pass',
            schema: '2',
            kdfOverrides: { pbkdf2_iterations: 10000 },
        });
        expect(shares).toHaveLength(3);
        expect(shares[0].isEncrypted).toBe(true);

        // Reconstruction with the correct password BUT base schema iterations
        // will fail (WrongPasswordError) — proving the override took effect.
        await expect(
            reconstructSecret(shares.slice(0, 2), 'pass')
        ).rejects.toThrow(WrongPasswordError);
    });
});
