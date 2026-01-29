/**
 * RSVP Reader - EventBus Module
 * Lightweight pub/sub system for decoupled module communication.
 * No dependencies on other app modules.
 * 
 * Features:
 * - Subscribe/unsubscribe to named events
 * - One-time event handlers
 * - Error isolation (one handler error doesn't break others)
 * - Memory leak detection (max listeners warning)
 * - Debug mode for development
 * 
 * Note: Handlers are stored in Sets, so registering the same function
 * twice for the same event will only call it once.
 */

/**
 * @typedef {function(...any): void} EventHandler
 */

/** @type {number} Default max listeners before warning (helps detect memory leaks) */
const DEFAULT_MAX_LISTENERS = 10;

/**
 * Event Bus for module communication
 * Provides publish/subscribe pattern to decouple modules.
 * 
 * @example
 * // Subscribe to an event
 * const unsubscribe = EventBus.on('wpm:changed', (newWpm) => {
 *     console.log('WPM changed to:', newWpm);
 * });
 * 
 * // Emit an event
 * EventBus.emit('wpm:changed', 350);
 * 
 * // Unsubscribe when done
 * unsubscribe();
 */
class EventBusClass {
    constructor() {
        /** @type {Map<string, Set<EventHandler>>} */
        this._events = new Map();
        
        /** @type {Map<string, Set<EventHandler>>} */
        this._onceEvents = new Map();

        /** @type {number} Max listeners before warning */
        this._maxListeners = DEFAULT_MAX_LISTENERS;

        /** @type {boolean} Debug mode flag */
        this._debug = false;

        /** @type {Set<string>} Events that have already warned about max listeners */
        this._warnedEvents = new Set();
    }

    /**
     * Validate event name
     * @private
     * @param {string} event - Event name to validate
     * @param {string} methodName - Method name for error message
     * @returns {boolean} True if valid
     */
    _validateEvent(event, methodName) {
        if (typeof event !== 'string' || event.length === 0) {
            console.error(`EventBus.${methodName}: event must be a non-empty string, got ${typeof event === 'string' ? '""' : typeof event}`);
            return false;
        }
        return true;
    }

    /**
     * Check and warn if max listeners exceeded
     * @private
     * @param {string} event - Event name
     */
    _checkMaxListeners(event) {
        const count = this.subscriberCount(event);
        if (count > this._maxListeners && !this._warnedEvents.has(event)) {
            this._warnedEvents.add(event);
            console.warn(
                `EventBus: Possible memory leak detected. Event "${event}" has ${count} listeners. ` +
                `Use setMaxListeners() to increase limit if this is intentional.`
            );
        }
    }

    /**
     * Clean up empty handler Sets to prevent memory leaks
     * @private
     * @param {string} event - Event name
     */
    _cleanupEvent(event) {
        if (this._events.has(event) && this._events.get(event).size === 0) {
            this._events.delete(event);
        }
        if (this._onceEvents.has(event) && this._onceEvents.get(event).size === 0) {
            this._onceEvents.delete(event);
        }
        // Clear from warned set if no more listeners
        if (!this.hasSubscribers(event)) {
            this._warnedEvents.delete(event);
        }
    }

    /**
     * Log debug message if debug mode is enabled
     * @private
     * @param {string} action - Action being performed
     * @param {string} event - Event name
     * @param {any[]} [args] - Optional arguments
     */
    _log(action, event, args = []) {
        if (this._debug) {
            const argsStr = args.length > 0 ? ` with args: ${JSON.stringify(args).slice(0, 100)}` : '';
            console.debug(`EventBus [${action}] "${event}"${argsStr}`);
        }
    }

    /**
     * Enable or disable debug mode
     * @param {boolean} enabled - Whether to enable debug mode
     */
    setDebug(enabled) {
        this._debug = Boolean(enabled);
        if (this._debug) {
            console.info('EventBus: Debug mode enabled');
        }
    }

    /**
     * Set maximum listeners before warning
     * @param {number} n - Maximum number of listeners (0 = unlimited)
     */
    setMaxListeners(n) {
        this._maxListeners = Math.max(0, Math.floor(n)) || Infinity;
    }

    /**
     * Get maximum listeners setting
     * @returns {number}
     */
    getMaxListeners() {
        return this._maxListeners;
    }

    /**
     * Subscribe to an event
     * @param {string} event - Event name (e.g., 'engine:play', 'settings:changed')
     * @param {EventHandler} handler - Callback function
     * @returns {function(): void} Unsubscribe function
     */
    on(event, handler) {
        if (!this._validateEvent(event, 'on')) {
            return () => {};
        }

        if (typeof handler !== 'function') {
            console.error(`EventBus.on: handler must be a function, got ${typeof handler}`);
            return () => {};
        }

        if (!this._events.has(event)) {
            this._events.set(event, new Set());
        }
        
        this._events.get(event).add(handler);
        this._log('subscribe', event);
        this._checkMaxListeners(event);

        // Return unsubscribe function
        return () => this.off(event, handler);
    }

    /**
     * Subscribe to an event only once
     * @param {string} event - Event name
     * @param {EventHandler} handler - Callback function
     * @returns {function(): void} Unsubscribe function
     */
    once(event, handler) {
        if (!this._validateEvent(event, 'once')) {
            return () => {};
        }

        if (typeof handler !== 'function') {
            console.error(`EventBus.once: handler must be a function, got ${typeof handler}`);
            return () => {};
        }

        if (!this._onceEvents.has(event)) {
            this._onceEvents.set(event, new Set());
        }
        
        this._onceEvents.get(event).add(handler);
        this._log('subscribe-once', event);
        this._checkMaxListeners(event);

        // Return unsubscribe function that uses off() for consistency
        return () => this.off(event, handler);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {EventHandler} handler - The handler to remove
     * @returns {boolean} True if handler was found and removed
     */
    off(event, handler) {
        if (!this._validateEvent(event, 'off')) {
            return false;
        }

        let removed = false;

        // Check regular events
        if (this._events.has(event)) {
            removed = this._events.get(event).delete(handler);
        }
        
        // Also check once events (fixes BUG 1)
        if (this._onceEvents.has(event)) {
            const onceRemoved = this._onceEvents.get(event).delete(handler);
            removed = removed || onceRemoved;
        }

        // Clean up empty Sets (fixes BUG 2)
        if (removed) {
            this._log('unsubscribe', event);
            this._cleanupEvent(event);
        }

        return removed;
    }

    /**
     * Remove a handler from all events
     * @param {EventHandler} handler - The handler to remove from all events
     * @returns {number} Number of events the handler was removed from
     */
    offAll(handler) {
        if (typeof handler !== 'function') {
            console.error(`EventBus.offAll: handler must be a function, got ${typeof handler}`);
            return 0;
        }

        let count = 0;

        // Remove from regular events
        for (const [event, handlers] of this._events) {
            if (handlers.delete(handler)) {
                count++;
                this._cleanupEvent(event);
            }
        }

        // Remove from once events
        for (const [event, handlers] of this._onceEvents) {
            if (handlers.delete(handler)) {
                count++;
                this._cleanupEvent(event);
            }
        }

        if (count > 0) {
            this._log('unsubscribe-all', `${count} events`);
        }

        return count;
    }

    /**
     * Emit an event with optional data
     * @param {string} event - Event name
     * @param {...any} args - Arguments to pass to handlers
     * @returns {boolean} True if event had any listeners
     */
    emit(event, ...args) {
        if (!this._validateEvent(event, 'emit')) {
            return false;
        }

        this._log('emit', event, args);

        let hadListeners = false;

        // Handle regular subscribers
        // Create a copy of handlers to safely iterate even if handlers modify subscriptions
        if (this._events.has(event)) {
            const handlers = Array.from(this._events.get(event));
            hadListeners = handlers.length > 0;
            
            for (const handler of handlers) {
                try {
                    handler(...args);
                } catch (error) {
                    console.error(`EventBus: Error in handler for "${event}":`, error);
                }
            }
        }

        // Handle once subscribers
        if (this._onceEvents.has(event)) {
            const handlers = this._onceEvents.get(event);
            const handlerArray = Array.from(handlers);
            hadListeners = hadListeners || handlerArray.length > 0;
            
            // Delete before calling to prevent re-entry issues
            this._onceEvents.delete(event);
            
            for (const handler of handlerArray) {
                try {
                    handler(...args);
                } catch (error) {
                    console.error(`EventBus: Error in once handler for "${event}":`, error);
                }
            }
        }

        return hadListeners;
    }

    /**
     * Remove all handlers for an event, or all handlers if no event specified
     * @param {string} [event] - Event name (optional)
     */
    clear(event) {
        if (event !== undefined) {
            if (!this._validateEvent(event, 'clear')) {
                return;
            }
            this._events.delete(event);
            this._onceEvents.delete(event);
            this._warnedEvents.delete(event);
            this._log('clear', event);
        } else {
            this._events.clear();
            this._onceEvents.clear();
            this._warnedEvents.clear();
            this._log('clear', 'ALL');
        }
    }

    /**
     * Check if an event has any subscribers
     * @param {string} event - Event name
     * @returns {boolean}
     */
    hasSubscribers(event) {
        return this.subscriberCount(event) > 0;
    }

    /**
     * Get subscriber count for an event
     * @param {string} event - Event name
     * @returns {number}
     */
    subscriberCount(event) {
        const regularCount = this._events.has(event) ? this._events.get(event).size : 0;
        const onceCount = this._onceEvents.has(event) ? this._onceEvents.get(event).size : 0;
        return regularCount + onceCount;
    }

    /**
     * Get all registered event names
     * @returns {string[]}
     */
    getEventNames() {
        const names = new Set([
            ...this._events.keys(),
            ...this._onceEvents.keys()
        ]);
        return Array.from(names);
    }

    /**
     * Get debug statistics about the event bus
     * @returns {{ events: number, totalListeners: number, eventDetails: Object }}
     */
    getStats() {
        const eventDetails = {};
        let totalListeners = 0;

        for (const event of this.getEventNames()) {
            const count = this.subscriberCount(event);
            eventDetails[event] = count;
            totalListeners += count;
        }

        return {
            events: this.getEventNames().length,
            totalListeners,
            eventDetails
        };
    }
}

// Export singleton instance
export const EventBus = new EventBusClass();

// Also export class for testing purposes
export { EventBusClass };

/**
 * Predefined event names for consistency
 * Use these constants instead of string literals for type safety.
 */
export const Events = {
    // Engine events
    ENGINE_PLAY: 'engine:play',
    ENGINE_PAUSE: 'engine:pause',
    ENGINE_RESET: 'engine:reset',
    ENGINE_COMPLETE: 'engine:complete',
    ENGINE_WORD_CHANGE: 'engine:wordChange',
    ENGINE_STATE_CHANGE: 'engine:stateChange',

    // Settings events
    SETTINGS_CHANGED: 'settings:changed',
    SETTINGS_RESET: 'settings:reset',
    THEME_CHANGED: 'settings:themeChanged',
    ACCENT_CHANGED: 'settings:accentChanged',
    THEME_REGISTERED: 'settings:themeRegistered',
    WPM_CHANGED: 'settings:wpmChanged',
    PROFILE_CHANGED: 'settings:profileChanged',

    // Analytics events
    ANALYTICS_UPDATED: 'analytics:updated',
    ANALYTICS_RESET: 'analytics:reset',
    SESSION_START: 'analytics:sessionStart',
    SESSION_END: 'analytics:sessionEnd',
    SESSION_PAUSE: 'analytics:sessionPause',
    SESSION_RESUME: 'analytics:sessionResume',

    // Sound events
    SOUND_PLAY: 'sound:play',
    SOUND_STOP: 'sound:stop',
    SOUND_VOLUME_CHANGE: 'sound:volumeChange',

    // UI events
    UI_READY: 'ui:ready',
    UI_DESTROYED: 'ui:destroyed',
    MODAL_SHOW: 'ui:modalShow',
    MODAL_HIDE: 'ui:modalHide',
    TEXT_LOADED: 'ui:textLoaded',
    TEXT_CLEARED: 'ui:textCleared',
    FOCUS_MODE_ENTER: 'ui:focusModeEnter',
    FOCUS_MODE_EXIT: 'ui:focusModeExit',

    // Toast events
    TOAST_SHOW: 'toast:show',
    TOAST_DISMISS: 'toast:dismiss',

    // Panel events
    PANEL_OPEN: 'panel:open',
    PANEL_CLOSE: 'panel:close',

    // Comprehension events
    COMPREHENSION_CHECK: 'comprehension:check',
    COMPREHENSION_ANSWER: 'comprehension:answer',

    // Library events
    LIBRARY_ITEM_ADDED: 'library:itemAdded',
    LIBRARY_ITEM_REMOVED: 'library:itemRemoved',
    LIBRARY_ITEM_LOADED: 'library:itemLoaded',

    // Keyboard events
    SHORTCUT_TRIGGERED: 'keyboard:shortcutTriggered',
    SHORTCUT_CHANGED: 'keyboard:shortcutChanged',

    // Speed training events
    SPEED_TRAINING_INCREMENT: 'speedTraining:increment',
    SPEED_TRAINING_COMPLETE: 'speedTraining:complete',

    // Error events
    ERROR: 'app:error',
    WARNING: 'app:warning'
};

Object.freeze(Events);

