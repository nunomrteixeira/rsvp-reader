/**
 * RSVP Reader - Panels Module
 * 
 * Manages slide-out panels and modal dialogs with proper accessibility.
 * 
 * Features:
 * - Settings panel (slide-out)
 * - Library panel (slide-out)
 * - Stats modal
 * - Shortcuts modal
 * - Comprehension modal
 * - Focus trapping within modals (filters hidden elements)
 * - Body scroll lock when panels open (preserves original overflow)
 * - Focus restoration on close
 * - EventBus integration
 * - Keyboard navigation (Escape to close)
 * - Proper ARIA attributes
 * - Full cleanup support
 * 
 * Usage:
 *   import { Panels } from './panels.js';
 *   Panels.init();
 *   Panels.openSettings();
 *   Panels.closeAll();
 */

import { DOM } from './dom-cache.js';
import { KeyboardManager } from './keyboard-manager.js';
import { EventBus, Events } from './event-bus.js';

// ============================================
// MODULE STATE
// ============================================

/** @type {Set<string>} Track which panels are currently open (maintains insertion order) */
const _openPanels = new Set();

/** @type {Map<string, HTMLElement|null>} Store previously focused element for each panel */
const _previousFocus = new Map();

/** @type {boolean} */
let _initialized = false;

/** @type {boolean} */
let _eventsBound = false;

/** @type {Function|null} Global escape handler */
let _escapeHandler = null;

/** @type {Map<string, Function>} Focus trap handlers by panel name */
const _focusTrapHandlers = new Map();

/** 
 * Bound event handlers for cleanup
 * @type {Map<string, {element: Element, type: string, handler: Function}>}
 */
const _boundHandlers = new Map();

/** @type {string} Original body overflow value */
let _originalBodyOverflow = '';

// ============================================
// PANEL CONFIGURATION
// ============================================

/**
 * Panel/Modal configuration
 * Note: Set iteration order is guaranteed in ES6+ (insertion order)
 */
const PANEL_CONFIG = {
    settings: {
        panelKey: 'settingsPanel',
        overlayKey: 'panelOverlay',
        closeButtonKey: 'btnCloseSettings',
        type: 'panel',
        disableKeyboard: true,
        focusSelector: 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    },
    library: {
        panelKey: 'libraryPanel',
        overlayKey: 'libraryOverlay',
        closeButtonKey: 'btnCloseLibrary',
        type: 'panel',
        disableKeyboard: true,
        focusSelector: '#library-search'
    },
    stats: {
        panelKey: 'statsModal',
        overlayKey: null, // Uses modal backdrop
        closeButtonKey: 'btnCloseStats',
        type: 'modal',
        disableKeyboard: true,
        focusSelector: '#btn-close-stats'
    },
    shortcuts: {
        panelKey: 'shortcutsModal',
        overlayKey: null,
        closeButtonKey: 'btnCloseShortcuts',
        type: 'modal',
        disableKeyboard: true,
        focusSelector: '.modal-close'
    },
    comprehension: {
        panelKey: 'comprehensionModal',
        overlayKey: null,
        closeButtonKey: 'btnCloseComprehension',
        type: 'modal',
        disableKeyboard: true,
        focusSelector: '.comprehension-option'
    }
};

// Freeze configuration to prevent modification
Object.freeze(PANEL_CONFIG);
for (const config of Object.values(PANEL_CONFIG)) {
    Object.freeze(config);
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the panels module
 * @returns {Object} Panels instance for chaining
 */
function init() {
    if (_initialized) {
        return Panels;
    }
    
    // Store original body overflow
    _originalBodyOverflow = document.body.style.overflow || '';
    
    bindEvents();
    _initialized = true;
    
    return Panels;
}

// ============================================
// GENERIC PANEL OPERATIONS
// ============================================

/**
 * Open a panel/modal by name
 * @param {string} name - Panel name
 * @param {Function} [onRender] - Optional render callback
 * @returns {boolean} True if panel was opened
 */
function openPanel(name, onRender) {
    const config = PANEL_CONFIG[name];
    if (!config) {
        console.warn(`[Panels] Unknown panel: ${name}`);
        return false;
    }
    
    // Prevent double-open
    if (_openPanels.has(name)) {
        // Panel already open, just run render callback if provided
        if (onRender) {
            try {
                onRender();
            } catch (err) {
                console.error(`[Panels] onRender callback error:`, err);
            }
        }
        return false;
    }
    
    const panel = DOM.get(config.panelKey);
    if (!panel) {
        console.warn(`[Panels] Panel element not found: ${config.panelKey}`);
        return false;
    }
    
    // Store current focus for restoration (check it's a valid focusable element)
    const currentFocus = document.activeElement;
    if (currentFocus && currentFocus !== document.body && currentFocus !== document.documentElement) {
        _previousFocus.set(name, currentFocus);
    }
    
    // Get overlay if applicable
    const overlay = config.overlayKey ? DOM.get(config.overlayKey) : null;
    
    // Call render callback before showing (with error handling)
    if (onRender) {
        try {
            onRender();
        } catch (err) {
            console.error(`[Panels] onRender callback error:`, err);
            // Continue opening panel despite render error
        }
    }
    
    // Open panel
    if (config.type === 'panel') {
        panel.classList.add('open');
    } else {
        panel.classList.add('visible');
    }
    
    panel.setAttribute('aria-hidden', 'false');
    panel.setAttribute('aria-modal', 'true');
    
    // Show overlay
    if (overlay) {
        overlay.classList.add('visible');
        overlay.setAttribute('aria-hidden', 'false');
    }
    
    // Track open state
    _openPanels.add(name);
    
    // Disable keyboard shortcuts (safe to call multiple times)
    if (config.disableKeyboard) {
        KeyboardManager.disable();
    }
    
    // Lock body scroll
    updateBodyScroll();
    
    // Set up focus trap
    setupFocusTrap(name, panel);
    
    // Focus first focusable element (after panel animation starts)
    requestAnimationFrame(() => {
        if (!_openPanels.has(name)) return; // Panel was closed immediately
        
        const focusTarget = panel.querySelector(config.focusSelector);
        if (focusTarget && isElementVisible(focusTarget)) {
            focusTarget.focus();
        } else {
            // Fallback to first visible focusable
            const firstFocusable = findFirstFocusable(panel);
            if (firstFocusable) {
                firstFocusable.focus();
            }
        }
    });
    
    // Emit event
    EventBus.emit(Events.PANEL_OPEN, { panel: name });
    
    return true;
}

/**
 * Close a panel/modal by name
 * @param {string} name - Panel name
 * @returns {boolean} True if panel was closed
 */
function closePanel(name) {
    const config = PANEL_CONFIG[name];
    if (!config) return false;
    
    // Check if actually open
    if (!_openPanels.has(name)) {
        return false;
    }
    
    const panel = DOM.get(config.panelKey);
    if (!panel) return false;
    
    // Get overlay if applicable
    const overlay = config.overlayKey ? DOM.get(config.overlayKey) : null;
    
    // Close panel
    if (config.type === 'panel') {
        panel.classList.remove('open');
    } else {
        panel.classList.remove('visible');
    }
    
    panel.setAttribute('aria-hidden', 'true');
    panel.removeAttribute('aria-modal');
    
    // Hide overlay
    if (overlay) {
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
    }
    
    // Remove from tracking
    _openPanels.delete(name);
    
    // Remove focus trap
    removeFocusTrap(name);
    
    // Re-enable keyboard if no panels open
    if (_openPanels.size === 0) {
        KeyboardManager.enable();
    }
    
    // Unlock body scroll if no panels open
    updateBodyScroll();
    
    // Restore focus (after a brief delay to let panel start closing)
    const previousFocus = _previousFocus.get(name);
    _previousFocus.delete(name);
    
    if (previousFocus && typeof previousFocus.focus === 'function') {
        // Check element is still in DOM and visible
        if (document.body.contains(previousFocus) && isElementVisible(previousFocus)) {
            // Small delay to ensure panel is closing
            requestAnimationFrame(() => {
                previousFocus.focus();
            });
        }
    }
    
    // Emit event
    EventBus.emit(Events.PANEL_CLOSE, { panel: name });
    
    return true;
}

/**
 * Toggle a panel by name
 * @param {string} name - Panel name
 * @param {Function} [onRender] - Optional render callback for open
 * @returns {boolean} True if panel state changed
 */
function togglePanel(name, onRender) {
    if (_openPanels.has(name)) {
        return closePanel(name);
    } else {
        return openPanel(name, onRender);
    }
}

// ============================================
// FOCUS MANAGEMENT
// ============================================

/**
 * Set up focus trap for a panel
 * @private
 * @param {string} name - Panel name
 * @param {HTMLElement} panel - Panel element
 */
function setupFocusTrap(name, panel) {
    const handler = (e) => {
        if (e.key !== 'Tab') return;
        
        // Get currently visible focusable elements
        const focusableElements = getVisibleFocusableElements(panel);
        
        if (focusableElements.length === 0) return;
        
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        
        if (e.shiftKey) {
            // Shift + Tab
            if (document.activeElement === firstFocusable) {
                e.preventDefault();
                lastFocusable.focus();
            }
        } else {
            // Tab
            if (document.activeElement === lastFocusable) {
                e.preventDefault();
                firstFocusable.focus();
            }
        }
    };
    
    panel.addEventListener('keydown', handler);
    _focusTrapHandlers.set(name, handler);
}

/**
 * Remove focus trap for a panel
 * @private
 * @param {string} name - Panel name
 */
function removeFocusTrap(name) {
    const config = PANEL_CONFIG[name];
    if (!config) return;
    
    const panel = DOM.get(config.panelKey);
    const handler = _focusTrapHandlers.get(name);
    
    if (panel && handler) {
        panel.removeEventListener('keydown', handler);
    }
    
    _focusTrapHandlers.delete(name);
}

/**
 * Get all visible focusable elements within a container
 * @private
 * @param {HTMLElement} container - Container element
 * @returns {HTMLElement[]}
 */
function getVisibleFocusableElements(container) {
    const focusableSelector = 
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    
    const elements = Array.from(container.querySelectorAll(focusableSelector));
    
    return elements.filter(el => isElementVisible(el));
}

/**
 * Find first visible focusable element in container
 * @private
 * @param {HTMLElement} container - Container element
 * @returns {HTMLElement|null}
 */
function findFirstFocusable(container) {
    const elements = getVisibleFocusableElements(container);
    return elements.length > 0 ? elements[0] : null;
}

/**
 * Check if element is visible
 * @private
 * @param {HTMLElement} el - Element to check
 * @returns {boolean}
 */
function isElementVisible(el) {
    if (!el) return false;
    
    // Check if element or ancestor has display: none or visibility: hidden
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
    }
    
    // Check offsetParent (null for hidden elements, except for fixed positioned)
    if (el.offsetParent === null && style.position !== 'fixed') {
        return false;
    }
    
    return true;
}

/**
 * Update body scroll lock based on open panels
 * @private
 */
function updateBodyScroll() {
    if (_openPanels.size > 0) {
        // Save original overflow if this is the first panel
        if (_openPanels.size === 1 || _originalBodyOverflow === '') {
            _originalBodyOverflow = document.body.style.overflow || '';
        }
        document.body.style.overflow = 'hidden';
        document.body.setAttribute('data-panels-open', 'true');
        
        // iOS Safari fix - prevent touchmove on body
        document.body.style.touchAction = 'none';
    } else {
        // Restore original overflow
        document.body.style.overflow = _originalBodyOverflow;
        document.body.removeAttribute('data-panels-open');
        document.body.style.touchAction = '';
    }
}

// ============================================
// SETTINGS PANEL
// ============================================

/**
 * Open settings panel
 * @returns {boolean}
 */
function openSettings() {
    return openPanel('settings');
}

/**
 * Close settings panel
 * @returns {boolean}
 */
function closeSettings() {
    return closePanel('settings');
}

/**
 * Toggle settings panel
 * @returns {boolean}
 */
function toggleSettings() {
    return togglePanel('settings');
}

// ============================================
// LIBRARY PANEL
// ============================================

/**
 * Open library panel
 * @param {Function} [onRender] - Callback to render library content
 * @returns {boolean}
 */
function openLibrary(onRender) {
    return openPanel('library', onRender);
}

/**
 * Close library panel
 * @returns {boolean}
 */
function closeLibrary() {
    return closePanel('library');
}

/**
 * Toggle library panel
 * @param {Function} [onRender] - Callback to render library content
 * @returns {boolean}
 */
function toggleLibrary(onRender) {
    return togglePanel('library', onRender);
}

// ============================================
// STATS MODAL
// ============================================

/**
 * Open stats modal
 * @param {Function} [onRender] - Callback to render stats content
 * @returns {boolean}
 */
function openStats(onRender) {
    return openPanel('stats', onRender);
}

/**
 * Close stats modal
 * @returns {boolean}
 */
function closeStats() {
    return closePanel('stats');
}

/**
 * Toggle stats modal
 * @param {Function} [onRender] - Callback to render stats content
 * @returns {boolean}
 */
function toggleStats(onRender) {
    return togglePanel('stats', onRender);
}

// ============================================
// SHORTCUTS MODAL
// ============================================

/**
 * Open keyboard shortcuts modal
 * @returns {boolean}
 */
function openShortcuts() {
    return openPanel('shortcuts', () => {
        const grid = DOM.get('shortcutsHelpGrid');
        if (grid) {
            renderShortcutsHelp(grid);
        }
    });
}

/**
 * Render shortcuts help grid with current bindings
 * @private
 * @param {HTMLElement} container - Grid container element
 */
function renderShortcutsHelp(container) {
    const shortcuts = KeyboardManager.getAllShortcuts ? KeyboardManager.getAllShortcuts() : [];
    const formatKey = KeyboardManager.formatKeyForDisplay 
        ? (key) => KeyboardManager.formatKeyForDisplay(key)
        : (key) => escapeHtml(key);
    
    // Group shortcuts by category (include all actions)
    const categories = {
        'Playback': ['playPause', 'prev', 'next', 'reset'],
        'Speed': ['speedUp', 'speedDown'],
        'General': ['showHelp', 'skipComprehension']
    };
    
    const labels = {
        playPause: 'Play / Pause',
        prev: 'Previous word',
        next: 'Next word',
        reset: 'Reset to beginning',
        speedUp: 'Increase WPM (+25)',
        speedDown: 'Decrease WPM (-25)',
        showHelp: 'Show this help',
        skipComprehension: 'Skip comprehension check'
    };
    
    // Build DOM safely (no innerHTML with user data)
    container.innerHTML = '';
    
    for (const [category, actions] of Object.entries(categories)) {
        const section = document.createElement('section');
        section.className = 'shortcut-category';
        
        const title = document.createElement('h3');
        title.className = 'shortcut-category-title';
        title.textContent = category;
        section.appendChild(title);
        
        for (const action of actions) {
            const shortcut = shortcuts.find(s => s.action === action);
            if (shortcut) {
                const row = document.createElement('div');
                row.className = 'shortcut-row';
                
                const keysSpan = document.createElement('span');
                keysSpan.className = 'shortcut-keys';
                
                const kbd = document.createElement('kbd');
                kbd.textContent = formatKey(shortcut.key);
                keysSpan.appendChild(kbd);
                
                const actionSpan = document.createElement('span');
                actionSpan.className = 'shortcut-action';
                actionSpan.textContent = labels[action] || shortcut.displayName;
                
                row.appendChild(keysSpan);
                row.appendChild(actionSpan);
                section.appendChild(row);
            }
        }
        
        container.appendChild(section);
    }
    
    // Add static shortcuts that aren't customizable
    const staticSection = document.createElement('section');
    staticSection.className = 'shortcut-category';
    
    const staticTitle = document.createElement('h3');
    staticTitle.className = 'shortcut-category-title';
    staticTitle.textContent = 'Display';
    staticSection.appendChild(staticTitle);
    
    const staticShortcuts = [
        { key: 'F', action: 'Toggle Focus Mode' },
        { key: 'Esc', action: 'Exit Focus Mode / Close Panels' }
    ];
    
    for (const { key, action } of staticShortcuts) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        
        const keysSpan = document.createElement('span');
        keysSpan.className = 'shortcut-keys';
        
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        keysSpan.appendChild(kbd);
        
        const actionSpan = document.createElement('span');
        actionSpan.className = 'shortcut-action';
        actionSpan.textContent = action;
        
        row.appendChild(keysSpan);
        row.appendChild(actionSpan);
        staticSection.appendChild(row);
    }
    
    container.appendChild(staticSection);
}

/**
 * Close keyboard shortcuts modal
 * @returns {boolean}
 */
function closeShortcuts() {
    return closePanel('shortcuts');
}

/**
 * Toggle shortcuts modal
 * @returns {boolean}
 */
function toggleShortcuts() {
    return togglePanel('shortcuts', () => {
        const grid = DOM.get('shortcutsHelpGrid');
        if (grid) {
            renderShortcutsHelp(grid);
        }
    });
}

// ============================================
// COMPREHENSION MODAL
// ============================================

/**
 * Open comprehension check modal
 * @param {Function} [onRender] - Callback to render comprehension content
 * @returns {boolean}
 */
function openComprehension(onRender) {
    return openPanel('comprehension', onRender);
}

/**
 * Close comprehension check modal
 * @returns {boolean}
 */
function closeComprehension() {
    return closePanel('comprehension');
}

/**
 * Toggle comprehension check modal
 * @param {Function} [onRender] - Callback to render comprehension content
 * @returns {boolean}
 */
function toggleComprehension(onRender) {
    return togglePanel('comprehension', onRender);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Close all open panels and modals
 */
function closeAll() {
    // Copy to array since closePanel modifies the set
    const panels = Array.from(_openPanels);
    for (const panel of panels) {
        closePanel(panel);
    }
}

/**
 * Check if any panel is open
 * @returns {boolean}
 */
function isAnyOpen() {
    return _openPanels.size > 0;
}

/**
 * Check if a specific panel is open
 * @param {string} name - Panel name
 * @returns {boolean}
 */
function isOpen(name) {
    return _openPanels.has(name);
}

/**
 * Get list of open panels (in order opened)
 * @returns {string[]}
 */
function getOpen() {
    return Array.from(_openPanels);
}

/**
 * Get count of open panels
 * @returns {number}
 */
function getOpenCount() {
    return _openPanels.size;
}

// ============================================
// EVENT BINDING
// ============================================

/**
 * Add tracked event listener
 * @private
 * @param {string} key - Unique key for tracking
 * @param {Element} element - DOM element
 * @param {string} type - Event type
 * @param {Function} handler - Event handler
 */
function addTrackedListener(key, element, type, handler) {
    if (!element) return;
    element.addEventListener(type, handler);
    _boundHandlers.set(key, { element, type, handler });
}

/**
 * Bind panel events (close buttons, overlays, escape key)
 */
function bindEvents() {
    if (_eventsBound) {
        console.warn('[Panels] Events already bound');
        return;
    }
    
    // Settings panel
    const btnCloseSettings = DOM.get('btnCloseSettings');
    const panelOverlay = DOM.get('panelOverlay');
    addTrackedListener('btnCloseSettings', btnCloseSettings, 'click', closeSettings);
    addTrackedListener('panelOverlay', panelOverlay, 'click', closeSettings);
    
    // Library panel
    const btnCloseLibrary = DOM.get('btnCloseLibrary');
    const libraryOverlay = DOM.get('libraryOverlay');
    addTrackedListener('btnCloseLibrary', btnCloseLibrary, 'click', closeLibrary);
    addTrackedListener('libraryOverlay', libraryOverlay, 'click', closeLibrary);
    
    // Stats modal
    const btnCloseStats = DOM.get('btnCloseStats');
    const btnCloseStatsFooter = DOM.get('btnCloseStatsFooter');
    addTrackedListener('btnCloseStats', btnCloseStats, 'click', closeStats);
    addTrackedListener('btnCloseStatsFooter', btnCloseStatsFooter, 'click', closeStats);
    
    const statsModal = DOM.get('statsModal');
    if (statsModal) {
        const statsBackdropHandler = (e) => {
            if (e.target === statsModal) {
                closeStats();
            }
        };
        addTrackedListener('statsModalBackdrop', statsModal, 'click', statsBackdropHandler);
    }
    
    // Shortcuts modal
    const btnCloseShortcuts = DOM.get('btnCloseShortcuts');
    addTrackedListener('btnCloseShortcuts', btnCloseShortcuts, 'click', closeShortcuts);
    
    const shortcutsModal = DOM.get('shortcutsModal');
    if (shortcutsModal) {
        const shortcutsBackdropHandler = (e) => {
            if (e.target === shortcutsModal) {
                closeShortcuts();
            }
        };
        addTrackedListener('shortcutsModalBackdrop', shortcutsModal, 'click', shortcutsBackdropHandler);
    }
    
    // Comprehension modal
    const btnCloseComprehension = DOM.get('btnCloseComprehension');
    addTrackedListener('btnCloseComprehension', btnCloseComprehension, 'click', closeComprehension);
    
    const comprehensionModal = DOM.get('comprehensionModal');
    if (comprehensionModal) {
        const comprehensionBackdropHandler = (e) => {
            if (e.target === comprehensionModal) {
                closeComprehension();
            }
        };
        addTrackedListener('comprehensionModalBackdrop', comprehensionModal, 'click', comprehensionBackdropHandler);
    }
    
    // Global escape key handler
    _escapeHandler = (e) => {
        if (e.key === 'Escape' && isAnyOpen()) {
            e.preventDefault();
            e.stopPropagation();
            
            // Close the most recently opened panel (last in set - insertion order)
            const panels = Array.from(_openPanels);
            const lastPanel = panels[panels.length - 1];
            if (lastPanel) {
                closePanel(lastPanel);
            }
        }
    };
    
    document.addEventListener('keydown', _escapeHandler);
    
    _eventsBound = true;
}

// ============================================
// CLEANUP
// ============================================

/**
 * Clean up all resources
 */
function destroy() {
    // Guard against calling before init
    if (!_initialized) {
        return;
    }
    
    // Close all panels
    closeAll();
    
    // Remove escape handler
    if (_escapeHandler) {
        document.removeEventListener('keydown', _escapeHandler);
        _escapeHandler = null;
    }
    
    // Remove all tracked event listeners
    for (const [key, { element, type, handler }] of _boundHandlers.entries()) {
        if (element) {
            element.removeEventListener(type, handler);
        }
    }
    _boundHandlers.clear();
    
    // Clear all focus trap handlers
    for (const [name] of _focusTrapHandlers) {
        removeFocusTrap(name);
    }
    _focusTrapHandlers.clear();
    
    // Clear state
    _openPanels.clear();
    _previousFocus.clear();
    
    // Reset body scroll
    document.body.style.overflow = _originalBodyOverflow;
    document.body.removeAttribute('data-panels-open');
    document.body.style.touchAction = '';
    
    _eventsBound = false;
    _initialized = false;
}

// ============================================
// UTILITIES
// ============================================

/**
 * Escape HTML to prevent XSS
 * @private
 * @param {string} text - Text to escape
 * @returns {string}
 */
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// ============================================
// EXPORT
// ============================================

export const Panels = {
    // Lifecycle
    init,
    destroy,
    bindEvents,
    
    // Settings
    openSettings,
    closeSettings,
    toggleSettings,
    
    // Library
    openLibrary,
    closeLibrary,
    toggleLibrary,
    
    // Stats
    openStats,
    closeStats,
    toggleStats,
    
    // Shortcuts
    openShortcuts,
    closeShortcuts,
    toggleShortcuts,
    
    // Comprehension
    openComprehension,
    closeComprehension,
    toggleComprehension,
    
    // Utilities
    closeAll,
    isAnyOpen,
    isOpen,
    getOpen,
    getOpenCount
};
