/**
 * RSVP Reader - Timing Manager Module
 * Handles word duration calculation, warmup progression, and time formatting.
 * 
 * Features:
 * - Adaptive word timing based on length and punctuation
 * - Warmup period with pause/resume support
 * - Eased warmup progression for comfort
 * - Unicode punctuation support
 * - Performance-optimized hot path
 * 
 * Dependencies: CONFIG from config.js, State from state-manager.js,
 *               getMaxWordLength from orp-calculator.js
 */

import { CONFIG } from './config.js';
import { State } from './state-manager.js';
import { getMaxWordLength } from './orp-calculator.js';

/**
 * @typedef {Object} WarmupState
 * @property {boolean} active - Whether warmup is currently active
 * @property {boolean} paused - Whether warmup is paused
 * @property {number|null} startTime - Timestamp when warmup started
 * @property {number} elapsedBeforePause - Elapsed time before pause (ms)
 * @property {number} progress - Progress from 0 to 1
 */

/**
 * Internal warmup state
 * @type {WarmupState}
 */
const warmupState = {
    active: false,
    paused: false,
    startTime: null,
    elapsedBeforePause: 0,
    progress: 1
};

/**
 * Start the warmup period
 * Warmup gradually increases speed from a slower starting point.
 * 
 * @param {boolean} [force=false] - Start even if warmupEnabled is false
 */
export function startWarmup(force = false) {
    if (force || State.get('warmupEnabled')) {
        warmupState.active = true;
        warmupState.paused = false;
        warmupState.startTime = Date.now();
        warmupState.elapsedBeforePause = 0;
        warmupState.progress = 0;
    }
}

/**
 * Pause the warmup timer
 * Call this when reading is paused to prevent warmup completing during pause.
 */
export function pauseWarmup() {
    if (warmupState.active && !warmupState.paused && warmupState.startTime) {
        warmupState.paused = true;
        warmupState.elapsedBeforePause += Date.now() - warmupState.startTime;
    }
}

/**
 * Resume the warmup timer
 * Call this when reading resumes after a pause.
 */
export function resumeWarmup() {
    if (warmupState.active && warmupState.paused) {
        warmupState.paused = false;
        warmupState.startTime = Date.now();
    }
}

/**
 * Reset warmup state
 */
export function resetWarmup() {
    warmupState.active = false;
    warmupState.paused = false;
    warmupState.startTime = null;
    warmupState.elapsedBeforePause = 0;
    warmupState.progress = 1;
}

/**
 * Complete warmup immediately
 * Useful when user manually skips warmup.
 */
export function completeWarmup() {
    warmupState.active = false;
    warmupState.paused = false;
    warmupState.progress = 1;
}

/**
 * Easing function for warmup progression
 * Uses ease-out-quad for a more comfortable speed increase.
 * 
 * @private
 * @param {number} t - Linear progress (0 to 1)
 * @returns {number} Eased progress (0 to 1)
 */
function easeOutQuad(t) {
    return t * (2 - t);
}

/**
 * Get current warmup progress (0 to 1)
 * This is a pure getter - it does NOT modify warmup state.
 * Use updateWarmup() to advance the warmup timer.
 * 
 * @returns {number} Progress value from 0 (start) to 1 (complete)
 */
export function getWarmupProgress() {
    return warmupState.progress;
}

/**
 * Update warmup state based on elapsed time
 * Call this on each frame/word to advance the warmup.
 * 
 * @returns {number} Current progress (0 to 1)
 */
export function updateWarmup() {
    if (!warmupState.active || warmupState.paused) {
        return warmupState.progress;
    }
    
    if (!warmupState.startTime) {
        return 1;
    }
    
    // Calculate total elapsed time including time before pause
    const currentElapsed = Date.now() - warmupState.startTime;
    const totalElapsed = warmupState.elapsedBeforePause + currentElapsed;
    
    // Get warmup duration from state, fallback to CONFIG
    const durationS = State.get('warmupDuration') ?? CONFIG.WARMUP.DEFAULT_DURATION_S;
    const durationMs = durationS * 1000;
    
    // Calculate linear progress
    const linearProgress = Math.min(1, totalElapsed / durationMs);
    
    // Apply easing for more comfortable progression
    const easedProgress = easeOutQuad(linearProgress);
    
    warmupState.progress = easedProgress;
    
    // Complete warmup when done
    if (linearProgress >= 1) {
        warmupState.active = false;
        warmupState.progress = 1;
    }
    
    return warmupState.progress;
}

/**
 * Check if warmup is currently active
 * @returns {boolean}
 */
export function isWarmupActive() {
    return warmupState.active;
}

/**
 * Check if warmup is paused
 * @returns {boolean}
 */
export function isWarmupPaused() {
    return warmupState.active && warmupState.paused;
}

/**
 * Get the current effective WPM considering warmup
 * During warmup, WPM starts at startRatio and increases to target.
 * 
 * @param {number} targetWpm - Target WPM setting
 * @returns {number} Current effective WPM
 * 
 * @example
 * // At warmup start (progress=0), targetWpm=300
 * getCurrentWPM(300) // Returns ~150 (300 * 0.5)
 * 
 * // At warmup complete (progress=1)
 * getCurrentWPM(300) // Returns 300
 */
export function getCurrentWPM(targetWpm) {
    if (!warmupState.active || warmupState.progress >= 1) {
        return targetWpm;
    }
    
    const progress = warmupState.progress;
    const startRatio = CONFIG.TIMING.WARMUP_START_RATIO;
    
    // Linear interpolation from startRatio to 1
    const currentRatio = startRatio + (1 - startRatio) * progress;
    
    return Math.round(targetWpm * currentRatio);
}

/**
 * Check if character code is a full stop (sentence-ending punctuation)
 * Supports ASCII and Unicode punctuation.
 * 
 * @private
 * @param {number} code - Character code
 * @returns {boolean}
 */
function isFullStop(code) {
    // ASCII: . ! ?
    if (code === 0x2E || code === 0x21 || code === 0x3F) return true;
    
    // Ellipsis
    if (code === 0x2026) return true; // …
    
    // CJK punctuation
    if (code === 0x3002) return true; // 。 CJK full stop
    if (code === 0xFF01) return true; // ！ fullwidth exclamation
    if (code === 0xFF1F) return true; // ？ fullwidth question
    if (code === 0xFF0E) return true; // ． fullwidth full stop
    
    // Spanish inverted marks (sentence starters, but treat as pause)
    if (code === 0x00BF) return true; // ¿
    if (code === 0x00A1) return true; // ¡
    
    // Interrobang and other sentence-enders
    if (code === 0x203D) return true; // ‽ interrobang
    if (code === 0x2047) return true; // ⁇ double question
    if (code === 0x2048) return true; // ⁈ question exclamation
    if (code === 0x2049) return true; // ⁉ exclamation question
    
    return false;
}

/**
 * Check if character code is a partial stop (clause-ending punctuation)
 * Supports ASCII and Unicode punctuation.
 * 
 * @private
 * @param {number} code - Character code
 * @returns {boolean}
 */
function isPartialStop(code) {
    // ASCII: , ; :
    if (code === 0x2C || code === 0x3B || code === 0x3A) return true;
    
    // Em dash and en dash (often used as pause)
    if (code === 0x2014) return true; // — em dash
    if (code === 0x2013) return true; // – en dash
    
    // CJK punctuation
    if (code === 0x3001) return true; // 、 CJK comma
    if (code === 0xFF0C) return true; // ， fullwidth comma
    if (code === 0xFF1A) return true; // ： fullwidth colon
    if (code === 0xFF1B) return true; // ； fullwidth semicolon
    
    return false;
}

/**
 * Cached settings for hot path optimization
 * Call cacheSettings() before starting playback
 * @private
 */
let cachedSettings = {
    fixedTiming: false,
    punctuationPauses: true,
    pauseDuration: 200,
    valid: false
};

/**
 * Cache settings for hot path optimization
 * Call this when playback starts or settings change during playback
 */
export function cacheSettings() {
    cachedSettings.fixedTiming = State.get('fixedTiming') ?? false;
    cachedSettings.punctuationPauses = State.get('punctuationPauses') ?? true;
    cachedSettings.pauseDuration = State.get('pauseDuration') ?? CONFIG.PAUSE_DURATION.DEFAULT;
    cachedSettings.valid = true;
}

/**
 * Invalidate settings cache
 * Call when settings change
 */
export function invalidateCache() {
    cachedSettings.valid = false;
}

/**
 * Calculate display duration for a word/chunk
 * Considers: base WPM, warmup, word length, punctuation.
 * 
 * @param {string} text - The word or chunk to calculate duration for
 * @param {number} wpm - Target WPM setting
 * @param {number} [precomputedMaxLength] - Optional pre-computed max word length
 * @returns {number} Duration in milliseconds
 * 
 * @example
 * // Simple word at 300 WPM
 * getWordDuration('hello', 300) // Returns ~200ms
 * 
 * // Long word gets more time
 * getWordDuration('extraordinary', 300) // Returns ~280ms
 * 
 * // Sentence end gets pause
 * getWordDuration('end.', 300) // Returns ~400ms
 */
export function getWordDuration(text, wpm, precomputedMaxLength) {
    if (!text || wpm <= 0) {
        return 0;
    }
    
    // Ensure cache is valid
    if (!cachedSettings.valid) {
        cacheSettings();
    }
    
    // Get effective WPM (considering warmup)
    const effectiveWpm = getCurrentWPM(wpm);
    
    // Prevent division by zero
    if (effectiveWpm <= 0) {
        return 0;
    }
    
    // Base duration for one "flash" at this WPM
    let duration = 60000 / effectiveWpm;
    
    // Adjust for word length (if not using fixed timing)
    if (!cachedSettings.fixedTiming) {
        const maxLength = precomputedMaxLength !== undefined 
            ? precomputedMaxLength 
            : getMaxWordLength(text);
        
        if (maxLength > CONFIG.WORD_LENGTH.LONG) {
            duration *= CONFIG.TIMING_MULTIPLIERS.VERY_LONG;
        } else if (maxLength > CONFIG.WORD_LENGTH.MEDIUM) {
            duration *= CONFIG.TIMING_MULTIPLIERS.LONG;
        } else if (maxLength > CONFIG.WORD_LENGTH.SHORT) {
            duration *= CONFIG.TIMING_MULTIPLIERS.MEDIUM;
        }
        // SHORT words use base duration (1.0 multiplier)
    }
    
    // Add punctuation pauses
    if (cachedSettings.punctuationPauses && text.length > 0) {
        const lastCharCode = text.charCodeAt(text.length - 1);
        
        if (isFullStop(lastCharCode)) {
            duration += cachedSettings.pauseDuration * CONFIG.PUNCTUATION.FULL_STOP;
        } else if (isPartialStop(lastCharCode)) {
            duration += cachedSettings.pauseDuration * CONFIG.PUNCTUATION.PARTIAL_STOP;
        }
    }
    
    return Math.round(duration);
}

/**
 * Format milliseconds as MM:SS or H:MM:SS string
 * 
 * @param {number} ms - Milliseconds
 * @param {boolean} [forceHours=false] - Always show hours component
 * @returns {string} Formatted time string
 * 
 * @example
 * formatTime(65000)      // Returns '1:05'
 * formatTime(3665000)    // Returns '1:01:05'
 * formatTime(0)          // Returns '0:00'
 */
export function formatTime(ms, forceHours = false) {
    if (!ms || ms < 0) {
        return forceHours ? '0:00:00' : '0:00';
    }
    
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0 || forceHours) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format milliseconds as human-readable duration
 * 
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted duration string
 * 
 * @example
 * formatMinutes(120000)   // Returns '2m'
 * formatMinutes(3660000)  // Returns '1h 1m'
 * formatMinutes(30000)    // Returns '0m'
 */
export function formatMinutes(ms) {
    if (!ms || ms < 0) {
        return '0m';
    }
    
    const totalMinutes = Math.floor(ms / 60000);
    
    if (totalMinutes < 60) {
        return `${totalMinutes}m`;
    }
    
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    return `${hours}h ${minutes}m`;
}

/**
 * Format milliseconds as detailed duration
 * 
 * @param {number} ms - Milliseconds
 * @returns {string} Detailed duration string
 * 
 * @example
 * formatDuration(3661000)  // Returns '1h 1m 1s'
 * formatDuration(61000)    // Returns '1m 1s'
 * formatDuration(5000)     // Returns '5s'
 */
export function formatDuration(ms) {
    if (!ms || ms < 0) {
        return '0s';
    }
    
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
}

/**
 * Estimate total reading time for a word count at given WPM
 * 
 * @param {number} wordCount - Number of words
 * @param {number} wpm - Words per minute
 * @returns {number} Estimated time in milliseconds
 * 
 * @example
 * estimateTotalTime(300, 300) // Returns 60000 (1 minute)
 */
export function estimateTotalTime(wordCount, wpm) {
    if (wordCount <= 0 || wpm <= 0) {
        return 0;
    }
    
    return Math.round((wordCount / wpm) * 60000);
}

/**
 * Estimate remaining time from current position
 * 
 * @param {number} currentIndex - Current word index
 * @param {number} totalWords - Total word count
 * @param {number} wpm - Words per minute
 * @returns {number} Remaining time in milliseconds
 */
export function estimateRemainingTime(currentIndex, totalWords, wpm) {
    const remaining = Math.max(0, totalWords - currentIndex);
    return estimateTotalTime(remaining, wpm);
}

/**
 * Get elapsed time since a start timestamp
 * 
 * @param {number} startTime - Start timestamp (from Date.now())
 * @returns {number} Elapsed milliseconds
 */
export function getElapsedTime(startTime) {
    if (!startTime) {
        return 0;
    }
    return Math.max(0, Date.now() - startTime);
}

/**
 * Get full warmup state for UI display
 * 
 * @returns {WarmupState}
 */
export function getWarmupState() {
    return {
        active: warmupState.active,
        paused: warmupState.paused,
        startTime: warmupState.startTime,
        elapsedBeforePause: warmupState.elapsedBeforePause,
        progress: warmupState.progress
    };
}

/**
 * Calculate words per minute from word count and elapsed time
 * Useful for actual WPM tracking during reading.
 * 
 * @param {number} wordCount - Number of words read
 * @param {number} elapsedMs - Elapsed time in milliseconds
 * @returns {number} Calculated WPM
 */
export function calculateActualWPM(wordCount, elapsedMs) {
    if (wordCount <= 0 || elapsedMs <= 0) {
        return 0;
    }
    
    const minutes = elapsedMs / 60000;
    return Math.round(wordCount / minutes);
}

/**
 * Get timing statistics for debugging
 * 
 * @returns {{ cacheValid: boolean, warmupActive: boolean, warmupProgress: number, effectiveWpm: number }}
 */
export function getTimingStats() {
    const targetWpm = State.get('wpm') ?? CONFIG.WPM.DEFAULT;
    return {
        cacheValid: cachedSettings.valid,
        warmupActive: warmupState.active,
        warmupPaused: warmupState.paused,
        warmupProgress: warmupState.progress,
        targetWpm,
        effectiveWpm: getCurrentWPM(targetWpm)
    };
}

// Default export for convenience
export default {
    startWarmup,
    pauseWarmup,
    resumeWarmup,
    resetWarmup,
    completeWarmup,
    getWarmupProgress,
    updateWarmup,
    isWarmupActive,
    isWarmupPaused,
    getCurrentWPM,
    getWordDuration,
    cacheSettings,
    invalidateCache,
    formatTime,
    formatMinutes,
    formatDuration,
    estimateTotalTime,
    estimateRemainingTime,
    getElapsedTime,
    getWarmupState,
    calculateActualWPM,
    getTimingStats
};
