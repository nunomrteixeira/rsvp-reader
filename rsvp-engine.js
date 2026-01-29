/**
 * RSVP Reader - RSVP Engine Module (Ultra-Optimized)
 * High-performance playback engine using requestAnimationFrame for smooth word display.
 * 
 * Performance optimizations:
 * - Pre-computed word data including chunk word counts
 * - Cumulative duration sums for O(1) time lookups
 * - Direct callback invocation (no function type checks in hot path)
 * - Minimal object allocation in tick loop
 * - No EventBus emissions in hot path (optional subscription)
 * - Numeric state constants for faster comparison
 * - Cached settings to avoid Map lookups in hot path
 * - Pre-calculated warmup duration curve
 */

import { CONFIG } from './config.js';
import { State } from './state-manager.js';
import { EventBus, Events } from './event-bus.js';
import { parseText, chunkWords } from './text-processor.js';
import { precomputeWords } from './orp-calculator.js';
import { 
    getWordDuration, 
    cacheSettings as cacheTimingSettings,
    startWarmup,
    resetWarmup,
    pauseWarmup,
    resumeWarmup,
    updateWarmup,
    isWarmupActive,
    getWarmupProgress
} from './timing-manager.js';
import { 
    trackWord, 
    reset as resetComprehension,
    cacheSettings as cacheComprehensionSettings,
    isEnabled as isComprehensionEnabled
} from './comprehension.js';

/**
 * @typedef {'idle'|'playing'|'paused'|'completed'} PlaybackState
 */

/**
 * @typedef {Object} PrecomputedWord
 * @property {string} text - Original text
 * @property {string} html - Pre-rendered HTML
 * @property {number} maxLength - Max alphanumeric length
 * @property {number} duration - Pre-calculated duration at current WPM
 * @property {number} wordCount - Number of words in chunk (for comprehension)
 */

/**
 * @typedef {Object} EngineState
 * @property {PlaybackState} playbackState - Current playback state
 * @property {number} currentIndex - Current word index
 * @property {number} totalWords - Total word count
 * @property {number} progress - Progress 0-1
 * @property {number} elapsedMs - Elapsed time in ms
 * @property {number} remainingMs - Remaining time estimate
 */

// Playback state constants for faster comparison
const STATE_IDLE = 0;
const STATE_PLAYING = 1;
const STATE_PAUSED = 2;
const STATE_COMPLETED = 3;

const STATE_NAMES = ['idle', 'playing', 'paused', 'completed'];

/**
 * Count words in a chunk by counting spaces + 1
 * Faster than split() for this specific use case
 * @private
 * @param {string} text - Text to count words in
 * @returns {number} Word count
 */
function countWordsInChunk(text) {
    let count = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 32) count++; // 32 = space
    }
    return count;
}

/**
 * Add word counts to all precomputed words
 * @private
 * @param {PrecomputedWord[]} precomputed - Array of precomputed words
 */
function addWordCounts(precomputed) {
    for (let i = 0; i < precomputed.length; i++) {
        precomputed[i].wordCount = countWordsInChunk(precomputed[i].text);
    }
}

/**
 * RSVP Engine Class
 * Singleton that manages the reading playback loop.
 */
class RSVPEngineClass {
    constructor() {
        // Playback state (using numeric constants for faster comparison)
        /** @type {number} */
        this._state = STATE_IDLE;
        
        /** @type {number} */
        this._currentIndex = 0;
        
        /** @type {string} */
        this._rawText = '';
        
        /** @type {string[]} */
        this._words = [];
        
        /** @type {string[]} */
        this._chunks = [];
        
        /** @type {PrecomputedWord[]} */
        this._precomputed = [];
        
        /** @type {number} Total number of chunks (cached for hot path) */
        this._totalChunks = 0;
        
        /** @type {number} Total word count (actual words, not chunks) */
        this._totalWords = 0;
        
        /** @type {number[]} Cumulative duration sums for O(1) time lookups */
        this._cumulativeDurations = [];
        
        /** @type {number} Total duration of all words */
        this._totalDuration = 0;
        
        // Timing state
        /** @type {number|null} */
        this._rafId = null;
        
        /** @type {number} */
        this._lastFrameTime = 0;
        
        /** @type {number} */
        this._wordStartTime = 0;
        
        /** @type {number} */
        this._currentWordDuration = 0;
        
        /** @type {number} */
        this._totalElapsedMs = 0;
        
        /** @type {number} */
        this._sessionStartTime = 0;
        
        /** @type {number|null} Auto-restart timeout ID for cancellation */
        this._autoRestartTimeout = null;
        
        /** @type {number} Session ID to detect stale callbacks */
        this._sessionId = 0;
        
        // Pause handling
        /** @type {number} */
        this._pausedAtProgress = 0;
        
        // Hot path caches (avoid function calls and Map lookups in _tick)
        /** @type {boolean} Cached warmup active state */
        this._warmupActive = false;
        
        /** @type {number} Cached WPM value */
        this._cachedWpm = 300;
        
        /** @type {boolean} Cached comprehension enabled state */
        this._comprehensionEnabled = false;
        
        // Tab visibility handling
        /** @type {boolean} Was playing before tab was hidden */
        this._wasPlayingBeforeHidden = false;
        
        /** @type {boolean} Auto-pause when tab hidden (user configurable) */
        this._pauseOnHidden = true;
        
        // Callbacks for UI updates (direct function references, no null checks in hot path)
        /** @type {function(PrecomputedWord, number): void} */
        this._onWordChange = null;
        
        /** @type {function(EngineState): void} */
        this._onStateChange = null;
        
        /** @type {function(): void} */
        this._onComprehensionCheck = null;
        
        // Feature flag cache (avoid State.get in hot path)
        /** @type {boolean} */
        this._emitEvents = true;
        
        // Bind the tick method once
        this._tick = this._tick.bind(this);
        
        // Bind and set up visibility change handler
        this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this._handleVisibilityChange);
        }
    }
    
    /**
     * Handle page visibility changes
     * Auto-pauses when tab is hidden to prevent confusion on return
     * @private
     */
    _handleVisibilityChange() {
        if (!this._pauseOnHidden) return;
        
        if (document.hidden) {
            // Tab is being hidden - pause if playing
            if (this._state === STATE_PLAYING) {
                this._wasPlayingBeforeHidden = true;
                this.pause();
            }
        } else {
            // Tab is visible again - optionally resume
            // Note: We don't auto-resume by default to avoid surprising the user
            // The _wasPlayingBeforeHidden flag is available for UI to check
        }
    }
    
    /**
     * Check if playback was interrupted by tab hiding
     * UI can use this to show a "Resume" prompt
     * @returns {boolean}
     */
    wasInterruptedByTabHide() {
        return this._wasPlayingBeforeHidden;
    }
    
    /**
     * Clear the tab-hide interrupt flag
     * Call after user acknowledges or resumes
     */
    clearTabHideInterrupt() {
        this._wasPlayingBeforeHidden = false;
    }
    
    /**
     * Set whether to auto-pause when tab is hidden
     * @param {boolean} enabled
     */
    setPauseOnHidden(enabled) {
        this._pauseOnHidden = enabled;
    }

    /**
     * Load text for reading
     * Parses, chunks, and precomputes all display data.
     * 
     * @param {string} text - Raw text to load
     * @returns {{ success: boolean, wordCount: number, chunkCount: number, error?: string }}
     */
    load(text) {
        if (!text || typeof text !== 'string') {
            return { success: false, wordCount: 0, chunkCount: 0, error: 'No text provided' };
        }
        
        // Cancel any pending auto-restart from previous session
        if (this._autoRestartTimeout !== null) {
            clearTimeout(this._autoRestartTimeout);
            this._autoRestartTimeout = null;
        }
        
        // Stop any current playback
        this.stop();
        
        // Increment session ID to invalidate any stale callbacks
        this._sessionId++;
        
        // Parse text into words
        this._rawText = text;
        this._words = parseText(text);
        this._totalWords = this._words.length;
        
        if (this._totalWords < CONFIG.TEXT.MIN_WORDS) {
            return { 
                success: false, 
                wordCount: this._totalWords,
                chunkCount: 0,
                error: `Need at least ${CONFIG.TEXT.MIN_WORDS} words` 
            };
        }
        
        // Chunk words based on current setting
        this._rechunk();
        
        // Reset state
        this._currentIndex = 0;
        this._totalElapsedMs = 0;
        this._state = STATE_IDLE;
        
        // Reset comprehension tracking
        resetComprehension();
        
        // Notify
        this._emitStateChange();
        if (this._emitEvents) {
            EventBus.emit(Events.TEXT_LOADED, { 
                wordCount: this._totalWords,
                chunkCount: this._totalChunks
            });
        }
        
        return { success: true, wordCount: this._totalWords, chunkCount: this._totalChunks };
    }

    /**
     * Rechunk and precompute words
     * @private
     */
    _rechunk() {
        const chunkSize = State.get('chunkSize');
        const orpEnabled = State.get('orpEnabled');
        const bionicMode = State.get('bionicMode');
        
        this._chunks = chunkWords(this._words, chunkSize);
        this._precomputed = precomputeWords(this._chunks, orpEnabled, bionicMode);
        this._totalChunks = this._chunks.length;
        
        // Pre-compute word counts for each chunk (for comprehension tracking)
        addWordCounts(this._precomputed);
        
        // Pre-calculate durations at current WPM
        this._recalculateDurations();
    }

    /**
     * Recalculate all word durations and cumulative totals
     * @private
     */
    _recalculateDurations() {
        const wpm = State.get('wpm');
        cacheTimingSettings();
        
        const len = this._precomputed.length;
        
        // Calculate individual durations
        for (let i = 0; i < len; i++) {
            const word = this._precomputed[i];
            word.duration = getWordDuration(word.text, wpm, word.maxLength);
        }
        
        // Pre-compute cumulative sum for O(1) remaining time lookup
        this._cumulativeDurations = new Array(len + 1);
        this._cumulativeDurations[0] = 0;
        
        let sum = 0;
        for (let i = 0; i < len; i++) {
            sum += this._precomputed[i].duration;
            this._cumulativeDurations[i + 1] = sum;
        }
        
        this._totalDuration = sum;
    }

    /**
     * Start or resume playback
     * @returns {boolean} True if playback started
     */
    play() {
        if (this._totalChunks === 0) {
            console.warn('RSVPEngine: No text loaded');
            return false;
        }
        
        if (this._state === STATE_PLAYING) {
            return true;
        }
        
        // Cancel any pending auto-restart
        if (this._autoRestartTimeout !== null) {
            clearTimeout(this._autoRestartTimeout);
            this._autoRestartTimeout = null;
        }
        
        // Clear tab-hide interrupt flag since user is resuming
        this._wasPlayingBeforeHidden = false;
        
        if (this._state === STATE_COMPLETED) {
            this._currentIndex = 0;
            this._totalElapsedMs = 0;
            resetComprehension();
        }
        
        // Cache settings for hot path
        cacheTimingSettings();
        cacheComprehensionSettings();
        this._cachedWpm = State.get('wpm') ?? 300;
        this._comprehensionEnabled = isComprehensionEnabled();
        
        // Handle warmup: start fresh or resume
        if (this._currentIndex === 0 && this._state !== STATE_PAUSED) {
            startWarmup();
            this._sessionStartTime = performance.now();
        } else if (this._state === STATE_PAUSED) {
            // Resume warmup if it was paused
            resumeWarmup();
        }
        
        // Update and cache warmup state
        updateWarmup();
        this._warmupActive = isWarmupActive();
        
        // Set up timing
        this._state = STATE_PLAYING;
        const now = performance.now();
        this._lastFrameTime = now;
        
        // Get current word duration (recalculate if warmup active)
        const currentWord = this._precomputed[this._currentIndex];
        if (currentWord) {
            if (this._warmupActive) {
                this._currentWordDuration = getWordDuration(currentWord.text, this._cachedWpm, currentWord.maxLength);
            } else {
                this._currentWordDuration = currentWord.duration;
            }
        }
        
        // Apply saved progress if resuming from pause
        // This makes the word continue from where it was paused, not restart
        if (this._pausedAtProgress > 0 && this._pausedAtProgress < 1) {
            const alreadyElapsed = this._pausedAtProgress * this._currentWordDuration;
            this._wordStartTime = now - alreadyElapsed;
        } else {
            this._wordStartTime = now;
        }
        this._pausedAtProgress = 0; // Clear after applying
        
        // Emit initial word
        this._emitCurrentWord();
        this._emitStateChange();
        
        if (this._emitEvents) {
            EventBus.emit(Events.ENGINE_PLAY);
        }
        
        // Start the animation loop
        this._rafId = requestAnimationFrame(this._tick);
        
        return true;
    }

    /**
     * Pause playback
     */
    pause() {
        if (this._state !== STATE_PLAYING) {
            return;
        }
        
        // Cancel animation frame
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        
        // Pause warmup timer so it doesn't complete during pause
        pauseWarmup();
        
        // Save progress within current word (with division safety)
        const now = performance.now();
        const elapsed = now - this._wordStartTime;
        this._pausedAtProgress = this._currentWordDuration > 0 
            ? Math.min(1, elapsed / this._currentWordDuration) 
            : 0;
        
        this._state = STATE_PAUSED;
        this._emitStateChange();
        
        if (this._emitEvents) {
            EventBus.emit(Events.ENGINE_PAUSE);
        }
    }

    /**
     * Toggle play/pause
     * @returns {boolean} New playing state
     */
    toggle() {
        if (this._state === STATE_PLAYING) {
            this.pause();
            return false;
        } else {
            this.play();
            return true;
        }
    }

    /**
     * Stop playback and reset to beginning
     */
    stop() {
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        
        // Cancel any pending auto-restart
        if (this._autoRestartTimeout !== null) {
            clearTimeout(this._autoRestartTimeout);
            this._autoRestartTimeout = null;
        }
        
        this._state = STATE_IDLE;
        this._currentIndex = 0;
        this._totalElapsedMs = 0;
        this._pausedAtProgress = 0;
        this._warmupActive = false;
        
        resetWarmup();
        resetComprehension();
        
        this._emitStateChange();
        if (this._emitEvents) {
            EventBus.emit(Events.ENGINE_RESET);
        }
    }

    /**
     * Seek to a specific word index
     * @param {number} index - Word index to seek to
     */
    seek(index) {
        const safeIndex = Math.max(0, Math.min(this._totalChunks - 1, index));
        
        if (safeIndex === this._currentIndex) {
            return;
        }
        
        const wasPlaying = this._state === STATE_PLAYING;
        
        if (wasPlaying) {
            if (this._rafId !== null) {
                cancelAnimationFrame(this._rafId);
                this._rafId = null;
            }
        }
        
        this._currentIndex = safeIndex;
        this._totalElapsedMs = this._cumulativeDurations[safeIndex] || 0;
        this._pausedAtProgress = 0;
        
        // Update current word duration (consider warmup state)
        const currentWord = this._precomputed[this._currentIndex];
        if (currentWord) {
            if (this._warmupActive) {
                this._currentWordDuration = getWordDuration(currentWord.text, this._cachedWpm, currentWord.maxLength);
            } else {
                this._currentWordDuration = currentWord.duration;
            }
        }
        
        this._emitCurrentWord();
        this._emitStateChange();
        
        if (wasPlaying) {
            this._wordStartTime = performance.now();
            this._rafId = requestAnimationFrame(this._tick);
        }
    }

    /**
     * Seek to a specific time position
     * Uses binary search for O(log n) lookup
     * @param {number} timeMs - Target time in milliseconds
     */
    seekToTime(timeMs) {
        if (this._totalChunks === 0 || this._cumulativeDurations.length === 0) {
            return;
        }
        
        const targetTime = Math.max(0, Math.min(this._totalDuration, timeMs));
        
        // Binary search for the index where cumulative time >= targetTime
        let left = 0;
        let right = this._cumulativeDurations.length - 1;
        
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this._cumulativeDurations[mid] < targetTime) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        
        // Seek to the found index (clamped to valid range)
        const targetIndex = Math.max(0, Math.min(this._totalChunks - 1, left - 1));
        this.seek(targetIndex);
    }

    /**
     * Move to next word
     */
    next() {
        if (this._currentIndex < this._totalChunks - 1) {
            this.seek(this._currentIndex + 1);
        }
    }

    /**
     * Move to previous word
     */
    prev() {
        if (this._currentIndex > 0) {
            this.seek(this._currentIndex - 1);
        }
    }

    /**
     * Skip forward/backward by a number of words
     * @param {number} count - Number of words (negative for backward)
     */
    skip(count) {
        this.seek(this._currentIndex + count);
    }

    /**
     * Main animation loop tick - ULTRA HOT PATH
     * Every microsecond counts here.
     * @private
     * @param {number} timestamp - RAF timestamp
     */
    _tick(timestamp) {
        // Fastest possible state check
        if (this._state !== STATE_PLAYING) {
            return;
        }
        
        // Calculate elapsed time
        const elapsed = timestamp - this._wordStartTime;
        
        // Check if it's time to advance
        if (elapsed >= this._currentWordDuration) {
            // Get current word (already validated to exist)
            const currentWord = this._precomputed[this._currentIndex];
            
            // Track for comprehension only if enabled (uses cached flag)
            // This avoids function call overhead when comprehension is disabled
            let needsCheck = false;
            if (this._comprehensionEnabled) {
                needsCheck = trackWord(currentWord.text, currentWord.wordCount);
            }
            
            if (needsCheck && this._onComprehensionCheck) {
                this.pause();
                this._onComprehensionCheck();
                return;
            }
            
            // Advance to next word
            this._currentIndex++;
            this._totalElapsedMs += this._currentWordDuration;
            
            // Check for completion
            if (this._currentIndex >= this._totalChunks) {
                this._complete();
                return;
            }
            
            // Set up next word timing with overshoot compensation
            const overshoot = elapsed - this._currentWordDuration;
            this._wordStartTime = timestamp - (overshoot > 50 ? 50 : overshoot);
            
            // Get next word's duration
            // During warmup, recalculate dynamically using cached values
            const nextWord = this._precomputed[this._currentIndex];
            if (this._warmupActive) {
                // Update warmup state and recalculate duration
                updateWarmup();
                this._warmupActive = isWarmupActive();
                this._currentWordDuration = getWordDuration(nextWord.text, this._cachedWpm, nextWord.maxLength);
            } else {
                this._currentWordDuration = nextWord.duration;
            }
            
            // Emit word change via direct callback
            if (this._onWordChange) {
                this._onWordChange(nextWord, this._currentIndex);
            }
        }
        
        // Continue loop
        this._rafId = requestAnimationFrame(this._tick);
    }

    /**
     * Handle playback completion
     * @private
     */
    _complete() {
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        
        this._state = STATE_COMPLETED;
        this._warmupActive = false;
        this._emitStateChange();
        
        if (this._emitEvents) {
            EventBus.emit(Events.ENGINE_COMPLETE, {
                totalWords: this._totalWords,
                totalChunks: this._totalChunks,
                elapsedMs: this._totalElapsedMs
            });
        }
        
        // Auto-restart if enabled, with session validation
        if (State.get('autoRestart')) {
            const currentSession = this._sessionId;
            this._autoRestartTimeout = setTimeout(() => {
                // Verify session hasn't changed (new text loaded)
                if (this._sessionId !== currentSession) {
                    return;
                }
                // Verify state hasn't changed (user manually started/stopped)
                if (this._state !== STATE_COMPLETED) {
                    return;
                }
                this._autoRestartTimeout = null;
                this._currentIndex = 0;
                this._totalElapsedMs = 0;
                resetComprehension();
                this.play();
            }, 1000);
        }
    }

    /**
     * Emit current word to callback
     * @private
     */
    _emitCurrentWord() {
        const word = this._precomputed[this._currentIndex];
        
        if (this._onWordChange && word) {
            this._onWordChange(word, this._currentIndex);
        }
        
        if (this._emitEvents && word) {
            EventBus.emit(Events.ENGINE_WORD_CHANGE, {
                word,
                index: this._currentIndex,
                total: this._totalChunks
            });
        }
    }

    /**
     * Emit state change
     * @private
     */
    _emitStateChange() {
        const state = this.getState();
        
        if (this._onStateChange) {
            this._onStateChange(state);
        }
        
        if (this._emitEvents) {
            EventBus.emit(Events.ENGINE_STATE_CHANGE, state);
        }
    }

    /**
     * Estimate elapsed time to reach an index - O(1)
     * Useful for time-based seeking or progress display
     * @param {number} index - Word index
     * @returns {number} Estimated ms to reach that index
     */
    estimateTimeToIndex(index) {
        if (index <= 0) return 0;
        if (index >= this._cumulativeDurations.length) {
            return this._totalDuration;
        }
        return this._cumulativeDurations[index];
    }

    /**
     * Estimate remaining time from current position - O(1)
     * @private
     * @returns {number} Estimated remaining ms
     */
    _estimateRemaining() {
        return this._totalDuration - (this._cumulativeDurations[this._currentIndex] || 0);
    }

    // ============================================
    // PUBLIC GETTERS
    // ============================================

    /**
     * Get current engine state
     * @returns {EngineState}
     */
    getState() {
        return {
            playbackState: STATE_NAMES[this._state],
            currentIndex: this._currentIndex,
            totalChunks: this._totalChunks,
            totalWords: this._totalWords,
            progress: this._totalChunks > 0 ? this._currentIndex / this._totalChunks : 0,
            elapsedMs: this._totalElapsedMs,
            remainingMs: this._estimateRemaining(),
            warmupActive: this._warmupActive
        };
    }

    /**
     * Get current word data
     * @returns {PrecomputedWord|null}
     */
    getCurrentWord() {
        return this._precomputed[this._currentIndex] || null;
    }

    /**
     * Get word at specific index
     * @param {number} index
     * @returns {PrecomputedWord|null}
     */
    getWord(index) {
        return this._precomputed[index] || null;
    }

    /**
     * Get all precomputed words
     * @returns {PrecomputedWord[]}
     */
    getAllWords() {
        return this._precomputed;
    }

    /**
     * Get original words array (unchunked)
     * @returns {string[]}
     */
    getOriginalWords() {
        return this._words;
    }

    /**
     * Get total word count (actual words, not chunks)
     * @returns {number}
     */
    getTotalWords() {
        return this._totalWords;
    }

    /**
     * Get total chunk count
     * @returns {number}
     */
    getTotalChunks() {
        return this._totalChunks;
    }

    /**
     * Check if text is loaded
     * @returns {boolean}
     */
    isLoaded() {
        return this._totalChunks > 0;
    }

    /**
     * Check if currently playing
     * @returns {boolean}
     */
    isPlaying() {
        return this._state === STATE_PLAYING;
    }

    /**
     * Check if paused
     * @returns {boolean}
     */
    isPaused() {
        return this._state === STATE_PAUSED;
    }

    /**
     * Check if completed
     * @returns {boolean}
     */
    isCompleted() {
        return this._state === STATE_COMPLETED;
    }

    // ============================================
    // CALLBACK SETTERS
    // ============================================

    /**
     * Set word change callback (used by UI for updates)
     * @param {function(PrecomputedWord, number): void} callback
     */
    onWordChange(callback) {
        this._onWordChange = callback;
    }

    /**
     * Set state change callback
     * @param {function(EngineState): void} callback
     */
    onStateChange(callback) {
        this._onStateChange = callback;
    }

    /**
     * Set comprehension check callback
     * @param {function(): void} callback
     */
    onComprehensionCheck(callback) {
        this._onComprehensionCheck = callback;
    }

    /**
     * Enable/disable EventBus emissions (disable for max performance)
     * @param {boolean} enabled
     */
    setEventEmission(enabled) {
        this._emitEvents = enabled;
    }

    // ============================================
    // SETTINGS CHANGE HANDLERS
    // ============================================

    /**
     * Handle WPM change during playback
     * @param {number} newWpm - New WPM value (will be clamped to valid range)
     */
    updateWPM(newWpm) {
        // Validate and clamp WPM to safe range
        if (typeof newWpm !== 'number' || !isFinite(newWpm)) {
            console.warn('RSVPEngine: Invalid WPM value:', newWpm);
            return;
        }
        const clampedWpm = Math.max(CONFIG.WPM.MIN, Math.min(CONFIG.WPM.MAX, Math.round(newWpm)));
        
        State.set('wpm', clampedWpm);
        this._cachedWpm = clampedWpm;  // Update cache for hot path
        this._recalculateDurations();
        
        // Update current word duration if playing
        if (this._state === STATE_PLAYING) {
            const currentWord = this._precomputed[this._currentIndex];
            if (currentWord) {
                if (this._warmupActive) {
                    this._currentWordDuration = getWordDuration(currentWord.text, clampedWpm, currentWord.maxLength);
                } else {
                    this._currentWordDuration = currentWord.duration;
                }
            }
        }
    }

    /**
     * Handle chunk size change
     * @param {number} newSize - New chunk size (will be clamped to valid range)
     */
    updateChunkSize(newSize) {
        // Validate and clamp chunk size
        if (typeof newSize !== 'number' || !isFinite(newSize)) {
            console.warn('RSVPEngine: Invalid chunk size:', newSize);
            return;
        }
        const clampedSize = Math.max(CONFIG.CHUNK.MIN, Math.min(CONFIG.CHUNK.MAX, Math.round(newSize)));
        
        const wasPlaying = this._state === STATE_PLAYING;
        if (wasPlaying) {
            this.pause();
        }
        
        State.set('chunkSize', clampedSize);
        
        // Maintain approximate position
        const progressRatio = this._totalChunks > 0 
            ? this._currentIndex / this._totalChunks 
            : 0;
        
        this._rechunk();
        
        // Restore approximate position
        this._currentIndex = Math.floor(progressRatio * this._totalChunks);
        this._currentIndex = Math.max(0, Math.min(this._totalChunks - 1, this._currentIndex));
        
        this._emitCurrentWord();
        this._emitStateChange();
        
        if (wasPlaying) {
            this.play();
        }
    }

    /**
     * Handle ORP enabled change
     * @param {boolean} enabled
     */
    updateORPEnabled(enabled) {
        State.set('orpEnabled', enabled);
        this._recomputeDisplay();
    }

    /**
     * Handle Bionic mode change
     * @param {boolean} enabled
     */
    updateBionicMode(enabled) {
        State.set('bionicMode', enabled);
        this._recomputeDisplay();
    }

    /**
     * Recompute display HTML after display mode changes
     * @private
     */
    _recomputeDisplay() {
        const orpEnabled = State.get('orpEnabled');
        const bionicMode = State.get('bionicMode');
        this._precomputed = precomputeWords(this._chunks, orpEnabled, bionicMode);
        
        // Re-add word counts
        addWordCounts(this._precomputed);
        
        this._recalculateDurations();
        
        // Update current word duration if playing (durations may have changed)
        if (this._state === STATE_PLAYING) {
            const currentWord = this._precomputed[this._currentIndex];
            if (currentWord) {
                if (this._warmupActive) {
                    this._currentWordDuration = getWordDuration(currentWord.text, this._cachedWpm, currentWord.maxLength);
                } else {
                    this._currentWordDuration = currentWord.duration;
                }
            }
        }
        
        // Re-emit current word with new HTML
        if (this._precomputed[this._currentIndex]) {
            this._emitCurrentWord();
        }
    }

    /**
     * Recalculate durations after timing settings change
     * Call this when punctuation pauses, fixed timing, or pause duration changes
     */
    recalculateDurations() {
        if (this._precomputed.length > 0) {
            this._recalculateDurations();
            
            // Update current word duration if playing (durations have changed)
            if (this._state === STATE_PLAYING) {
                const currentWord = this._precomputed[this._currentIndex];
                if (currentWord) {
                    if (this._warmupActive) {
                        this._currentWordDuration = getWordDuration(currentWord.text, this._cachedWpm, currentWord.maxLength);
                    } else {
                        this._currentWordDuration = currentWord.duration;
                    }
                }
            }
        }
    }
}

// Export singleton
export const RSVPEngine = new RSVPEngineClass();

// Also export class for testing
export { RSVPEngineClass };
