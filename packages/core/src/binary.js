/**
 * PieceKeeper Core — Binary Utilities
 *
 * Base64URL encoding/decoding and binary share metadata parsing.
 * Zero DOM dependencies. Requires globalThis btoa/atob (Node 18+ / all browsers).
 *
 * @module @midnightlogic/piecekeeper-crypto/binary
 */

import { APP_CONFIG } from './config.js';
import { InvalidBase64Error } from './errors.js';

const PRIME_TABLE = APP_CONFIG.PRIME_TABLE;

// Binary Schema v2 Constants
const SCHEMA_MAJOR = 2;

/**
 * Converts a Uint8Array to a Base64URL-encoded string (no padding).
 *
 * @param {Uint8Array} bytes - The byte array to encode.
 * @returns {string} Base64URL-encoded string.
 */
export const bytesToBase64 = (bytes) => {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * Decodes a Base64URL-encoded string to a Uint8Array.
 *
 * @param {string} base64 - Base64URL-encoded string.
 * @returns {Uint8Array} Decoded byte array.
 * @throws {Error} If the input is not valid Base64.
 */
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

/**
 * @typedef {Object} ShareMetadata
 * @property {boolean} isValid - Whether the share parsed successfully.
 * @property {string} [version] - Schema version string (e.g. "2.0").
 * @property {string} [familyId] - 8-char hex Set ID.
 * @property {string} [comment] - Embedded comment string.
 * @property {string} [timestamp] - ISO 8601 timestamp.
 * @property {boolean} [isEncrypted] - Whether the share payload is encrypted.
 * @property {boolean} [isStealth] - Whether stealth padding was applied.
 * @property {number} [primeIndex] - Index into PRIME_TABLE.
 * @property {string} [kdfSchema] - KDF schema version string.
 * @property {Uint8Array} [payload] - The cryptographic payload bytes (after AAD header).
 * @property {Uint8Array} [aadBytes] - The raw AAD header bytes (for AEAD verification).
 * @property {string} [error] - Error message if parsing failed.
 */

/**
 * Inspects a Base64URL-encoded share string and extracts its metadata without decryption.
 *
 * Validates the binary header structure, magic bytes, prime index, and KDF schema.
 * The returned metadata enables UI display of share properties (encryption status,
 * timestamp, set ID) without requiring the decryption password.
 *
 * @param {string} shareBase64 - Base64URL-encoded share string.
 * @returns {ShareMetadata} Parsed metadata object. Check `isValid` before accessing other fields.
 * @throws {Error} If the input is not valid Base64 encoding.
 */
export const inspectShare = (shareBase64) => {
    let bytes;
    try {
        bytes = base64ToBytes(shareBase64);
    } catch (e) {
        throw new InvalidBase64Error();
    }

    try {
        const view = new DataView(bytes.buffer);
        let offset = 0;

        // --- Minimum Length Guard ---
        // Header: [2 version][1 flags][1 kdfSchema][4 timestamp][4 familyId][2 commentLen] = 14 bytes minimum
        if (bytes.length < 14) {
            return { isValid: false, error: 'Data too short to be a PieceKeeper share.' };
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
            return { isValid: false, error: 'Comment length exceeds available data. Share may be corrupted.' };
        }

        const comment = new TextDecoder().decode(bytes.slice(offset, offset + commentLen));
        offset += commentLen;

        const payload = bytes.slice(offset);

        // --- Payload Presence Check ---
        if (payload.length === 0) {
            return { isValid: false, error: 'Share has no cryptographic payload. Data may be corrupted.' };
        }

        return {
            version, familyId, comment, timestamp, isEncrypted, isStealth, primeIndex, kdfSchema,
            payload, isValid: true, aadBytes: bytes.slice(0, offset)
        };
    } catch (e) {
        return { isValid: false, error: 'Failed to parse binary share structure.' };
    }
};
