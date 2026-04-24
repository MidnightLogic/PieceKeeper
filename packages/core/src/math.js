/**
 * PieceKeeper Core — Pure Math Utilities
 *
 * Isomorphic BigInt math and cryptographic random number generation.
 * Zero DOM dependencies. Requires globalThis.crypto (Node 19+ / all browsers).
 *
 * @module @midnightlogic/piecekeeper-crypto/math
 */

/**
 * Generates a cryptographically secure random BigInt in the range [0, maxValue).
 * Uses rejection sampling with high-bit masking for minimal bias.
 *
 * @param {bigint} maxValue - Exclusive upper bound (must be > 0n).
 * @returns {bigint} A uniformly distributed random BigInt in [0, maxValue).
 * @throws {Error} If maxValue is not positive.
 */
export const getCryptoRandomBigInt = (maxValue) => {
    if (maxValue <= 0n) throw new Error('maxValue must be positive for random generation.');
    const bitLength = maxValue.toString(2).length;
    const byteLength = Math.ceil(bitLength / 8);
    const excessBits = byteLength * 8 - bitLength;
    let randomBigInt;
    do {
        const randomBytes = new Uint8Array(byteLength);
        crypto.getRandomValues(randomBytes);
        // Mask off excess high bits to minimize rejection probability (<1% vs ~50%)
        if (excessBits > 0) randomBytes[0] &= (0xFF >> excessBits);
        let hex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        randomBigInt = BigInt('0x' + hex);
    } while (randomBigInt >= maxValue);

    return randomBigInt;
};

/**
 * Computes the modular multiplicative inverse of `a` modulo `p`
 * using the Extended Euclidean Algorithm.
 *
 * @param {bigint} a - The value to invert.
 * @param {bigint} p - The prime modulus.
 * @returns {bigint} The modular inverse of `a` mod `p`.
 * @throws {Error} If the inverse does not exist (a ≡ 0 mod p).
 */
export const modularInverse = (a, p) => {
    a = (a % p + p) % p;
    if (a === 0n) throw new Error('Cannot compute modular inverse of 0');

    let [old_r, r] = [a, p];
    let [old_s, s] = [1n, 0n];

    while (r !== 0n) {
        const quotient = old_r / r;
        [old_r, r] = [r, old_r - quotient * r];
        [old_s, s] = [s, old_s - quotient * s];
    }

    if (old_r !== 1n) {
        throw new Error(`Modular inverse does not exist for ${a} mod ${p}. GCD is ${old_r}`);
    }

    return (old_s % p + p) % p;
};

/**
 * Converts a BigInt to a big-endian Uint8Array.
 *
 * @param {bigint} bi - The BigInt to convert.
 * @returns {Uint8Array} The byte representation.
 */
export const bigIntToBytes = (bi) => {
    let hex = bi.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
};

/**
 * Converts a big-endian Uint8Array to a BigInt.
 *
 * @param {Uint8Array} bytes - The byte array to convert.
 * @returns {bigint} The resulting BigInt.
 */
export const bytesToBigInt = (bytes) => {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return BigInt('0x' + hex);
};
