/**
 * RSVP Reader - UI Manager
 * 
 * Unified UI orchestration module that coordinates all UI sub-modules.
 * Provides centralized initialization, event binding, and cleanup.
 * 
 * Modules Managed:
 * - DOM: Element caching and access
 * - Toast: Notification system
 * - Theme: Theme and color management
 * - Panels: Modal and panel management (init calls bindEvents internally)
 * - ReaderDisplay: Word display and progress
 * - SettingsUI: Settings panel controls
 * 
 * Features:
 * - Ordered initialization with dependency management
 * - Comprehensive error handling with rollback on critical failure
 * - State tracking to prevent double init/destroy
 * - Concurrent init protection
 * - EventBus integration for UI lifecycle events (UI_READY, UI_DESTROYED)
 * - Graceful degradation on module failures
 * - Safe convenience helpers with initialization checks (warn once)
 * 
 * Usage:
 *   import { UI } from './ui-manager.js';
 *   
 *   // Initialize all UI modules
 *   await UI.init();
 *   
 *   // Bind events with callbacks (some modules bind in init)
 *   UI.bindEvents({ settings: { onWpmChange: (wpm) => {...} } });
 *   
 *   // Use safe convenience helpers
 *   UI.toast.success('Saved!');
 *   UI.theme.toggle();
 *   UI.panels.openSettings();
 *   
 *   // Or access modules directly (bypasses safety checks)
 *   UI.Toast.success('Saved!');
 *   
 *   // Cleanup
 *   UI.destroy();
 */

// ============================================
// IMPORTS
// ============================================

import { DOM } from './dom-cache.js';
import { Toast } from './toast.js';
import { Theme } from './theme.js';
import { Panels } from './panels.js';
import { ReaderDisplay } from './reader-display.js';
import { SettingsUI } from './settings-ui.js';
import { EventBus, Events } from './event-bus.js';

// ============================================
// POLYFILLS
// ============================================

/**
 * queueMicrotask polyfill for older browsers
 */
const _queueMicrotask = typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);

// ============================================
// MODULE STATE
// ============================================

/** @type {boolean} Module fully initialized */
let _initialized = false;

/** @type {boolean} Currently in init process (prevents concurrent init) */
let _initializing = false;

/** @type {boolean} Events have been bound */
let _eventsBound = false;

/** @type {Set<string>} Track which modules initialized successfully */
const _initializedModules = new Set();

/** @type {Array<string>} Errors encountered during initialization */
const _initErrors = [];

/** @type {Set<string>} Track which helpers have already warned about init */
const _warnedHelpers = new Set();

/** @type {number} Generation counter to invalidate stale microtask callbacks */
let _initGeneration = 0;

// ============================================
// CONFIGURATION
// ============================================

/**
 * Module initialization order (dependencies first)
 * 
 * Configuration properties:
 * - name: Module identifier
 * - module: Module reference
 * - hasInit: Whether module has init() method
 * - hasDestroy: Whether module has destroy() method
 * - bindMethod: Method name to call for event binding (null if init handles it)
 * - critical: If true, failure aborts initialization and rolls back
 * 
 * Note: Panels.init() calls bindEvents() internally, so bindMethod is null
 */
const MODULE_CONFIG = [
    { 
        name: 'DOM', 
        module: DOM, 
        hasInit: true, 
        hasDestroy: false,  // Uses clear()
        bindMethod: null,
        critical: true      // App can't function without DOM
    },
    { 
        name: 'Toast', 
        module: Toast, 
        hasInit: true, 
        hasDestroy: true,
        bindMethod: null,   // No event binding needed
        critical: false
    },
    { 
        name: 'Theme', 
        module: Theme, 
        hasInit: true, 
        hasDestroy: true,
        bindMethod: 'bindColorPicker',  // Specific method name
        critical: false
    },
    { 
        name: 'Panels', 
        module: Panels, 
        hasInit: true, 
        hasDestroy: true,
        bindMethod: null,   // Panels.init() calls bindEvents() internally
        critical: false
    },
    { 
        name: 'SettingsUI', 
        module: SettingsUI, 
        hasInit: true, 
        hasDestroy: true,
        bindMethod: 'bindEvents',  // Requires external call with callbacks
        critical: false
    },
    { 
        name: 'ReaderDisplay', 
        module: ReaderDisplay, 
        hasInit: false,     // No init method - uses cacheSettings/cacheHotPathElements
        hasDestroy: false,  // No destroy method
        bindMethod: null,
        critical: false
    }
];

// Freeze configuration
Object.freeze(MODULE_CONFIG);
MODULE_CONFIG.forEach(c => Object.freeze(c));

// ============================================
// HELPERS
// ============================================

/**
 * Check if value is a thenable (Promise-like)
 * @private
 * @param {*} value - Value to check
 * @returns {boolean}
 */
function _isThenable(value) {
    if (value == null) return false;
    try {
        return typeof value.then === 'function';
    } catch {
        // Handle edge case where .then is a getter that throws
        return false;
    }
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize all UI modules in dependency order
 * @param {Object} [options] - Initialization options
 * @param {boolean} [options.silent=false] - Suppress console warnings
 * @returns {Promise<Object>} Result with success status and any errors
 */
async function init(options = {}) {
    const { silent = false } = options;
    
    // Check if already initialized
    if (_initialized) {
        if (!silent) {
            console.warn('[UI] Already initialized');
        }
        return { success: true, alreadyInitialized: true };
    }
    
    // Prevent concurrent initialization
    if (_initializing) {
        if (!silent) {
            console.warn('[UI] Initialization already in progress');
        }
        return { success: false, reason: 'init_in_progress' };
    }
    
    _initializing = true;
    _initErrors.length = 0;
    _initializedModules.clear();
    _warnedHelpers.clear();
    
    // Increment generation to invalidate any pending microtasks from previous init
    const currentGeneration = ++_initGeneration;
    
    // Initialize modules in order
    for (const config of MODULE_CONFIG) {
        if (!config.hasInit) {
            _initializedModules.add(config.name);
            continue;
        }
        
        try {
            const module = config.module;
            
            if (typeof module.init === 'function') {
                const result = module.init();
                // Handle both sync and async init (use duck typing for thenables)
                if (_isThenable(result)) {
                    await result;
                }
                _initializedModules.add(config.name);
            } else if (!silent) {
                console.warn(`[UI] ${config.name}.init is not a function`);
            }
        } catch (error) {
            const errorMsg = `[UI] Failed to initialize ${config.name}: ${error.message}`;
            _initErrors.push(errorMsg);
            
            if (!silent) {
                console.error(errorMsg, error);
            }
            
            // If critical module fails, rollback and abort
            if (config.critical) {
                _rollbackInit(silent);
                _initializing = false;
                
                return { 
                    success: false, 
                    errors: [..._initErrors],
                    criticalFailure: config.name,
                    rolledBack: true
                };
            }
        }
    }
    
    _initialized = true;
    _initializing = false;
    
    // Emit UI ready event (after a microtask to allow listeners to set up)
    // Use generation check to skip if destroyed before microtask runs
    _queueMicrotask(() => {
        // Skip if destroyed or re-initialized since this was queued
        if (!_initialized || _initGeneration !== currentGeneration) {
            return;
        }
        
        try {
            EventBus.emit(Events.UI_READY, { 
                modules: Array.from(_initializedModules),
                errors: _initErrors.length > 0 ? [..._initErrors] : null
            });
        } catch (e) {
            if (!silent) {
                console.warn('[UI] Failed to emit UI_READY event:', e.message);
            }
        }
    });
    
    return { 
        success: true, 
        modules: Array.from(_initializedModules),
        errors: _initErrors.length > 0 ? [..._initErrors] : null
    };
}

/**
 * Rollback initialization on critical failure
 * @private
 * @param {boolean} silent - Suppress warnings
 */
function _rollbackInit(silent) {
    // Destroy initialized modules in reverse order
    const initialized = Array.from(_initializedModules);
    
    for (let i = initialized.length - 1; i >= 0; i--) {
        const moduleName = initialized[i];
        const config = MODULE_CONFIG.find(c => c.name === moduleName);
        if (!config) continue;
        
        try {
            const module = config.module;
            
            if (config.hasDestroy && typeof module.destroy === 'function') {
                module.destroy();
            } else if (config.name === 'DOM' && typeof module.clear === 'function') {
                module.clear();
            }
        } catch (error) {
            if (!silent) {
                console.error(`[UI] Failed to rollback ${moduleName}:`, error);
            }
        }
    }
    
    _initializedModules.clear();
}

// ============================================
// EVENT BINDING
// ============================================

/**
 * Bind all UI events
 * 
 * Note: Some modules (like Panels) bind events in init(), so this only
 * calls bind methods for modules that require separate binding.
 * 
 * @param {Object} [callbacks] - Event callbacks for various UI interactions
 * @param {Object} [callbacks.settings] - Settings panel callbacks
 * @param {Object} [options] - Binding options
 * @param {boolean} [options.silent=false] - Suppress console warnings
 * @returns {Object} Result with success status
 */
function bindEvents(callbacks = {}, options = {}) {
    const { silent = false } = options;
    
    if (_eventsBound) {
        if (!silent) {
            console.warn('[UI] Events already bound');
        }
        return { success: false, reason: 'already_bound', errors: null };
    }
    
    if (!_initialized) {
        if (!silent) {
            console.warn('[UI] Cannot bind events before initialization. Call init() first.');
        }
        return { success: false, reason: 'not_initialized', errors: null };
    }
    
    const bindErrors = [];
    let boundCount = 0;
    
    // Bind each module that has a bind method
    for (const config of MODULE_CONFIG) {
        if (!config.bindMethod) continue;
        
        // Skip if module didn't initialize
        if (!_initializedModules.has(config.name)) {
            if (!silent) {
                console.warn(`[UI] Skipping ${config.name} binding - not initialized`);
            }
            continue;
        }
        
        const module = config.module;
        const bindFn = module[config.bindMethod];
        
        if (typeof bindFn !== 'function') {
            if (!silent) {
                console.warn(`[UI] ${config.name}.${config.bindMethod} is not a function`);
            }
            continue;
        }
        
        try {
            // Pass callbacks for modules that need them
            if (config.name === 'SettingsUI') {
                bindFn.call(module, callbacks.settings || {});
            } else {
                bindFn.call(module);
            }
            boundCount++;
        } catch (error) {
            bindErrors.push(`${config.name}: ${error.message}`);
            if (!silent) {
                console.error(`[UI] ${config.name}.${config.bindMethod} failed:`, error);
            }
        }
    }
    
    // Only mark as bound if at least some bindings succeeded
    _eventsBound = boundCount > 0 || bindErrors.length === 0;
    
    return { 
        success: bindErrors.length === 0,
        boundCount,
        errors: bindErrors.length > 0 ? bindErrors : null
    };
}

/**
 * Check if module binding can be reset
 * Note: Most modules don't support unbinding without full destroy.
 * To rebind with different callbacks, call destroy() then init() + bindEvents().
 * @returns {boolean}
 */
function canRebind() {
    return false;
}

// ============================================
// CLEANUP
// ============================================

/**
 * Destroy/cleanup all UI modules
 * @param {Object} [options] - Destruction options
 * @param {boolean} [options.silent=false] - Suppress console warnings
 * @returns {Object} Result with success status
 */
function destroy(options = {}) {
    const { silent = false } = options;
    
    // Cannot destroy while initialization is in progress
    if (_initializing) {
        if (!silent) {
            console.warn('[UI] Cannot destroy while initialization is in progress. Wait for init() to complete.');
        }
        return { success: false, reason: 'init_in_progress' };
    }
    
    if (!_initialized) {
        if (!silent) {
            console.warn('[UI] Not initialized, nothing to destroy');
        }
        return { success: true, wasInitialized: false };
    }
    
    // Increment generation to invalidate any pending UI_READY microtask
    _initGeneration++;
    
    const destroyErrors = [];
    
    // Destroy in reverse order (dependencies last)
    const reverseConfig = [...MODULE_CONFIG].reverse();
    
    for (const config of reverseConfig) {
        // Skip if module didn't initialize
        if (!_initializedModules.has(config.name)) continue;
        
        try {
            const module = config.module;
            
            if (config.hasDestroy && typeof module.destroy === 'function') {
                module.destroy();
            } else if (config.name === 'DOM' && typeof module.clear === 'function') {
                module.clear();
            }
            
            _initializedModules.delete(config.name);
        } catch (error) {
            destroyErrors.push(`${config.name}: ${error.message}`);
            if (!silent) {
                console.error(`[UI] Failed to destroy ${config.name}:`, error);
            }
        }
    }
    
    // Emit destroyed event before resetting state
    try {
        EventBus.emit(Events.UI_DESTROYED, {
            errors: destroyErrors.length > 0 ? destroyErrors : null
        });
    } catch (e) {
        if (!silent) {
            console.warn('[UI] Failed to emit UI_DESTROYED event:', e.message);
        }
    }
    
    // Reset state
    _initialized = false;
    _initializing = false;
    _eventsBound = false;
    _initializedModules.clear();
    _initErrors.length = 0;
    _warnedHelpers.clear();
    
    return { 
        success: destroyErrors.length === 0,
        errors: destroyErrors.length > 0 ? destroyErrors : null
    };
}

// ============================================
// STATUS & UTILITIES
// ============================================

/**
 * Check if UI is initialized
 * @returns {boolean}
 */
function isInitialized() {
    return _initialized;
}

/**
 * Check if currently initializing
 * @returns {boolean}
 */
function isInitializing() {
    return _initializing;
}

/**
 * Check if events are bound
 * @returns {boolean}
 */
function isEventsBound() {
    return _eventsBound;
}

/**
 * Get list of initialized modules
 * @returns {string[]}
 */
function getInitializedModules() {
    return Array.from(_initializedModules);
}

/**
 * Get initialization errors
 * @returns {string[]}
 */
function getInitErrors() {
    return [..._initErrors];
}

/**
 * Check if a specific module is initialized
 * @param {string} moduleName - Module name
 * @returns {boolean}
 */
function isModuleInitialized(moduleName) {
    return _initializedModules.has(moduleName);
}

/**
 * Get comprehensive status
 * @returns {Object}
 */
function getStatus() {
    return {
        initialized: _initialized,
        initializing: _initializing,
        eventsBound: _eventsBound,
        modules: Array.from(_initializedModules),
        errors: _initErrors.length > 0 ? [..._initErrors] : null,
        moduleStatus: MODULE_CONFIG.map(c => ({
            name: c.name,
            initialized: _initializedModules.has(c.name),
            critical: c.critical
        }))
    };
}

// ============================================
// CONVENIENCE METHODS
// ============================================

/**
 * Initialize and bind events in one call
 * @param {Object} [callbacks] - Event callbacks
 * @param {Object} [options] - Options
 * @returns {Promise<Object>} Combined result
 */
async function setup(callbacks = {}, options = {}) {
    const initResult = await init(options);
    
    if (!initResult.success) {
        return {
            success: false,
            init: initResult,
            bind: null
        };
    }
    
    // Skip binding if already initialized (events already bound)
    if (initResult.alreadyInitialized && _eventsBound) {
        return {
            success: true,
            alreadySetup: true,
            init: initResult,
            bind: { success: true, alreadyBound: true }
        };
    }
    
    const bindResult = bindEvents(callbacks, options);
    
    return {
        success: initResult.success && bindResult.success,
        init: initResult,
        bind: bindResult
    };
}

/**
 * Ensure UI is initialized before using helpers (warns only once per helper)
 * @private
 * @param {string} helperName - Helper being accessed
 * @returns {boolean} True if initialized
 */
function _ensureInit(helperName) {
    if (!_initialized) {
        // Only warn once per helper to avoid console spam
        if (!_warnedHelpers.has(helperName)) {
            console.warn(`[UI] ${helperName} accessed before UI.init(). Call UI.init() first.`);
            _warnedHelpers.add(helperName);
        }
        return false;
    }
    return true;
}

/**
 * Quick toast helpers (convenience re-exports with safety checks)
 * Return null on failure for consistency
 */
const toast = {
    show: (msg, opts) => {
        if (!_ensureInit('toast.show')) return null;
        return Toast.show(msg, opts);
    },
    success: (msg, duration) => {
        if (!_ensureInit('toast.success')) return null;
        return Toast.success(msg, duration);
    },
    error: (msg, duration) => {
        if (!_ensureInit('toast.error')) return null;
        return Toast.error(msg, duration);
    },
    info: (msg, duration) => {
        if (!_ensureInit('toast.info')) return null;
        return Toast.info(msg, duration);
    },
    warning: (msg, duration) => {
        if (!_ensureInit('toast.warning')) return null;
        return Toast.warning(msg, duration);
    },
    clear: () => {
        if (!_ensureInit('toast.clear')) return;
        Toast.clearAll();
    }
};

/**
 * Quick panel helpers (convenience re-exports with safety checks)
 * Return false on failure for consistency (matches Panels API)
 */
const panels = {
    // Toggle functions
    settings: () => {
        if (!_ensureInit('panels.settings')) return false;
        return Panels.toggleSettings();
    },
    library: (onRender) => {
        if (!_ensureInit('panels.library')) return false;
        return Panels.toggleLibrary(onRender);
    },
    stats: (onRender) => {
        if (!_ensureInit('panels.stats')) return false;
        return Panels.toggleStats(onRender);
    },
    shortcuts: () => {
        if (!_ensureInit('panels.shortcuts')) return false;
        return Panels.toggleShortcuts();
    },
    comprehension: (onRender) => {
        if (!_ensureInit('panels.comprehension')) return false;
        return Panels.toggleComprehension(onRender);
    },
    
    // Open functions
    openSettings: () => {
        if (!_ensureInit('panels.openSettings')) return false;
        return Panels.openSettings();
    },
    openLibrary: (onRender) => {
        if (!_ensureInit('panels.openLibrary')) return false;
        return Panels.openLibrary(onRender);
    },
    openStats: (onRender) => {
        if (!_ensureInit('panels.openStats')) return false;
        return Panels.openStats(onRender);
    },
    openShortcuts: () => {
        if (!_ensureInit('panels.openShortcuts')) return false;
        return Panels.openShortcuts();
    },
    openComprehension: (onRender) => {
        if (!_ensureInit('panels.openComprehension')) return false;
        return Panels.openComprehension(onRender);
    },
    
    // Close functions
    closeSettings: () => {
        if (!_ensureInit('panels.closeSettings')) return false;
        return Panels.closeSettings();
    },
    closeLibrary: () => {
        if (!_ensureInit('panels.closeLibrary')) return false;
        return Panels.closeLibrary();
    },
    closeStats: () => {
        if (!_ensureInit('panels.closeStats')) return false;
        return Panels.closeStats();
    },
    closeShortcuts: () => {
        if (!_ensureInit('panels.closeShortcuts')) return false;
        return Panels.closeShortcuts();
    },
    closeComprehension: () => {
        if (!_ensureInit('panels.closeComprehension')) return false;
        return Panels.closeComprehension();
    },
    
    // Utility functions
    closeAll: () => {
        if (!_ensureInit('panels.closeAll')) return false;
        Panels.closeAll();
        return true;
    },
    isAnyOpen: () => {
        if (!_ensureInit('panels.isAnyOpen')) return false;
        return Panels.isAnyOpen();
    },
    isOpen: (name) => {
        if (!_ensureInit('panels.isOpen')) return false;
        return Panels.isOpen(name);
    },
    getOpen: () => {
        if (!_ensureInit('panels.getOpen')) return [];
        return Panels.getOpen();
    }
};

/**
 * Quick theme helpers (convenience re-exports with safety checks)
 * Return null on failure for consistency
 */
const theme = {
    toggle: () => {
        if (!_ensureInit('theme.toggle')) return null;
        return Theme.toggle();
    },
    setTheme: (id) => {
        if (!_ensureInit('theme.setTheme')) return null;
        return Theme.setTheme(id);
    },
    setAccent: (id) => {
        if (!_ensureInit('theme.setAccent')) return null;
        return Theme.setAccentColor(id);
    },
    getCurrent: () => {
        if (!_ensureInit('theme.getCurrent')) return null;
        return Theme.getCurrent();
    },
    getAccent: () => {
        if (!_ensureInit('theme.getAccent')) return null;
        return Theme.getAccentColor();
    },
    isDark: () => {
        if (!_ensureInit('theme.isDark')) return false;
        return Theme.getCurrent() === 'dark';
    },
    isLight: () => {
        if (!_ensureInit('theme.isLight')) return false;
        return Theme.getCurrent() === 'light';
    }
};

/**
 * Quick reader display helpers
 * Return null on failure for consistency
 * Note: ReaderDisplay relies on DOM being ready
 */
const reader = {
    updateWord: (word, opts) => {
        if (!_ensureInit('reader.updateWord')) return null;
        return ReaderDisplay.updateWord(word, opts);
    },
    updateProgress: (current, total, remainingMs) => {
        if (!_ensureInit('reader.updateProgress')) return null;
        return ReaderDisplay.updateProgress(current, total, remainingMs);
    },
    updatePlaybackState: (isPlaying) => {
        if (!_ensureInit('reader.updatePlaybackState')) return null;
        return ReaderDisplay.updatePlaybackState(isPlaying);
    },
    updateWpmDisplay: (wpm) => {
        if (!_ensureInit('reader.updateWpmDisplay')) return null;
        return ReaderDisplay.updateWpmDisplay(wpm);
    },
    showReader: () => {
        if (!_ensureInit('reader.showReader')) return null;
        return ReaderDisplay.showReader();
    },
    showInput: () => {
        if (!_ensureInit('reader.showInput')) return null;
        return ReaderDisplay.showInput();
    },
    enterFocusMode: () => {
        if (!_ensureInit('reader.enterFocusMode')) return false;
        return ReaderDisplay.enterFocusMode();
    },
    exitFocusMode: () => {
        if (!_ensureInit('reader.exitFocusMode')) return false;
        return ReaderDisplay.exitFocusMode();
    },
    toggleFocusMode: () => {
        if (!_ensureInit('reader.toggleFocusMode')) return false;
        return ReaderDisplay.toggleFocusMode();
    },
    isInFocusMode: () => {
        if (!_ensureInit('reader.isInFocusMode')) return false;
        return ReaderDisplay.isInFocusMode();
    },
    cacheSettings: () => {
        if (!_ensureInit('reader.cacheSettings')) return null;
        return ReaderDisplay.cacheSettings();
    },
    cacheHotPathElements: () => {
        if (!_ensureInit('reader.cacheHotPathElements')) return null;
        return ReaderDisplay.cacheHotPathElements();
    }
};

// ============================================
// EXPORT
// ============================================

// Named exports for individual modules
export { DOM } from './dom-cache.js';
export { Toast } from './toast.js';
export { Theme } from './theme.js';
export { Panels } from './panels.js';
export { ReaderDisplay } from './reader-display.js';
export { SettingsUI } from './settings-ui.js';

// Main UI namespace export
export const UI = {
    // Direct module access (for advanced usage - bypasses safety checks)
    DOM,
    Toast,
    Theme,
    Panels,
    ReaderDisplay,
    SettingsUI,
    
    // Lifecycle
    init,
    destroy,
    setup,
    
    // Event binding
    bindEvents,
    canRebind,
    
    // Status
    isInitialized,
    isInitializing,
    isEventsBound,
    isModuleInitialized,
    getInitializedModules,
    getInitErrors,
    getStatus,
    
    // Convenience helpers (with safety checks)
    toast,
    panels,
    theme,
    reader
};

// Default export for simpler imports
export default UI;
