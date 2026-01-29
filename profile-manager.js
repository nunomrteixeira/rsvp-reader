/**
 * RSVP Reader - Profile Manager Module
 * Manages reading profiles (presets) and custom settings.
 * Handles profile switching, custom profile saving, and settings synchronization.
 */

import { PROFILES, DEFAULTS, CONFIG } from './config.js';
import { State } from './state-manager.js';
import { EventBus, Events } from './event-bus.js';
import { cacheSettings as cacheTimingSettings } from './timing-manager.js';
import { cacheSettings as cacheComprehensionSettings } from './comprehension.js';

/**
 * Settings keys that are part of profiles (defined once to avoid duplication)
 * IMPORTANT: This MUST include ALL settings used in ANY profile in config.js
 * Missing keys will cause profile detection and custom settings save/restore to fail
 * @type {string[]}
 */
const PROFILE_SETTING_KEYS = [
    // Reading speed
    'wpm', 
    'chunkSize',
    
    // Display features
    'orpEnabled',
    'bionicMode',           // Used in dyslexia profile
    'peripheralPreview',
    'fontFamily',           // Used in dyslexia profile
    'fontSize',             // Used in dyslexia profile
    
    // Timing
    'fixedTiming', 
    'punctuationPauses', 
    'pauseDuration',
    'warmupEnabled',
    'warmupDuration',       // Used in ALL profiles
    
    // Comprehension
    'comprehensionEnabled', 
    'comprehensionInterval'
];

/**
 * @typedef {Object} ProfileInfo
 * @property {string} id - Profile identifier
 * @property {string} name - Display name
 * @property {string} description - Profile description
 * @property {string} color - Theme color for UI
 * @property {boolean} isCustom - Whether this is the custom profile
 * @property {boolean} isActive - Whether this profile is currently active
 */

/**
 * Profile Manager Class
 * Singleton that manages reading profiles.
 */
class ProfileManagerClass {
    constructor() {
        /** @type {string} */
        this._activeProfileId = 'custom';
        
        /** @type {Object|null} */
        this._customSettings = null;
        
        /** @type {boolean} */
        this._initialized = false;
        
        /** @type {function[]} Unsubscribe functions for cleanup */
        this._unsubscribers = [];
    }

    /**
     * Initialize the profile manager
     * Should be called after State.init()
     */
    init() {
        if (this._initialized) {
            return this;
        }
        
        // Load active profile from state with validation
        const storedProfile = State.get('activeProfile');
        
        // Validate that the stored profile actually exists
        if (storedProfile && PROFILES[storedProfile]) {
            this._activeProfileId = storedProfile;
        } else {
            // Fall back to custom if stored profile is invalid
            this._activeProfileId = 'custom';
            if (storedProfile && storedProfile !== 'custom') {
                console.warn(`ProfileManager: Invalid stored profile "${storedProfile}", falling back to custom`);
                State.set('activeProfile', 'custom', true);
            }
        }
        
        // Subscribe to relevant state changes to detect custom modifications
        this._subscribeToChanges();
        
        this._initialized = true;
        return this;
    }

    /**
     * Subscribe to state changes that affect profile status
     * @private
     */
    _subscribeToChanges() {
        // Use the constant instead of duplicating the list
        PROFILE_SETTING_KEYS.forEach(key => {
            const unsubscribe = State.subscribe(key, () => {
                // If user changes a setting while on a preset profile,
                // switch to custom profile
                if (this._activeProfileId !== 'custom') {
                    const profile = PROFILES[this._activeProfileId];
                    if (profile && profile.settings) {
                        const currentValue = State.get(key);
                        const profileValue = profile.settings[key];
                        
                        // If value differs from profile, switch to custom
                        if (profileValue !== undefined && currentValue !== profileValue) {
                            this._switchToCustom();
                        }
                    }
                }
            });
            
            // Store unsubscribe function for cleanup
            this._unsubscribers.push(unsubscribe);
        });
    }

    /**
     * Switch to custom profile when user modifies a setting
     * @private
     */
    _switchToCustom() {
        this._activeProfileId = 'custom';
        State.set('activeProfile', 'custom', true);
        
        // Emit event so UI can update (e.g., profile dropdown)
        // This is important - without it, UI would still show the old profile name
        EventBus.emit(Events.PROFILE_CHANGED, { 
            profileId: 'custom',
            reason: 'setting_modified'  // Indicates this was an automatic switch
        });
    }

    /**
     * Get list of all available profiles
     * @returns {ProfileInfo[]}
     */
    getProfiles() {
        return Object.entries(PROFILES).map(([id, profile]) => ({
            id,
            name: profile?.name || id,
            description: profile?.description || '',
            color: profile?.color || '#888888',
            isCustom: id === 'custom',
            isActive: id === this._activeProfileId
        }));
    }

    /**
     * Get a specific profile by ID
     * @param {string} profileId
     * @returns {ProfileInfo|null}
     */
    getProfile(profileId) {
        // Validate input
        if (!profileId || typeof profileId !== 'string') {
            return null;
        }
        
        const profile = PROFILES[profileId];
        if (!profile) return null;
        
        return {
            id: profileId,
            name: profile?.name || profileId,
            description: profile?.description || '',
            color: profile?.color || '#888888',
            isCustom: profileId === 'custom',
            isActive: profileId === this._activeProfileId
        };
    }

    /**
     * Get the currently active profile
     * @returns {ProfileInfo} Always returns a valid profile (falls back to custom)
     */
    getActiveProfile() {
        const profile = this.getProfile(this._activeProfileId);
        
        // Fallback to custom if active profile is somehow invalid
        if (!profile) {
            console.warn(`ProfileManager: Active profile "${this._activeProfileId}" not found, falling back to custom`);
            this._activeProfileId = 'custom';
            return this.getProfile('custom');
        }
        
        return profile;
    }

    /**
     * Get the active profile ID
     * @returns {string}
     */
    getActiveProfileId() {
        return this._activeProfileId;
    }

    /**
     * Apply a profile's settings
     * @param {string} profileId - Profile ID to apply
     * @returns {boolean} True if successful
     */
    applyProfile(profileId) {
        // Validate input
        if (!profileId || typeof profileId !== 'string') {
            console.error('ProfileManager: applyProfile requires a valid profile ID');
            return false;
        }
        
        const profile = PROFILES[profileId];
        
        if (!profile) {
            console.error(`ProfileManager: Unknown profile "${profileId}"`);
            return false;
        }
        
        // Custom profile uses current settings
        if (profileId === 'custom') {
            this._activeProfileId = 'custom';
            State.set('activeProfile', 'custom', true);
            EventBus.emit(Events.PROFILE_CHANGED, { profileId: 'custom' });
            return true;
        }
        
        // Apply profile settings
        if (profile.settings) {
            // Save current settings as custom before switching
            if (this._activeProfileId === 'custom') {
                this._saveCurrentAsCustom();
            }
            
            // Reset dyslexia-specific settings to defaults unless profile specifies them
            // This prevents dyslexia's large font and bionic mode from persisting to other profiles
            const settingsToApply = { ...profile.settings };
            if (!('fontSize' in settingsToApply)) {
                settingsToApply.fontSize = CONFIG.FONT_SIZE.DEFAULT;
            }
            if (!('fontFamily' in settingsToApply)) {
                settingsToApply.fontFamily = 'serif';
            }
            if (!('bionicMode' in settingsToApply)) {
                settingsToApply.bionicMode = false;
            }
            
            // Apply all profile settings at once
            State.setMultiple(settingsToApply, true);
        }
        
        this._activeProfileId = profileId;
        State.set('activeProfile', profileId, true);
        
        // Update caches
        cacheTimingSettings();
        cacheComprehensionSettings();
        
        EventBus.emit(Events.PROFILE_CHANGED, { 
            profileId,
            settings: profile.settings 
        });
        
        return true;
    }

    /**
     * Save current settings as custom profile
     * @private
     */
    _saveCurrentAsCustom() {
        // Use the constant for consistent key list
        this._customSettings = State.getMultiple(PROFILE_SETTING_KEYS);
    }

    /**
     * Restore custom profile settings
     * @returns {boolean} True if custom settings were restored
     */
    restoreCustom() {
        if (!this._customSettings) {
            return false;
        }
        
        State.setMultiple(this._customSettings, true);
        this._activeProfileId = 'custom';
        State.set('activeProfile', 'custom', true);
        
        cacheTimingSettings();
        cacheComprehensionSettings();
        
        EventBus.emit(Events.PROFILE_CHANGED, { profileId: 'custom' });
        
        return true;
    }

    /**
     * Check if saved custom settings exist
     * @returns {boolean}
     */
    hasCustomSettings() {
        return this._customSettings !== null;
    }

    /**
     * Check if current settings match a profile
     * @param {string} profileId
     * @returns {boolean}
     */
    matchesProfile(profileId) {
        // Validate input
        if (!profileId || typeof profileId !== 'string') {
            return false;
        }
        
        const profile = PROFILES[profileId];
        
        if (!profile || !profile.settings) {
            return false;
        }
        
        for (const [key, value] of Object.entries(profile.settings)) {
            if (State.get(key) !== value) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Detect which profile matches current settings (if any)
     * @returns {string} Profile ID ('custom' if no match)
     */
    detectActiveProfile() {
        // Check each non-custom profile
        for (const profileId of Object.keys(PROFILES)) {
            if (profileId !== 'custom' && this.matchesProfile(profileId)) {
                return profileId;
            }
        }
        
        return 'custom';
    }

    /**
     * Get settings for a specific profile
     * @param {string} profileId
     * @returns {Object|null} Profile settings or null if profile not found
     */
    getProfileSettings(profileId) {
        // Validate input
        if (!profileId || typeof profileId !== 'string') {
            return null;
        }
        
        const profile = PROFILES[profileId];
        
        if (!profile) {
            return null;
        }
        
        if (profileId === 'custom') {
            if (this._customSettings) {
                return { ...this._customSettings };
            }
            // Return only profile-related defaults, not ALL defaults
            const defaultProfileSettings = {};
            for (const key of PROFILE_SETTING_KEYS) {
                if (key in DEFAULTS) {
                    defaultProfileSettings[key] = DEFAULTS[key];
                }
            }
            return defaultProfileSettings;
        }
        
        return profile.settings ? { ...profile.settings } : null;
    }

    /**
     * Compare current settings with a profile
     * @param {string} profileId
     * @returns {{ key: string, current: any, profile: any }[]} Array of differences
     */
    compareWithProfile(profileId) {
        // Validate input
        if (!profileId || typeof profileId !== 'string') {
            return [];
        }
        
        const profile = PROFILES[profileId];
        
        if (!profile || !profile.settings) {
            return [];
        }
        
        const differences = [];
        
        for (const [key, profileValue] of Object.entries(profile.settings)) {
            const currentValue = State.get(key);
            if (currentValue !== profileValue) {
                differences.push({
                    key,
                    current: currentValue,
                    profile: profileValue
                });
            }
        }
        
        return differences;
    }

    /**
     * Get profile color for UI theming
     * @param {string} [profileId] - Profile ID (defaults to active)
     * @returns {string} CSS color
     */
    getProfileColor(profileId) {
        const id = profileId || this._activeProfileId;
        const profile = PROFILES[id];
        return profile ? profile.color : '#888888';
    }

    /**
     * Reset to default custom profile
     */
    resetToDefaults() {
        // Reset all profile-related settings to defaults using the constant
        const defaultSettings = {};
        for (const key of PROFILE_SETTING_KEYS) {
            if (key in DEFAULTS) {
                defaultSettings[key] = DEFAULTS[key];
            } else {
                console.warn(`ProfileManager.resetToDefaults: Missing default for "${key}"`);
            }
        }
        
        State.setMultiple(defaultSettings, true);
        this._activeProfileId = 'custom';
        this._customSettings = null;
        State.set('activeProfile', 'custom', true);
        
        cacheTimingSettings();
        cacheComprehensionSettings();
        
        EventBus.emit(Events.PROFILE_CHANGED, { profileId: 'custom' });
        EventBus.emit(Events.SETTINGS_RESET);
    }

    /**
     * Clean up resources (unsubscribe from state changes)
     * Call this if the ProfileManager needs to be destroyed
     */
    destroy() {
        // Unsubscribe from all state changes
        this._unsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') {
                unsub();
            }
        });
        this._unsubscribers = [];
        
        // Reset state
        this._initialized = false;
        this._customSettings = null;
        this._activeProfileId = 'custom';
    }
}

// Export singleton
export const ProfileManager = new ProfileManagerClass();

// Also export class for testing
export { ProfileManagerClass };
