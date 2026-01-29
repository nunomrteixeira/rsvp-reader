/**
 * Reader Display Module
 * Manages the word display, progress bar, and focus mode UI.
 * 
 * Usage:
 *   import { ReaderDisplay } from './reader-display.js';
 *   ReaderDisplay.updateWord(word);
 *   ReaderDisplay.updateProgress(index, total);
 */

import { State } from './state-manager.js';
import { DOM } from './dom-cache.js';
import { formatTime } from './timing-manager.js';

/** Focus mode state */
let isFocusMode = false;

/** Cached total words for hot path */
let cachedTotalWords = 0;

/** 
 * Cached settings for hot path (updated when settings change)
 * @type {{ fontFamily: string, peripheralPreview: boolean, fontSize: number, isDyslexic: boolean }}
 */
let cachedSettings = {
    fontFamily: 'serif',
    peripheralPreview: false,
    fontSize: 48,
    isDyslexic: false  // Pre-computed for hot path
};

/**
 * Cached DOM elements for hot path (avoids repeated Map lookups)
 * These don't change during playback, so we cache them once.
 * @type {Object}
 */
let hotPathElements = {
    wordDisplay: null,
    focusWordDisplay: null,
    wordPrev: null,
    wordNext: null,
    focusWordPrev: null,
    focusWordNext: null,
    progressFill: null,
    progressCurrent: null,
    progressTime: null,
    focusProgressFill: null,
    progressBar: null
};

/**
 * Font family CSS variable mapping (constant, not recreated per call)
 */
const FONT_MAP = {
    'serif': 'var(--font-reading)',
    'sans': 'var(--font-sans)',
    'mono': 'var(--font-mono)',
    'dyslexic': 'var(--font-dyslexic)'
};

/**
 * Cache display settings from State
 * Call this when settings change or before starting playback
 */
function cacheSettings() {
    cachedSettings.fontFamily = State.get('fontFamily') || 'serif';
    cachedSettings.peripheralPreview = State.get('peripheralPreview') || false;
    cachedSettings.fontSize = State.get('fontSize') || 48;
    cachedSettings.isDyslexic = cachedSettings.fontFamily === 'dyslexic';
}

/**
 * Cache DOM elements for hot path performance
 * Call this once before starting playback
 */
function cacheHotPathElements() {
    hotPathElements.wordDisplay = DOM.get('wordDisplay');
    hotPathElements.focusWordDisplay = DOM.get('focusWordDisplay');
    hotPathElements.wordPrev = DOM.get('wordPrev');
    hotPathElements.wordNext = DOM.get('wordNext');
    hotPathElements.focusWordPrev = DOM.get('focusWordPrev');
    hotPathElements.focusWordNext = DOM.get('focusWordNext');
    hotPathElements.progressFill = DOM.get('progressFill');
    hotPathElements.progressCurrent = DOM.get('progressCurrent');
    hotPathElements.progressTime = DOM.get('progressTime');
    hotPathElements.focusProgressFill = DOM.get('focusProgressFill');
    hotPathElements.progressBar = DOM.get('progressBar');
}

// ============================================
// WORD DISPLAY (HOT PATH - called every word)
// ============================================

/**
 * Update the word display - HOT PATH
 * Uses cached DOM elements to avoid Map lookups
 * @param {Object} word - Word object with html property
 */
function updateWord(word) {
    if (!word || !word.html) return;
    
    // Use cached element (avoid DOM.get Map lookup)
    const wordDisplay = hotPathElements.wordDisplay;
    if (wordDisplay) {
        wordDisplay.innerHTML = word.html;
    }
    
    // Update focus mode if active
    if (isFocusMode) {
        updateFocusWord(word);
    }
}

/**
 * Update focus mode word display - HOT PATH
 * @param {Object} word - Word object with html property
 */
function updateFocusWord(word) {
    // Use cached element (avoid DOM.get Map lookup)
    const focusWordDisplay = hotPathElements.focusWordDisplay;
    if (focusWordDisplay && word && word.html) {
        focusWordDisplay.innerHTML = word.html;
        
        // Only toggle class if dyslexic mode (avoid classList call when not needed)
        // The class is set once in updateWordStyle, we only need to ensure it's correct
        // This check is essentially free compared to classList.toggle
        if (cachedSettings.isDyslexic !== focusWordDisplay.classList.contains('dyslexia-mode')) {
            focusWordDisplay.classList.toggle('dyslexia-mode', cachedSettings.isDyslexic);
        }
    }
}

/**
 * Update peripheral preview words - HOT PATH (if peripheral preview enabled)
 * Uses cached DOM elements and settings
 * @param {number} index - Current word index
 * @param {Array} words - All words array
 */
function updatePeripheralWords(index, words) {
    // Use cached setting for hot path performance
    if (!cachedSettings.peripheralPreview) {
        // Use cached elements
        if (hotPathElements.wordPrev) hotPathElements.wordPrev.textContent = '';
        if (hotPathElements.wordNext) hotPathElements.wordNext.textContent = '';
        return;
    }
    
    // Validate words array to prevent crashes
    if (!words || !Array.isArray(words) || words.length === 0) {
        return;
    }
    
    // Previous word (use cached elements)
    const prevWord = index > 0 ? words[index - 1] : null;
    if (hotPathElements.wordPrev) {
        hotPathElements.wordPrev.textContent = prevWord ? prevWord.text : '';
    }
    
    // Next word
    const nextWord = index < words.length - 1 ? words[index + 1] : null;
    if (hotPathElements.wordNext) {
        hotPathElements.wordNext.textContent = nextWord ? nextWord.text : '';
    }
    
    // Update focus mode peripheral if active
    if (isFocusMode) {
        if (hotPathElements.focusWordPrev) {
            hotPathElements.focusWordPrev.textContent = prevWord ? prevWord.text : '';
        }
        if (hotPathElements.focusWordNext) {
            hotPathElements.focusWordNext.textContent = nextWord ? nextWord.text : '';
        }
    }
}

/**
 * Update peripheral word visibility
 * @param {boolean} [forceRefresh=false] - Force refresh from State (for settings changes)
 */
function updatePeripheralVisibility(forceRefresh = false) {
    // Refresh cache if requested (e.g., when settings change)
    if (forceRefresh) {
        cachedSettings.peripheralPreview = State.get('peripheralPreview') || false;
    }
    
    const wordPrev = DOM.get('wordPrev');
    const wordNext = DOM.get('wordNext');
    const focusPrev = DOM.get('focusWordPrev');
    const focusNext = DOM.get('focusWordNext');
    
    const display = cachedSettings.peripheralPreview ? '' : 'none';
    
    if (wordPrev) wordPrev.style.display = display;
    if (wordNext) wordNext.style.display = display;
    if (focusPrev) focusPrev.style.display = display;
    if (focusNext) focusNext.style.display = display;
}

/**
 * Update word display styling (font size, family)
 * Also refreshes the cached settings
 */
function updateWordStyle() {
    // Refresh cache when style changes
    cachedSettings.fontSize = State.get('fontSize') || 48;
    cachedSettings.fontFamily = State.get('fontFamily') || 'serif';
    cachedSettings.isDyslexic = cachedSettings.fontFamily === 'dyslexic';
    
    const fontSize = cachedSettings.fontSize;
    const fontFamily = cachedSettings.fontFamily;
    
    const wordDisplay = DOM.get('wordDisplay');
    const focusWordDisplay = DOM.get('focusWordDisplay');
    
    if (wordDisplay) {
        wordDisplay.style.fontSize = `${fontSize}px`;
        wordDisplay.style.fontFamily = FONT_MAP[fontFamily] || FONT_MAP.serif;
        wordDisplay.classList.toggle('dyslexia-mode', cachedSettings.isDyslexic);
    }
    
    if (focusWordDisplay) {
        focusWordDisplay.style.fontSize = `${Math.round(fontSize * 1.5)}px`;
        focusWordDisplay.style.fontFamily = FONT_MAP[fontFamily] || FONT_MAP.serif;
        focusWordDisplay.classList.toggle('dyslexia-mode', cachedSettings.isDyslexic);
    }
}

// ============================================
// PROGRESS (HOT PATH - called every word)
// ============================================

/**
 * Update progress display - HOT PATH
 * Uses cached DOM elements for performance
 * @param {number} index - Current word index
 * @param {number} [total] - Total words (uses cached if not provided)
 * @param {number} [remainingMs] - Remaining time in milliseconds
 */
function updateProgress(index, total, remainingMs = 0) {
    if (total !== undefined && total !== null && total > 0) {
        cachedTotalWords = total;
    }
    
    const t = cachedTotalWords || 0;
    const progress = t > 0 ? ((index + 1) / t) * 100 : 0;
    
    // Use cached elements (avoid DOM.get Map lookups)
    if (hotPathElements.progressFill) {
        hotPathElements.progressFill.style.width = `${progress}%`;
    }
    
    if (hotPathElements.progressCurrent) {
        hotPathElements.progressCurrent.textContent = `${index + 1} / ${t}`;
    }
    
    if (hotPathElements.progressTime) {
        hotPathElements.progressTime.textContent = `${formatTime(remainingMs)} remaining`;
    }
    
    // Update focus mode progress
    if (isFocusMode && hotPathElements.focusProgressFill) {
        hotPathElements.focusProgressFill.style.width = `${progress}%`;
    }
    
    // Update progress bar ARIA
    if (hotPathElements.progressBar) {
        hotPathElements.progressBar.setAttribute('aria-valuenow', Math.round(progress));
    }
}

/**
 * Set cached total words
 * @param {number} total - Total word count
 */
function setTotalWords(total) {
    cachedTotalWords = total;
}

// ============================================
// PLAYBACK UI
// ============================================

/**
 * Update playback UI state
 * @param {Object} state - Engine state object
 */
function updatePlaybackState(state) {
    // Validate input
    if (!state || typeof state.playbackState !== 'string') {
        return;
    }
    
    const isPlaying = state.playbackState === 'playing';
    
    // Update play/pause icon
    const iconHref = isPlaying ? '#icon-pause' : '#icon-play';
    
    const iconPlayPause = DOM.get('iconPlayPause');
    if (iconPlayPause) {
        const useEl = iconPlayPause.querySelector('use');
        if (useEl) useEl.setAttribute('href', iconHref);
    }
    
    // Update reader section playing state (for auto-hide controls)
    const readerSection = DOM.get('readerSection');
    if (readerSection) {
        readerSection.classList.toggle('playing', isPlaying);
    }
    
    // Update play button aria-pressed
    const btnPlay = DOM.get('btnPlay');
    if (btnPlay) {
        btnPlay.setAttribute('aria-pressed', isPlaying.toString());
        btnPlay.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    }
    
    // Update focus mode if active
    if (isFocusMode) {
        const focusIconPlay = DOM.get('focusIconPlay');
        if (focusIconPlay) {
            const useEl = focusIconPlay.querySelector('use');
            if (useEl) useEl.setAttribute('href', iconHref);
        }
        
        const focusMode = DOM.get('focusMode');
        if (focusMode) {
            focusMode.classList.toggle('paused', !isPlaying);
        }
        
        const btnFocusPlay = DOM.get('btnFocusPlay');
        if (btnFocusPlay) {
            btnFocusPlay.setAttribute('aria-pressed', isPlaying.toString());
        }
    }
}

/**
 * Update WPM display
 * @param {number} wpm - Current WPM value
 */
function updateWpmDisplay(wpm) {
    const wpmDisplay = DOM.get('wpmDisplay');
    if (wpmDisplay) {
        wpmDisplay.textContent = wpm;
        wpmDisplay.setAttribute('aria-label', `${wpm} words per minute. Click to edit.`);
    }
    
    // Update focus mode WPM
    if (isFocusMode) {
        const focusWpm = DOM.get('focusWpm');
        if (focusWpm) {
            focusWpm.textContent = `${wpm} WPM`;
        }
    }
}

// ============================================
// COMPLETION
// ============================================

/**
 * Show completion overlay
 * @param {Object} session - Session data for summary
 * @param {Object} summary - Analytics summary
 */
function showCompletion(session, summary) {
    const overlay = DOM.get('completionOverlay');
    if (!overlay) return;
    
    // Update session summary
    const summaryWords = DOM.get('summaryWords');
    const summaryTime = DOM.get('summaryTime');
    const summaryWpm = DOM.get('summaryWpm');
    const summaryStreak = DOM.get('summaryStreak');
    
    if (session) {
        // Use safe property access with fallbacks
        const wordsRead = session.wordsRead ?? 0;
        const duration = session.duration ?? 0;
        const avgWpm = session.avgWpm ?? 0;
        
        if (summaryWords) summaryWords.textContent = wordsRead.toLocaleString();
        if (summaryTime) summaryTime.textContent = formatDuration(duration);
        if (summaryWpm) summaryWpm.textContent = avgWpm;
    }
    
    if (summary && summaryStreak) {
        const streak = summary.currentStreak ?? 0;
        summaryStreak.textContent = `${streak} day${streak !== 1 ? 's' : ''}`;
    }
    
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    
    // Exit focus mode on completion
    if (isFocusMode) {
        exitFocusMode();
    }
}

/**
 * Hide completion overlay
 */
function hideCompletion() {
    const overlay = DOM.get('completionOverlay');
    if (overlay) {
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
    }
}

/**
 * Format duration for display
 * @param {number} ms - Duration in milliseconds
 * @returns {string}
 */
function formatDuration(ms) {
    // Handle invalid input
    if (!Number.isFinite(ms) || ms < 0) {
        return '0s';
    }
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// ============================================
// FOCUS MODE
// ============================================

/**
 * Enter focus mode
 * @param {Object} currentState - Current engine state (optional)
 * @param {Object} currentWord - Current word object (optional)
 * @param {Array} allWords - All words array (optional)
 * @param {number} [wpm] - Current WPM value (optional, falls back to State)
 */
function enterFocusMode(currentState, currentWord, allWords, wpm) {
    isFocusMode = true;
    
    const focusModeEl = DOM.get('focusMode');
    if (!focusModeEl) return;
    
    // Cache hot path elements now that focus mode is active
    cacheHotPathElements();
    
    focusModeEl.classList.add('active');
    focusModeEl.setAttribute('aria-hidden', 'false');
    
    // Try fullscreen
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
    
    // Sync current word
    if (currentWord) {
        updateFocusWord(currentWord);
    }
    
    // Update WPM display (prefer passed wpm, fall back to State)
    const focusWpm = DOM.get('focusWpm');
    if (focusWpm) {
        const displayWpm = wpm ?? State.get('wpm') ?? 300;
        focusWpm.textContent = `${displayWpm} WPM`;
    }
    
    // Sync progress
    if (currentState && allWords && Array.isArray(allWords)) {
        const total = allWords.length;
        const index = currentState.currentIndex ?? 0;
        const progress = total > 0 ? ((index + 1) / total) * 100 : 0;
        
        const focusProgressFill = DOM.get('focusProgressFill');
        if (focusProgressFill) {
            focusProgressFill.style.width = `${progress}%`;
        }
    }
    
    // Update play/pause icon
    if (currentState) {
        const isPlaying = currentState.playbackState === 'playing';
        const iconHref = isPlaying ? '#icon-pause' : '#icon-play';
        
        const focusIconPlay = DOM.get('focusIconPlay');
        if (focusIconPlay) {
            const useEl = focusIconPlay.querySelector('use');
            if (useEl) useEl.setAttribute('href', iconHref);
        }
        
        focusModeEl.classList.toggle('paused', !isPlaying);
    }
    
    // Update peripheral preview
    updatePeripheralVisibility();
    if (currentState && allWords && Array.isArray(allWords)) {
        updatePeripheralWords(currentState.currentIndex ?? 0, allWords);
    }
}

/**
 * Exit focus mode
 */
function exitFocusMode() {
    isFocusMode = false;
    
    const focusModeEl = DOM.get('focusMode');
    if (focusModeEl) {
        focusModeEl.classList.remove('active');
        focusModeEl.setAttribute('aria-hidden', 'true');
    }
    
    // Exit fullscreen
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
}

/**
 * Check if focus mode is active
 * @returns {boolean}
 */
function isInFocusMode() {
    return isFocusMode;
}

/**
 * Toggle focus mode
 * @param {Object} currentState - Current engine state
 * @param {Object} currentWord - Current word object
 * @param {Array} allWords - All words array
 */
function toggleFocusMode(currentState, currentWord, allWords) {
    if (isFocusMode) {
        exitFocusMode();
    } else {
        enterFocusMode(currentState, currentWord, allWords);
    }
}

// ============================================
// SECTIONS
// ============================================

/**
 * Show reader section, hide input section
 */
function showReader() {
    const inputSection = DOM.get('inputSection');
    const readerSection = DOM.get('readerSection');
    
    if (inputSection) inputSection.classList.add('hidden');
    if (readerSection) readerSection.classList.remove('hidden');
}

/**
 * Show input section, hide reader section
 */
function showInput() {
    const inputSection = DOM.get('inputSection');
    const readerSection = DOM.get('readerSection');
    
    if (inputSection) inputSection.classList.remove('hidden');
    if (readerSection) readerSection.classList.add('hidden');
    
    hideCompletion();
}

// ============================================
// WARMUP INDICATOR
// ============================================

/**
 * Show warmup indicator
 */
function showWarmupIndicator() {
    const indicator = DOM.get('warmupIndicator');
    if (indicator) {
        indicator.classList.remove('hidden');
    }
}

/**
 * Hide warmup indicator
 */
function hideWarmupIndicator() {
    const indicator = DOM.get('warmupIndicator');
    if (indicator) {
        indicator.classList.add('hidden');
    }
}

/**
 * Update warmup progress
 * @param {number} progress - Progress value from 0 to 1
 */
function updateWarmupProgress(progress) {
    const progressEl = DOM.get('warmupProgress');
    if (progressEl) {
        progressEl.style.width = `${Math.round(progress * 100)}%`;
    }
    
    // Hide when complete
    if (progress >= 1) {
        hideWarmupIndicator();
    }
}

export const ReaderDisplay = {
    // Settings and DOM cache (call before playback starts)
    cacheSettings,
    cacheHotPathElements,
    
    // Word display
    updateWord,
    updateFocusWord,
    updatePeripheralWords,
    updatePeripheralVisibility,
    updateWordStyle,
    
    // Progress
    updateProgress,
    setTotalWords,
    
    // Playback
    updatePlaybackState,
    updateWpmDisplay,
    
    // Warmup
    showWarmupIndicator,
    hideWarmupIndicator,
    updateWarmupProgress,
    
    // Completion
    showCompletion,
    hideCompletion,
    
    // Focus mode
    enterFocusMode,
    exitFocusMode,
    isInFocusMode,
    toggleFocusMode,
    
    // Sections
    showReader,
    showInput
};
