/**
 * @midnightlogic/piecekeeper-crypto
 *
 * Isomorphic Shamir's Secret Sharing + AES-256-GCM encryption module.
 * Works in Node.js 18+ and all modern browsers.
 *
 * @module @midnightlogic/piecekeeper-crypto
 */

// --- Core Operations ---
export { splitSecret, reconstructSecret } from './crypto.js';
export { encryptBytes, decryptBytes, deriveKey } from './crypto.js';
export { setLogger } from './crypto.js';

// --- Binary Utilities ---
export { bytesToBase64, base64ToBytes, inspectShare } from './binary.js';

// --- Math Utilities ---
export { getCryptoRandomBigInt, modularInverse, bigIntToBytes, bytesToBigInt } from './math.js';

// --- Shamir Primitives ---
export { newRandomPolynomial, invokePolynomial } from './shamir.js';

// --- Configuration ---
export { APP_CONFIG } from './config.js';

// --- Typed Errors ---
export {
    PieceKeeperError,
    ValidationError, SecretEmptyError, SecretTooLongError,
    ThresholdExceededError, EncryptionKeyTooLongError,
    ShareFormatError, InvalidBase64Error, UnsupportedVersionError, CorruptedShareError,
    ReconstructionError, InsufficientSharesError, SetMismatchError,
    IntegrityCheckError, PasswordRequiredError,
    DecryptionError, WrongPasswordError, DataTooShortError,
    SchemaError, UnknownSchemaError,
} from './errors.js';

// --- Schema Discovery Helpers ---

import { APP_CONFIG } from './config.js';

/**
 * Returns all available KDF schema keys (e.g. ['1', '2', '3', '4', '5', '6']).
 * Use with `getSchema()` to inspect individual schema configurations.
 *
 * @returns {string[]} Array of schema key strings.
 */
export const listSchemas = () => Object.keys(APP_CONFIG.CRYPTO_SCHEMAS);

/**
 * Returns the full KDF schema configuration object for a given schema key.
 * Returns `undefined` if the key does not exist.
 *
 * @param {string} key - The schema key (e.g. '4' for Argon2id 64MB).
 * @returns {import('./config.js').CryptoSchema | undefined} The schema configuration or undefined.
 */
export const getSchema = (key) => APP_CONFIG.CRYPTO_SCHEMAS[key];

// --- Convenience Limit Exports ---

/** Maximum secret length in UTF-8 bytes (250). */
export const MAX_SECRET_LENGTH = APP_CONFIG.MAX_SECRET_LENGTH;

/** Maximum encryption password length in characters (256). */
export const MAX_ENCRYPTION_KEY_LENGTH = APP_CONFIG.MAX_ENCRYPTION_KEY_LENGTH;

/** Maximum comment length embedded in shares (32 characters). */
export const MAX_COMMENT_LENGTH = APP_CONFIG.MAX_COMMENT_LENGTH;

/** Maximum number of shares that can be generated (64). */
export const MAX_SHARES = APP_CONFIG.MAX_SHARES;

/** Default KDF schema key ('4' = Argon2id 64MB). */
export const DEFAULT_SCHEMA = APP_CONFIG.DEFAULT_SCHEMA;
