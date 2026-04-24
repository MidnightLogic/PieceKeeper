/**
 * PieceKeeper Cryptographic Test Definitions
 * 
 * This module abstracts the core cryptographic mathematical regressions.
 * It uses dependency injection to pull in the operational `engine` handles
 * (generateShares, reconstructSecret) directly from the application's root closure.
 * 
 * To add a new test, simply append a definition block to `pieceKeeperTests`.
 */

import {isSoundEnabled, isAutoClearingForm, isScanning, isScanningForInspect, currentScanningPurpose, nfcAbortController, currentNfcPurpose, reconstructionPasswordCallback, lastInspectedShareForPasswordPrompt, firstScannedShareEncryptedStatus, isProcessingSuccessfulReconstruction, currentReconstructionFamilyId, isFamilyMismatchFeedbackCooldown, isGenSharesDelegationAttached, githubQrDataUrl, reconstructionPassword, passwordPromptContext, pendingInspectShareString, scannedRawSharesSet, requiredK, sharePendingKDetermination, sharePendingKDeterminationNfc, reconstructedSecretData, currentGeneratedShares, lastGeneratedN, lastGeneratedK, qrScannerInstance} from './store.js';
import { printSingleShare, emailSingleShare } from './main.js';
import { startNfcMintingFlow, requestNfcPermission, showPasswordPrompt } from './hardware.js';
import { showQRCode } from './main.js';
import { i18n } from './i18n.js';
import { parseShareMetadata } from '@midnightlogic/piecekeeper-crypto';
import { decryptBytes } from './cryptoBridge.js';
import { copyToClipboard, escapeHtml, flashButton } from './utils.js';
import { safeTranslate } from './utils.js';
import { APP_CONFIG } from './config.js';
import { logger } from './logger.js';


const genPasswordInput = document.getElementById('gen-password');
const genConfirmPasswordInput = document.getElementById('gen-confirm-password');
const genNInput = document.getElementById('gen-n');
const nkWarningSpan = document.getElementById('n-k-warning');
const genKInput = document.getElementById('gen-k');
const genEncryptKeyInput = document.getElementById('gen-encrypt-key');
const genConfirmEncryptKeyInput = document.getElementById('gen-confirm-encrypt-key');
const genSubmitButton = document.getElementById('gen-submit');
const genErrorDiv = document.getElementById('gen-error');
const genResultDiv = document.getElementById('gen-result');
const genSharesDiv = document.getElementById('gen-shares');
const genDownloadLink = document.getElementById('gen-download');
const kNote = document.getElementById('k-note');
const inspectResultDiv = document.getElementById('inspect-result');
const reconEncryptKeyInput = document.getElementById('recon-encrypt-key');
const reconSubmitButton = document.getElementById('recon-submit');
const reconErrorDiv = document.getElementById('recon-error');
const reconResultDiv = document.getElementById('recon-result');
const reconPasswordSpan = document.getElementById('recon-password');
const revealSecretButton = document.getElementById('reveal-secret');
const genConfirmPasswordError = document.getElementById('gen-confirm-password-error');
const genConfirmEncryptKeyError = document.getElementById('gen-confirm-encrypt-key-error');
const genNError = document.getElementById('gen-n-error');
const genKError = document.getElementById('gen-k-error');
const tabPanes = document.querySelectorAll('.tab-pane');
const reconModeOptions = document.querySelectorAll('.recon-option');
const reconModeDivs = document.querySelectorAll('.recon-mode');

/**
 * Clears the visual "selected" highlight from all reconstruct option cards.
 * Called on every exit/cancel/close path so cards reset for the next interaction.
 */
export function clearReconstructSelection() {
    reconModeOptions.forEach(o => o.classList.remove('selected'));
}

/**
 * Flashes a reconstruct card with an error state (icon + message) for 2 seconds.
 * Stores original state on first flash; re-clicks reuse it to prevent snapshot-during-mutation bugs.
 * @param {HTMLElement} card - The .recon-option card element
 * @param {string} labelKey - i18n key for the error label
 * @param {string} labelFallback - Fallback string if i18n key is missing
 */
const _flashState = new WeakMap();
export function flashCardError(card, labelKey, labelFallback) {
    if (!card) return;

    const existing = _flashState.get(card);

    // If already flashing, cancel the restore timer but KEEP the original snapshot
    if (existing) {
        clearTimeout(existing.tid);
    }

    triggerHaptic('error');

    // Only capture the original state on the FIRST entry (not mid-flash)
    const origHTML = existing ? existing.origHTML : card.innerHTML;
    const origClass = existing
        ? existing.origClass
        : card.className.replace(/\bselected\b/g, '').replace(/\s{2,}/g, ' ').trim();

    card.className = 'recon-option p-4 text-center bg-slate-500 dark:bg-slate-600 text-white border border-transparent rounded-xl transition-all duration-150 flex flex-col items-center justify-center';
    card.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 mb-2 text-slate-300"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg><span class="text-sm font-semibold">' + safeTranslate(labelKey, labelFallback) + '</span>';

    const tid = setTimeout(() => {
        card.innerHTML = origHTML;
        card.className = origClass;
        _flashState.delete(card);
    }, 2000);

    _flashState.set(card, { tid, origHTML, origClass });
}

export function updateNKWarning() {
        if (!nkWarningSpan) return;
        const nVal = parseInt(genNInput.value);
        const kVal = parseInt(genKInput.value);
        if (isNaN(nVal) || isNaN(kVal)) {
            nkWarningSpan.classList.add('hidden');
            nkWarningSpan.removeAttribute('data-i18n');
            return;
        }

        if (kVal === 1) {
            nkWarningSpan.textContent = safeTranslate('generate.warning_k_equals_1', 'Warning: K is 1. Anyone who finds ANY single share can read your secret! This offers zero structural security.');
            nkWarningSpan.setAttribute('data-i18n', 'generate.warning_k_equals_1');
            nkWarningSpan.classList.remove('hidden');
        } else if (kVal === nVal) {
            nkWarningSpan.textContent = safeTranslate('generate.warning_k_equals_n', 'Warning: K equals N. If you lose even ONE share, your secret is lost forever! This provides no redundancy.');
            nkWarningSpan.setAttribute('data-i18n', 'generate.warning_k_equals_n');
            nkWarningSpan.classList.remove('hidden');
        } else {
            nkWarningSpan.classList.add('hidden');
            nkWarningSpan.removeAttribute('data-i18n');
        }
    }

export const renderGeneratedSharesToUI = (shares, k) => {
        // --- Display Generated Shares ---
        genSharesDiv.innerHTML = shares.map(s => {
            let displayFamilyId = 'N/A';
            let displayComment = 'None';
            let displayTimestamp = 'Unknown';
            let displayEncrypted = false;
            try {
                const meta = parseShareMetadata(s.Share);
                if (meta.isValid) {
                    displayFamilyId = meta.familyId;
                    displayComment = meta.comment || 'None';
                    displayTimestamp = meta.timestamp;
                    displayEncrypted = meta.isEncrypted;
                }
            } catch { /* Ignore parsing errors for display */ }

            return buildShareCardHTML({
                shareIndex: s.ShareIndex,
                shareString: s.Share,
                version: s.Version || '1',
                familyId: displayFamilyId,
                comment: displayComment,
                timestamp: displayTimestamp,
                isEncrypted: displayEncrypted,
                thresholdK: k
            }, 'generate');
        }).join('');

        // Event delegation for share-specific actions
        if (!isGenSharesDelegationAttached.get()) {
            genSharesDiv.addEventListener('click', (event) => {
                const button = event.target.closest('button');
                if (!button) return;

                const shareDiv = button.closest('div[data-share-index]');
                if (!shareDiv) return;

                const shareIndexInArray = parseInt(shareDiv.dataset.shareIndex); // 0-based index
                const shareObject = currentGeneratedShares.get()[shareIndexInArray];

                if (!shareObject) {
                    logger.error(`Could not find share object for index ${shareIndexInArray}`);
                    return;
                }

                const TICK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                const X_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

                if (button.classList.contains('copy-btn')) {
                    copyToClipboard(shareObject.Share, `Share ${shareObject.ShareIndex}`).then(ok => {
                        if (ok) flashButton(button, TICK_SVG, 'emerald', 1200);
                    });
                } else if (button.classList.contains('qr-btn')) {
                    showQRCode(shareObject.Share);
                } else if (button.classList.contains('print-single-btn')) {
                    printSingleShare(shareObject);
                } else if (button.classList.contains('email-single-btn')) {
                    emailSingleShare(shareObject);
                } else if (button.classList.contains('nfc-share-btn')) {
                    if (!('NDEFReader' in window)) {
                        flashButton(button, X_SVG, 'slate', 1200);
                        try { if (navigator.vibrate) navigator.vibrate([30, 30, 30]); } catch (_) {}
                    } else {
                        requestNfcPermission(() => { startNfcMintingFlow([shareObject.Share]); });
                    }
                }
            });
            isGenSharesDelegationAttached.set(true);

        }

        genResultDiv.classList.remove('hidden'); // Show the results section
    };

export const buildShareCardHTML = (shareData, renderMode) => {
        const tr = safeTranslate;
        
        if (shareData.kdfSchema && typeof APP_CONFIG.CRYPTO_SCHEMAS !== 'undefined' && APP_CONFIG.CRYPTO_SCHEMAS[shareData.kdfSchema]) {
            const sLabelKey = APP_CONFIG.CRYPTO_SCHEMAS[shareData.kdfSchema].label_key;
        } else if (shareData.kdfSchema) {
        }

        if (renderMode === 'inspect') {
            let inspectHtml = `
                            <p><strong>${tr('inspect.family_id', 'Set ID:')}</strong> <span class="font-mono text-xs break-all">${escapeHtml(shareData.familyId || 'N/A')}</span></p>
                            <p><strong>${tr('inspect.comment', 'Comment:')}</strong> ${escapeHtml(shareData.comment || tr('inspect.none', 'None'))}</p>
                            <p><strong>${tr('inspect.created', 'Created:')}</strong> ${escapeHtml(shareData.timestamp || tr('inspect.unknown', 'Unknown'))}</p>
                            <p><strong>${tr('inspect.encryption_status', 'Additional password encryption:')}</strong> <span class="font-medium ${shareData.isEncrypted ? 'text-red-500' : 'text-green-500'}">${shareData.isEncrypted ? tr('inspect.yes', 'Yes') : tr('inspect.no', 'No')}</span></p>
                        `;
            if (shareData.warningMsg) {
                 inspectHtml += `<hr class="my-2 border-slate-200 dark:border-slate-700">
                                <p class="text-sm text-yellow-600 dark:text-yellow-400">${escapeHtml(shareData.warningMsg)}</p>`;
            }
            if (shareData.errorMsg) {
                 inspectHtml += `<p class="text-sm text-red-600 dark:text-red-400">${escapeHtml(shareData.errorMsg)}</p>`;
            }
            if (shareData.showParsedValues) {
                inspectHtml += `<hr class="my-2 border-slate-200 dark:border-slate-700">
                                <p class="text-xs text-slate-500 dark:text-slate-400"><em>${tr('inspect.parsed_values_header', 'Parsed values (N, K, X-coordinate):')}</em></p>
                                <p><strong>${tr('inspect.total_shares', 'Total Shares in Set (N):')}</strong> ${escapeHtml(shareData.totalN)}</p>
                                <p><strong>${tr('inspect.threshold', 'Threshold to Reconstruct (K):')}</strong> ${escapeHtml(shareData.thresholdK)}</p>
                                <p><strong>${tr('inspect.share_index', 'Share Index (X-coordinate):')}</strong> ${escapeHtml(shareData.shareIndex)}</p>`;
            }
            return inspectHtml;
        }

        if (renderMode === 'generate') {
             return `
                    <div class="border-b border-slate-200 dark:border-slate-600 pb-3 mb-3 last:border-b-0 last:pb-0 last:mb-0" data-share-index="${(typeof shareData.shareIndex === 'number' ? shareData.shareIndex - 1 : shareData.shareIndex)}">
                        <div class="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-2">
                            <div class="flex items-center gap-2 min-w-0">
                                 <span class="inline-flex items-center justify-center flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs font-bold">${shareData.shareIndex}</span>
                                 <span class="share-text text-slate-700 dark:text-slate-300 flex-1 break-all">${escapeHtml(shareData.shareString)}</span>
                            </div>
                            <div class="flex space-x-1 flex-shrink-0 ml-auto sm:ml-0 self-start sm:self-center">
                                <button class="hover:-translate-y-0.5 active:scale-95 transition-all duration-200 copy-btn p-1 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" data-share="${escapeHtml(shareData.shareString)}" title="Copy Share">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                                </button>
                                <button class="hover:-translate-y-0.5 active:scale-95 transition-all duration-200 qr-btn p-1 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" data-share="${escapeHtml(shareData.shareString)}" title="Show QR Code">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-qr-code"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
                                </button>
                                  <button class="hover:-translate-y-0.5 active:scale-95 transition-all duration-200 nfc-share-btn p-1 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" data-share="${escapeHtml(shareData.shareString)}" title="Write to NFC Tag">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-nfc"><path d="M6 8.32a7.43 7.43 0 0 1 0 7.36"/><path d="M9.46 6.21a11.76 11.76 0 0 1 0 11.58"/><path d="M12.91 4.1a15.91 15.91 0 0 1 .01 15.8"/><path d="M16.37 2a20.16 20.16 0 0 1 0 20"/></svg>
                                  </button>
                                <button class="hover:-translate-y-0.5 active:scale-95 transition-all duration-200 print-single-btn p-1 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" title="Print Share">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-printer"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>
                                </button>
                                <button class="hover:-translate-y-0.5 active:scale-95 transition-all duration-200 email-single-btn p-1 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" title="Email Share">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-mail"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                                </button>
                            </div>
                        </div>
                         <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 ml-8">
                         </p>
                    </div>
                 `;
        }

        if (renderMode === 'print') {
            let passwordInfoHtml = '';
            if (shareData.isEncrypted === true) {
                const passwordNote = "This share set was protected with an additional password during creation, and is required during reconstruction, in addition to the required number of shares. The password is only known by the creator and is not stored within the shares.";
                passwordInfoHtml = `
                            <div class="password-alert-box">
                                <p class="title">Important Password Information:</p>
                                <p class="note">
                                    ${passwordNote}
                                </p>
                            </div>
                        `;
            }

            return `${shareData.isCombined ? '' : '<div class="share-page-container">'}${shareData.isCombined ? '' : `\n                    <h1>${tr('print.title', 'Shamir Secret Share')}</h1>`}
                    <div class="header-info"${shareData.isCombined ? ' style="margin-top:20px;"' : ''}>
                        ${tr('print.n_label', 'Total Shares in Set (N):')} ${shareData.totalN} &nbsp;&nbsp;|&nbsp;&nbsp; ${tr('print.k_label', 'Threshold to Reconstruct (K):')} ${shareData.thresholdK}
                    </div>
                    <div class="share-index">${tr('print.share_index', 'Share Index:')} ${shareData.shareIndex} ${tr('print.of', 'of')} ${shareData.totalN}</div>
                    
                    <div class="qr-code-container">
                        <img src="${shareData.qrCodeDataUrl}" alt="QR Code for Share ${shareData.shareIndex}">
                    </div>
                    
                    <div class="share-details">
                        <p><strong>${tr('print.family_id', 'Set ID:')}</strong> ${shareData.familyId}</p>
                        <p><strong>${tr('print.comment', 'Comment/Note:')}</strong> ${shareData.comment}</p>
                        <p><strong>${tr('print.generated', 'Generated:')}</strong> ${shareData.timestamp}</p>
                        <p><strong>${tr('print.password_enc', 'Additional password encryption:')}</strong> <span style="font-weight: bold; color: ${shareData.isEncrypted === true ? '#c0392b' : '#27ae60'};">${shareData.isEncrypted === true ? (tr("print.yes", "Yes")) : (tr("print.no", "No"))}</span></p>
                        ${passwordInfoHtml}
                    </div>

                    <div class="share-text">${shareData.shareString}</div>
                    
                    <p class="footer-note" data-i18n="print.footer_note">${tr('print.footer_note', 'Keep this share safe. It is one piece of a threshold secret sharing scheme.')}</p>
                    ${githubQrDataUrl.get() ? `<div style="text-align:center; margin-top:10px; opacity:0.7;"><img src="${githubQrDataUrl.get()}" alt="GitHub" style="width:48px; height:48px; display:inline-block; vertical-align:middle;"><br><span style="font-size:0.75em; color:#888;">PieceKeeper — Open Source on GitHub</span></div>` : ''}
                ${shareData.isCombined ? '' : '</div>'}
            `;
        }
        return '';
    };

export async function displayShareInspectionDetails(shareBase64) {
        if (!inspectResultDiv) {
            logger.error("Inspect result div not found (displayShareInspectionDetails).");
            return;
        }
        inspectResultDiv.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">' + safeTranslate('inspect.inspecting', 'Inspecting...') + '</p>';
        inspectResultDiv.classList.remove('hidden');
        lastInspectedShareForPasswordPrompt.set(null); // Clear previous pending share

        if (!shareBase64 || typeof shareBase64 !== 'string') {
            inspectResultDiv.innerHTML = '<p class="text-sm text-yellow-600 dark:text-yellow-400">' + safeTranslate('inspect.no_data', 'No share data provided to inspect.') + '</p>';
            return;
        }

        logger.info(`Inspecting share: ${shareBase64.substring(0, 30)}...`);
        // Source password: atom first (set by password prompt handler), then DOM fallbacks
        let currentPassword = reconstructionPassword.get() || '';
        if (!currentPassword) {
            const pasteSheetPw = document.getElementById('recon-paste-encrypt-key');
            const csvSheetPw = document.getElementById('recon-csv-encrypt-key');
            if (reconEncryptKeyInput && reconEncryptKeyInput.value) currentPassword = reconEncryptKeyInput.value;
            else if (pasteSheetPw && pasteSheetPw.value) currentPassword = pasteSheetPw.value;
            else if (csvSheetPw && csvSheetPw.value) currentPassword = csvSheetPw.value;
        }

        try {
            const metadata = parseShareMetadata(shareBase64);
            
            
            
            let detailsHtml = '';

            if (metadata.isValid) {
                if (metadata.version && typeof APP_CONFIG.CRYPTO_SCHEMAS !== 'undefined' && APP_CONFIG.CRYPTO_SCHEMAS[metadata.version]) {
                                    } else if (metadata.version) {
                }

                let shareDataObj = {
                    version: metadata.version,
                    familyId: metadata.familyId,
                    comment: metadata.comment,
                    timestamp: metadata.timestamp,
                    isEncrypted: metadata.isEncrypted
                };

                // Always store raw share for Copy Share button
                lastInspectedShareForPasswordPrompt.set(shareBase64);

                if (metadata.isEncrypted && !currentPassword) {
                    playPasswordPromptSound();
                    logger.info('[Inspect] Share is encrypted — showing password prompt.');
                    // Store the share and set context so the password handler knows this is an inspect flow
                    pendingInspectShareString.set(shareBase64);
                    passwordPromptContext.set('inspect');
                    lastInspectedShareForPasswordPrompt.set(shareBase64);
                    showPasswordPrompt();
                    return; // Exit — the password handler will re-invoke us with the password

                } else {
                    shareDataObj.showParsedValues = true;
                    shareDataObj.totalN = 'N/A';
                    shareDataObj.thresholdK = 'N/A';
                    shareDataObj.shareIndex = 'N/A';
                    try {
                        // metadata already parsed upstream — reuse it (DRY, no redundant parseShareMetadata call)
                        if (metadata.payload && metadata.payload.length > 0) {
                            const decryptedPayload = await decryptBytes(metadata.payload, currentPassword, metadata.isEncrypted, metadata.kdfSchema, metadata.aadBytes);
                            // Binary-packed inner payload: [N:1 byte][K:1 byte][X:1 byte][Y:variable bytes]
                            if (decryptedPayload.length >= 3) {
                                shareDataObj.totalN = decryptedPayload[0];
                                shareDataObj.thresholdK = decryptedPayload[1];
                                shareDataObj.shareIndex = decryptedPayload[2];
                            } else {
                                logger.warn('[Inspect] Decrypted payload too short for binary N,K,X extraction.');
                                if (metadata.isEncrypted) shareDataObj.errorMsg = 'Could not decrypt N,K,X values. Password might be incorrect.';
                            }
                        } else {
                            logger.warn('[Inspect] Invalid share structure: empty or missing payload.');
                        }
                    } catch (e) {
                        logger.error(`[Inspect] Error decrypting share payload: ${e.message}`);
                        shareDataObj.errorMsg = `Error decrypting share details: ${e.message}. Check password.`;
                        if (e.message.toLowerCase().includes("password") || e.message.toLowerCase().includes("decrypt")) {
                        } else {
                        }
                    }
                }
                detailsHtml = buildShareCardHTML(shareDataObj, 'inspect');
                inspectResultDiv.innerHTML = `<div class="space-y-1 text-sm">${detailsHtml}</div>`;

            // Close bottom sheet + open result presentation modal (inspect mode)
            {
                // Dismiss the inspect bottom sheet
                const sheet = document.getElementById('inspect-bottom-sheet');
                const sheetBackdrop = document.getElementById('inspect-backdrop');
                if (sheet) { sheet.classList.add('hidden', 'translate-y-full'); sheet.classList.remove('translate-y-0'); }
                if (sheetBackdrop) { sheetBackdrop.classList.add('hidden', 'opacity-0'); sheetBackdrop.classList.remove('opacity-100'); }

                // Open the result presentation modal in inspect mode
                const resultBackdrop = document.getElementById('result-modal-backdrop');
                const resultModal = document.getElementById('result-presentation-modal');
                const modalTitle = resultModal ? resultModal.querySelector('h3[data-i18n]') : null;
                const revealBtn = document.getElementById('reveal-secret');
                const reconResult = document.getElementById('recon-result');
                const inspectResult = document.getElementById('inspect-result');

                // Context: inspect mode
                if (modalTitle) {
                    modalTitle.textContent = safeTranslate('inspect.share_details', 'Share Details');
                    modalTitle.setAttribute('data-i18n', 'inspect.share_details');
                }
                if (revealBtn) revealBtn.classList.add('hidden');
                if (reconResult) reconResult.classList.add('hidden');
                if (inspectResult) inspectResult.classList.remove('hidden');
                const copyBtn = document.getElementById('copy-secret-btn');
                if (copyBtn) copyBtn.classList.add('hidden'); // No copy button in inspect mode

                if (resultModal && resultBackdrop) {
                    resultBackdrop.classList.remove('hidden');
                    resultModal.classList.remove('hidden');
                    requestAnimationFrame(() => {
                        resultBackdrop.classList.remove('opacity-0');
                        resultBackdrop.classList.add('opacity-100');
                        resultModal.classList.remove('translate-y-full');
                        resultModal.classList.add('translate-y-0');
                    });
                }
            }

            } else { // metadata not valid
                inspectResultDiv.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">${safeTranslate('inspect.err_parsing', 'Error parsing share:')} ${metadata.error || 'Invalid share format'}</p>`;
            }
        } catch (e) {
            inspectResultDiv.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">${safeTranslate('inspect.err_displaying', 'Error displaying share details:')} ${e.message}</p>`;
            logger.error(`Error in displayShareInspectionDetails: ${e.message}`);
        }
    }

export const validateGenForm = () => {
        const pass = genPasswordInput.value;
        const conf = genConfirmPasswordInput.value;
        const nVal = parseInt(genNInput.value);
        const kVal = parseInt(genKInput.value);
        const encryptKey = genEncryptKeyInput.value;
        const confirmEncryptKey = genConfirmEncryptKeyInput.value;

        let isFormValid = true;
        let tooltipMessages = [];

        // Reactively clear stale on-screen shares if the user is editing cryptographic inputs
        if (currentGeneratedShares.get() && currentGeneratedShares.get().length > 0) {
            if (!isAutoClearingForm.get()) {
                const isFormEmpty = !genPasswordInput.value && !genConfirmPasswordInput.value && !genNInput.value && !genKInput.value;
                if (!isFormEmpty) {
                    currentGeneratedShares.set(null);
                    if (typeof genResultDiv !== 'undefined' && genResultDiv) genResultDiv.classList.add('hidden');
                }
            }
        }

        // --- Reset/hide all inline errors at the start of validation ---
        if (genConfirmPasswordError) genConfirmPasswordError.classList.add('hidden');
        if (genConfirmEncryptKeyError) genConfirmEncryptKeyError.classList.add('hidden');
        if (genNError) genNError.classList.add('hidden'); // Reset N error
        if (genKError) genKError.classList.add('hidden'); // Reset K error

        // Secret Password Validation
        let secretPassOk = true;
        if (!pass) {
            secretPassOk = false;
            tooltipMessages.push("Secret text is required.");
        } else if (pass.length > APP_CONFIG.MAX_PASSWORD_LENGTH) { // Assuming APP_CONFIG.MAX_PASSWORD_LENGTH is defined
            secretPassOk = false;
            if (genConfirmPasswordError) { // Assuming you might want to show this near password field
                genConfirmPasswordError.textContent = `Secret exceeds ${APP_CONFIG.MAX_PASSWORD_LENGTH} chars.`;
                genConfirmPasswordError.classList.remove('hidden');
            }
            tooltipMessages.push(`Secret too long (max ${APP_CONFIG.MAX_PASSWORD_LENGTH}).`);
        } else if (pass !== conf) {
            secretPassOk = false;
            if (conf.length > 0) {
                if (genConfirmPasswordError) {
                    genConfirmPasswordError.textContent = safeTranslate('generate.secret_error_match', 'Secret text does not match.');
                    genConfirmPasswordError.classList.remove('hidden');
                }
                tooltipMessages.push("Secret text does not match.");
            } else {
                tooltipMessages.push("Please confirm secret text.");
            }
        }
        
        // Secondary empty logic bypassed natively


        // N and K Validation
        const nOk = !isNaN(nVal) && nVal >= 1 && nVal <= APP_CONFIG.MAX_SHARES_ALLOWED;
        const kOk = !isNaN(kVal) && kVal >= 1 && kVal <= APP_CONFIG.MAX_SHARES_ALLOWED;
        const kLessN = nOk && kOk && kVal <= nVal; // k <= n check

        if (!nOk && genNInput.value.trim() !== '') { // Show error if N has a value but it's invalid
            if (genNError) {
                genNError.textContent = i18n.t('generate.n_error_range') || `Total Shares (N) must be a number between 1 and ${APP_CONFIG.MAX_SHARES_ALLOWED}.`;
                genNError.classList.remove('hidden');
            }
            tooltipMessages.push(`N must be 1-${APP_CONFIG.MAX_SHARES_ALLOWED}.`);
        }
        if (!nOk && genNInput.value.trim() === '') { // N is required, add to tooltip if empty
            tooltipMessages.push("Total Shares (N) is required.");
        }


        if (!kOk && genKInput.value.trim() !== '') { // Show error if K has a value but it's invalid (range)
            if (genKError) {
                genKError.textContent = i18n.t('generate.k_error_range') || `Min. Shares (K) must be a number between 1 and ${APP_CONFIG.MAX_SHARES_ALLOWED}.`;
                genKError.classList.remove('hidden');
            }
            tooltipMessages.push(`K must be 1-${APP_CONFIG.MAX_SHARES_ALLOWED}.`);
        }
        if (!kOk && genKInput.value.trim() === '') { // K is required
            tooltipMessages.push("Min. Shares (K) is required.");
        }


        if (nOk && kOk && !kLessN) { // Only show K > N error if N and K are individually valid numbers
            if (genKError) {
                genKError.textContent = i18n.t('generate.k_error_greater') || "Min. Shares (K) cannot be greater than Total Shares (N).";
                genKError.classList.remove('hidden'); // This might override the previous K error, which is fine
            }
            tooltipMessages.push("K cannot exceed N.");
        }

        // Encryption Password Validation
        let encryptKeyOk = true;
        if (encryptKey) { // An encryption password is being attempted
            if (encryptKey.length > APP_CONFIG.MAX_ENCRYPTION_PASSWORD_LENGTH) {
                encryptKeyOk = false;
                if (genConfirmEncryptKeyError) { // Re-using confirm field for this error for now
                    genConfirmEncryptKeyError.textContent = `Encryption password exceeds ${APP_CONFIG.MAX_ENCRYPTION_PASSWORD_LENGTH} chars.`;
                    genConfirmEncryptKeyError.classList.remove('hidden');
                }
                tooltipMessages.push("Encryption password too long.");
            } else if (encryptKey !== confirmEncryptKey) {
                encryptKeyOk = false;
                if (confirmEncryptKey.length > 0) {
                    if (genConfirmEncryptKeyError) {
                        genConfirmEncryptKeyError.textContent = i18n.t('generate.password_error_match') || 'Encryption passwords do not match.';
                        genConfirmEncryptKeyError.classList.remove('hidden');
                    }
                    tooltipMessages.push("Encryption passwords do not match.");
                } else {
                    tooltipMessages.push("Please confirm encryption password.");
                }
            }
            // The secondary empty logic check is subsumed above organically
        } else if (confirmEncryptKey) { // Only confirm is filled
            encryptKeyOk = false;
            if (genConfirmEncryptKeyError) {
                genConfirmEncryptKeyError.textContent = 'Main encryption password is required if confirming.';
                genConfirmEncryptKeyError.classList.remove('hidden');
            }
            tooltipMessages.push("Main encryption password is required.");
        }
        // Removed redundant 'else' for genConfirmEncryptKeyError.classList.add('hidden') as it's reset above

        // Determine overall form validity
        isFormValid = secretPassOk && nOk && kOk && kLessN && encryptKeyOk;
        genSubmitButton.disabled = !isFormValid;

        // Update tooltip for generate button
        if (!isFormValid && tooltipMessages.length > 0) {
            genSubmitButton.title = tooltipMessages.join(' ');
        } else if (isFormValid) {
            genSubmitButton.title = 'Generate Shares';
        } else {
            genSubmitButton.title = "Please fill all required fields correctly."; // Default fallback
        }

                  // Dynamic Security Warnings (K=1, K=N)
          if (kNote && !isNaN(kVal) && !isNaN(nVal)) {
              let showsWarning = false;
              if (kVal === 1) {
                  kNote.textContent = safeTranslate('generate.warning_k_equals_1', 'Warning: K is 1. Anyone who finds ANY single share can read your secret! This offers zero structural security.');
                  kNote.setAttribute('data-i18n', 'generate.warning_k_equals_1');
                  showsWarning = true;
              } else if (kVal > 1 && kVal === nVal) {
                  kNote.textContent = safeTranslate('generate.warning_k_equals_n', 'Warning: K equals N. If you lose even ONE share, your secret is lost forever! This provides no redundancy.');
                  kNote.setAttribute('data-i18n', 'generate.warning_k_equals_n');
                  showsWarning = true;
              }
              
              if (showsWarning && (!genKError || genKError.classList.contains('hidden'))) {
                  kNote.classList.remove('hidden');
              } else {
                  kNote.classList.add('hidden');
              }
          }
    };

export function resetReconstructionButtonState() {
        if (reconSubmitButton && reconSubmitButton.querySelector('.button-text')) {
            reconSubmitButton.querySelector('.button-text').innerHTML = '&nbsp;' + (i18n.t('reconstruct.submit_btn') || 'Reconstruct Secret');
        }
            // Clearing should be intentional when starting a new operation.

        // Reset password display to hidden state
        if (reconPasswordSpan) {
            reconPasswordSpan.textContent = '••••••••••••••••••••';
            reconPasswordSpan.classList.add('italic', 'text-slate-500', 'dark:text-slate-400', 'cursor-pointer');
        }
        if (revealSecretButton) revealSecretButton.classList.remove('hidden'); // Ensure reveal button is visible for next time
        // It's also good to hide the result/error divs when resetting for a new input
        if (reconResultDiv) reconResultDiv.classList.add('hidden');
        if (reconErrorDiv) reconErrorDiv.classList.add('hidden');
    }

export const getProgress = (provider, action, current, total, state = 'idle', customMsg = '') => {
    const i18nSafe = (key, params = {}) => {
        const fallbacks = {
            'progress.nfc_read_first': "Please present your first NFC card (any order).",
            'progress.nfc_read_next': "Please present NFC card {c}. ({t} total required)",
            'progress.nfc_read_next_unknown': "Please present next NFC card...",
            'progress.nfc_write_next': "Please tap a blank NFC tag to write Card {c} of {t}...",
            'progress.qr_read_first': "Ready. Scan your first QR code share.",
            'progress.qr_read_next': "Share accepted. Please scan QR Code {c} ({t} total required).",
            'progress.qr_read_next_unknown': "Share accepted. Please scan next QR Code...",
            'progress.read_done': "Threshold reached! Processing secret...",
            'progress.error_io': "IO Error: {msg}. Please try again."
        };
        
        const replaceParams = (str) => {
            if (!str) return '';
            return str.replace('{c}', params.c || current)
                      .replace('{t}', params.t || total)
                      .replace('{msg}', params.msg || customMsg);
        };

        if (!i18n || !i18n.t) {
            return replaceParams(fallbacks[key] || '');
        }
        
        return replaceParams(i18n.t(key) || fallbacks[key] || '');
    };

    let result = {
        countText: `${current}/${total}`,
        instructionText: '',
        isFinished: false,
        isError: state === 'error',
        rawCurrent: current,
        rawTotal: total
    };

    if (state === 'error') {
        result.instructionText = i18nSafe('progress.error_io', {msg: customMsg});
        return result;
    }

    if (state === 'done') {
        result.isFinished = true;
        result.instructionText = i18nSafe('progress.read_done');
        return result;
    }

    if (action === 'read') {
        if (provider === 'nfc') {
            if (current === 0) {
                result.instructionText = i18nSafe('progress.nfc_read_first');
            } else if (total === '?') {
                result.instructionText = i18nSafe('progress.nfc_read_next_unknown');
            } else {
                result.instructionText = i18nSafe('progress.nfc_read_next', {c: current + 1, t: total});
            }
        } else if (provider === 'qr') {
            if (current === 0) {
                result.instructionText = i18nSafe('progress.qr_read_first');
            } else if (total === '?') {
                result.instructionText = i18nSafe('progress.qr_read_next_unknown');
            } else {
                result.instructionText = i18nSafe('progress.qr_read_next', {c: current + 1, t: total});
            }
        }
    } else if (action === 'write') {
        if (provider === 'nfc') {
            result.instructionText = i18nSafe('progress.nfc_write_next', {c: current + 1, t: total});
        }
    }

    return result;
};
export const prepareAndShowScannerModal = (purpose) => {
    const qrScannerModal = document.getElementById('qrScannerModal');
    const qrScannerModalTitle = document.getElementById('qrScannerModalTitle');


    const qrScannerModalStopButtonText = document.getElementById('qrScannerModalStopButtonText');
    const qrScannerModalStopIcon = document.getElementById('qrScannerModalStopIcon');
    const qrScannerModalCloseIcon = document.getElementById('qrScannerModalCloseIcon');
    const originalQrScannerContainer = document.getElementById('qr-scanner-container');
    const reconEncryptKeyInput = document.getElementById('recon-encrypt-key');
    const reconstructMenuGrid = document.getElementById('reconstruct-menu-grid');

    if (reconstructMenuGrid && purpose === 'reconstruct') {
        reconstructMenuGrid.classList.add('hidden');
    }

    qrScannerModal.classList.remove('hidden');

    if (purpose === 'reconstruct') {
        qrScannerModalTitle.textContent = safeTranslate('scanner.title', 'Scan Shares for Reconstruction');
        if (reconEncryptKeyInput) reconEncryptKeyInput.value = '';
    } else if (purpose === 'inspect') {
        qrScannerModalTitle.textContent = safeTranslate('scanner.title', 'Scan Share for Inspection');
    }

    const qrStatusText = document.getElementById('qrScannerModalStatusText');
    const qrStatusIcon = document.getElementById('qrScannerModalStatusIcon');
    if (qrStatusText) {
        qrStatusText.textContent = 'Initializing Camera...';
        qrStatusText.className = 'text-sm text-gray-300';
    }
    if (qrStatusIcon) {
        qrStatusIcon.className = 'shrink-0 text-gray-400';
        qrStatusIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
    }

    qrScannerModalStopButtonText.textContent = safeTranslate('scanner.stop_btn', 'Stop Scanning');
    qrScannerModalStopIcon.classList.remove('hidden');
    qrScannerModalCloseIcon.classList.add('hidden');

    if (originalQrScannerContainer) {
        originalQrScannerContainer.style.display = 'none';
    }
};






// --- Sound Functions ---
const playScheduledTone = (ctx, frequency, type, startTime, duration, volume = 0.2) => {
    if (!ctx || ctx.state === 'closed') return;
    try {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, startTime);

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01);
        gainNode.gain.setValueAtTime(volume, Math.max(startTime + duration - 0.05, startTime + 0.01));
        gainNode.gain.linearRampToValueAtTime(0.0001, startTime + duration);

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.start(startTime);
        oscillator.stop(startTime + duration);

        oscillator.onended = () => {
            gainNode.disconnect();
            oscillator.disconnect();
        };
    } catch (e) { logger.warn('Audio scheduler err:', e.message); }
};

export const playPasswordPromptSound = () => {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (!ctx) return;
        const now = ctx.currentTime;
        const gap = 0.04;    // 40ms gap
        const vol = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GLOBAL_AUDIO_VOLUME : 0.5;

        // First tone (higher, shorter)
        playScheduledTone(ctx, 783.99, 'sine', now, 0.10, vol); // G5, 100ms

        // Second tone (lower, longer)
        playScheduledTone(ctx, 523.25, 'sine', now + 0.10 + gap, 0.15, vol); // C5, 150ms
    } catch (e) {
        logger.warn(`AudioContext error (playPasswordPromptSound): ${e.message}`);
    }
};

export const playSuccessSound = () => {
    if (!isSoundEnabled.get()) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (!ctx) return;
        const now = ctx.currentTime;
        
        playScheduledTone(ctx, 523.25, 'sine', now, 0.15, typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GLOBAL_AUDIO_VOLUME : 0.5);
        playScheduledTone(ctx, 783.99, 'sine', now + 0.18, 0.10, typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GLOBAL_AUDIO_VOLUME : 0.5);
    } catch (e) {
        logger.warn(`AudioContext error (playSuccessSound): ${e.message}`);
    }
};

export const playBeep = () => {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (!ctx) return;
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain(); 
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, ctx.currentTime); 
        gainNode.gain.setValueAtTime(0, ctx.currentTime); 
        gainNode.gain.linearRampToValueAtTime(typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GLOBAL_AUDIO_VOLUME : 0.5, ctx.currentTime + 0.005); 
        oscillator.connect(gainNode); 
        gainNode.connect(ctx.destination); 
        oscillator.start();
        gainNode.gain.setValueAtTime(typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GLOBAL_AUDIO_VOLUME : 0.5, ctx.currentTime + 0.09); 
        gainNode.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.1); 
        oscillator.stop(ctx.currentTime + 0.1); 
        oscillator.onended = () => { gainNode.disconnect(); oscillator.disconnect(); };
    } catch (e) {
        logger.warn(`AudioContext error (playBeep): ${e.message}`);
    }
};

/**
 * Centralized haptic feedback engine.
 * Checks Settings toggle + navigator.vibrate availability.
 * @param {'success'|'error'|'duplicate'} type
 */
export const triggerHaptic = (type) => {
    if (localStorage.getItem('hapticEnabled') === 'false') return;
    if (!navigator.vibrate) return;
    switch (type) {
        case 'success':
            navigator.vibrate([50]); // Single short tap
            break;
        case 'error':
        case 'duplicate':
            navigator.vibrate([50, 100, 50]); // Double tap
            break;
        default:
            navigator.vibrate([50]);
    }
};
