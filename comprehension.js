/**
 * RSVP Reader - Comprehension Manager Module
 * Tracks words read and generates comprehension checks.
 * 
 * Features:
 * - Word tracking with circular buffer for memory efficiency
 * - Unicode-aware word processing (supports all languages)
 * - Multiple question types: word check, reflection, word count
 * - Configurable check intervals
 * - Answer tracking for statistics
 * 
 * Dependencies: CONFIG, COMMON_WORDS, DISTRACTOR_WORDS from config.js,
 *               State from state-manager.js
 */

import { CONFIG, COMMON_WORDS, DISTRACTOR_WORDS } from './config.js';
import { State } from './state-manager.js';

/**
 * @typedef {Object} WordCheckQuestion
 * @property {'wordCheck'} type - Question type
 * @property {string} question - The question text
 * @property {string[]} options - Array of word options
 * @property {string} correct - The correct answer (the fake word)
 * @property {number} optionCount - Number of options provided
 */

/**
 * @typedef {Object} ReflectionQuestion
 * @property {'reflection'} type - Question type
 * @property {string} question - The reflection prompt
 * @property {string} followUp - Self-assessment question
 * @property {string[]} options - Confidence options
 */

/**
 * @typedef {Object} WordCountQuestion
 * @property {'wordCount'} type - Question type
 * @property {string} question - The question text
 * @property {number[]} options - Array of number options
 * @property {number} correct - The correct word count
 */

/**
 * @typedef {WordCheckQuestion|ReflectionQuestion|WordCountQuestion} ComprehensionQuestion
 */

/**
 * @typedef {Object} ComprehensionResult
 * @property {ComprehensionQuestion} question - The question that was answered
 * @property {string|number} answer - The user's answer
 * @property {boolean} correct - Whether the answer was correct
 * @property {number} timestamp - When the question was answered
 */

/**
 * Pre-compiled regex for word cleaning (Unicode-aware)
 * Uses Unicode property escapes to match any letter character
 */
const NON_LETTER_PATTERN = /[^\p{L}]/gu;

/**
 * Fallback regex for environments without Unicode property support
 */
const NON_LETTER_FALLBACK = /[^a-zA-ZÀ-ÿ\u0100-\u017F\u0180-\u024F\u0400-\u04FF\u0370-\u03FF]/g;

/**
 * Test if Unicode property escapes are supported
 */
let useUnicodeRegex = true;
try {
    'test'.replace(/\p{L}/gu, '');
} catch (e) {
    useUnicodeRegex = false;
}

/**
 * Clean a word by removing non-letter characters
 * @private
 * @param {string} word - Word to clean
 * @returns {string} Cleaned word in lowercase
 */
function cleanWord(word) {
    const pattern = useUnicodeRegex ? NON_LETTER_PATTERN : NON_LETTER_FALLBACK;
    return word.toLowerCase().replace(pattern, '');
}

/**
 * Circular buffer for recent words (avoids O(n) shift operations)
 */
class CircularBuffer {
    constructor(capacity) {
        this.buffer = new Array(capacity);
        this.capacity = capacity;
        this.head = 0;
        this.size = 0;
    }
    
    push(item) {
        this.buffer[this.head] = item;
        this.head = (this.head + 1) % this.capacity;
        if (this.size < this.capacity) {
            this.size++;
        }
    }
    
    toArray() {
        if (this.size === 0) return [];
        
        const result = new Array(this.size);
        const start = this.size < this.capacity ? 0 : this.head;
        
        for (let i = 0; i < this.size; i++) {
            result[i] = this.buffer[(start + i) % this.capacity];
        }
        
        return result;
    }
    
    clear() {
        this.head = 0;
        this.size = 0;
        // Clear buffer to allow GC
        this.buffer.fill(undefined);
    }
    
    get length() {
        return this.size;
    }
}

/**
 * Internal state for comprehension tracking
 */
const state = {
    /** @type {number} Total words read since last reset */
    wordsRead: 0,
    
    /** @type {CircularBuffer} Recent significant words for quiz generation */
    recentWords: new CircularBuffer(CONFIG.COMPREHENSION.RECENT_WORDS_BUFFER),
    
    /** @type {number} Word count at last checkpoint */
    lastCheckpoint: 0,
    
    /** @type {boolean} Cached comprehension enabled state */
    cachedEnabled: false,
    
    /** @type {number} Cached interval */
    cachedInterval: 100,
    
    /** @type {ComprehensionResult[]} History of answered questions */
    history: [],
    
    /** @type {number} Questions answered correctly */
    correctCount: 0,
    
    /** @type {number} Total questions answered */
    totalCount: 0
};

/**
 * Array of reflection questions for variety
 * @private
 */
const REFLECTION_QUESTIONS = [
    'What was the main idea of what you just read?',
    'Can you summarize what you just read in one sentence?',
    'What do you think will happen next?',
    'How does this relate to what you already know?',
    'What questions do you have about what you read?',
    'What was the most important point?',
    'What details stood out to you?'
];

/**
 * Cache comprehension settings for hot path
 */
export function cacheSettings() {
    state.cachedEnabled = State.get('comprehensionEnabled') ?? false;
    state.cachedInterval = State.get('comprehensionInterval') ?? CONFIG.COMPREHENSION.DEFAULT_INTERVAL;
}

/**
 * Reset comprehension tracking state
 * Call when starting a new reading session or loading new text.
 * 
 * @param {boolean} [clearHistory=false] - Also clear answer history
 */
export function reset(clearHistory = false) {
    state.wordsRead = 0;
    state.recentWords.clear();
    state.lastCheckpoint = 0;
    cacheSettings();
    
    if (clearHistory) {
        state.history = [];
        state.correctCount = 0;
        state.totalCount = 0;
    }
}

/**
 * Track word(s) being read
 * Extracts significant words and checks if a comprehension break is due.
 * 
 * @param {string} word - The word or chunk being read
 * @param {number} [count=1] - Number of words in chunk (for multi-word display)
 * @returns {boolean} True if a comprehension check should be triggered
 * 
 * @example
 * // Single word
 * trackWord('programming')  // Returns false (or true if at interval)
 * 
 * // Multi-word chunk
 * trackWord('hello world', 2)  // Tracks as 2 words
 */
export function trackWord(word, count = 1) {
    // Only track if comprehension is enabled (use cached value)
    if (!state.cachedEnabled) {
        return false;
    }
    
    // Update word count
    state.wordsRead += count;
    
    // Extract significant words from the chunk
    let start = 0;
    for (let i = 0; i <= word.length; i++) {
        if (i === word.length || word[i] === ' ') {
            if (i > start) {
                const w = word.substring(start, i);
                const cleaned = cleanWord(w);
                
                // Only track words that are long enough and not common
                if (cleaned.length > CONFIG.COMPREHENSION.MIN_WORD_LENGTH && 
                    !COMMON_WORDS.has(cleaned)) {
                    state.recentWords.push(cleaned);
                }
            }
            start = i + 1;
        }
    }
    
    // Check if we've reached the interval (use cached value)
    if (state.wordsRead - state.lastCheckpoint >= state.cachedInterval) {
        state.lastCheckpoint = state.wordsRead;
        return true;
    }
    
    return false;
}

/**
 * Generate a comprehension check question
 * Returns either a word-check quiz, a reflection prompt, or a word count question.
 * 
 * @param {string} [preferredType] - Preferred question type: 'wordCheck', 'reflection', 'wordCount'
 * @returns {ComprehensionQuestion} The generated question
 * 
 * @example
 * generate()
 * // Returns either:
 * // { type: 'wordCheck', question: 'Which word did NOT appear?', 
 * //   options: ['programming', 'algorithm', 'function', 'nebula'], 
 * //   correct: 'nebula', optionCount: 4 }
 * // or:
 * // { type: 'reflection', question: 'What was the main idea?' }
 */
export function generate(preferredType) {
    // If explicitly requesting reflection, return one
    if (preferredType === 'reflection') {
        return generateReflection();
    }
    
    // If requesting word count, return one
    if (preferredType === 'wordCount') {
        return generateWordCount();
    }
    
    // Get unique recent words
    const recentArray = state.recentWords.toArray();
    const uniqueWords = [...new Set(recentArray)];
    
    // If we don't have enough unique words for a quiz, return reflection
    const minWordsNeeded = CONFIG.COMPREHENSION.MIN_WORDS_FOR_CHECK;
    if (uniqueWords.length < minWordsNeeded) {
        return generateReflection();
    }
    
    // Shuffle and take real words
    const shuffledReal = shuffle([...uniqueWords]);
    const realWordCount = Math.min(3, shuffledReal.length);
    const realWords = shuffledReal.slice(0, realWordCount);
    
    // Pick a random fake word that's not in our recent words
    const uniqueSet = new Set(uniqueWords);
    const availableFakes = DISTRACTOR_WORDS.filter(f => !uniqueSet.has(f.toLowerCase()));
    
    // If no available fakes (very unlikely), fall back to reflection
    if (availableFakes.length === 0) {
        return generateReflection();
    }
    
    const fakeWord = availableFakes[Math.floor(Math.random() * availableFakes.length)];
    
    // Combine and shuffle all options
    const allWords = shuffle([...realWords, fakeWord]);
    
    return {
        type: 'wordCheck',
        question: 'Which word did NOT appear in the text?',
        options: allWords,
        correct: fakeWord,
        optionCount: allWords.length
    };
}

/**
 * Generate a reflection question with self-assessment
 * @private
 * @returns {ReflectionQuestion}
 */
function generateReflection() {
    const question = REFLECTION_QUESTIONS[Math.floor(Math.random() * REFLECTION_QUESTIONS.length)];
    return {
        type: 'reflection',
        question,
        followUp: 'How well could you answer this?',
        options: ['Not at all', 'Partially', 'Mostly', 'Completely']
    };
}

/**
 * Generate a word count question
 * @private
 * @returns {WordCountQuestion}
 */
function generateWordCount() {
    const actual = state.wordsRead;
    
    // Generate plausible wrong answers
    const variance = Math.max(20, Math.floor(actual * 0.2)); // 20% variance, min 20
    const options = [
        actual,
        actual + variance,
        actual - variance,
        actual + Math.floor(variance * 0.5)
    ].filter(n => n > 0); // Remove negative numbers
    
    // Ensure we have 4 unique options
    while (options.length < 4) {
        const newOption = actual + Math.floor(Math.random() * variance * 2) - variance;
        if (newOption > 0 && !options.includes(newOption)) {
            options.push(newOption);
        }
    }
    
    return {
        type: 'wordCount',
        question: 'Approximately how many words have you read?',
        options: shuffle(options.slice(0, 4)),
        correct: actual
    };
}

/**
 * Record an answer to a comprehension question
 * 
 * @param {ComprehensionQuestion} question - The question that was answered
 * @param {string|number} answer - The user's answer
 * @returns {boolean} Whether the answer was correct (or high confidence for reflection)
 */
export function recordAnswer(question, answer) {
    let correct = false;
    
    if (question.type === 'wordCheck') {
        correct = answer === question.correct;
    } else if (question.type === 'wordCount') {
        // For word count, accept within 10% as correct
        const tolerance = Math.max(10, Math.floor(question.correct * 0.1));
        correct = Math.abs(answer - question.correct) <= tolerance;
    } else if (question.type === 'reflection') {
        // Reflection questions are self-assessed
        // "Mostly" or "Completely" counts as successful comprehension
        correct = answer === 'Mostly' || answer === 'Completely';
    }
    
    state.totalCount++;
    if (correct) {
        state.correctCount++;
    }
    
    state.history.push({
        question,
        answer,
        correct,
        timestamp: Date.now()
    });
    
    return correct;
}

/**
 * Get current comprehension stats
 * 
 * @returns {{ wordsRead: number, recentWordsCount: number, lastCheckpoint: number, correctCount: number, totalCount: number, accuracy: number }}
 */
export function getStats() {
    return {
        wordsRead: state.wordsRead,
        recentWordsCount: state.recentWords.length,
        lastCheckpoint: state.lastCheckpoint,
        correctCount: state.correctCount,
        totalCount: state.totalCount,
        accuracy: state.totalCount > 0 ? Math.round((state.correctCount / state.totalCount) * 100) : 0
    };
}

/**
 * Get answer history
 * 
 * @param {number} [limit] - Maximum number of results to return
 * @returns {ComprehensionResult[]} Array of answered questions (newest first)
 */
export function getHistory(limit) {
    const history = [...state.history].reverse();
    return limit ? history.slice(0, limit) : history;
}

/**
 * Get words until next checkpoint
 * 
 * @returns {number} Words remaining until next comprehension check
 */
export function getWordsUntilCheck() {
    if (!state.cachedEnabled) {
        return Infinity;
    }
    
    return Math.max(0, state.cachedInterval - (state.wordsRead - state.lastCheckpoint));
}

/**
 * Check if comprehension checks are due soon
 * 
 * @param {number} [threshold=10] - Words threshold for "soon"
 * @returns {boolean} True if check is coming within threshold words
 */
export function isCheckSoon(threshold = 10) {
    return getWordsUntilCheck() <= threshold;
}

/**
 * Check if comprehension tracking is enabled
 * 
 * @returns {boolean}
 */
export function isEnabled() {
    return state.cachedEnabled;
}

/**
 * Manually trigger checkpoint (e.g., after pause)
 * Resets the interval counter without triggering a check.
 */
export function resetCheckpoint() {
    state.lastCheckpoint = state.wordsRead;
}

/**
 * Add words directly to the recent words buffer
 * Useful for pre-populating from context.
 * 
 * @param {string[]} words - Array of words to add
 */
export function addWords(words) {
    if (!Array.isArray(words)) return;
    
    for (const word of words) {
        if (typeof word !== 'string') continue;
        
        const cleaned = cleanWord(word);
        if (cleaned.length > CONFIG.COMPREHENSION.MIN_WORD_LENGTH && 
            !COMMON_WORDS.has(cleaned)) {
            state.recentWords.push(cleaned);
        }
    }
}

/**
 * Get the unique significant words currently tracked
 * Useful for debugging or displaying to user.
 * 
 * @returns {string[]} Array of unique words
 */
export function getTrackedWords() {
    return [...new Set(state.recentWords.toArray())];
}

/**
 * Fisher-Yates shuffle algorithm
 * @private
 * @param {any[]} array - Array to shuffle
 * @returns {any[]} Shuffled array (mutates original)
 */
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Default export for convenience
export default {
    reset,
    trackWord,
    generate,
    recordAnswer,
    getStats,
    getHistory,
    getWordsUntilCheck,
    isCheckSoon,
    isEnabled,
    resetCheckpoint,
    addWords,
    getTrackedWords,
    cacheSettings
};
