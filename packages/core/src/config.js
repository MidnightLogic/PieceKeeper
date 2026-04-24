/**
 * PieceKeeper Core — Configuration Constants
 *
 * Cryptographic parameters, prime tables, and schema maps.
 * This module contains ONLY the constants required by the core crypto engine.
 * PWA-specific settings (theme, sound, loading delays) are NOT included here.
 *
 * @module @midnightlogic/piecekeeper-crypto/config
 */

/**
 * @typedef {Object} CryptoSchema
 * @property {string} label_key - i18n key for the schema label (UI-only metadata).
 * @property {string} desc_key - i18n key for the schema description (UI-only metadata).
 * @property {number} [pbkdf2_iterations] - PBKDF2 iteration count (schemas 1-3).
 * @property {string} [pbkdf2_hash] - PBKDF2 hash algorithm (schemas 1-3).
 * @property {string} [kdf_algorithm] - KDF algorithm name ('Argon2id' or 'scrypt') (schemas 4-6).
 * @property {number} [memory_cost] - Argon2id memory cost in KiB (schemas 4-5).
 * @property {number} [time_cost] - Argon2id time cost / iterations (schemas 4-5).
 * @property {number} [parallelism] - Argon2id parallelism (schemas 4-5).
 * @property {number} [cpu_memory_cost] - scrypt N parameter (schema 6).
 * @property {number} [block_size] - scrypt r parameter (schema 6).
 * @property {number} [parallelization] - scrypt p parameter (schema 6).
 * @property {string} aes_algorithm - Encryption cipher (always 'AES-GCM').
 * @property {number} aes_key_length - AES key size in bits (always 256).
 * @property {number} salt_bytes - Salt length in bytes.
 * @property {number} iv_bytes - Initialization vector length in bytes.
 */

/**
 * @typedef {Object} PrimeEntry
 * @property {number} boundary - Maximum payload byte length for this tier.
 * @property {bigint} prime - The proven prime strictly greater than 2^(boundary×8).
 */

/** @type {{ APP_VERSION: string, CRYPTO_SCHEMAS: Object<string, CryptoSchema>, SCHEMA_STORAGE_KEY: string, PRIME_TABLE: PrimeEntry[], MAX_PASSWORD_LENGTH: number, MAX_ENCRYPTION_PASSWORD_LENGTH: number, MAX_COMMENT_LENGTH: number, MAX_SHARES_ALLOWED: number }} */
export const APP_CONFIG = {
    // Default KDF schema key — maps to CRYPTO_SCHEMAS below (e.g. "4" = Argon2id 64MB).
    // This is NOT the app version. Changed via Settings dropdown, persisted in SCHEMA_STORAGE_KEY.
    APP_VERSION: '4',

    // Schema configuration map for robust backward compatibility in future app updates
    CRYPTO_SCHEMAS: {
        '1': {
            label_key: 'config.schema_v1_name',
            desc_key: 'config.schema_v1_desc',
            pbkdf2_iterations: 600000,   // OWASP recommended minimum for 2026
            pbkdf2_hash: 'SHA-256',      // Key derivation hash algorithm
            aes_algorithm: 'AES-GCM',    // Encryption cipher
            aes_key_length: 256,         // AES key size in bits
            salt_bytes: 16,              // Entropy length for PBKDF2 salt
            iv_bytes: 12                 // Initialization Vector size for GCM
        },
        '2': {
            label_key: 'config.schema_v2_name',
            desc_key: 'config.schema_v2_desc',
            pbkdf2_iterations: 100000,   // Fast-mode iterations for constrained hardware
            pbkdf2_hash: 'SHA-256',
            aes_algorithm: 'AES-GCM',
            aes_key_length: 256,
            salt_bytes: 16,
            iv_bytes: 12
        },
        '3': {
            label_key: 'config.schema_v3_name',
            desc_key: 'config.schema_v3_desc',
            pbkdf2_iterations: 2000000,  // Fullsend: extreme mathematical bounds
            pbkdf2_hash: 'SHA-512',
            aes_algorithm: 'AES-GCM',
            aes_key_length: 256,
            salt_bytes: 32,              // Double density entropy
            iv_bytes: 12
        },
        '4': {
            label_key: 'config.schema_v4_name',
            desc_key: 'config.schema_v4_desc',
            kdf_algorithm: 'Argon2id',
            memory_cost: 65536,
            time_cost: 3,
            parallelism: 4,
            aes_algorithm: 'AES-GCM',
            aes_key_length: 256,
            salt_bytes: 16,
            iv_bytes: 12
        },
        '5': {
            label_key: 'config.schema_v5_name',
            desc_key: 'config.schema_v5_desc',
            kdf_algorithm: 'Argon2id',
            memory_cost: 19456,          // 16MB RAM: Safe for older mobile PWA usage
            time_cost: 2,                // Lower pass count to save mobile battery
            parallelism: 1,              // Single thread
            aes_algorithm: 'AES-GCM',
            aes_key_length: 256,
            salt_bytes: 16,
            iv_bytes: 12
        },
        '6': {
            label_key: 'config.schema_v6_name',
            desc_key: 'config.schema_v6_desc',
            kdf_algorithm: 'scrypt',     // Supported natively by hash-wasm
            cpu_memory_cost: 131072,      // (N) Standard memory/CPU cost parameter
            block_size: 8,               // (r) Underlying hash block size
            parallelization: 1,          // (p) Threading parameter
            aes_algorithm: 'AES-GCM',
            aes_key_length: 256,
            salt_bytes: 16,
            iv_bytes: 12
        }
    },
    SCHEMA_STORAGE_KEY: 'cryptoSchemaVersion',

    // 5-tier Dynamic Prime Resolution Table
    // Each prime is the smallest proven prime strictly greater than 2^(boundary×8)
    PRIME_TABLE: [
        { boundary: 16,  prime: (1n << 128n) + 51n },    // Index 0: 128-bit
        { boundary: 32,  prime: (1n << 256n) + 297n },   // Index 1: 256-bit
        { boundary: 64,  prime: (1n << 512n) + 75n },    // Index 2: 512-bit
        { boundary: 128, prime: (1n << 1024n) + 643n },  // Index 3: 1024-bit
        { boundary: 256, prime: (1n << 2048n) + 981n },  // Index 4: 2048-bit
    ],

    // Hard System Memory Constraints
    MAX_PASSWORD_LENGTH: 250,            // 256-byte field limit minus 6-byte overhead (marker + secretLen + 4-byte checksum)
    MAX_ENCRYPTION_PASSWORD_LENGTH: 256, // Maximum allowable chars for the AES symmetric password
    MAX_COMMENT_LENGTH: 32,              // Maximum string boundary for embedded metadata tokens
    MAX_SHARES_ALLOWED: 64,              // Hard ceiling on share generation complexity limit
};
