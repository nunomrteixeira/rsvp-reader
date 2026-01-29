/**
 * RSVP Reader - ORP Calculator Module
 * Calculates the Optimal Recognition Point for words based on eye-tracking research.
 * Also handles Bionic Reading mode (bold first part of words).
 * 
 * Scientific Background:
 * The ORP (Optimal Recognition Point) is based on research showing where the eye
 * naturally fixates for optimal word recognition:
 * - O'Regan, J.K., & Lévy-Schoen, A. (1987): OVP is ~20-40% from left
 * - Rayner, K. (1979): Initial fixation is typically left of center
 * - Brysbaert, M., & Nazir, T. (2005): OVP is 2-3 chars left of center
 * 
 * Dependencies: escapeHTML from text-processor.js
 */

import { escapeHTML } from './text-processor.js';

/**
 * @typedef {Object} WordParts
 * @property {string} before - Characters before the ORP (HTML-escaped)
 * @property {string} orp - The ORP character (HTML-escaped)
 * @property {string} after - Characters after the ORP (HTML-escaped)
 */

/**
 * Check if a character is a letter or digit (Unicode-aware)
 * Uses a fast path for ASCII and falls back to regex for Unicode.
 * 
 * @param {number} code - Character code point
 * @param {string} char - The actual character (for Unicode check)
 * @returns {boolean}
 */
function isLetterOrDigit(code, char) {
    // Fast path for ASCII alphanumerics
    if ((code >= 48 && code <= 57) ||   // 0-9
        (code >= 65 && code <= 90) ||   // A-Z
        (code >= 97 && code <= 122)) {  // a-z
        return true;
    }
    
    // Extended Latin characters (accented letters)
    if ((code >= 0x00C0 && code <= 0x00FF) ||  // Latin-1 Supplement (À-ÿ, excluding ×÷)
        (code >= 0x0100 && code <= 0x017F) ||  // Latin Extended-A
        (code >= 0x0180 && code <= 0x024F)) {  // Latin Extended-B
        // Exclude multiplication and division signs
        return code !== 0x00D7 && code !== 0x00F7;
    }
    
    // For other scripts (Cyrillic, Greek, CJK, etc.), use Unicode category check
    // This is slower but handles all Unicode letters
    if (code > 0x024F && char) {
        // Use regex with Unicode property escapes if supported
        try {
            return /[\p{L}\p{N}]/u.test(char);
        } catch (e) {
            // Fallback for environments without Unicode property support
            // At minimum, accept common script ranges
            return (code >= 0x0400 && code <= 0x04FF) ||  // Cyrillic
                   (code >= 0x0370 && code <= 0x03FF) ||  // Greek
                   (code >= 0x4E00 && code <= 0x9FFF) ||  // CJK Unified
                   (code >= 0x3040 && code <= 0x309F) ||  // Hiragana
                   (code >= 0x30A0 && code <= 0x30FF) ||  // Katakana
                   (code >= 0xAC00 && code <= 0xD7AF);    // Hangul
        }
    }
    
    return false;
}

/**
 * Reusable array for ORP calculation to reduce GC pressure
 * @type {number[]}
 */
const positionBuffer = new Array(200);

/**
 * Calculate the Optimal Recognition Point index for a word
 * 
 * Based on eye-tracking research, the ORP is typically positioned at:
 * - 1 char: position 0 (the only character)
 * - 2 chars: position 0 (first character, ~0%)
 * - 3 chars: position 1 (middle character, ~50%)
 * - 4-5 chars: position 1 (second character, ~25-33%)
 * - 6-9 chars: position 2 (third character, ~22-33%)
 * - 10-13 chars: position 3 (fourth character, ~23-30%)
 * - 14+ chars: approximately 27% from the left
 * 
 * Only letter and digit characters are considered for positioning;
 * punctuation is ignored in the calculation.
 * 
 * @param {string} word - The word to analyze
 * @returns {number} The character index of the ORP (0-based)
 * 
 * @example
 * calculate('the')    // Returns 1 (the 'h' - center)
 * calculate('hello')  // Returns 1 (the 'e')
 * calculate('a')      // Returns 0 (the 'a')
 * calculate('programming')  // Returns 3 (the 'g')
 */
export function calculate(word) {
    if (!word || typeof word !== 'string' || word.length === 0) {
        return 0;
    }
    
    // Find positions of all letter/digit characters
    let letterCount = 0;
    for (let i = 0; i < word.length && letterCount < positionBuffer.length; i++) {
        const code = word.charCodeAt(i);
        if (isLetterOrDigit(code, word[i])) {
            positionBuffer[letterCount++] = i;
        }
    }
    
    // If no letter/digit characters, return 0
    if (letterCount === 0) {
        return 0;
    }
    
    // Determine ORP position based on research
    // Target: approximately 25-35% from the left edge
    let orpIndex;
    
    if (letterCount === 1) {
        // Single character: position 0
        orpIndex = 0;
    } else if (letterCount === 2) {
        // Two characters: first character (can't be "between")
        orpIndex = 0;
    } else if (letterCount === 3) {
        // Three characters: middle character (index 1, ~50%)
        // Research shows center is optimal for very short words
        orpIndex = 1;
    } else if (letterCount <= 5) {
        // 4-5 characters: second character (index 1, ~25-33%)
        orpIndex = 1;
    } else if (letterCount <= 9) {
        // 6-9 characters: third character (index 2, ~22-33%)
        orpIndex = 2;
    } else if (letterCount <= 13) {
        // 10-13 characters: fourth character (index 3, ~23-30%)
        orpIndex = 3;
    } else {
        // Very long words: approximately 27% from left
        // This matches research findings for extended reading
        orpIndex = Math.floor(letterCount * 0.27);
    }
    
    // Return the actual character position in the original word
    return positionBuffer[orpIndex] || 0;
}

/**
 * Calculate the bionic fixation point (how many characters to bold)
 * Bionic reading bolds the first part of words to guide the eye.
 * Typically 40-50% of the word, with minimum of 1 character.
 * 
 * @param {string} word - The word to analyze
 * @returns {number} Number of characters to bold from start
 */
export function calculateBionicFixation(word) {
    if (!word || typeof word !== 'string' || word.length === 0) {
        return 0;
    }
    
    // Count letter/digit characters and track their positions
    let letterCount = 0;
    let lastLetterIndex = 0;
    for (let i = 0; i < word.length; i++) {
        const code = word.charCodeAt(i);
        if (isLetterOrDigit(code, word[i])) {
            letterCount++;
            lastLetterIndex = i;
        }
    }
    
    if (letterCount === 0) {
        return 0;
    }
    
    // Calculate fixation point based on word length
    // Bionic reading research suggests:
    // - Short words (1-2): bold all or most
    // - Medium words (3-6): bold about 50%
    // - Longer words: bold about 40-45%
    let boldCount;
    if (letterCount <= 2) {
        boldCount = letterCount; // Bold entire word
    } else if (letterCount === 3) {
        boldCount = 2; // Bold 2 of 3
    } else if (letterCount <= 6) {
        boldCount = Math.ceil(letterCount * 0.5); // ~50%
    } else if (letterCount <= 10) {
        boldCount = Math.ceil(letterCount * 0.45); // ~45%
    } else {
        boldCount = Math.ceil(letterCount * 0.4); // ~40%
    }
    
    // Find the actual character index for this bold count
    let counted = 0;
    for (let i = 0; i < word.length; i++) {
        const code = word.charCodeAt(i);
        if (isLetterOrDigit(code, word[i])) {
            counted++;
            if (counted >= boldCount) {
                return i + 1; // Return position after this character
            }
        }
    }
    
    return word.length;
}

/**
 * Split a word into parts around its ORP
 * All parts are HTML-escaped for safe rendering.
 * 
 * @param {string} word - The word to split
 * @param {boolean} [orpEnabled=true] - Whether to highlight ORP
 * @returns {WordParts} Object with before, orp, and after strings
 * 
 * @example
 * getWordParts('hello', true)
 * // Returns: { before: 'h', orp: 'e', after: 'llo' }
 * 
 * getWordParts('hello', false)
 * // Returns: { before: '', orp: 'hello', after: '' }
 */
export function getWordParts(word, orpEnabled = true) {
    if (!word || typeof word !== 'string') {
        return { before: '', orp: '', after: '' };
    }
    
    // When ORP is disabled, return entire word as the "orp" part
    if (!orpEnabled) {
        return {
            before: '',
            orp: escapeHTML(word),
            after: ''
        };
    }
    
    const orpIndex = calculate(word);
    
    return {
        before: escapeHTML(word.substring(0, orpIndex)),
        orp: escapeHTML(word[orpIndex] || ''),
        after: escapeHTML(word.substring(orpIndex + 1))
    };
}

/**
 * Get display parts for a chunk of words (may be multiple words)
 * Each word in the chunk gets its own ORP calculation.
 * 
 * @param {string} text - The text chunk (may contain spaces)
 * @param {boolean} [orpEnabled=true] - Whether to highlight ORP
 * @returns {WordParts[]} Array of word parts for each word
 * 
 * @example
 * getDisplayParts('hello world', true)
 * // Returns: [
 * //   { before: 'h', orp: 'e', after: 'llo' },
 * //   { before: 'w', orp: 'o', after: 'rld' }
 * // ]
 */
export function getDisplayParts(text, orpEnabled = true) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    
    // Split on spaces and process non-empty words
    const result = [];
    let start = 0;
    
    for (let i = 0; i <= text.length; i++) {
        if (i === text.length || text.charCodeAt(i) === 32) { // space or end
            if (i > start) {
                const word = text.substring(start, i);
                result.push(getWordParts(word, orpEnabled));
            }
            start = i + 1;
        }
    }
    
    return result;
}

/**
 * Generate HTML for displaying a word with ORP highlighting
 * 
 * @param {string} word - The word to render
 * @param {boolean} [orpEnabled=true] - Whether to highlight ORP
 * @returns {string} HTML string for the word
 * 
 * @example
 * renderWord('hello', true)
 * // Returns: '<span class="before">h</span><span class="orp">e</span><span class="after">llo</span>'
 */
export function renderWord(word, orpEnabled = true) {
    if (!orpEnabled) {
        return `<span class="word-plain">${escapeHTML(word)}</span>`;
    }
    const parts = getWordParts(word, orpEnabled);
    return `<span class="before">${parts.before}</span><span class="orp">${parts.orp}</span><span class="after">${parts.after}</span>`;
}

/**
 * Render a word in bionic reading format (bold first part)
 * 
 * @param {string} word - The word to render
 * @returns {string} HTML string with bionic formatting
 */
export function renderBionicWord(word) {
    if (!word || typeof word !== 'string') {
        return '';
    }
    
    const fixPoint = calculateBionicFixation(word);
    const boldPart = escapeHTML(word.substring(0, fixPoint));
    const normalPart = escapeHTML(word.substring(fixPoint));
    
    return `<span class="bionic-bold">${boldPart}</span><span class="bionic-normal">${normalPart}</span>`;
}

/**
 * Generate HTML for displaying a chunk of words with ORP highlighting
 * 
 * @param {string} text - The text chunk
 * @param {boolean} [orpEnabled=true] - Whether to highlight ORP
 * @param {boolean} [bionicMode=false] - Whether to use bionic reading format
 * @param {WordParts[]} [precomputedParts] - Pre-computed parts to avoid recalculation
 * @returns {string} HTML string for the chunk
 */
export function renderChunk(text, orpEnabled = true, bionicMode = false, precomputedParts = null) {
    // Bionic mode takes precedence - it replaces ORP highlighting
    if (bionicMode) {
        let html = '';
        let start = 0;
        let first = true;
        
        for (let i = 0; i <= text.length; i++) {
            if (i === text.length || text.charCodeAt(i) === 32) {
                if (i > start) {
                    if (!first) html += ' ';
                    first = false;
                    const word = text.substring(start, i);
                    html += `<span class="word-part bionic">${renderBionicWord(word)}</span>`;
                }
                start = i + 1;
            }
        }
        return html;
    }
    
    if (!orpEnabled) {
        return `<span class="word-part word-plain">${escapeHTML(text)}</span>`;
    }
    
    // Use pre-computed parts if available, otherwise compute
    const parts = precomputedParts || getDisplayParts(text, orpEnabled);
    
    let html = '';
    for (let i = 0; i < parts.length; i++) {
        if (i > 0) html += ' ';
        const p = parts[i];
        html += `<span class="word-part"><span class="before">${p.before}</span><span class="orp">${p.orp}</span><span class="after">${p.after}</span></span>`;
    }
    return html;
}

/**
 * Get the length of letter/digit characters in a word (Unicode-aware)
 * Useful for timing calculations.
 * 
 * @param {string} word - The word to measure
 * @returns {number} Count of letter/digit characters
 */
export function getLetterCount(word) {
    if (!word || typeof word !== 'string') {
        return 0;
    }
    
    let count = 0;
    for (let i = 0; i < word.length; i++) {
        const code = word.charCodeAt(i);
        if (isLetterOrDigit(code, word[i])) {
            count++;
        }
    }
    return count;
}

// Alias for backward compatibility
export const getAlphanumericLength = getLetterCount;

/**
 * Get the maximum letter/digit length among words in a chunk
 * 
 * @param {string} text - Text chunk (may contain multiple words)
 * @returns {number} Maximum letter/digit length
 */
export function getMaxWordLength(text) {
    if (!text || typeof text !== 'string') {
        return 0;
    }
    
    let maxLen = 0;
    let currentLen = 0;
    
    // Single pass through text, no array allocation
    for (let i = 0; i <= text.length; i++) {
        const code = i < text.length ? text.charCodeAt(i) : 32; // treat end as space
        
        if (code === 32) { // space
            if (currentLen > maxLen) {
                maxLen = currentLen;
            }
            currentLen = 0;
        } else if (isLetterOrDigit(code, text[i])) {
            currentLen++;
        }
    }
    
    return maxLen;
}

/**
 * @typedef {Object} PrecomputedWord
 * @property {string} text - The word/chunk text
 * @property {WordParts[]} parts - Pre-computed display parts
 * @property {string} html - Pre-rendered HTML
 * @property {number} maxLength - Pre-computed max letter/digit length
 * @property {number} orpIndex - Pre-computed ORP index
 */

/**
 * Precompute all display data for a list of words/chunks
 * Call this when loading text for optimal playback performance.
 * 
 * @param {string[]} words - Array of words or chunks
 * @param {boolean} [orpEnabled=true] - Whether ORP highlighting is enabled
 * @param {boolean} [bionicMode=false] - Whether bionic reading is enabled
 * @returns {PrecomputedWord[]} Array of precomputed word data
 */
export function precomputeWords(words, orpEnabled = true, bionicMode = false) {
    if (!Array.isArray(words)) {
        return [];
    }
    
    const result = new Array(words.length);
    
    for (let i = 0; i < words.length; i++) {
        const text = words[i];
        const parts = bionicMode ? null : getDisplayParts(text, orpEnabled);
        
        result[i] = {
            text,
            parts: parts || [],
            html: renderChunk(text, orpEnabled, bionicMode, parts),
            maxLength: getMaxWordLength(text),
            orpIndex: calculate(text)
        };
    }
    
    return result;
}

/**
 * Get information about ORP calculation for debugging/display
 * 
 * @param {string} word - The word to analyze
 * @returns {{ word: string, letterCount: number, orpIndex: number, orpChar: string, percentFromLeft: number }}
 */
export function getORPInfo(word) {
    if (!word || typeof word !== 'string') {
        return { word: '', letterCount: 0, orpIndex: 0, orpChar: '', percentFromLeft: 0 };
    }
    
    const letterCount = getLetterCount(word);
    const orpIndex = calculate(word);
    const orpChar = word[orpIndex] || '';
    const percentFromLeft = letterCount > 1 
        ? Math.round((orpIndex / (word.length - 1)) * 100)
        : 0;
    
    return {
        word,
        letterCount,
        orpIndex,
        orpChar,
        percentFromLeft
    };
}

// Default export for convenience
export default {
    calculate,
    calculateBionicFixation,
    getWordParts,
    getDisplayParts,
    renderWord,
    renderBionicWord,
    renderChunk,
    getLetterCount,
    getAlphanumericLength,
    getMaxWordLength,
    precomputeWords,
    getORPInfo
};
