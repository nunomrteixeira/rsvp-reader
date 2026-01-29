/**
 * RSVP Reader - DOM Cache Module
 * Centralized DOM element caching for performance and maintainability.
 * No dependencies on other app modules.
 * 
 * Features:
 * - Lazy element caching with ID mapping
 * - Scoped queries within cached elements
 * - Element group retrieval (all toggles, all buttons, etc.)
 * - Debug statistics and validation
 * 
 * Usage:
 *   import { DOM } from './dom-cache.js';
 *   DOM.init();
 *   DOM.get('btnPlay').addEventListener('click', ...);
 */

/**
 * DOM element cache
 * @type {Map<string, HTMLElement>}
 */
const cache = new Map();

/**
 * Initialization state
 * @type {boolean}
 */
let initialized = false;

/**
 * Element ID mappings
 * Maps friendly names to DOM IDs for cleaner code
 */
const ID_MAP = {
    // App containers
    app: 'app',
    mainContent: 'main-content',
    
    // Sections
    inputSection: 'input-section',
    readerSection: 'reader-section',
    
    // Input tabs
    tabPaste: 'tab-paste',
    tabUrl: 'tab-url',
    tabFile: 'tab-file',
    contentPaste: 'content-paste',
    contentUrl: 'content-url',
    contentFile: 'content-file',
    
    // Text input
    textInput: 'text-input',
    wordCount: 'word-count',
    btnLoad: 'btn-load',
    btnSample: 'btn-sample',
    
    // URL import
    urlInput: 'url-input',
    urlStatus: 'url-status',
    btnFetchUrl: 'btn-fetch-url',
    
    // File import
    fileDropZone: 'file-drop-zone',
    fileInput: 'file-input',
    fileStatus: 'file-status',
    btnBrowseFile: 'btn-browse-file',
    
    // Library panel
    libraryPanel: 'library-panel',
    libraryOverlay: 'library-overlay',
    librarySearch: 'library-search',
    libraryList: 'library-list',
    libraryEmpty: 'library-empty',
    libraryStats: 'library-stats',
    libraryCount: 'library-count',
    btnCloseLibrary: 'btn-close-library',
    btnClearLibrary: 'btn-clear-library',
    btnExportLibrary: 'btn-export-library',
    btnImportLibrary: 'btn-import-library',
    libraryImportInput: 'library-import-input',
    
    // Reader display
    wordContainer: 'word-container',
    wordDisplay: 'word-display',
    wordPrev: 'word-prev',
    wordNext: 'word-next',
    progressBar: 'progress-bar',
    progressFill: 'progress-fill',
    progressCurrent: 'progress-current',
    progressTime: 'progress-time',
    
    // Completion overlay
    completionOverlay: 'completion-overlay',
    btnRestart: 'btn-restart',
    btnNewTextComplete: 'btn-new-text-complete',
    sessionSummary: 'session-summary',
    summaryWords: 'summary-words',
    summaryTime: 'summary-time',
    summaryWpm: 'summary-wpm',
    summaryStreak: 'summary-streak',
    
    // Focus mode
    focusMode: 'focus-mode',
    focusWordDisplay: 'focus-word-display',
    focusWordPrev: 'focus-word-prev',
    focusWordNext: 'focus-word-next',
    focusProgressFill: 'focus-progress-fill',
    focusControls: 'focus-controls',
    btnFocusPlay: 'btn-focus-play',
    focusIconPlay: 'focus-icon-play',
    focusWpm: 'focus-wpm',
    btnFocusExit: 'btn-focus-exit',
    btnFocus: 'btn-focus',
    
    // Playback controls
    btnPlay: 'btn-play',
    iconPlayPause: 'icon-play-pause',
    btnPrev: 'btn-prev',
    btnNext: 'btn-next',
    btnReset: 'btn-reset',
    btnSound: 'btn-sound',
    btnNewText: 'btn-new-text',
    wpmDisplay: 'wpm-display',
    btnWpmUp: 'btn-wpm-up',
    btnWpmDown: 'btn-wpm-down',
    warmupIndicator: 'warmup-indicator',
    warmupProgress: 'warmup-progress',
    
    // Header
    btnTheme: 'btn-theme',
    btnSettings: 'btn-settings',
    btnStats: 'btn-stats',
    btnLibrary: 'btn-library',
    
    // Settings panel
    settingsPanel: 'settings-panel',
    panelOverlay: 'panel-overlay',
    btnCloseSettings: 'btn-close-settings',
    profileGrid: 'profile-grid',
    shortcutList: 'shortcut-list',
    btnResetShortcuts: 'btn-reset-shortcuts',
    
    // Settings controls
    settingFontSize: 'setting-font-size',
    settingFontFamily: 'setting-font-family',
    chunkSizeGroup: 'chunk-size-group',
    settingInterval: 'setting-interval',
    settingVolume: 'setting-volume',
    settingPause: 'setting-pause',
    settingWarmupDuration: 'setting-warmup-duration',
    intervalValue: 'interval-value',
    volumeValue: 'volume-value',
    pauseValue: 'pause-value',
    warmupDurationValue: 'warmup-duration-value',
    pauseDurationRow: 'pause-duration-row',
    warmupDurationRow: 'warmup-duration-row',
    soundSelector: 'sound-selector',
    colorPickerGroup: 'color-picker-group',
    
    // Toggles
    toggleOrp: 'toggle-orp',
    toggleBionic: 'toggle-bionic',
    togglePeripheral: 'toggle-peripheral',
    toggleFixed: 'toggle-fixed',
    togglePunctuation: 'toggle-punctuation',
    toggleWarmup: 'toggle-warmup',
    toggleComprehension: 'toggle-comprehension',
    toggleSpeedTraining: 'toggle-speed-training',
    comprehensionIntervalRow: 'comprehension-interval-row',
    
    // Speed training
    speedIncrementRow: 'speed-increment-row',
    speedMaxRow: 'speed-max-row',
    settingIncrement: 'setting-increment',
    settingMaxWpm: 'setting-max-wpm',
    incrementValue: 'increment-value',
    maxWpmValue: 'max-wpm-value',
    trainingProgress: 'training-progress',
    trainingCurrent: 'training-current',
    trainingNext: 'training-next',
    
    // Stats modal
    statsModal: 'stats-modal',
    btnCloseStats: 'btn-close-stats',
    btnCloseStatsFooter: 'btn-close-stats-footer',
    btnResetStats: 'btn-reset-stats',
    statsTotalWords: 'stats-total-words',
    statsTotalTime: 'stats-total-time',
    statsStreak: 'stats-streak',
    statsSessions: 'stats-sessions',
    streakCalendar: 'streak-calendar',
    wpmChart: 'wpm-chart',
    wpmChartCanvas: 'wpm-chart-canvas',
    wpmChartAvg: 'wpm-chart-avg',
    wpmChartBest: 'wpm-chart-best',
    
    // Comprehension modal
    comprehensionModal: 'comprehension-modal',
    comprehensionQuestion: 'comprehension-question',
    comprehensionOptions: 'comprehension-options',
    btnSkipComprehension: 'btn-skip-comprehension',
    btnSkipComprehensionText: 'btn-skip-comprehension-text',
    
    // Shortcuts modal
    shortcutsModal: 'shortcuts-modal',
    shortcutsHelpGrid: 'shortcuts-help-grid',
    btnCloseShortcuts: 'btn-close-shortcuts',
    
    // Settings import/export
    btnExportSettings: 'btn-export-settings',
    btnImportSettings: 'btn-import-settings',
    settingsImportInput: 'settings-import-input',
    
    // Toast container
    toastContainer: 'toast-container'
};

/**
 * Critical elements that must exist for the app to function
 * @type {string[]}
 */
const REQUIRED_ELEMENTS = [
    'wordDisplay',
    'textInput',
    'btnPlay',
    'btnLoad',
    'progressFill',
    'wpmDisplay'
];

/**
 * Element group prefixes for batch retrieval
 * @type {Object<string, string>}
 */
const ELEMENT_GROUPS = {
    btn: 'btn',
    toggle: 'toggle',
    setting: 'setting',
    stats: 'stats',
    focus: 'focus',
    library: 'library',
    summary: 'summary',
    training: 'training'
};

/**
 * Initialize DOM cache
 * Caches all elements defined in ID_MAP
 * @param {Object} [options] - Initialization options
 * @param {boolean} [options.strict=false] - Throw error if required elements missing
 * @returns {{ cached: number, missing: string[] }} Cache statistics
 */
function init(options = {}) {
    const { strict = false } = options;
    
    cache.clear();
    initialized = false;
    
    const missing = [];
    let cached = 0;
    
    for (const [key, id] of Object.entries(ID_MAP)) {
        const element = document.getElementById(id);
        if (element) {
            cache.set(key, element);
            cached++;
        } else {
            missing.push(key);
        }
    }
    
    // Check for critical missing elements
    const missingRequired = REQUIRED_ELEMENTS.filter(key => !cache.has(key));
    
    if (missingRequired.length > 0) {
        const msg = `DOM Cache: Missing required elements: ${missingRequired.join(', ')}`;
        if (strict) {
            throw new Error(msg);
        } else {
            console.error(msg);
        }
    }
    
    // Log non-critical missing elements as warnings
    const missingOptional = missing.filter(key => !REQUIRED_ELEMENTS.includes(key));
    if (missingOptional.length > 0) {
        console.warn(`DOM Cache: ${missingOptional.length} optional elements not found:`, missingOptional);
    }
    
    initialized = true;
    
    return { cached, missing };
}

/**
 * Check if cache has been initialized
 * @returns {boolean}
 */
function isInitialized() {
    return initialized;
}

/**
 * Ensure cache is initialized before operations
 * @private
 * @param {string} methodName - Name of calling method for error message
 */
function ensureInitialized(methodName) {
    if (!initialized) {
        console.warn(`DOM.${methodName}() called before init(). Call DOM.init() first.`);
    }
}

/**
 * Get a cached element
 * @param {string} key - Element key from ID_MAP
 * @returns {HTMLElement|null}
 */
function get(key) {
    ensureInitialized('get');
    
    const element = cache.get(key);
    if (!element && initialized && key in ID_MAP) {
        // Element was in ID_MAP but not found - likely DOM changed
        console.warn(`DOM.get('${key}'): Element was not cached (ID: ${ID_MAP[key]})`);
    }
    return element || null;
}

/**
 * Get a cached element, throwing if not found
 * Useful when element is required for functionality
 * @param {string} key - Element key from ID_MAP
 * @returns {HTMLElement}
 * @throws {Error} If element not found
 */
function getRequired(key) {
    const element = get(key);
    if (!element) {
        throw new Error(`DOM.getRequired('${key}'): Required element not found`);
    }
    return element;
}

/**
 * Get multiple cached elements
 * @param {...string} keys - Element keys
 * @returns {Object<string, HTMLElement|null>} Object with key -> element mapping
 */
function getMany(...keys) {
    ensureInitialized('getMany');
    
    const result = {};
    for (const key of keys) {
        result[key] = cache.get(key) || null;
    }
    return result;
}

/**
 * Get all elements matching a group prefix
 * @param {string} groupName - Group name (e.g., 'btn', 'toggle', 'setting')
 * @returns {Object<string, HTMLElement>} Object with key -> element mapping
 */
function getGroup(groupName) {
    ensureInitialized('getGroup');
    
    const prefix = ELEMENT_GROUPS[groupName] || groupName;
    const result = {};
    
    for (const [key, element] of cache) {
        if (key.startsWith(prefix)) {
            result[key] = element;
        }
    }
    
    return result;
}

/**
 * Get all cached elements as an object
 * Note: Creates a new object each call - cache result if used frequently
 * @returns {Object<string, HTMLElement>}
 */
function getAll() {
    ensureInitialized('getAll');
    return Object.fromEntries(cache);
}

/**
 * Query within a cached element
 * @param {string} key - Parent element key
 * @param {string} selector - CSS selector
 * @returns {HTMLElement|null}
 */
function query(key, selector) {
    ensureInitialized('query');
    
    const parent = cache.get(key);
    if (!parent) {
        return null;
    }
    return parent.querySelector(selector);
}

/**
 * Query all within a cached element
 * @param {string} key - Parent element key
 * @param {string} selector - CSS selector
 * @returns {HTMLElement[]} Array of matching elements (empty if parent not found)
 */
function queryAll(key, selector) {
    ensureInitialized('queryAll');
    
    const parent = cache.get(key);
    if (!parent) {
        return [];
    }
    // Convert NodeList to Array for consistent return type
    return Array.from(parent.querySelectorAll(selector));
}

/**
 * Check if an element is cached
 * @param {string} key - Element key
 * @returns {boolean}
 */
function has(key) {
    return cache.has(key);
}

/**
 * Add a custom element to cache
 * @param {string} key - Element key
 * @param {HTMLElement} element - Element to cache
 * @returns {boolean} True if successfully set
 */
function set(key, element) {
    if (!(element instanceof HTMLElement)) {
        console.error(`DOM.set('${key}'): Value must be an HTMLElement, got ${typeof element}`);
        return false;
    }
    
    cache.set(key, element);
    return true;
}

/**
 * Refresh a single element in the cache
 * Useful if DOM was modified after initial caching
 * @param {string} key - Element key
 * @returns {boolean} True if element was found and re-cached
 */
function refresh(key) {
    const id = ID_MAP[key];
    if (!id) {
        console.warn(`DOM.refresh('${key}'): Unknown key`);
        return false;
    }
    
    const element = document.getElementById(id);
    if (element) {
        cache.set(key, element);
        return true;
    } else {
        cache.delete(key);
        return false;
    }
}

/**
 * Clear the cache
 */
function clear() {
    cache.clear();
    initialized = false;
}

/**
 * Get cache statistics for debugging
 * @returns {{ initialized: boolean, size: number, keys: string[] }}
 */
function getStats() {
    return {
        initialized,
        size: cache.size,
        totalDefined: Object.keys(ID_MAP).length,
        keys: Array.from(cache.keys())
    };
}

/**
 * Check if specific element exists in DOM (not cache)
 * @param {string} key - Element key
 * @returns {boolean}
 */
function existsInDOM(key) {
    const id = ID_MAP[key];
    return id ? document.getElementById(id) !== null : false;
}

export const DOM = {
    init,
    isInitialized,
    get,
    getRequired,
    getMany,
    getGroup,
    getAll,
    query,
    queryAll,
    has,
    set,
    refresh,
    clear,
    getStats,
    existsInDOM,
    ID_MAP,
    REQUIRED_ELEMENTS,
    ELEMENT_GROUPS
};

