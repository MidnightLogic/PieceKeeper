/**
 * PieceKeeper PWA — Crypto Worker Wrapper
 *
 * This file runs INSIDE a Web Worker context.
 * It imports the core crypto package and delegates heavy operations
 * (KDF, share generation, reconstruction, decryption) off the main thread.
 */

import {
    createCryptographicShares,
    executeShamirReconstruction,
    decryptBytes,
    deriveKey,
} from '@midnightlogic/piecekeeper-crypto';

self.onmessage = async (event) => {
    const { id, fn, args } = event.data;
    try {
        let result;
        switch (fn) {
            case 'createCryptographicShares':
                result = await createCryptographicShares(...args);
                break;
            case 'executeShamirReconstruction':
                result = await executeShamirReconstruction(...args);
                break;
            case 'decryptBytes':
                result = await decryptBytes(...args);
                break;
            case 'deriveKey':
                result = await deriveKey(...args);
                break;
            default:
                throw new Error(`Unknown function: ${fn}`);
        }
        self.postMessage({ id, success: true, result });
    } catch (error) {
        self.postMessage({ id, success: false, error: error.message });
    }
};
