/** 
 * Copyright 2026 Craig Bailey
 * Repository: https://github.com/MidnightLogic/PieceKeeper
 *
 * Licensed under the Apache License, Version 2.0
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PieceKeeper Cryptographic Test Definitions (v2.0.0)
 * 
 * This module abstracts the core cryptographic mathematical regressions.
 * It uses dependency injection to pull in the operational engine handles
 * (splitSecret, reconstructSecret) via the crypto bridge.
 *
 * All failure-path tests use try/catch with typed errors (v2.0.0 throw-only contract).
 * 
 * To add a new test, simply append a definition block to `pieceKeeperTests`.
 */

import { githubQrDataUrl, scannedRawSharesSet, requiredK, sharePendingKDetermination, sharePendingKDeterminationNfc, reconstructedSecretData, currentGeneratedShares, lastGeneratedN, lastGeneratedK, qrScannerInstance } from './store.js';
import { splitSecret, reconstructSecret } from './cryptoBridge.js';
import { APP_CONFIG } from './config.js';


export const pieceKeeperTests = [
    {
        key: "basic",
        name: "Basic 3-of-5 Unencrypted",
        fn: async () => {
            const shares = await splitSecret("MySimplePassword123", 5, 3, { comment: 'Test Comment 1' });
            if (shares.length !== 5) throw new Error("Share generation failed to produce 5 shares.");
            const recon = await reconstructSecret(shares.slice(0, 3));
            if (recon.secret !== "MySimplePassword123" || recon.metadata.comment !== 'Test Comment 1') throw new Error("Secret decryption mismatch after reconstruction.");
            await reconstructSecret([shares[0], shares[2], shares[4]]);
            // Must throw with insufficient shares
            try { await reconstructSecret(shares.slice(0, 2)); throw new Error("Threshold bypass: Reconstructed successfully with insufficient shares."); } catch (e) { if (e.message.includes("Threshold bypass")) throw e; }
        }
    },
    {
        key: "enc",
        name: "Encrypted 2-of-3",
        fn: async () => {
            const shares = await splitSecret("Another!@#Secret", 3, 2, { encryptionKey: 'myEncKey123', comment: 'Encrypted Test' });
            // Must throw without password
            try { await reconstructSecret(shares.slice(0, 2)); throw new Error("Encryption bypass: Reconstructed successfully without password."); } catch (e) { if (e.message.includes("Encryption bypass")) throw e; }
            // Must throw with wrong password
            try { await reconstructSecret(shares.slice(0, 2), 'wrongKey'); throw new Error("Encryption bypass: Reconstructed successfully with incorrect password."); } catch (e) { if (e.message.includes("Encryption bypass")) throw e; }
            // Succeeds with correct password
            const recon = await reconstructSecret(shares.slice(0, 2), 'myEncKey123');
            if (recon.secret !== "Another!@#Secret") throw new Error("Secret decryption mismatch after reconstruction.");
        }
    },
    {
        key: "k1",
        name: "Edge Case k=1",
        fn: async () => {
            const shares = await splitSecret("k_is_one", 2, 1, { comment: 'k=1 test' });
            await reconstructSecret([shares[0]]);
            const r = await reconstructSecret([shares[1]]);
            if (r.secret !== "k_is_one") throw new Error(`Single-share reconstruction failed or mismatch.`);
        }
    },
    {
        key: "utf",
        name: "UTF-8 Special Characters",
        fn: async () => {
            const s = "🔑 αβγ ✅ € ™ 你好 π≈3.14";
            const shares = await splitSecret(s, 4, 2, { comment: 'UTF8' });
            const r = await reconstructSecret(shares.slice(0, 2));
            if (r.secret !== s) throw new Error(`UTF-8 extraction failed or corrupted.`);
        }
    },
    {
        key: "max",
        name: "Max Limits (64-of-64)",
        fn: async () => {
            const shares = await splitSecret('A'.repeat(128), 64, 64, { comment: 'Max comment | pipes | OK || End.' });
            // Must throw with 63 shares
            try { await reconstructSecret(shares.slice(0, 63)); throw new Error("Threshold bypass: 64-threshold reconstructed with only 63 shares."); } catch (e) { if (e.message.includes("Threshold bypass")) throw e; }
            const r = await reconstructSecret(shares);
            if (r.secret !== 'A'.repeat(128)) throw new Error("Secret mismatch on 64-share reconstruction.");
            if (r.metadata.comment !== 'Max comment | pipes | OK || End.') throw new Error("Metadata comment mismatch on 64-share reconstruction.");
        }
    },
    {
        key: "cross",
        name: "Mismatched Shares (Cross-contamination)",
        fn: async () => {
            const sharesA = await splitSecret("SecretA", 3, 2, { comment: 'Set A' });
            const sharesB = await splitSecret("SecretB", 3, 2, { comment: 'Set B' });
            // Must throw with mismatched family IDs
            try { await reconstructSecret([sharesA[0], sharesB[1]]); throw new Error("Family ID bypass: Successfully reconstructed secret using shares from different sets."); } catch (e) { if (e.message.includes("Family ID bypass")) throw e; }
        }
    },
    {
        key: "dup",
        name: "Duplicate Shares Handling",
        fn: async () => {
            const shares = await splitSecret("DuplicateTest", 3, 3, { comment: 'Dup Test' });
            // Must throw: only 2 unique shares after dedup
            try { await reconstructSecret([shares[0], shares[0], shares[1]]); throw new Error("Duplicate bypass: Engine failed to trap duplicate shares resulting in false threshold."); } catch (e) { if (e.message.includes("Duplicate bypass")) throw e; }
        }
    },
    {
        key: "corrupt",
        name: "Corrupted Share Data",
        fn: async () => {
            const shares = await splitSecret("CorruptTest", 3, 2, { comment: 'Corrupt Test' });
            const corruptedStr = shares[0].share.substring(0, shares[0].share.length - 10) + "!!!!!!!!";
            // Must throw with corrupted share
            try { await reconstructSecret([{ shareIndex: 1, share: corruptedStr }, shares[1]]); throw new Error("Corruption bypass: Engine parsed and authenticated a tampered share."); } catch (e) { if (e.message.includes("Corruption bypass")) throw e; }
        }
    },
    {
        key: "stress",
        name: "Max Bytes Stress (Encrypted)",
        fn: async () => {
            const maxSecret = 'S'.repeat(250);
            const maxComment = 'C'.repeat(32);
            const maxPassword = 'P'.repeat(256);
            const shares = await splitSecret(maxSecret, 5, 3, { encryptionKey: maxPassword, comment: maxComment });
            if (shares.length !== 5) throw new Error("Share generation failed under max-bytes stress.");
            // Must throw with wrong password
            try { await reconstructSecret(shares.slice(0, 3), 'wrongPassword'); throw new Error("Encryption bypass: Reconstructed with wrong password under stress."); } catch (e) { if (e.message.includes("Encryption bypass")) throw e; }
            const r = await reconstructSecret(shares.slice(0, 3), maxPassword);
            if (r.secret !== maxSecret) throw new Error("Secret mismatch on max-bytes stress test.");
            if (r.metadata.comment !== maxComment) throw new Error("Comment mismatch on max-bytes stress test.");
        }
    },
    {
        key: "nfc",
        name: "NFC Hardware Access",
        fn: async () => {
            if (!('NDEFReader' in window)) {
                throw new Error("NDEFReader API not available in this browser/device.");
            }
        }
    },
    {
        key: "camera",
        name: "Device Camera Access",
        fn: async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                stream.getTracks().forEach(track => track.stop());
            } catch (e) {
                if (e.name === "NotAllowedError") throw new Error("Permission Denied. Camera blocked by user/browser.");
                if (e.name === "NotFoundError") throw new Error("No physical camera detected on device.");
                throw new Error(e.message);
            }
        }
    }
];
