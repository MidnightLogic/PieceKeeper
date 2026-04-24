/** 
* Copyright 2026 Craig Bailey
* Repository: https://github.com/MidnightLogic/PieceKeeper
*
* Licensed under the Apache License, Version 2.0
* SPDX-License-Identifier: Apache-2.0
*/

export const SCANNER_PURPOSE = Object.freeze({
    RECONSTRUCT: 'reconstruct',
    INSPECT: 'inspect'
});

export const EXPORT_MODE = Object.freeze({
    COMBINED: 'combined',
    SEPARATE: 'separate'
});

export const RECONSTRUCT_MODE = Object.freeze({
    PASTE: 'paste',
    CSV: 'csv',
    QR: 'qr',
    NFC: 'nfc'
});

export const AppEvents = new EventTarget();

import { atom } from 'nanostores';

export const isSoundEnabled = atom(true);
export const isTesting = atom(false);
export const isAutoClearingForm = atom(false);
export const currentReconMode = atom(RECONSTRUCT_MODE.PASTE);

export const isScanning = atom(false);
export const isScanningForInspect = atom(false);
export const currentScanningPurpose = atom(null);
export const nfcAbortController = atom(null);
export const currentNfcPurpose = atom(null);
export const reconstructionPasswordCallback = atom(null);
export const lastInspectedShareForPasswordPrompt = atom(null);
export const firstScannedShareEncryptedStatus = atom(null);
export const isProcessingSuccessfulReconstruction = atom(false);
export const currentReconstructionFamilyId = atom(null);
export const isFamilyMismatchFeedbackCooldown = atom(false);
export const isGenSharesDelegationAttached = atom(false);

export const githubQrDataUrl = atom('');
export const reconstructionPassword = atom('');
export const passwordPromptContext = atom(null); // 'reconstruct' | 'inspect'
export const pendingInspectShareString = atom(null);

export const scannedRawSharesSet = atom(new Set());
export const requiredK = atom(null);
export const sharePendingKDetermination = atom(null);
export const sharePendingKDeterminationNfc = atom(null);
export const sharePendingKDeterminationManual = atom(null);
export const reconstructedSecretData = atom(null);
export const currentGeneratedShares = atom([]);
export const lastGeneratedN = atom(null);
export const lastGeneratedK = atom(null);
export const qrScannerInstance = atom(null);
export const activeEngineAbortController = atom(null);

/** Resets all reconstruction-related state for a fresh session. */
export const resetReconstructionState = () => {
    scannedRawSharesSet.set(new Set());
    requiredK.set(null);
    firstScannedShareEncryptedStatus.set(null);
    reconstructionPassword.set('');
    currentReconstructionFamilyId.set(null);
};
