/**
 * @midnightlogic/piecekeeper-crypto
 *
 * Isomorphic Shamir's Secret Sharing + AES-256-GCM encryption module.
 * Works in Node.js 18+ and all modern browsers.
 *
 * @module @midnightlogic/piecekeeper-crypto
 */

// --- Core Operations ---
export { createCryptographicShares, executeShamirReconstruction } from './crypto.js';
export { encryptBytes, decryptBytes, deriveKey } from './crypto.js';
export { setLogger } from './crypto.js';

// --- Binary Utilities ---
export { bytesToBase64, base64ToBytes, parseShareMetadata } from './binary.js';

// --- Math Utilities ---
export { getCryptoRandomBigInt, modularInverse, bigIntToBytes, bytesToBigInt } from './math.js';

// --- Shamir Primitives ---
export { newRandomPolynomial, invokePolynomial } from './shamir.js';

// --- Configuration ---
export { APP_CONFIG } from './config.js';
