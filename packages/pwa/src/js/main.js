/** 
* Copyright 2026 Craig Bailey
* Repository: https://github.com/MidnightLogic/PieceKeeper
*
* Licensed under the Apache License, Version 2.0
* SPDX-License-Identifier: Apache-2.0
*/

import {EXPORT_MODE, RECONSTRUCT_MODE, AppEvents, isSoundEnabled, isTesting, currentReconMode, isScanning, isScanningForInspect, currentScanningPurpose, nfcAbortController, currentNfcPurpose, reconstructionPasswordCallback, lastInspectedShareForPasswordPrompt, firstScannedShareEncryptedStatus, isProcessingSuccessfulReconstruction, currentReconstructionFamilyId, isFamilyMismatchFeedbackCooldown, isGenSharesDelegationAttached, githubQrDataUrl, reconstructionPassword, passwordPromptContext, pendingInspectShareString, scannedRawSharesSet, requiredK, sharePendingKDetermination, sharePendingKDeterminationNfc, sharePendingKDeterminationManual, reconstructedSecretData, currentGeneratedShares, lastGeneratedN, lastGeneratedK, qrScannerInstance, isAutoClearingForm, activeEngineAbortController, resetReconstructionState} from './store.js';
import { playBeep, triggerHaptic, playSuccessSound, playPasswordPromptSound } from './ui.js';
import { splitSecret, reconstructSecret, decryptBytes } from './cryptoBridge.js';
import { inspectShare, base64ToBytes, setLogger as setCoreLogger, PasswordRequiredError, InsufficientSharesError, IntegrityCheckError, WrongPasswordError, SetMismatchError, PieceKeeperError } from '@midnightlogic/piecekeeper-crypto';

import { safeTranslate } from './utils.js';
import { buildShareCardHTML, renderGeneratedSharesToUI, resetReconstructionButtonState, displayShareInspectionDetails, validateGenForm, updateNKWarning, prepareAndShowScannerModal, clearReconstructSelection, flashCardError } from './ui.js';
import { startNfcMintingFlow, startNfcScannerFlow, startQRScanner, requestNfcPermission, stopQRScanner, hideQrModal, hideNfcModal, suspendNfcModal, resumeNfcModal, showPasswordPrompt, hidePasswordPrompt, toggleCameraTorch } from './hardware.js';
import { i18n } from './i18n.js';
import { copyToClipboard, flashButton, toggleButtonLoading, updateRtlDirection, setPasswordVisibility, enableSwipeToDismiss } from './utils.js';

import { logger } from './logger.js';


import QRCode from 'qrcode';
import { createIcons, icons } from 'lucide';
import { APP_CONFIG } from './config.js';
import { pieceKeeperTests } from './tests.js';
import '@khmyznikov/pwa-install';

// Inject PWA logger into core module so crypto operations log to UI
setCoreLogger(logger);


i18n.applyTranslations();

// --- Scroll Lock Utility ---
const lockScroll = () => { document.body.style.overflow = 'hidden'; };
const unlockScroll = () => { document.body.style.overflow = ''; };

document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'pwa-override-btn') {
        localStorage.removeItem('pwaInstalled');
        window.location.reload();
    }
});


// Secure App Hardware Forwarding Logic (Browser Lockout)
setTimeout(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (localStorage.getItem('pwaInstalled') === 'true' && !isStandalone) {
        document.body.innerHTML = `
            <div class="fixed inset-0 bg-slate-900 z-[9999] flex flex-col items-center justify-center p-6 text-center">
                <div class="bg-slate-800 rounded-3xl p-8 max-w-md shadow-2xl border border-slate-700">
                    <div class="w-16 h-16 bg-green-500/20 text-green-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    </div>
                    <h2 class="text-2xl font-bold text-white mb-2">PieceKeeper is Installed</h2>
                    <p class="text-slate-400 text-sm mb-6">For maximum security and offline isolation, please close this browser tab and launch the PieceKeeper app directly from your device's home screen.</p>
                    <button id="pwa-override-btn" class="text-xs text-slate-500 hover:text-slate-300 underline mt-4 transition-colors">I uninstalled it, let me back in.</button>
                </div>
            </div>
        `;
    }
}, 500);

// Wait for the DOM and libraries to be ready
let preparePrintableShareHTML;
document.addEventListener('DOMContentLoaded', () => {

    // Inject dynamic app version from package.json (build-time constant via Vite define)
    document.querySelectorAll('.app-version-label').forEach(el => {
        el.textContent = 'v' + (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?.?.?');
    });

    const toggles = document.querySelectorAll('.password-toggle');
    toggles.forEach(btn => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;

        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            setPasswordVisibility(targetId, btn, true);
        });

        const hide = (e) => {
            e.preventDefault();
            setPasswordVisibility(targetId, btn, false);
        };

        btn.addEventListener('pointerup', hide);
        btn.addEventListener('pointerleave', hide);
        btn.addEventListener('pointercancel', hide);
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // Camera permission is checked on-demand when user clicks the QR card.
    // No eager media API calls on load.

    // --- Auto Language Toggle Logic ---
    const autoLangToggle = document.getElementById('auto-lang-toggle-switch');
    const languageSelect = document.getElementById('language-select');

    if (autoLangToggle) {
        // Sync toggle state (Default to ON if null)
        const isAuto = localStorage.getItem('autoLang') !== 'false';
        autoLangToggle.checked = isAuto;
        if (languageSelect) languageSelect.disabled = isAuto;

        autoLangToggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            localStorage.setItem('autoLang', isChecked ? 'true' : 'false');
            if (languageSelect) languageSelect.disabled = isChecked;

            if (isChecked) {
                // Fall back and compute OS native immediately
                if (typeof navigator !== 'undefined' && navigator.language) {
                    const browserLang = navigator.language.split('-')[0].toLowerCase();
                    if (i18n && i18n.setLanguage) {
                        // Try forcing the language
                        const isSupported = i18n.setLanguage(browserLang);
                        if (!isSupported) i18n.setLanguage('en');
                    }
                }
            } else {
                // Unlocked manual. Retain the current select layout.
                if (languageSelect && i18n) i18n.setLanguage(languageSelect.value);
            }
        });
    }

    // PWA Install Button Handler
    const pwaInstallBtn = document.getElementById('pwa-install-btn');

    // --- PWA Install State Detection ---
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (isStandalone) {
        // Hide the entire install section — user already has the app
        const pwaSection = document.getElementById('pwa-settings-section');
        if (pwaSection) pwaSection.classList.add('hidden');
        logger.info('[PWA] App is already installed (standalone mode). Install section hidden.');
    }
    if (isStandalone && pwaInstallBtn) {
        const btnSpan = pwaInstallBtn.querySelector('span[data-i18n]');
        if (btnSpan) btnSpan.textContent = safeTranslate('settings.installed_label', 'Installed');
        pwaInstallBtn.disabled = true;
        pwaInstallBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700', 'hover:-translate-y-0.5', 'active:scale-95');
        pwaInstallBtn.classList.add('bg-slate-400', 'dark:bg-slate-600', 'opacity-60', 'cursor-not-allowed');
        // Replace download icon with check
        const svgEl = pwaInstallBtn.querySelector('svg');
        if (svgEl) svgEl.outerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-white"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>';
    }
    if (pwaInstallBtn) {
        pwaInstallBtn.addEventListener('click', () => {
            const pwaInstaller = document.getElementById('pwa-installer');
            if (pwaInstaller) pwaInstaller.showDialog(true);
        });
    }

    const pwaInstaller = document.getElementById('pwa-installer');
    if (pwaInstaller) {
        pwaInstaller.addEventListener('pwa-install-success-event', () => {
            localStorage.setItem('pwaInstalled', 'true');
        });
    }

    githubQrDataUrl.set('');
    try {
        QRCode.toDataURL("https://github.com/MidnightLogic/PieceKeeper", { width: 100, margin: 1, errorCorrectionLevel: 'Q' }, function (err, url) {
            if (!err) githubQrDataUrl.set(url);
        });
    } catch (e) { }

    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.value = i18n.currentLanguage;
        langSelect.addEventListener('change', (e) => {
            localStorage.removeItem('rtl_override'); // Flush sticky manual overrides so auto-detection bounds free
            i18n.setLanguage(e.target.value);
            updateRtlDirection(e.target.value);
        });
    }


    // --- Global State ---


    let logs = []; // Array to store log messages for the UI
    //let scannedSharesMap = new Map(); // Map to store scanned shares { index => shareBase64 }


    // soundEnabled moved to State // Default, will be loaded from localStorage

    // --- UI Element References ---
    // Get references to all necessary DOM elements for manipulation
    const genPasswordInput = document.getElementById('gen-password');
    const genConfirmPasswordInput = document.getElementById('gen-confirm-password');
    const genCommentInput = document.getElementById('gen-comment');
    const genNInput = document.getElementById('gen-n');


    const genKInput = document.getElementById('gen-k');
    genNInput.addEventListener('input', updateNKWarning);
    genKInput.addEventListener('input', updateNKWarning);

    const genEncryptKeyInput = document.getElementById('gen-encrypt-key');
    const genConfirmEncryptKeyInput = document.getElementById('gen-confirm-encrypt-key');
    const genSubmitButton = document.getElementById('gen-submit');
    const genErrorDiv = document.getElementById('gen-error');
    const genResultDiv = document.getElementById('gen-result');
    const genSharesDiv = document.getElementById('gen-shares');
    const reconSharesTextarea = document.getElementById('recon-shares');
    const reconFileInput = document.getElementById('recon-file');
    const inspectShareInput = document.getElementById('inspect-share-input');
    const inspectSubmitButton = document.getElementById('inspect-submit-btn');
    const inspectMethodPasteBtn = document.getElementById('inspect-method-paste-btn');
    const inspectMethodScanBtn = document.getElementById('inspect-method-scan-btn');
    const inspectResultDiv = document.getElementById('inspect-result');
    const inspectPasteArea = document.getElementById('inspect-paste-area');
    const inspectQrStatus = document.getElementById('inspect-qr-status');
    const reconEncryptKeyInput = document.getElementById('recon-encrypt-key');
    const reconSubmitButton = document.getElementById('recon-submit');
    const reconResultDiv = document.getElementById('recon-result');
    const reconPasswordSpan = document.getElementById('recon-password');
    const reconNoteSpan = document.getElementById('recon-note');
    const reconDateSpan = document.getElementById('recon-date');
    const copySecretButton = document.getElementById('copy-secret-btn');
    const copySecretText = document.getElementById('copy-secret-text');
    const secretEyeIcon = document.getElementById('recon-secret-eye');
    const secretPill = document.getElementById('recon-secret-pill');
    const pasteSharesStatusDiv = document.getElementById('paste-shares-status');
    const testSubmitButton = document.getElementById('test-submit');
    const testResultDiv = document.getElementById('test-result');
    const testLogsOutput = document.getElementById('test-logs-output');
    const testFinalBanner = document.getElementById('test-final-banner');
    const testDoneBtn = document.getElementById('test-done-btn');
    const qrModal = document.getElementById('qrModal');
    const qrCodeDiv = document.getElementById('qr-code');
    const qrModalCloseButton = document.getElementById('qr-modal-close');
    const toastContainer = document.getElementById('toast-container');


    const themeToggleSwitch = document.getElementById('theme-toggle-switch');
    const rtlToggleSwitch = document.getElementById('rtl-toggle-switch');


    if (rtlToggleSwitch) {
        rtlToggleSwitch.addEventListener('change', (e) => {
            localStorage.setItem('rtl_override', e.target.checked);
            updateRtlDirection(typeof langSelect !== 'undefined' && langSelect ? langSelect.value : 'en');
        });
    }

    // Call it immediately on load
    updateRtlDirection(localStorage.getItem('language') || 'en');

    const cryptoSchemaSelect = document.getElementById('crypto-schema-select');
    const cryptoSchemaStats = document.getElementById('crypto-schema-stats');


    const updateCryptoStatsUI = () => {
        if (!cryptoSchemaSelect || !cryptoSchemaStats) return;
        const schema = APP_CONFIG.CRYPTO_SCHEMAS[cryptoSchemaSelect.value];
        if (!schema) return;

        const kdfStr = safeTranslate('settings.label_kdf_engine', 'Key Derivation (KDF)');
        const itersStr = safeTranslate('settings.schema_iters', 'Iterations:');
        const cipherStr = safeTranslate('settings.schema_cipher', 'Cipher:');
        const hashStr = safeTranslate('settings.schema_hash', 'Hash:');
        const passesStr = safeTranslate('settings.schema_passes', 'Passes:');
        const threadsStr = safeTranslate('settings.schema_threads', 'Threads:');
        const blockSizeStr = safeTranslate('settings.schema_block_size', 'Block Size (r):');
        const memoryStr = safeTranslate('settings.schema_memory', 'RAM');

        let statsHtml = '';
        if (schema.kdf_algorithm === 'Argon2id') {
            statsHtml = `${kdfStr}: Argon2id (${schema.memory_cost}KB ${memoryStr})\n${passesStr} ${schema.time_cost} | ${threadsStr} ${schema.parallelism || 1}`;
        } else if (schema.kdf_algorithm === 'scrypt') {
            statsHtml = `${kdfStr}: scrypt (N=${schema.cpu_memory_cost})\n${blockSizeStr} ${schema.block_size}`;
        } else {
            statsHtml = `${kdfStr}: PBKDF2\n${itersStr} ${schema.pbkdf2_iterations ? schema.pbkdf2_iterations.toLocaleString() : 'Unknown'}\n${hashStr} ${schema.pbkdf2_hash || 'Unknown'}`;
        }

        cryptoSchemaStats.innerHTML = `${statsHtml}\n${cipherStr} ${schema.aes_algorithm || 'AES-GCM'} (${schema.aes_key_length || 256}-bit, ${schema.salt_bytes || 16}B Salt)`;

        const descSpan = document.getElementById('crypto-schema-desc-span');
        if (descSpan && schema.desc_key) {
            descSpan.dataset.i18n = schema.desc_key;
            descSpan.innerHTML = safeTranslate(schema.desc_key, schema.desc_key);
        }
    };

    if (cryptoSchemaSelect) {
        // Build options automatically based on config.js array loop
        cryptoSchemaSelect.innerHTML = Object.entries(APP_CONFIG.CRYPTO_SCHEMAS).map(([key, schema]) => {
            return `<option value="${key}" data-i18n="${schema.label_key}">${i18n.t ? i18n.t(schema.label_key) || schema.label_key : schema.label_key}</option>`;
        }).join('');

        // PWA-local: localStorage key for persisted schema preference (decoupled from core module)
        const SCHEMA_STORAGE_KEY = 'cryptoSchemaVersion';

        cryptoSchemaSelect.value = localStorage.getItem(SCHEMA_STORAGE_KEY) || APP_CONFIG.DEFAULT_SCHEMA;

        // Ensure values are seeded statically on DOM boot if cache is null
        if (!localStorage.getItem(SCHEMA_STORAGE_KEY)) {
            localStorage.setItem(SCHEMA_STORAGE_KEY, cryptoSchemaSelect.value);
        }

        if (!localStorage.getItem('pdf_export_mode')) {
            const tempPdfBtn = document.getElementById('pdf-export-mode');
            if (tempPdfBtn) localStorage.setItem('pdf_export_mode', tempPdfBtn.value);
        }
        updateCryptoStatsUI();

        cryptoSchemaSelect.addEventListener('change', (e) => {
            localStorage.setItem(SCHEMA_STORAGE_KEY, e.target.value);
            updateCryptoStatsUI();
        });

        // Rebuild stats on language change to catch dynamic translations
        if (typeof i18n !== 'undefined') {
            const originApply = i18n.applyTranslations;
            i18n.applyTranslations = function () {
                originApply.call(i18n);
                setTimeout(updateCryptoStatsUI, 50);
            }
        }
    }

    const soundToggleSwitch = document.getElementById('sound-toggle-switch');
    const logsToggleSwitch = document.getElementById('logs-toggle-switch');
    const logsContainerWrapper = document.getElementById('logs-container-wrapper');
    const downloadCsvTemplateLink = document.getElementById('download-csv-template');

    // --- Logger UI Panel Binding ---
    logger.bindToPanel('logs');

    if (logsToggleSwitch && logsContainerWrapper) {
        const savedLogsPref = localStorage.getItem('logsEnabled');
        if (savedLogsPref === 'true') {
            logsToggleSwitch.checked = true;
            logsContainerWrapper.classList.remove('hidden');
        }

        logsToggleSwitch.addEventListener('change', () => {
            if (logsToggleSwitch.checked) {
                logsContainerWrapper.classList.remove('hidden');
                localStorage.setItem('logsEnabled', 'true');
            } else {
                logsContainerWrapper.classList.add('hidden');
                localStorage.setItem('logsEnabled', 'false');
            }
        });
    }


    // --- UI Element References for New QR Modal (Add these) ---
    const qrScannerModal = document.getElementById('qrScannerModal');
    const qrScannerModalTitle = document.getElementById('qrScannerModalTitle');
    const closeQrScannerModalButton = document.getElementById('closeQrScannerModal'); // For the 'X' button
    const qrScannerModalVideoPreview = document.getElementById('qrScannerModalVideoPreview');
    const qrScannerModalStatus = document.getElementById('qrScannerModalStatus');

    const stopQrScannerModalButton = document.getElementById('stopQrScannerModalButton');
    const qrScannerModalStopButtonText = document.getElementById('qrScannerModalStopButtonText');
    const qrScannerModalStopIcon = document.getElementById('qrScannerModalStopIcon');
    const qrScannerModalCloseIcon = document.getElementById('qrScannerModalCloseIcon');
    const genConfirmPasswordError = document.getElementById('gen-confirm-password-error');
    const genConfirmEncryptKeyError = document.getElementById('gen-confirm-encrypt-key-error');
    const genClearFormButton = document.getElementById('gen-clear-form-button');
    const genPasswordCharCount = document.getElementById('gen-password-char-count');
    const genCommentCharCount = document.getElementById('gen-comment-char-count');
    const genEncryptStrengthContainer = document.getElementById('gen-encrypt-strength-container');
    const genEncryptStrengthBar = document.getElementById('gen-encrypt-strength-bar');
    const genEncryptStrengthText = document.getElementById('gen-encrypt-strength-text');
    const reconClearPasteButton = document.getElementById('recon-clear-paste-button');
    const inspectClearInputButton = document.getElementById('inspect-clear-input-button');
    const genNError = document.getElementById('gen-n-error');
    const genKError = document.getElementById('gen-k-error');


    // Reference to the old QR scanner container (to hide it if it was visible)
    const originalQrScannerContainer = document.getElementById('qr-scanner-container');


    const tabButtonsContainer = document.getElementById('tab-buttons');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const reconModeOptions = document.querySelectorAll('.recon-option');
    const reconModeDivs = document.querySelectorAll('.recon-mode');

    // --- Inspect Bottom Sheet ---
    const inspectBackdrop = document.getElementById('inspect-backdrop');
    const inspectBottomSheet = document.getElementById('inspect-bottom-sheet');
    const inspectOptionsGrid = document.getElementById('inspect-options-grid');
    // inspectPasteArea already declared above (L325)
    const inspectResultDiv_sheet = document.getElementById('inspect-result');
    const isMdBreakpoint = () => window.matchMedia('(min-width: 768px)').matches;

    function openInspectSheet(subView) {
        if (!inspectBottomSheet || !inspectBackdrop) return;
        subView = subView || 'options';
        // Show correct sub-view
        if (inspectOptionsGrid) inspectOptionsGrid.classList.toggle('hidden', subView !== 'options');
        if (inspectPasteArea) inspectPasteArea.classList.toggle('hidden', subView !== 'paste');

        // Remove hidden first
        inspectBackdrop.classList.remove('hidden');
        inspectBottomSheet.classList.remove('hidden');

        requestAnimationFrame(() => {
            inspectBackdrop.classList.remove('opacity-0');
            inspectBackdrop.classList.add('opacity-100');
            inspectBottomSheet.classList.remove('translate-y-full');
            inspectBottomSheet.classList.add('translate-y-0');
        });
        lockScroll();
    }

    function closeInspectSheet() {
        if (!inspectBottomSheet || !inspectBackdrop) return;
        inspectBackdrop.classList.remove('opacity-100');
        inspectBackdrop.classList.add('opacity-0');
        inspectBottomSheet.classList.remove('translate-y-0');
        inspectBottomSheet.classList.add('translate-y-full');

        setTimeout(() => {
            inspectBottomSheet.classList.add('hidden');
            inspectBackdrop.classList.add('hidden');
        }, 300);
        unlockScroll();
        clearReconstructSelection();
    }

    // --- Generate Result Sheet ---
    const genResultBackdrop = document.getElementById('gen-result-backdrop');
    const genResultSheet = document.getElementById('gen-result-sheet');

    function openGenResultSheet() {
        if (!genResultSheet || !genResultBackdrop) return;
        genResultBackdrop.classList.remove('hidden');
        genResultSheet.classList.remove('hidden');

        requestAnimationFrame(() => {
            genResultBackdrop.classList.remove('opacity-0');
            genResultBackdrop.classList.add('opacity-100');
            genResultSheet.classList.remove('translate-y-full');
            genResultSheet.classList.add('translate-y-0');
        });
        lockScroll();
    }

    function closeGenResultSheet() {
        if (!genResultSheet || !genResultBackdrop) return;
        genResultBackdrop.classList.remove('opacity-100');
        genResultBackdrop.classList.add('opacity-0');
        genResultSheet.classList.remove('translate-y-0');
        genResultSheet.classList.add('translate-y-full');

        setTimeout(() => {
            genResultSheet.classList.add('hidden');
            genResultBackdrop.classList.add('hidden');
        }, 300);
        unlockScroll();
    }

    // Wire gen-result-sheet dismissal
    const genResultSheetClose = document.getElementById('gen-result-sheet-close');
    if (genResultSheetClose) genResultSheetClose.addEventListener('click', closeGenResultSheet);
    if (genResultBackdrop) genResultBackdrop.addEventListener('click', closeGenResultSheet);

    // --- Manual Entry Sheet ---
    const manualEntryBackdrop = document.getElementById('manual-entry-backdrop');
    const manualEntrySheet = document.getElementById('manual-entry-sheet');

    function openManualEntrySheet() {
        if (!manualEntrySheet || !manualEntryBackdrop) return;
        manualEntryBackdrop.classList.remove('hidden');
        manualEntrySheet.classList.remove('hidden');

        requestAnimationFrame(() => {
            manualEntryBackdrop.classList.remove('opacity-0');
            manualEntryBackdrop.classList.add('opacity-100');
            manualEntrySheet.classList.remove('translate-y-full');
            manualEntrySheet.classList.add('translate-y-0');
        });
        lockScroll();
    }

    function closeManualEntrySheet() {
        if (!manualEntrySheet || !manualEntryBackdrop) return;
        manualEntryBackdrop.classList.remove('opacity-100');
        manualEntryBackdrop.classList.add('opacity-0');
        manualEntrySheet.classList.remove('translate-y-0');
        manualEntrySheet.classList.add('translate-y-full');

        setTimeout(() => {
            manualEntrySheet.classList.add('hidden');
            manualEntryBackdrop.classList.add('hidden');
        }, 300);
        unlockScroll();
        clearReconstructSelection();
    }

    // Wire Manual Entry sheet dismissal
    const manualEntrySheetClose = document.getElementById('manual-entry-sheet-close');
    if (manualEntrySheetClose) manualEntrySheetClose.addEventListener('click', closeManualEntrySheet);
    if (manualEntryBackdrop) manualEntryBackdrop.addEventListener('click', closeManualEntrySheet);

    // Wire Manual Entry sheet buttons to switch recon modes
    const manualEntryCsvBtn = document.getElementById('manual-entry-csv-btn');
    const manualEntryPasteBtn = document.getElementById('manual-entry-paste-btn');

    // --- Reconstruct CSV Sheet ---
    const reconCsvBackdrop = document.getElementById('recon-csv-backdrop');
    const reconCsvSheet = document.getElementById('recon-csv-sheet');

    function openReconCsvSheet() {
        if (!reconCsvSheet || !reconCsvBackdrop) return;
        resetReconstructionState();

        reconCsvBackdrop.classList.remove('hidden');
        reconCsvSheet.classList.remove('hidden');
        requestAnimationFrame(() => {
            reconCsvBackdrop.classList.remove('opacity-0');
            reconCsvBackdrop.classList.add('opacity-100');
            reconCsvSheet.classList.remove('translate-y-full');
            reconCsvSheet.classList.add('translate-y-0');
        });
        lockScroll();
    }

    function closeReconCsvSheet() {
        if (!reconCsvSheet || !reconCsvBackdrop) return;
        reconCsvBackdrop.classList.remove('opacity-100');
        reconCsvBackdrop.classList.add('opacity-0');
        reconCsvSheet.classList.remove('translate-y-0');
        reconCsvSheet.classList.add('translate-y-full');
        setTimeout(() => {
            reconCsvSheet.classList.add('hidden');
            reconCsvBackdrop.classList.add('hidden');
        }, 300);
        unlockScroll();
        clearReconstructSelection();
    }

    const reconCsvSheetClose = document.getElementById('recon-csv-sheet-close');
    if (reconCsvSheetClose) reconCsvSheetClose.addEventListener('click', closeReconCsvSheet);
    if (reconCsvBackdrop) reconCsvBackdrop.addEventListener('click', closeReconCsvSheet);

    if (manualEntryCsvBtn) {
        manualEntryCsvBtn.addEventListener('click', () => {
            closeManualEntrySheet();
            setTimeout(() => openReconCsvSheet(), 350);
        });
    }

    // --- Reconstruct Paste Sheet ---
    const reconPasteBackdrop = document.getElementById('recon-paste-backdrop');
    const reconPasteSheet = document.getElementById('recon-paste-sheet');

    function openReconPasteSheet() {
        if (!reconPasteSheet || !reconPasteBackdrop) return;
        resetReconstructionState();

        reconPasteBackdrop.classList.remove('hidden');
        reconPasteSheet.classList.remove('hidden');
        requestAnimationFrame(() => {
            reconPasteBackdrop.classList.remove('opacity-0');
            reconPasteBackdrop.classList.add('opacity-100');
            reconPasteSheet.classList.remove('translate-y-full');
            reconPasteSheet.classList.add('translate-y-0');
        });
        lockScroll();
    }

    function closeReconPasteSheet() {
        if (!reconPasteSheet || !reconPasteBackdrop) return;
        reconPasteBackdrop.classList.remove('opacity-100');
        reconPasteBackdrop.classList.add('opacity-0');
        reconPasteSheet.classList.remove('translate-y-0');
        reconPasteSheet.classList.add('translate-y-full');
        setTimeout(() => {
            reconPasteSheet.classList.add('hidden');
            reconPasteBackdrop.classList.add('hidden');
        }, 300);
        unlockScroll();
        clearReconstructSelection();
    }

    const reconPasteSheetClose = document.getElementById('recon-paste-sheet-close');
    if (reconPasteSheetClose) reconPasteSheetClose.addEventListener('click', closeReconPasteSheet);
    if (reconPasteBackdrop) reconPasteBackdrop.addEventListener('click', closeReconPasteSheet);

    if (manualEntryPasteBtn) {
        manualEntryPasteBtn.addEventListener('click', () => {
            closeManualEntrySheet();
            setTimeout(() => openReconPasteSheet(), 350);
        });
    }

    // Wire clear buttons in new sheets
    const reconPasteClear = document.getElementById('recon-paste-clear');
    if (reconPasteClear) {
        reconPasteClear.addEventListener('click', () => {
            const ta = document.getElementById('recon-shares');
            if (ta) ta.value = '';
            const status = document.getElementById('paste-shares-status');
            if (status) status.classList.add('hidden');
        });
    }
    const reconCsvClear = document.getElementById('recon-csv-clear');
    const resetCsvFileUI = () => {
        const fileInput = document.getElementById('recon-file');
        if (fileInput) fileInput.value = '';
        const selectLabel = document.getElementById('recon-file-select-label');
        const fileChip = document.getElementById('recon-file-chip');
        const fileName = document.getElementById('recon-file-name');
        if (selectLabel) selectLabel.classList.remove('hidden');
        if (fileChip) fileChip.classList.add('hidden');
        if (fileName) fileName.textContent = '';
    };
    if (reconCsvClear) {
        reconCsvClear.addEventListener('click', resetCsvFileUI);
    }
    const reconFileRemoveBtn = document.getElementById('recon-file-remove');
    if (reconFileRemoveBtn) {
        reconFileRemoveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            resetCsvFileUI();
        });
    }


    // --- Swipe-to-Dismiss for All Bottom Sheets ---
    // Each sheet's handle is the first child div containing the pill element.
    const findSheetHandle = (sheetEl) => {
        if (!sheetEl) return null;
        return sheetEl.querySelector(':scope > div:first-child');
    };

    const swipeTargets = [
        { sheet: genResultSheet, dismiss: closeGenResultSheet },
        { sheet: manualEntrySheet, dismiss: closeManualEntrySheet },
        { sheet: inspectBottomSheet, dismiss: closeInspectSheet },
        { sheet: reconPasteSheet, dismiss: closeReconPasteSheet },
        { sheet: reconCsvSheet, dismiss: closeReconCsvSheet },
    ];

    for (const { sheet, dismiss } of swipeTargets) {
        enableSwipeToDismiss(findSheetHandle(sheet), sheet, dismiss);
    }


    // Camera availability is checked on-demand when user clicks the QR card.


    // --- Result Presentation Modal ---
    const resultModalBackdrop = document.getElementById('result-modal-backdrop');
    const resultPresentationModal = document.getElementById('result-presentation-modal');

    function openResultModal(mode) {
        mode = mode || 'inspect';
        if (!resultPresentationModal || !resultModalBackdrop) return;

        // Context-aware UI toggles
        const modalTitle = resultPresentationModal.querySelector('h3[data-i18n]');
        const reconResultDiv = document.getElementById('recon-result');
        const inspectResultDiv = document.getElementById('inspect-result');

        const copyBtn = document.getElementById('copy-secret-btn');
        const copyBtnText = document.getElementById('copy-secret-text');
        if (mode === 'reconstruct') {
            // Reset secret visibility state for fresh modal session
            secretIsVisible = false;
            if (modalTitle) {
                modalTitle.textContent = safeTranslate('reconstruct.secret_decrypted', 'Secret Reconstructed');
                modalTitle.setAttribute('data-i18n', 'reconstruct.secret_decrypted');
            }
            if (copyBtn) copyBtn.classList.remove('hidden');
            if (copyBtnText) copyBtnText.textContent = safeTranslate('reconstruct.copy_secret', 'Copy Secret');
            if (reconResultDiv) reconResultDiv.classList.remove('hidden');
            if (inspectResultDiv) inspectResultDiv.classList.add('hidden');
        } else {
            if (modalTitle) {
                modalTitle.textContent = safeTranslate('inspect.share_details', 'Share Details');
                modalTitle.setAttribute('data-i18n', 'inspect.share_details');
            }
            if (copyBtn) copyBtn.classList.add('hidden'); // No copy button in inspect mode
            if (copyBtnText) copyBtnText.textContent = safeTranslate('inspect.copy_share', 'Copy Share');
            if (reconResultDiv) reconResultDiv.classList.add('hidden');
            if (inspectResultDiv) inspectResultDiv.classList.remove('hidden');
        }

        resultModalBackdrop.classList.remove('hidden');
        resultPresentationModal.classList.remove('hidden');

        requestAnimationFrame(() => {
            resultModalBackdrop.classList.remove('opacity-0');
            resultModalBackdrop.classList.add('opacity-100');
            resultPresentationModal.classList.remove('translate-y-full');
            resultPresentationModal.classList.add('translate-y-0');
        });
        lockScroll();
    }

    function closeResultModal() {
        if (!resultPresentationModal || !resultModalBackdrop) return;
        resultModalBackdrop.classList.remove('opacity-100');
        resultModalBackdrop.classList.add('opacity-0');
        resultPresentationModal.classList.remove('translate-y-0');
        resultPresentationModal.classList.add('translate-y-full');

        setTimeout(() => {
            resultPresentationModal.classList.add('hidden');
            resultModalBackdrop.classList.add('hidden');
            // Security: wipe result content from DOM
            const inspectResult = document.getElementById('inspect-result');
            if (inspectResult) inspectResult.innerHTML = '';
            // Also hide recon-result and wipe secret
            const reconResult = document.getElementById('recon-result');
            if (reconResult) reconResult.classList.add('hidden');
            const reconPwSpan = document.getElementById('recon-password');
            if (reconPwSpan) reconPwSpan.textContent = '';
            secretIsVisible = false;
        }, 300);
        unlockScroll();
        clearReconstructSelection();
    }

    // Wire result modal dismissal
    // Wire X close button on result sheet
    const resultModalCloseX = document.getElementById('result-modal-close-x');
    if (resultModalCloseX) resultModalCloseX.addEventListener('click', () => closeResultModal());

    if (resultModalBackdrop) {
        resultModalBackdrop.addEventListener('click', () => closeResultModal());
    }
    const resultModalDoneBtn = document.getElementById('result-modal-done-btn');
    if (resultModalDoneBtn) {
        resultModalDoneBtn.addEventListener('click', () => closeResultModal());
    }
    const resultModalCloseBtn = document.getElementById('result-modal-close-btn');
    if (resultModalCloseBtn) {
        resultModalCloseBtn.addEventListener('click', () => closeResultModal());
    }


    // --- Wire Dismissal ---
    if (inspectBackdrop) {
        inspectBackdrop.addEventListener('click', () => closeInspectSheet());
    }
    const inspectSheetCloseBtn = document.getElementById('inspect-sheet-close');
    if (inspectSheetCloseBtn) {
        inspectSheetCloseBtn.addEventListener('click', () => closeInspectSheet());
    }

    // --- Wire Sub-Navigation Inside Sheet ---
    const inspectCardPaste = document.getElementById('inspect-card-paste');
    if (inspectCardPaste) {
        inspectCardPaste.addEventListener('click', () => {
            openInspectSheet('paste');
        });
    }
    const inspectPasteBack = document.getElementById('inspect-paste-back');
    if (inspectPasteBack) {
        inspectPasteBack.addEventListener('click', () => {
            openInspectSheet('options');
        });
    }


    const inspectCardScan = document.getElementById('inspect-card-scan');
    if (inspectCardScan) {
        inspectCardScan.addEventListener('click', () => {
            closeInspectSheet();
            // Trigger the existing QR scanner flow for inspect
            if (typeof handleCameraPreFlight === 'function') {
                handleCameraPreFlight('inspect');
            }
        });
    }
    const inspectCardNfc = document.getElementById('inspect-card-nfc');
    if (inspectCardNfc) {
        inspectCardNfc.addEventListener('click', () => {
            closeInspectSheet();
            // Trigger the existing NFC flow for inspect
            if (typeof startNfcScannerFlow === 'function' && typeof requestNfcPermission === 'function') {
                requestNfcPermission(async () => {
                    try {
                        await startNfcScannerFlow('inspect');
                        // displayShareInspectionDetails is called internally by the NFC flow
                        // Do NOT call it again here to avoid double-invocation race condition
                    } catch (e) {
                        if (e.message !== 'AbortError') {
                            logger.error("NFC Inspect Error: " + e.message);
                        }
                    }
                });
            }
        });
    }


    // --- Utility Functions ---

    /**
    * Updates the character count display for a given input field.
    * @param {HTMLInputElement|HTMLTextAreaElement} inputElement - The input field.
    * @param {HTMLElement} countElement - The element to display the count.
    * @param {number} maxLength - The maximum allowed length for the input.
    */
    const updateCharCount = (inputElement, countElement, maxLength) => {
        if (!inputElement || !countElement) return;
        const currentLength = inputElement.value.length;
        countElement.textContent = `${currentLength}/${maxLength}`;
        if (currentLength > maxLength) {
            countElement.classList.add('text-red-500', 'dark:text-red-400');
            countElement.classList.remove('text-slate-500', 'dark:text-slate-400');
        } else {
            countElement.classList.remove('text-red-500', 'dark:text-red-400');
            countElement.classList.add('text-slate-500', 'dark:text-slate-400');
        }
    };

    /**
     * Updates the byte counter for the secret input using TextEncoder.
     * Displays the user-visible byte count against the maximum allowed secret length.
     */
    const MAX_USER_BYTES = APP_CONFIG.MAX_SECRET_LENGTH; // 250
    const updateByteCount = (inputElement, countElement) => {
        if (!inputElement || !countElement) return;
        const byteLen = new TextEncoder().encode(inputElement.value).length;
        countElement.textContent = `${byteLen}/${MAX_USER_BYTES} bytes`;
        if (byteLen > MAX_USER_BYTES) {
            countElement.classList.add('text-red-500', 'dark:text-red-400');
            countElement.classList.remove('text-slate-500', 'dark:text-slate-400');
        } else {
            countElement.classList.remove('text-red-500', 'dark:text-red-400');
            countElement.classList.add('text-slate-500', 'dark:text-slate-400');
        }
    };


    if (reconClearPasteButton && reconSharesTextarea && pasteSharesStatusDiv) {
        reconClearPasteButton.addEventListener('click', () => {
            reconSharesTextarea.value = '';
            pasteSharesStatusDiv.classList.add('hidden');
            pasteSharesStatusDiv.textContent = '';
            // Optionally, reset main reconstruction result/error if this button is mode-specific
            // if (reconResultDiv) reconResultDiv.classList.add('hidden');
            // if (reconErrorDiv) reconErrorDiv.classList.add('hidden');
            // resetReconstructionButtonState(); // This might be too broad, consider specific resets
            logger.info('Pasted shares textarea cleared by user.');
            reconSharesTextarea.focus();
        });
    }

    // Event Listener for "Clear Input" button in Inspect Share (Manual Entry)
    if (inspectClearInputButton && inspectShareInput && inspectResultDiv) {
        inspectClearInputButton.addEventListener('click', () => {
            if (inspectShareInput) inspectShareInput.value = ''; // Clear the textarea
            if (inspectResultDiv) {
                inspectResultDiv.innerHTML = ''; // Clear any previous inspection results
                inspectResultDiv.classList.add('hidden'); // Hide the result area
            }
            logger.info('Inspect share input field cleared by user.');
            if (inspectShareInput) inspectShareInput.focus(); // Focus the textarea
        });
    }


    /**
        * Updates the visual password strength indicator and its visibility.
        * @param {string} password - The password string to evaluate.
        */
    const updatePasswordStrength = (password) => {
        // Ensure all necessary elements are available
        if (!genEncryptStrengthBar || !genEncryptStrengthText || !genEncryptKeyInput || !genEncryptStrengthContainer) {
            if (genEncryptStrengthContainer) { // If only container exists, hide it
                genEncryptStrengthContainer.classList.add('hidden');
            }
            // logger.warn("Password strength indicator elements not found. Hiding container if it exists.");
            return;
        }

        if (!password) { // If password field is empty
            genEncryptStrengthBar.style.width = '0%';
            genEncryptStrengthText.textContent = '';
            // Reset background color by removing specific color classes
            genEncryptStrengthBar.classList.remove('bg-red-500', 'bg-red-700', 'bg-yellow-500', 'bg-sky-500', 'bg-blue-500', 'bg-green-500');
            genEncryptStrengthText.className = 'block text-xs mt-1'; // Reset text color

            genEncryptStrengthContainer.classList.add('hidden'); // HIDE THE ENTIRE CONTAINER
            return;
        }

        // If there is a password, ensure the container is visible
        genEncryptStrengthContainer.classList.remove('hidden'); // SHOW THE ENTIRE CONTAINER

        let score = 0;
        // Criteria
        if (password.length >= 1) score++;
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
        else if (/[A-Z]/.test(password) || /[a-z]/.test(password)) score += 0.5;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9\s]/.test(password)) score++;

        score = Math.min(score, 6); // Cap score

        const tr = (key, fallback) => (typeof i18n !== 'undefined') ? i18n.t(`password.${key}`) || fallback : fallback;

        let strengthText = tr('very_weak', 'Very Weak');
        let strengthColorClass = 'bg-red-500';
        let widthPercentage = '10%';
        let textColorClass = 'text-red-600 dark:text-red-400';

        if (score <= 1.5) {
            strengthText = tr('very_weak', 'Very Weak'); strengthColorClass = 'bg-red-500'; widthPercentage = '15%'; textColorClass = 'text-red-600 dark:text-red-400';
        } else if (score <= 2.5) {
            strengthText = tr('weak', 'Weak'); strengthColorClass = 'bg-red-500'; widthPercentage = '30%'; textColorClass = 'text-red-600 dark:text-red-400';
        } else if (score <= 3.5) {
            strengthText = tr('fair', 'Fair'); strengthColorClass = 'bg-yellow-500'; widthPercentage = '50%'; textColorClass = 'text-yellow-600 dark:text-yellow-400';
        } else if (score <= 4.5) {
            strengthText = tr('good', 'Good'); strengthColorClass = 'bg-sky-500'; widthPercentage = '75%'; textColorClass = 'text-sky-600 dark:text-sky-400';
        } else { // score > 4.5
            strengthText = tr('strong', 'Strong'); strengthColorClass = 'bg-green-500'; widthPercentage = '100%'; textColorClass = 'text-green-600 dark:text-green-400';
        }

        const maxLength = parseInt(genEncryptKeyInput.maxLength);
        if (!isNaN(maxLength) && password.length > maxLength) {
            strengthText = `Too long (max ${maxLength} chars)`;
            strengthColorClass = 'bg-red-700';
            textColorClass = 'text-red-700 dark:text-red-500';
            widthPercentage = '100%';
        }

        genEncryptStrengthBar.classList.remove('bg-red-500', 'bg-red-700', 'bg-yellow-500', 'bg-sky-500', 'bg-blue-500', 'bg-green-500');
        genEncryptStrengthBar.classList.add(strengthColorClass);
        genEncryptStrengthBar.style.width = widthPercentage;

        genEncryptStrengthText.textContent = strengthText;
        genEncryptStrengthText.className = `block text-xs mt-1 ${textColorClass}`;
    };

    // Event Listener for Encryption Toggle
    const genEncryptToggle = document.getElementById('gen-encrypt-toggle');
    const genEncryptContainer = document.getElementById('gen-encrypt-container');

    if (genEncryptToggle) {
        genEncryptToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                genEncryptContainer.classList.remove('hidden');
                setTimeout(() => { if (genEncryptKeyInput) genEncryptKeyInput.focus(); }, 50);
            } else {
                genEncryptContainer.classList.add('hidden');
                if (genEncryptKeyInput) genEncryptKeyInput.value = '';
                if (genConfirmEncryptKeyInput) genConfirmEncryptKeyInput.value = '';
                if (genEncryptKeyInput) genEncryptKeyInput.dispatchEvent(new Event('input'));
                if (genConfirmEncryptKeyInput) genConfirmEncryptKeyInput.dispatchEvent(new Event('input'));
            }
        });
    }


    const clearGenerateForm = (keepResults = false) => {
        isAutoClearingForm.set(true); // Prevent reactive validator from nuking shares
        genPasswordInput.value = '';
        genConfirmPasswordInput.value = '';
        genCommentInput.value = '';

        // Unconditionally clear all structural configs
        genNInput.value = '';
        genKInput.value = '';

        if (genEncryptToggle) {
            genEncryptToggle.checked = false;
            genEncryptToggle.dispatchEvent(new Event('change'));
        } else {
            if (genEncryptKeyInput) genEncryptKeyInput.value = '';
            if (genConfirmEncryptKeyInput) genConfirmEncryptKeyInput.value = '';
        }

        if (genConfirmPasswordError) genConfirmPasswordError.classList.add('hidden');
        if (genConfirmEncryptKeyError) genConfirmEncryptKeyError.classList.add('hidden');
        if (genNError) genNError.classList.add('hidden');
        if (genKError) genKError.classList.add('hidden');

        if (genErrorDiv) {
            genErrorDiv.textContent = '';
            genErrorDiv.classList.add('hidden');
        }

        if (!keepResults && genResultDiv) {
            genResultDiv.classList.add('hidden');
            if (genSharesDiv) genSharesDiv.innerHTML = '';
            closeGenResultSheet();
        }

        // Reset char counters and strength indicator
        if (genPasswordInput && genPasswordCharCount) {
            updateByteCount(genPasswordInput, genPasswordCharCount);
        }
        if (genCommentInput && genCommentCharCount) {
            updateCharCount(genCommentInput, genCommentCharCount, parseInt(genCommentInput.maxLength));
        }
        if (!keepResults && genEncryptKeyInput) {
            updatePasswordStrength(genEncryptKeyInput.value);
        }

        // We avoid calling validateGenForm if keeping results, because it destroys currentGeneratedShares.get()
        if (!keepResults) {
            validateGenForm();
        } else {
            // Manually disable the generate button so they can't re-mash it
            if (genSubmitButton) {
                genSubmitButton.disabled = true;
                genSubmitButton.title = "Please fill all required fields correctly.";
            }
        }

        logger.info(keepResults ? 'Generated shares success, form auto-cleared.' : 'Generate Shares form cleared by user.');
        genPasswordInput.focus();
        isAutoClearingForm.set(false); // Re-enable reactive validator
    };

    if (genClearFormButton) {
        genClearFormButton.addEventListener('click', () => clearGenerateForm(false));
    }

    // Event Listener for Theme Toggle Switch in Settings Page
    if (themeToggleSwitch) {
        themeToggleSwitch.addEventListener('change', (e) => {
            const newTheme = e.target.checked ? 'dark' : 'light';
            setTheme(newTheme); // Your existing setTheme function handles localStorage and UI
            // Theme toggle is self-explanatory — no toast needed
        });
    }

    // Event Listener for Sound Toggle Switch in Settings Page
    if (soundToggleSwitch) {
        // Subscribe UI automatically to the reactive State Vault
        isSoundEnabled.subscribe(enabled => {
            soundToggleSwitch.checked = enabled;
        });

        soundToggleSwitch.addEventListener('change', (e) => {
            isSoundEnabled.set(e.target.checked);
            localStorage.setItem(APP_CONFIG.SOUND_ENABLED_STORAGE_KEY, String(isSoundEnabled.get()));
            logger.info(`Scan beep sound setting changed to: ${isSoundEnabled.get() ? 'Enabled' : 'Disabled'}`);
            // Sound toggle is self-explanatory — no toast needed
        });
    }

    // Event Listener for Haptic Toggle Switch in Settings Page
    const hapticToggleSwitch = document.getElementById('haptic-toggle-switch');
    if (hapticToggleSwitch) {
        hapticToggleSwitch.checked = localStorage.getItem('hapticEnabled') !== 'false'; // Default on
        hapticToggleSwitch.addEventListener('change', () => {
            localStorage.setItem('hapticEnabled', String(hapticToggleSwitch.checked));
            logger.info(`Haptic feedback setting changed to: ${hapticToggleSwitch.checked ? 'Enabled' : 'Disabled'}`);
            if (hapticToggleSwitch.checked && navigator.vibrate) navigator.vibrate(50); // Feedback confirmation
            // Haptic toggle is self-explanatory — no toast needed
        });
    }

    // Event Listener for Verbosity Switch in Settings Page
    if (logsToggleSwitch) {
        logsToggleSwitch.addEventListener('change', (e) => {
            const logsEnabled = e.target.checked;
            localStorage.setItem('logsEnabled', String(logsEnabled));
            if (logsContainerWrapper) {
                if (logsEnabled) logsContainerWrapper.classList.remove('hidden');
                else logsContainerWrapper.classList.add('hidden');
            }
        });
    }


    // Event Listener for CSV Template Download Link
    if (downloadCsvTemplateLink) {
        downloadCsvTemplateLink.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent default link behavior

            // --- SIMPLIFIED TEMPLATE ---
            // Define each line of the CSV content without leading javascript indentation
            const instructions = [
                "# Instructions for CSV Import:",
                "# 1. The \"ShareString\" column is the ONLY column needed for reconstruction.",
                "# 2. Paste each full Base64 encoded share string into this column - one share per line.",
                "# 3. Header row (\"ShareString\") is optional; if not present the tool will assume the first column contains shares.",
                "# 4. You can delete these instruction lines and the sample row before uploading.",
                "#",
                "# Minimal Example (no header - just share strings):",
                "# YOUR_FIRST_BASE64_SHARE_STRING",
                "# YOUR_SECOND_BASE64_SHARE_STRING",
                "# etc.",
                "#",
                "# Example with Header (Recommended for clarity):"
            ].join('\n') + '\n'; // Add a final newline after instructions

            const templateHeader = "ShareString\n";
            const sampleRow1 = `"bWV0YWRhdGF8Nm...your first Base64 share string here..."\n`;
            const sampleRow2 = `"bWV0YWRhdGF8Nm...your second Base64 share string here..."\n`;
            // Add more sample rows if desired, or make it simpler
            // For just one sample row:
            // const sampleData = `"bWV0YWRhdGF8Nm...your share string here..."\n`;

            const csvTemplateContent = instructions + templateHeader + sampleRow1 + sampleRow2;

            const blob = new Blob([csvTemplateContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const tempLink = document.createElement('a');
            tempLink.href = url;
            tempLink.download = 'piecekeeper_shares_import_template.csv'; // Changed filename
            document.body.appendChild(tempLink);
            tempLink.click();
            document.body.removeChild(tempLink);
            URL.revokeObjectURL(url);
            logger.info('Simplified CSV template download initiated.');
            // Download is self-evident — no toast needed
        });
    }


    /**
     * Shows the QR Scanner Modal and prepares it for scanning.
     * @param {'reconstruct' | 'inspect'} purpose - The reason for scanning.
     */

    const handleCameraPreFlight = (purpose) => {
        if (localStorage.getItem('pk_camera_allowed') === 'true') {
            startQRScanner(purpose);
            return;
        }
        const modal = document.getElementById('camera-pre-flight-modal');
        const backdrop = document.getElementById('camera-pre-flight-backdrop');
        if (modal) {
            // Open as bottom action sheet
            if (backdrop) backdrop.classList.remove('hidden');
            modal.classList.remove('hidden');
            requestAnimationFrame(() => {
                if (backdrop) { backdrop.classList.remove('opacity-0'); backdrop.classList.add('opacity-100'); }
                modal.classList.remove('translate-y-full');
                modal.classList.add('translate-y-0');
            });

            const allowBtn = document.getElementById('camera-pre-flight-allow');
            const cancelBtn = document.getElementById('camera-pre-flight-cancel');
            const cancelX = document.getElementById('camera-pre-flight-x');

            const cleanup = () => {
                if (backdrop) { backdrop.classList.remove('opacity-100'); backdrop.classList.add('opacity-0'); }
                modal.classList.remove('translate-y-0');
                modal.classList.add('translate-y-full');
                setTimeout(() => { modal.classList.add('hidden'); if (backdrop) backdrop.classList.add('hidden'); }, 300);
            };
            // Wire X close to same cancel logic
            if (cancelX) cancelX.onclick = () => { if (cancelBtn) cancelBtn.click(); };

            if (allowBtn) {
                allowBtn.onclick = () => {
                    localStorage.setItem('pk_camera_allowed', 'true');
                    cleanup();
                    startQRScanner(purpose);
                };
            }
            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    cleanup();

                    // Reset buttons manually since we intercepted them
                    const reconBtn = document.getElementById('recon-scan-qr');
                    const originalCameraSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera mr-2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle></svg>';

                    if (reconBtn) {
                        const reconText = safeTranslate('reconstruct.qr_start_btn', 'Start QR Scanner');
                        reconBtn.innerHTML = originalCameraSvg + '<span data-i18n="reconstruct.qr_start_btn">' + reconText + '</span>';
                        reconBtn.disabled = false;
                    }
                }
            }
        } else {
            startQRScanner(purpose);
        }
    };


    /**
     * Hides the QR Scanner Modal and performs cleanup.
     */


    // --- Event Listeners for New Modal Buttons ---
    if (closeQrScannerModalButton) {
        closeQrScannerModalButton.addEventListener('click', hideQrModal);
    }
    if (stopQrScannerModalButton) {
        stopQrScannerModalButton.addEventListener('click', hideQrModal);
    }

    // --- Torch (Flashlight) Toggle Button ---
    const torchBtn = document.getElementById('qr-torch-btn');
    if (torchBtn) {
        const TORCH_SVG_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flashlight-off"><path d="M16 16v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4"/><path d="M7 2h11v4c0 2-2 2-2 4v1"/><line x1="11" x2="18" y1="6" y2="6"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;
        const TORCH_SVG_ON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flashlight"><path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/><line x1="6" x2="18" y1="6" y2="6"/><line x1="12" x2="12" y1="12" y2="12"/></svg>`;
        torchBtn.addEventListener('click', () => {
            const result = toggleCameraTorch();
            if (result.supported) {
                torchBtn.dataset.active = String(result.active);
                if (result.active) {
                    torchBtn.classList.remove('bg-gray-800', 'text-gray-300');
                    torchBtn.classList.add('bg-yellow-500', 'text-white');
                } else {
                    torchBtn.classList.remove('bg-yellow-500', 'text-white');
                    torchBtn.classList.add('bg-gray-800', 'text-gray-300');
                }
                torchBtn.innerHTML = result.active ? TORCH_SVG_ON : TORCH_SVG_OFF;
            } else {
                flashButton(torchBtn, safeTranslate('scanner.torch_unsupported', 'Unavailable'), 'slate');
            }
        });
    }


    /**
     * Toggles the loading state of a button (disables, hides text, shows spinner).
     * @param {'info' | 'success' | 'error' | 'warn'} type - Type of toast (determines color and icon).
     */


    // Event Listeners for Character Counters
    if (genPasswordInput && genPasswordCharCount) {
        genPasswordInput.addEventListener('input', () => {
            updateByteCount(genPasswordInput, genPasswordCharCount);
        });
        // Initial call
        updateByteCount(genPasswordInput, genPasswordCharCount);
    }

    if (genCommentInput && genCommentCharCount) {
        genCommentInput.addEventListener('input', () => {
            updateCharCount(genCommentInput, genCommentCharCount, parseInt(genCommentInput.maxLength));
        });
        // Initial call
        updateCharCount(genCommentInput, genCommentCharCount, parseInt(genCommentInput.maxLength));
    }

    if (genEncryptKeyInput) {
        genEncryptKeyInput.addEventListener('input', () => {
            updatePasswordStrength(genEncryptKeyInput.value);
        });
        updatePasswordStrength(genEncryptKeyInput.value); // Initial call
    }

    // --- Advanced Options Toggle ---
    const genAdvancedToggle = document.getElementById('gen-advanced-toggle');
    const genAdvancedContainer = document.getElementById('gen-advanced-container');
    const genAdvancedChevron = document.getElementById('gen-advanced-chevron');
    if (genAdvancedToggle && genAdvancedContainer) {
        genAdvancedToggle.addEventListener('click', () => {
            const isHidden = genAdvancedContainer.classList.toggle('hidden');
            if (genAdvancedChevron) {
                genAdvancedChevron.style.transform = isHidden ? '' : 'rotate(90deg)';
            }
        });
    }


    /**
      * Attempts to reconstruct the secret.
      * Includes state reset for QR mode on success.
      */
    // Reconstruct event listener
    AppEvents.addEventListener('reconstructReady', async () => {
        logger.info('reconstructReady event received.');
        await attemptReconstruction();
    });

    async function attemptReconstruction() {
        try {
            // Log entry with more context
            // Clear any previous inline error
            logger.info(`[attemptReconstruction ENTER] Mode: ${currentReconMode.get()}, Scanned Shares Count: ${scannedRawSharesSet.get().size}, Required K: ${requiredK.get()}, Flag: ${isProcessingSuccessfulReconstruction.get()}`);

            // 1. Check if a successful reconstruction is already being processed or was just shown
            if (isProcessingSuccessfulReconstruction.get()) {
                logger.warn("[attemptReconstruction] Call ignored, a successful reconstruction is already being processed or was just shown.");
                // Optionally, ensure button loading state is reset if this was a redundant call from a non-QR mode
                return; // Exit early
            }

            // --- Initial UI Resets for this attempt ---
            if (reconResultDiv) reconResultDiv.classList.add('hidden');
            reconstructedSecretData.set(null); // Clear any previous reconstructed data at the start

            const modeWhenCalled = currentReconMode.get(); // Capture mode at the time of call

            // Show loading state for non-QR modes that have a visible submit button

            try {
                // 2. Set the flag to indicate processing has started for this attempt
                isProcessingSuccessfulReconstruction.set(true);


                // Unified password extraction — single source of truth for all modes
                let encryptionKey = reconstructionPassword.get() || '';
                let sharesToProcess = [];

                // --- Gather Shares based on current reconstruction mode ---
                if (modeWhenCalled === RECONSTRUCT_MODE.PASTE) {
                    sharesToProcess = parseManualShares(reconSharesTextarea.value);
                } else if (modeWhenCalled === RECONSTRUCT_MODE.CSV) {
                    const file = reconFileInput.files[0];
                    if (!file) {
                        // 3a. Reset flag on early exit due to user error
                        isProcessingSuccessfulReconstruction.set(false);

                        throw new Error("Please select a CSV file.");
                    }
                    sharesToProcess = await loadSharesFromCsv(file);
                } else if (modeWhenCalled === RECONSTRUCT_MODE.QR || modeWhenCalled === RECONSTRUCT_MODE.NFC) {
                    if (scannedRawSharesSet.get().size === 0) {
                        // 3a. Reset flag on early exit
                        isProcessingSuccessfulReconstruction.set(false);

                        throw new Error("No NFC Cards or QR data were scanned.");
                    }
                    if (requiredK.get() == null || scannedRawSharesSet.get().size < requiredK.get()) {                        // 3a. Reset flag on early exit
                        isProcessingSuccessfulReconstruction.set(false);

                        throw new Error(`Not enough shares scanned. Need ${requiredK.get() || 'K (unknown)'}, got ${scannedRawSharesSet.get().size}.`);
                    }
                    sharesToProcess = Array.from(scannedRawSharesSet.get()).map(s => ({ share: s, shareIndex: 0 })); // Index isn't critical here
                } else {
                    // 3a. Reset flag on early exit
                    isProcessingSuccessfulReconstruction.set(false);

                    throw new Error("Invalid reconstruction mode for attempt.");
                }

                if (sharesToProcess.length === 0 && modeWhenCalled !== RECONSTRUCT_MODE.QR) { // QR mode share count checked above
                    // 3a. Reset flag on early exit
                    isProcessingSuccessfulReconstruction.set(false);

                    throw new Error("No valid shares provided to process.");
                }

                logger.info(`Attempting reconstruction with ${sharesToProcess.length} shares (mode: ${modeWhenCalled}). Encryption key ${encryptionKey ? 'provided' : 'not provided'}.`);

                // --- Password Gatekeeper for Paste/CSV modes (route through unified Action Sheet) ---
                if ((modeWhenCalled === RECONSTRUCT_MODE.PASTE || modeWhenCalled === RECONSTRUCT_MODE.CSV) && sharesToProcess.length > 0) {
                    try {
                        const firstShareMeta = inspectShare(sharesToProcess[0].share);
                        if (firstShareMeta.isValid && firstShareMeta.isEncrypted && !encryptionKey) {
                            playPasswordPromptSound();
                            // Store pending data for the Action Sheet handler
                            sharePendingKDeterminationManual.set(Object.assign({}, firstShareMeta, {
                                shareString: sharesToProcess[0].share,
                                version: firstShareMeta.version
                            }));
                            passwordPromptContext.set('reconstruct');

                            // Reset processing flag — we're pausing, not failing
                            isProcessingSuccessfulReconstruction.set(false);

                            showPasswordPrompt();
                            return 'paused'; // Signal to callers: do NOT clear UI state
                        }
                    } catch (metaError) {
                        // Log error but allow attemptReconstruction to proceed; reconstructSecret will handle deeper errors.
                        logger.warn(`Could not reliably peek at first share metadata for password check: ${metaError.message}`);
                    }
                }
                // --- End Password Check ---

                // --- Core Reconstruction ---
                const result = await reconstructSecret(sharesToProcess, encryptionKey);
                reconstructedSecretData.set({
                    password: result.secret,
                    note: result.metadata.comment,
                    date: result.metadata.timestamp,
                    version: result.metadata.version,
                    kdfSchema: result.metadata.kdfSchema,
                    familyId: result.metadata.familyId,
                    n: result.metadata.n,
                    k: result.metadata.k
                });

                // --- Success Path: Update UI ---
                if (reconPasswordSpan) {
                    reconPasswordSpan.textContent = '••••••••';
                    reconPasswordSpan.classList.remove('text-emerald-600', 'dark:text-emerald-400');
                    reconPasswordSpan.classList.add('italic', 'text-slate-500', 'dark:text-slate-400', 'cursor-pointer');
                }
                secretIsVisible = false;
                reconNoteSpan.textContent = reconstructedSecretData.get().note || 'None';
                reconDateSpan.textContent = reconstructedSecretData.get().date || 'Unknown';
                if (document.getElementById('recon-stats')) {
                    let schemaNameLabel = reconstructedSecretData.get().kdfSchema || '1';
                    if (reconstructedSecretData.get().kdfSchema && APP_CONFIG.CRYPTO_SCHEMAS[reconstructedSecretData.get().kdfSchema]) {
                        const sLabelKey = APP_CONFIG.CRYPTO_SCHEMAS[reconstructedSecretData.get().kdfSchema].label_key;
                        schemaNameLabel = safeTranslate(sLabelKey, sLabelKey);
                    }
                    document.getElementById('recon-family-span').textContent = reconstructedSecretData.get().familyId || 'Unknown';
                    document.getElementById('recon-version-span').textContent = schemaNameLabel;
                    document.getElementById('recon-n-span').textContent = reconstructedSecretData.get().n || 'Unknown';
                    document.getElementById('recon-k-span').textContent = reconstructedSecretData.get().k || 'Unknown';
                    let pwStatusSpan = document.getElementById('recon-pw-status-span');
                    if (pwStatusSpan) {
                        const hasPassword = encryptionKey && encryptionKey !== '';
                        pwStatusSpan.textContent = hasPassword ? (safeTranslate('inspect.yes', 'Yes')) : (safeTranslate('inspect.no', 'No'));
                    }
                }
                // Secret is masked by default — eye toggle reveals it
                if (reconResultDiv) reconResultDiv.classList.remove('hidden');

                // Open result presentation modal to display the secret
                openResultModal('reconstruct');

                playSuccessSound();
                // Success feedback: sound + modal + haptic — no toast needed
                logger.info('Reconstruction successful.');
                triggerHaptic('success');

                // --- Mode-Specific Cleanup on Success ---
                if (modeWhenCalled === RECONSTRUCT_MODE.QR) {
                    logger.info('[attemptReconstruction SUCCESS via QR] Resetting QR scan state.');
                    scannedRawSharesSet.set(new Set());
                    firstScannedShareEncryptedStatus.set(null);

                } else { // For paste/csv
                    // Clear paste textarea
                    if (reconSharesTextarea) reconSharesTextarea.value = '';
                    const pasteSharesStatusDiv = document.getElementById('paste-shares-status');
                    if (pasteSharesStatusDiv) pasteSharesStatusDiv.classList.add('hidden');
                    // Clear CSV file input + reset chip UI
                    if (reconFileInput) reconFileInput.value = '';
                    const reconFileName = document.getElementById('recon-file-name');
                    if (reconFileName) reconFileName.textContent = '';
                    const reconFileChip = document.getElementById('recon-file-chip');
                    if (reconFileChip) reconFileChip.classList.add('hidden');
                    const reconFileLabel = document.getElementById('recon-file-select-label');
                    if (reconFileLabel) reconFileLabel.classList.remove('hidden');
                }
                // Flag `isProcessingSuccessfulReconstruction.get()` remains true until the finally block's timeout.

            } catch (e) {
                // --- Error Path (Typed Error Handling) ---

                if (e instanceof PasswordRequiredError) {
                    // Encrypted shares detected — show password prompt instead of error
                    logger.info('[attemptReconstruction] PasswordRequiredError caught — prompting for password.');
                    playPasswordPromptSound();
                    passwordPromptContext.set('reconstruct');
                    isProcessingSuccessfulReconstruction.set(false);
                    showPasswordPrompt();
                    return 'paused';
                }

                // All other errors: display inline
                let userMessage = e.message;
                if (e instanceof InsufficientSharesError) {
                    userMessage = safeTranslate('error.insufficient_shares', `Need ${e.required} shares, only ${e.provided} provided.`);
                } else if (e instanceof WrongPasswordError) {
                    userMessage = safeTranslate('error.wrong_password', 'Decryption failed. The encryption password is incorrect.');
                } else if (e instanceof IntegrityCheckError) {
                    userMessage = safeTranslate('error.integrity_failed', 'Integrity check failed. Shares are corrupted or tampered with.');
                } else if (e instanceof SetMismatchError) {
                    userMessage = safeTranslate('error.set_mismatch', 'All shares must belong to the same set.');
                }

                logger.error(`Reconstruction failed: ${e.message}`);
                if (reconErrorDiv) {
                    reconErrorDiv.textContent = `Error: ${userMessage}`;
                    reconErrorDiv.classList.remove('hidden');
                }

                // Error is displayed inline via reconErrorDiv (no toast)
                triggerHaptic('error');

                reconstructedSecretData.set(null); // Clear any partial data
                resetReconstructionButtonState(); // Reset UI elements like reveal button etc.

                // 4. Reset flag immediately on error
                isProcessingSuccessfulReconstruction.set(false);

            } finally {
                // --- Final Cleanup for this attempt ---

                // Wipe password from memory after reconstruction attempt
                reconstructionPassword.set('');

                // 5. Reset the flag after a short delay IF a successful reconstruction was processed by *this* call.
                        // If an error occurred, the flag was already reset in the catch block.
                // If it was an early exit (e.g. password needed for paste/csv), flag was also reset.
                        if (reconstructedSecretData.get()) { // Check if this attempt actually led to a successful reconstruction
                    setTimeout(() => {
                        isProcessingSuccessfulReconstruction.set(false);

                        logger.info("[attemptReconstruction FINALLY] Success flag reset after delay.");
                    }, 500); // 500ms delay, adjust if needed
                } else if (isProcessingSuccessfulReconstruction.get()) {
                    // If flag is still true but no reconstructedSecretData.get() (e.g. an unexpected early exit not caught above)
                    // reset it immediately.
                    isProcessingSuccessfulReconstruction.set(false);

                    logger.warn("[attemptReconstruction FINALLY] Flag reset (no data, but was true).");
                }
            }
        } catch (error) {
            logger.error('Reconstruction Crash:', error);
            const activeReconBtn = document.querySelector('#recon-paste-submit, #recon-csv-submit');
            flashButton(activeReconBtn, 'Error', 'rose');
        }
    }


    // --- UI Interaction Functions ---

    /**
     * Creates a Blob URL for downloading shares as a CSV file.
     * @param {Array<{shareIndex: number, share: string, comment: string, timestamp: string}>} shares - Array of share objects.
     * @returns {string} Object URL for the CSV blob.
     */
    const saveSharesToCsv = (shares) => {
        // Define CSV header
        const csvHeader = `${i18n.t('csv.index') || 'ShareIndex'},${i18n.t('csv.share') || 'Share'},${i18n.t('csv.comment') || 'Comment'},${i18n.t('csv.timestamp') || 'Timestamp'}\n`;
        // Map shares to CSV rows, quoting fields to handle potential commas/newlines (basic quoting)
        const csvRows = shares.map(s =>
            // Simple quoting: replace internal quotes with double quotes, wrap in quotes
            `${s.shareIndex},"${s.share.replace(/"/g, '""')}","${(s.comment || '').replace(/"/g, '""')}","${s.timestamp || ''}"`
        ).join('\n');
        const csvContent = csvHeader + csvRows;
        // Create a Blob object
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        // Create an Object URL for the Blob
        return URL.createObjectURL(blob);
    };

    /**
     * MODIFIED: Loads and parses shares from an uploaded CSV file.
     * Focuses on finding the 'Share' column. Other columns are optional.
     * @param {File} file - The CSV file object from the input element.
     * @returns {Promise<Array<{share: string, shareIndex: number | null}>>} Array of parsed share objects.
     * ShareIndex might be null if not found or invalid in CSV, but share data itself is primary.
     */
    const loadSharesFromCsv = async (file) => {
        return new Promise((resolve, reject) => {
            if (!file) {
                return reject(new Error("No file selected."));
            }
            if (!file.name.toLowerCase().endsWith('.csv')) {
                return reject(new Error("Invalid file type. Please upload a CSV file."));
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const csvContent = event.target.result;
                    const lines = csvContent.trim().split('\n');
                    if (lines.length < 1) { // Allow CSV with no header if it's just shares
                        return reject(new Error("CSV file is empty."));
                    }

                    const shares = [];
                    let shareColumnIndex = -1;
                    let hasHeader = false;

                    // Try to determine header and 'Share' column index
                    if (lines.length > 0) {
                        const firstLineValues = lines[0].trim().split(',');
                        const translatedShareHeader = (i18n.t('csv.share') || 'share').toLowerCase();
                        const potentialShareHeaderIndex = firstLineValues.findIndex(header => header.trim().toLowerCase() === 'share' || header.trim().toLowerCase() === translatedShareHeader);

                        if (potentialShareHeaderIndex !== -1) {
                            shareColumnIndex = potentialShareHeaderIndex;
                            hasHeader = true;
                            logger.info(`CSV Import: "Share" column found at index ${shareColumnIndex}.`);
                        } else {
                            // No "Share" header. Guess based on column count or if it looks like a share.
                            logger.info(`CSV Import: "Share" header not found. Attempting to identify share column.`);
                            if (firstLineValues.length === 1 && /^[A-Za-z0-9+/=]{40,}/.test(firstLineValues[0].trim().replace(/^"|"$/g, ''))) {
                                shareColumnIndex = 0; // Single column, looks like a share
                                logger.info(`CSV Import: Assuming single column contains shares.`);
                            } else if (firstLineValues.length > 1 && /^[A-Za-z0-9+/=]{40,}/.test(firstLineValues[1].trim().replace(/^"|"$/g, ''))) {
                                shareColumnIndex = 1; // Default to second column if it looks like shares
                                logger.info(`CSV Import: Assuming second column (index 1) contains shares.`);
                            } else if (firstLineValues.length > 0 && /^[A-Za-z0-9+/=]{40,}/.test(firstLineValues[0].trim().replace(/^"|"$/g, ''))) {
                                shareColumnIndex = 0; // Default to first column if it looks like shares
                                logger.info(`CSV Import: Assuming first column (index 0) contains shares.`);
                            } else {
                                logger.warn(`CSV Import: Could not reliably identify share column. Will try to parse all columns.`);
                                // If still not found, the loop below will try each column.
                            }
                        }
                    }

                    const startLine = hasHeader ? 1 : 0; // Skip header if identified

                    for (let i = startLine; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue; // Skip empty lines

                        const values = line.split(','); // Simple split, assumes no commas within quoted shares
                        let shareStr = null;

                        if (shareColumnIndex !== -1 && values.length > shareColumnIndex) {
                            shareStr = values[shareColumnIndex].trim().replace(/^"|"$/g, '');
                        } else { // Fallback: check all columns in the row for a base64-like string
                            for (const value of values) {
                                const potentialShare = value.trim().replace(/^"|"$/g, '');
                                if (potentialShare.length > 40 && /^[A-Za-z0-9+/=_-]+$/.test(potentialShare)) {
                                    shareStr = potentialShare;
                                    logger.info(`CSV Import: Found potential share in line ${i + 1} at an unspecified column.`);
                                    break;
                                }
                            }
                        }

                        if (shareStr && /^[A-Za-z0-9+/=_-]+$/.test(shareStr)) {
                            try {
                                // Quick Base64URL-safe validation
                                let stdCsv = shareStr.replace(/-/g, '+').replace(/_/g, '/');
                                const csvPad = stdCsv.length % 4;
                                if (csvPad) stdCsv += '='.repeat(4 - csvPad);
                                atob(stdCsv);
                                // ShareIndex from CSV is now optional, it's embedded in the share itself.
                                // We can pass a temporary index or null.
                                shares.push({ share: shareStr, shareIndex: i }); // Use line number as a temp index
                            } catch (e) {
                                logger.warn(`Skipping line ${i + 1} in CSV: Invalid Base64 sequence found: ${shareStr.substring(0, 30)}...`);
                            }
                        } else {
                            logger.warn(`Skipping line ${i + 1} in CSV (no valid Base64 share found): ${line.substring(0, 50)}...`);
                        }
                    }

                    if (shares.length === 0) {
                        return reject(new Error("No valid shares could be parsed from the CSV file. Check column naming or content."));
                    }

                    logger.info(`Successfully parsed ${shares.length} shares from ${file.name}`);
                    resolve(shares);

                } catch (e) {
                    logger.error(`Error parsing CSV file: ${e.message}`);
                    reject(new Error(`Failed to parse CSV file: ${e.message}`));
                }
            };
            reader.onerror = () => {
                logger.error("Failed to read file");
                reject(new Error("Failed to read the selected file."));
            };
            reader.readAsText(file);
        });
    };


    /**
     * Parses shares pasted into the textarea, extracting Base64 strings.
     * @param {string} text - The text content from the textarea.
     * @returns {Array<{shareIndex: number, share: string}>} Array of potential share objects.
     * @throws {Error} If no valid-looking shares are found.
     */
    const parseManualShares = (text) => {
        const lines = text.trim().split('\n');
        const shares = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue; // Skip empty lines

            // Attempt to extract a likely Base64 share string from the line
            // Look for a long sequence of Base64 characters, possibly at the end
            const shareMatch = line.match(/([A-Za-z0-9+/=_-]{40,})$/); // Heuristic: >= 40 Base64/Base64URL chars
            const share = shareMatch ? shareMatch[1] : null;

            if (share && /^[A-Za-z0-9+/=_-]+$/.test(share)) { // Double-check Base64/Base64URL characters
                try {
                    // Quick validation: Convert Base64URL to standard Base64 then decode
                    let stdB64 = share.replace(/-/g, '+').replace(/_/g, '/');
                    const pad = stdB64.length % 4;
                    if (pad) stdB64 += '='.repeat(4 - pad);
                    atob(stdB64);
                    // Add the potential share using line number as a temporary index
                    shares.push({ shareIndex: i + 1, share: share });
                } catch (e) {
                    logger.warn(`Skipping line ${i + 1}: Invalid Base64 sequence found: ${share.substring(0, 30)}...`);
                }
            } else {
                logger.warn(`Skipping line ${i + 1} (no valid Base64 share found): ${line.substring(0, 50)}...`);
            }
        }

        // Update UI status based on parsed shares
        if (shares.length > 0) {
            pasteSharesStatusDiv.textContent = (i18n.t('reconstruct.shares_found')) ? i18n.t('reconstruct.shares_found').replace('{n}', shares.length) : `${shares.length} potential share(s) found.`;
            pasteSharesStatusDiv.classList.remove('hidden');
        } else {
            pasteSharesStatusDiv.classList.add('hidden');
            throw new Error("No valid shares found in the pasted text. Ensure each share is on a new line and correctly Base64 encoded.");
        }

        logger.info(`Parsed ${shares.length} potential shares from text area.`);
        return shares; // Array of { shareIndex: number, share: string }
    };


    // --- Event Handlers ---

    // Theme switching buttons
    // --- Theme Management ---
    const themeToggleButton = document.getElementById('theme-toggle');

    // Function to apply the theme
    const setTheme = (theme) => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            if (themeToggleSwitch) themeToggleSwitch.checked = true;
        } else {
            document.documentElement.classList.remove('dark');
            if (themeToggleSwitch) themeToggleSwitch.checked = false;
        }
        localStorage.setItem(APP_CONFIG.THEME_STORAGE_KEY, theme);
    };

    // Single toggle button — CSS dark: classes swap the icon automatically
    if (themeToggleButton) {
        themeToggleButton.addEventListener('click', () => {
            const isDark = document.documentElement.classList.contains('dark');
            setTheme(isDark ? 'light' : 'dark');
        });
    }

    // --- Desktop Width Toggle ---
    const widthToggleBtn = document.getElementById('width-toggle');
    const widthIconExpand = document.getElementById('width-icon-expand');
    const widthIconShrink = document.getElementById('width-icon-shrink');
    const appShell = document.getElementById('app-shell');
    const WIDTH_STORAGE_KEY = 'desktopWidthMode';
    const NARROW_CLASS = 'max-w-xl';
    const WIDE_CLASS = 'max-w-6xl';

    const applyWidthMode = (isWide) => {
        if (!appShell) return;
        if (isWide) {
            appShell.classList.remove(NARROW_CLASS);
            appShell.classList.add(WIDE_CLASS);
            document.querySelectorAll('.' + NARROW_CLASS).forEach(el => {
                el.classList.remove(NARROW_CLASS); el.classList.add(WIDE_CLASS);
            });
            if (widthIconExpand) widthIconExpand.classList.add('hidden');
            if (widthIconShrink) widthIconShrink.classList.remove('hidden');
        } else {
            appShell.classList.remove(WIDE_CLASS);
            appShell.classList.add(NARROW_CLASS);
            document.querySelectorAll('.' + WIDE_CLASS).forEach(el => {
                el.classList.remove(WIDE_CLASS); el.classList.add(NARROW_CLASS);
            });
            if (widthIconExpand) widthIconExpand.classList.remove('hidden');
            if (widthIconShrink) widthIconShrink.classList.add('hidden');
        }
        localStorage.setItem(WIDTH_STORAGE_KEY, isWide ? 'wide' : 'narrow');
    };

    // Default to wide on desktop unless user explicitly chose narrow
    const storedWidth = localStorage.getItem(WIDTH_STORAGE_KEY);
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    if (isDesktop && storedWidth !== 'narrow') applyWidthMode(true);
    else if (storedWidth === 'wide') applyWidthMode(true);

    if (widthToggleBtn) {
        widthToggleBtn.addEventListener('click', () => {
            const isCurrentlyWide = appShell.classList.contains(WIDE_CLASS);
            applyWidthMode(!isCurrentlyWide);
        });
    }

    // Tab switching logic (Global delegator to support detached buttons)
    document.addEventListener('click', (e) => {
        const button = e.target.closest('.tab-button');
        if (!button || button.classList.contains('active')) return; // Ignore clicks outside buttons or on active button

        // Safety intercept: Tear down active hardware dependencies before DOM shifting
        if (typeof isScanning !== 'undefined' && isScanning.get()) {
            const tearDownBtn = document.getElementById('stopQrScannerModalButton');
            if (tearDownBtn) tearDownBtn.click();
        }

        // Update button active states across ALL tabs
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        // Show the target pane and hide others
        const targetId = button.dataset.target;
        tabPanes.forEach(pane => {
            if (`#${pane.id}` === targetId) {
                pane.classList.remove('hidden');
                pane.classList.add('active'); // Keep 'active' class if needed
                // Add animation class for fade-in
                pane.classList.remove('animate-fadeIn'); // Reset to re-trigger if needed
                void pane.offsetWidth; // Trigger reflow
                pane.classList.add('animate-fadeIn');
            } else {
                pane.classList.add('hidden');
                pane.classList.remove('active');
            }
        });

        // Reset scroll position to prevent "scroll ghosting" between tabs
        window.scrollTo(0, 0);
        const appShell = document.getElementById('app-shell');
        if (appShell) appShell.scrollTop = 0;

        logger.info(`Switched to tab: ${targetId.substring(1)}`);

        // Stop QR scanner if switching away from reconstruct tab or if not in QR mode
        if (targetId !== '#reconstruct' || currentReconMode.get() !== RECONSTRUCT_MODE.QR) {
            stopQRScanner();
        }
    });


    // --- 1-Click Card Routing ---

    reconModeOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Toggle .selected visual state immediately for tactile feedback
            reconModeOptions.forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');

            // Guard: intercept unsupported hardware clicks with micro-flash
            if (option.dataset.unsupported === 'true') {
                clearReconstructSelection();
                option.animate([
                    { opacity: 1 },
                    { opacity: 0.4 },
                    { opacity: 1 },
                    { opacity: 0.4 },
                    { opacity: 1 }
                ], { duration: 400, easing: 'ease-in-out' });
                flashCardError(option, 'settings.unsupported', 'Unsupported');
                return;
            }
            const mode = option.dataset.mode;

            // 1-click direct routing
            if (mode === 'inspect') {
                openInspectSheet('options');
                return;
            }
            if (mode === 'manual') {
                openManualEntrySheet();
                return;
            }
            if (mode === 'qr') {
                currentReconMode.set(RECONSTRUCT_MODE.QR);
                handleCameraPreFlight('reconstruct');
                return;
            }
            if (mode === 'nfc') {
                currentReconMode.set(RECONSTRUCT_MODE.NFC);
                requestNfcPermission(() => { startNfcScannerFlow('reconstruct'); });
                return;
            }
        });
    });


    // --- Event Listeners for Inspect Mode Sub-option Buttons ---
    // Event listener for the "Manual entry" button in the "Inspect Share" section

    // Event listener for the "Scan QR Code" button in the "Inspect Share" section
    // For Inspect Tab's "Scan QR Code" button


    // --- Unified Loading Action Sheet Helpers ---
    const _loadingSheet = document.getElementById('loading-action-sheet');
    const _loadingBackdrop = document.getElementById('loading-action-backdrop');
    const _loadingText = document.getElementById('loading-action-text');
    const _loadingSubtitle = document.getElementById('loading-action-subtitle');
    const _loadingCancelBtn = document.getElementById('loading-cancel-btn');

    function openLoadingSheet(text, subtitle) {
        if (!_loadingSheet || !_loadingBackdrop) return;
        if (_loadingText) _loadingText.textContent = text || safeTranslate('loading.default_text', 'Processing...');
        if (_loadingSubtitle) _loadingSubtitle.textContent = subtitle || safeTranslate('loading.default_subtitle', 'Please wait...');
        _loadingBackdrop.classList.remove('hidden');
        _loadingSheet.classList.remove('hidden');
        requestAnimationFrame(() => {
            _loadingBackdrop.classList.remove('opacity-0');
            _loadingBackdrop.classList.add('opacity-100');
            _loadingSheet.classList.remove('translate-y-full');
            _loadingSheet.classList.add('translate-y-0');
        });
        lockScroll();
    }

    function closeLoadingSheet() {
        if (!_loadingSheet || !_loadingBackdrop) return;
        _loadingBackdrop.classList.remove('opacity-100');
        _loadingBackdrop.classList.add('opacity-0');
        _loadingSheet.classList.remove('translate-y-0');
        _loadingSheet.classList.add('translate-y-full');
        setTimeout(() => {
            _loadingSheet.classList.add('hidden');
            _loadingBackdrop.classList.add('hidden');
        }, 300);
        unlockScroll();
    }

    /**
     * Wraps a heavy async operation with the unified loading sheet.
     * - Waits GENERATION_LOADING_DELAY_MS before showing the sheet.
     * - If shown, enforces LOADING_MIN_DISPLAY_MS minimum display.
     * - Cancel button aborts via activeEngineAbortController.
     * @param {Function} operationFn - Async function to execute.
     * @param {string} text - Title text for the loading sheet.
     * @param {string} subtitle - Subtitle text.
     * @returns {Promise<*>} - The result of operationFn.
     */
    async function executeWithLoadingSheet(operationFn, text, subtitle) {
        let sheetShownAt = null;
        let showTimerId = null;

        // Arm the delayed show
        showTimerId = setTimeout(() => {
            openLoadingSheet(text, subtitle);
            sheetShownAt = Date.now();
        }, APP_CONFIG.GENERATION_LOADING_DELAY_MS);

        try {
            const result = await operationFn();
            return result;
        } finally {
            // Clear the show timer if the operation finished before it fired
            if (showTimerId) clearTimeout(showTimerId);

            // If the sheet was shown, enforce minimum display time
            if (sheetShownAt !== null) {
                const elapsed = Date.now() - sheetShownAt;
                const remaining = APP_CONFIG.LOADING_MIN_DISPLAY_MS - elapsed;
                if (remaining > 0) {
                    await new Promise(r => setTimeout(r, remaining));
                }
                closeLoadingSheet();
            }

            // Clean up abort controller
            activeEngineAbortController.set(null);
        }
    }

    // Wire cancel button
    if (_loadingCancelBtn) {
        _loadingCancelBtn.addEventListener('click', () => {
            const controller = activeEngineAbortController.get();
            if (controller) controller.abort();
            closeLoadingSheet();
        });
    }

    // Generate Shares Button Click Handler


    genSubmitButton.addEventListener('click', async () => {
        // Clear previous errors/results
        genErrorDiv.textContent = '';
        genErrorDiv.classList.add('hidden');
        genResultDiv.classList.add('hidden');
        genSharesDiv.innerHTML = '';
        toggleButtonLoading(genSubmitButton, true); // Show loading state

        try {
            // Get input values
            const password = genPasswordInput.value;
            const confirmPassword = genConfirmPasswordInput.value;
            const comment = genCommentInput.value;
            const nStr = genNInput.value;
            const kStr = genKInput.value;
            const encryptionKey = genEncryptKeyInput.value;


            // Perform input validation (catches errors before calling core logic)
            if (password !== confirmPassword) throw new Error(i18n.t("generate.password_error_match") || "Passwords do not match.");
            if (!nStr || !kStr) throw new Error("Please enter values for Total Shares (n) and Threshold (k).");
            const n = parseInt(nStr);
            const k = parseInt(kStr);
            if (isNaN(n) || n < 1 || n > 64) throw new Error("Total Shares (n) must be between 1 and 64.");
            if (isNaN(k) || k < 1 || k > 64) throw new Error("Threshold (k) must be between 1 and 64.");
            // Length/character validations are handled within generateShares


            logger.info(`Generating shares: n=${n}, k=${k}, comment="${comment}", encrypted=${!!encryptionKey}`);

            // Read stealth mode toggle
            const isStealth = !!(document.getElementById('gen-stealth-toggle') && document.getElementById('gen-stealth-toggle').checked);

            // Wrap the heavy crypto operation with the unified loading sheet
            const shares = await executeWithLoadingSheet(
                () => splitSecret(password, n, k, { encryptionKey, comment, stealth: isStealth, schema: (cryptoSchemaSelect ? cryptoSchemaSelect.value : null) }),
                safeTranslate('generate.loading_title', 'Forging Cryptographic Shares...'),
                safeTranslate('generate.loading_subtitle', 'Securing with Two-Factor Encryption...')
            );

            //store the generated shares
            currentGeneratedShares.set(shares);
            lastGeneratedN.set(n); // Store the 'n' used for this generation
            lastGeneratedK.set(k); // Store the 'k' used for this generation

            // Add event listeners for the new "Copy All" and "Print All" buttons
            document.getElementById('gen-copy-all').onclick = () => copyAllSharesHandler();
            document.getElementById('gen-print-all').onclick = () => printAllSharesHandler();

            // ---- MODIFIED Event Listener for the Download Button ----
            const downloadButton = document.getElementById('gen-download');
            if (downloadButton) {
                downloadButton.onclick = () => {
                    if (!currentGeneratedShares.get() || currentGeneratedShares.get().length === 0) {
                        logger.warn('Download clicked, but no shares available.');
                        return;
                    }

                    try {
                        const blobUrl = saveSharesToCsv(currentGeneratedShares.get()); // Your existing function
                        const tempLink = document.createElement('a');
                        tempLink.href = blobUrl;

                        // --- CORRECTED Filename Logic ---
                        // Get n and k from the input fields used during generation
                        const meta = inspectShare(currentGeneratedShares.get()[0].share);
                        const familyId = meta.isValid ? meta.familyId : 'unknown';
                        const filename = `piecekeeper_shares_(${familyId}).csv`;
                        tempLink.download = filename;

                        document.body.appendChild(tempLink); // Append to body to make it clickable
                        tempLink.click();                     // Programmatically click the link
                        document.body.removeChild(tempLink);  // Remove the temporary link
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000); // Release the Blob URL

                        logger.info(`Shares CSV download initiated as ${filename}.`);
                    } catch (error) {
                        logger.error('Error generating or downloading CSV:', error);
                        logger.error(`Error preparing CSV for download: ${error.message}`);
                    }
                };
            }
            // ---- END MODIFIED Event Listener ----

            renderGeneratedSharesToUI(shares, lastGeneratedK.get());
            openGenResultSheet();

            // Auto-clear form but keep results visible
            if (typeof clearGenerateForm === 'function') {
                clearGenerateForm(true);
            }
        } catch (e) {
            // Display error message in the UI
            if (e.name === 'AbortError' || e.message === 'AbortError') {
                logger.info('Generation cancelled by user.');
                return;
            }
            genErrorDiv.textContent = `Error: ${e.message}`;
            genErrorDiv.classList.remove('hidden');
            logger.error(`Error generating shares: ${e.message}`);
            const genBtn = document.getElementById('gen-submit');
            flashButton(genBtn, safeTranslate('toast.gen_failed', 'Generation Failed'), 'rose');
        } finally {
            toggleButtonLoading(genSubmitButton, false); // Restore button state
            // Keep button disabled if the form was auto-cleared and missing a secret
            if (genPasswordInput && genPasswordInput.value === '') {
                genSubmitButton.disabled = true;
            }
        }
    });


    /**
     * Copies all generated shares to the clipboard, with headers and extra line breaks.
     */
    const copyAllSharesHandler = () => {
        if (!currentGeneratedShares.get() || currentGeneratedShares.get().length === 0) {
            return;
        }
        if (lastGeneratedN.get() == null || lastGeneratedK.get() == null) {
            logger.error('Copy all shares failed: lastGeneratedN.get() or lastGeneratedK.get() is null.');
            return;
        }

        let allSharesText = '';
        currentGeneratedShares.get().forEach((shareObject, index) => {
            const metadata = inspectShare(shareObject.share);
            const familyId = metadata.isValid ? metadata.familyId : 'N/A';
            const comment = shareObject.comment || 'None';
            // Use the stored timestamp which should be ISO format, then convert to locale for display
            let generatedTime = 'Unknown';
            if (shareObject.timestamp) {
                generatedTime = new Date(shareObject.timestamp).toLocaleString();
            } else if (metadata.isValid) {
                generatedTime = metadata.timestamp;
            }

            // Header for the share
            allSharesText += `// Share ${shareObject.shareIndex} of ${lastGeneratedN.get()} (K=${lastGeneratedK.get()}) - SetID: ${familyId} - Generated: ${generatedTime} - Note: ${comment}\n`;
            // The share itself
            allSharesText += `${shareObject.share}\n`;
            // Add an extra line break between shares, but not after the last one
            if (index < currentGeneratedShares.get().length - 1) {
                allSharesText += '\n';
            }
        });

        const copyBtn = document.getElementById('gen-copy-all');
        navigator.clipboard.writeText(allSharesText).then(() => {
            triggerHaptic('success');
            logger.info('All shares copied to clipboard.');
            if (copyBtn) {
                const origHTML = copyBtn.innerHTML;
                const origClass = copyBtn.className;
                copyBtn.className = origClass.replace(/border-slate-300 dark:border-slate-600/g, 'border-transparent').replace(/text-slate-700 dark:text-slate-200/g, 'text-white').replace(/bg-white dark:bg-slate-700/g, 'bg-emerald-600').replace(/hover:bg-slate-50 dark:hover:bg-slate-600/g, 'hover:bg-emerald-700');
                copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>' + safeTranslate('reconstruct.copied', 'Copied!') + '</span>';
                setTimeout(() => {
                    copyBtn.innerHTML = origHTML;
                    copyBtn.className = origClass;
                }, 2000);
            }
        }).catch(err => {
            logger.error('Failed to copy shares: ' + err);
        });
    };

    /**
                 * Generates the HTML content for a single printable share page.
                 * @param {object} shareObject - The share object { ShareIndex, Share, Comment, Timestamp, IsEncrypted }.
                 * @param {string} qrCodeDataUrl - The data URL of the QR code image for this share.
                 * @param {number} totalSharesN - The total number of shares in this set.
                 * @param {number} thresholdK - The minimum shares needed for reconstruction.
                 * @returns {string} HTML string for the printable page.
                 */
    preparePrintableShareHTML = (shareObject, qrCodeDataUrl, totalSharesN, thresholdK) => {
        logger.info(`preparePrintableShareHTML called for ShareIndex: ${shareObject.shareIndex}. IsEncrypted: ${shareObject.isEncrypted}`);
        // logger.info('Share Object for Single Printing:', JSON.parse(JSON.stringify(shareObject)));

        const metadata = inspectShare(shareObject.share);
        const familyId = metadata.isValid ? metadata.familyId : 'N/A';
        const displayTimestamp = shareObject.timestamp ?
            (new Date(shareObject.timestamp).toLocaleString()) :
            (metadata.isValid ? metadata.timestamp : 'Unknown');

        let pVer = shareObject.version || (typeof metadata !== 'undefined' && metadata && metadata.isValid ? metadata.version : 'v1');
        const cardHtml = buildShareCardHTML({
            shareIndex: shareObject.shareIndex,
            totalN: totalSharesN,
            thresholdK: thresholdK,
            qrCodeDataUrl: qrCodeDataUrl,
            version: pVer,
            familyId: familyId,
            comment: shareObject.comment || (typeof metadata !== 'undefined' && metadata && metadata.isValid ? metadata.comment : 'None'),
            timestamp: displayTimestamp,
            isEncrypted: shareObject.isEncrypted === true || (typeof metadata !== 'undefined' && metadata && metadata.isValid ? metadata.isEncrypted : false),
            shareString: shareObject.share,
            isCombined: false
        }, 'print');

        return `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <title>piecekeeper_(${familyId}).pdf</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; color: #333; }
                            .container { border: 1px solid #ccc; padding: 20px; max-width: 700px; margin: auto; box-shadow: 0 0 10px rgba(0,0,0,0.05); }
                            h1 { text-align: center; color: #333; margin-bottom: 5px; }
                            .header-info { text-align: center; font-size: 0.9em; color: #555; margin-bottom: 20px; }
                            .share-index { text-align:center; font-size: 1.8em; font-weight: bold; margin-bottom:15px;}
                            .qr-code-container { text-align: center; margin-bottom: 20px; }
                            .qr-code-container img { max-width: 280px; max-height: 280px; border: 1px solid #eee; }
                            .share-details { border: 1px solid #e0e0e0; padding: 15px; border-radius: 4px; background-color: #f9f9f9; margin-top: 15px;}
                            .share-details p { margin: 8px 0; font-size: 0.95em; }
                            .share-details strong { color: #444; min-width: 120px; display: inline-block;}
                            .share-text { 
                                font-family: monospace; 
                                word-break: break-all; 
                                background-color: #f0f0f0; 
                                padding: 12px; 
                                border: 1px dashed #ccc; 
                                margin-top: 15px;
                                white-space: pre-wrap;
                                font-size: 0.9em;
                                border-radius: 4px;
                            }
                            .footer-note { text-align:center; margin-top: 25px; font-size: 0.85em; color: #777; }
                            .password-alert-box {
                                margin-top: 10px; padding: 8px; border: 1px dashed #c0392b; background-color: #feF3f3; border-radius: 4px;
                            }
                            .password-alert-box p.title {
                                font-weight: bold; color: #c0392b; margin-top: 0; margin-bottom: 5px;
                            }
                            .password-alert-box p.note {
                                font-size: 0.88em; color: #444; margin-bottom: 0;
                            }
                            @media print {
                                body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                                .container { border: none; box-shadow: none; max-width: 100%; }
                                button { display: none !important; }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            ${cardHtml}
                        </div>
                    </body>
                    </html>
                `;
    };


    /**
     * Handles printing all generated shares, each on a separate page.
     */
    /**
     * Handles printing all generated shares, each on a separate page section.
     */
    const printAllSharesHandler = async () => {
        try {
            if (!currentGeneratedShares.get() || currentGeneratedShares.get().length === 0) {
                return;
            }
            if (lastGeneratedN.get() == null || lastGeneratedK.get() == null) {
                logger.error('Print all shares failed: lastGeneratedN.get() or lastGeneratedK.get() is null.');
                return;
            }

            const exportMode = document.getElementById('pdf-export-mode')?.value || EXPORT_MODE.COMBINED;
            if (exportMode === EXPORT_MODE.SEPARATE) {
                for (let i = 0; i < currentGeneratedShares.get().length; i++) {
                    setTimeout(() => printSingleShare(currentGeneratedShares.get()[i]), i * 1200);
                }
                return;
            }

            logger.info('Preparing to print all shares...');

            const firstMeta = inspectShare(currentGeneratedShares.get()[0].share);
            const printFamilyId = firstMeta.isValid ? firstMeta.familyId : 'unknown';
            let combinedHtml = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <title>piecekeeper_(${printFamilyId}).pdf</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 0; line-height: 1.6; color: #333; }
                            .share-page-container { 
                                page-break-before: always; 
                                padding: 20px; 
                                max-width: 700px; 
                                margin: 20px auto; 
                                border: 1px solid #ccc; /* Visible border for each share block unless printing */
                            }
                            .share-page-container:first-child {
                                page-break-before: auto; /* No page break before the very first share */
                                margin-top: 20px;
                            }
                            h1 { text-align: center; color: #333; margin-bottom: 5px;}
                            .header-info { text-align: center; font-size: 0.9em; color: #555; margin-bottom: 20px; }
                            .share-index { text-align:center; font-size: 1.8em; font-weight: bold; margin-bottom:15px;}
                            .qr-code-container { text-align: center; margin-bottom: 20px; }
                            .qr-code-container img { max-width: 280px; max-height: 280px; border: 1px solid #eee; }
                            .share-details { border: 1px solid #e0e0e0; padding: 15px; border-radius: 4px; background-color: #f9f9f9; margin-top: 15px;}
                            .share-details p { margin: 8px 0; font-size: 0.95em;}
                            .share-details strong { color: #444; min-width: 120px; display: inline-block;}
                            .share-text { 
                                font-family: monospace; 
                                word-break: break-all; 
                                background-color: #f0f0f0; 
                                padding: 12px; 
                                border: 1px dashed #ccc; 
                                margin-top: 15px;
                                white-space: pre-wrap;
                                font-size: 0.9em;
                                border-radius: 4px;
                            }
                            .footer-note { text-align:center; margin-top: 25px; font-size: 0.85em; color: #777; }
                            
                            /* Password note specific styles, can be reused */
                            .password-alert-box {
                                margin-top: 10px; padding: 8px; border: 1px dashed #c0392b; background-color: #feF3f3; border-radius: 4px;
                            }
                            .password-alert-box p.title {
                                font-weight: bold; color: #c0392b; margin-top: 0; margin-bottom: 5px;
                            }
                            .password-alert-box p.note {
                                font-size: 0.88em; color: #444; margin-bottom: 0;
                            }

                            @media print {
                                .share-page-container { 
                                    border: none !important; 
                                    box-shadow: none !important; 
                                    max-width: 100% !important; 
                                    margin: 0 auto !important; /* Minimal margin for print */
                                    padding: 10mm; /* Adjust padding for printing */
                                }
                                body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                            }
                        </style>
                    </head>
                    <body>
                `;

            for (let i = 0; i < currentGeneratedShares.get().length; i++) {
                const shareObj = currentGeneratedShares.get()[i];
                logger.info(`Processing share ${shareObj.shareIndex} for 'Print All'. IsEncrypted: ${shareObj.isEncrypted}`);

                const meta = inspectShare(shareObj.share);
                const ts = meta.isValid ? meta.timestamp : 'Unknown';
                const fam = meta.isValid ? meta.familyId : 'N/A';
                const comment = meta.isValid ? meta.comment : 'None';
                const isEncrypted = meta.isValid ? meta.isEncrypted : false;

                let qrUrl = '';
                try { const previewBytes = base64ToBytes(shareObj.share); qrUrl = await QRCode.toDataURL([{ data: previewBytes, mode: 'byte' }], { errorCorrectionLevel: 'Q' }); } catch (w) { }

                let pVer = shareObj.version || (meta.isValid ? meta.version : 'v1');
                combinedHtml += ` <div class="share-page-container" style="page-break-after: always; padding-bottom: 20px;">${buildShareCardHTML({
                    shareIndex: shareObj.shareIndex,
                    totalN: lastGeneratedN.get(),
                    thresholdK: lastGeneratedK.get(),
                    qrCodeDataUrl: qrUrl,
                    version: pVer,
                    familyId: fam,
                    comment: shareObj.comment || comment,
                    timestamp: shareObj.timestamp ? new Date(shareObj.timestamp).toLocaleString() : ts,
                    isEncrypted: shareObj.isEncrypted === true || isEncrypted,
                    shareString: shareObj.share,
                    isCombined: true
                }, 'print')}</div> `;
            }

            combinedHtml += '</body></html>';

            const printWindow = window.open('', '_blank', 'height=700,width=800,scrollbars=yes');
            if (printWindow) {
                printWindow.document.write(combinedHtml);
                printWindow.document.close();

                let printed = false;
                const triggerPrint = () => {
                    if (printed) return;
                    printed = true;
                    printWindow.focus();
                    printWindow.print();
                };

                printWindow.onload = triggerPrint;
                setTimeout(triggerPrint, 1500); // Trigger anyway after 1.5s
            } else {
            }
        } catch (e) {
            alert("FATAL PRINT ERROR: " + e.message + "\n\n" + e.stack);
            logger.error(e);
        }
    };


    /**
      * Validates the Generate Shares form inputs and enables/disables the submit button.
      */


    // Add input event listeners to re-validate the form dynamically
    genPasswordInput.addEventListener('input', validateGenForm);
    genConfirmPasswordInput.addEventListener('input', validateGenForm);
    genNInput.addEventListener('input', validateGenForm);
    genKInput.addEventListener('input', validateGenForm);
    genEncryptKeyInput.addEventListener('input', validateGenForm);
    genConfirmEncryptKeyInput.addEventListener('input', validateGenForm);

    // Event listener for "Inspect Share Data" button

    if (inspectSubmitButton) {
        inspectSubmitButton.addEventListener('click', async () => {
            const rawText = inspectShareInput ? inspectShareInput.value : '';
            if (!rawText.trim()) {
                flashButton(inspectSubmitButton, safeTranslate('toast.input_empty', 'Input Empty'), 'amber');
                return;
            }
            try {
                const parsedShares = parseManualShares(rawText);
                if (parsedShares && parsedShares.length > 0) {
                    await displayShareInspectionDetails(parsedShares[0].share);
                } else {
                    flashButton(inspectSubmitButton, safeTranslate('toast.invalid_data', 'Invalid Data'), 'rose');
                }
            } catch (e) {
                logger.error(`[Inspect] Crash: ${e.message}`);
                flashButton(inspectSubmitButton, safeTranslate('toast.inspect_failed', 'Inspect Failed'), 'rose');
            }
        });
    }


    // --- Paste Sheet Submit (Regex Extraction) ---
    const reconPasteSubmitBtn = document.getElementById('recon-paste-submit');
    if (reconPasteSubmitBtn) {
        reconPasteSubmitBtn.addEventListener('click', async () => {
            const pasteTextarea = document.getElementById('recon-shares');
            if (!pasteTextarea || !pasteTextarea.value.trim()) {
                flashButton(reconPasteSubmitBtn, safeTranslate('toast.input_empty', 'Input Empty'), 'amber');
                return;
            }

            // Regex extraction: match only Base64URL strings of 40+ chars
            // Safely ignores comments, blank lines, UUIDs, carriage returns
            const rawText = pasteTextarea.value;
            const regexMatches = rawText.match(/[A-Za-z0-9_-]{40,}/g) || [];

            // Validate each match is a genuine PieceKeeper share (Schema v2 header check)
            const validShares = regexMatches.filter(share => {
                try {
                    const meta = inspectShare(share);
                    return meta.isValid;
                } catch (_) { return false; }
            });

            if (validShares.length === 0) {
                flashButton(reconPasteSubmitBtn, safeTranslate('toast.invalid_data', 'Invalid Data'), 'rose');
                return;
            }

            // Password is handled by the unified Action Sheet — no legacy DOM field to copy

            toggleButtonLoading(reconPasteSubmitBtn, true);
            logger.info('[Paste Sheet] Extracted ' + validShares.length + ' valid share(s) via regex.');

            try {
                // Feed extracted shares into scannedRawSharesSet and set mode
                const shareSet = new Set(scannedRawSharesSet.get());
                let added = 0;
                for (const share of validShares) {
                    if (!shareSet.has(share)) {
                        shareSet.add(share);
                        added++;
                    }
                }
                scannedRawSharesSet.set(shareSet);

                // Also populate the textarea for the legacy PASTE mode path
                pasteTextarea.value = validShares.join('\n');

                // Set mode and attempt reconstruction
                currentReconMode.set(RECONSTRUCT_MODE.PASTE);
                const result = await attemptReconstruction();

                // Only clear if reconstruction completed (not paused for password)
                if (result !== 'paused') {
                    pasteTextarea.value = '';
                    if (typeof closeReconPasteSheet === 'function') closeReconPasteSheet();
                }
            } catch (e) {
                logger.error('[Paste Sheet] Reconstruction failed: ' + e.message);
                flashButton(reconPasteSubmitBtn, safeTranslate('toast.recon_failed', 'Failed'), 'rose');
                logger.error('Reconstruction failed: ' + e.message);
            } finally {
                toggleButtonLoading(reconPasteSubmitBtn, false);
            }
        });
    }

    // --- CSV Sheet Submit ---
    const reconCsvSubmitBtn = document.getElementById('recon-csv-submit');
    if (reconCsvSubmitBtn) {
        reconCsvSubmitBtn.addEventListener('click', async () => {
            // Password is handled by the unified Action Sheet — no legacy DOM field to copy
            // Set mode to CSV so attemptReconstruction reads from #recon-file input
            currentReconMode.set(RECONSTRUCT_MODE.CSV);
            toggleButtonLoading(reconCsvSubmitBtn, true);
            try {
                const result = await attemptReconstruction();
                // Only close if reconstruction completed (not paused for password)
                if (result !== 'paused') {
                    if (typeof closeReconCsvSheet === 'function') closeReconCsvSheet();
                }
            } catch (e) {
                logger.error('[CSV Sheet] Reconstruction failed: ' + e.message);
            } finally {
                toggleButtonLoading(reconCsvSubmitBtn, false);
            }
        });
    }


    // Eye toggle: click pill or eye icon to unmask/mask secret
    let secretIsVisible = false;
    const toggleSecretVisibility = () => {
        if (!reconstructedSecretData.get()) return;
        if (!secretIsVisible) {
            reconPasswordSpan.textContent = reconstructedSecretData.get().password;
            secretIsVisible = true;
            // Swap to eye-off icon
            if (secretEyeIcon) secretEyeIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
            logger.info('Secret revealed by user.');
        } else {
            reconPasswordSpan.textContent = '••••••••';
            secretIsVisible = false;
            // Swap back to eye icon
            if (secretEyeIcon) secretEyeIcon.innerHTML = '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>';
        }
    };
    // Eye icon: toggle visibility only (stopPropagation prevents pill copy)
    if (secretEyeIcon) {
        secretEyeIcon.style.cursor = 'pointer';
        secretEyeIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSecretVisibility();
        });
    }

    // Pill click: toggle secret visibility (same as eyeball — catches mis-clicks on the pill background)
    if (secretPill) {
        secretPill.addEventListener('click', () => {
            toggleSecretVisibility();
        });
    }

    // Context-aware Copy button: copies secret (reconstruct) or share (inspect)
    if (copySecretButton) {
        copySecretButton.addEventListener('click', () => {
            let textToCopy = '';
            // Reconstruct mode: copy the secret
            if (reconstructedSecretData.get() && reconstructedSecretData.get().password) {
                textToCopy = reconstructedSecretData.get().password;
            }
            // Inspect mode: copy the raw share string
            else if (lastInspectedShareForPasswordPrompt.get()) {
                textToCopy = lastInspectedShareForPasswordPrompt.get();
            }
            if (!textToCopy) {
                flashButton(copySecretButton, safeTranslate('toast.nothing_to_copy', 'Nothing to copy'), 'amber');
                return;
            }
            navigator.clipboard.writeText(textToCopy).then(() => {
                triggerHaptic('success');
                flashButton(copySecretButton, '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>' + safeTranslate('reconstruct.copied', 'Copied!') + '</span>', 'emerald');
                logger.info('Copied to clipboard.');
            }).catch(err => {
                flashButton(copySecretButton, safeTranslate('toast.failed_to_copy', 'Copy Failed'), 'rose');
                logger.error('Failed to copy: ' + err);
            });
        });
    }


    /**
     * Resets the state related to displaying the reconstruction result,
     * including the button text and the stored secret data.
     */


    // Add event listeners to reset reconstruction state when relevant inputs change
    reconSharesTextarea.addEventListener('input', () => {
        resetReconstructionButtonState();
        // Update status for pasted shares count
        const lines = reconSharesTextarea.value.trim().split('\n').filter(l => l.trim());
        pasteSharesStatusDiv.textContent = (i18n.t('reconstruct.lines_pasted')) ? i18n.t('reconstruct.lines_pasted').replace('{n}', lines.length) : `${lines.length} line(s) pasted.`;
        pasteSharesStatusDiv.classList.toggle('hidden', lines.length === 0);
    });


    reconFileInput.addEventListener('change', () => {
        resetReconstructionButtonState();
        const selectLabel = document.getElementById('recon-file-select-label');
        const fileChip = document.getElementById('recon-file-chip');
        const fileName = document.getElementById('recon-file-name');
        if (reconFileInput.files.length > 0) {
            if (fileName) fileName.textContent = reconFileInput.files[0].name;
            if (selectLabel) selectLabel.classList.add('hidden');
            if (fileChip) fileChip.classList.remove('hidden');
        } else {
            if (selectLabel) selectLabel.classList.remove('hidden');
            if (fileChip) fileChip.classList.add('hidden');
            if (fileName) fileName.textContent = '';
        }
    });


    // Modify existing event listener or add a new one for 'blur' or 'change'
    if (reconEncryptKeyInput) reconEncryptKeyInput.addEventListener('blur', async () => {
        const currentPassword = reconEncryptKeyInput.value;
        logger.info(`Password field blurred. Password is ${currentPassword ? 'present' : 'empty'}.`);

        if (!currentPassword) {
            reconEncryptKeyInput.dataset.previousPassword = "";
            if (currentReconMode.get() === RECONSTRUCT_MODE.QR && firstScannedShareEncryptedStatus.get() && requiredK.get() == null && qrSharesStatusDiv) {
                qrSharesStatusDiv.removeAttribute('data-i18n');
                qrSharesStatusDiv.textContent = `Scanned ${scannedRawSharesSet.get().size} encrypted share(s). Enter password to determine K & proceed.`;
                qrSharesStatusDiv.className = 'text-yellow-600 dark:text-yellow-400 text-sm font-semibold';
            }
            return;
        }

        // For Inspect Mode
        if (currentReconMode.get() === 'inspect' && lastInspectedShareForPasswordPrompt.get()) {
            logger.info('Password blurred during inspect mode with a pending share. Re-inspecting.');
            const shareToReInspect = lastInspectedShareForPasswordPrompt.get();
            await displayShareInspectionDetails(shareToReInspect);
            reconEncryptKeyInput.dataset.previousPassword = currentPassword;
            return;
        }

        // For QR Reconstruction Mode
        if (currentReconMode.get() === RECONSTRUCT_MODE.QR && firstScannedShareEncryptedStatus.get() && scannedRawSharesSet.get().size > 0) {
            logger.info('Password blurred during QR recon with encrypted shares. Re-evaluating scanned shares.');
            // Avoid showing "Processing..." toast if scanner is still active and user might just be continuing.
            // The status div will update.

            let determinedKInThisPass = null;
            let consistentK = true;
            let sharesSuccessfullyProcessedWithNewKey = 0;
            let processingErrorOccurred = false;

            reconEncryptKeyInput.disabled = true;
            if (qrSharesStatusDiv) qrSharesStatusDiv.textContent = "Verifying password with scanned shares...";


            for (const rawShare of scannedRawSharesSet.get()) {
                const tempMetadata = inspectShare(rawShare);
                if (tempMetadata.isEncrypted) {
                    try {
                        if (!tempMetadata.isValid || !tempMetadata.payload) {
                            logger.warn(`Skipping malformed share during password re-evaluation: ${rawShare.substring(0, 30)}`);
                            continue;
                        }
                        const processedShareData = tempMetadata.payload;
                        const decryptedPayload = await decryptBytes(processedShareData, currentPassword, true, tempMetadata.kdfSchema, tempMetadata.aadBytes);
                        // Binary payload: [N_u8, K_u8, X_u8, ...Y_bytes]
                        if (decryptedPayload && decryptedPayload.length >= 3) {
                            const kFromThisShare = decryptedPayload[1];
                            if (determinedKInThisPass === null) {
                                determinedKInThisPass = kFromThisShare;
                                logger.info(`Determined K=${determinedKInThisPass} from a scanned share using new password.`);
                            } else if (determinedKInThisPass !== kFromThisShare) {
                                logger.error(`Inconsistent K values found (${determinedKInThisPass} vs ${kFromThisShare}) after password entry.`);
                                consistentK = false; processingErrorOccurred = true; break;
                            }
                            sharesSuccessfullyProcessedWithNewKey++;
                        } else {
                            logger.warn(`Decrypted payload too short for share ${rawShare.substring(0, 30)} using new password.`);
                        }
                    } catch (e) {
                        logger.warn(`Failed to decrypt/process a scanned share with new password: ${e.message}`);
                        consistentK = false; processingErrorOccurred = true; break;
                    }
                }
            }

            reconEncryptKeyInput.disabled = false;

            if (consistentK && determinedKInThisPass !== null) {
                requiredK.set(determinedKInThisPass); // Set global requiredK.get()
                const neededShares = requiredK.get() - scannedRawSharesSet.get().size;

    

                if (neededShares <= 0) { // We have enough shares
                    logger.info(`Sufficient shares (${scannedRawSharesSet.get().size}/${requiredK.get()}) present after password entry. Attempting reconstruction.`);
                    if (isScanning.get()) { // If scanner was still active for some reason
                        logger.info("Scanner was active, stopping before reconstruction attempt triggered by password entry.");
                        stopQRScanner();
                    }
                    await attemptReconstruction();
                } else { // More shares are still needed
                    logger.info(`K determined as ${requiredK.get()}, but only ${scannedRawSharesSet.get().size} shares scanned. Need ${neededShares} more.`);
                    if (isScanning.get()) { // Scanner is currently active and user needs to continue scanning
                        // qrSharesStatusDiv already updated above to reflect this.
                    } else { // Scanner is not currently active
                    }
                }
            } else if (consistentK && sharesSuccessfullyProcessedWithNewKey === 0 && firstScannedShareEncryptedStatus.get() && !processingErrorOccurred) {
                logger.warn('Password entered, but could not determine K. Password likely incorrect for all scanned shares.');
                } else if (!consistentK && processingErrorOccurred) {
                }

            if (requiredK.get() == null && firstScannedShareEncryptedStatus.get() && !processingErrorOccurred && currentPassword) {                // This case implies password was entered, no errors during loop, but K still null (e.g. all shares failed parsing quietly)
                }
        }
        reconEncryptKeyInput.dataset.previousPassword = currentPassword;

        if (currentReconMode.get() !== RECONSTRUCT_MODE.QR && currentReconMode.get() !== 'inspect') {
            if (reconResultDiv && reconResultDiv.classList.contains('hidden')) {
                if (!reconSubmitButton.classList.contains('hidden')) {
                    reconstructedSecretData.set(null);
                    resetReconstructionButtonState();
                }
            }
        }
    });


    /**
    * MODIFIED: Starts the QR code scanner using the new modal.
    * Handles camera access, scanner initialization, and defines the onDecode callback.
    */


    // --- Helper to update the modal's main button state and its click action ---
    function updateModalStopButtonState(isScannerActiveAndShouldBeStoppable) {
        if (!stopQrScannerModalButton || !qrScannerModalStopButtonText || !qrScannerModalStopIcon || !qrScannerModalCloseIcon) {
            logger.error("Modal stop button elements not found in updateModalStopButtonState");
            return;
        }

        if (isScannerActiveAndShouldBeStoppable) {
            qrScannerModalStopButtonText.textContent = (i18n.t('scanner.stop_btn') || 'Stop Scanning');
            qrScannerModalStopIcon.classList.remove('hidden');
            qrScannerModalCloseIcon.classList.add('hidden');
            stopQrScannerModalButton.onclick = () => {
                logger.info("[Stop Button Clicked] Stopping active scan from modal button.");
                stopQRScanner();
            };
        } else {
            qrScannerModalStopButtonText.textContent = (i18n.t('scanner.close_btn') || 'Close Scanner');
            qrScannerModalStopIcon.classList.add('hidden');
            qrScannerModalCloseIcon.classList.remove('hidden');
            stopQrScannerModalButton.onclick = hideQrModal;
        }
    }


    // --- Stops the QR Scanner (Modal Version) ---




    // --- Test Suite Logic ---
    /**
     * Runs a suite of automated tests for share generation and reconstruction.
     */
    const runTests = async () => {
        isTesting.set(true);
        const tr = (key, fallback) => (typeof i18n !== 'undefined') ? i18n.t(`test.${key}`) || fallback : fallback;
        const currentSchemaProfile = document.getElementById('crypto-schema-select');
        const schemaName = currentSchemaProfile && currentSchemaProfile.options[currentSchemaProfile.selectedIndex] ? currentSchemaProfile.options[currentSchemaProfile.selectedIndex].text : 'Default';
        testResultDiv.classList.remove('hidden');
        testLogsOutput.innerHTML = `<span data-i18n="test.init">${tr('init', 'Initializing tests...')}</span><br/>`;
        if (testSubmitButton) testSubmitButton.classList.add('hidden');

        const testHeaderBanner = `<span class="text-xs text-slate-500 block">${safeTranslate('settings.crypto_in_use', 'Cryptographic setting {schema} in use - from settings').replace('{schema}', schemaName)}</span>`;
        let previousButtonHTML = '';
        if (testSubmitButton) {
            previousButtonHTML = testSubmitButton.innerHTML;
            testSubmitButton.disabled = true;
            testSubmitButton.innerHTML = `<svg class="animate-spin mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> <span data-i18n="test.running">${tr('running', 'Running...')}</span>`;
        }
        const output = [testHeaderBanner];
        let cryptoFailed = 0; let cameraFailed = 0; logger.info('Test Suite Started', true);

        const runSingleTest = async (key, name, testFn) => {
            output.push(`<div class="py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between"><span class="font-medium text-sm text-slate-700 dark:text-slate-300" data-i18n="test.${key}">${tr(key, name)}</span><span class="ml-2 text-sm font-semibold">`);
            testLogsOutput.innerHTML = output.join('') + `<span class="text-slate-500 dark:text-slate-400 animate-pulse text-sm" data-i18n="test.running_status">${tr('running_status', 'Running...')}</span>`;
            testLogsOutput.scrollTop = testLogsOutput.scrollHeight;
            await new Promise(resolve => setTimeout(resolve, 10));
            try {
                await testFn();
                output.push(`<span class="text-emerald-600 dark:text-emerald-400" data-i18n="test.pass">${tr('pass', 'PASS')}</span></span></div>`); logger.success(`Test PASS: ${name}`, true);
            } catch (e) {
                const isHardware = (key === "camera" || key === "nfc");
                if (isHardware) {
                    logger.warn(`Test WARN: ${name} - ${e.message}`, true);
                    output.push(`<span class="text-amber-500 dark:text-amber-400">${tr('unsupported', 'UNSUPPORTED')}</span></span></div>`);
                    cameraFailed++;
                } else {
                    logger.error(`Test FAIL: ${name} - ${e.message}`, true);
                    output.push(`<span class="text-red-600 dark:text-red-400" data-i18n="test.fail">${tr('fail', 'FAIL')}</span></span></div>`);
                    cryptoFailed++;
                }
            } finally {
                testLogsOutput.innerHTML = output.join('');
                testLogsOutput.scrollTop = testLogsOutput.scrollHeight;
                i18n.applyTranslations();
            }
        };

        try {
            const enginePayload = { generateShares: splitSecret, reconstructSecret: reconstructSecret };
            for (const test of pieceKeeperTests) {
                // Dynamically adopt active schema from local settings!
                const currentSchemaProfile = document.getElementById('crypto-schema-select')?.value || '1';

                await runSingleTest(test.key, test.name, async () => {
                    await test.fn(enginePayload);
                });
            }
        } finally {
            isTesting.set(false);
        }

        // Write test log output (tests only — no banner or buttons)
        testLogsOutput.innerHTML = output.join('');

        // Final summary banner — crypto-only, injected OUTSIDE the log box
        if (cryptoFailed === 0) {
            testFinalBanner.innerHTML = `<div class="flex items-center justify-center gap-2.5 p-3 mt-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium w-full"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>${tr('success', 'Cryptographic Engine Validated')}</span></div>`;
        } else {
            testFinalBanner.innerHTML = `<div class="flex items-center justify-center gap-2.5 p-3 mt-4 rounded-xl bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 font-medium w-full"><svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><span>${tr('error', 'Engine Validation Failed')}</span></div>`;
        }

        // Show the static Done button
        if (testDoneBtn) testDoneBtn.classList.remove('hidden');

        i18n.applyTranslations();

        if (testSubmitButton) {
            testSubmitButton.disabled = false;
            testSubmitButton.innerHTML = previousButtonHTML;
            // Keep Run button hidden — Done button will restore it
            i18n.applyTranslations();
        }
        if (cryptoFailed === 0) logger.success('Test Suite Completed', true); else logger.error('Test Suite Completed', true);
    }; // End of runTests


    // === Soft Disable Hardware: NFC & Camera ===
    const softDisableBtn = (btn) => {
        if (!btn) return;
        btn.classList.add('opacity-50');
        btn.setAttribute('data-unsupported', 'true');
    };
    // NFC check
    if (!('NDEFReader' in window)) {
        softDisableBtn(document.querySelector('.recon-option[data-mode="nfc"]'));
    }
    // Camera check deferred — hardware only accessed when user clicks QR card.
    // If mediaDevices API doesn't exist at all, soft-disable the card.
    if (!navigator.mediaDevices) {
        softDisableBtn(document.querySelector('.recon-option[data-mode="qr"]'));
    }

    // Attach test runner to button
    if (testSubmitButton) testSubmitButton.addEventListener('click', runTests);

    // Wire static Done button to reset the diagnostic UI
    if (testDoneBtn) {
        testDoneBtn.addEventListener('click', () => {
            // 1. Clear logs and banner
            testLogsOutput.innerHTML = '';
            testFinalBanner.innerHTML = '';
            // 2. Hide UI elements
            testDoneBtn.classList.add('hidden');
            testResultDiv.classList.add('hidden');
            // 3. Restore Run button
            if (testSubmitButton) testSubmitButton.classList.remove('hidden');
            // 4. Route back to Settings tab
            const settingsTab = document.querySelector('.tab-button[data-target="#settings"]');
            if (settingsTab) settingsTab.click();
            // 5. Reset scroll to top
            window.scrollTo(0, 0);
            const appShell = document.getElementById('app-shell');
            if (appShell) appShell.scrollTop = 0;
        });
    }

    // Initialize Theme Setting from localStorage
    const initialTheme = localStorage.getItem(APP_CONFIG.THEME_STORAGE_KEY) || 'light'; // Default to light
    // The setTheme function will also update the toggle switch if it exists
    setTheme(initialTheme);

    // Initialize Sound Setting from localStorage
    const storedSoundPreference = localStorage.getItem(APP_CONFIG.SOUND_ENABLED_STORAGE_KEY);
    if (storedSoundPreference !== null) {
        isSoundEnabled.set(storedSoundPreference === 'true');
    } else {
        isSoundEnabled.set(true); // Default: sound on if nothing is stored
        localStorage.setItem(APP_CONFIG.SOUND_ENABLED_STORAGE_KEY, String(true)); // Store default
    }
    // The reactive isSoundEnabled.subscribe initialized near DOM load handles the checkbox UI alignment automatically.

    // --- Initialization ---
    logger.info("PieceKeeper App Initialized");
    // Cards are 1-click actions — no default selection needed on init.

    if (typeof validateGenForm === "function") validateGenForm();
    document.querySelector('.tab-button[data-target="#generate"]')?.click();
    createIcons({ icons });

    // Set initial active tab to 'generate' and reconstruction mode to 'paste'
    // Use querySelector for safety in case elements aren't found initially
    document.querySelector('.tab-button[data-target="#generate"]')?.click();

    // Init Logs visibility state implicitly
    const logsEnabledInitial = localStorage.getItem('logsEnabled') === 'true';
    if (logsToggleSwitch) logsToggleSwitch.checked = logsEnabledInitial;
    if (logsContainerWrapper) {
        if (logsEnabledInitial) logsContainerWrapper.classList.remove('hidden');
        else logsContainerWrapper.classList.add('hidden');
    }

    // Completely nuke PWA setting hooks if dynamically running as a securely installed standalone window
    const pwaSettingsSection = document.getElementById('pwa-settings-section');
    if (pwaSettingsSection) {
        if (window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches || localStorage.getItem('pwaInstalled') === 'true') {
            pwaSettingsSection.remove();
        }
    }

    // QR Modal Close Button Handler
    qrModalCloseButton.addEventListener('click', () => {
        qrModal.classList.add('hidden'); // Hide the modal
    });
    // Allow closing QR modal by clicking the background overlay
    qrModal.addEventListener('click', (e) => {
        // Check if the click target is the modal background itself, not its content
        if (e.target === qrModal) {
            qrModal.classList.add('hidden');
        }
    });

    // --- Service Worker Registration for PWA ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(registration => {
                    logger.info('PieceKeeper Service Worker securely locked and active.');
                })
                .catch(error => {
                    logger.error('Core Service Worker logic failed to compile: ' + error);
                });
        });
    }

    // --- iOS PWA Custom Installation Prompt ---
    function checkForIOSInstallPrompt() {
        const isIos = () => {
            const userAgent = window.navigator.userAgent.toLowerCase();
            return /iphone|ipad|ipod/.test(userAgent);
        };

        const isStandalone = () => {
            return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        };

        if (isIos() && !isStandalone()) {
            const prompt = document.getElementById('ios-pwa-prompt');
            const closeBtn = document.getElementById('close-pwa-prompt');

            if (prompt && closeBtn) {
                // Check if user previously dismissed it today (optional, but good UX)
                const lastDismissed = localStorage.getItem('pwaPromptDismissed');
                const now = new Date().getTime();

                // Show if never dismissed or dismissed over 7 days ago (604800000 ms)
                if (!lastDismissed || (now - parseInt(lastDismissed) > 604800000)) {
                    setTimeout(() => {
                        prompt.classList.remove('hidden');
                    }, 3000); // Wait 3 seconds before showing
                }

                closeBtn.addEventListener('click', () => {
                    prompt.classList.add('hidden');
                    localStorage.setItem('pwaPromptDismissed', now.toString());
                });
            }
        }
    }

    // Evaluate on load
    checkForIOSInstallPrompt();


    // ==========================================
    // ==========================================


    let nfcAbortController = null;
    let currentNfcPurpose = null;

    // Re-use modals if they exist (built into index.html)


    // ================= PROGRESS ENGINE =================
    /**
     * Centralized Progress Engine API. Returns an instructional object containing localized strings,
     * numeric states, and boolean flags for cross-provider progress handling (NFC, QR, Manual, etc.)
     * 
     * @param {'nfc'|'qr'|'text'} provider - The hardware/software scanner provider
     * @param {'read'|'write'} action - The current operation
     * @param {number} current - Current operation numeric stage (e.g., number shares loaded)
     * @param {number|'?'} total - The minimum threshold K or absolute total N for the task
     * @param {'idle'|'success'|'error'|'done'} state - Sub-state flag for the provider cycle
     * @param {string} [customMsg] - Optional error specific messages or injection data
     */
    const getProgress = (provider, action, current, total, state = 'idle', customMsg = '') => {
        const i18nSafe = (key, params = {}) => {
            if (!i18n || !i18n.t) {
                // Manual hardcoded fallback if i18n is not ready
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
                let str = fallbacks[key] || '';
                str = str.replace('{c}', params.c || current);
                str = str.replace('{t}', params.t || total);
                str = str.replace('{msg}', params.msg || customMsg);
                return str;
            }

            let str = i18n.t(key);
            if (!str) return '';
            str = str.replace('{c}', params.c || current);
            str = str.replace('{t}', params.t || total);
            str = str.replace('{msg}', params.msg || customMsg);
            return str;
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
            result.instructionText = i18nSafe('progress.error_io', { msg: customMsg });
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
                    result.instructionText = i18nSafe('progress.nfc_read_next', { c: current + 1, t: total });
                }
            } else if (provider === 'qr') {
                if (current === 0) {
                    result.instructionText = i18nSafe('progress.qr_read_first');
                } else if (total === '?') {
                    result.instructionText = i18nSafe('progress.qr_read_next_unknown');
                } else {
                    result.instructionText = i18nSafe('progress.qr_read_next', { c: current + 1, t: total });
                }
            }
        } else if (action === 'write') {
            if (provider === 'nfc') {
                result.instructionText = i18nSafe('progress.nfc_write_next', { c: current + 1, t: total });
            }
        }

        return result;
    };

    // ================= WRITER =================


    // ================= READER =================


    // ================= PASSWORD PROMPT ACTION SHEET =================
    // CSP-compliant Enter key binding (DOM element is persistent, safe to bind once)
    const _pwdPromptInput = document.getElementById('password-prompt-input');
    if (_pwdPromptInput) {
        _pwdPromptInput.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                document.getElementById('password-prompt-submit').click();
            }
        });
    }

    document.addEventListener('click', async (e) => {
        // Decrypt button
        if (e.target.closest('#password-prompt-submit')) {
            const pw = document.getElementById('password-prompt-input').value;
            if (!pw) return;

            const errorEl = document.getElementById('password-prompt-error');
            const inputEl = document.getElementById('password-prompt-input');
            if (errorEl) errorEl.classList.add('hidden');

            const context = passwordPromptContext.get(); // 'reconstruct' | 'inspect'

            // ---- INSPECT CONTEXT ----
            if (context === 'inspect') {
                const shareString = pendingInspectShareString.get();
                if (!shareString) return;
                try {
                    const tempMeta = inspectShare(shareString);
                    if (!tempMeta.isValid || !tempMeta.payload) throw new Error('Malformed share data.');

                    // Test decryption — if password is wrong, AES-GCM will throw OperationError
                    await decryptBytes(tempMeta.payload, pw, true, tempMeta.kdfSchema, tempMeta.aadBytes);

                    // Password is correct — hide prompt, store password temporarily, re-run inspect with password
                    hidePasswordPrompt();
                    passwordPromptContext.set(null);
                    pendingInspectShareString.set(null);

                    // Store password in atom so displayShareInspectionDetails can read it
                    reconstructionPassword.set(pw);

                    await displayShareInspectionDetails(shareString);

                    // Wipe password from memory after inspection
                    reconstructionPassword.set('');
                } catch (err) {
                    logger.error('[Inspect Decrypt] ' + err.message);
                    // Wrong password during inspect — close modal, show partial details gracefully
                    hidePasswordPrompt();
                    passwordPromptContext.set(null);
                    if (inputEl) inputEl.value = '';

                    if (shareString) {
                        try {
                            const meta = inspectShare(shareString);
                            if (meta.isValid) {
                                const shareDataObj = {
                                    version: meta.version,
                                    familyId: meta.familyId,
                                    comment: meta.comment,
                                    timestamp: meta.timestamp,
                                    isEncrypted: meta.isEncrypted,
                                    warningMsg: safeTranslate('inspect.encrypted_partial', 'Payload is encrypted. Share index and threshold are hidden because a password was not provided.')
                                };
                                const inspResultDiv = document.getElementById('inspect-result');
                                if (inspResultDiv) {
                                    inspResultDiv.innerHTML = `<div class="space-y-1 text-sm">${buildShareCardHTML(shareDataObj, 'inspect')}</div>`;
                                    inspResultDiv.classList.remove('hidden');
                                }
                                hideNfcModal();
                                openResultModal('inspect');
                            }
                        } catch (fallbackErr) {
                            logger.error('[Inspect Fallback] ' + fallbackErr.message);
                        }
                    }
                    pendingInspectShareString.set(null);
                }
                return;
            }

            // ---- RECONSTRUCT CONTEXT (QR, NFC, or Manual) ----
            const mode = currentReconMode.get();
            let pending;
            if (mode === RECONSTRUCT_MODE.QR) pending = sharePendingKDetermination.get();
            else if (mode === RECONSTRUCT_MODE.NFC) pending = sharePendingKDeterminationNfc.get();
            else pending = sharePendingKDeterminationManual.get(); // Paste & CSV
            if (!pending) return;

            try {
                const tempMeta = inspectShare(pending.shareString);
                if (!tempMeta.isValid || !tempMeta.payload) throw new Error('Malformed share data.');

                const decryptedPayload = await decryptBytes(tempMeta.payload, pw, true, tempMeta.kdfSchema, tempMeta.aadBytes);
                if (!decryptedPayload || decryptedPayload.length < 3) throw new Error('Decrypted payload too short.');

                requiredK.set(decryptedPayload[1]);

                // Persist password into the reconstruction atom so attemptReconstruction can use it
                reconstructionPassword.set(pw);
                firstScannedShareEncryptedStatus.set(true);

                // Set familyId from the pending share metadata
                if (pending.familyId && !currentReconstructionFamilyId.get()) {
                    currentReconstructionFamilyId.set(pending.familyId);
                }

                // Inject the share into the scanned set
                if (!scannedRawSharesSet.get().has(pending.shareString)) {
                    const ds = new Set(scannedRawSharesSet.get()); ds.add(pending.shareString); scannedRawSharesSet.set(ds);
                }

                // Clear ALL pending atoms
                sharePendingKDetermination.set(null);
                sharePendingKDeterminationNfc.set(null);
                sharePendingKDeterminationManual.set(null);

                // Hide password prompt
                hidePasswordPrompt();
                passwordPromptContext.set(null);

                const newCount = scannedRawSharesSet.get().size;
                const thresholdReached = newCount >= requiredK.get();

                // Route based on currentReconMode — the single source of truth
                if (currentReconMode.get() === RECONSTRUCT_MODE.QR) {
                    triggerHaptic('success');
                    if (thresholdReached) {
                        setTimeout(() => {
                            AppEvents.dispatchEvent(new Event('reconstructReady'));
                        }, 350);
                    } else {
                        // Reopen scanner for the NEXT share (do NOT call startQRScanner which wipes state)
                        setTimeout(() => {
                            prepareAndShowScannerModal('reconstruct');
                            startQRScanner('reconstruct_resume');
                        }, 350);
                    }
                } else if (currentReconMode.get() === RECONSTRUCT_MODE.NFC) {
                    const progressEl = document.getElementById('nfc-modal-progress');
                    const statusEl = document.getElementById('nfc-modal-status');
                    if (progressEl) progressEl.textContent = newCount + '/' + requiredK.get() + ' ' + safeTranslate('scanner.scanned_label', 'Scanned');
                    if (statusEl) statusEl.textContent = safeTranslate('password_prompt.success', 'Password verified. Resuming scan...');

                    if (thresholdReached) {
                        const pd = getProgress('nfc', 'read', 0, 0, 'done');
                        if (statusEl) statusEl.textContent = pd.instructionText;
                        setTimeout(() => {
                            hideNfcModal();
                            AppEvents.dispatchEvent(new Event('reconstructReady'));
                        }, 350);
                    } else {
                        setTimeout(() => resumeNfcModal(), 350);
                    }
                } else {
                    // Manual modes (Paste/CSV) — password saved, just re-invoke reconstruction
                    setTimeout(() => attemptReconstruction(), 350);
                }
            } catch (err) {
                logger.error('Decryption Failed: ' + err.message);
                // Show inline error + retrigger shake via reflow for consecutive failures
                if (errorEl) errorEl.classList.remove('hidden');
                if (inputEl) {
                    inputEl.classList.remove('animate-shake', 'border-red-500');
                    void inputEl.offsetWidth; // Force browser reflow to retrigger animation
                    inputEl.classList.add('animate-shake', 'border-red-500');
                    inputEl.value = '';
                    inputEl.focus();
                    setTimeout(() => { inputEl.classList.remove('animate-shake', 'border-red-500'); }, 600);
                }
                triggerHaptic('error');
            }
        }

        // Cancel button — context-aware dismiss
        if (e.target.closest('#password-prompt-cancel')) {
            const context = passwordPromptContext.get();
            hidePasswordPrompt();

            // Unconditional state wipe — no pending data survives modal closure
            passwordPromptContext.set(null);
            const shareString = pendingInspectShareString.get();
            pendingInspectShareString.set(null);

            if (context === 'inspect') {
                // Graceful fallback: show partial inspect details without password
                if (shareString) {
                    // Build and show partial details using displayShareInspectionDetails
                                // So we need to render partial details manually here
                    try {
                        const meta = inspectShare(shareString);
                        if (meta.isValid) {
                            const shareDataObj = {
                                version: meta.version,
                                familyId: meta.familyId,
                                comment: meta.comment,
                                timestamp: meta.timestamp,
                                isEncrypted: meta.isEncrypted,
                                warningMsg: safeTranslate('inspect.encrypted_partial', 'Payload is encrypted. Share index and threshold are hidden because a password was not provided.')
                            };
                            const inspectResultDiv = document.getElementById('inspect-result');
                            if (inspectResultDiv) {
                                inspectResultDiv.innerHTML = `<div class="space-y-1 text-sm">${buildShareCardHTML(shareDataObj, 'inspect')}</div>`;
                                inspectResultDiv.classList.remove('hidden');
                            }
                            // Open result modal in inspect mode
                            hideNfcModal();
                            openResultModal('inspect');
                        }
                    } catch (err) {
                        logger.error('[Inspect Cancel] ' + err.message);
                    }
                }
            } else {
                // Reconstruct context — clear all pending atoms
                sharePendingKDetermination.set(null);
                sharePendingKDeterminationNfc.set(null);
                sharePendingKDeterminationManual.set(null);

                if (currentReconMode.get() === RECONSTRUCT_MODE.QR) {
                    setTimeout(() => {
                        prepareAndShowScannerModal('reconstruct');
                        startQRScanner('reconstruct');
                    }, 350);
                } else if (currentReconMode.get() === RECONSTRUCT_MODE.NFC) {
                    setTimeout(() => resumeNfcModal(), 350);
                }
            }
        }
    });

    document.addEventListener('click', (e) => {
        const X_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

        if (e.target.closest('#gen-nfc-all')) {
            const nfcBtn = e.target.closest('#gen-nfc-all');
            if (!('NDEFReader' in window)) {
                flashButton(nfcBtn, X_SVG, 'slate', 1200);
                try { if (navigator.vibrate) navigator.vibrate([30, 30, 30]); } catch (_) {}
                return;
            }
            if (typeof currentGeneratedShares.get() !== 'undefined' && currentGeneratedShares.get().length > 0) {
                requestNfcPermission(() => { startNfcMintingFlow(currentGeneratedShares.get().map(s => s.share)); });
            }
        }

        if (e.target.closest('.nfc-share-btn')) {
            const btn = e.target.closest('.nfc-share-btn');
            if (!('NDEFReader' in window)) {
                flashButton(btn, X_SVG, 'slate', 1200);
                try { if (navigator.vibrate) navigator.vibrate([30, 30, 30]); } catch (_) {}
                return;
            }
            const shareData = btn.getAttribute('data-share');
            if (shareData) {
                requestNfcPermission(() => { startNfcMintingFlow([shareData]); });
            }
        }
    });


}); // End DOMContentLoaded

/**
* QR Modal exported bridge.
*/
export const showQRCode = (share) => {
    const qrCodeDivTarget = document.getElementById('qr-code');
    if (!qrCodeDivTarget) return;

    qrCodeDivTarget.innerHTML = ''; // Clear previous QR code
    const canvas = document.createElement('canvas');
    canvas.id = 'qr-canvas'; // Assign ID if needed for styling/reference
    qrCodeDivTarget.appendChild(canvas);

    // Estimate required QR code size based on data length (optional refinement)
    // This is complex; qrcode library usually handles sizing well automatically.
    // We can provide a desired width, and it will adjust.
    const desiredWidth = 256; // Target width for the QR code

    const shareBytes = base64ToBytes(share);
    QRCode.toCanvas(canvas, [{ data: shareBytes, mode: 'byte' }], {
        width: desiredWidth,
        margin: 2, // Small margin around QR code
        errorCorrectionLevel: 'Q' // Quartile error correction (25% redundancy)
    }, (error) => {
        if (error) {
            qrCodeDivTarget.textContent = 'Failed to generate QR code.'; // Show error in modal
            logger.error(`Failed to generate QR code: ${error.message}`);
        } else {
            qrModal.classList.remove('hidden'); // Show the modal containing the canvas
            logger.info(`Generated QR code for share (binary byte mode).`);
        }
    });

};


/**
     * Prints a single share to a new page.
     * @param {object} shareObject - The share object to print.
     */
export const printSingleShare = async (shareObject) => {
    if (!shareObject) return;
    let n = lastGeneratedN.get();
    let k = lastGeneratedK.get();
    // Fallback: extract N/K from the share binary metadata
    if (n == null || k == null) {
        try {
            const meta = inspectShare(shareObject.share);
            if (meta.isValid && meta.showParsedValues) {
                n = n ?? meta.totalN;
                k = k ?? meta.thresholdK;
            }
        } catch (_) {}
    }
    if (n == null || k == null) {
        logger.error('Print single share failed: could not determine N/K from state or share metadata.');
        return;
    }
    logger.info(`Preparing to print share index: ${shareObject.shareIndex}`);
    try {
        const canvas = document.createElement('canvas');
        const printShareBytes = base64ToBytes(shareObject.share);
        await QRCode.toCanvas(canvas, [{ data: printShareBytes, mode: 'byte' }], { width: 256, margin: 2, errorCorrectionLevel: 'Q' });
        const qrCodeDataUrl = canvas.toDataURL('image/png');

        // Pass lastGeneratedN.get() and lastGeneratedK.get()
        const printHtml = preparePrintableShareHTML(shareObject, qrCodeDataUrl, n, k);

        const printWindow = window.open('', '_blank', 'height=700,width=800,scrollbars=yes');
        if (printWindow) {
            printWindow.document.write(printHtml);
            printWindow.document.close();

            let printed = false;
            const triggerPrint = () => {
                if (printed) return;
                printed = true;
                printWindow.focus();
                printWindow.print();
            };

            printWindow.onload = triggerPrint;
            setTimeout(triggerPrint, 1500); // Trigger anyway after 1.5s
        } else {
            logger.warn('Print popup was blocked by the browser. Please allow popups for this site.');
        }
    } catch (error) {
        logger.error('Error preparing share for printing:', error);
        logger.error(`Error printing share ${shareObject.shareIndex}: ${error.message}`);
    }
};


/**
     * Prepares and opens a mailto link to email a single share.
     * @param {object} shareObject - The share object to email.
     */
export const emailSingleShare = async (shareObject) => {
    if (!shareObject) return;
    const tr = safeTranslate;
    logger.info(`Preparing to email share index: ${shareObject.shareIndex}`);
    try {
        const metadata = inspectShare(shareObject.share);
        const familyId = metadata.isValid ? metadata.familyId : 'N/A';
        const displayTimestamp = shareObject.timestamp ?
            (new Date(shareObject.timestamp).toLocaleString()) :
            (metadata.isValid ? metadata.timestamp : 'Unknown');

        const subject = tr('email.subject', 'PieceKeeper Share - Index {index}').replace('{index}', shareObject.shareIndex);
        let body = `${tr('email.body_intro', 'Here is your PieceKeeper share:')}\n\n`;
        body += `${tr('email.share_index', 'Share Index:')} ${shareObject.shareIndex}\n`;
        body += `${tr('email.set_id', 'Set ID:')} ${familyId}\n`;
        body += `${tr('email.comment', 'Comment/Note:')} ${shareObject.comment || tr('email.none', 'None')}\n`;
        body += `${tr('email.generated', 'Generated:')} ${displayTimestamp}\n`;
        body += `${tr('email.password_enc', 'Additional password encryption:')} ${shareObject.isEncrypted ? tr('email.yes', 'Yes') : tr('email.no', 'No')}\n\n`;
        body += `${tr('email.share_data', 'Share Data (Base64):')}\n${shareObject.share}\n\n`;
        body += `${tr('email.instructions', "To reconstruct, paste this share into PieceKeeper's Reconstruct tab, or use the app's QR scanner to scan the QR code from the Generate screen.")}\n\n`;
        body += `${tr('email.keep_secure', 'Keep this share secure.')}\n\nPieceKeeper: https://github.com/MidnightLogic/PieceKeeper\n`;

        const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

        // Attempt to open mail client
        window.open(mailtoLink, '_self');

    } catch (error) {
        logger.error('Error preparing share for email:', error);
        logger.error(`Error emailing share ${shareObject.shareIndex}: ${error.message}`);
    }
};
