/**
 * PieceKeeper Core — Cryptographic Engine
 *
 * AES-256-GCM encryption/decryption, KDF orchestration (PBKDF2 / Argon2id / scrypt),
 * and the complete Shamir's Secret Sharing create/reconstruct pipeline.
 *
 * This module calls hash-wasm directly (no Web Worker indirection).
 * For browser contexts, callers should offload heavy operations to a Worker.
 *
 * @module @midnightlogic/piecekeeper-crypto/crypto
 */

import { argon2id, scrypt } from 'hash-wasm';
import { getCryptoRandomBigInt, modularInverse, bigIntToBytes, bytesToBigInt } from './math.js';
import { bytesToBase64, inspectShare } from './binary.js';
import { newRandomPolynomial, invokePolynomial } from './shamir.js';
import { APP_CONFIG } from './config.js';

const PRIME_TABLE = APP_CONFIG.PRIME_TABLE;

// Binary Schema v2 Constants
const SCHEMA_MAJOR = 2;
const SCHEMA_MINOR = 0;

// --- Pluggable Logger (no-op default) ---

/** @type {{ info: Function, warn: Function, error: Function }} */
let _log = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Injects a custom logger implementation.
 * The logger object must have `info`, `warn`, and `error` methods.
 *
 * @param {{ info: Function, warn: Function, error: Function }} logger - Logger implementation.
 */
export const setLogger = (logger) => {
    _log = logger;
};

// --- Prime Resolution ---

/**
 * Resolves the optimal prime from the 5-tier table based on payload byte length.
 * Stealth mode forces the largest prime (index 4) and 256-byte boundary.
 *
 * @param {number} payloadByteLength - The raw payload size in bytes.
 * @param {boolean} isStealth - Whether stealth mode is active.
 * @returns {{ index: number, prime: bigint, boundary: number }}
 */
const resolvePrime = (payloadByteLength, isStealth) => {
    if (isStealth) return { index: 4, prime: PRIME_TABLE[4].prime, boundary: PRIME_TABLE[4].boundary };
    for (let i = 0; i < PRIME_TABLE.length; i++) {
        if (payloadByteLength <= PRIME_TABLE[i].boundary) {
            return { index: i, prime: PRIME_TABLE[i].prime, boundary: PRIME_TABLE[i].boundary };
        }
    }
    return { index: 4, prime: PRIME_TABLE[4].prime, boundary: PRIME_TABLE[4].boundary };
};

// --- Key Derivation ---

/**
 * Derives an AES-256 encryption key from a password and salt using the specified KDF schema.
 * Supports PBKDF2 (schemas 1-3), Argon2id (schemas 4-5), and scrypt (schema 6).
 *
 * @param {string} passwordStr - The plaintext password.
 * @param {Uint8Array} salt - The cryptographic salt.
 * @param {import('./config.js').CryptoSchema} schema - The KDF schema configuration.
 * @returns {Promise<Uint8Array>} The derived key bytes (32 bytes for AES-256).
 * @throws {Error} If the schema structure is unrecognized.
 */
export const deriveKey = async (passwordStr, salt, schema) => {
    const passwordBytes = new TextEncoder().encode(passwordStr);

    if (schema.pbkdf2_iterations) {
        // Schemas 1, 2, 3: Standard PBKDF2 using Native Web Crypto API
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBytes,
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        );

        const buffer = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: schema.pbkdf2_iterations,
                hash: schema.pbkdf2_hash
            },
            keyMaterial,
            schema.aes_key_length
        );
        return new Uint8Array(buffer);

    } else if (schema.kdf_algorithm === 'Argon2id') {
        // Schemas 4, 5: Next-Gen memory hard WASM derivations
        return await argon2id({
            password: passwordBytes,
            salt: salt,
            parallelism: schema.parallelism,
            iterations: schema.time_cost,
            memorySize: schema.memory_cost,
            hashLength: schema.aes_key_length / 8, // 32 bytes
            outputType: 'binary'
        });

    } else if (schema.kdf_algorithm === 'scrypt') {
        // Schema 6: Robust legacy memory hard WASM derivation
        return await scrypt({
            password: passwordBytes,
            salt: salt,
            costFactor: schema.cpu_memory_cost,
            blockSize: schema.block_size,
            parallelism: schema.parallelization,
            hashLength: schema.aes_key_length / 8, // 32 bytes
            outputType: 'binary'
        });
    }

    throw new Error('Unknown cryptographic schema structure');
};

// --- Encryption / Decryption ---

/**
 * Encrypts a raw Uint8Array returning (salt + iv + ciphertext).
 *
 * @param {Uint8Array} dataBytes - The plaintext data to encrypt.
 * @param {string|null} key - The encryption password (null = no encryption).
 * @param {Uint8Array} [aadBytes] - Additional Authenticated Data for AEAD.
 * @param {string} [schemaVersion] - KDF schema version key (defaults to APP_CONFIG.DEFAULT_SCHEMA).
 * @returns {Promise<Uint8Array>} The encrypted output: salt || iv || ciphertext.
 */
export const encryptBytes = async (dataBytes, key, aadBytes = new Uint8Array(0), schemaVersion = null) => {
    if (!key) return dataBytes; // No encryption, return raw bytes

    try {
        const activeVersion = schemaVersion || APP_CONFIG.DEFAULT_SCHEMA;
        const expectedSchema = APP_CONFIG.CRYPTO_SCHEMAS[activeVersion];
        if (!expectedSchema) throw new Error(`Unknown crypto schema version: ${activeVersion}`);
        const saltBytes = expectedSchema.salt_bytes;
        const salt = crypto.getRandomValues(new Uint8Array(saltBytes));

        const derivedKeyBytes = await deriveKey(key, salt, expectedSchema);
        const derivedKey = await crypto.subtle.importKey(
            'raw', derivedKeyBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
        );

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: aadBytes }, derivedKey, dataBytes
        );

        const resultBytes = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
        resultBytes.set(salt, 0);
        resultBytes.set(iv, salt.length);
        resultBytes.set(new Uint8Array(encrypted), salt.length + iv.length);

        return resultBytes;
    } catch (e) {
        _log.error(`Encryption error: ${e.message}`);
        throw new Error(`Encryption failed: ${e.message}`);
    }
};

/**
 * Decrypts a raw Uint8Array (salt + iv + ciphertext).
 *
 * @param {Uint8Array} encryptedBytes - The encrypted data (salt || iv || ciphertext).
 * @param {string|null} key - The decryption password.
 * @param {boolean} isEncryptedFlag - Whether the data is actually encrypted.
 * @param {string} schemaVersion - The KDF schema version used during encryption.
 * @param {Uint8Array} [aadBytes] - Additional Authenticated Data for AEAD verification.
 * @returns {Promise<Uint8Array>} The decrypted plaintext bytes.
 * @throws {Error} If the password is wrong or the data is corrupted.
 */
export const decryptBytes = async (encryptedBytes, key, isEncryptedFlag, schemaVersion, aadBytes = new Uint8Array(0)) => {
    if (!isEncryptedFlag) return encryptedBytes;

    if (!key) throw new Error('Encryption password is required to decrypt these shares.');

    try {
        const resolvedVersion = schemaVersion || APP_CONFIG.DEFAULT_SCHEMA;
        const expectedSchema = APP_CONFIG.CRYPTO_SCHEMAS[resolvedVersion];
        if (!expectedSchema) throw new Error(`Unknown crypto schema version: ${resolvedVersion}`);
        const saltLen = expectedSchema.salt_bytes;
        const ivLen = expectedSchema.iv_bytes;

        if (encryptedBytes.length < (saltLen + ivLen)) {
            throw new Error('Encrypted data is too short to contain salt and IV.');
        }

        const salt = encryptedBytes.slice(0, saltLen);
        const iv = encryptedBytes.slice(saltLen, saltLen + ivLen);
        const encrypted = encryptedBytes.slice(saltLen + ivLen);

        const derivedKeyBytes = await deriveKey(key, salt, expectedSchema);
        const derivedKey = await crypto.subtle.importKey(
            'raw', derivedKeyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData: aadBytes }, derivedKey, encrypted
        );

        return new Uint8Array(decrypted);
    } catch (e) {
        if (e.name === 'OperationError' || e.message.includes('decrypt')) {
            throw new Error('Decryption failed. Please double-check the encryption password.');
        }
        throw new Error(`Decryption failed: ${e.message}`);
    }
};

// --- Share Generation ---

/**
 * Splits a secret into N cryptographic shares using Shamir's Secret Sharing.
 *
 * Each share is a self-describing Base64URL envelope containing schema version,
 * set identifier, timestamp, encryption flags, and threshold parameters.
 * The secret can only be reconstructed when `k` or more shares are combined.
 *
 * @param {string} secret - The secret text to split (max 250 UTF-8 bytes).
 * @param {number} n - Total number of shares to generate (1–64).
 * @param {number} k - Minimum threshold of shares required for reconstruction.
 * @param {string} [encryptionKey=''] - Optional AES-256-GCM encryption password. Pass empty string for none.
 * @param {string} [comment=''] - Optional metadata comment embedded in each share (max 32 chars).
 * @param {boolean} [isStealth=false] - When true, forces 2048-bit prime and uniform-length shares.
 * @param {string|null} [schemaVersion=null] - KDF schema version key (defaults to APP_CONFIG.DEFAULT_SCHEMA).
 * @returns {Promise<Array<{ShareIndex: number, Share: string, Comment: string, Timestamp: string, Version: string, IsEncrypted: boolean}>>} Array of generated share objects.
 * @throws {Error} If k > n, k < 1, secret is empty, or secret exceeds byte limit.
 */
export async function splitSecret(secret, n, k, encryptionKey, comment, isStealth = false, schemaVersion = null) {
    if (k > n) throw new Error('Threshold (k) cannot be greater than total shares (n).');
    if (k < 1 || n < 1) throw new Error('k and n must be at least 1.');
    if (!secret) throw new Error('Secret cannot be empty.');
    if (encryptionKey && encryptionKey.length > APP_CONFIG.MAX_ENCRYPTION_KEY_LENGTH) {
        throw new Error(`Encryption password exceeds max length (${APP_CONFIG.MAX_ENCRYPTION_KEY_LENGTH} chars).`);
    }

    const activeSchemaVersion = schemaVersion || APP_CONFIG.DEFAULT_SCHEMA;

    const encoder_pw = new TextEncoder();
    const secretBytes = encoder_pw.encode(secret);
    const secretLen = secretBytes.length;

    // Enforce byte-level bound: marker(1) + secretLen(1) + secret + checksum(4) <= 256
    if (secretLen > APP_CONFIG.MAX_SECRET_LENGTH) {
        throw new Error(`Secret exceeds maximum byte limit (${APP_CONFIG.MAX_SECRET_LENGTH} bytes). Use fewer multi-byte characters.`);
    }

    // --- Integrity Checksum: [0x01 marker][1-byte secretLen][passwordBytes][4-byte SHA-256 truncated] ---
    const pwDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', secretBytes));
    const checksumBytes = pwDigest.slice(0, 4);

    // Resolve dynamic prime based on actual payload size
    const rawPayloadLen = 1 + 1 + secretLen + 4; // marker + len + secret + checksum
    const { index: primeIndex, prime, boundary } = resolvePrime(rawPayloadLen, isStealth);

    // Build combined payload — padded to boundary in stealth mode
    const totalPayloadLen = isStealth ? boundary : rawPayloadLen;
    const combinedBytes = new Uint8Array(totalPayloadLen);
    combinedBytes[0] = 0x01;          // Integrity marker
    combinedBytes[1] = secretLen;     // Length prefix
    combinedBytes.set(secretBytes, 2);
    combinedBytes.set(checksumBytes, 2 + secretLen);
    // Remaining bytes stay 0x00 (stealth zero-padding)

    const secretBigInt = bytesToBigInt(combinedBytes);

    // RAM sweep: zero out intermediate buffers
    secretBytes.fill(0);
    pwDigest.fill(0);
    checksumBytes.fill(0);
    combinedBytes.fill(0);

    const unixTimestamp = Math.floor(Date.now() / 1000);
    const isEncrypted = !!encryptionKey;
    const familyId = crypto.getRandomValues(new Uint8Array(4)); // 32-bit random Set ID

    const poly = newRandomPolynomial(secretBigInt, k - 1, prime);
    const shares = [];
    const encoder = new TextEncoder();
    const commentBytes = encoder.encode(comment || '');

    // --- Flags Byte Bitmask ---
    // Bit 0: isEncrypted | Bit 1: isStealth | Bits 2-4: primeIndex
    const flags = (isEncrypted ? 1 : 0) | (isStealth ? 2 : 0) | (primeIndex << 2);

    for (let i = 1; i <= n; i++) {
        _log.info(`[Engine] Forging polynomial share ${i}/${n} (x-intercept: ${i})`);
        const x = BigInt(i);
        const y = invokePolynomial(poly, x, prime);

        // --- INNER BINARY PACKING ---
        const yBytes = bigIntToBytes(y);
        const innerPayload = new Uint8Array(3 + yBytes.length);
        innerPayload[0] = n;
        innerPayload[1] = k;
        innerPayload[2] = Number(x);
        innerPayload.set(yBytes, 3);

        // --- AAD METADATA (Binary Schema v2) ---
        // [2 version][1 flags][1 kdfSchema][4 timestamp][4 familyId][2 commentLen][commentBytes...]
        const kdfSchema = parseInt(activeSchemaVersion, 10) || 1;
        const aadLength = 2 + 1 + 1 + 4 + 4 + 2 + commentBytes.length;
        const aadBytes = new Uint8Array(aadLength);
        const aadView = new DataView(aadBytes.buffer);
        let aadOffset = 0;

        aadBytes[aadOffset++] = SCHEMA_MAJOR;
        aadBytes[aadOffset++] = SCHEMA_MINOR;
        aadBytes[aadOffset++] = flags;
        aadBytes[aadOffset++] = kdfSchema;
        aadView.setUint32(aadOffset, unixTimestamp, false); aadOffset += 4;
        aadBytes.set(familyId, aadOffset); aadOffset += 4;
        aadView.setUint16(aadOffset, commentBytes.length, false); aadOffset += 2;
        aadBytes.set(commentBytes, aadOffset); aadOffset += commentBytes.length;

        const payloadBytes = await encryptBytes(innerPayload, encryptionKey, aadBytes, activeSchemaVersion);

        // --- OUTER BINARY PACKING ---
        const totalLength = aadBytes.length + payloadBytes.length;
        const buffer = new Uint8Array(totalLength);
        buffer.set(aadBytes, 0);
        buffer.set(payloadBytes, aadBytes.length);

        const finalShare = bytesToBase64(buffer);

        // RAM sweeps
        buffer.fill(0);
        innerPayload.fill(0);
        aadBytes.fill(0);
        if (isEncrypted) payloadBytes.fill(0);

        const versionStr = `${SCHEMA_MAJOR}.${SCHEMA_MINOR}`;
        shares.push({
            ShareIndex: i,
            Share: finalShare,
            Comment: comment || '',
            Timestamp: new Date(unixTimestamp * 1000).toISOString(),
            Version: versionStr,
            IsEncrypted: isEncrypted
        });
    }
    poly.length = 0;
    return shares;
}

// --- Secret Reconstruction ---

/**
 * Reconstructs a secret from k or more Shamir shares using Lagrange interpolation.
 *
 * Validates share integrity (family ID consistency, duplicate detection, checksum verification)
 * and decrypts payloads if shares are encrypted with AES-256-GCM.
 *
 * @param {Array<{ShareIndex?: number, Share: string}>} sharesInput - Array of share objects containing Base64URL-encoded share strings.
 * @param {string|null} [encryptionKey=null] - Decryption password for encrypted shares. Pass empty string or null for unencrypted.
 * @returns {Promise<{success: boolean, secret?: string, error?: string, metadata?: {note: string, date: string, version: string, kdfSchema: string, familyId: string, n: number, k: number}}>} Reconstruction result with secret text and metadata on success.
 */
export const reconstructSecret = async (sharesInput, encryptionKey = null) => {
    try {
        if (!sharesInput || sharesInput.length === 0) return { success: false, error: 'No shares provided.' };

        let n_expected = null, k_expected = null, referenceFamilyId = null;
        let referenceIsEncrypted = null, referenceComment = null, referenceTimestamp = null, referenceVersion = null;
        let referencePrimeIndex = null, referenceKdfSchema = null;

        const processedShares = [];
        const xValues = new Set();

        for (const inputShare of sharesInput) {
            try {
                const metadata = inspectShare(inputShare.Share);
                if (!metadata.isValid) throw new Error(metadata.error);
                if (!metadata.familyId) throw new Error('Missing Family ID.');

                // Resolve prime from header flags
                const primeEntry = PRIME_TABLE[metadata.primeIndex];
                if (!primeEntry) throw new Error(`Unknown prime index: ${metadata.primeIndex}`);
                const prime = primeEntry.prime;

                const decryptedBytes = await decryptBytes(metadata.payload, encryptionKey, metadata.isEncrypted, metadata.kdfSchema, metadata.aadBytes);

                if (decryptedBytes.length < 4) throw new Error('Decrypted payload too short to contain coordinates.');

                const shareN = decryptedBytes[0];
                const shareK = decryptedBytes[1];
                const shareX = BigInt(decryptedBytes[2]);
                const shareYBytes = decryptedBytes.slice(3);

                let shareY = bytesToBigInt(shareYBytes);
                shareYBytes.fill(0); // RAM sweep
                shareY = (shareY % prime + prime) % prime;

                if (n_expected === null) {
                    n_expected = shareN; k_expected = shareK;
                    referenceFamilyId = metadata.familyId; referenceIsEncrypted = metadata.isEncrypted;
                    referenceComment = metadata.comment; referenceTimestamp = metadata.timestamp;
                    referenceVersion = metadata.version; referencePrimeIndex = metadata.primeIndex;
                    referenceKdfSchema = metadata.kdfSchema;

                    if (referenceIsEncrypted && !encryptionKey) throw new Error('password_required');
                } else {
                    if (shareN !== n_expected || shareK !== k_expected) throw new Error('Inconsistent n/k values.');
                    if (metadata.familyId !== referenceFamilyId) throw new Error('Set ID mismatch.');
                    if (metadata.isEncrypted !== referenceIsEncrypted) throw new Error('Encryption status mismatch.');
                    if (metadata.primeIndex !== referencePrimeIndex) throw new Error('Prime index mismatch.');
                }

                if (xValues.has(shareX)) continue;
                xValues.add(shareX);
                processedShares.push({ X: shareX, Y: shareY });

            } catch (e) {
                if (e.message === 'password_required') return { success: false, error: 'Encryption password required.' };
                throw new Error(`Failed to process share ${inputShare.ShareIndex || ''}: ${e.message}`);
            }
        }

        if (k_expected === null) return { success: false, error: 'Could not determine threshold (k).' };
        if (processedShares.length < k_expected) throw new Error('Insufficient shares for reconstruction.');

        // Look up the prime for Lagrange interpolation
        const prime = PRIME_TABLE[referencePrimeIndex].prime;

        const sharesForReconstruction = processedShares.slice(0, k_expected);
        _log.info(`[Engine] Executing Lagrange interpolation across ${sharesForReconstruction.length} shares (primeIndex=${referencePrimeIndex})...`);
        let reconstructedSecretBigInt = 0n;

        for (let i = 0; i < k_expected; i++) {
            const xi = sharesForReconstruction[i].X;
            const yi = sharesForReconstruction[i].Y;
            let lagrangeNumerator = 1n;
            let lagrangeDenominator = 1n;

            for (let j = 0; j < k_expected; j++) {
                if (i !== j) {
                    const xj = sharesForReconstruction[j].X;
                    lagrangeNumerator = (lagrangeNumerator * (0n - xj)) % prime;
                    lagrangeDenominator = (lagrangeDenominator * (xi - xj)) % prime;
                }
            }

            if (lagrangeDenominator === 0n) return { success: false, error: 'Lagrange denominator is zero.' };
            const lagrangeBasisPolynomial = (lagrangeNumerator * modularInverse(lagrangeDenominator, prime)) % prime;
            reconstructedSecretBigInt = (reconstructedSecretBigInt + yi * lagrangeBasisPolynomial) % prime;
        }

        reconstructedSecretBigInt = (reconstructedSecretBigInt + prime) % prime;

        // --- Integrity Verification (Binary Schema v2: length-prefixed) ---
        let secretString = '';
        try {
            const secretBytes = bigIntToBytes(reconstructedSecretBigInt);

            // Verify marker byte
            if (secretBytes.length < 7 || secretBytes[0] !== 0x01) {
                throw new Error('Integrity check failed. Shares are corrupted or tampered with.');
            }

            // Extract length-prefixed components: [0x01][secretLen][passwordBytes...][4-byte checksum][padding...]
            const secretLen = secretBytes[1];
            if (secretLen === 0 || (2 + secretLen + 4) > secretBytes.length) {
                throw new Error('Integrity check failed. Invalid secret length prefix.');
            }

            const extractedPasswordBytes = secretBytes.slice(2, 2 + secretLen);
            const extractedChecksum = secretBytes.slice(2 + secretLen, 2 + secretLen + 4);

            // Recompute SHA-256 and compare first 4 bytes
            const recomputedDigest = new Uint8Array(
                await crypto.subtle.digest('SHA-256', extractedPasswordBytes)
            );
            const recomputedChecksum = recomputedDigest.slice(0, 4);

            const checksumValid = extractedChecksum.every((b, idx) => b === recomputedChecksum[idx]);
            if (!checksumValid) {
                secretBytes.fill(0);
                extractedPasswordBytes.fill(0);
                recomputedDigest.fill(0);
                throw new Error('Integrity check failed. Shares are corrupted or tampered with.');
            }

            secretString = new TextDecoder().decode(extractedPasswordBytes);

            // RAM sweep
            secretBytes.fill(0);
            extractedPasswordBytes.fill(0);
            extractedChecksum.fill(0);
            recomputedDigest.fill(0);
            recomputedChecksum.fill(0);
        } catch (e) {
            return { success: false, error: e.message || `Math succeeded, decoding failed: ${e.message}.` };
        }

        return {
            success: true,
            secret: secretString,
            metadata: {
                note: referenceComment || 'None', date: referenceTimestamp || 'Unknown',
                version: referenceVersion, kdfSchema: referenceKdfSchema, familyId: referenceFamilyId,
                n: n_expected, k: k_expected
            }
        };

    } catch (e) {
        return { success: false, error: e.message };
    }
};
