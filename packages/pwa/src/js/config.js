/**
 * PieceKeeper PWA Configuration
 * 
 * Re-exports the core cryptographic configuration and adds PWA-specific settings.
 * All existing PWA imports of APP_CONFIG continue to work unchanged.
 */

import { APP_CONFIG as CORE_CONFIG } from '@midnightlogic/piecekeeper-crypto';

export const APP_CONFIG = {
    ...CORE_CONFIG,

    // PWA-specific Environment/Frontend Settings
    THEME_STORAGE_KEY: 'theme',
    SOUND_ENABLED_STORAGE_KEY: 'soundEnabled',
    GENERATION_LOADING_DELAY_MS: 1000,      // Delay before showing loading sheet
    LOADING_MIN_DISPLAY_MS: 2000,            // Minimum time loading sheet stays visible once shown
    GLOBAL_AUDIO_VOLUME: 0.5
};
