/**
 * RSVP Reader - Theme Manager Module
 * 
 * Handles theme switching, accent colors, and provides extensibility
 * for custom themes in the future.
 * 
 * Features:
 * - Dark/Light theme switching
 * - System preference detection (prefers-color-scheme)
 * - Accent color management
 * - Custom theme registration (future extensibility)
 * - CSS variable manipulation
 * - EventBus integration for cross-module communication
 * - Automatic system preference change detection
 * 
 * Usage:
 *   import { Theme } from './theme.js';
 *   Theme.init();
 *   Theme.toggle();
 *   Theme.setAccent('blue');
 *   
 *   // Future: Custom themes
 *   Theme.registerTheme('custom-dark', { ... });
 *   Theme.apply('custom-dark');
 */

import { State } from './state-manager.js';
import { DOM } from './dom-cache.js';
import { Toast } from './toast.js';
import { EventBus, Events } from './event-bus.js';

// ============================================
// THEME CONFIGURATION
// ============================================

/**
 * Built-in theme definitions
 * Each theme defines CSS variable overrides
 * @type {Object<string, ThemeDefinition>}
 */
const BUILT_IN_THEMES = {
    dark: {
        id: 'dark',
        name: 'Dark',
        type: 'dark', // 'dark' or 'light' for system contrast
        metaColor: '#0a0a0b',
        icon: '#icon-moon',
        // CSS variables are defined in app.css via [data-theme="dark"]
        // Custom themes can override these programmatically
        variables: null
    },
    light: {
        id: 'light',
        name: 'Light',
        type: 'light',
        metaColor: '#ffffff',
        icon: '#icon-sun',
        variables: null
    }
};

/**
 * Available accent colors with their color values
 * @type {Object<string, AccentColorDefinition>}
 */
const ACCENT_COLORS = {
    orange: {
        id: 'orange',
        name: 'Orange',
        primary: '#f97316',
        hover: '#fb923c',
        subtle: 'rgba(249, 115, 22, 0.15)',
        muted: 'rgba(249, 115, 22, 0.08)'
    },
    red: {
        id: 'red',
        name: 'Red',
        primary: '#ef4444',
        hover: '#f87171',
        subtle: 'rgba(239, 68, 68, 0.15)',
        muted: 'rgba(239, 68, 68, 0.08)'
    },
    blue: {
        id: 'blue',
        name: 'Blue',
        primary: '#3b82f6',
        hover: '#60a5fa',
        subtle: 'rgba(59, 130, 246, 0.15)',
        muted: 'rgba(59, 130, 246, 0.08)'
    },
    green: {
        id: 'green',
        name: 'Green',
        primary: '#22c55e',
        hover: '#4ade80',
        subtle: 'rgba(34, 197, 94, 0.15)',
        muted: 'rgba(34, 197, 94, 0.08)'
    },
    purple: {
        id: 'purple',
        name: 'Purple',
        primary: '#a855f7',
        hover: '#c084fc',
        subtle: 'rgba(168, 85, 247, 0.15)',
        muted: 'rgba(168, 85, 247, 0.08)'
    },
    pink: {
        id: 'pink',
        name: 'Pink',
        primary: '#ec4899',
        hover: '#f472b6',
        subtle: 'rgba(236, 72, 153, 0.15)',
        muted: 'rgba(236, 72, 153, 0.08)'
    }
};

/**
 * Default values
 */
const DEFAULTS = {
    theme: 'dark',
    accent: 'orange',
    followSystem: false,
    transitionDuration: 200 // ms
};

// ============================================
// TYPE DEFINITIONS (JSDoc)
// ============================================

/**
 * @typedef {Object} ThemeDefinition
 * @property {string} id - Unique theme identifier
 * @property {string} name - Display name
 * @property {'dark'|'light'} type - Base type for contrast calculations
 * @property {string} metaColor - Color for mobile browser chrome
 * @property {string} [icon] - SVG icon href for theme button
 * @property {Object<string, string>|null} variables - CSS variable overrides
 */

/**
 * @typedef {Object} AccentColorDefinition
 * @property {string} id - Unique color identifier
 * @property {string} name - Display name
 * @property {string} primary - Primary accent color
 * @property {string} hover - Hover state color
 * @property {string} subtle - Subtle background color
 * @property {string} muted - Muted background color
 */

/**
 * @typedef {Object} ThemeState
 * @property {string} theme - Current theme ID
 * @property {string} accent - Current accent color ID
 * @property {boolean} followSystem - Whether to follow system preference
 */

// ============================================
// THEME MANAGER CLASS
// ============================================

/**
 * Theme Manager Class
 * Manages theme state, application, and provides extensibility
 */
class ThemeManagerClass {
    constructor() {
        /** @type {boolean} */
        this._initialized = false;
        
        /** @type {Map<string, ThemeDefinition>} */
        this._themes = new Map();
        
        /** @type {Map<string, AccentColorDefinition>} */
        this._accents = new Map();
        
        /** @type {MediaQueryList|null} */
        this._systemPreferenceQuery = null;
        
        /** @type {Function|null} */
        this._systemPreferenceHandler = null;
        
        /** @type {boolean} */
        this._colorPickerBound = false;
        
        /** @type {Function|null} */
        this._stateUnsubscribe = null;
        
        // Register built-in themes and accents
        this._registerBuiltIns();
    }

    /**
     * Register built-in themes and accent colors
     * @private
     */
    _registerBuiltIns() {
        // Register built-in themes
        for (const [id, theme] of Object.entries(BUILT_IN_THEMES)) {
            this._themes.set(id, { ...theme });
        }
        
        // Register built-in accent colors
        for (const [id, accent] of Object.entries(ACCENT_COLORS)) {
            this._accents.set(id, { ...accent });
        }
    }

    /**
     * Initialize the theme manager
     * @param {Object} [options] - Initialization options
     * @param {boolean} [options.followSystem=false] - Follow system preference
     * @param {boolean} [options.enableTransitions=true] - Enable theme transitions
     * @returns {ThemeManagerClass}
     */
    init(options = {}) {
        if (this._initialized) {
            return this;
        }
        
        const { followSystem = false, enableTransitions = true } = options;
        
        // Get saved state
        const savedTheme = State.get('theme');
        const savedAccent = State.get('accentColor');
        const savedFollowSystem = State.get('themeFollowSystem');
        
        // Determine if we should follow system
        const shouldFollowSystem = savedFollowSystem !== undefined 
            ? savedFollowSystem 
            : followSystem;
        
        // Set up system preference detection
        this._setupSystemPreferenceDetection();
        
        // Determine initial theme
        let initialTheme;
        if (shouldFollowSystem) {
            initialTheme = this._getSystemPreference();
            State.set('themeFollowSystem', true);
        } else {
            initialTheme = savedTheme || DEFAULTS.theme;
        }
        
        // Determine initial accent
        const initialAccent = savedAccent || DEFAULTS.accent;
        
        // Apply theme without transition on init
        if (enableTransitions) {
            this._disableTransitions();
        }
        
        this._applyTheme(initialTheme, false);
        this._applyAccent(initialAccent, false);
        
        // Re-enable transitions after a frame
        if (enableTransitions) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this._enableTransitions();
                });
            });
        }
        
        // Subscribe to state changes from other modules
        this._stateUnsubscribe = State.subscribe('theme', (newTheme) => {
            if (newTheme !== this.getCurrent()) {
                this._applyTheme(newTheme, true);
            }
        });
        
        this._initialized = true;
        
        return this;
    }

    /**
     * Set up system preference detection
     * @private
     */
    _setupSystemPreferenceDetection() {
        if (typeof window === 'undefined' || !window.matchMedia) {
            return;
        }
        
        this._systemPreferenceQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        this._systemPreferenceHandler = (e) => {
            if (State.get('themeFollowSystem')) {
                const newTheme = e.matches ? 'dark' : 'light';
                this._applyTheme(newTheme, true);
                State.set('theme', newTheme);
                EventBus.emit(Events.THEME_CHANGED, { 
                    theme: newTheme, 
                    source: 'system' 
                });
            }
        };
        
        // Modern browsers
        if (this._systemPreferenceQuery.addEventListener) {
            this._systemPreferenceQuery.addEventListener('change', this._systemPreferenceHandler);
        } else if (this._systemPreferenceQuery.addListener) {
            // Legacy Safari
            this._systemPreferenceQuery.addListener(this._systemPreferenceHandler);
        }
    }

    /**
     * Get system color scheme preference
     * @private
     * @returns {string} 'dark' or 'light'
     */
    _getSystemPreference() {
        if (this._systemPreferenceQuery) {
            return this._systemPreferenceQuery.matches ? 'dark' : 'light';
        }
        return DEFAULTS.theme;
    }

    /**
     * Disable CSS transitions temporarily
     * @private
     */
    _disableTransitions() {
        document.documentElement.classList.add('no-transitions');
    }

    /**
     * Enable CSS transitions
     * @private
     */
    _enableTransitions() {
        document.documentElement.classList.remove('no-transitions');
    }

    /**
     * Apply a theme
     * @private
     * @param {string} themeId - Theme identifier
     * @param {boolean} [emit=true] - Emit change event
     */
    _applyTheme(themeId, emit = true) {
        const theme = this._themes.get(themeId);
        
        if (!theme) {
            console.warn(`[Theme] Invalid theme: ${themeId}, falling back to ${DEFAULTS.theme}`);
            this._applyTheme(DEFAULTS.theme, emit);
            return;
        }
        
        // Set data attribute for CSS
        document.documentElement.setAttribute('data-theme', themeId);
        
        // Apply custom CSS variables if defined
        if (theme.variables) {
            this._applyCSSVariables(theme.variables);
        }
        
        // Update theme button icon
        this._updateThemeButtonIcon(theme);
        
        // Update meta theme-color
        this._updateMetaThemeColor(theme.metaColor);
        
        // Store in state
        State.set('theme', themeId);
        
        // Emit event
        if (emit) {
            EventBus.emit(Events.THEME_CHANGED, { 
                theme: themeId, 
                definition: theme,
                source: 'user' 
            });
        }
    }

    /**
     * Apply accent color
     * @private
     * @param {string} accentId - Accent color identifier
     * @param {boolean} [showToast=true] - Show confirmation toast
     */
    _applyAccent(accentId, showToast = true) {
        const accent = this._accents.get(accentId);
        
        if (!accent) {
            console.warn(`[Theme] Invalid accent color: ${accentId}`);
            return;
        }
        
        // Set data attribute for CSS
        document.documentElement.setAttribute('data-accent', accentId);
        
        // Also apply CSS variables for programmatic access
        const root = document.documentElement;
        root.style.setProperty('--color-accent', accent.primary);
        root.style.setProperty('--color-accent-hover', accent.hover);
        root.style.setProperty('--color-accent-subtle', accent.subtle);
        root.style.setProperty('--color-accent-muted', accent.muted);
        
        // Store in state
        State.set('accentColor', accentId);
        
        // Update color picker UI
        this._updateColorPickerUI(accentId);
        
        // Show toast
        if (showToast && Toast) {
            Toast.success(`Accent color: ${accent.name}`);
        }
        
        // Emit event
        EventBus.emit(Events.ACCENT_CHANGED, { 
            accent: accentId, 
            definition: accent 
        });
    }

    /**
     * Apply CSS variables to document root
     * @private
     * @param {Object<string, string>} variables - CSS variable map
     */
    _applyCSSVariables(variables) {
        const root = document.documentElement;
        for (const [name, value] of Object.entries(variables)) {
            // Ensure variable name starts with --
            const varName = name.startsWith('--') ? name : `--${name}`;
            root.style.setProperty(varName, value);
        }
    }

    /**
     * Update theme button icon
     * @private
     * @param {ThemeDefinition} theme - Theme definition
     */
    _updateThemeButtonIcon(theme) {
        const btnTheme = DOM.get('btnTheme');
        if (!btnTheme) return;
        
        const useEl = btnTheme.querySelector('use');
        if (useEl && theme.icon) {
            useEl.setAttribute('href', theme.icon);
        }
        
        // Update aria-label for accessibility
        btnTheme.setAttribute('aria-label', `Current theme: ${theme.name}. Click to toggle.`);
    }

    /**
     * Update meta theme-color for mobile browsers
     * @private
     * @param {string} color - Color value
     */
    _updateMetaThemeColor(color) {
        let meta = document.querySelector('meta[name="theme-color"]');
        
        // Create meta tag if it doesn't exist
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
            document.head.appendChild(meta);
        }
        
        meta.setAttribute('content', color);
    }

    /**
     * Update color picker UI
     * @private
     * @param {string} activeColor - Active color ID
     */
    _updateColorPickerUI(activeColor) {
        const colorPickerGroup = DOM.get('colorPickerGroup');
        if (!colorPickerGroup) return;
        
        colorPickerGroup.querySelectorAll('.color-swatch').forEach(swatch => {
            const isActive = swatch.dataset.color === activeColor;
            swatch.classList.toggle('active', isActive);
            swatch.setAttribute('aria-checked', String(isActive));
        });
    }

    // ============================================
    // PUBLIC API
    // ============================================

    /**
     * Toggle between dark and light themes
     * @returns {string} The new theme ID
     */
    toggle() {
        const current = this.getCurrent();
        const currentTheme = this._themes.get(current);
        
        // Toggle based on current theme type
        const newThemeId = currentTheme?.type === 'dark' ? 'light' : 'dark';
        
        // Disable follow system when manually toggling
        if (State.get('themeFollowSystem')) {
            State.set('themeFollowSystem', false);
        }
        
        this._applyTheme(newThemeId, true);
        
        return newThemeId;
    }

    /**
     * Apply a specific theme
     * @param {string} themeId - Theme identifier
     */
    apply(themeId) {
        if (!this._themes.has(themeId)) {
            console.warn(`[Theme] Unknown theme: ${themeId}`);
            return;
        }
        
        // Disable follow system when manually setting
        if (State.get('themeFollowSystem')) {
            State.set('themeFollowSystem', false);
        }
        
        this._applyTheme(themeId, true);
    }

    /**
     * Set accent color
     * @param {string} colorId - Accent color identifier
     * @param {boolean} [showToast=true] - Show confirmation toast
     */
    setAccent(colorId, showToast = true) {
        if (!this._accents.has(colorId)) {
            console.warn(`[Theme] Unknown accent color: ${colorId}`);
            return;
        }
        
        this._applyAccent(colorId, showToast);
    }

    /**
     * Get current theme ID
     * @returns {string}
     */
    getCurrent() {
        return State.get('theme') || DEFAULTS.theme;
    }

    /**
     * Get current theme definition
     * @returns {ThemeDefinition|undefined}
     */
    getCurrentTheme() {
        return this._themes.get(this.getCurrent());
    }

    /**
     * Check if current theme is dark
     * @returns {boolean}
     */
    isDark() {
        const theme = this.getCurrentTheme();
        return theme?.type === 'dark';
    }

    /**
     * Check if current theme is light
     * @returns {boolean}
     */
    isLight() {
        const theme = this.getCurrentTheme();
        return theme?.type === 'light';
    }

    /**
     * Get current accent color ID
     * @returns {string}
     */
    getAccent() {
        return State.get('accentColor') || DEFAULTS.accent;
    }

    /**
     * Get current accent color definition
     * @returns {AccentColorDefinition|undefined}
     */
    getAccentColor() {
        return this._accents.get(this.getAccent());
    }

    /**
     * Get all available theme IDs
     * @returns {string[]}
     */
    getThemes() {
        return Array.from(this._themes.keys());
    }

    /**
     * Get all theme definitions
     * @returns {ThemeDefinition[]}
     */
    getThemeDefinitions() {
        return Array.from(this._themes.values());
    }

    /**
     * Get all available accent color IDs
     * @returns {string[]}
     */
    getAccentColors() {
        return Array.from(this._accents.keys());
    }

    /**
     * Get all accent color definitions
     * @returns {AccentColorDefinition[]}
     */
    getAccentColorDefinitions() {
        return Array.from(this._accents.values());
    }

    /**
     * Set whether to follow system preference
     * @param {boolean} follow - Whether to follow system
     */
    setFollowSystem(follow) {
        State.set('themeFollowSystem', follow);
        
        if (follow) {
            const systemTheme = this._getSystemPreference();
            this._applyTheme(systemTheme, true);
        }
    }

    /**
     * Check if following system preference
     * @returns {boolean}
     */
    isFollowingSystem() {
        return State.get('themeFollowSystem') === true;
    }

    /**
     * Get system color scheme preference
     * @returns {'dark'|'light'}
     */
    getSystemPreference() {
        return this._getSystemPreference();
    }

    // ============================================
    // THEME REGISTRATION (FUTURE EXTENSIBILITY)
    // ============================================

    /**
     * Register a custom theme
     * @param {string} id - Unique theme identifier
     * @param {Partial<ThemeDefinition>} definition - Theme definition
     * @returns {boolean} True if registered successfully
     */
    registerTheme(id, definition) {
        if (!id || typeof id !== 'string') {
            console.error('[Theme] Theme ID must be a non-empty string');
            return false;
        }
        
        if (this._themes.has(id)) {
            console.warn(`[Theme] Theme "${id}" already exists, use updateTheme() to modify`);
            return false;
        }
        
        // Validate required fields
        const requiredFields = ['name', 'type', 'metaColor'];
        for (const field of requiredFields) {
            if (!definition[field]) {
                console.error(`[Theme] Theme definition missing required field: ${field}`);
                return false;
            }
        }
        
        // Validate type
        if (definition.type !== 'dark' && definition.type !== 'light') {
            console.error('[Theme] Theme type must be "dark" or "light"');
            return false;
        }
        
        const theme = {
            id,
            name: definition.name,
            type: definition.type,
            metaColor: definition.metaColor,
            icon: definition.icon || (definition.type === 'dark' ? '#icon-moon' : '#icon-sun'),
            variables: definition.variables || null
        };
        
        this._themes.set(id, theme);
        
        EventBus.emit(Events.THEME_REGISTERED, { theme });
        
        return true;
    }

    /**
     * Update an existing theme
     * @param {string} id - Theme identifier
     * @param {Partial<ThemeDefinition>} updates - Fields to update
     * @returns {boolean} True if updated successfully
     */
    updateTheme(id, updates) {
        const existing = this._themes.get(id);
        if (!existing) {
            console.warn(`[Theme] Theme "${id}" not found`);
            return false;
        }
        
        // Merge updates
        const updated = { ...existing, ...updates, id }; // Prevent ID change
        
        // Validate type if changed
        if (updates.type && updates.type !== 'dark' && updates.type !== 'light') {
            console.error('[Theme] Theme type must be "dark" or "light"');
            return false;
        }
        
        this._themes.set(id, updated);
        
        // Re-apply if this is the current theme
        if (this.getCurrent() === id) {
            this._applyTheme(id, true);
        }
        
        return true;
    }

    /**
     * Unregister a custom theme
     * @param {string} id - Theme identifier
     * @returns {boolean} True if unregistered successfully
     */
    unregisterTheme(id) {
        // Prevent removing built-in themes
        if (BUILT_IN_THEMES[id]) {
            console.warn(`[Theme] Cannot unregister built-in theme: ${id}`);
            return false;
        }
        
        if (!this._themes.has(id)) {
            return false;
        }
        
        // Switch to default if removing current theme
        if (this.getCurrent() === id) {
            this._applyTheme(DEFAULTS.theme, true);
        }
        
        this._themes.delete(id);
        
        return true;
    }

    /**
     * Register a custom accent color
     * @param {string} id - Unique color identifier
     * @param {AccentColorDefinition} definition - Color definition
     * @returns {boolean} True if registered successfully
     */
    registerAccentColor(id, definition) {
        if (!id || typeof id !== 'string') {
            console.error('[Theme] Accent color ID must be a non-empty string');
            return false;
        }
        
        if (this._accents.has(id)) {
            console.warn(`[Theme] Accent color "${id}" already exists`);
            return false;
        }
        
        // Validate required fields
        const requiredFields = ['name', 'primary', 'hover', 'subtle', 'muted'];
        for (const field of requiredFields) {
            if (!definition[field]) {
                console.error(`[Theme] Accent color definition missing required field: ${field}`);
                return false;
            }
        }
        
        const accent = {
            id,
            name: definition.name,
            primary: definition.primary,
            hover: definition.hover,
            subtle: definition.subtle,
            muted: definition.muted
        };
        
        this._accents.set(id, accent);
        
        return true;
    }

    // ============================================
    // CSS VARIABLE UTILITIES
    // ============================================

    /**
     * Get a CSS variable value
     * @param {string} name - Variable name (with or without --)
     * @returns {string} Variable value
     */
    getCSSVariable(name) {
        const varName = name.startsWith('--') ? name : `--${name}`;
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    }

    /**
     * Set a CSS variable
     * @param {string} name - Variable name (with or without --)
     * @param {string} value - Variable value
     */
    setCSSVariable(name, value) {
        const varName = name.startsWith('--') ? name : `--${name}`;
        document.documentElement.style.setProperty(varName, value);
    }

    /**
     * Remove a CSS variable override (revert to CSS-defined value)
     * @param {string} name - Variable name (with or without --)
     */
    removeCSSVariable(name) {
        const varName = name.startsWith('--') ? name : `--${name}`;
        document.documentElement.style.removeProperty(varName);
    }

    /**
     * Get all theme-related CSS variables
     * @returns {Object<string, string>}
     */
    getAllCSSVariables() {
        const styles = getComputedStyle(document.documentElement);
        const variables = {};
        
        // Get all custom properties
        for (const prop of styles) {
            if (prop.startsWith('--color-') || prop.startsWith('--bg-')) {
                variables[prop] = styles.getPropertyValue(prop).trim();
            }
        }
        
        return variables;
    }

    // ============================================
    // EVENT BINDING
    // ============================================

    /**
     * Bind color picker click events
     * Should be called after DOM is ready
     */
    bindColorPicker() {
        if (this._colorPickerBound) {
            return; // Prevent duplicate binding
        }
        
        const colorPickerGroup = DOM.get('colorPickerGroup');
        if (!colorPickerGroup) return;
        
        colorPickerGroup.addEventListener('click', (e) => {
            const swatch = e.target.closest('.color-swatch');
            if (!swatch) return;
            
            const color = swatch.dataset.color;
            if (color && this._accents.has(color)) {
                this.setAccent(color);
            }
        });
        
        // Also support keyboard navigation
        colorPickerGroup.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const swatch = e.target.closest('.color-swatch');
                if (!swatch) return;
                
                e.preventDefault();
                const color = swatch.dataset.color;
                if (color && this._accents.has(color)) {
                    this.setAccent(color);
                }
            }
        });
        
        this._colorPickerBound = true;
    }

    // ============================================
    // CLEANUP
    // ============================================

    /**
     * Clean up resources
     */
    destroy() {
        // Remove system preference listener
        if (this._systemPreferenceQuery && this._systemPreferenceHandler) {
            if (this._systemPreferenceQuery.removeEventListener) {
                this._systemPreferenceQuery.removeEventListener('change', this._systemPreferenceHandler);
            } else if (this._systemPreferenceQuery.removeListener) {
                this._systemPreferenceQuery.removeListener(this._systemPreferenceHandler);
            }
        }
        
        // Unsubscribe from state
        if (this._stateUnsubscribe) {
            this._stateUnsubscribe();
            this._stateUnsubscribe = null;
        }
        
        this._systemPreferenceQuery = null;
        this._systemPreferenceHandler = null;
        this._colorPickerBound = false;
        this._initialized = false;
    }

    // ============================================
    // CONVENIENCE ALIASES
    // ============================================

    /**
     * Alias for backwards compatibility
     * @deprecated Use _updateColorPickerUI internally
     */
    updateColorPickerUI(activeColor) {
        this._updateColorPickerUI(activeColor);
    }
}

// ============================================
// SINGLETON EXPORT
// ============================================

/** Singleton instance */
const Theme = new ThemeManagerClass();

// Export both the singleton and the class (for testing)
export { Theme, ThemeManagerClass };

// Also export constants for external use
export const THEMES = {
    DARK: 'dark',
    LIGHT: 'light'
};

export { ACCENT_COLORS, BUILT_IN_THEMES, DEFAULTS as THEME_DEFAULTS };
