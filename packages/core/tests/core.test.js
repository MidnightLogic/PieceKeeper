/**
 * @midnightlogic/piecekeeper-crypto — Core Test Suite
 *
 * Isolated tests that validate SSS math, encryption, and reconstruction
 * without any DOM, browser, or PWA dependencies.
 */

import { describe, it, expect } from 'vitest';
import {
    createCryptographicShares,
    executeShamirReconstruction,
    parseShareMetadata,
    bytesToBase64,
    base64ToBytes,
    deriveKey,
    APP_CONFIG,
    setLogger,
    getCryptoRandomBigInt,
    modularInverse,
    bigIntToBytes,
    bytesToBigInt,
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

describe('parseShareMetadata', () => {
    it('returns isValid: false for data shorter than 14 bytes', () => {
        const shortData = bytesToBase64(new Uint8Array(10));
        const result = parseShareMetadata(shortData);
        expect(result.isValid).toBe(false);
    });

    it('returns isValid: false for wrong schema major version', () => {
        const badHeader = new Uint8Array(20);
        badHeader[0] = 99; // Wrong major version
        const result = parseShareMetadata(bytesToBase64(badHeader));
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Unsupported share format');
    });
});

// ── Shamir's Secret Sharing ─────────────────────────────────────────────

describe('Shamir Secret Sharing — Unencrypted', () => {
    it('Basic 3-of-5: generates 5 shares and reconstructs with any 3', async () => {
        const shares = await createCryptographicShares('MySimplePassword123', 5, 3, '', 'Test Comment 1');
        expect(shares).toHaveLength(5);

        // Reconstruct with first 3 shares
        const recon1 = await executeShamirReconstruction(shares.slice(0, 3), '');
        expect(recon1.success).toBe(true);
        expect(recon1.secret).toBe('MySimplePassword123');
        expect(recon1.metadata.note).toBe('Test Comment 1');

        // Reconstruct with non-adjacent shares [1, 3, 5]
        const recon2 = await executeShamirReconstruction([shares[0], shares[2], shares[4]], '');
        expect(recon2.success).toBe(true);
        expect(recon2.secret).toBe('MySimplePassword123');
    });

    it('Fails with insufficient shares (2 of 3 needed)', async () => {
        const shares = await createCryptographicShares('MySimplePassword123', 5, 3, '', 'Test');
        const recon = await executeShamirReconstruction(shares.slice(0, 2), '');
        expect(recon.success).toBe(false);
    });

    it('Edge case: k=1 (single share reconstruction)', async () => {
        const shares = await createCryptographicShares('k_is_one', 2, 1, '', 'k=1 test');
        const r = await executeShamirReconstruction([shares[1]], '');
        expect(r.success).toBe(true);
        expect(r.secret).toBe('k_is_one');
    });

    it('UTF-8 special characters survive round-trip', async () => {
        const secret = '🔑 αβγ ✅ € ™ 你好 π≈3.14';
        const shares = await createCryptographicShares(secret, 4, 2, '', 'UTF8');
        const r = await executeShamirReconstruction(shares.slice(0, 2), '');
        expect(r.success).toBe(true);
        expect(r.secret).toBe(secret);
    });

    it('Duplicate shares are de-duplicated (not enough unique shares)', async () => {
        const shares = await createCryptographicShares('DuplicateTest', 3, 3, '', 'Dup Test');
        const r = await executeShamirReconstruction([shares[0], shares[0], shares[1]], '');
        expect(r.success).toBe(false);
    });

    it('Mismatched family IDs are rejected', async () => {
        const sharesA = await createCryptographicShares('SecretA', 3, 2, '', 'Set A');
        const sharesB = await createCryptographicShares('SecretB', 3, 2, '', 'Set B');
        const r = await executeShamirReconstruction([sharesA[0], sharesB[1]], '');
        expect(r.success).toBe(false);
    });

    it('Corrupted share data is detected', async () => {
        const shares = await createCryptographicShares('CorruptTest', 3, 2, '', 'Corrupt');
        const corruptedStr = shares[0].Share.substring(0, shares[0].Share.length - 10) + '!!!!!!!!';
        const r = await executeShamirReconstruction([{ ShareIndex: 1, Share: corruptedStr }, shares[1]], '');
        expect(r.success).toBe(false);
    });
});

// ── Encrypted Shares ────────────────────────────────────────────────────

describe('Shamir Secret Sharing — Encrypted (PBKDF2)', () => {
    it('Encrypted 2-of-3: fails without password, succeeds with correct password', async () => {
        // Use schema '2' (fast PBKDF2) to keep tests quick
        const shares = await createCryptographicShares('Another!@#Secret', 3, 2, 'myEncKey123', 'Encrypted Test', false, '2');

        // Fails without password
        const r1 = await executeShamirReconstruction(shares.slice(0, 2), '');
        expect(r1.success).toBe(false);

        // Fails with wrong password
        const r2 = await executeShamirReconstruction(shares.slice(0, 2), 'wrongKey');
        expect(r2.success).toBe(false);

        // Succeeds with correct password
        const r3 = await executeShamirReconstruction(shares.slice(0, 2), 'myEncKey123');
        expect(r3.success).toBe(true);
        expect(r3.secret).toBe('Another!@#Secret');
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
