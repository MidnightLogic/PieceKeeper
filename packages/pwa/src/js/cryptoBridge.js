/**
 * PieceKeeper PWA — Crypto Bridge
 *
 * Main-thread async wrappers that offload heavy cryptographic operations
 * to a Web Worker via the cryptoWorkerWrapper.
 *
 * All functions here have identical signatures to the core package exports
 * but execute inside a disposable worker to prevent UI thread blocking.
 */

import CryptoWorkerWrapper from './cryptoWorkerWrapper.js?worker&inline';

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
                if (e.data.success) resolve(e.data.result);
                else reject(new Error(e.data.error));
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
 * Creates N cryptographic shares from a secret (worker-offloaded).
 * @see {@link @midnightlogic/piecekeeper-crypto#createCryptographicShares}
 */
export const createCryptographicShares = (...args) => callWorker('createCryptographicShares', ...args);

/**
 * Reconstructs a secret from k or more shares (worker-offloaded).
 * @see {@link @midnightlogic/piecekeeper-crypto#executeShamirReconstruction}
 */
export const executeShamirReconstruction = (...args) => callWorker('executeShamirReconstruction', ...args);

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
