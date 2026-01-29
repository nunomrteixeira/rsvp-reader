/**
 * RSVP Reader - Text Processor Module
 * Pure functions for text parsing, chunking, validation, and escaping.
 * 
 * Dependencies: CONFIG from config.js
 * 
 * Features:
 * - Text parsing with Unicode support
 * - Word chunking for multi-word display
 * - HTML escaping for XSS prevention
 * - HTML stripping with entity decoding
 * - Reading time estimation
 */

import { CONFIG } from './config.js';

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the text is valid
 * @property {string} message - Human-readable status message
 * @property {number} wordCount - Number of words found
 */

/**
 * @typedef {Object} ContextResult
 * @property {string} before - Words before current position
 * @property {string} current - Current word
 * @property {string} after - Words after current position
 */

/**
 * HTML entity map for escaping
 * Includes all characters that could enable XSS in HTML contexts
 * @type {Object<string, string>}
 */
const HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

/**
 * Regex for matching HTML special characters
 * @type {RegExp}
 */
const HTML_SPECIAL_CHARS = /[&<>"']/g;

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for innerHTML
 * 
 * @example
 * escapeHTML('<script>alert("xss")</script>')
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 */
export function escapeHTML(str) {
    if (!str || typeof str !== 'string') {
        return '';
    }
    return str.replace(HTML_SPECIAL_CHARS, char => HTML_ENTITIES[char]);
}

/**
 * Parse text into an array of words
 * Normalizes whitespace, line breaks, and handles Unicode properly.
 * 
 * @param {string} text - Raw text input
 * @returns {string[]} Array of words (never null)
 * 
 * @example
 * parseText('Hello   world!\nNew line.')
 * // Returns: ['Hello', 'world!', 'New', 'line.']
 */
export function parseText(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    
    // Remove zero-width characters that could cause words to stick together
    // U+200B: Zero-width space
    // U+200C: Zero-width non-joiner
    // U+200D: Zero-width joiner (keep in emoji sequences? for now remove)
    // U+FEFF: BOM / zero-width no-break space
    let normalized = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
    
    // Normalize all whitespace (including Unicode spaces) and line breaks
    // \s matches: [ \f\n\r\t\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]
    normalized = normalized.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    
    if (normalized.length === 0) {
        return [];
    }
    
    return normalized.split(' ');
}

/**
 * Chunk words into groups for multi-word display
 * 
 * @param {string[]} words - Array of words
 * @param {number} chunkSize - Number of words per chunk (1-3)
 * @returns {string[]} Array of chunked word groups
 * 
 * @example
 * chunkWords(['a', 'b', 'c', 'd', 'e'], 2)
 * // Returns: ['a b', 'c d', 'e']
 */
export function chunkWords(words, chunkSize) {
    if (!Array.isArray(words) || words.length === 0) {
        return [];
    }
    
    // Clamp chunk size to valid range
    const size = Math.max(
        CONFIG.CHUNK.MIN,
        Math.min(CONFIG.CHUNK.MAX, parseInt(chunkSize, 10) || 1)
    );
    
    if (size <= 1) {
        return [...words]; // Return copy to avoid mutation
    }
    
    // Pre-allocate array for better performance
    const chunkCount = Math.ceil(words.length / size);
    const chunks = new Array(chunkCount);
    
    for (let i = 0, chunkIdx = 0; i < words.length; i += size, chunkIdx++) {
        // Build chunk string directly instead of slice().join()
        let chunk = words[i];
        const end = Math.min(i + size, words.length);
        for (let j = i + 1; j < end; j++) {
            chunk += ' ' + words[j];
        }
        chunks[chunkIdx] = chunk;
    }
    
    return chunks;
}

/**
 * Get surrounding context for a word at a given index
 * 
 * @param {string[]} words - Array of words
 * @param {number} index - Current word index
 * @param {number} [contextSize=8] - Number of words to include on each side
 * @returns {ContextResult} Object with before, current, and after strings
 * 
 * @example
 * getContext(['a', 'b', 'c', 'd', 'e'], 2, 2)
 * // Returns: { before: 'a b', current: 'c', after: 'd e' }
 */
export function getContext(words, index, contextSize = 8) {
    if (!Array.isArray(words) || words.length === 0) {
        return { before: '', current: '', after: '' };
    }
    
    const idx = Math.max(0, Math.min(words.length - 1, index));
    const size = Math.max(1, parseInt(contextSize, 10) || 8);
    
    const start = Math.max(0, idx - size);
    const end = Math.min(words.length, idx + size + 1);
    
    return {
        before: words.slice(start, idx).join(' '),
        current: words[idx] || '',
        after: words.slice(idx + 1, end).join(' ')
    };
}

/**
 * Validate text input for RSVP reading
 * 
 * @param {string} text - Text to validate
 * @returns {ValidationResult} Validation result with status and word count
 * 
 * @example
 * validate('Hello world!')
 * // Returns: { valid: true, message: 'OK', wordCount: 2 }
 * 
 * validate('')
 * // Returns: { valid: false, message: 'Please paste some text first!', wordCount: 0 }
 */
export function validate(text) {
    if (!text || typeof text !== 'string') {
        return {
            valid: false,
            message: 'Please paste some text first!',
            wordCount: 0
        };
    }
    
    const words = parseText(text);
    
    if (words.length === 0) {
        return {
            valid: false,
            message: 'No readable text found.',
            wordCount: 0
        };
    }
    
    if (words.length < CONFIG.TEXT.MIN_WORDS) {
        return {
            valid: false,
            message: `Please paste at least ${CONFIG.TEXT.MIN_WORDS} words.`,
            wordCount: words.length
        };
    }
    
    return {
        valid: true,
        message: 'OK',
        wordCount: words.length
    };
}

/**
 * Count words in text (quick count without full parsing)
 * 
 * @param {string} text - Text to count
 * @returns {number} Approximate word count
 */
export function countWords(text) {
    if (!text || typeof text !== 'string') {
        return 0;
    }
    const matches = text.trim().match(/\S+/g);
    return matches ? matches.length : 0;
}

/**
 * Truncate text to a maximum number of words
 * 
 * @param {string} text - Text to truncate
 * @param {number} maxWords - Maximum number of words
 * @param {string} [suffix='...'] - Suffix to add if truncated
 * @returns {string} Truncated text
 * 
 * @example
 * truncateWords('one two three four five', 3)
 * // Returns: 'one two three...'
 */
export function truncateWords(text, maxWords, suffix = '...') {
    const words = parseText(text);
    
    if (words.length <= maxWords) {
        return text.trim();
    }
    
    return words.slice(0, maxWords).join(' ') + suffix;
}

/**
 * Extract clean text content from HTML string
 * Useful for processing fetched web content.
 * Handles Unicode entities including emoji correctly.
 * 
 * @param {string} html - HTML string
 * @returns {string} Plain text content
 */
export function stripHTML(html) {
    if (!html || typeof html !== 'string') {
        return '';
    }
    
    // Remove script, style, and other non-content elements entirely
    let text = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');  // Remove all HTML tags
    
    // Decode HTML entities
    // Named entities first
    text = text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&ndash;/gi, '–')
        .replace(/&mdash;/gi, '—')
        .replace(/&lsquo;|&rsquo;/gi, "'")
        .replace(/&ldquo;|&rdquo;/gi, '"')
        .replace(/&hellip;/gi, '…')
        .replace(/&copy;/gi, '©')
        .replace(/&reg;/gi, '®')
        .replace(/&trade;/gi, '™');
    
    // Numeric entities (decimal) - use fromCodePoint for full Unicode support
    text = text.replace(/&#(\d+);/g, (match, code) => {
        const codePoint = parseInt(code, 10);
        // Validate code point is in valid Unicode range
        if (codePoint > 0 && codePoint <= 0x10FFFF) {
            try {
                return String.fromCodePoint(codePoint);
            } catch (e) {
                return ''; // Invalid code point
            }
        }
        return ''; // Out of range
    });
    
    // Numeric entities (hexadecimal)
    text = text.replace(/&#x([0-9a-f]+);/gi, (match, code) => {
        const codePoint = parseInt(code, 16);
        // Validate code point is in valid Unicode range
        if (codePoint > 0 && codePoint <= 0x10FFFF) {
            try {
                return String.fromCodePoint(codePoint);
            } catch (e) {
                return ''; // Invalid code point
            }
        }
        return ''; // Out of range
    });
    
    // Remove any remaining unrecognized entities
    text = text.replace(/&[a-z]+;/gi, ' ');
    
    // Normalize whitespace
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Get reading statistics for text
 * 
 * @param {string} text - Text to analyze
 * @param {number} wpm - Words per minute
 * @returns {{ wordCount: number, charCount: number, sentenceCount: number, avgWordLength: number, estimatedTimeMs: number, estimatedTimeFormatted: string }}
 */
export function getTextStats(text, wpm = 300) {
    const words = parseText(text);
    const wordCount = words.length;
    const charCount = words.join('').length; // Character count excluding spaces
    const sentenceCount = countSentences(text);
    const avgWordLength = wordCount > 0 ? Math.round((charCount / wordCount) * 10) / 10 : 0;
    const effectiveWpm = Math.max(1, wpm);
    const estimatedTimeMs = wordCount > 0 ? Math.round((wordCount / effectiveWpm) * 60000) : 0;
    
    // Format time
    const seconds = Math.floor(estimatedTimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    
    let estimatedTimeFormatted;
    if (hours > 0) {
        estimatedTimeFormatted = `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
        estimatedTimeFormatted = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    return {
        wordCount,
        charCount,
        sentenceCount,
        avgWordLength,
        estimatedTimeMs,
        estimatedTimeFormatted
    };
}

/**
 * Count sentences in text
 * Handles common abbreviations and edge cases.
 * 
 * @param {string} text - Text to analyze
 * @returns {number} Approximate sentence count
 */
export function countSentences(text) {
    if (!text || typeof text !== 'string') {
        return 0;
    }
    
    // Remove common abbreviations that contain periods
    let normalized = text
        .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|Inc|Ltd|Corp|Ave|St|Blvd)\./gi, '$1')
        .replace(/\b([A-Z])\./g, '$1'); // Single letter initials like "J. K. Rowling"
    
    // Count sentence-ending punctuation
    const matches = normalized.match(/[.!?]+(?:\s|$)/g);
    return matches ? matches.length : (text.trim().length > 0 ? 1 : 0);
}

/**
 * Extract sentences from text
 * Useful for comprehension question generation.
 * 
 * @param {string} text - Text to split
 * @returns {string[]} Array of sentences
 */
export function extractSentences(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    
    // Split on sentence-ending punctuation, keeping the punctuation
    // This regex handles: "Hello. World!" -> ["Hello.", "World!"]
    const sentences = text
        .replace(/([.!?]+)\s+/g, '$1|||')  // Mark sentence boundaries
        .split('|||')
        .map(s => s.trim())
        .filter(s => s.length > 0);
    
    return sentences;
}

/**
 * Check if a word is likely a "long" word that needs extra reading time
 * 
 * @param {string} word - Word to check
 * @param {number} [threshold=8] - Character threshold for "long" words
 * @returns {boolean} True if word is considered long
 */
export function isLongWord(word, threshold = 8) {
    if (!word || typeof word !== 'string') {
        return false;
    }
    // Remove punctuation for length check
    const cleaned = word.replace(/[^\w]/g, '');
    return cleaned.length >= threshold;
}

/**
 * Check if a word ends with sentence-ending punctuation
 * 
 * @param {string} word - Word to check
 * @returns {boolean} True if word ends a sentence
 */
export function isSentenceEnd(word) {
    if (!word || typeof word !== 'string') {
        return false;
    }
    return /[.!?]$/.test(word);
}

/**
 * Check if a word contains punctuation that might need a pause
 * 
 * @param {string} word - Word to check
 * @returns {boolean} True if word has significant punctuation
 */
export function hasPunctuation(word) {
    if (!word || typeof word !== 'string') {
        return false;
    }
    // Check for sentence-ending, comma, semicolon, colon, or dash
    return /[.!?,;:\-—]/.test(word);
}

// Default export for convenience
export default {
    escapeHTML,
    parseText,
    chunkWords,
    getContext,
    validate,
    countWords,
    truncateWords,
    stripHTML,
    getTextStats,
    countSentences,
    extractSentences,
    isLongWord,
    isSentenceEnd,
    hasPunctuation
};
