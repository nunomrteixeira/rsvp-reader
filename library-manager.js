/**
 * RSVP Reader - Library Manager Module
 * Manages a persistent reading library with progress tracking.
 * Depends on: Storage, Config
 */

import { Storage } from './storage.js';
import { CONFIG } from './config.js';

/**
 * @typedef {Object} LibraryItem
 * @property {string} id - Unique identifier
 * @property {string} title - Document title
 * @property {string} text - Full text content
 * @property {number} wordCount - Total word count
 * @property {number} currentPosition - Current reading position (word index)
 * @property {number} wpm - Last used WPM for this item
 * @property {number} addedAt - Timestamp when added
 * @property {number} lastReadAt - Timestamp of last read
 * @property {boolean} completed - Whether reading is completed
 * @property {Object} metadata - Additional metadata from import
 */

/**
 * @typedef {Object} LibraryItemSummary
 * @property {string} id - Unique identifier
 * @property {string} title - Document title
 * @property {number} wordCount - Total word count
 * @property {number} currentPosition - Current reading position
 * @property {number} progress - Progress percentage (0-100)
 * @property {number} wpm - Last used WPM
 * @property {number} addedAt - Timestamp when added
 * @property {number} lastReadAt - Timestamp of last read
 * @property {boolean} completed - Whether reading is completed
 * @property {Object} metadata - Additional metadata
 */

/**
 * @typedef {Object} LibraryStats
 * @property {number} count - Number of items
 * @property {number} storageUsed - Bytes used
 * @property {string} storageUsedFormatted - Human-readable size
 */

/**
 * Library Manager Class
 * Provides CRUD operations for a persistent reading library.
 */
class LibraryManagerClass {
    constructor() {
        /** @type {LibraryItem[]} In-memory library items */
        this._items = [];
        
        /** @type {boolean} Whether the library has been initialized */
        this._initialized = false;
    }

    /**
     * Initialize the library from storage
     * Must be called before using other methods.
     * @returns {LibraryManagerClass} Returns this for chaining
     */
    init() {
        if (this._initialized) {
            return this;
        }
        
        const stored = Storage.get(CONFIG.STORAGE_KEYS.LIBRARY, {
            validator: (data) => Array.isArray(data),
            defaultValue: []
        });
        
        // Filter out any corrupted items and log warnings
        this._items = stored.filter(item => {
            if (this._validateItem(item)) {
                return true;
            }
            console.warn('LibraryManager: Skipping corrupted item:', item?.id || 'unknown');
            return false;
        });
        
        // If we filtered out items, save the cleaned data
        if (this._items.length !== stored.length) {
            console.warn(`LibraryManager: Removed ${stored.length - this._items.length} corrupted items`);
            this._save();
        }
        
        this._initialized = true;
        return this;
    }

    /**
     * Ensure library is initialized
     * @private
     */
    _ensureInitialized() {
        if (!this._initialized) {
            console.warn('LibraryManager: Not initialized, call init() first');
            this.init();
        }
    }

    /**
     * Save library to storage
     * @private
     * @returns {boolean} True if save succeeded
     */
    _save() {
        try {
            Storage.set(CONFIG.STORAGE_KEYS.LIBRARY, this._items, { createBackup: true });
            return true;
        } catch (e) {
            console.error('LibraryManager: Failed to save library:', e);
            // Could be quota exceeded - caller should handle this
            return false;
        }
    }

    /**
     * Validate a library item has required fields
     * @private
     * @param {any} item - Item to validate
     * @returns {boolean} True if item is valid
     */
    _validateItem(item) {
        return item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.text === 'string' &&
            typeof item.title === 'string' &&
            typeof item.wordCount === 'number' &&
            typeof item.currentPosition === 'number' &&
            typeof item.addedAt === 'number';
    }

    /**
     * Generate a unique ID with collision checking
     * @private
     * @returns {string}
     */
    _generateId() {
        let id;
        let attempts = 0;
        const maxAttempts = 10;
        
        do {
            id = `lib_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            attempts++;
        } while (this._items.some(item => item.id === id) && attempts < maxAttempts);
        
        if (attempts >= maxAttempts) {
            // Extremely unlikely, but fallback to UUID-like format
            id = `lib_${Date.now()}_${crypto.randomUUID?.() || Math.random().toString(36).substring(2)}`;
        }
        
        return id;
    }

    /**
     * Add a new item to the library
     * @param {string} text - Full text content
     * @param {string} [title] - Document title (auto-generated if not provided)
     * @param {Object} [metadata={}] - Additional metadata (including restored position for imports)
     * @returns {LibraryItem|null} The created item, or null if validation failed
     */
    add(text, title, metadata = {}) {
        this._ensureInitialized();
        
        // Validate text input
        if (!text || typeof text !== 'string') {
            console.error('LibraryManager: add() requires a non-empty string');
            return null;
        }
        
        const trimmedText = text.trim();
        if (trimmedText.length === 0) {
            console.error('LibraryManager: add() text cannot be empty');
            return null;
        }
        
        // Enforce max items limit - remove oldest if at capacity
        const maxItems = CONFIG.LIBRARY?.MAX_ITEMS || 100;
        if (this._items.length >= maxItems) {
            this._items.pop(); // Remove oldest (items are ordered newest-first via unshift)
        }

        const wordCount = trimmedText.split(/\s+/).filter(w => w).length;
        const titleMaxLen = CONFIG.LIBRARY?.TITLE_MAX_LENGTH || 100;
        
        // Generate title from first line if not provided
        let finalTitle = title;
        if (!finalTitle || typeof finalTitle !== 'string' || finalTitle.trim().length === 0) {
            const firstLine = trimmedText.split('\n')[0] || '';
            finalTitle = firstLine.substring(0, titleMaxLen).trim() || 'Untitled';
        }
        
        // Validate and use restored position from imports (if provided)
        let restoredPosition = 0;
        if (metadata && typeof metadata.currentPosition === 'number' && metadata.currentPosition >= 0) {
            restoredPosition = Math.min(metadata.currentPosition, Math.max(0, wordCount - 1));
        }
        
        const item = {
            id: this._generateId(),
            title: finalTitle.substring(0, titleMaxLen), // Enforce max length
            text: trimmedText,
            wordCount,
            currentPosition: restoredPosition,
            wpm: CONFIG.WPM?.DEFAULT || 300,
            addedAt: Date.now(),
            lastReadAt: metadata?.lastReadAt || Date.now(),
            completed: restoredPosition >= wordCount - 1 && wordCount > 0,
            metadata: metadata || {}
        };

        this._items.unshift(item);
        this._save();
        return item;
    }

    /**
     * Get all items (without full text for performance)
     * @returns {LibraryItemSummary[]}
     */
    getAll() {
        this._ensureInitialized();
        
        return this._items.map(item => {
            // Calculate progress: 
            // - If completed, always show 100%
            // - Otherwise, use (currentPosition + 1) / wordCount to account for 0-indexing
            let progress = 0;
            if (item.completed) {
                progress = 100;
            } else if (item.wordCount > 0) {
                progress = Math.round(((item.currentPosition + 1) / item.wordCount) * 100);
                progress = Math.max(0, Math.min(99, progress)); // Cap at 99 if not completed
            }
            
            return {
                ...item,
                text: undefined, // Don't include full text in list
                progress
            };
        });
    }

    /**
     * Get a single item by ID (includes full text)
     * @param {string} id - Item ID
     * @returns {LibraryItem|null}
     */
    get(id) {
        this._ensureInitialized();
        
        // Validate id
        if (!id || typeof id !== 'string') {
            return null;
        }
        
        return this._items.find(i => i.id === id) || null;
    }

    /**
     * Update reading position for an item
     * @param {string} id - Item ID
     * @param {number} position - Current word index
     * @param {number} [wpm] - Current WPM setting (optional)
     * @returns {boolean} True if item was found and updated
     */
    updatePosition(id, position, wpm) {
        this._ensureInitialized();
        
        // Validate id
        if (!id || typeof id !== 'string') {
            return false;
        }
        
        const item = this._items.find(i => i.id === id);
        if (!item) return false;
        
        // Validate and clamp position
        const validPosition = typeof position === 'number' && !isNaN(position)
            ? Math.max(0, Math.min(position, item.wordCount - 1))
            : item.currentPosition; // Keep current if invalid
        
        item.currentPosition = validPosition;
        
        // Validate and update WPM only if provided and valid
        if (typeof wpm === 'number' && !isNaN(wpm) && wpm > 0) {
            item.wpm = wpm;
        }
        
        item.lastReadAt = Date.now();
        
        // Mark as completed if at or past the last word
        if (item.wordCount > 0 && validPosition >= item.wordCount - 1) {
            item.completed = true;
        }
        
        this._save();
        return true;
    }

    /**
     * Update an item's title
     * @param {string} id - Item ID
     * @param {string} newTitle - New title
     * @returns {boolean} True if item was found and updated
     */
    updateTitle(id, newTitle) {
        this._ensureInitialized();
        
        // Validate inputs
        if (!id || typeof id !== 'string') {
            return false;
        }
        
        if (!newTitle || typeof newTitle !== 'string') {
            console.warn('LibraryManager: updateTitle requires a valid string title');
            return false;
        }
        
        const trimmedTitle = newTitle.trim();
        if (trimmedTitle.length === 0) {
            console.warn('LibraryManager: updateTitle title cannot be empty');
            return false;
        }
        
        const item = this._items.find(i => i.id === id);
        if (!item) return false;
        
        const titleMaxLen = CONFIG.LIBRARY?.TITLE_MAX_LENGTH || 100;
        item.title = trimmedTitle.substring(0, titleMaxLen);
        this._save();
        return true;
    }

    /**
     * Remove an item from the library
     * @param {string} id - Item ID
     * @returns {boolean} True if item was found and removed
     */
    remove(id) {
        this._ensureInitialized();
        
        // Validate id
        if (!id || typeof id !== 'string') {
            return false;
        }
        
        const idx = this._items.findIndex(i => i.id === id);
        if (idx !== -1) {
            this._items.splice(idx, 1);
            this._save();
            return true;
        }
        return false;
    }

    /**
     * Clear all items from the library
     */
    clear() {
        this._ensureInitialized();
        this._items = [];
        this._save();
    }

    /**
     * Search items by title
     * @param {string} query - Search query
     * @returns {LibraryItemSummary[]} Matching items
     */
    search(query) {
        // Return all if no query or invalid query
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return this.getAll();
        }
        
        const lower = query.toLowerCase().trim();
        return this.getAll().filter(item => {
            // Defensive: ensure title exists and is a string
            const title = item?.title;
            if (!title || typeof title !== 'string') {
                return false;
            }
            return title.toLowerCase().includes(lower);
        });
    }

    /**
     * Get library statistics
     * @returns {LibraryStats}
     */
    getStats() {
        this._ensureInitialized();
        
        const totalSize = JSON.stringify(this._items).length;
        return {
            count: this._items.length,
            storageUsed: totalSize,
            storageUsedFormatted: this._formatBytes(totalSize)
        };
    }

    /**
     * Format bytes as human-readable string
     * @private
     * @param {number} bytes
     * @returns {string}
     */
    _formatBytes(bytes) {
        // Handle invalid input
        if (typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) {
            return '0 B';
        }
        
        if (bytes < 1024) return Math.round(bytes) + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    /**
     * Format timestamp as relative time string
     * @param {number} timestamp - Unix timestamp (milliseconds)
     * @returns {string} Human-readable relative time
     */
    formatRelativeTime(timestamp) {
        // Handle invalid input
        if (typeof timestamp !== 'number' || isNaN(timestamp) || timestamp <= 0) {
            return 'Unknown';
        }
        
        const diff = Date.now() - timestamp;
        
        // Handle future timestamps
        if (diff < 0) {
            return 'In the future';
        }
        
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days} days ago`;
        if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
        
        return new Date(timestamp).toLocaleDateString();
    }

    /**
     * Check if the library is empty
     * @returns {boolean}
     */
    isEmpty() {
        this._ensureInitialized();
        return this._items.length === 0;
    }

    /**
     * Get the number of items
     * @returns {number}
     */
    get count() {
        this._ensureInitialized();
        return this._items.length;
    }

    /**
     * Check if an item with the given ID exists
     * @param {string} id - Item ID
     * @returns {boolean}
     */
    exists(id) {
        this._ensureInitialized();
        if (!id || typeof id !== 'string') {
            return false;
        }
        return this._items.some(item => item.id === id);
    }

    /**
     * Find items by title (case-insensitive partial match)
     * Useful for duplicate detection
     * @param {string} title - Title to search for
     * @returns {LibraryItemSummary[]} Matching items
     */
    findByTitle(title) {
        this._ensureInitialized();
        if (!title || typeof title !== 'string') {
            return [];
        }
        const lower = title.toLowerCase().trim();
        return this.getAll().filter(item => 
            item.title && item.title.toLowerCase().includes(lower)
        );
    }

    /**
     * Reset reading progress for an item (mark as unread)
     * @param {string} id - Item ID
     * @returns {boolean} True if item was found and reset
     */
    resetProgress(id) {
        this._ensureInitialized();
        
        if (!id || typeof id !== 'string') {
            return false;
        }
        
        const item = this._items.find(i => i.id === id);
        if (!item) return false;
        
        item.currentPosition = 0;
        item.completed = false;
        item.lastReadAt = Date.now();
        this._save();
        return true;
    }

    /**
     * Get most recently read items
     * @param {number} [limit=5] - Maximum number of items to return
     * @returns {LibraryItemSummary[]}
     */
    getRecent(limit = 5) {
        this._ensureInitialized();
        const validLimit = Math.max(1, Math.min(limit || 5, this._items.length));
        
        // Sort by lastReadAt descending, then take first N
        return this.getAll()
            .sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))
            .slice(0, validLimit);
    }

    /**
     * Get items that are in-progress (started but not completed)
     * @returns {LibraryItemSummary[]}
     */
    getInProgress() {
        this._ensureInitialized();
        return this.getAll().filter(item => 
            item.currentPosition > 0 && !item.completed
        );
    }

    /**
     * Export a library item as a text file
     * @param {string} id - Item ID
     * @returns {boolean} True if export succeeded
     */
    exportItem(id) {
        this._ensureInitialized();
        
        // Validate id
        if (!id || typeof id !== 'string') {
            return false;
        }
        
        const item = this.get(id);
        if (!item) return false;
        
        // Create safe filename from title
        const safeTitle = (item.title || 'untitled')
            .replace(/[^a-z0-9]/gi, '_')
            .replace(/_+/g, '_') // Collapse multiple underscores
            .replace(/^_|_$/g, '') // Trim leading/trailing underscores
            || 'untitled';
        
        const blob = new Blob([item.text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeTitle}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        return true;
    }

    /**
     * Export all library items as JSON
     * @returns {boolean} True if export succeeded
     */
    exportAll() {
        this._ensureInitialized();
        if (this._items.length === 0) return false;
        
        const exportData = {
            version: 1,
            exportedAt: new Date().toISOString(),
            items: this._items.map(item => {
                // Calculate progress for export - consistent with getAll()
                let progress = 0;
                if (item.completed) {
                    progress = 100;
                } else if (item.wordCount > 0) {
                    progress = Math.round(((item.currentPosition + 1) / item.wordCount) * 100);
                    progress = Math.max(0, Math.min(99, progress));
                }
                    
                return {
                    title: item.title,
                    text: item.text,
                    wordCount: item.wordCount,
                    addedAt: item.addedAt,        // Correct field name
                    lastReadAt: item.lastReadAt,
                    currentPosition: item.currentPosition,
                    completed: item.completed,
                    progress
                };
            })
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `rsvp-library-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        return true;
    }

    /**
     * Import library from JSON file
     * @param {File} file - JSON file to import
     * @returns {Promise<{success: boolean, count: number, error?: string}>}
     */
    async importFromJson(file) {
        // Validate file input
        if (!file) {
            return { success: false, count: 0, error: 'No file provided' };
        }
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            if (!data.items || !Array.isArray(data.items)) {
                return { success: false, count: 0, error: 'Invalid library format' };
            }
            
            let importedCount = 0;
            for (const item of data.items) {
                // Validate item has required text field
                if (item.text && typeof item.text === 'string' && item.text.trim().length > 0) {
                    // Pass metadata including currentPosition for restoration
                    // The add() method now properly handles metadata.currentPosition
                    const imported = this.add(item.text, item.title || null, {
                        addedAt: item.addedAt || item.createdAt, // Support both old and new field names
                        lastReadAt: item.lastReadAt || Date.now(),
                        currentPosition: item.currentPosition || 0,
                        completed: item.completed || false
                    });
                    
                    if (imported) {
                        importedCount++;
                    }
                }
            }
            
            return { success: true, count: importedCount };
        } catch (e) {
            console.error('LibraryManager: Import failed:', e);
            return { success: false, count: 0, error: e.message || 'Import failed' };
        }
    }

    /**
     * Import text file as library item
     * @param {File} file - Text file to import
     * @returns {Promise<{success: boolean, item?: LibraryItem, error?: string}>}
     */
    async importTextFile(file) {
        // Validate file input
        if (!file) {
            return { success: false, error: 'No file provided' };
        }
        
        try {
            const text = await file.text();
            
            // Get title from filename, removing extension
            const title = (file.name || 'imported')
                .replace(/\.[^.]+$/, '') // Remove extension
                .trim() || 'Imported';
                
            const item = this.add(text, title);
            
            if (item) {
                return { success: true, item };
            } else {
                return { success: false, error: 'Failed to add item (possibly empty text)' };
            }
        } catch (e) {
            console.error('LibraryManager: Text import failed:', e);
            return { success: false, error: e.message || 'Import failed' };
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        this._items = [];
        this._initialized = false;
    }
}

// Export singleton instance
export const LibraryManager = new LibraryManagerClass();

// Also export class for testing
export { LibraryManagerClass };
