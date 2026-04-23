/**
 * PieceKeeper Cryptographic Test Definitions
 * 
 * This module abstracts the core cryptographic mathematical regressions.
 * It uses dependency injection to pull in the operational `engine` handles
 * (generateShares, reconstructSecret) directly from the application's root closure.
 * 
 * To add a new test, simply append a definition block to `pieceKeeperTests`.
 */

import { logger } from './logger.js';
import { i18n } from './i18n.js';

/** Escapes HTML special characters for safe innerHTML insertion. Display-only — never mutates stored data. */
export const escapeHtml = (str) => {
    if (typeof str !== 'string') return String(str ?? '');
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

export const isNfcSupported = () => { return 'NDEFReader' in window; };

export const isAndroid = () => { return /Android/i.test(navigator.userAgent); };

export const stringToBigInt = (str) => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    // Note: The original limit was checked here, but MAX_PASSWORD_LENGTH was defined elsewhere.
    // If we exceed general sizes, catching errors is ideal.
    let hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return BigInt('0x' + (hex || '0'));
};

export const bigIntToString = (bigInt) => {
    try {
        let hex = bigInt.toString(16);
        if (hex.length % 2) hex = '0' + hex;
        if (hex === '00' || hex === '') return '';
        const bytes = new Uint8Array(hex.match(/.{2}/g).map(byte => parseInt(byte, 16)));
        const decoder = new TextDecoder('utf-8', { fatal: true });
        return decoder.decode(bytes);
    } catch (e) {
        throw new Error("Failed to decode reconstructed secret. Check if enough correct shares were provided or if the secret was originally valid UTF-8. (" + e.message + ")");
    }
};

export const getCryptoRandomBigInt = (maxValue) => {
    if (maxValue <= 0n) throw new Error("maxValue must be positive for random generation.");
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

export const modularInverse = (a, p) => {
    a = (a % p + p) % p;
    if (a === 0n) throw new Error("Cannot compute modular inverse of 0");

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



export function safeTranslate(key, fallback) {
    if (i18n && typeof i18n.t === 'function') {
        const translated = i18n.t(key);
        if (translated) return translated;
    }
    return fallback;
}


export const bigIntToBytes = (bi) => {
    let hex = bi.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
};

export const bytesToBigInt = (bytes) => {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return BigInt('0x' + hex);
};

export const copyToClipboard = (text, type = 'Share') => {
    return navigator.clipboard.writeText(text).then(() => {
        logger.info(`Copied ${type} to clipboard: ${text.substring(0, 20)}...`);
        return true;
    }).catch(err => {
        logger.error(`Failed to copy to clipboard: ${err}`);
        return false;
    });
};

export const toggleButtonLoading = (button, isLoading) => {
    if (!button) return;
    const textSpan = button.querySelector('.button-text');
    const spinner = button.querySelector('.button-spinner');
    if (isLoading) {
        button.disabled = true;
        if (textSpan) textSpan.style.opacity = '0';
        if (spinner) spinner.classList.remove('hidden');
    } else {
        button.disabled = false;
        if (textSpan) textSpan.style.opacity = '1';
        if (spinner) spinner.classList.add('hidden');
    }
};

export const updateRtlDirection = (langCode) => {
    const rtlToggleSwitch = document.getElementById('rtl-toggle-switch');
    const persisted = localStorage.getItem('rtl_override');
    const isNativeRtl = ['ar', 'he'].includes(langCode);

    let shouldBeRtl = isNativeRtl; // Default to natural language geometry
    if (persisted === 'true') shouldBeRtl = true;
    if (persisted === 'false') shouldBeRtl = false;

    if (rtlToggleSwitch) rtlToggleSwitch.checked = shouldBeRtl;

    if (shouldBeRtl) {
        document.documentElement.setAttribute('dir', 'rtl');
    } else {
        document.documentElement.removeAttribute('dir');
    }
};

export const setPasswordVisibility = (inputId, btn, isVisible) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    // Toggle CSS-based masking via data attribute (avoids Chrome credential detection)
    if (isVisible) {
        input.removeAttribute('data-secret-mask');
    } else {
        input.setAttribute('data-secret-mask', '');
    }

    const svg = btn.querySelector('svg');
    if (!svg) return;

    if (isVisible) {
        // Show "Eye Off" icon (indicating releasing will hide)
        svg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />';
    } else {
        // Show "Eye" icon (indicating holding will show)
        svg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />';
    }
};

/**
 * Flashes a button with a temporary state (color + text) for micro-interaction feedback.
 * @param {HTMLElement|null} btn - The button element to flash.
 * @param {string} text - Short label to show during flash.
 * @param {'amber'|'rose'|'emerald'|'slate'} color - Tailwind color family.
 * @param {number} [duration=2000] - Duration in ms before restoring.
 */
export const flashButton = (btn, text, color = 'amber', duration = 2000) => {
    if (!btn) return;
    // Inline haptic — avoids circular dep with hardware.js
    try { if (navigator.vibrate) navigator.vibrate(color === 'emerald' ? [50] : [30, 30, 30]); } catch (_) {}
    const origHTML = btn.innerHTML;
    const origClass = btn.className;

    // Lock current dimensions to prevent shrinkage when content changes
    const rect = btn.getBoundingClientRect();
    btn.style.minWidth = `${rect.width}px`;
    btn.style.minHeight = `${rect.height}px`;

    // Preserve structural classes by keeping only layout/sizing/spacing tokens
    const structural = origClass.split(/\s+/).filter(c =>
        /^(w-|h-|min-|max-|p[xytblr]?-|m[xytblr]?-|flex|inline-flex|grid|items-|justify-|gap-|rounded|font-|transition|duration|ease|shrink|grow|overflow|cursor|select|z-|relative|absolute|fixed|inset|top-|bottom-|left-|right-|opacity|hidden|block|inline|self-)/.test(c)
    ).join(' ');

    const shades = {
        amber:   ['bg-amber-600', 'dark:bg-amber-700'],
        rose:    ['bg-rose-700',   'dark:bg-rose-800'],
        emerald: ['bg-emerald-600','dark:bg-emerald-700'],
        slate:   ['bg-slate-500',  'dark:bg-slate-600']
    };
    const [light, dark] = shades[color] || shades.amber;
    btn.className = `${structural} ${light} ${dark} text-white border border-transparent flex items-center justify-center`;
    btn.innerHTML = text;
    btn.disabled = true;
    setTimeout(() => {
        btn.innerHTML = origHTML;
        btn.className = origClass;
        btn.style.minWidth = '';
        btn.style.minHeight = '';
        btn.disabled = false;
    }, duration);
};

/**
 * Enables swipe-to-dismiss on a bottom sheet's drag handle.
 * Works with both touch (mobile) and mouse drag (desktop).
 * The sheet must use translate-y-full/translate-y-0 for open/close transitions.
 *
 * @param {HTMLElement} handleEl - The drag handle wrapper element.
 * @param {HTMLElement} sheetEl - The bottom sheet container.
 * @param {Function} dismissFn - Callback to fully close/hide the sheet.
 * @param {number} [threshold=100] - Pixels to drag before triggering dismiss.
 */
export const enableSwipeToDismiss = (handleEl, sheetEl, dismissFn, threshold = 100) => {
    if (!handleEl || !sheetEl || !dismissFn) return;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    const onStart = (clientY) => {
        isDragging = true;
        startY = clientY;
        currentY = 0;
        // Disable CSS transition during drag for real-time tracking
        sheetEl.style.transition = 'none';
    };

    const onMove = (clientY) => {
        if (!isDragging) return;
        const deltaY = clientY - startY;
        // Only allow dragging downward (positive delta)
        currentY = Math.max(0, deltaY);
        sheetEl.style.transform = `translateY(${currentY}px)`;
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        // Restore CSS transition
        sheetEl.style.transition = '';
        sheetEl.style.transform = '';

        if (currentY >= threshold) {
            dismissFn();
        }
        currentY = 0;
    };

    // Touch events (mobile)
    handleEl.addEventListener('touchstart', (e) => {
        onStart(e.touches[0].clientY);
    }, { passive: true });

    handleEl.addEventListener('touchmove', (e) => {
        onMove(e.touches[0].clientY);
    }, { passive: true });

    handleEl.addEventListener('touchend', onEnd);

    // Mouse events (desktop)
    handleEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onStart(e.clientY);

        const mouseMoveHandler = (me) => onMove(me.clientY);
        const mouseUpHandler = () => {
            onEnd();
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
        };

        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    });

    // Visual hint: cursor style
    handleEl.style.cursor = 'grab';
};
