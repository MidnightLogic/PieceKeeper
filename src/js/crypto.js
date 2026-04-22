import {scannedRawSharesSet, requiredK, sharePendingKDetermination, sharePendingKDeterminationNfc, reconstructedSecretData, currentGeneratedShares, lastGeneratedN, lastGeneratedK} from './store.js';
import { safeTranslate } from './utils.js';
import { logger } from './logger.js';
import { getCryptoRandomBigInt, modularInverse, bigIntToBytes, bytesToBigInt } from './utils.js';
import { APP_CONFIG } from './config.js';
import CryptoWorker from './cryptoWorker.js?worker&inline';

const PRIME_TABLE = APP_CONFIG.PRIME_TABLE;

// Binary Schema v2 Constants
const SCHEMA_MAJOR = 2;
const SCHEMA_MINOR = 0;

/**
 * Resolves the optimal prime from the 5-tier table based on payload byte length.
 * Stealth mode forces the largest prime (index 4) and 256-byte boundary.
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

/**
 * Returns the user-selected KDF schema version from localStorage,
 * falling back to APP_CONFIG.APP_VERSION if none is set.
 */
const getActiveSchemaVersion = () => {
    if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(APP_CONFIG.SCHEMA_STORAGE_KEY) || APP_CONFIG.APP_VERSION;
    }
    return APP_CONFIG.APP_VERSION;
};

// --- Binary Helpers ---

export const bytesToBase64 = (bytes) => {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const base64ToBytes = (base64) => {
    // Revert Base64URL to standard Base64 for atob()
    let std = base64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = std.length % 4;
    if (pad) std += '='.repeat(4 - pad);
    const binaryString = atob(std);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
};

export const deriveKeyViaWorker = (passwordStr, salt, schema) => {
    return new Promise((resolve, reject) => {
        const worker = new CryptoWorker();
        const id = crypto.randomUUID();

        worker.onmessage = (e) => {
            if (e.data.id === id) {
                if (e.data.success) resolve(e.data.key);
                else reject(new Error(e.data.error));
                worker.terminate();
            }
        };

        worker.onerror = (err) => {
            reject(new Error("Worker thread crashed: " + err.message));
            worker.terminate();
        };

        worker.postMessage({ id, type: 'DERIVE_KEY', payload: { passwordStr, salt, schema } });
    });
};

/**
 * Encrypts a raw Uint8Array returning (salt + iv + ciphertext).
 */
export const encryptBytes = async (dataBytes, key, aadBytes = new Uint8Array(0)) => {
    if (!key) return dataBytes; // No encryption, return raw bytes

    try {
        const activeSchemaVersion = getActiveSchemaVersion();
        const expectedSchema = APP_CONFIG.CRYPTO_SCHEMAS[activeSchemaVersion];
        const saltBytes = expectedSchema.salt_bytes;
        const salt = crypto.getRandomValues(new Uint8Array(saltBytes));

        const derivedKeyBytes = await deriveKeyViaWorker(key, salt, expectedSchema);
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
        logger.info(`Encryption error: ${e.message}`, 'error');
        throw new Error(`Encryption failed: ${e.message}`);
    }
};

/**
 * Decrypts a raw Uint8Array (salt + iv + ciphertext).
 */
export const decryptBytes = async (encryptedBytes, key, isEncryptedFlag, schemaVersion, aadBytes = new Uint8Array(0)) => {
    if (!isEncryptedFlag) return encryptedBytes;

    if (!key) throw new Error("Encryption password is required to decrypt these shares.");

    try {
        const resolvedVersion = schemaVersion || APP_CONFIG.APP_VERSION;
        const expectedSchema = APP_CONFIG.CRYPTO_SCHEMAS[resolvedVersion];
        if (!expectedSchema) throw new Error(`Unknown crypto schema version: ${resolvedVersion}`);
        const saltBytes = expectedSchema.salt_bytes;
        const ivBytes = expectedSchema.iv_bytes;

        if (encryptedBytes.length < (saltBytes + ivBytes)) {
            throw new Error("Encrypted data is too short to contain salt and IV.");
        }

        const salt = encryptedBytes.slice(0, saltBytes);
        const iv = encryptedBytes.slice(saltBytes, saltBytes + ivBytes);
        const encrypted = encryptedBytes.slice(saltBytes + ivBytes);

        const derivedKeyBytes = await deriveKeyViaWorker(key, salt, expectedSchema);
        const derivedKey = await crypto.subtle.importKey(
            'raw', derivedKeyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData: aadBytes }, derivedKey, encrypted
        );

        return new Uint8Array(decrypted);
    } catch (e) {
        if (e.name === 'OperationError' || e.message.includes('decrypt')) {
            throw new Error("Decryption failed. Please double-check the encryption password.");
        }
        throw new Error(`Decryption failed: ${e.message}`);
    }
};

// --- Core Shamir Logic ---
const newRandomPolynomial = (secret, degree, prime) => {
    const coefficients = [secret];
    for (let i = 1; i <= degree; i++) {
        let coeff = 0n;
        if (prime > 1n) {
            while (coeff === 0n) coeff = getCryptoRandomBigInt(prime);
        }
        coefficients.push(coeff);
    }
    return coefficients;
};

const invokePolynomial = (coefficients, x, prime) => {
    let result = 0n;
    for (let i = coefficients.length - 1; i >= 0; i--) {
        result = (result * x + coefficients[i]) % prime;
    }
    result = (result + prime) % prime;
    return result;
};

export async function createCryptographicShares(password, n, k, encryptionKey, comment, isStealth = false) {
    if (k > n) throw new Error("Threshold (k) cannot be greater than total shares (n).");
    if (k < 1 || n < 1) throw new Error("k and n must be at least 1.");
    if (!password) throw new Error("Password cannot be empty.");
    if (encryptionKey && encryptionKey.length > APP_CONFIG.MAX_ENCRYPTION_PASSWORD_LENGTH) {
        throw new Error(`Encryption password exceeds max length (${APP_CONFIG.MAX_ENCRYPTION_PASSWORD_LENGTH} chars).`);
    }

    const encoder_pw = new TextEncoder();
    const passwordBytes = encoder_pw.encode(password);
    const secretLen = passwordBytes.length;

    // Enforce byte-level bound: marker(1) + secretLen(1) + password + checksum(4) <= 256
    if (secretLen > APP_CONFIG.MAX_PASSWORD_LENGTH) {
        throw new Error(`Secret exceeds maximum byte limit (${APP_CONFIG.MAX_PASSWORD_LENGTH} bytes). Use fewer multi-byte characters.`);
    }

    // --- Integrity Checksum: [0x01 marker][1-byte secretLen][passwordBytes][4-byte SHA-256 truncated] ---
    const pwDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', passwordBytes));
    const checksumBytes = pwDigest.slice(0, 4);

    // Resolve dynamic prime based on actual payload size
    const rawPayloadLen = 1 + 1 + secretLen + 4; // marker + len + password + checksum
    const { index: primeIndex, prime, boundary } = resolvePrime(rawPayloadLen, isStealth);

    // Build combined payload — padded to boundary in stealth mode
    const totalPayloadLen = isStealth ? boundary : rawPayloadLen;
    const combinedBytes = new Uint8Array(totalPayloadLen);
    combinedBytes[0] = 0x01;          // Integrity marker
    combinedBytes[1] = secretLen;     // Length prefix
    combinedBytes.set(passwordBytes, 2);
    combinedBytes.set(checksumBytes, 2 + secretLen);
    // Remaining bytes stay 0x00 (stealth zero-padding)

    const secret = bytesToBigInt(combinedBytes);

    // RAM sweep: zero out intermediate buffers
    passwordBytes.fill(0);
    pwDigest.fill(0);
    checksumBytes.fill(0);
    combinedBytes.fill(0);

    const unixTimestamp = Math.floor(Date.now() / 1000);
    const isEncrypted = !!encryptionKey;
    const familyId = crypto.getRandomValues(new Uint8Array(4)); // 32-bit random Set ID

    const poly = newRandomPolynomial(secret, k - 1, prime);
    const shares = [];
    const encoder = new TextEncoder();
    const commentBytes = encoder.encode(comment || '');

    // --- Flags Byte Bitmask ---
    // Bit 0: isEncrypted | Bit 1: isStealth | Bits 2-4: primeIndex
    const flags = (isEncrypted ? 1 : 0) | (isStealth ? 2 : 0) | (primeIndex << 2);

    for (let i = 1; i <= n; i++) {
        logger.info(`[Engine] Forging polynomial share ${i}/${n} (x-intercept: ${i})`);
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
        const kdfSchema = parseInt(getActiveSchemaVersion(), 10) || 1;
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

        const payloadBytes = await encryptBytes(innerPayload, encryptionKey, aadBytes);

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
};

export const parseShareMetadata = (shareBase64) => {
    let bytes;
    try {
        bytes = base64ToBytes(shareBase64);
    } catch (e) {
        throw new Error(safeTranslate('error.invalid_base64', 'Invalid Base64 encoding in share.'));
    }

    try {
        const view = new DataView(bytes.buffer);
        let offset = 0;

        // --- Minimum Length Guard ---
        // Header: [2 version][1 flags][1 kdfSchema][4 timestamp][4 familyId][2 commentLen] = 14 bytes minimum
        if (bytes.length < 14) {
            return { isValid: false, error: "Data too short to be a PieceKeeper share." };
        }

        // --- Binary Schema v2 Header ---
        const major = bytes[offset++];
        const minor = bytes[offset++];
        const version = `${major}.${minor}`;

        // --- Magic Byte Validation ---
        if (major !== SCHEMA_MAJOR) {
            return { isValid: false, error: `Unsupported share format (version ${version}). Expected v${SCHEMA_MAJOR}.x.` };
        }

        const flags = bytes[offset++];
        const isEncrypted = !!(flags & 1);
        const isStealth = !!((flags >> 1) & 1);
        const primeIndex = (flags >> 2) & 0x07;

        // --- Prime Index Validation ---
        if (primeIndex >= PRIME_TABLE.length) {
            return { isValid: false, error: `Invalid prime index (${primeIndex}). Share may be corrupted.` };
        }

        const kdfSchema = String(bytes[offset++]); // KDF schema version (maps to CRYPTO_SCHEMAS)

        // --- KDF Schema Validation ---
        if (isEncrypted && !APP_CONFIG.CRYPTO_SCHEMAS[kdfSchema]) {
            return { isValid: false, error: `Unknown KDF schema (${kdfSchema}). Share may be from an incompatible version.` };
        }

        const unixTimestamp = view.getUint32(offset, false);
        offset += 4;
        const timestamp = new Date(unixTimestamp * 1000).toISOString();

        // 4-byte familyId → 8-char hex string
        const familyIdBytes = bytes.slice(offset, offset + 4);
        const familyId = Array.from(familyIdBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        offset += 4;

        const commentLen = view.getUint16(offset, false);
        offset += 2;

        // --- Comment Length Sanity Check ---
        if (commentLen > (bytes.length - offset)) {
            return { isValid: false, error: "Comment length exceeds available data. Share may be corrupted." };
        }

        const comment = new TextDecoder().decode(bytes.slice(offset, offset + commentLen));
        offset += commentLen;

        const payload = bytes.slice(offset);

        // --- Payload Presence Check ---
        if (payload.length === 0) {
            return { isValid: false, error: "Share has no cryptographic payload. Data may be corrupted." };
        }

        return {
            version, familyId, comment, timestamp, isEncrypted, isStealth, primeIndex, kdfSchema,
            payload, isValid: true, aadBytes: bytes.slice(0, offset)
        };
    } catch (e) {
        return { isValid: false, error: "Failed to parse binary share structure." };
    }
};

export const executeShamirReconstruction = async (sharesInput, encryptionKey = null) => {
    try {
        if (!sharesInput || sharesInput.length === 0) return { success: false, error: "No shares provided." };

        let n_expected = null, k_expected = null, referenceFamilyId = null;
        let referenceIsEncrypted = null, referenceComment = null, referenceTimestamp = null, referenceVersion = null;
        let referencePrimeIndex = null, referenceKdfSchema = null;

        const processedShares = [];
        const xValues = new Set();

        for (const inputShare of sharesInput) {
            try {
                const metadata = parseShareMetadata(inputShare.Share);
                if (!metadata.isValid) throw new Error(metadata.error);
                if (!metadata.familyId) throw new Error("Missing Family ID.");

                // Resolve prime from header flags
                const primeEntry = PRIME_TABLE[metadata.primeIndex];
                if (!primeEntry) throw new Error(`Unknown prime index: ${metadata.primeIndex}`);
                const prime = primeEntry.prime;

                const decryptedBytes = await decryptBytes(metadata.payload, encryptionKey, metadata.isEncrypted, metadata.kdfSchema, metadata.aadBytes);

                if (decryptedBytes.length < 4) throw new Error("Decrypted payload too short to contain coordinates.");

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

                    if (referenceIsEncrypted && !encryptionKey) throw new Error("password_required");
                } else {
                    if (shareN !== n_expected || shareK !== k_expected) throw new Error("Inconsistent n/k values.");
                    if (metadata.familyId !== referenceFamilyId) throw new Error("Set ID mismatch.");
                    if (metadata.isEncrypted !== referenceIsEncrypted) throw new Error("Encryption status mismatch.");
                    if (metadata.primeIndex !== referencePrimeIndex) throw new Error("Prime index mismatch.");
                }

                if (xValues.has(shareX)) continue;
                xValues.add(shareX);
                processedShares.push({ X: shareX, Y: shareY });

            } catch (e) {
                if (e.message === "password_required") return { success: false, error: "Encryption password required." };
                throw new Error(`Failed to process share ${inputShare.ShareIndex || ''}: ${e.message}`);
            }
        }

        if (k_expected === null) return { success: false, error: "Could not determine threshold (k)." };
        if (processedShares.length < k_expected) throw new Error("Insufficient shares for reconstruction.");

        // Look up the prime for Lagrange interpolation
        const prime = PRIME_TABLE[referencePrimeIndex].prime;

        const sharesForReconstruction = processedShares.slice(0, k_expected);
        logger.info(`[Engine] Executing Lagrange interpolation across ${sharesForReconstruction.length} shares (primeIndex=${referencePrimeIndex})...`);
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

            if (lagrangeDenominator === 0n) return { success: false, error: "Lagrange denominator is zero." };
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