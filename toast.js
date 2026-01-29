/**
 * RSVP Reader - Toast Notification Module
 * 
 * Displays temporary notification messages to the user.
 * 
 * Features:
 * - Multiple toast types (success, error, info, warning)
 * - Configurable duration and dismissibility
 * - Queue management with max toast limit
 * - Duplicate message prevention (optional)
 * - Proper accessibility (aria-live varies by type)
 * - EventBus integration
 * - Cleanup support for pending timeouts
 * 
 * Usage:
 *   import { Toast } from './toast.js';
 *   Toast.show('Saved successfully');
 *   Toast.error('Something went wrong');
 *   Toast.success('Done!', 2000);
 *   Toast.info('Tip: Press Space to start', { dismissible: true });
 */

import { DOM } from './dom-cache.js';
import { EventBus, Events } from './event-bus.js';

// ============================================
// CONFIGURATION
// ============================================

/** Default toast duration in milliseconds */
const DEFAULT_DURATION = 3000;

/** Animation duration for fade in/out */
const FADE_DURATION = 300;

/** Maximum number of toasts visible at once */
const MAX_TOASTS = 5;

/** Toast types configuration */
const TOAST_TYPES = {
    success: {
        icon: 'check',
        ariaLive: 'polite',
        className: 'success'
    },
    error: {
        icon: 'x',
        ariaLive: 'assertive', // Errors should interrupt
        className: 'error'
    },
    info: {
        icon: 'info',
        ariaLive: 'polite',
        className: 'info'
    },
    warning: {
        icon: 'alert-circle',
        ariaLive: 'assertive', // Warnings should interrupt
        className: 'warning'
    }
};

/** Default toast type */
const DEFAULT_TYPE = 'success';

// ============================================
// MODULE STATE
// ============================================

/**
 * Active toasts with their metadata
 * @type {Map<HTMLElement, {timeoutId: number|null, message: string, type: string}>}
 */
const _activeToasts = new Map();

/**
 * Queue for toasts when max limit is reached
 * @type {Array<{message: string, options: Object}>}
 */
const _toastQueue = [];

/**
 * Set of currently displayed message hashes (for duplicate prevention)
 * @type {Set<string>}
 */
const _displayedMessages = new Set();

/** @type {boolean} */
let _initialized = false;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the toast module
 * @returns {Object} Toast instance for chaining
 */
function init() {
    if (_initialized) {
        return Toast;
    }
    
    _initialized = true;
    return Toast;
}

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {Object} [options] - Toast options
 * @param {string} [options.type='success'] - Toast type: 'success', 'error', 'info', 'warning'
 * @param {number} [options.duration=3000] - Duration in ms before auto-dismiss (0 = no auto-dismiss)
 * @param {boolean} [options.dismissible=false] - Allow click to dismiss
 * @param {boolean} [options.preventDuplicate=false] - Prevent showing if same message already visible
 * @param {string} [options.id] - Optional unique ID for the toast
 * @returns {HTMLElement|null} The toast element, or null if not shown
 */
function show(message, options = {}) {
    const {
        type = DEFAULT_TYPE,
        duration = DEFAULT_DURATION,
        dismissible = false,
        preventDuplicate = false,
        id = null
    } = options;
    
    // Validate message
    if (message == null || message === '') {
        console.warn('[Toast] Empty message, skipping');
        return null;
    }
    
    const messageStr = String(message);
    
    // Get container
    const container = DOM.get('toastContainer');
    if (!container) {
        console.warn('[Toast] Container not found');
        return null;
    }
    
    // Check for duplicate
    const messageHash = `${type}:${messageStr}`;
    if (preventDuplicate && _displayedMessages.has(messageHash)) {
        return null;
    }
    
    // Check max limit - queue if exceeded
    if (_activeToasts.size >= MAX_TOASTS) {
        _toastQueue.push({ message: messageStr, options: { ...options, preventDuplicate: false } });
        return null;
    }
    
    // Validate type
    const typeConfig = TOAST_TYPES[type] || TOAST_TYPES[DEFAULT_TYPE];
    const validType = TOAST_TYPES[type] ? type : DEFAULT_TYPE;
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${typeConfig.className}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', typeConfig.ariaLive);
    toast.setAttribute('aria-atomic', 'true');
    
    if (id) {
        toast.id = id;
    }
    
    // Build toast HTML
    toast.innerHTML = `
        <svg class="icon toast-icon" aria-hidden="true">
            <use href="#icon-${typeConfig.icon}"/>
        </svg>
        <span class="toast-message">${escapeHtml(messageStr)}</span>
        ${dismissible ? '<button class="toast-close" aria-label="Dismiss" type="button">&times;</button>' : ''}
    `;
    
    // Add click to dismiss
    if (dismissible) {
        const closeBtn = toast.querySelector('.toast-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dismiss(toast);
            });
        }
        // Also allow clicking anywhere on toast
        toast.style.cursor = 'pointer';
        toast.addEventListener('click', () => dismiss(toast));
    }
    
    // Track toast
    const timeoutId = duration > 0 
        ? setTimeout(() => dismiss(toast), duration)
        : null;
    
    _activeToasts.set(toast, { 
        timeoutId, 
        message: messageStr, 
        type: validType,
        messageHash 
    });
    
    if (preventDuplicate) {
        _displayedMessages.add(messageHash);
    }
    
    // Add to container
    container.appendChild(toast);
    
    // Trigger entrance animation (next frame)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });
    });
    
    // Emit event
    EventBus.emit(Events.TOAST_SHOW, { 
        toast, 
        message: messageStr, 
        type: validType,
        duration 
    });
    
    return toast;
}

/**
 * Dismiss a toast
 * @param {HTMLElement} toast - Toast element to dismiss
 * @param {boolean} [immediate=false] - Skip fade animation
 */
function dismiss(toast, immediate = false) {
    if (!toast) return;
    
    // Get metadata
    const metadata = _activeToasts.get(toast);
    if (!metadata) {
        // Already dismissed or not tracked
        return;
    }
    
    // Clear timeout
    if (metadata.timeoutId) {
        clearTimeout(metadata.timeoutId);
    }
    
    // Remove from tracking immediately to prevent double-dismiss
    _activeToasts.delete(toast);
    
    // Remove from duplicate tracking
    if (metadata.messageHash) {
        _displayedMessages.delete(metadata.messageHash);
    }
    
    // Start fade out
    toast.classList.remove('visible');
    toast.classList.add('dismissing');
    
    const removeToast = () => {
        if (toast.parentNode) {
            toast.remove();
        }
        
        // Emit event
        EventBus.emit(Events.TOAST_DISMISS, { 
            message: metadata.message, 
            type: metadata.type 
        });
        
        // Process queue
        processQueue();
    };
    
    if (immediate) {
        removeToast();
    } else {
        setTimeout(removeToast, FADE_DURATION);
    }
}

/**
 * Process queued toasts
 * @private
 */
function processQueue() {
    if (_toastQueue.length === 0) return;
    if (_activeToasts.size >= MAX_TOASTS) return;
    
    const next = _toastQueue.shift();
    if (next) {
        show(next.message, next.options);
    }
}

// ============================================
// CONVENIENCE METHODS
// ============================================

/**
 * Show a success toast
 * @param {string} message - Message to display
 * @param {number|Object} [durationOrOptions] - Duration in ms or options object
 * @returns {HTMLElement|null}
 */
function success(message, durationOrOptions = DEFAULT_DURATION) {
    const options = typeof durationOrOptions === 'number' 
        ? { type: 'success', duration: durationOrOptions }
        : { type: 'success', ...durationOrOptions };
    return show(message, options);
}

/**
 * Show an error toast
 * @param {string} message - Message to display
 * @param {number|Object} [durationOrOptions] - Duration in ms or options object
 * @returns {HTMLElement|null}
 */
function error(message, durationOrOptions = DEFAULT_DURATION) {
    const options = typeof durationOrOptions === 'number' 
        ? { type: 'error', duration: durationOrOptions }
        : { type: 'error', ...durationOrOptions };
    return show(message, options);
}

/**
 * Show an info toast
 * @param {string} message - Message to display
 * @param {number|Object} [durationOrOptions] - Duration in ms or options object
 * @returns {HTMLElement|null}
 */
function info(message, durationOrOptions = DEFAULT_DURATION) {
    const options = typeof durationOrOptions === 'number' 
        ? { type: 'info', duration: durationOrOptions }
        : { type: 'info', ...durationOrOptions };
    return show(message, options);
}

/**
 * Show a warning toast
 * @param {string} message - Message to display
 * @param {number|Object} [durationOrOptions] - Duration in ms or options object
 * @returns {HTMLElement|null}
 */
function warning(message, durationOrOptions = DEFAULT_DURATION) {
    const options = typeof durationOrOptions === 'number' 
        ? { type: 'warning', duration: durationOrOptions }
        : { type: 'warning', ...durationOrOptions };
    return show(message, options);
}

// ============================================
// UTILITY METHODS
// ============================================

/**
 * Clear all visible toasts
 * @param {boolean} [immediate=false] - Skip fade animation
 */
function clearAll(immediate = false) {
    // Copy to array since dismiss modifies the map
    const toasts = Array.from(_activeToasts.keys());
    
    for (const toast of toasts) {
        dismiss(toast, immediate);
    }
    
    // Clear queue
    _toastQueue.length = 0;
}

/**
 * Get number of active toasts
 * @returns {number}
 */
function getCount() {
    return _activeToasts.size;
}

/**
 * Get number of queued toasts
 * @returns {number}
 */
function getQueueCount() {
    return _toastQueue.length;
}

/**
 * Check if a message is currently being displayed
 * @param {string} message - Message to check
 * @param {string} [type] - Optional type to match
 * @returns {boolean}
 */
function isDisplayed(message, type) {
    const hash = type ? `${type}:${message}` : null;
    
    if (hash) {
        return _displayedMessages.has(hash);
    }
    
    // Check all active toasts
    for (const metadata of _activeToasts.values()) {
        if (metadata.message === message) {
            return true;
        }
    }
    
    return false;
}

/**
 * Find and dismiss a toast by message
 * @param {string} message - Message to find
 * @returns {boolean} True if found and dismissed
 */
function dismissByMessage(message) {
    for (const [toast, metadata] of _activeToasts.entries()) {
        if (metadata.message === message) {
            dismiss(toast);
            return true;
        }
    }
    return false;
}

/**
 * Find and dismiss a toast by ID
 * @param {string} id - Toast ID
 * @returns {boolean} True if found and dismissed
 */
function dismissById(id) {
    for (const toast of _activeToasts.keys()) {
        if (toast.id === id) {
            dismiss(toast);
            return true;
        }
    }
    return false;
}

/**
 * Update message of an existing toast
 * @param {HTMLElement} toast - Toast element
 * @param {string} newMessage - New message
 * @returns {boolean} True if updated
 */
function updateMessage(toast, newMessage) {
    if (!toast || !_activeToasts.has(toast)) {
        return false;
    }
    
    const messageEl = toast.querySelector('.toast-message');
    if (messageEl) {
        messageEl.innerHTML = escapeHtml(newMessage);
        
        const metadata = _activeToasts.get(toast);
        if (metadata) {
            // Update duplicate tracking
            if (metadata.messageHash) {
                _displayedMessages.delete(metadata.messageHash);
            }
            metadata.message = newMessage;
            metadata.messageHash = `${metadata.type}:${newMessage}`;
        }
        
        return true;
    }
    
    return false;
}

// ============================================
// CLEANUP
// ============================================

/**
 * Clean up all resources
 * Call when module is being unloaded
 */
function destroy() {
    // Clear all toasts immediately
    clearAll(true);
    
    // Clear any remaining state
    _activeToasts.clear();
    _toastQueue.length = 0;
    _displayedMessages.clear();
    _initialized = false;
}

// ============================================
// INTERNAL UTILITIES
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

export const Toast = {
    // Lifecycle
    init,
    destroy,
    
    // Core
    show,
    dismiss,
    
    // Convenience
    success,
    error,
    info,
    warning,
    
    // Utilities
    clearAll,
    getCount,
    getQueueCount,
    isDisplayed,
    dismissByMessage,
    dismissById,
    updateMessage,
    
    // Constants (read-only)
    get MAX_TOASTS() { return MAX_TOASTS; },
    get DEFAULT_DURATION() { return DEFAULT_DURATION; },
    get FADE_DURATION() { return FADE_DURATION; }
};

// Add toast events to Events if not present
// This allows other modules to listen for toast events
if (typeof Events !== 'undefined') {
    if (!Events.TOAST_SHOW) {
        console.warn('[Toast] Events.TOAST_SHOW not defined in event-bus.js');
    }
    if (!Events.TOAST_DISMISS) {
        console.warn('[Toast] Events.TOAST_DISMISS not defined in event-bus.js');
    }
}
