/**
 * PieceKeeper Core — Typed Error Classes
 *
 * Structured error hierarchy for programmatic error handling.
 * All errors extend PieceKeeperError and include a machine-readable `code` property.
 *
 * @module @midnightlogic/piecekeeper-crypto/errors
 */

// --- Base ---

/**
 * Base error class for all PieceKeeper errors.
 * @property {string} code - Machine-readable error code (e.g. 'INSUFFICIENT_SHARES').
 */
export class PieceKeeperError extends Error {
    /** @param {string} message @param {string} code */
    constructor(message, code) {
        super(message);
        this.name = 'PieceKeeperError';
        this.code = code;
    }
}

// --- Validation Errors ---

export class ValidationError extends PieceKeeperError {
    constructor(message, code = 'VALIDATION_ERROR') {
        super(message, code);
        this.name = 'ValidationError';
    }
}

export class SecretEmptyError extends ValidationError {
    constructor(message = 'Secret cannot be empty.') {
        super(message, 'SECRET_EMPTY');
        this.name = 'SecretEmptyError';
    }
}

/** @property {number} maxBytes @property {number} actualBytes */
export class SecretTooLongError extends ValidationError {
    /** @param {number} maxBytes @param {number} actualBytes */
    constructor(maxBytes, actualBytes) {
        super(`Secret exceeds maximum byte limit (${maxBytes} bytes). Use fewer multi-byte characters.`, 'SECRET_TOO_LONG');
        this.name = 'SecretTooLongError';
        this.maxBytes = maxBytes;
        this.actualBytes = actualBytes;
    }
}

/** @property {number} n @property {number} k */
export class ThresholdExceededError extends ValidationError {
    /** @param {number} n @param {number} k */
    constructor(n, k) {
        super(`Threshold (k=${k}) cannot be greater than total shares (n=${n}).`, 'THRESHOLD_EXCEEDED');
        this.name = 'ThresholdExceededError';
        this.n = n;
        this.k = k;
    }
}

/** @property {number} maxLength */
export class EncryptionKeyTooLongError extends ValidationError {
    /** @param {number} maxLength */
    constructor(maxLength) {
        super(`Encryption key exceeds max length (${maxLength} chars).`, 'ENCRYPTION_KEY_TOO_LONG');
        this.name = 'EncryptionKeyTooLongError';
        this.maxLength = maxLength;
    }
}

// --- Share Format Errors ---

export class ShareFormatError extends PieceKeeperError {
    constructor(message, code = 'SHARE_FORMAT_ERROR') {
        super(message, code);
        this.name = 'ShareFormatError';
    }
}

export class InvalidBase64Error extends ShareFormatError {
    constructor(message = 'Invalid Base64 encoding in share.') {
        super(message, 'INVALID_BASE64');
        this.name = 'InvalidBase64Error';
    }
}

/** @property {string} version */
export class UnsupportedVersionError extends ShareFormatError {
    /** @param {string} version */
    constructor(version) {
        super(`Unsupported share format (version ${version}). Expected v2.x.`, 'UNSUPPORTED_VERSION');
        this.name = 'UnsupportedVersionError';
        this.version = version;
    }
}

export class CorruptedShareError extends ShareFormatError {
    constructor(message = 'Share data is corrupted or malformed.') {
        super(message, 'CORRUPTED_SHARE');
        this.name = 'CorruptedShareError';
    }
}

// --- Reconstruction Errors ---

export class ReconstructionError extends PieceKeeperError {
    constructor(message, code = 'RECONSTRUCTION_ERROR') {
        super(message, code);
        this.name = 'ReconstructionError';
    }
}

/** @property {number} required @property {number} provided */
export class InsufficientSharesError extends ReconstructionError {
    /** @param {number} required @param {number} provided */
    constructor(required, provided) {
        super(`Insufficient shares: need ${required}, got ${provided}.`, 'INSUFFICIENT_SHARES');
        this.name = 'InsufficientSharesError';
        this.required = required;
        this.provided = provided;
    }
}

export class SetMismatchError extends ReconstructionError {
    constructor(message = 'All shares must belong to the same set.') {
        super(message, 'SET_MISMATCH');
        this.name = 'SetMismatchError';
    }
}

export class IntegrityCheckError extends ReconstructionError {
    constructor(message = 'Integrity check failed. Shares are corrupted or tampered with.') {
        super(message, 'INTEGRITY_CHECK_FAILED');
        this.name = 'IntegrityCheckError';
    }
}

export class PasswordRequiredError extends ReconstructionError {
    constructor(message = 'Encryption password is required to decrypt these shares.') {
        super(message, 'PASSWORD_REQUIRED');
        this.name = 'PasswordRequiredError';
    }
}

// --- Decryption Errors ---

export class DecryptionError extends PieceKeeperError {
    constructor(message = 'Decryption failed.', code = 'DECRYPTION_ERROR') {
        super(message, code);
        this.name = 'DecryptionError';
    }
}

export class WrongPasswordError extends DecryptionError {
    constructor(message = 'Decryption failed. The encryption password is incorrect.') {
        super(message, 'WRONG_PASSWORD');
        this.name = 'WrongPasswordError';
    }
}

export class DataTooShortError extends DecryptionError {
    constructor(message = 'Encrypted data is too short to contain salt and IV.') {
        super(message, 'DATA_TOO_SHORT');
        this.name = 'DataTooShortError';
    }
}

// --- Schema Errors ---

export class SchemaError extends PieceKeeperError {
    constructor(message, code = 'SCHEMA_ERROR') {
        super(message, code);
        this.name = 'SchemaError';
    }
}

/** @property {string} schemaKey */
export class UnknownSchemaError extends SchemaError {
    /** @param {string} schemaKey */
    constructor(schemaKey) {
        super(`Unknown crypto schema: '${schemaKey}'.`, 'UNKNOWN_SCHEMA');
        this.name = 'UnknownSchemaError';
        this.schemaKey = schemaKey;
    }
}
