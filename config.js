/**
 * RSVP Reader - Configuration Module
 * Central repository for all constants, defaults, and presets.
 * No dependencies.
 * 
 * NOTE: When updating VERSION, also update CACHE_VERSION in sw.js
 */

export const VERSION = '3.0.0';

/**
 * Application-wide constants
 */
export const CONFIG = {
    // Timing constants
    TIMING: {
        WARMUP_START_RATIO: 0.5,
        ANALYTICS_UPDATE_INTERVAL_MS: 5000,
        DEBOUNCE_DELAY_MS: 150,
        MODAL_CLOSE_DELAY_MS: 800,
        AUDIO_SUSPEND_DELAY_MS: 30000
    },

    // Warmup settings
    WARMUP: {
        MIN_DURATION_S: 5,
        MAX_DURATION_S: 60,
        DEFAULT_DURATION_S: 10
    },

    // WPM boundaries
    WPM: {
        MIN: 100,
        MAX: 1500,
        DEFAULT: 300,
        STEP: 25
    },

    // Word length thresholds for timing adjustments
    WORD_LENGTH: {
        SHORT: 6,
        MEDIUM: 8,
        LONG: 12
    },

    // Timing multipliers based on word length
    TIMING_MULTIPLIERS: {
        SHORT: 1.0,
        MEDIUM: 1.1,
        LONG: 1.2,
        VERY_LONG: 1.4
    },

    // Punctuation pause ratios
    PUNCTUATION: {
        FULL_STOP: 1.0,      // . ! ?
        PARTIAL_STOP: 0.5    // , ; :
    },

    // Font size boundaries
    FONT_SIZE: {
        MIN: 24,
        MAX: 72,
        DEFAULT: 42
    },

    // Chunk size options
    CHUNK: {
        MIN: 1,
        MAX: 3,
        DEFAULT: 1
    },

    // Comprehension settings
    COMPREHENSION: {
        MIN_INTERVAL: 50,
        MAX_INTERVAL: 500,
        DEFAULT_INTERVAL: 100,
        RECENT_WORDS_BUFFER: 20,
        MIN_WORD_LENGTH: 3,
        MIN_WORDS_FOR_CHECK: 4
    },

    // Pause duration boundaries (ms)
    PAUSE_DURATION: {
        MIN: 100,
        MAX: 500,
        DEFAULT: 200
    },

    // Analytics
    ANALYTICS: {
        STREAK_DAYS_DISPLAY: 7,
        SESSION_TIMEOUT_MS: 300000  // 5 minutes
    },

    // Speed Training
    SPEED_TRAINING: {
        MIN_INCREMENT: 10,
        MAX_INCREMENT: 100,
        DEFAULT_INCREMENT: 25,
        MIN_MAX_WPM: 200,
        MAX_MAX_WPM: 1500,
        DEFAULT_MAX_WPM: 600,
        INTERVAL_WORDS: 100  // Words between speed increases
    },

    // Library
    LIBRARY: {
        MAX_ITEMS: 100,
        TITLE_MAX_LENGTH: 100,
        PREVIEW_LENGTH: 200
    },

    // Text validation
    TEXT: {
        MIN_WORDS: 3,
        MIN_URL_EXTRACT_LENGTH: 50
    },

    // Storage keys
    STORAGE_KEYS: {
        SETTINGS: 'rsvp-settings',
        ANALYTICS: 'rsvp-analytics',
        SHORTCUTS: 'rsvp-shortcuts',
        LIBRARY: 'rsvp-library',
        BACKUP_SUFFIX: '-backup'
    },

    // Sound types
    SOUNDS: ['none', 'whitenoise', 'rain', 'wind', 'fire'],

    // ORP calculation thresholds
    ORP: {
        VERY_SHORT: 1,
        SHORT: 4,
        MEDIUM: 6,
        LONG: 10
    }
};

/**
 * Default settings for new users
 */
export const DEFAULTS = {
    // Display
    theme: 'dark',
    accentColor: 'orange',
    fontSize: CONFIG.FONT_SIZE.DEFAULT,
    fontFamily: 'serif',

    // Reading behavior
    wpm: CONFIG.WPM.DEFAULT,
    chunkSize: CONFIG.CHUNK.DEFAULT,
    orpEnabled: true,
    bionicMode: false,
    peripheralPreview: false,

    // Timing
    fixedTiming: false,
    punctuationPauses: true,
    pauseDuration: CONFIG.PAUSE_DURATION.DEFAULT,
    warmupEnabled: true,
    warmupDuration: CONFIG.WARMUP.DEFAULT_DURATION_S,

    // Features
    autoRestart: false,
    comprehensionEnabled: false,
    comprehensionInterval: CONFIG.COMPREHENSION.DEFAULT_INTERVAL,

    // Speed Training
    speedTrainingEnabled: false,
    speedTrainingIncrement: CONFIG.SPEED_TRAINING.DEFAULT_INCREMENT,
    speedTrainingMaxWpm: CONFIG.SPEED_TRAINING.DEFAULT_MAX_WPM,
    speedTrainingCurrentWpm: CONFIG.WPM.DEFAULT,

    // Sound
    soundVolume: 30,
    activeSound: 'none',

    // Profile
    activeProfile: 'custom'
};

/**
 * @typedef {Object} ProfileSettings
 * @property {number} wpm - Words per minute
 * @property {number} chunkSize - Words per chunk (1-3)
 * @property {boolean} orpEnabled - Optimal Recognition Point highlighting
 * @property {boolean} [bionicMode] - Bionic reading mode (bold word beginnings)
 * @property {boolean} peripheralPreview - Show surrounding words
 * @property {boolean} fixedTiming - Use fixed timing regardless of word length
 * @property {boolean} punctuationPauses - Pause at punctuation
 * @property {number} [pauseDuration] - Duration of punctuation pauses (ms)
 * @property {boolean} warmupEnabled - Gradual speed warmup
 * @property {number} warmupDuration - Warmup duration in seconds
 * @property {boolean} comprehensionEnabled - Enable comprehension checks
 * @property {number} [comprehensionInterval] - Words between comprehension checks
 * @property {string} [fontFamily] - Font family override
 * @property {number} [fontSize] - Font size override
 */

/**
 * @typedef {Object} Profile
 * @property {string} name - Display name
 * @property {string} description - Profile description
 * @property {string} color - Theme color (hex)
 * @property {ProfileSettings|null} settings - Profile settings (null for custom)
 */

/**
 * Reading profile presets
 * @type {Object<string, Profile>}
 */
export const PROFILES = {
    news: {
        name: 'News',
        description: 'Fast scanning for articles and emails',
        color: '#4a9eff',
        settings: {
            wpm: 400,
            chunkSize: 2,
            orpEnabled: true,
            peripheralPreview: false,
            fixedTiming: true,
            punctuationPauses: false,
            warmupEnabled: false,
            warmupDuration: 5,
            comprehensionEnabled: false
        }
    },
    study: {
        name: 'Study',
        description: 'Balanced speed with comprehension checks',
        color: '#44cc88',
        settings: {
            wpm: 250,
            chunkSize: 1,
            orpEnabled: true,
            peripheralPreview: true,
            fixedTiming: false,
            punctuationPauses: true,
            warmupEnabled: true,
            warmupDuration: 10,
            comprehensionEnabled: true,
            comprehensionInterval: 75
        }
    },
    fiction: {
        name: 'Fiction',
        description: 'Natural pacing for immersive reading',
        color: '#cc88ff',
        settings: {
            wpm: 300,
            chunkSize: 1,
            orpEnabled: true,
            peripheralPreview: true,
            fixedTiming: false,
            punctuationPauses: true,
            pauseDuration: 300,
            warmupEnabled: true,
            warmupDuration: 8,
            comprehensionEnabled: false
        }
    },
    focus: {
        name: 'Focus',
        description: 'Push your limits with high-speed training',
        color: '#ffaa44',
        settings: {
            wpm: 500,
            chunkSize: 1,
            orpEnabled: true,
            peripheralPreview: false,
            fixedTiming: true,
            punctuationPauses: false,
            warmupEnabled: true,
            warmupDuration: 15,
            comprehensionEnabled: false
        }
    },
    dyslexia: {
        name: 'Dyslexia',
        description: 'Optimized for dyslexic readers',
        color: '#ff6b9d',
        settings: {
            wpm: 200,
            chunkSize: 1,
            orpEnabled: false,
            bionicMode: true,  // Bionic reading helps dyslexic readers
            peripheralPreview: false,
            fixedTiming: false,
            punctuationPauses: true,
            pauseDuration: 300,
            warmupEnabled: true,
            warmupDuration: 12,
            comprehensionEnabled: false,
            fontFamily: 'dyslexic',
            fontSize: 54
        }
    },
    custom: {
        name: 'Custom',
        description: 'Your personalized settings',
        color: '#888888',
        settings: null  // Uses current settings
    }
};

/**
 * Keyboard shortcut defaults
 */
export const DEFAULT_SHORTCUTS = {
    playPause: 'Space',
    prev: 'ArrowLeft',
    next: 'ArrowRight',
    reset: 'KeyR',
    speedUp: 'ArrowUp',
    speedDown: 'ArrowDown',
    showHelp: 'Slash',  // ? key (shift+/)
    skipComprehension: 'Escape'
};

/**
 * Shortcut action metadata
 */
export const SHORTCUT_ACTIONS = {
    playPause: { name: 'Play/Pause' },
    prev: { name: 'Previous' },
    next: { name: 'Next' },
    reset: { name: 'Reset' },
    speedUp: { name: 'Speed Up' },
    speedDown: { name: 'Speed Down' },
    showHelp: { name: 'Show Help' },
    skipComprehension: { name: 'Skip Comprehension' }
};

/**
 * Common words to exclude from comprehension checks
 * These are stop words and high-frequency words that don't test comprehension
 */
export const COMMON_WORDS = new Set([
    // Articles & determiners
    'the', 'a', 'an', 'this', 'that', 'these', 'those', 'some', 'any', 'all',
    'each', 'every', 'both', 'few', 'more', 'most', 'other', 'such', 'no', 'nor',
    // Pronouns
    'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself', 'we', 'us', 'our', 'ours', 'ourselves',
    'they', 'them', 'their', 'theirs', 'themselves',
    'who', 'whom', 'whose', 'which', 'what', 'whatever', 'whoever',
    // Be verbs
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
    // Common verbs
    'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'done',
    'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
    'can', 'need', 'dare', 'ought', 'used', 'get', 'got', 'gets', 'getting',
    'make', 'made', 'makes', 'let', 'lets', 'say', 'says', 'said', 'go', 'goes', 'went', 'gone',
    'take', 'takes', 'took', 'taken', 'come', 'comes', 'came', 'see', 'saw', 'seen',
    'know', 'knows', 'knew', 'known', 'think', 'thinks', 'thought', 'want', 'wants', 'wanted',
    // Prepositions
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'over', 'out', 'up', 'down', 'off', 'about', 'around',
    'against', 'among', 'within', 'without', 'along', 'across', 'behind',
    // Conjunctions
    'and', 'but', 'if', 'or', 'so', 'yet', 'nor', 'for', 'because', 'although',
    'while', 'whereas', 'unless', 'since', 'until', 'when', 'where', 'whether',
    // Adverbs
    'than', 'too', 'very', 'just', 'also', 'only', 'even', 'still', 'already',
    'ever', 'never', 'always', 'often', 'sometimes', 'usually', 'perhaps',
    'now', 'then', 'here', 'there', 'where', 'when', 'how', 'why',
    'well', 'back', 'much', 'many', 'way', 'long', 'little', 'own',
    'really', 'quite', 'rather', 'almost', 'enough', 'else', 'away',
    // Other common words
    'not', 'yes', 'like', 'just', 'over', 'new', 'first', 'last',
    'good', 'great', 'right', 'old', 'big', 'high', 'small', 'large',
    'next', 'early', 'young', 'important', 'different', 'same', 'able',
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'people', 'time', 'year', 'years', 'day', 'days', 'thing', 'things',
    'man', 'men', 'woman', 'women', 'child', 'children', 'world', 'life',
    'hand', 'part', 'place', 'case', 'week', 'work', 'fact', 'point'
]);

/**
 * Distractor words for comprehension checks
 * These are real but uncommon words used as wrong answers.
 * Expanded list prevents repetition and keeps checks challenging.
 */
export const DISTRACTOR_WORDS = [
    // Science & technical
    'quantum', 'nebula', 'entropy', 'algorithm', 'catalyst', 'spectrum',
    'quasar', 'axiom', 'isotope', 'molecule', 'photon', 'nucleus',
    'velocity', 'amplitude', 'fractal', 'genome', 'enzyme', 'neuron',
    // Philosophy & abstract
    'paradox', 'synthesis', 'metaphor', 'paradigm', 'dialectic', 'cipher',
    'zenith', 'vortex', 'ethereal', 'ephemeral', 'esoteric', 'ubiquitous',
    'dichotomy', 'enigma', 'rhetoric', 'cognition', 'empirical', 'inference',
    // Uncommon but real
    'xylophone', 'labyrinth', 'cacophony', 'mellifluous', 'serendipity',
    'eloquent', 'luminous', 'transcend', 'juxtapose', 'plethora',
    'quintessential', 'sycophant', 'obfuscate', 'meticulous', 'resilient',
    // Nature & geography
    'archipelago', 'tundra', 'fjord', 'plateau', 'monsoon', 'aurora',
    'glacier', 'volcano', 'canyon', 'savanna', 'tributary', 'estuary',
    // Arts & culture
    'symphony', 'mosaic', 'fresco', 'sonata', 'baroque', 'renaissance',
    'silhouette', 'palette', 'sculpture', 'tapestry', 'porcelain', 'origami',
    // Miscellaneous uncommon
    'chronicle', 'odyssey', 'sanctuary', 'threshold', 'harbinger', 'pinnacle',
    'crescendo', 'maverick', 'zeitgeist', 'wanderlust', 'nostalgia', 'utopia'
];

/**
 * Sample text for demo
 */
export const SAMPLE_TEXT = `Speed reading is a powerful skill that can dramatically increase how much you can learn and absorb. By eliminating subvocalization and reducing eye movements, readers can process text much faster.

RSVP technology takes this further by presenting words exactly where your eyes are focused. The Optimal Recognition Point, shown in red, guides your brain to the most important part of each word.

Try the Study profile if you're learning new material. It includes comprehension checkpoints that help ensure you're actually absorbing what you read, not just moving your eyes.

For light reading like news or emails, switch to the News profile for maximum speed. The Focus profile is designed for pushing your limits during training sessions.

Ambient sounds can help maintain concentration during longer reading sessions. Many readers find that white noise or rain sounds help block distractions and improve focus.`;

/**
 * Deep freeze an object (recursively freeze all nested objects)
 * @param {any} obj - Object to freeze
 * @returns {any} The frozen object
 */
function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    // Don't try to freeze Sets/Maps, just return them
    if (obj instanceof Set || obj instanceof Map) {
        return obj;
    }
    
    Object.keys(obj).forEach(key => {
        const value = obj[key];
        if (value && typeof value === 'object') {
            deepFreeze(value);
        }
    });
    
    return Object.freeze(obj);
}

// Deep freeze all exports to prevent accidental mutation
deepFreeze(CONFIG);
deepFreeze(DEFAULTS);
deepFreeze(PROFILES);
Object.freeze(DEFAULT_SHORTCUTS);
Object.freeze(SHORTCUT_ACTIONS);
// Note: Sets/Maps cannot be truly frozen, but we don't export methods to modify them
Object.freeze(DISTRACTOR_WORDS);
