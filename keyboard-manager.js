/**
 * RSVP Reader - Keyboard Manager Module
 * Handles customizable keyboard shortcuts with conflict detection.
 */

import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, CONFIG } from './config.js';
import { Storage } from './storage.js';
// Note: EventBus not currently used but may be needed for future shortcut change events

/**
 * Pre-compiled regex patterns (avoid creating on every keypress)
 */
const DIGIT_REGEX = /^\d$/;
const LETTER_REGEX = /^[a-zA-Z]$/;

/**
 * Input element tag names (uppercase for direct comparison without toLowerCase)
 */
const INPUT_TAG_NAMES = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Key code to display name mapping (constant, not recreated per call)
 */
const KEY_DISPLAY_MAP = {
    'Space': 'Space',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'Enter': 'Enter',
    'Escape': 'Esc',
    'Backspace': '⌫',
    'Tab': 'Tab',
    'ShiftLeft': 'Shift',
    'ShiftRight': 'Shift',
    'ControlLeft': 'Ctrl',
    'ControlRight': 'Ctrl',
    'AltLeft': 'Alt',
    'AltRight': 'Alt',
    'MetaLeft': '⌘',
    'MetaRight': '⌘'
};

/**
 * @typedef {Object} ShortcutBinding
 * @property {string} action - Action name (e.g., 'playPause')
 * @property {string} key - Key code (e.g., 'Space', 'ArrowUp')
 * @property {string} displayName - Human-readable action name
 */

/**
 * Keyboard Manager Class
 * Manages keyboard shortcuts with customization support.
 */
class KeyboardManagerClass {
    constructor() {
        /** @type {Object<string, string>} action -> keyCode */
        this._shortcuts = {};
        
        /** @type {Object<string, string>} keyCode -> action (reverse lookup) */
        this._keyToAction = {};
        
        /** @type {Object<string, function>} action -> handler */
        this._handlers = {};
        
        /** @type {boolean} */
        this._enabled = true;
        
        /** @type {boolean} */
        this._initialized = false;
        
        /** @type {function|null} */
        this._keydownHandler = null;
        
        /** @type {Set<string>} Keys that should be prevented default */
        this._preventDefaultKeys = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    }

    /**
     * Initialize the keyboard manager
     * @returns {KeyboardManagerClass}
     */
    init() {
        if (this._initialized) {
            return this;
        }
        
        // Load shortcuts from storage or use defaults
        this._loadShortcuts();
        
        // Build reverse lookup
        this._buildKeyToAction();
        
        // Set up event listener
        this._keydownHandler = this._handleKeydown.bind(this);
        document.addEventListener('keydown', this._keydownHandler);
        
        this._initialized = true;
        
        return this;
    }

    /**
     * Load shortcuts from storage
     * @private
     */
    _loadShortcuts() {
        const stored = Storage.get(CONFIG.STORAGE_KEYS.SHORTCUTS, {
            validator: (data) => typeof data === 'object' && data !== null,
            defaultValue: null
        });
        
        // Merge with defaults (stored takes precedence)
        this._shortcuts = { ...DEFAULT_SHORTCUTS, ...stored };
    }

    /**
     * Save shortcuts to storage
     * @private
     */
    _saveShortcuts() {
        Storage.set(CONFIG.STORAGE_KEYS.SHORTCUTS, this._shortcuts, { createBackup: true });
    }

    /**
     * Build reverse lookup map (key -> action)
     * @private
     */
    _buildKeyToAction() {
        this._keyToAction = {};
        for (const [action, key] of Object.entries(this._shortcuts)) {
            this._keyToAction[key] = action;
        }
    }

    /**
     * Handle keydown events - HOT PATH (runs on every keypress)
     * @private
     * @param {KeyboardEvent} event
     */
    _handleKeydown(event) {
        // Don't handle if disabled
        if (!this._enabled) {
            return;
        }
        
        // Safety check for event and target
        if (!event || !event.target) {
            return;
        }
        
        // Don't handle if typing in an input
        if (this._isInputElement(event.target)) {
            return;
        }
        
        // For keyboard layouts like Colemak:
        // - Use event.key (the character produced) for letter keys
        // - Use event.code (physical key) for special keys like arrows, space
        let action = null;
        const eventKey = event.key;
        
        // Special case: ? is Shift + / (Slash) 
        if (eventKey === '?') {
            action = this._keyToAction['Slash'];
        }
        
        // For single character keys (letters, numbers), use the typed character
        // This respects keyboard layout - pressing physical 'D' on Colemak produces 's'
        if (!action && eventKey.length === 1) {
            // Try letter key (KeyA, KeyB, etc.)
            action = this._keyToAction[`Key${eventKey.toUpperCase()}`];
            
            // Also try digit keys using pre-compiled regex (avoids regex creation per keypress)
            if (!action && DIGIT_REGEX.test(eventKey)) {
                action = this._keyToAction[`Digit${eventKey}`];
            }
        }
        
        // For special keys (arrows, space, etc.), use physical key code
        if (!action) {
            action = this._keyToAction[event.code];
        }
        
        if (action && this._handlers[action]) {
            // Prevent default for navigation keys
            if (this._preventDefaultKeys.has(event.code)) {
                event.preventDefault();
            }
            
            // Call the handler
            try {
                this._handlers[action](event);
            } catch (e) {
                console.error(`KeyboardManager: Error in handler for "${action}":`, e);
            }
        }
    }

    /**
     * Check if element is an input that should receive keyboard events - HOT PATH
     * Uses uppercase comparison to avoid creating new strings via toLowerCase()
     * @private
     * @param {Element} element
     * @returns {boolean}
     */
    _isInputElement(element) {
        // Safety check (defensive, should not normally happen)
        if (!element || !element.tagName) {
            return false;
        }
        
        // Use uppercase Set lookup - avoids toLowerCase() string creation
        return INPUT_TAG_NAMES.has(element.tagName) || element.isContentEditable === true;
    }

    /**
     * Register a handler for an action
     * @param {string} action - Action name
     * @param {function} handler - Handler function
     * @returns {function} Unregister function
     */
    on(action, handler) {
        // Validate action exists
        if (!(action in SHORTCUT_ACTIONS)) {
            console.warn(`KeyboardManager: Unknown action "${action}"`);
            // Still allow registration for forward compatibility
        }
        
        // Validate handler is a function
        if (typeof handler !== 'function') {
            console.error(`KeyboardManager: Handler for "${action}" must be a function, got ${typeof handler}`);
            return () => {}; // Return no-op unsubscribe
        }
        
        this._handlers[action] = handler;
        
        return () => {
            delete this._handlers[action];
        };
    }

    /**
     * Register multiple handlers at once
     * @param {Object<string, function>} handlers - Map of action -> handler
     * @returns {function} Unregister all function
     */
    onMultiple(handlers) {
        // Validate handlers object
        if (!handlers || typeof handlers !== 'object') {
            console.error('KeyboardManager: onMultiple expects an object');
            return () => {};
        }
        
        const unsubscribers = [];
        
        for (const [action, handler] of Object.entries(handlers)) {
            unsubscribers.push(this.on(action, handler));
        }
        
        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    }

    /**
     * Get current shortcut for an action
     * @param {string} action - Action name
     * @returns {string|null} Key code or null if not found
     */
    getShortcut(action) {
        // Validate action
        if (!action || typeof action !== 'string') {
            return null;
        }
        return this._shortcuts[action] || null;
    }

    /**
     * Get all shortcuts
     * @returns {ShortcutBinding[]}
     */
    getAllShortcuts() {
        return Object.entries(this._shortcuts).map(([action, key]) => ({
            action,
            key,
            displayName: SHORTCUT_ACTIONS[action]?.name || action
        }));
    }

    /**
     * Set a shortcut for an action
     * @param {string} action - Action name
     * @param {string} keyCode - Key code
     * @returns {{ success: boolean, conflict?: string }}
     */
    setShortcut(action, keyCode) {
        // Validate action
        if (!(action in SHORTCUT_ACTIONS)) {
            return { success: false, conflict: 'Unknown action' };
        }
        
        // Validate keyCode
        if (!keyCode || typeof keyCode !== 'string' || keyCode.trim() === '') {
            return { success: false, conflict: 'Invalid key code' };
        }
        
        const normalizedKeyCode = keyCode.trim();
        
        // Check for conflicts
        const existingAction = this._keyToAction[normalizedKeyCode];
        if (existingAction && existingAction !== action) {
            return { 
                success: false, 
                conflict: `Key already used by "${SHORTCUT_ACTIONS[existingAction]?.name || existingAction}"` 
            };
        }
        
        // Remove old key binding
        const oldKey = this._shortcuts[action];
        if (oldKey) {
            delete this._keyToAction[oldKey];
        }
        
        // Set new binding
        this._shortcuts[action] = normalizedKeyCode;
        this._keyToAction[normalizedKeyCode] = action;
        
        this._saveShortcuts();
        
        return { success: true };
    }

    /**
     * Clear a shortcut (set to no key)
     * @param {string} action - Action name
     * @returns {boolean} True if shortcut was cleared
     */
    clearShortcut(action) {
        // Validate action
        if (!action || typeof action !== 'string') {
            console.warn('KeyboardManager: clearShortcut requires a valid action');
            return false;
        }
        
        const oldKey = this._shortcuts[action];
        if (oldKey) {
            delete this._keyToAction[oldKey];
        }
        delete this._shortcuts[action];
        this._saveShortcuts();
        return true;
    }

    /**
     * Reset all shortcuts to defaults
     */
    resetToDefaults() {
        this._shortcuts = { ...DEFAULT_SHORTCUTS };
        this._buildKeyToAction();
        this._saveShortcuts();
    }

    /**
     * Check if a key is already bound
     * @param {string} keyCode - Key code to check
     * @returns {{ bound: boolean, action?: string }}
     */
    isKeyBound(keyCode) {
        // Validate keyCode
        if (!keyCode || typeof keyCode !== 'string') {
            return { bound: false };
        }
        
        const action = this._keyToAction[keyCode];
        if (action) {
            return { bound: true, action };
        }
        return { bound: false };
    }

    /**
     * Enable keyboard shortcuts
     */
    enable() {
        this._enabled = true;
    }

    /**
     * Disable keyboard shortcuts
     */
    disable() {
        this._enabled = false;
    }

    /**
     * Check if shortcuts are enabled
     * @returns {boolean}
     */
    isEnabled() {
        return this._enabled;
    }

    /**
     * Temporarily disable shortcuts (e.g., when modal is open)
     * @returns {function} Re-enable function
     */
    suspend() {
        const wasEnabled = this._enabled;
        this._enabled = false;
        
        return () => {
            this._enabled = wasEnabled;
        };
    }

    /**
     * Format a key code for display
     * Uses module-level KEY_DISPLAY_MAP constant (not recreated per call)
     * @param {string} keyCode - Key code
     * @returns {string} Human-readable key name
     */
    formatKeyForDisplay(keyCode) {
        // Handle null/undefined/non-string
        if (!keyCode || typeof keyCode !== 'string') {
            return 'None';
        }
        
        // Check constant map first (avoids object creation per call)
        if (KEY_DISPLAY_MAP[keyCode]) {
            return KEY_DISPLAY_MAP[keyCode];
        }
        
        // Handle letter keys (KeyA -> A)
        if (keyCode.startsWith('Key')) {
            return keyCode.slice(3);
        }
        
        // Handle digit keys (Digit1 -> 1)
        if (keyCode.startsWith('Digit')) {
            return keyCode.slice(5);
        }
        
        // Handle numpad keys
        if (keyCode.startsWith('Numpad')) {
            return 'Num' + keyCode.slice(6);
        }
        
        return keyCode;
    }

    /**
     * Wait for next key press (for shortcut configuration)
     * Press Escape to cancel
     * @param {number} [timeout=5000] - Timeout in ms (min 100, max 30000)
     * @returns {Promise<string|null>} Key code or null if timed out/cancelled
     */
    waitForKeyPress(timeout = 5000) {
        // Validate and clamp timeout
        const validTimeout = Math.max(100, Math.min(30000, Number(timeout) || 5000));
        
        return new Promise((resolve) => {
            let resolved = false;
            const wasEnabled = this._enabled;
            this._enabled = false; // Disable normal handling
            
            const handler = (event) => {
                if (resolved) return;
                
                event.preventDefault();
                event.stopPropagation();
                
                // Allow Escape to cancel the wait
                if (event.code === 'Escape') {
                    resolved = true;
                    cleanup();
                    resolve(null);
                    return;
                }
                
                resolved = true;
                cleanup();
                
                // For single character keys (letters), use event.key to respect keyboard layout
                // This means on Colemak, pressing physical 'D' saves as 'KeyS' (the character produced)
                // Use pre-compiled regex constants for performance
                if (event.key.length === 1 && LETTER_REGEX.test(event.key)) {
                    resolve(`Key${event.key.toUpperCase()}`);
                } else if (event.key.length === 1 && DIGIT_REGEX.test(event.key)) {
                    resolve(`Digit${event.key}`);
                } else {
                    // For special keys, use physical code
                    resolve(event.code);
                }
            };
            
            const timeoutId = setTimeout(() => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(null);
            }, validTimeout);
            
            const cleanup = () => {
                document.removeEventListener('keydown', handler, true);
                clearTimeout(timeoutId);
                this._enabled = wasEnabled;
            };
            
            document.addEventListener('keydown', handler, true);
        });
    }

    /**
     * Clean up resources
     */
    destroy() {
        // Remove event listener
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
        
        // Reset all state
        this._handlers = {};
        this._shortcuts = {};
        this._keyToAction = {};
        this._enabled = true;
        this._initialized = false;
    }
}

// Export singleton
export const KeyboardManager = new KeyboardManagerClass();

// Also export class for testing
export { KeyboardManagerClass };
