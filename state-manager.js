/**
 * RSVP Reader - State Manager Module
 * Reactive state management with subscriptions and automatic persistence.
 * 
 * Dependencies: Storage, CONFIG, DEFAULTS from config.js
 * 
 * Features:
 * - Reactive subscriptions with wildcard support ('*')
 * - Automatic localStorage persistence with debouncing
 * - Value validation and sanitization
 * - Batch updates with atomic notifications
 * - Computed/derived values with automatic dependency tracking
 * 
 * Usage:
 *   State.init();
 *   State.set('wpm', 350);
 *   const unsubscribe = State.subscribe('wpm', (newVal, oldVal) => {...});
 */

import { Storage } from './storage.js';
import { DEFAULTS, CONFIG } from './config.js';

/**
 * @typedef {function(any, any): void} StateSubscriber
 * Callback receives (newValue, oldValue)
 */

/**
 * @typedef {Object} StateOptions
 * @property {string} [storageKey] - Key for localStorage persistence
 * @property {boolean} [persist=true] - Whether to persist changes
 * @property {function(any): boolean} [validator] - Validation function
 */

/**
 * Reactive State Manager
 * Provides centralized state with subscriptions and optional persistence.
 * 
 * @example
 * // Initialize with defaults
 * State.init();
 * 
 * // Get a value
 * const wpm = State.get('wpm');
 * 
 * // Set a value (auto-persists and notifies subscribers)
 * State.set('wpm', 350);
 * 
 * // Subscribe to changes
 * const unsubscribe = State.subscribe('wpm', (newVal, oldVal) => {
 *     console.log(`WPM changed from ${oldVal} to ${newVal}`);
 * });
 */
class StateManagerClass {
    constructor() {
        /** @type {Map<string, any>} */
        this._state = new Map();
        
        /** @type {Map<string, Set<StateSubscriber>>} */
        this._subscribers = new Map();
        
        /** @type {string} */
        this._storageKey = CONFIG.STORAGE_KEYS.SETTINGS;
        
        /** @type {boolean} */
        this._initialized = false;
        
        /** @type {boolean} */
        this._batchMode = false;
        
        /** @type {Set<string>} */
        this._batchedKeys = new Set();
        
        /** @type {Map<string, any>} Old values for batch mode */
        this._batchedOldValues = new Map();

        /** @type {number|null} */
        this._persistDebounceTimer = null;

        /** @type {number} */
        this._persistDebounceMs = 500;
        
        /** @type {Map<string, function(any): any>} Value validators/sanitizers */
        this._validators = this._createValidators();
    }
    
    /**
     * Create validators for known settings
     * Each validator receives a value and returns sanitized value or throws
     * @private
     * @returns {Map<string, function(any): any>}
     */
    _createValidators() {
        const validators = new Map();
        
        // Number in range validator factory
        const numRange = (min, max, def) => (v) => {
            const n = typeof v === 'string' ? parseFloat(v) : v;
            if (typeof n !== 'number' || isNaN(n)) return def;
            return Math.max(min, Math.min(max, Math.round(n)));
        };
        
        // Boolean validator
        const bool = (def) => (v) => {
            if (typeof v === 'boolean') return v;
            if (v === 'true') return true;
            if (v === 'false') return false;
            return def;
        };
        
        // Enum validator factory
        const oneOf = (options, def) => (v) => {
            return options.includes(v) ? v : def;
        };
        
        // WPM
        validators.set('wpm', numRange(CONFIG.WPM.MIN, CONFIG.WPM.MAX, CONFIG.WPM.DEFAULT));
        
        // Font size
        validators.set('fontSize', numRange(CONFIG.FONT_SIZE.MIN, CONFIG.FONT_SIZE.MAX, CONFIG.FONT_SIZE.DEFAULT));
        
        // Chunk size
        validators.set('chunkSize', numRange(CONFIG.CHUNK.MIN, CONFIG.CHUNK.MAX, CONFIG.CHUNK.DEFAULT));
        
        // Comprehension interval
        validators.set('comprehensionInterval', numRange(
            CONFIG.COMPREHENSION.MIN_INTERVAL, 
            CONFIG.COMPREHENSION.MAX_INTERVAL, 
            CONFIG.COMPREHENSION.DEFAULT_INTERVAL
        ));
        
        // Pause duration
        validators.set('pauseDuration', numRange(
            CONFIG.PAUSE_DURATION.MIN,
            CONFIG.PAUSE_DURATION.MAX,
            CONFIG.PAUSE_DURATION.DEFAULT
        ));
        
        // Sound volume (0-100)
        validators.set('soundVolume', numRange(0, 100, 30));
        
        // Speed training - use CONFIG values for consistency
        validators.set('speedTrainingIncrement', numRange(
            CONFIG.SPEED_TRAINING.MIN_INCREMENT,
            CONFIG.SPEED_TRAINING.MAX_INCREMENT,
            CONFIG.SPEED_TRAINING.DEFAULT_INCREMENT
        ));
        validators.set('speedTrainingMaxWpm', numRange(
            CONFIG.SPEED_TRAINING.MIN_MAX_WPM,
            CONFIG.SPEED_TRAINING.MAX_MAX_WPM,
            CONFIG.SPEED_TRAINING.DEFAULT_MAX_WPM
        ));
        validators.set('speedTrainingCurrentWpm', numRange(
            CONFIG.WPM.MIN,
            CONFIG.WPM.MAX,
            CONFIG.WPM.DEFAULT
        ));
        
        // Warmup duration in seconds - use CONFIG values for consistency
        validators.set('warmupDuration', numRange(
            CONFIG.WARMUP.MIN_DURATION_S,
            CONFIG.WARMUP.MAX_DURATION_S,
            CONFIG.WARMUP.DEFAULT_DURATION_S
        ));
        
        // Booleans
        const boolKeys = [
            'orpEnabled', 'bionicMode', 'peripheralPreview', 'fixedTiming',
            'punctuationPauses', 'warmupEnabled', 'autoRestart', 
            'comprehensionEnabled', 'speedTrainingEnabled'
        ];
        boolKeys.forEach(key => validators.set(key, bool(DEFAULTS[key])));
        
        // Enums
        validators.set('theme', oneOf(['dark', 'light'], 'dark'));
        validators.set('fontFamily', oneOf(['serif', 'sans', 'mono', 'dyslexic'], 'serif'));
        validators.set('activeSound', oneOf(CONFIG.SOUNDS, 'none'));
        validators.set('accentColor', oneOf(['orange', 'blue', 'green', 'purple', 'red'], 'orange'));
        
        return validators;
    }

    /**
     * Initialize state from storage or defaults
     * @param {Object} [overrides] - Values to override defaults
     * @returns {StateManagerClass} Returns this for chaining
     */
    init(overrides = {}) {
        if (this._initialized) {
            console.warn('State: Already initialized');
            return this;
        }

        // Load from storage
        const stored = Storage.get(this._storageKey, {
            validator: this._validateStoredData.bind(this),
            defaultValue: {}
        });

        // Merge: defaults < stored < overrides
        const merged = { ...DEFAULTS, ...stored, ...overrides };

        // Populate state
        for (const [key, value] of Object.entries(merged)) {
            this._state.set(key, value);
        }

        this._initialized = true;
        return this;
    }

    /**
     * Get a state value
     * @param {string} key - State key
     * @param {any} [fallback] - Fallback if key doesn't exist
     * @returns {any}
     */
    get(key, fallback) {
        if (!this._initialized) {
            console.warn('State: Not initialized, returning fallback');
            return fallback ?? DEFAULTS[key];
        }

        if (!this._state.has(key)) {
            return fallback ?? DEFAULTS[key];
        }

        return this._state.get(key);
    }

    /**
     * Get multiple state values
     * @param {string[]} keys - Array of keys to retrieve
     * @returns {Object} Object with requested key-value pairs
     */
    getMultiple(keys) {
        const result = {};
        for (const key of keys) {
            result[key] = this.get(key);
        }
        return result;
    }

    /**
     * Get all state as an object
     * @returns {Object}
     */
    getAll() {
        return Object.fromEntries(this._state);
    }

    /**
     * Set a state value
     * @param {string} key - State key
     * @param {any} value - New value (will be validated/sanitized for known keys)
     * @param {boolean} [persist=true] - Whether to persist to storage
     * @returns {boolean} True if value changed
     */
    set(key, value, persist = true) {
        // Validate/sanitize value if we have a validator for this key
        let sanitizedValue = value;
        if (this._validators.has(key)) {
            try {
                sanitizedValue = this._validators.get(key)(value);
            } catch (e) {
                console.warn(`State: Invalid value for "${key}":`, value);
                return false;
            }
        }
        
        const oldValue = this._state.get(key);
        
        // Skip if value hasn't changed (shallow comparison)
        if (oldValue === sanitizedValue) {
            return false;
        }

        // For objects/arrays, do deep comparison (but avoid for primitives)
        if (typeof sanitizedValue === 'object' && sanitizedValue !== null &&
            typeof oldValue === 'object' && oldValue !== null) {
            try {
                if (JSON.stringify(oldValue) === JSON.stringify(sanitizedValue)) {
                    return false;
                }
            } catch (e) {
                // Circular reference or other issue - proceed with update
            }
        }

        this._state.set(key, sanitizedValue);

        // Notify subscribers
        if (this._batchMode) {
            // Only store oldValue if this is the first change to this key in this batch
            if (!this._batchedKeys.has(key)) {
                this._batchedOldValues.set(key, oldValue);
            }
            this._batchedKeys.add(key);
        } else {
            this._notify(key, sanitizedValue, oldValue);
        }

        // Schedule persistence
        if (persist) {
            this._schedulePersist();
        }

        return true;
    }

    /**
     * Set multiple state values at once
     * @param {Object} values - Key-value pairs to set
     * @param {boolean} [persist=true] - Whether to persist
     * @returns {string[]} Array of keys that changed
     */
    setMultiple(values, persist = true) {
        const changedKeys = [];
        
        this._batchMode = true;
        
        try {
            for (const [key, value] of Object.entries(values)) {
                if (this.set(key, value, false)) {
                    changedKeys.push(key);
                }
            }
        } finally {
            this._batchMode = false;
        }
        
        // Notify all batched changes with correct old values
        for (const key of this._batchedKeys) {
            const newValue = this._state.get(key);
            const oldValue = this._batchedOldValues.get(key);
            this._notify(key, newValue, oldValue);
        }
        this._batchedKeys.clear();
        this._batchedOldValues.clear();

        if (persist && changedKeys.length > 0) {
            this._schedulePersist();
        }

        return changedKeys;
    }

    /**
     * Subscribe to state changes
     * @param {string} key - State key to watch (use '*' for all changes)
     * @param {StateSubscriber} callback - Called with (newValue, oldValue) or (key, newValue, oldValue) for '*'
     * @returns {function(): void} Unsubscribe function
     */
    subscribe(key, callback) {
        if (typeof key !== 'string' || key.length === 0) {
            console.error('State.subscribe: key must be a non-empty string');
            return () => {};
        }
        
        if (typeof callback !== 'function') {
            console.error('State.subscribe: callback must be a function');
            return () => {};
        }

        if (!this._subscribers.has(key)) {
            this._subscribers.set(key, new Set());
        }

        this._subscribers.get(key).add(callback);

        // Return unsubscribe function
        return () => {
            if (this._subscribers.has(key)) {
                this._subscribers.get(key).delete(callback);
                // Clean up empty Sets
                if (this._subscribers.get(key).size === 0) {
                    this._subscribers.delete(key);
                }
            }
        };
    }

    /**
     * Subscribe to any state change
     * @param {function(string, any, any): void} callback - Called with (key, newValue, oldValue)
     * @returns {function(): void} Unsubscribe function
     */
    subscribeAll(callback) {
        return this.subscribe('*', callback);
    }

    /**
     * Reset state to defaults
     * @param {string[]} [keys] - Specific keys to reset (all if not provided)
     * @returns {string[]} Array of keys that were reset
     */
    reset(keys) {
        const keysToReset = keys || Object.keys(DEFAULTS);
        const resetKeys = [];

        this._batchMode = true;

        try {
            for (const key of keysToReset) {
                if (key in DEFAULTS) {
                    const oldValue = this._state.get(key);
                    const defaultValue = DEFAULTS[key];
                    
                    if (oldValue !== defaultValue) {
                        // Track old value before changing
                        if (!this._batchedKeys.has(key)) {
                            this._batchedOldValues.set(key, oldValue);
                        }
                        this._state.set(key, defaultValue);
                        this._batchedKeys.add(key);
                        resetKeys.push(key);
                    }
                }
            }
        } finally {
            this._batchMode = false;
        }

        // Notify all batched changes with correct old values
        for (const key of this._batchedKeys) {
            const oldValue = this._batchedOldValues.get(key);
            this._notify(key, DEFAULTS[key], oldValue);
        }
        this._batchedKeys.clear();
        this._batchedOldValues.clear();

        if (resetKeys.length > 0) {
            this._persistNow();
        }

        return resetKeys;
    }

    /**
     * Check if a key exists in state
     * @param {string} key - State key
     * @returns {boolean}
     */
    has(key) {
        return this._state.has(key);
    }

    /**
     * Delete a key from state
     * @param {string} key - State key
     * @returns {boolean} True if key existed and was deleted
     */
    delete(key) {
        if (!this._state.has(key)) {
            return false;
        }

        const oldValue = this._state.get(key);
        this._state.delete(key);
        
        this._notify(key, undefined, oldValue);
        this._schedulePersist();

        return true;
    }

    /**
     * Force immediate persist to storage
     */
    persist() {
        this._persistNow();
    }

    /**
     * Get subscriber count for a key
     * @param {string} key - State key
     * @returns {number}
     */
    subscriberCount(key) {
        return this._subscribers.has(key) ? this._subscribers.get(key).size : 0;
    }

    /**
     * Subscribe to a single state change (auto-unsubscribes after first call)
     * @param {string} key - State key to watch
     * @param {StateSubscriber} callback - Called with (newValue, oldValue)
     * @returns {function(): void} Unsubscribe function (can cancel before first call)
     */
    subscribeOnce(key, callback) {
        const unsubscribe = this.subscribe(key, (newValue, oldValue) => {
            unsubscribe();
            callback(newValue, oldValue);
        });
        return unsubscribe;
    }

    /**
     * Get debug statistics about state manager
     * @returns {{ initialized: boolean, stateSize: number, subscriberCount: number, keys: string[] }}
     */
    getStats() {
        let totalSubscribers = 0;
        for (const [, subs] of this._subscribers) {
            totalSubscribers += subs.size;
        }
        
        return {
            initialized: this._initialized,
            stateSize: this._state.size,
            subscriberCount: totalSubscribers,
            subscribedKeys: Array.from(this._subscribers.keys()),
            keys: Array.from(this._state.keys()),
            hasPendingPersist: this._persistDebounceTimer !== null
        };
    }

    /**
     * Clean up all resources (timers, subscribers)
     * Call this when the state manager is no longer needed
     */
    destroy() {
        // Clear debounce timer
        if (this._persistDebounceTimer) {
            clearTimeout(this._persistDebounceTimer);
            this._persistDebounceTimer = null;
        }

        // Clear all subscribers
        this._subscribers.clear();
        
        // Clear batch state
        this._batchedKeys.clear();
        this._batchedOldValues.clear();
        this._batchMode = false;

        // Note: We don't clear _state or _initialized
        // so that get() still works for any remaining references
    }

    /**
     * Validate and sanitize stored data structure
     * @private
     * @param {any} data
     * @returns {boolean}
     */
    _validateStoredData(data) {
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            return false;
        }
        
        // Sanitize all values using validators
        // This ensures corrupt stored data gets fixed on load
        for (const [key, value] of Object.entries(data)) {
            if (this._validators.has(key)) {
                try {
                    data[key] = this._validators.get(key)(value);
                } catch (e) {
                    // Use default for invalid values
                    if (key in DEFAULTS) {
                        data[key] = DEFAULTS[key];
                    } else {
                        delete data[key];
                    }
                }
            }
        }
        
        return true;
    }

    /**
     * Notify subscribers of a change
     * @private
     * @param {string} key
     * @param {any} newValue
     * @param {any} oldValue
     */
    _notify(key, newValue, oldValue) {
        // Notify key-specific subscribers
        // Create snapshot to prevent issues if callbacks modify subscriptions
        if (this._subscribers.has(key)) {
            const callbacks = Array.from(this._subscribers.get(key));
            for (const callback of callbacks) {
                try {
                    callback(newValue, oldValue);
                } catch (error) {
                    console.error(`State: Error in subscriber for "${key}":`, error);
                }
            }
        }

        // Notify wildcard subscribers
        if (this._subscribers.has('*')) {
            const callbacks = Array.from(this._subscribers.get('*'));
            for (const callback of callbacks) {
                try {
                    callback(key, newValue, oldValue);
                } catch (error) {
                    console.error(`State: Error in wildcard subscriber:`, error);
                }
            }
        }
    }

    /**
     * Schedule a debounced persist
     * @private
     */
    _schedulePersist() {
        if (this._persistDebounceTimer) {
            clearTimeout(this._persistDebounceTimer);
        }

        this._persistDebounceTimer = setTimeout(() => {
            this._persistNow();
            this._persistDebounceTimer = null;
        }, this._persistDebounceMs);
    }

    /**
     * Persist state to storage immediately
     * @private
     */
    _persistNow() {
        if (this._persistDebounceTimer) {
            clearTimeout(this._persistDebounceTimer);
            this._persistDebounceTimer = null;
        }

        const data = this.getAll();
        Storage.set(this._storageKey, data, { createBackup: true });
    }
}

// Export singleton instance
export const State = new StateManagerClass();

// Also export class for testing
export { StateManagerClass };

/**
 * Convenience function to create a computed/derived value
 * @param {string[]} dependencies - State keys this depends on
 * @param {function(...any): any} compute - Function to compute derived value
 * @returns {{ get: function(): any, subscribe: function(function): function, dispose: function(): void }}
 */
export function createComputed(dependencies, compute) {
    let cachedValue;
    let previousValue;
    let isDirty = true;
    const subscribers = new Set();
    const unsubscribers = [];

    function get() {
        if (isDirty) {
            previousValue = cachedValue;
            const values = dependencies.map(key => State.get(key));
            cachedValue = compute(...values);
            isDirty = false;
        }
        return cachedValue;
    }
    
    // Compute initial value eagerly
    get();

    // Subscribe to all dependencies
    dependencies.forEach(key => {
        const unsub = State.subscribe(key, () => {
            isDirty = true;
            const oldValue = cachedValue; // Store before recompute
            const newValue = get();
            
            // Only notify if value actually changed
            if (newValue !== oldValue) {
                // Create snapshot of subscribers to prevent modification during iteration
                const callbacks = Array.from(subscribers);
                for (const cb of callbacks) {
                    try {
                        cb(newValue, oldValue);
                    } catch (e) {
                        console.error('createComputed: Error in subscriber:', e);
                    }
                }
            }
        });
        unsubscribers.push(unsub);
    });

    function subscribe(callback) {
        if (typeof callback !== 'function') {
            console.error('createComputed.subscribe: callback must be a function');
            return () => {};
        }
        subscribers.add(callback);
        return () => subscribers.delete(callback);
    }
    
    /**
     * Clean up all subscriptions to prevent memory leaks
     * Call this when the computed value is no longer needed
     */
    function dispose() {
        unsubscribers.forEach(unsub => unsub());
        unsubscribers.length = 0;
        subscribers.clear();
        cachedValue = undefined;
        previousValue = undefined;
    }

    return { get, subscribe, dispose };
}
