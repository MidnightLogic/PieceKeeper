/**
 * PieceKeeper Core — Shamir's Secret Sharing Polynomial Math
 *
 * Pure polynomial generation and evaluation for SSS.
 * Zero DOM dependencies. Depends only on math.js for BigInt utilities.
 *
 * @module @midnightlogic/piecekeeper-crypto/shamir
 */

import { getCryptoRandomBigInt } from './math.js';

/**
 * Generates a random polynomial of the given degree with the secret as the constant term.
 * All coefficients are in the range [1, prime-1].
 *
 * @param {bigint} secret - The secret value (constant term / y-intercept).
 * @param {number} degree - Polynomial degree (k - 1).
 * @param {bigint} prime - The prime modulus.
 * @returns {bigint[]} Array of coefficients [secret, a1, a2, ..., a_degree].
 */
export const newRandomPolynomial = (secret, degree, prime) => {
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

/**
 * Evaluates a polynomial at point x using Horner's method, modulo prime.
 *
 * @param {bigint[]} coefficients - Polynomial coefficients [a0, a1, ..., an].
 * @param {bigint} x - The evaluation point.
 * @param {bigint} prime - The prime modulus.
 * @returns {bigint} The polynomial value at x, mod prime.
 */
export const invokePolynomial = (coefficients, x, prime) => {
    let result = 0n;
    for (let i = coefficients.length - 1; i >= 0; i--) {
        result = (result * x + coefficients[i]) % prime;
    }
    result = (result + prime) % prime;
    return result;
};
