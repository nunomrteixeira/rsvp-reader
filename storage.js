/**
 * RSVP Reader - Storage Module
 * Safe localStorage abstraction with validation, backup, and corruption recovery.
 * No dependencies on other app modules.
 * 
 * Features:
 * - Automatic backup before overwrites
 * - Corruption recovery from backups
 * - Memory fallback when localStorage unavailable
 * - Cross-browser quota error handling
 * 
 * Note: Requires browser environment (window.localStorage)
 */

/**
 * @typedef {Object} StorageOptions
 * @property {function(any): boolean} [validator] - Validation function for data
 * @property {any} [defaultValue] - Default value if key doesn't exist or is invalid
 * @property {boolean} [createBackup] - Whether to create backup before overwriting
 */

/**
 * Storage manager for persistent data
 * Provides safe read/write with automatic backup and recovery.
 * 
 * @example
 * // Basic usage
 * Storage.set('myKey', { value: 42 });
 * const data = Storage.get('myKey');
 * 
 * // With validation
 * const settings = Storage.get('settings', {
 *     validator: (data) => typeof data.wpm === 'number',
 *     defaultValue: { wpm: 300 }
 * });
 */
class StorageManager {
    constructor() {
        /** @type {Storage|null} */
        this._storage = null;
        
        /** @type {boolean} */
        this._available = false;
        
        /** @type {Map<string, any>} */
        this._memoryFallback = new Map();
        
        /** @type {string} */
        this._backupSuffix = '-backup';
        
        this._init();
    }

    /**
     * Initialize storage and check availability
     * @private
     */
    _init() {
        // SSR/Node.js safety check
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            console.warn('Storage: localStorage not available (non-browser environment), using memory fallback');
            this._available = false;
            return;
        }

        try {
            const testKey = '__storage_test__';
            window.localStorage.setItem(testKey, 'test');
            window.localStorage.removeItem(testKey);
            this._storage = window.localStorage;
            this._available = true;
        } catch (e) {
            console.warn('Storage: localStorage not available, using memory fallback:', e.message);
            this._available = false;
        }
    }

    /**
     * Check if localStorage is available
     * @returns {boolean}
     */
    isAvailable() {
        return this._available;
    }

    /**
     * Get data from storage
     * @param {string} key - Storage key
     * @param {StorageOptions} [options] - Options for retrieval
     * @returns {any} The stored value or default
     */
    get(key, options = {}) {
        const { validator, defaultValue = null } = options;

        /**
         * Safely run validator, returning false if it throws
         * @param {any} data
         * @returns {boolean}
         */
        const isValid = (data) => {
            if (!validator) return true;
            try {
                return validator(data);
            } catch (e) {
                console.warn(`Storage: Validator threw for "${key}":`, e.message);
                return false;
            }
        };

        // Try primary storage first
        let data = this._read(key);

        // If primary fails or is invalid, try backup
        if (data === null || !isValid(data)) {
            const backupData = this._read(key + this._backupSuffix);
            
            if (backupData !== null && isValid(backupData)) {
                console.info(`Storage: Restored "${key}" from backup`);
                // Restore primary from backup
                this._write(key, backupData);
                return backupData;
            }
            
            // Both primary and backup failed
            if (data === null) {
                return defaultValue;
            }
            
            // Data exists but is invalid
            console.warn(`Storage: Invalid data for "${key}", using default`);
            return defaultValue;
        }

        return data;
    }

    /**
     * Set data in storage
     * @param {string} key - Storage key
     * @param {any} value - Value to store (must be JSON-serializable)
     * @param {StorageOptions} [options] - Options for storage
     * @returns {boolean} True if successful
     */
    set(key, value, options = {}) {
        const { createBackup = true, validator } = options;

        // Validate before saving if validator provided
        if (validator) {
            try {
                if (!validator(value)) {
                    console.error(`Storage: Validation failed for "${key}"`);
                    return false;
                }
            } catch (e) {
                console.error(`Storage: Validator threw for "${key}":`, e.message);
                return false;
            }
        }

        // Create backup of existing data
        if (createBackup) {
            const existing = this._read(key);
            if (existing !== null) {
                this._write(key + this._backupSuffix, existing);
            }
        }

        return this._write(key, value);
    }

    /**
     * Remove data from storage
     * @param {string} key - Storage key
     * @param {boolean} [includeBackup=false] - Also remove backup
     * @returns {boolean} True if successful
     */
    remove(key, includeBackup = false) {
        const success = this._delete(key);
        
        if (includeBackup) {
            this._delete(key + this._backupSuffix);
        }
        
        return success;
    }

    /**
     * Check if a key exists in storage
     * @param {string} key - Storage key
     * @returns {boolean}
     */
    has(key) {
        if (!this._available) {
            return this._memoryFallback.has(key);
        }
        return this._storage.getItem(key) !== null;
    }

    /**
     * Get all keys in storage matching a prefix
     * @param {string} [prefix=''] - Key prefix to filter
     * @returns {string[]}
     */
    keys(prefix = '') {
        if (!this._available) {
            return Array.from(this._memoryFallback.keys())
                .filter(k => k.startsWith(prefix));
        }

        const keys = [];
        for (let i = 0; i < this._storage.length; i++) {
            const key = this._storage.key(i);
            if (key && key.startsWith(prefix)) {
                keys.push(key);
            }
        }
        return keys;
    }

    /**
     * Clear all data with a specific prefix
     * @param {string} prefix - Key prefix
     * @returns {number} Number of keys removed
     */
    clearPrefix(prefix) {
        const keysToRemove = this.keys(prefix);
        keysToRemove.forEach(key => this._delete(key));
        return keysToRemove.length;
    }

    /**
     * Create a manual backup of a key
     * @param {string} key - Storage key
     * @returns {boolean} True if successful
     */
    backup(key) {
        const data = this._read(key);
        if (data === null) {
            return false;
        }
        return this._write(key + this._backupSuffix, data);
    }

    /**
     * Restore a key from its backup
     * @param {string} key - Storage key
     * @returns {boolean} True if successful
     */
    restore(key) {
        const backupData = this._read(key + this._backupSuffix);
        if (backupData === null) {
            return false;
        }
        return this._write(key, backupData);
    }

    /**
     * Get storage usage info
     * @returns {{ used: number, available: boolean, keys: number }}
     */
    getUsageInfo() {
        if (!this._available) {
            // Calculate approximate size of memory fallback
            let used = 0;
            for (const [key, value] of this._memoryFallback) {
                try {
                    used += key.length + JSON.stringify(value).length;
                } catch (e) {
                    // Circular reference or other issue - estimate
                    used += key.length + 100;
                }
            }
            return {
                used: used * 2, // UTF-16 = 2 bytes per char
                available: false,
                keys: this._memoryFallback.size
            };
        }

        let used = 0;
        for (let i = 0; i < this._storage.length; i++) {
            const key = this._storage.key(i);
            if (key) {
                used += key.length + (this._storage.getItem(key) || '').length;
            }
        }

        return {
            used: used * 2, // UTF-16 = 2 bytes per char
            available: true,
            keys: this._storage.length
        };
    }

    /**
     * Read raw data from storage
     * @private
     * @param {string} key
     * @returns {any}
     */
    _read(key) {
        try {
            if (!this._available) {
                return this._memoryFallback.get(key) ?? null;
            }

            const raw = this._storage.getItem(key);
            if (raw === null) {
                return null;
            }

            return JSON.parse(raw);
        } catch (e) {
            console.error(`Storage: Failed to read "${key}":`, e.message);
            return null;
        }
    }

    /**
     * Write raw data to storage
     * @private
     * @param {string} key
     * @param {any} value
     * @returns {boolean}
     */
    _write(key, value) {
        let serialized;
        
        // Serialize first to catch circular reference errors early
        try {
            serialized = JSON.stringify(value);
        } catch (e) {
            if (e.message && e.message.includes('circular')) {
                console.error(`Storage: Cannot store circular reference for "${key}"`);
            } else {
                console.error(`Storage: Failed to serialize "${key}":`, e.message);
            }
            return false;
        }

        // Memory fallback - store a deep copy to match localStorage snapshot behavior
        if (!this._available) {
            try {
                // Parse the serialized value to create a deep copy
                this._memoryFallback.set(key, JSON.parse(serialized));
            } catch (e) {
                // Shouldn't happen since we just serialized, but fallback to reference
                this._memoryFallback.set(key, value);
            }
            return true;
        }

        try {
            this._storage.setItem(key, serialized);
            return true;
        } catch (e) {
            // QuotaExceededError detection (varies by browser)
            // - Chrome/Firefox: e.name === 'QuotaExceededError'
            // - Safari: e.code === 22
            // - IE: e.number === -2147024882
            const isQuotaError = (
                e.name === 'QuotaExceededError' ||
                e.code === 22 ||
                e.code === 1014 ||  // Firefox
                e.number === -2147024882
            );
            
            if (isQuotaError) {
                console.error(`Storage: Quota exceeded for "${key}"`);
                // Try to make room by clearing backups
                this._clearOldBackups();
                // Retry once with already-serialized value
                try {
                    this._storage.setItem(key, serialized);
                    return true;
                } catch (e2) {
                    console.error(`Storage: Still failed after cleanup:`, e2.message);
                }
            } else {
                console.error(`Storage: Failed to write "${key}":`, e.message);
            }
            
            // Fallback to memory with deep copy
            try {
                this._memoryFallback.set(key, JSON.parse(serialized));
            } catch (parseErr) {
                this._memoryFallback.set(key, value);
            }
            return false;
        }
    }

    /**
     * Delete a key from storage
     * @private
     * @param {string} key
     * @returns {boolean}
     */
    _delete(key) {
        try {
            if (!this._available) {
                return this._memoryFallback.delete(key);
            }

            this._storage.removeItem(key);
            return true;
        } catch (e) {
            console.error(`Storage: Failed to delete "${key}":`, e.message);
            return false;
        }
    }

    /**
     * Clear old backups to free space
     * Only clears backups that belong to this app (rsvp-* prefix)
     * @private
     */
    _clearOldBackups() {
        if (!this._available) return;

        // Only clear backups with our app's prefix to avoid affecting other apps
        const appPrefix = 'rsvp-';
        const backupKeys = this.keys(appPrefix).filter(k => k.endsWith(this._backupSuffix));
        
        backupKeys.forEach(key => {
            try {
                this._storage.removeItem(key);
            } catch (e) {
                // Ignore individual deletion errors
            }
        });
        
        if (backupKeys.length > 0) {
            console.info(`Storage: Cleared ${backupKeys.length} backups to free space`);
        }
    }

    /**
     * Export all app data as a JSON object
     * Useful for user data portability and debugging
     * @param {string} [prefix='rsvp-'] - Key prefix to export
     * @returns {Object} Object containing all stored data
     */
    exportAll(prefix = 'rsvp-') {
        const exported = {};
        const keys = this.keys(prefix);
        
        keys.forEach(key => {
            // Skip backup keys in export
            if (!key.endsWith(this._backupSuffix)) {
                const data = this._read(key);
                if (data !== null) {
                    exported[key] = data;
                }
            }
        });
        
        return exported;
    }

    /**
     * Import data from an exported object
     * @param {Object} data - Object containing key-value pairs to import
     * @param {boolean} [overwrite=false] - Whether to overwrite existing keys
     * @returns {{ imported: number, skipped: number, errors: number }}
     */
    importAll(data, overwrite = false) {
        const result = { imported: 0, skipped: 0, errors: 0 };
        
        if (!data || typeof data !== 'object') {
            return result;
        }
        
        for (const [key, value] of Object.entries(data)) {
            // Skip backup keys
            if (key.endsWith(this._backupSuffix)) {
                result.skipped++;
                continue;
            }
            
            // Skip if exists and not overwriting
            if (!overwrite && this.has(key)) {
                result.skipped++;
                continue;
            }
            
            // Try to write
            if (this._write(key, value)) {
                result.imported++;
            } else {
                result.errors++;
            }
        }
        
        return result;
    }

    /**
     * Clear all app data (with confirmation)
     * @param {string} [prefix='rsvp-'] - Key prefix to clear
     * @param {boolean} [includeBackups=true] - Also clear backup keys
     * @returns {number} Number of keys removed
     */
    clearAll(prefix = 'rsvp-', includeBackups = true) {
        const keys = this.keys(prefix);
        let removed = 0;
        
        keys.forEach(key => {
            // If not including backups, skip backup keys
            if (!includeBackups && key.endsWith(this._backupSuffix)) {
                return;
            }
            
            if (this._delete(key)) {
                removed++;
            }
        });
        
        console.info(`Storage: Cleared ${removed} keys with prefix "${prefix}"`);
        return removed;
    }
}

// Export singleton instance
export const Storage = new StorageManager();

// Also export class for testing purposes
export { StorageManager };
