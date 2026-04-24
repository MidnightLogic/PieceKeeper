/** 
* Copyright 2026 Craig Bailey
* Repository: https://github.com/MidnightLogic/PieceKeeper
*
* Licensed under the Apache License, Version 2.0
* SPDX-License-Identifier: Apache-2.0
*/

let lastScanTime = 0;
import { SCANNER_PURPOSE, RECONSTRUCT_MODE, AppEvents, isSoundEnabled, isScanning, isScanningForInspect, currentScanningPurpose, nfcAbortController, currentNfcPurpose, reconstructionPasswordCallback, lastInspectedShareForPasswordPrompt, firstScannedShareEncryptedStatus, isProcessingSuccessfulReconstruction, currentReconstructionFamilyId, isFamilyMismatchFeedbackCooldown, isGenSharesDelegationAttached, passwordPromptContext, pendingInspectShareString, reconstructionPassword, scannedRawSharesSet, requiredK, sharePendingKDetermination, sharePendingKDeterminationNfc, reconstructedSecretData, currentGeneratedShares, lastGeneratedN, lastGeneratedK, qrScannerInstance, resetReconstructionState } from './store.js';
import { i18n } from './i18n.js';
import { clearReconstructSelection, flashCardError } from './ui.js';


export async function handleNfcMintWriteCycle(event, ndef, shareStringsArr, stateWrapper, promiseControls) {
    if (stateWrapper.isProcessingTap) return;
    stateWrapper.isProcessingTap = true;

    try {
        const tagSerial = event.serialNumber || 'UNKNOWN_SERIAL_' + Date.now();
        let isCurrentSet = false;
        const hasData = event.message && event.message.records && event.message.records.length > 0;

        if (hasData) {
            const record = event.message.records.find(r => r.recordType === "unknown" || r.recordType === "mime");
            if (record && record.data) {
                const rawData = new Uint8Array(record.data.buffer);
                for (const shareStr of shareStringsArr) {
                    const shareBytes = base64ToBytes(shareStr);
                    if (rawData.length === shareBytes.length && rawData.every((val, i) => val === shareBytes[i])) {
                        isCurrentSet = true;
                        break;
                    }
                }
            }
        }

        logger.info(`[NFC Inspect] hasData: ${hasData}, isCurrentSet: ${isCurrentSet}, tagSerial: ${tagSerial}`);

        if (hasData) {
            if (isCurrentSet) {
                const statusEl = document.getElementById('nfc-modal-status');
                const progEl = document.getElementById('nfc-modal-progress');
                if (statusEl) statusEl.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 shrink-0"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg><span>' + safeTranslate('toast.duplicate_current', 'Card already written from this set! Please use a different card.') + '</span></span>';
                if (progEl) progEl.textContent = "Duplicate Card";
                return;
            } else {
                if (stateWrapper.pendingOverwriteSerial !== tagSerial) {
                    stateWrapper.pendingOverwriteSerial = tagSerial;
                    const statusEl = document.getElementById('nfc-modal-status');
                    const progEl = document.getElementById('nfc-modal-progress');
                    if (statusEl) statusEl.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-500 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><span>' + safeTranslate('toast.overwrite_warning', 'Old PieceKeeper set detected. Tap again to overwrite.') + '</span></span>';
                    if (progEl) progEl.textContent = "Overwrite Required";
                    return;
                }
            }
        }

        const progEl = document.getElementById('nfc-modal-progress');
        if (progEl) progEl.textContent = safeTranslate('progress.nfc_writing', 'Writing...');
        const statusEl = document.getElementById('nfc-modal-status');
        if (statusEl) statusEl.textContent = safeTranslate('progress.nfc_hold_steady', 'Writing... Hold device steady!');

        logger.info('Writing Share ' + (stateWrapper.currentShareIndex + 1) + ' to NFC...');
        const shareStr = shareStringsArr[stateWrapper.currentShareIndex];
        const shareBytes = base64ToBytes(shareStr);

        await ndef.write({ records: [{ recordType: "unknown", data: shareBytes }] }, { overwrite: true });
        if (isSoundEnabled.get()) playBeep();

        logger.info('Successfully wrote Share ' + (stateWrapper.currentShareIndex + 1));
        const statusElWrite = document.getElementById('nfc-modal-status');
        if (statusElWrite) {
            statusElWrite.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg><span>' + safeTranslate('progress.nfc_write_success', 'Successfully wrote Share {c}!').replace('{c}', stateWrapper.currentShareIndex + 1) + '</span></span>';
            triggerHaptic('success');
        }

        await new Promise(res => setTimeout(res, 1000));
        stateWrapper.pendingOverwriteSerial = null;

        stateWrapper.currentShareIndex++;
        if (stateWrapper.currentShareIndex < shareStringsArr.length) {
            const nextProgEl = document.getElementById('nfc-modal-progress');
            if (nextProgEl) nextProgEl.textContent = stateWrapper.currentShareIndex + '/' + shareStringsArr.length + ' Written';
            const nextStatusEl = document.getElementById('nfc-modal-status');
            if (nextStatusEl) {
                nextStatusEl.textContent = safeTranslate('progress.nfc_write_next', 'Tap a tag to write Card {c} of {t}')
                    .replace('{c}', stateWrapper.currentShareIndex + 1)
                    .replace('{t}', shareStringsArr.length);
            }
        } else {
            ndef.onreading = null;
            if (isSoundEnabled.get()) playSuccessSound();
            const stEl = document.getElementById('nfc-modal-status');
            if (stEl) stEl.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg><span>' + safeTranslate('progress.nfc_done', 'All NFC Cards minted successfully!') + '</span></span>';
            promiseControls.resolve();
        }

    } catch (writeErr) {
        logger.error("NFC Write Error:", writeErr.message || writeErr.name || "Unknown");
        logger.error("RAW NFC CRASH:", writeErr);
        const errStatusEl = document.getElementById('nfc-modal-status');
        if (errStatusEl) {
            errStatusEl.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 shrink-0"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg><span>' + safeTranslate('progress.error_io', 'NFC Error - Try Again!') + '</span></span>';
            triggerHaptic('error');
            errStatusEl.classList.add('text-red-500');
            setTimeout(() => {
                errStatusEl.classList.remove('text-red-500');
                errStatusEl.textContent = safeTranslate('progress.nfc_write_next', 'Tap a tag to write Card {c} of {t}')
                    .replace('{c}', stateWrapper.currentShareIndex + 1)
                    .replace('{t}', shareStringsArr.length);
            }, 2000);
        }
        const errProgEl = document.getElementById('nfc-modal-progress');
        if (errProgEl) errProgEl.textContent = stateWrapper.currentShareIndex + '/' + shareStringsArr.length + ' Written';
    } finally {
        stateWrapper.isProcessingTap = false;
    }
}


import { displayShareInspectionDetails, prepareAndShowScannerModal } from './ui.js';
import { playSuccessSound, playPasswordPromptSound, playBeep, triggerHaptic } from './ui.js';
import { safeTranslate } from './utils.js';
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { logger } from './logger.js';

import { getProgress } from './ui.js';
import { isNfcSupported, isAndroid } from './utils.js';
import { inspectShare, base64ToBytes, bytesToBase64 } from '@midnightlogic/piecekeeper-crypto';
import { decryptBytes } from './cryptoBridge.js';
// ZXing WASM is loaded lazily on first QR scan — not at boot
let _readBarcodesFromImageData = null;
let _zxingReady = false;

const ensureZXingLoaded = async () => {
    if (_zxingReady) return;
    const [zxingModule, wasmModule] = await Promise.all([
        import('zxing-wasm/reader'),
        import('../assets/zxing_reader.wasm?url')
    ]);
    _readBarcodesFromImageData = zxingModule.readBarcodesFromImageData;
    zxingModule.setZXingModuleOverrides({
        locateFile: (path, prefix) => {
            if (path.endsWith('.wasm')) return wasmModule.default;
            return prefix + path;
        }
    });
    _zxingReady = true;
    logger.info('[ZXing] WASM module loaded (deferred).');
};

// --- Dynamic DOM Getters to fix ReferenceErrors after decoupling ---
const getEl = (id) => document.getElementById(id);

const DOM = {
    get qrScannerModal() { return getEl('qrScannerModal'); },
    get qrScannerModalTitle() { return getEl('qrScannerModalTitle'); },
    get qrScannerModalVideoPreview() { return getEl('qrScannerModalVideoPreview'); },
    get qrScannerModalStatus() { return getEl('qrScannerModalStatus'); },

    get qrScannerModalStopButtonText() { return getEl('qrScannerModalStopButtonText'); },
    get qrScannerModalStopIcon() { return getEl('qrScannerModalStopIcon'); },
    get qrScannerModalCloseIcon() { return getEl('qrScannerModalCloseIcon'); },
    get originalQrScannerContainer() { return getEl('qr-scanner-container'); },
    get stopQrScannerModalButton() { return getEl('stopQrScannerModalButton'); },
    get inspectMethodScanBtn() { return getEl('inspect-method-scan-btn'); },
    get reconScanQrButton() { return getEl('recon-scan-qr'); },
    get qrSharesStatusDiv() { return getEl('qr-shares-status'); },
    get reconEncryptKeyInput() { return getEl('recon-encrypt-key'); }
};

// Scanner status text helper — normalizes typography & swaps SVG icon to match state
const _statusTextColors = ['text-gray-300', 'text-amber-500', 'text-red-500', 'text-emerald-400'];
const _statusIconColors = ['text-gray-400', 'text-amber-500', 'text-red-500', 'text-emerald-400'];
const _statusIcons = {
    default: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    green: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
    amber: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    red: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>'
};
let _qrStatusTimeoutId = null;
function setQrStatusText(text, color = 'default') {
    // Clear any pending auto-dismiss timer on every invocation
    if (_qrStatusTimeoutId) { clearTimeout(_qrStatusTimeoutId); _qrStatusTimeoutId = null; }

    const textEl = document.getElementById('qrScannerModalStatusText');
    const iconEl = document.getElementById('qrScannerModalStatusIcon');
    if (textEl) {
        textEl.textContent = text;
        _statusTextColors.forEach(c => textEl.classList.remove(c));
        if (color === 'amber') textEl.classList.add('text-amber-500');
        else if (color === 'red') textEl.classList.add('text-red-500');
        else if (color === 'green') textEl.classList.add('text-emerald-400');
        else textEl.classList.add('text-gray-300');
    }
    if (iconEl) {
        iconEl.innerHTML = _statusIcons[color] || _statusIcons.default;
        _statusIconColors.forEach(c => iconEl.classList.remove(c));
        if (color === 'amber') iconEl.classList.add('text-amber-500');
        else if (color === 'red') iconEl.classList.add('text-red-500');
        else if (color === 'green') iconEl.classList.add('text-emerald-400');
        else iconEl.classList.add('text-gray-400');
    }

    // Auto-dismiss transient states (amber/red) after 3s → revert to baseline
    if (color === 'amber' || color === 'red') {
        _qrStatusTimeoutId = setTimeout(() => {
            _qrStatusTimeoutId = null;
            const count = scannedRawSharesSet.get().size;
            const k = requiredK.get();
            const baseline = count > 0
                ? `${count}/${k !== null ? k : '?'} ${safeTranslate('scanner.scanned_label', 'Scanned')}`
                : safeTranslate('scanner.point_camera', 'Point camera at a QR code.');
            setQrStatusText(baseline, 'default'); // 'default' won't re-trigger this timer
        }, 3000);
    }
}

// ZXing WASM configuration is now handled inside ensureZXingLoaded()

// ZXing scan loop state
let _zxingScanAnimFrameId = null;
let _zxingScanCanvas = null;
let _zxingScanCtx = null;
let _zxingIsProcessing = false;

// ========================================================================
// HUD Scanner Overlay — Canvas 2D Rendering System
// ========================================================================

// --- HUD State Machine ---
let _hudState = 'SCANNING';
let _hudStateTimestamp = 0;
let _hudZxingPoints = null;
let _hudAnimFrameId = null;
let _hudCanvas = null;
let _hudCtx = null;
let _hudResetTimeoutId = null;

/**
 * Maps a coordinate from video-intrinsic space to canvas pixel space,
 * accounting for CSS object-fit: cover cropping and centering.
 * object-fit:cover scales uniformly via max(scaleX, scaleY) and clips overflow.
 * This ensures canvas brackets align perfectly with the QR code on devices
 * where the video aspect ratio differs from the container aspect ratio.
 */
const mapVideoToCanvas = (vx, vy, video, canvas) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = canvas.width;
    const ch = canvas.height;
    if (!vw || !vh || !cw || !ch) return { x: 0, y: 0 };
    // object-fit: cover uses the LARGER scale factor to fill the container
    const scale = Math.max(cw / vw, ch / vh);
    // Centering offset (negative on the cropped axis)
    const offsetX = (cw - vw * scale) / 2;
    const offsetY = (ch - vh * scale) / 2;
    return {
        x: vx * scale + offsetX,
        y: vy * scale + offsetY
    };
};

/**
 * Sets the HUD cognitive state and schedules auto-reset for transient states.
 * @param {'SCANNING'|'ACQUIRED'|'DUPLICATE'|'FAIL'} state
 * @param {Object|null} zxingPoints - position corners from ZXing result
 */
const setHudState = (state, zxingPoints) => {
    _hudState = state;
    _hudStateTimestamp = performance.now();
    if (zxingPoints) _hudZxingPoints = zxingPoints;
    if (_hudResetTimeoutId) {
        clearTimeout(_hudResetTimeoutId);
        _hudResetTimeoutId = null;
    }
    const durations = { ACQUIRED: 1200, DUPLICATE: 2000, FAIL: 800 };
    const dur = durations[state];
    if (dur) {
        _hudResetTimeoutId = setTimeout(() => {
            if (_hudState === state) {
                _hudState = 'SCANNING';
                _hudStateTimestamp = performance.now();
                _hudZxingPoints = null;
            }
        }, dur);
    }
};

/**
 * Draws a single L-shaped corner bracket.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x - Corner x coordinate
 * @param {number} y - Corner y coordinate
 * @param {number} armLen - Length of each L-arm in pixels
 * @param {number} dirX - 1 or -1 (horizontal direction from corner)
 * @param {number} dirY - 1 or -1 (vertical direction from corner)
 */
const drawCornerBracket = (ctx, x, y, armLen, dirX, dirY) => {
    ctx.beginPath();
    ctx.moveTo(x, y + armLen * dirY);
    ctx.lineTo(x, y);
    ctx.lineTo(x + armLen * dirX, y);
    ctx.stroke();
};

/**
 * Core HUD rendering function — purely functional vector geometry.
 * Called every animation frame by startHudLoop.
 * Renders four cognitive states: SCANNING, ACQUIRED, DUPLICATE, FAIL.
 * No decorative text is drawn — all feedback is via geometry and color.
 */
const drawScannerHUD = (ctx, canvas, video, zxingPoints, state, timestamp) => {
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const bracketLen = Math.min(cw, ch) * 0.07;
    let x1, y1, x2, y2;

    // Map ZXing points through object-fit:cover transform or use default brackets
    if ((state === 'ACQUIRED' || state === 'DUPLICATE' || state === 'FAIL') && zxingPoints) {
        const tl = mapVideoToCanvas(zxingPoints.topLeft.x, zxingPoints.topLeft.y, video, canvas);
        const tr = mapVideoToCanvas(zxingPoints.topRight.x, zxingPoints.topRight.y, video, canvas);
        const bl = mapVideoToCanvas(zxingPoints.bottomLeft.x, zxingPoints.bottomLeft.y, video, canvas);
        const br = mapVideoToCanvas(zxingPoints.bottomRight.x, zxingPoints.bottomRight.y, video, canvas);
        const pad = 14;
        x1 = Math.min(tl.x, tr.x, bl.x, br.x) - pad;
        x2 = Math.max(tl.x, tr.x, bl.x, br.x) + pad;
        y1 = Math.min(tl.y, tr.y, bl.y, br.y) - pad;
        y2 = Math.max(tl.y, tr.y, bl.y, br.y) + pad;
    } else {
        // Default: centered brackets at ~70% of viewport
        const margin = Math.min(cw, ch) * 0.15;
        x1 = margin;
        y1 = margin;
        x2 = cw - margin;
        y2 = ch - margin;
    }

    const elapsed = timestamp - _hudStateTimestamp;

    // FAIL: expansion/collapse bounding box effect
    if (state === 'FAIL') {
        const expandDur = 600;
        if (elapsed < expandDur) {
            const expansion = Math.sin((elapsed / expandDur) * Math.PI) * 20;
            x1 -= expansion;
            y1 -= expansion;
            x2 += expansion;
            y2 += expansion;
        }
    }

    // Color selection by state
    let color;
    switch (state) {
        case 'DUPLICATE': color = '#FFB300'; break;
        case 'FAIL': color = '#FF0000'; break;
        default: color = '#00FF00'; break; // SCANNING + ACQUIRED
    }

    // Alpha modulation for DUPLICATE slow pulse
    ctx.globalAlpha = 1.0;
    if (state === 'DUPLICATE') {
        ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(timestamp * 0.003));
    }

    // Draw four corner brackets (L-shapes)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    drawCornerBracket(ctx, x1, y1, bracketLen, 1, 1);    // Top-left
    drawCornerBracket(ctx, x2, y1, bracketLen, -1, 1);   // Top-right
    drawCornerBracket(ctx, x2, y2, bracketLen, -1, -1);  // Bottom-right
    drawCornerBracket(ctx, x1, y2, bracketLen, 1, -1);   // Bottom-left

    // Centroid and diamond radius for targeting overlay
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const diamondR = Math.min(x2 - x1, y2 - y1) * 0.12;

    // --- SCANNING: sweeping dashed scan line ---
    if (state === 'SCANNING') {
        const period = 2200;
        const t = (timestamp % period) / period;
        const scanY = y1 + (y2 - y1) * (0.5 + 0.45 * Math.sin(t * Math.PI * 2));
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(x1 + 4, scanY);
        ctx.lineTo(x2 - 4, scanY);
        ctx.stroke();
        ctx.restore();
    }

    // --- ACQUIRED: strobe flash + targeting diamond + internal crosshair ---
    if (state === 'ACQUIRED') {
        // Rapid multi-flash strobe (first 800ms)
        if (elapsed < 800) {
            const strobePhase = Math.floor(timestamp / 80) % 4;
            if (strobePhase < 2) {
                ctx.save();
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.12;
                ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
                ctx.restore();
            }
        }
        // Targeting diamond
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy - diamondR);
        ctx.lineTo(cx + diamondR, cy);
        ctx.lineTo(cx, cy + diamondR);
        ctx.lineTo(cx - diamondR, cy);
        ctx.closePath();
        ctx.stroke();
        // Internal crosshair
        const crossR = diamondR * 0.55;
        ctx.beginPath();
        ctx.moveTo(cx - crossR, cy);
        ctx.lineTo(cx + crossR, cy);
        ctx.moveTo(cx, cy - crossR);
        ctx.lineTo(cx, cy + crossR);
        ctx.stroke();
        ctx.restore();
    }

    // --- FAIL: red diamond fill (brief, fading) ---
    if (state === 'FAIL' && elapsed < 400) {
        ctx.save();
        ctx.fillStyle = '#FF0000';
        ctx.globalAlpha = 0.35 * (1 - elapsed / 400);
        ctx.beginPath();
        ctx.moveTo(cx, cy - diamondR);
        ctx.lineTo(cx + diamondR, cy);
        ctx.lineTo(cx, cy + diamondR);
        ctx.lineTo(cx - diamondR, cy);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    ctx.globalAlpha = 1.0;
};

/**
 * Starts the 60fps HUD animation loop (independent from 10fps decode loop).
 * Canvas pixel buffer is synced to CSS display size each frame for sharp rendering.
 * @param {HTMLVideoElement} video - The camera video element
 */
const startHudLoop = (video) => {
    _hudCanvas = document.getElementById('qrScannerHudCanvas');
    if (!_hudCanvas) return;
    _hudCtx = _hudCanvas.getContext('2d');
    _hudState = 'SCANNING';
    _hudStateTimestamp = performance.now();
    _hudZxingPoints = null;

    const loop = () => {
        if (!_hudCanvas || !_hudCtx) return;
        // Sync canvas pixel buffer to displayed CSS dimensions
        const dw = _hudCanvas.clientWidth;
        const dh = _hudCanvas.clientHeight;
        if (_hudCanvas.width !== dw || _hudCanvas.height !== dh) {
            _hudCanvas.width = dw;
            _hudCanvas.height = dh;
        }
        drawScannerHUD(_hudCtx, _hudCanvas, video, _hudZxingPoints, _hudState, performance.now());
        _hudAnimFrameId = requestAnimationFrame(loop);
    };
    _hudAnimFrameId = requestAnimationFrame(loop);
};

/**
 * Stops the HUD animation loop and clears the canvas.
 */
const stopHudLoop = () => {
    if (_hudAnimFrameId) {
        cancelAnimationFrame(_hudAnimFrameId);
        _hudAnimFrameId = null;
    }
    if (_hudResetTimeoutId) {
        clearTimeout(_hudResetTimeoutId);
        _hudResetTimeoutId = null;
    }
    if (_hudCanvas && _hudCtx) {
        _hudCtx.clearRect(0, 0, _hudCanvas.width, _hudCanvas.height);
    }
    _hudCanvas = null;
    _hudCtx = null;
    _hudState = 'SCANNING';
    _hudZxingPoints = null;
};

// --- Torch (Flashlight) State ---
let _torchActive = false;

/**
 * Toggles the camera torch (flashlight) on/off.
 * Gracefully degrades if the hardware or browser does not support torch control.
 * @returns {{ supported: boolean, active: boolean }} Current torch state
 */
export const toggleCameraTorch = () => {
    const video = DOM.qrScannerModalVideoPreview;
    if (!video || !video.srcObject) {
        logger.warn('[Torch] No active video stream.');
        return { supported: false, active: false };
    }

    const track = video.srcObject.getVideoTracks()[0];
    if (!track) {
        logger.warn('[Torch] No video track found on stream.');
        return { supported: false, active: false };
    }

    // Capability detection — getCapabilities() is not universally available
    if (typeof track.getCapabilities !== 'function') {
        logger.warn('[Torch] track.getCapabilities() not supported by this browser.');
        return { supported: false, active: false };
    }

    const capabilities = track.getCapabilities();
    if (!capabilities.torch) {
        logger.warn('[Torch] Torch not supported by this camera hardware.');
        return { supported: false, active: false };
    }

    _torchActive = !_torchActive;
    track.applyConstraints({ advanced: [{ torch: _torchActive }] })
        .then(() => logger.info(`[Torch] Torch ${_torchActive ? 'ON' : 'OFF'}`))
        .catch((err) => {
            logger.error(`[Torch] Failed to apply torch constraint: ${err.message}`);
            _torchActive = false; // Revert state on failure
        });

    return { supported: true, active: _torchActive };
};

// Bind UI update method that was left in main.js
export function updateModalStopButtonState(isScannerActiveAndShouldBeStoppable) {
    if (!DOM.stopQrScannerModalButton || !DOM.qrScannerModalStopButtonText || !DOM.qrScannerModalStopIcon || !DOM.qrScannerModalCloseIcon) {
        logger.error("Modal stop button elements not found in updateModalStopButtonState");
        return;
    }

    if (isScannerActiveAndShouldBeStoppable) {
        DOM.qrScannerModalStopButtonText.textContent = safeTranslate('scanner.stop_btn', 'Stop Scanning');
        DOM.qrScannerModalStopIcon.classList.remove('hidden');
        DOM.qrScannerModalCloseIcon.classList.add('hidden');
        DOM.stopQrScannerModalButton.onclick = () => {
            logger.info("[Stop Button Clicked] Stopping active scan from modal button.");
            stopQRScanner();
        };
    } else {
        DOM.qrScannerModalStopButtonText.textContent = safeTranslate('scanner.close_btn', 'Close Scanner');
        DOM.qrScannerModalStopIcon.classList.add('hidden');
        DOM.qrScannerModalCloseIcon.classList.remove('hidden');
        DOM.stopQrScannerModalButton.onclick = () => { sharePendingKDetermination.set(null); hideQrModal(); };
    }
}


let pendingOverwriteSerial = null;

// Elevated from closure
let _QrScannerModule = null;

// Global variables

// Audio context lazy loading

export async function startNfcMintingFlow(shareStringsArr) {
    if (!('NDEFReader' in window)) {
        setTimeout(() => {
        }, 10);
        return;
    }
    const ndef = new NDEFReader();
    const stateWrapper = { isProcessingTap: false, pendingOverwriteSerial: null, currentShareIndex: 0 };

    nfcAbortController.set(new AbortController());


    // UI Modal setup - Bottom Sheet activation
    const modal = document.getElementById('nfc-modal');
    const backdrop = document.getElementById('nfc-modal-backdrop');
    if (modal) {
        if (backdrop) backdrop.classList.remove('hidden');
        modal.classList.remove('hidden');

        // Trigger slide-up transition
        requestAnimationFrame(() => {
            if (backdrop) { backdrop.classList.remove('opacity-0'); backdrop.classList.add('opacity-100'); }
            modal.classList.remove('translate-y-full');
            modal.classList.add('translate-y-0');
        });

        const title = document.getElementById('nfc-modal-title');
        if (title) title.textContent = safeTranslate('nfc.minting_title', 'Writing NFC Card');

        const progEl = document.getElementById('nfc-modal-progress');
        if (progEl) progEl.textContent = '0/' + shareStringsArr.length + ' Written';

        const statusEl = document.getElementById('nfc-modal-status');
        if (statusEl) {
            statusEl.textContent = safeTranslate('progress.nfc_write_next', 'Tap a tag to write Card {c} of {t}')
                .replace('{c}', 1)
                .replace('{t}', shareStringsArr.length);
        }
    }

    let cancelBtn = null;
    let onCancelClick = null;

    try {
        cancelBtn = document.querySelector('#nfc-modal button');
        onCancelClick = () => { if (nfcAbortController.get()) nfcAbortController.get().abort(); };
        if (cancelBtn) cancelBtn.addEventListener('click', onCancelClick);

        // Start the antenna ONE TIME.
        await ndef.scan({ signal: nfcAbortController.get().signal });
        logger.info("NDEFReader scan initiated for minting session.");

        await new Promise((resolve, reject) => {
            nfcAbortController.get().signal.addEventListener('abort', () => reject(new Error('AbortError')));

            ndef.onreadingerror = () => {
            };

            ndef.onreading = (event) => handleNfcMintWriteCycle(event, ndef, shareStringsArr, stateWrapper, { resolve, reject });
        });

    } catch (error) {
        if (error.name === 'AbortError' || (error.message && error.message === 'AbortError')) {
            // User cancelled minting — silently proceed to teardown
            logger.info('[NFC Minting] User cancelled minting.');
        } else {
            logger.error('[NFC Minting] Hardware error:', error);
            const modalSt = document.getElementById('nfc-modal-status');
            if (modalSt) modalSt.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 shrink-0"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg><span>' + safeTranslate('progress.error_io', 'Error') + '</span></span>';
        }
    } finally {
        if (cancelBtn && onCancelClick) cancelBtn.removeEventListener('click', onCancelClick);
        const md = document.getElementById('nfc-modal');
        const mbd = document.getElementById('nfc-modal-backdrop');
        if (md) {
            if (mbd) { mbd.classList.remove('opacity-100'); mbd.classList.add('opacity-0'); }
            md.classList.remove('translate-y-0');
            md.classList.add('translate-y-full');
        }
        setTimeout(() => {
            if (md) md.classList.add('hidden');
            if (mbd) mbd.classList.add('hidden');
        }, 300);
        // Restore body scroll
        document.body.classList.remove('overflow-hidden');
    }
}

export const startNfcScannerFlow = async (purpose) => {
    let isProcessingTap = false;

    // Explicit Memory Reset
    if (purpose === SCANNER_PURPOSE.RECONSTRUCT) {
        resetReconstructionState();
    }

    if (!isNfcSupported() && !isAndroid()) {
        const modalSt = document.getElementById('nfc-modal-status');
        if (modalSt) modalSt.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 shrink-0"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg><span>' + (i18n.t("toast.nfc_not_supported") || "NFC is not supported. Android Chrome required.") + '</span></span>';
        return;
    }

    currentNfcPurpose.set(purpose);
    // Abort any previous NFC scan to prevent ghost event listeners from prior flows
    const oldCtrl = typeof nfcAbortController !== 'undefined' ? nfcAbortController.get() : null;
    if (oldCtrl && !oldCtrl.signal.aborted) {
        oldCtrl.abort();
        logger.info('[NFC] Aborted previous scan session before starting new one.');
    }
    if (typeof nfcAbortController !== 'undefined') nfcAbortController.set(new AbortController());
    else globalThis.nfcAbortController = { set: (c) => globalThis.nfcAbortController = c, get: () => globalThis.nfcAbortController };

    const ctrl = typeof nfcAbortController !== 'undefined' ? nfcAbortController.get() : globalThis.nfcAbortController;

    const currentCount = (typeof scannedRawSharesSet.get() !== 'undefined') ? scannedRawSharesSet.get().size : 0;
    const thresh = (typeof requiredK.get() !== 'undefined' && requiredK.get() > 0) ? requiredK.get() : '?';

    let initialProgress = purpose === SCANNER_PURPOSE.RECONSTRUCT ? safeTranslate('scanner.scanned_count', '{c}/{t} Scanned').replace('{c}', currentCount).replace('{t}', thresh) : safeTranslate('scanner.ready', 'Ready');

    // UI Init
    const progEl = document.getElementById('nfc-modal-progress');
    if (progEl) progEl.textContent = initialProgress;
    const statusEl = document.getElementById('nfc-modal-status');
    if (statusEl) statusEl.textContent = safeTranslate('nfc.antenna_active', 'Antenna active. Approach a NFC Card.');

    showNfcModal('read', initialProgress);

    const cancelBtn = document.getElementById('nfc-modal-cancel') || document.querySelector('#nfc-modal button');
    const onCancelClick = () => { if (ctrl) ctrl.abort(); };
    if (cancelBtn) cancelBtn.onclick = onCancelClick;

    logger.info('Initializing NDEFReader for NFC Scanner flow...');
    const ndef = new NDEFReader();
    try {
        await ndef.scan({ signal: ctrl.signal });

        // TRAP THE FUNCTION
        return await new Promise((resolve, reject) => {
            let _thresholdResolved = false; // Guard: prevents abort from rejecting after success
            ctrl.signal.addEventListener('abort', () => {
                if (!_thresholdResolved) reject(new Error('AbortError'));
            });

            ndef.onreadingerror = (errEvent) => {
                logger.warn('[NFC] Read error event — tag may be misaligned or unsupported.', errEvent);
                const st = document.getElementById('nfc-modal-status');
                if (st) {
                    const orig = st.textContent;
                    st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-500 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><span>' + safeTranslate('progress.error_read', 'Read Error - Try Again!') + '</span></span>';
                    triggerHaptic('error');
                    st.classList.add('text-yellow-500');
                    setTimeout(() => { st.classList.remove('text-yellow-500'); st.textContent = orig; }, 2500);
                }
                // Keep scanner active — do NOT abort, do NOT reject.
                // User can adjust phone position and try again.
            };

            ndef.onreading = async (event) => {
                if (isProcessingTap) return;
                isProcessingTap = true;
                logger.info('[NFC] Tag tapped.');
                try {
                    // Find the data record by type — do NOT blindly take records[0]
                    const record = event.message.records.find(r => r.recordType === "unknown" || r.recordType === "mime" || r.recordType === "text");
                    if (!record || !record.data) {
                        throw new Error("No readable NDEF record found on this tag.");
                    }
                    logger.info(`[NFC] Record type: ${record.recordType}, byteLength: ${record.data.byteLength}`);
                    let shareString;

                    if (record.recordType === "unknown") {
                        // Binary format: raw Uint8Array → re-encode to Base64URL for parser
                        const rawBytes = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength);
                        shareString = bytesToBase64(rawBytes);
                    } else if (record.recordType === "mime") {
                        // Legacy compressed format: inflate → TextDecoder → Base64 string
                        const rawTagBytes = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength);
                        const decompressedBytes = inflateSync(rawTagBytes);
                        shareString = new TextDecoder().decode(decompressedBytes);
                    } else if (record.recordType === "text") {
                        // Text record fallback: decode and trim whitespace/BOM artifacts
                        shareString = new TextDecoder().decode(new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength)).trim();
                    } else {
                        throw new Error("Unrecognized NFC record format: " + record.recordType);
                    }

                    logger.info(`[NFC] Extracted shareString (first 30): ${shareString.substring(0, 30)}...`);

                    let _willHitThreshNfc = false;
                    if (purpose === SCANNER_PURPOSE.RECONSTRUCT && typeof scannedRawSharesSet.get() !== 'undefined' && typeof requiredK.get() !== 'undefined' && requiredK.get() !== null) {
                        _willHitThreshNfc = (!scannedRawSharesSet.get().has(shareString) && scannedRawSharesSet.get().size + 1 >= requiredK.get()) || (scannedRawSharesSet.get().has(shareString) && scannedRawSharesSet.get().size >= requiredK.get());
                    }
                    if (!_willHitThreshNfc && isSoundEnabled.get()) playBeep();

                    // Cryptographic K-value Inference Engine for NFC Cards
                    if (requiredK.get() == null) {
                        try {
                            const meta = inspectShare(shareString);
                            logger.info(`[NFC] inspectShare result: isValid=${meta?.isValid}, isEncrypted=${meta?.isEncrypted}, payloadLen=${meta?.payload?.length}`);
                            if (meta && meta.isValid) {
                                if (!meta.isEncrypted && meta.payload && meta.payload.length >= 2) {
                                    // Binary payload: [N_u8, K_u8, X_u8, ...Y_bytes]
                                    requiredK.set(meta.payload[1]);
                                } else if (meta.isEncrypted) {
                                    // Encrypted share: pause scanner, show password prompt
                                    playPasswordPromptSound();
                                    sharePendingKDeterminationNfc.set(Object.assign({}, meta, { shareString: shareString, version: meta.version }));
                                    suspendNfcModal();
                                    passwordPromptContext.set(currentNfcPurpose.get() === 'inspect' ? 'inspect' : 'reconstruct');
                                    if (currentNfcPurpose.get() === 'inspect') {
                                        pendingInspectShareString.set(shareString);
                                    }
                                    setTimeout(() => showPasswordPrompt(), 350);
                                    return;
                                }
                            }
                        } catch (e) {
                            logger.warn(`Failed to infer K-value: ${e.message}`);
                        }
                    }

                    if (purpose === SCANNER_PURPOSE.RECONSTRUCT && typeof scannedRawSharesSet.get() !== 'undefined') {
                        // Validate share is a genuine PieceKeeper share before accepting
                        let nfcShareValid = false;
                        try {
                            const nfcMeta = inspectShare(shareString);
                            nfcShareValid = nfcMeta && nfcMeta.isValid;
                        } catch (_) { /* invalid — falls through to rejection */ }

                        if (!nfcShareValid) {
                            logger.warn('[NFC] Rejected non-PieceKeeper data.');
                            const st = document.getElementById('nfc-modal-status');
                            if (st) st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 shrink-0"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg><span>' + safeTranslate('toast.invalid_nfc_card', 'Invalid PieceKeeper Card.') + '</span></span>';
                            triggerHaptic('error');
                            return;
                        }

                        if (!scannedRawSharesSet.get().has(shareString)) {
                            const ds = new Set(scannedRawSharesSet.get()); ds.add(shareString); scannedRawSharesSet.set(ds);
                            logger.info('Share stored.');
                            const st = document.getElementById('nfc-modal-status');
                            if (st) st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg><span>' + safeTranslate('toast.share_added', 'NFC Card Scanned!') + '</span></span>';
                            triggerHaptic('success');
                        } else {
                            logger.warn('Duplicate NFC share detected.');
                            const st = document.getElementById('nfc-modal-status');
                            if (st) {
                                const orig = st.textContent;
                                st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-500 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><span>' + safeTranslate('toast.duplicate_share', 'Duplicate share ignored.') + '</span></span>';
                                triggerHaptic('duplicate');
                                st.classList.add('text-yellow-500');
                                setTimeout(() => { st.classList.remove('text-yellow-500'); st.textContent = orig; }, 2000);
                            }
                        }
                    }

                    // Update UI state
                    if (purpose === SCANNER_PURPOSE.RECONSTRUCT) {
                        const newCount = scannedRawSharesSet.get().size;
                        const newThresh = (typeof requiredK.get() !== 'undefined' && requiredK.get() > 0) ? requiredK.get() : '?';
                        const progElNode = document.getElementById('nfc-modal-progress');
                        if (progElNode) progElNode.textContent = newCount + "/" + newThresh + " Scanned";

                        if (newThresh !== '?' && newCount >= newThresh) {
                            let pd = getProgress('nfc', 'read', 0, 0, 'done');
                            const st = document.getElementById('nfc-modal-status');
                            if (st) st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg><span>' + pd.instructionText + '</span></span>';
                            // Set guard BEFORE hiding modal to prevent abort from rejecting
                            _thresholdResolved = true;
                            hideNfcModal();
                            // Dispatch reconstruction event
                            AppEvents.dispatchEvent(new Event('reconstructReady'));
                            resolve(shareString);
                        } else {
                            let pn = getProgress('nfc', 'read', newCount, newThresh, 'idle');
                            const st = document.getElementById('nfc-modal-status');
                            if (st) {
                                setTimeout(() => { st.textContent = pn.instructionText; }, 2000);
                            }
                        }
                    } else {
                        // Inspect purpose: process the share and show results
                        const st = document.getElementById('nfc-modal-status');
                        if (st) st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg><span>' + safeTranslate('toast.share_processed', 'Share processed.') + '</span></span>';
                        try {
                            hideNfcModal();
                            // Short delay to allow NFC modal dismiss animation to complete
                            await new Promise(r => setTimeout(r, 350));
                            displayShareInspectionDetails(shareString);
                            resolve(shareString);
                        } catch (inspectErr) {
                            logger.error('[NFC Inspect] Failed to display inspection: ' + inspectErr.message);
                            hideNfcModal();
                            reject(inspectErr);
                        }
                    }

                } catch (readErr) {
                    logger.error(`[NFC Read Error] ${readErr.name}: ${readErr.message}`);
                    console.error(readErr);
                    const st = document.getElementById('nfc-modal-status');
                    if (st) {
                        const orig = st.textContent;
                        st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-500 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><span>' + safeTranslate('progress.error_read', 'Read Error - Try Again!') + '</span></span>';
                        triggerHaptic('error');
                        st.classList.add('text-yellow-500');
                        setTimeout(() => { st.classList.remove('text-yellow-500'); st.textContent = orig; }, 2500);
                    }
                    // Keep scanner alive — do NOT reject/abort here.
                    // User can try tapping again.
                } finally {
                    isProcessingTap = false;
                }
            };
        });
    } catch (error) {
        if (error.name === 'AbortError' || (error.message && error.message === 'AbortError')) {
            // User cancelled — silently proceed to teardown
            logger.info('[NFC Scanner] User cancelled scan.');
            clearReconstructSelection();
        } else {
            logger.error('[NFC Scanner] Hardware error:', error);
            const st = document.getElementById('nfc-modal-status');
            if (st) {
                st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 shrink-0"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg><span>' + safeTranslate('progress.error_io', 'Scanner Error') + ': ' + error.message + '</span></span>';
            }
            // Flash the NFC card with "Blocked by OS" after modal closes
            const nfcCard = document.querySelector('.recon-option[data-mode="nfc"]');
            clearReconstructSelection();
            if (nfcCard) {
                // Delay to sync with the finally block's 300ms modal dismiss
                setTimeout(() => {
                    nfcCard.animate([
                        { opacity: 1 }, { opacity: 0.4 }, { opacity: 1 },
                        { opacity: 0.4 }, { opacity: 1 }
                    ], { duration: 400, easing: 'ease-in-out' });
                    flashCardError(nfcCard, 'toast.blocked_by_os', 'Blocked by OS');
                }, 350);
            }
        }
    } finally {
        // CRITICAL: Only perform UI teardown if THIS scanner is still the active one.
        // If a new startNfcScannerFlow() has already replaced the atom, this dying
        // scanner's finally block must NOT hide the new scanner's modal.
        const isStillActiveScanner = nfcAbortController.get() === ctrl || nfcAbortController.get() === null;
        if (isStillActiveScanner) {
            if (cancelBtn && onCancelClick) cancelBtn.removeEventListener('click', onCancelClick);
            const md = document.getElementById('nfc-modal');
            const mbd = document.getElementById('nfc-modal-backdrop');
            if (md) {
                if (mbd) { mbd.classList.remove('opacity-100'); mbd.classList.add('opacity-0'); }
                md.classList.remove('translate-y-0');
                md.classList.add('translate-y-full');
            }
            setTimeout(() => {
                // Re-check at setTimeout time in case a new scanner started during the 300ms delay
                if (nfcAbortController.get() === ctrl || nfcAbortController.get() === null) {
                    if (md) md.classList.add('hidden');
                    if (mbd) mbd.classList.add('hidden');
                }
            }, 300);
            document.body.classList.remove('overflow-hidden');
            if (typeof ndef !== 'undefined' && ndef.onreading) ndef.onreading = null;
        } else {
            logger.info('[NFC Scanner] Stale scanner teardown skipped — new scanner is active.');
        }
    }
};
export const initNfcCancelListener = () => {
    const cancelBtn = document.getElementById('nfc-modal-cancel');
    if (cancelBtn) {
        cancelBtn.onclick = hideNfcModal;
    }
};

export function startQRScanner(purpose) {
    return new Promise(async (resolve, reject) => {
        // 'reconstruct_resume' = resuming after password success, skip state wipe
        const isResume = purpose === 'reconstruct_resume';
        const capturedPurpose = isResume ? 'reconstruct' : purpose;
        if (capturedPurpose === 'reconstruct' && !isResume) {
            resetReconstructionState();
        }
        logger.info(`startQRScanner (modal) called. Purpose: ${capturedPurpose}`, 'info');

        // Reset debouncer for new scan


        // 1. Stop any existing scanner instance and clear video stream
        if (isScanning.get() || qrScannerInstance.get()) {
            logger.info("startQRScanner: Active instance found. Stopping it before starting new.", 'info');
            stopQRScanner();
        }
        isScanning.set(false); document.body.classList.remove("camera-active");
        // Explicitly ensure isScanning.get() is false before attempting to start

        if (DOM.qrScannerModalVideoPreview.srcObject) {
            logger.info("startQRScanner: Clearing existing video srcObject.", 'info');
            DOM.qrScannerModalVideoPreview.srcObject.getTracks().forEach(track => track.stop());
            DOM.qrScannerModalVideoPreview.srcObject = null;
            await new Promise(resolve => setTimeout(resolve, 50)); // Short delay for camera release
        }
        DOM.qrScannerModalVideoPreview.load(); // Helps ensure camera is fully released

        try {
            // 2. Load ZXing WASM if not already loaded (deferred from boot)
            await ensureZXingLoaded();

            // 3. Request camera FIRST — modal only appears after permission granted
            // Lower frameRate forces longer exposure time per frame, improving light-gathering.
            // Advanced constraints request continuous auto-exposure/white-balance if hardware supports it.
            const cameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 15, max: 30 },
                    advanced: [
                        { exposureMode: 'continuous' },
                        { whiteBalanceMode: 'continuous' }
                    ]
                }
            });
            // Camera granted — NOW show the scanner modal
            prepareAndShowScannerModal(capturedPurpose);
            DOM.qrScannerModalVideoPreview.srcObject = cameraStream;
            await DOM.qrScannerModalVideoPreview.play();

            // Store a sentinel so stopQRScanner can identify the active session
            qrScannerInstance.set({ _zxingActive: true });

            // 4. Set up the offscreen canvas for frame capture
            _zxingScanCanvas = document.createElement('canvas');
            _zxingScanCtx = _zxingScanCanvas.getContext('2d', { willReadFrequently: true });

            // 5. Start the ZXing decode loop
            const decodeLoop = async () => {
                if (!qrScannerInstance.get() || !qrScannerInstance.get()._zxingActive) return;

                const video = DOM.qrScannerModalVideoPreview;
                if (video.readyState >= video.HAVE_ENOUGH_DATA && !_zxingIsProcessing) {
                    _zxingScanCanvas.width = video.videoWidth;
                    _zxingScanCanvas.height = video.videoHeight;
                    _zxingScanCtx.drawImage(video, 0, 0);
                    const imageData = _zxingScanCtx.getImageData(0, 0, _zxingScanCanvas.width, _zxingScanCanvas.height);

                    try {
                        _zxingIsProcessing = true;
                        const results = await _readBarcodesFromImageData(imageData, {
                            formats: ['QRCode'],
                            tryHarder: true,
                            maxNumberOfSymbols: 1,
                        });

                        if (results.length > 0) {
                            const rawBytes = results[0].bytes;
                            // rawBytes is the pristine Uint8Array — no text coercion
                            const shareBase64 = bytesToBase64(rawBytes);
                            // Capture ZXing position for HUD overlay (object-fit:cover mapped downstream)
                            if (results[0].position) {
                                _hudZxingPoints = results[0].position;
                            }
                            await processQrDecodedPayload(shareBase64, capturedPurpose, resolve, reject);
                        }
                    } catch (decodeErr) {
                        // Decode errors are expected most frames (no QR in view)
                        logger.info(`ZXing decode cycle: ${decodeErr.message || decodeErr}`, 'debug');
                    } finally {
                        _zxingIsProcessing = false;
                    }
                }

                // Throttle to ~10 fps to avoid burning CPU
                _zxingScanAnimFrameId = setTimeout(() => {
                    requestAnimationFrame(decodeLoop);
                }, 100);
            };
            requestAnimationFrame(decodeLoop);
            startHudLoop(DOM.qrScannerModalVideoPreview);
            isScanning.set(true); document.body.classList.add("camera-active"); // Mark as actively scanning

            // Dynamic Camera Mirroring Check + Torch capability detection
            const stream = DOM.qrScannerModalVideoPreview.srcObject;
            if (stream) {
                const track = stream.getVideoTracks()[0];
                if (track) {
                    const settings = track.getSettings();
                    const hudCanvas = document.getElementById('qrScannerHudCanvas');
                    if (settings.facingMode === 'user') {
                        DOM.qrScannerModalVideoPreview.classList.add('-scale-x-100');
                        if (hudCanvas) hudCanvas.classList.add('-scale-x-100');
                    } else {
                        DOM.qrScannerModalVideoPreview.classList.remove('-scale-x-100');
                        if (hudCanvas) hudCanvas.classList.remove('-scale-x-100');
                    }

                    // Show torch button only if hardware supports it
                    const torchBtn = document.getElementById('qr-torch-btn');
                    if (torchBtn) {
                        const hasTorch = typeof track.getCapabilities === 'function'
                            && track.getCapabilities().torch;
                        if (hasTorch) { torchBtn.classList.remove('invisible'); } else { torchBtn.classList.add('invisible'); }
                    }
                }
            }

            logger.info("ZXing WASM QR Scanner started successfully.", 'info');
            if (isResume && scannedRawSharesSet.get().size > 0) {
                const c = scannedRawSharesSet.get().size;
                const k = requiredK.get() !== null ? requiredK.get() : '?';
                setQrStatusText(c + '/' + k + ' ' + safeTranslate('scanner.scanned_label', 'Scanned'));
            } else {
                setQrStatusText(safeTranslate('scanner.point_camera', 'Point camera at a QR code.'));
            }
            updateModalStopButtonState(true); // Set button to (safeTranslate('scanner.stop_btn', 'Stop Scanning'))


        } catch (err_initial_start) {
            const errorMessage = (err_initial_start && err_initial_start.message) ? err_initial_start.message : "Unknown scanner initialization error.";
            logger.error(`Failed to start QR scanner (modal): ${errorMessage}`);

            // Close the scanner modal — user never needs to see it on failure
            if (typeof stopQRScanner === 'function') stopQRScanner();
            const scannerModal = document.getElementById('qrScannerModal');
            if (scannerModal) scannerModal.classList.add('hidden');
            const reconstructMenuGrid = document.getElementById('reconstruct-menu-grid');
            if (reconstructMenuGrid) reconstructMenuGrid.classList.remove('hidden');

            isScanning.set(false);
            document.body.classList.remove("camera-active");

            // Flash the QR card with "Blocked by OS"
            const camCard = document.querySelector('.recon-option[data-mode="qr"]');
            clearReconstructSelection();
            if (camCard) {
                camCard.animate([
                    { opacity: 1 }, { opacity: 0.4 }, { opacity: 1 },
                    { opacity: 0.4 }, { opacity: 1 }
                ], { duration: 400, easing: 'ease-in-out' });
                flashCardError(camCard, 'toast.blocked_by_os', 'Blocked by OS');
            }

        }
    });
}

export function stopQRScanner() {
    // Cancel ZXing decode loop
    if (_zxingScanAnimFrameId) {
        clearTimeout(_zxingScanAnimFrameId);
        _zxingScanAnimFrameId = null;
    }
    _zxingIsProcessing = false;
    _zxingScanCanvas = null;
    _zxingScanCtx = null;
    _torchActive = false;
    stopHudLoop();

    if (qrScannerInstance.get()) {
        qrScannerInstance.set(null);
    }

    if (DOM.qrScannerModalVideoPreview) {
        DOM.qrScannerModalVideoPreview.pause();
        if (DOM.qrScannerModalVideoPreview.srcObject) {
            DOM.qrScannerModalVideoPreview.srcObject.getTracks().forEach(track => track.stop());
        }
        DOM.qrScannerModalVideoPreview.srcObject = null;
        DOM.qrScannerModalVideoPreview.load();
    }

    isScanning.set(false); document.body.classList.remove("camera-active");

    // Clean up mirror state and torch UI
    if (DOM.qrScannerModalVideoPreview) {
        DOM.qrScannerModalVideoPreview.classList.remove('-scale-x-100');
    }
    const hudCanvas = document.getElementById('qrScannerHudCanvas');
    if (hudCanvas) hudCanvas.classList.remove('-scale-x-100');
    const torchBtn = document.getElementById('qr-torch-btn');
    if (torchBtn) {
        torchBtn.classList.add('invisible');
        torchBtn.dataset.active = 'false';
        torchBtn.classList.remove('bg-yellow-500', 'text-white');
        torchBtn.classList.add('bg-gray-800', 'text-gray-300');
        torchBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flashlight-off"><path d="M16 16v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4"/><path d="M7 2h11v4c0 2-2 2-2 4v1"/><line x1="11" x2="18" y1="6" y2="6"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;
    }

    updateModalStopButtonState(false);

}

export const hideQrModal = () => {
    logger.info('Hiding QR modal.');
    stopQRScanner(); // Stop the scanner and release camera
    // NOTE: Do NOT clear sharePendingKDetermination here — the password prompt handler owns that lifecycle

    // No body overflow unlocks needed because scanner is inline
    if (DOM.qrScannerModal) { // Add null check for safety
        DOM.qrScannerModal.classList.add('hidden');
    }

    const reconstructMenuGrid = document.getElementById('reconstruct-menu-grid');
    if (reconstructMenuGrid) {
        reconstructMenuGrid.classList.remove('hidden');
    }
    // Purpose no longer tracked globally
    reconstructionPasswordCallback.set(null);


    // Reset the main page "Start Scan" buttons to their default state
    if (DOM.reconScanQrButton) {
        DOM.reconScanQrButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera mr-2 shrink-0"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> <span data-i18n="reconstruct.scan_qr">${safeTranslate('reconstruct.scan_qr', 'Start QR Scanner')}</span>`;
        DOM.reconScanQrButton.classList.remove('bg-red-600', 'hover:bg-red-700');
        DOM.reconScanQrButton.classList.add('bg-blue-600', 'hover:bg-blue-700');
        DOM.reconScanQrButton.disabled = false;
    }
    if (DOM.inspectMethodScanBtn) {
        DOM.inspectMethodScanBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera mr-2 shrink-0"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> <span data-i18n="reconstruct.inspect_scan">${safeTranslate('reconstruct.inspect_scan', 'Scan QR Code')}</span>`;
        DOM.inspectMethodScanBtn.classList.remove('bg-red-600', 'hover:bg-red-700', 'text-white', 'bg-sky-100', 'dark:bg-sky-700', 'bg-sky-600', 'dark:bg-sky-500');
        DOM.inspectMethodScanBtn.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-700', 'dark:text-slate-300');
        DOM.inspectMethodScanBtn.disabled = false;
    }
    clearReconstructSelection();
};

export const showNfcModal = (mode, statusText) => {
    const modal = document.getElementById('nfc-modal');
    const backdrop = document.getElementById('nfc-modal-backdrop');
    if (modal) {
        if (backdrop) { backdrop.classList.remove('hidden'); }
        modal.classList.remove('hidden');

        requestAnimationFrame(() => {
            if (backdrop) { backdrop.classList.remove('opacity-0'); backdrop.classList.add('opacity-100'); }
            modal.classList.remove('translate-y-full');
            modal.classList.add('translate-y-0');
        });
        document.getElementById('nfc-modal-title').textContent = mode === 'read' ? safeTranslate('nfc.title_reading', 'Reading NFC Card') : safeTranslate('nfc.title_writing', 'Writing NFC Card');
        document.getElementById('nfc-modal-progress').textContent = statusText;
        document.getElementById('nfc-modal-instruction').textContent = mode === 'read' ? safeTranslate('nfc.modal_desc', 'Hold device near physical NFC tag...') : safeTranslate('nfc.modal_desc_write', 'Hold device near blank NFC tag...');
    }
};

export const hideNfcModal = () => {
    const modal = document.getElementById('nfc-modal');
    const backdrop = document.getElementById('nfc-modal-backdrop');
    // Capture the controller reference NOW before any async race can replace it
    const ctrlToAbort = nfcAbortController.get();
    if (modal) {
        if (backdrop) { backdrop.classList.remove('opacity-100'); backdrop.classList.add('opacity-0'); }
        modal.classList.remove('translate-y-0');
        modal.classList.add('translate-y-full');
        setTimeout(() => {
            modal.classList.add('hidden');
            if (backdrop) backdrop.classList.add('hidden');
        }, 300);
        document.body.classList.remove('overflow-hidden');
    }
    if (ctrlToAbort && !ctrlToAbort.signal.aborted) {
        ctrlToAbort.abort();
    }
    // Only null the atom if it still holds the same controller we captured
    if (nfcAbortController.get() === ctrlToAbort) {
        nfcAbortController.set(null);
    }
    clearReconstructSelection();
};

/**
 * Slides the NFC modal off-screen without destroying state (no abort).
 * Used when transitioning to the password prompt.
 */
export const suspendNfcModal = () => {
    const modal = document.getElementById('nfc-modal');
    const backdrop = document.getElementById('nfc-modal-backdrop');
    if (modal) {
        if (backdrop) { backdrop.classList.remove('opacity-100'); backdrop.classList.add('opacity-0'); }
        modal.classList.remove('translate-y-0');
        modal.classList.add('translate-y-full');
        setTimeout(() => {
            modal.classList.add('hidden');
            if (backdrop) backdrop.classList.add('hidden');
        }, 300);
    }
    // NOTE: Do NOT abort the NFC controller — we want to resume scanning
};

/**
 * Resumes the suspended NFC modal (slides it back up).
 */
export const resumeNfcModal = () => {
    const modal = document.getElementById('nfc-modal');
    const backdrop = document.getElementById('nfc-modal-backdrop');
    if (modal) {
        if (backdrop) { backdrop.classList.remove('hidden'); }
        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            if (backdrop) { backdrop.classList.remove('opacity-0'); backdrop.classList.add('opacity-100'); }
            modal.classList.remove('translate-y-full');
            modal.classList.add('translate-y-0');
        });
    }
};

/**
 * Shows the password prompt action sheet.
 */
export const showPasswordPrompt = () => {
    const modal = document.getElementById('password-prompt-modal');
    const backdrop = document.getElementById('password-prompt-backdrop');
    const errorEl = document.getElementById('password-prompt-error');
    const inputEl = document.getElementById('password-prompt-input');
    if (errorEl) errorEl.classList.add('hidden');
    if (inputEl) inputEl.value = '';
    if (modal) {
        if (backdrop) { backdrop.classList.remove('hidden'); }
        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            if (backdrop) { backdrop.classList.remove('opacity-0'); backdrop.classList.add('opacity-100'); }
            modal.classList.remove('translate-y-full');
            modal.classList.add('translate-y-0');
            if (inputEl) inputEl.focus();
        });
    }
};

/**
 * Hides the password prompt action sheet.
 */
export const hidePasswordPrompt = () => {
    const modal = document.getElementById('password-prompt-modal');
    const backdrop = document.getElementById('password-prompt-backdrop');
    if (modal) {
        if (backdrop) { backdrop.classList.remove('opacity-100'); backdrop.classList.add('opacity-0'); }
        modal.classList.remove('translate-y-0');
        modal.classList.add('translate-y-full');
        setTimeout(() => {
            modal.classList.add('hidden');
            if (backdrop) backdrop.classList.add('hidden');
        }, 300);
    }
    const inputEl = document.getElementById('password-prompt-input');
    if (inputEl) inputEl.value = '';
    const errorEl = document.getElementById('password-prompt-error');
    if (errorEl) errorEl.classList.add('hidden');
};


export async function requestNfcPermission(onGrantedCallback) {
    if (!('NDEFReader' in window)) {
        const nfcCard = document.querySelector('.recon-option[data-mode="nfc"]');
        clearReconstructSelection();
        if (nfcCard) {
            nfcCard.animate([
                { opacity: 1 }, { opacity: 0.4 }, { opacity: 1 },
                { opacity: 0.4 }, { opacity: 1 }
            ], { duration: 400, easing: 'ease-in-out' });
            flashCardError(nfcCard, 'settings.unsupported', 'Unsupported');
        }
        return;
    }

    try {
        if (!navigator.permissions || !navigator.permissions.query) {
            onGrantedCallback();
            return;
        }

        const nfcStatus = await navigator.permissions.query({ name: 'nfc' });
        if (nfcStatus.state === 'granted') {
            onGrantedCallback();
        } else if (nfcStatus.state === 'prompt') {
            const preflightModal = document.getElementById('nfc-preflight-modal');
            const preflightBackdrop = document.getElementById('nfc-preflight-backdrop');
            if (preflightModal) {
                if (preflightBackdrop) preflightBackdrop.classList.remove('hidden');
                preflightModal.classList.remove('hidden');
                requestAnimationFrame(() => {
                    if (preflightBackdrop) { preflightBackdrop.classList.remove('opacity-0'); preflightBackdrop.classList.add('opacity-100'); }
                    preflightModal.classList.remove('translate-y-full');
                    preflightModal.classList.add('translate-y-0');
                });
            }

            const grantBtn = document.getElementById('nfc-preflight-grant');
            const cancelBtn = document.getElementById('nfc-preflight-cancel');
            const cancelBtnBottom = document.getElementById('nfc-preflight-cancel-btn');
            if (cancelBtnBottom) cancelBtnBottom.onclick = () => { if (cancelBtn) cancelBtn.click(); };

            const handleGrant = () => {
                cleanup();
                if (preflightModal) {
                    if (preflightBackdrop) { preflightBackdrop.classList.remove('opacity-100'); preflightBackdrop.classList.add('opacity-0'); }
                    preflightModal.classList.remove('translate-y-0');
                    preflightModal.classList.add('translate-y-full');
                    setTimeout(() => { preflightModal.classList.add('hidden'); if (preflightBackdrop) preflightBackdrop.classList.add('hidden'); }, 300);
                }
                onGrantedCallback();
            };
            const handleCancel = () => {
                cleanup();
                clearReconstructSelection();
                if (preflightModal) {
                    if (preflightBackdrop) { preflightBackdrop.classList.remove('opacity-100'); preflightBackdrop.classList.add('opacity-0'); }
                    preflightModal.classList.remove('translate-y-0');
                    preflightModal.classList.add('translate-y-full');
                    setTimeout(() => { preflightModal.classList.add('hidden'); if (preflightBackdrop) preflightBackdrop.classList.add('hidden'); }, 300);
                }
            };
            const cleanup = () => {
                if (grantBtn) grantBtn.removeEventListener('click', handleGrant);
                if (cancelBtn) cancelBtn.removeEventListener('click', handleCancel);
            };

            if (grantBtn) grantBtn.addEventListener('click', handleGrant);
            if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);
        } else if (nfcStatus.state === 'denied') {
            // Flash the NFC card with "Blocked by OS"
            const nfcCard = document.querySelector('.recon-option[data-mode="nfc"]');
            clearReconstructSelection();
            if (nfcCard) {
                nfcCard.animate([
                    { opacity: 1 }, { opacity: 0.4 }, { opacity: 1 },
                    { opacity: 0.4 }, { opacity: 1 }
                ], { duration: 400, easing: 'ease-in-out' });
                flashCardError(nfcCard, 'toast.blocked_by_os', 'Blocked by OS');
            }
        }
    } catch (e) {
        // Flash the NFC card with "Unsupported"
        const nfcCard = document.querySelector('.recon-option[data-mode="nfc"]');
        clearReconstructSelection();
        if (nfcCard) {
            nfcCard.animate([
                { opacity: 1 }, { opacity: 0.4 }, { opacity: 1 },
                { opacity: 0.4 }, { opacity: 1 }
            ], { duration: 400, easing: 'ease-in-out' });
            flashCardError(nfcCard, 'settings.unsupported', 'Unsupported');
        }
    }
}


// --- PHASE 1.4 RECOVERED HANDLERS ---
export async function handleNfcScanDecodeCycle(event, purpose, stateWrapper, promiseControls) {
    if (stateWrapper.isProcessingTap) return;
    stateWrapper.isProcessingTap = true;
    try {
        const pkRecord = event.message.records.find(r => r.recordType === 'unknown' || (r.recordType === 'mime' && r.mediaType === 'application/piecekeeper'));
        if (!pkRecord) {
            const st = document.getElementById('nfc-modal-status');
            if (st) {
                const orig = st.textContent;
                st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-500 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><span>' + safeTranslate('toast.invalid_nfc_card', 'Invalid PieceKeeper Card.') + '</span></span>';
                st.classList.add('text-yellow-500');
                setTimeout(() => { st.classList.remove('text-yellow-500'); st.textContent = orig; }, 2000);
            }
            return;
        }

        let rawBytes;
        if (pkRecord.data.buffer) {
            rawBytes = new Uint8Array(pkRecord.data.buffer, pkRecord.data.byteOffset, pkRecord.data.byteLength);
        } else {
            rawBytes = new Uint8Array(pkRecord.data);
        }

        let shareString = '';
        if (pkRecord.recordType === 'unknown') {
            // New binary format: raw bytes → Base64 for parser
            shareString = bytesToBase64(rawBytes);
        } else {
            // Legacy compressed format: try inflate, fallback to direct text
            let inflatedU8 = null;
            try { inflatedU8 = inflateSync(rawBytes); } catch (e) { logger.warn("Inflate sync failed:", e); }
            if (inflatedU8) {
                shareString = (typeof strFromU8 !== 'undefined') ? strFromU8(inflatedU8, true) : new TextDecoder().decode(inflatedU8);
            } else {
                shareString = new TextDecoder().decode(rawBytes);
            }
        }

        let _willHitThreshNfc = false;
        if (purpose === 'reconstruct' && scannedRawSharesSet.get() && requiredK.get()) {
            _willHitThreshNfc = (!scannedRawSharesSet.get().has(shareString) && scannedRawSharesSet.get().size + 1 >= requiredK.get()) || (scannedRawSharesSet.get().has(shareString) && scannedRawSharesSet.get().size >= requiredK.get());
        }
        if (!_willHitThreshNfc && isSoundEnabled.get()) playBeep();

        if (requiredK.get() == null) {
            try {
                const meta = inspectShare(shareString);
                if (meta && meta.isValid) {
                    if (!meta.isEncrypted && meta.payload && meta.payload.length >= 2) {
                        // Binary payload: [N_u8, K_u8, X_u8, ...Y_bytes]
                        requiredK.set(meta.payload[1]);
                    } else if (meta.isEncrypted) {
                        document.getElementById('nfc-modal-password-container').classList.remove('hidden');
                        playPasswordPromptSound();
                        document.getElementById('nfc-modal-status').textContent = 'Encrypted Payload. Password required to extract K.';
                        sharePendingKDeterminationNfc.set(Object.assign({}, meta, { shareString: shareString, version: meta.version }));
                        return;
                    }
                }
            } catch (e) { }
        }
        if (scannedRawSharesSet.get()) {
            if (!scannedRawSharesSet.get().has(shareString)) {
                const ds = new Set(scannedRawSharesSet.get()); ds.add(shareString); scannedRawSharesSet.set(ds);
                const st = document.getElementById('nfc-modal-status');
                if (st) st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg><span>' + safeTranslate('toast.share_added', 'NFC Card Scanned!') + '</span></span>';
                triggerHaptic('success');
            } else {
                const st = document.getElementById('nfc-modal-status');
                if (st) {
                    const orig = st.textContent;
                    st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-500 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><span>' + safeTranslate('toast.duplicate_share', 'Duplicate share ignored.') + '</span></span>';
                    triggerHaptic('duplicate');
                    st.classList.add('text-yellow-500');
                    setTimeout(() => { st.classList.remove('text-yellow-500'); st.textContent = orig; }, 2000);
                }
            }
        }
        if (purpose === 'reconstruct' || purpose === 'SCANNER_PURPOSE.RECONSTRUCT') {
            const newCount = scannedRawSharesSet.get().size;
            const newThresh = (requiredK.get() > 0) ? requiredK.get() : '?';
            const progElNode = document.getElementById('nfc-modal-progress');
            if (progElNode) progElNode.textContent = newCount + "/" + newThresh + " Scanned";
            if (newThresh !== '?' && newCount >= newThresh) {
                const st = document.getElementById('nfc-modal-status');
                if (st) st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg><span>Scan Complete!</span></span>';
                hideNfcModal();
                AppEvents.dispatchEvent(new Event('reconstructReady'));
                if (promiseControls && promiseControls.resolve) promiseControls.resolve();
            } else {
                const st = document.getElementById('nfc-modal-status');
                if (st) { setTimeout(() => { st.textContent = 'Scan next card...'; }, 2000); }
            }
        } else if (purpose === 'inspect' || purpose === 'inspectShare') {
            document.getElementById('nfc-modal-status').innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg><span>' + safeTranslate('toast.share_processed', 'Share processed.') + '</span></span>';
            hideNfcModal();
            playSuccessSound();
            displayShareInspectionDetails(shareString);
            if (promiseControls && promiseControls.resolve) promiseControls.resolve();
        }
    } catch (readErr) {
        logger.error("NFC Read Error:", readErr);
        const st = document.getElementById('nfc-modal-status');
        if (st) {
            const orig = st.textContent;
            st.innerHTML = '<span class="flex items-center justify-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 shrink-0"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg><span>' + safeTranslate('progress.error_read', 'Read Error - Try Again!') + '</span></span>';
            triggerHaptic('error');
            st.classList.add('text-red-500');
            setTimeout(() => { st.classList.remove('text-red-500'); st.textContent = orig; }, 2000);
        }
    } finally {
        stateWrapper.isProcessingTap = false;
    }
}

export async function processQrDecodedPayload(decodedText, purpose, resolve, reject) {
    logger.info('[QR Process] Received payload. Purpose:', purpose, decodedText);

    if (!isScanning.get()) return;

    if (Date.now() - lastScanTime < 1500) return;
    lastScanTime = Date.now();

    // --- GATEKEEPER: Reject non-PieceKeeper QR codes ---
    let preflightMeta = { isValid: false };
    try {
        preflightMeta = inspectShare(decodedText);
    } catch (_) { /* invalid base64 or structure — falls through to rejection */ }

    if (!preflightMeta.isValid) {
        logger.warn('[QR Gatekeeper] Rejected non-PieceKeeper QR code:', decodedText.substring(0, 40) + '…');
        setHudState('DUPLICATE', _hudZxingPoints);
        triggerHaptic('error');
        setQrStatusText(safeTranslate('toast.invalid_nfc_card', 'Invalid PieceKeeper Card.'), 'red');
        return; // Scanner stays open — decode loop continues
    }

    if (purpose === 'inspect' || purpose === 'inspectShare') {
        isScanning.set(false); document.body.classList.remove("camera-active");

        setHudState('ACQUIRED', _hudZxingPoints);
        playSuccessSound();
        const DOM_qrScannerModalStatus = document.getElementById('qrScannerModalStatus');
        if (DOM_qrScannerModalStatus) setQrStatusText(safeTranslate('toast.success_share_inspected', 'Share identified! Processing...'), 'green');
        triggerHaptic('success');
        setTimeout(() => {
            hideQrModal();
            displayShareInspectionDetails(decodedText);
            playSuccessSound();
            if (resolve) resolve(decodedText);
        }, 1000);
        return;
    } else if (purpose === 'reconstruct' || purpose === 'SCANNER_PURPOSE.RECONSTRUCT') {
        let inspectMeta = { isValid: false };
        logger.info('[QR Process] Attempting to parse JSON/Metadata.');
        try { inspectMeta = inspectShare(decodedText); } catch (e) { logger.error('[QR Process] Error parsing metadata:', e); }
        const existingPassword = reconstructionPassword.get() || '';
        if (inspectMeta.isValid && inspectMeta.isEncrypted && !existingPassword) {
            // Route through unified password prompt instead of embedded QR password UI
            sharePendingKDetermination.set(Object.assign({}, inspectMeta, { shareString: decodedText, version: inspectMeta.version }));
            isScanning.set(false); document.body.classList.remove('camera-active');
            passwordPromptContext.set('reconstruct');
            hideQrModal();
            setTimeout(() => showPasswordPrompt(), 350);
            return;
        }
        let familyIdMismatchOccurred = false;
        if (inspectMeta.isValid && inspectMeta.familyId) {
            if (currentReconstructionFamilyId.get() == null) {
                currentReconstructionFamilyId.set(inspectMeta.familyId);

            } else if (currentReconstructionFamilyId.get() !== inspectMeta.familyId) {
                familyIdMismatchOccurred = true;
            }
        }
        if (!familyIdMismatchOccurred) {
            if (requiredK.get() == null) {
                if (inspectMeta.isValid && !inspectMeta.isEncrypted && inspectMeta.payload && inspectMeta.payload.length >= 2) {
                    // Binary payload: [N_u8, K_u8, X_u8, ...Y_bytes]
                    requiredK.set(inspectMeta.payload[1]);
                }
            }
            if (firstScannedShareEncryptedStatus.get() == null && inspectMeta.isValid) {
                firstScannedShareEncryptedStatus.set(inspectMeta.isEncrypted);

            } else if (inspectMeta.isValid && firstScannedShareEncryptedStatus.get() !== inspectMeta.isEncrypted) {
            }
            let validKToUse = requiredK.get() !== null ? requiredK.get() : -1;
            let _isThreshMetNow = false;
            if (validKToUse > 0) {
                _isThreshMetNow = (!scannedRawSharesSet.get().has(decodedText) && (scannedRawSharesSet.get().size + 1 >= validKToUse)) ||
                    (scannedRawSharesSet.get().has(decodedText) && scannedRawSharesSet.get().size >= validKToUse);
            }
            if (!scannedRawSharesSet.get().has(decodedText)) {
                setHudState('ACQUIRED', _hudZxingPoints);
                const ds = new Set(scannedRawSharesSet.get()); ds.add(decodedText); scannedRawSharesSet.set(ds);

                if (_isThreshMetNow) {
                    logger.info('[QR Process] Threshold met. Resolving scanner promise.');
                    setQrStatusText(safeTranslate('scanner.thresh_reached', 'Threshold reached! Processing...'), 'green');
                    triggerHaptic('success');
                    playSuccessSound();
                } else {
                    setQrStatusText(safeTranslate('scanner.scan_next', 'Share accepted. Scan next...'));
                    triggerHaptic('success');
                    playBeep();
                }
                const currentCount = scannedRawSharesSet.get().size;
                const reqString = requiredK.get() !== null ? requiredK.get() : '?';
                setQrStatusText(`${currentCount}/${reqString} Scanned`);
            } else {
                setHudState('DUPLICATE', _hudZxingPoints);
                logger.warn('[QR Process] Duplicate share ignored.');
                setQrStatusText(safeTranslate('scanner.duplicate_ignored', 'Duplicate share ignored.'), 'amber');
                triggerHaptic('duplicate');
            }
            if (_isThreshMetNow) {
                isScanning.set(false); document.body.classList.remove("camera-active");

                setTimeout(() => {
                    hideQrModal();
                    // Dispatch reconstruction event to the orchestrator in main.js
                    AppEvents.dispatchEvent(new Event('reconstructReady'));
                    if (resolve) resolve(decodedText);
                }, 1000);
            }
        } else if (familyIdMismatchOccurred) {
            setHudState('FAIL', _hudZxingPoints);
            playPasswordPromptSound();
            triggerHaptic('error');
            const familyIdShort = currentReconstructionFamilyId.get() ? currentReconstructionFamilyId.get().substring(0, 4) : 'N/A';
            setQrStatusText(safeTranslate('error.wrong_set_expected', 'Wrong Set! Expected:') + ' ' + familyIdShort, 'red');
        }
    }
}
