/**
 * PieceKeeper Logger Engine
 * A zero-dependency Pure ES6 Module for application logging.
 * Dispatches native CustomEvents to decouple the presentation layer from the core cryptography engine.
 */

class PieceKeeperLogger {
    constructor() {
        this.cache = [];
        this._domPanel = null;
        this._placeholderCleared = false;
    }

    /**
     * Binds the logger output to a DOM element for real-time UI rendering.
     * Called once after DOMContentLoaded by the presentation layer.
     */
    bindToPanel(panelElementId) {
        this._domPanel = document.getElementById(panelElementId);

        // Replay any cached entries that fired before DOM was ready
        if (this._domPanel) {
            for (const entry of this.cache) {
                this._appendToPanel(entry);
            }
        }
    }

    _appendToPanel(payload) {
        if (!this._domPanel) return;

        // Clear placeholder on first real log entry
        if (!this._placeholderCleared) {
            this._domPanel.innerHTML = '';
            this._placeholderCleared = true;
        }

        const colorMap = {
            info: 'color: var(--color-slate-400, #94a3b8);',
            warn: 'color: var(--color-amber-400, #fbbf24);',
            error: 'color: var(--color-red-400, #f87171);',
            success: 'color: var(--color-emerald-400, #34d399);'
        };

        const entry = document.createElement('div');
        entry.style.cssText = colorMap[payload.level] || colorMap.info;
        entry.style.lineHeight = '1.6';

        const time = payload.timestamp.split('T')[1].split('.')[0];
        const levelTag = payload.level.toUpperCase().padEnd(7);
        entry.textContent = time + ' [' + levelTag + '] ' + payload.message;

        this._domPanel.appendChild(entry);
        this._domPanel.scrollTop = this._domPanel.scrollHeight;
    }

    _dispatch(level, message, forceUi = false) {
        const timestamp = new Date().toISOString();
        const payload = { timestamp, level, message, forceUi };
        this.cache.push(payload);

        // Write to DOM panel in real-time
        this._appendToPanel(payload);
        
        // Dispatch to window (presentation UI or DevTools should intercept this)
        const event = new CustomEvent('piecekeeper-log-added', { detail: payload });
        window.dispatchEvent(event);
    }

    info(message, forceUi = false) {
        console.log(`[PieceKeeper INFO] ${message}`);
        this._dispatch('info', message, forceUi);
    }

    warn(message, forceUi = false) {
        console.warn(`[PieceKeeper WARN] ${message}`);
        this._dispatch('warn', message, forceUi);
    }

    error(message, forceUi = false) {
        console.error(`[PieceKeeper ERROR] ${message}`);
        this._dispatch('error', message, forceUi);
    }
    
    success(message, forceUi = false) {
        console.log(`[PieceKeeper SUCCESS] ${message}`);
        this._dispatch('success', message, forceUi);
    }
}

export const logger = new PieceKeeperLogger();
