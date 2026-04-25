/**
 * PieceKeeper PWA — Crypto Worker Wrapper
 *
 * This file runs INSIDE a Web Worker context.
 * It imports the core crypto package and delegates heavy operations
 * (KDF, share generation, reconstruction, decryption) off the main thread.
 *
 * Error identity (name, code, message) is preserved across the postMessage boundary
 * so the bridge can reconstruct typed PieceKeeperError subclasses.
 */

import {
    splitSecret,
    reconstructSecret,
    decryptBytes,
    deriveKey,
} from '@midnightlogic/piecekeeper-crypto';

self.onmessage = async (event) => {
    const { id, fn, args } = event.data;
    try {
        let result;
        switch (fn) {
            case 'splitSecret':
                result = await splitSecret(...args);
                break;
            case 'reconstructSecret':
                result = await reconstructSecret(...args);
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
        // Preserve typed error identity for the bridge to reconstruct
        self.postMessage({
            id,
            success: false,
            error: error.message,
            errorCode: error.code || null,
            errorName: error.name || 'Error',
        });
    }
};
