/**
 * PieceKeeper PWA — Crypto Bridge
 *
 * Main-thread async wrappers that offload heavy cryptographic operations
 * to a Web Worker via the cryptoWorkerWrapper.
 *
 * All functions here have identical signatures to the core package exports
 * but execute inside a disposable worker to prevent UI thread blocking.
 *
 * Typed errors are reconstructed from the worker's serialized error identity
 * so callers can use `instanceof` checks (e.g., `PasswordRequiredError`).
 */

import CryptoWorkerWrapper from './cryptoWorkerWrapper.js?worker&inline';

import {
    PieceKeeperError,
    ValidationError, SecretEmptyError, SecretTooLongError,
    ThresholdExceededError, EncryptionKeyTooLongError,
    ShareFormatError, InvalidBase64Error, UnsupportedVersionError, CorruptedShareError,
    ReconstructionError, InsufficientSharesError, SetMismatchError,
    IntegrityCheckError, PasswordRequiredError,
    DecryptionError, WrongPasswordError, DataTooShortError,
    SchemaError, UnknownSchemaError,
} from '@midnightlogic/piecekeeper-crypto';

/**
 * Registry mapping error codes to their constructor classes.
 * Used to reconstruct typed errors from the worker's serialized identity.
 */
const ERROR_REGISTRY = {
    SECRET_EMPTY: SecretEmptyError,
    SECRET_TOO_LONG: SecretTooLongError,
    THRESHOLD_EXCEEDED: ThresholdExceededError,
    ENCRYPTION_KEY_TOO_LONG: EncryptionKeyTooLongError,
    INVALID_BASE64: InvalidBase64Error,
    UNSUPPORTED_VERSION: UnsupportedVersionError,
    CORRUPTED_SHARE: CorruptedShareError,
    INSUFFICIENT_SHARES: InsufficientSharesError,
    SET_MISMATCH: SetMismatchError,
    INTEGRITY_CHECK_FAILED: IntegrityCheckError,
    PASSWORD_REQUIRED: PasswordRequiredError,
    WRONG_PASSWORD: WrongPasswordError,
    DATA_TOO_SHORT: DataTooShortError,
    UNKNOWN_SCHEMA: UnknownSchemaError,
    VALIDATION_ERROR: ValidationError,
    DECRYPTION_ERROR: DecryptionError,
    SHARE_FORMAT_ERROR: ShareFormatError,
    RECONSTRUCTION_ERROR: ReconstructionError,
    SCHEMA_ERROR: SchemaError,
};

/**
 * Reconstructs a typed error from the worker's serialized identity.
 * Falls back to PieceKeeperError if the code is known but not in registry,
 * or plain Error if completely unknown.
 *
 * @param {string} message - Error message.
 * @param {string|null} code - Machine-readable error code.
 * @param {string} name - Error class name.
 * @returns {Error} The reconstructed typed error.
 */
const reconstructError = (message, code, name) => {
    if (code && ERROR_REGISTRY[code]) {
        const err = new ERROR_REGISTRY[code](message);
        return err;
    }
    if (code) {
        return new PieceKeeperError(message, code);
    }
    return new Error(message);
};

/**
 * Sends a function call to the crypto worker and returns the result.
 *
 * @param {string} fn - Function name to invoke in the worker.
 * @param {...*} args - Arguments to pass to the function.
 * @returns {Promise<*>} The function's return value.
 */
const callWorker = (fn, ...args) => {
    return new Promise((resolve, reject) => {
        const worker = new CryptoWorkerWrapper();
        const id = crypto.randomUUID();

        worker.onmessage = (e) => {
            if (e.data.id === id) {
                if (e.data.success) {
                    resolve(e.data.result);
                } else {
                    reject(reconstructError(e.data.error, e.data.errorCode, e.data.errorName));
                }
                worker.terminate();
            }
        };

        worker.onerror = (err) => {
            reject(new Error('Crypto worker crashed: ' + err.message));
            worker.terminate();
        };

        worker.postMessage({ id, fn, args });
    });
};

/**
 * Splits a secret into N cryptographic shares (worker-offloaded).
 * @see {@link @midnightlogic/piecekeeper-crypto#splitSecret}
 */
export const splitSecret = (...args) => callWorker('splitSecret', ...args);

/**
 * Reconstructs a secret from k or more shares (worker-offloaded).
 * Throws typed errors on failure (never returns { success: false }).
 * @see {@link @midnightlogic/piecekeeper-crypto#reconstructSecret}
 */
export const reconstructSecret = (...args) => callWorker('reconstructSecret', ...args);

/**
 * Decrypts share payload bytes (worker-offloaded).
 * @see {@link @midnightlogic/piecekeeper-crypto#decryptBytes}
 */
export const decryptBytes = (...args) => callWorker('decryptBytes', ...args);

/**
 * Derives an AES-256 key from password + salt (worker-offloaded).
 * @see {@link @midnightlogic/piecekeeper-crypto#deriveKey}
 */
export const deriveKey = (...args) => callWorker('deriveKey', ...args);
