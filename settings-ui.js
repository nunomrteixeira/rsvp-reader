/**
 * RSVP Reader - Settings UI Module
 * 
 * Manages the settings panel controls and state synchronization.
 * Provides a clean interface for binding UI controls to application state.
 * 
 * Features:
 * - Automatic state synchronization
 * - EventBus integration for cross-module communication
 * - Memory-safe event handling with cleanup
 * - Input validation and sanitization
 * - Accessibility support (keyboard navigation, ARIA, arrow keys)
 * - Per-slider debouncing for performance
 * 
 * Usage:
 *   import { SettingsUI } from './settings-ui.js';
 *   SettingsUI.init();
 *   SettingsUI.bindEvents(callbacks);
 *   SettingsUI.syncWithState();
 */

import { State } from './state-manager.js';
import { DOM } from './dom-cache.js';
import { EventBus, Events } from './event-bus.js';

// ============================================
// MODULE STATE
// ============================================

/** @type {boolean} */
let _initialized = false;

/** @type {boolean} */
let _eventsBound = false;

/** 
 * Store bound handlers for cleanup
 * Structure: { element, events: [{type, handler}] }
 * @type {Map<string, {element: Element|null, events: Array<{type: string, handler: Function}>}>} 
 */
const _boundHandlers = new Map();

/** @type {Array<Function>} State unsubscribe functions */
let _stateUnsubscribes = [];

/** @type {Object} Current callbacks reference */
let _callbacks = {};

/** 
 * Per-slider debounce timers
 * @type {Map<string, number>} 
 */
const _sliderDebounceTimers = new Map();

/** @type {number} Debounce delay in ms */
const SLIDER_DEBOUNCE_MS = 50;

/** @type {Function|null} Current profile select callback */
let _profileSelectCallback = null;

/** @type {Function|null} Current shortcut edit callback */
let _shortcutEditCallback = null;

/** @type {Function|null} Current formatKey function */
let _formatKeyFn = null;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the settings UI module
 * @returns {Object} SettingsUI instance for chaining
 */
function init() {
    if (_initialized) {
        return SettingsUI;
    }
    
    // Subscribe to individual state keys for external updates
    // (State doesn't support wildcard subscription)
    const keysToWatch = [
        'fontSize', 'fontFamily', 'chunkSize', 'wpm',
        'comprehensionInterval', 'soundVolume', 'pauseDuration',
        'warmupDuration', 'speedTrainingIncrement', 'speedTrainingMaxWpm',
        'orpEnabled', 'bionicMode', 'peripheralPreview', 'fixedTiming',
        'punctuationPauses', 'warmupEnabled', 'comprehensionEnabled',
        'speedTrainingEnabled', 'activeSound'
    ];
    
    for (const key of keysToWatch) {
        const unsub = State.subscribe(key, (value) => {
            handleExternalStateChange(key, value);
        });
        _stateUnsubscribes.push(unsub);
    }
    
    _initialized = true;
    
    return SettingsUI;
}

/**
 * Handle state changes from external sources
 * @private
 * @param {string} key - State key that changed
 * @param {*} value - New value
 */
function handleExternalStateChange(key, value) {
    // Map state keys to UI sync functions
    const syncMap = {
        'fontSize': () => {
            const el = DOM.get('settingFontSize');
            if (el && el.value !== String(value)) el.value = value;
        },
        'fontFamily': () => {
            const el = DOM.get('settingFontFamily');
            if (el && el.value !== value) el.value = value;
        },
        'chunkSize': () => syncButtonGroup('chunkSizeGroup', value),
        'wpm': () => {
            const el = DOM.get('wpmDisplay');
            if (el) el.textContent = value;
            updateSpeedTrainingProgress();
        },
        'comprehensionInterval': () => syncSlider('settingInterval', 'intervalValue', value),
        'soundVolume': () => syncSlider('settingVolume', 'volumeValue', value),
        'pauseDuration': () => syncSlider('settingPause', 'pauseValue', value),
        'warmupDuration': () => syncSlider('settingWarmupDuration', 'warmupDurationValue', value),
        'speedTrainingIncrement': () => {
            syncSlider('settingIncrement', 'incrementValue', value);
            updateSpeedTrainingProgress();
        },
        'speedTrainingMaxWpm': () => {
            syncSlider('settingMaxWpm', 'maxWpmValue', value);
            updateSpeedTrainingProgress();
        },
        'orpEnabled': () => syncToggle('toggleOrp', value),
        'bionicMode': () => syncToggle('toggleBionic', value),
        'peripheralPreview': () => syncToggle('togglePeripheral', value),
        'fixedTiming': () => syncToggle('toggleFixed', value),
        'punctuationPauses': () => {
            syncToggle('togglePunctuation', value);
            updateConditionalVisibility();
        },
        'warmupEnabled': () => {
            syncToggle('toggleWarmup', value);
            updateConditionalVisibility();
        },
        'comprehensionEnabled': () => {
            syncToggle('toggleComprehension', value);
            updateConditionalVisibility();
        },
        'speedTrainingEnabled': () => {
            syncToggle('toggleSpeedTraining', value);
            updateConditionalVisibility();
            updateSpeedTrainingProgress();
        },
        'activeSound': () => updateSoundSelector(value)
    };
    
    if (syncMap[key]) {
        syncMap[key]();
    }
}

// ============================================
// STATE SYNCHRONIZATION
// ============================================

/**
 * Sync all settings UI elements with current state
 */
function syncWithState() {
    // Selects
    const settingFontSize = DOM.get('settingFontSize');
    const settingFontFamily = DOM.get('settingFontFamily');
    
    if (settingFontSize) {
        const fontSize = State.get('fontSize');
        if (fontSize != null) settingFontSize.value = fontSize;
    }
    if (settingFontFamily) {
        const fontFamily = State.get('fontFamily');
        if (fontFamily != null) settingFontFamily.value = fontFamily;
    }
    
    // Chunk size button group
    syncButtonGroup('chunkSizeGroup', State.get('chunkSize'));
    
    // Sliders
    syncSlider('settingInterval', 'intervalValue', State.get('comprehensionInterval'));
    syncSlider('settingVolume', 'volumeValue', State.get('soundVolume'));
    syncSlider('settingPause', 'pauseValue', State.get('pauseDuration'));
    syncSlider('settingWarmupDuration', 'warmupDurationValue', State.get('warmupDuration'));
    syncSlider('settingIncrement', 'incrementValue', State.get('speedTrainingIncrement'));
    syncSlider('settingMaxWpm', 'maxWpmValue', State.get('speedTrainingMaxWpm'));
    
    // Toggles
    syncToggle('toggleOrp', State.get('orpEnabled'));
    syncToggle('toggleBionic', State.get('bionicMode'));
    syncToggle('togglePeripheral', State.get('peripheralPreview'));
    syncToggle('toggleFixed', State.get('fixedTiming'));
    syncToggle('togglePunctuation', State.get('punctuationPauses'));
    syncToggle('toggleWarmup', State.get('warmupEnabled'));
    syncToggle('toggleComprehension', State.get('comprehensionEnabled'));
    syncToggle('toggleSpeedTraining', State.get('speedTrainingEnabled'));
    
    // WPM display
    const wpmDisplay = DOM.get('wpmDisplay');
    if (wpmDisplay) {
        const wpm = State.get('wpm');
        wpmDisplay.textContent = wpm != null ? wpm : '';
    }
    
    // Sound selector
    updateSoundSelector(State.get('activeSound'));
    
    // Conditional visibility
    updateConditionalVisibility();
    
    // Speed training progress
    updateSpeedTrainingProgress();
}

/**
 * Sync a button group with a value
 * @param {string} groupKey - DOM key for the button group
 * @param {number|string} value - Active value
 */
function syncButtonGroup(groupKey, value) {
    const group = DOM.get(groupKey);
    if (!group) return;
    
    const valueStr = String(value);
    
    group.querySelectorAll('.btn-group-item').forEach(btn => {
        const btnValue = btn.dataset.value;
        const isActive = btnValue === valueStr;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-checked', String(isActive));
        btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
}

/**
 * Sync a slider with its value display
 * @param {string} sliderKey - DOM key for the slider
 * @param {string} valueKey - DOM key for the value display
 * @param {number} value - Current value
 */
function syncSlider(sliderKey, valueKey, value) {
    const slider = DOM.get(sliderKey);
    const valueEl = DOM.get(valueKey);
    
    // Handle null/undefined
    const displayValue = value != null ? value : 0;
    
    if (slider && slider.value !== String(displayValue)) {
        slider.value = displayValue;
    }
    if (valueEl) valueEl.textContent = displayValue;
}

/**
 * Sync a toggle with its state
 * @param {string} toggleKey - DOM key for the toggle
 * @param {boolean} active - Whether toggle is active
 */
function syncToggle(toggleKey, active) {
    const toggle = DOM.get(toggleKey);
    if (!toggle) return;
    
    const isActive = Boolean(active);
    toggle.classList.toggle('active', isActive);
    toggle.setAttribute('aria-checked', String(isActive));
}

/**
 * Update conditional visibility of settings rows
 */
function updateConditionalVisibility() {
    // Comprehension interval row
    setRowVisibility('comprehensionIntervalRow', State.get('comprehensionEnabled'));
    
    // Punctuation pause duration row
    setRowVisibility('pauseDurationRow', State.get('punctuationPauses'));
    
    // Warmup duration row
    setRowVisibility('warmupDurationRow', State.get('warmupEnabled'));
    
    // Speed training rows
    const speedTrainingEnabled = State.get('speedTrainingEnabled');
    setRowVisibility('speedIncrementRow', speedTrainingEnabled);
    setRowVisibility('speedMaxRow', speedTrainingEnabled);
    setRowVisibility('trainingProgress', speedTrainingEnabled);
}

/**
 * Set visibility of a settings row
 * @private
 * @param {string} rowKey - DOM key for the row
 * @param {boolean} visible - Whether to show the row
 */
function setRowVisibility(rowKey, visible) {
    const row = DOM.get(rowKey);
    if (row) {
        row.style.display = visible ? 'flex' : 'none';
    }
}

/**
 * Update speed training progress display
 */
function updateSpeedTrainingProgress() {
    const currentWpm = State.get('wpm') || 0;
    const increment = State.get('speedTrainingIncrement') || 0;
    const maxWpm = State.get('speedTrainingMaxWpm') || currentWpm;
    const nextWpm = Math.min(currentWpm + increment, maxWpm);
    
    const trainingCurrent = DOM.get('trainingCurrent');
    const trainingNext = DOM.get('trainingNext');
    
    if (trainingCurrent) trainingCurrent.textContent = currentWpm;
    if (trainingNext) trainingNext.textContent = nextWpm;
}

// ============================================
// PROFILES
// ============================================

/**
 * Render profile cards
 * Uses event delegation to avoid memory leaks
 * @param {Array} profiles - Array of profile objects
 * @param {Function} onSelect - Callback when profile is selected
 */
function renderProfiles(profiles, onSelect) {
    const grid = DOM.get('profileGrid');
    if (!grid) return;
    
    // Validate profiles array
    if (!Array.isArray(profiles)) {
        console.warn('[SettingsUI] renderProfiles: profiles must be an array');
        return;
    }
    
    // Store callback for event delegation
    _profileSelectCallback = onSelect;
    
    // Render HTML with validation
    grid.innerHTML = profiles.map((p, index) => {
        // Validate required properties
        const id = p?.id ?? `profile-${index}`;
        const name = p?.name ?? 'Unnamed';
        const description = p?.description ?? '';
        const color = p?.color ?? '#888';
        const isActive = Boolean(p?.isActive);
        
        return `
            <div class="profile-card ${isActive ? 'active' : ''}" 
                 data-profile="${escapeAttr(id)}"
                 role="radio"
                 aria-checked="${isActive ? 'true' : 'false'}"
                 tabindex="${isActive ? '0' : '-1'}">
                <div class="profile-name">
                    <span class="profile-dot" style="background: ${escapeAttr(color)}" aria-hidden="true"></span>
                    ${escapeHtml(name)}
                </div>
                <div class="profile-description">${escapeHtml(description)}</div>
            </div>
        `;
    }).join('');
    
    // Use event delegation - only bind once
    if (!_boundHandlers.has('profileGrid')) {
        const clickHandler = handleProfileClick;
        const keyHandler = handleProfileKeydown;
        
        grid.addEventListener('click', clickHandler);
        grid.addEventListener('keydown', keyHandler);
        
        _boundHandlers.set('profileGrid', {
            element: grid,
            events: [
                { type: 'click', handler: clickHandler },
                { type: 'keydown', handler: keyHandler }
            ]
        });
    }
}

/**
 * Handle profile card click
 * @private
 * @param {Event} e - Click event
 */
function handleProfileClick(e) {
    const card = e.target.closest('.profile-card');
    if (!card) return;
    
    // Get fresh grid reference
    const grid = DOM.get('profileGrid');
    if (!grid) return;
    
    const profileId = card.dataset.profile;
    
    // Update UI
    grid.querySelectorAll('.profile-card').forEach(c => {
        const isThis = c === card;
        c.classList.toggle('active', isThis);
        c.setAttribute('aria-checked', String(isThis));
        c.setAttribute('tabindex', isThis ? '0' : '-1');
    });
    
    // Callback
    if (_profileSelectCallback) {
        _profileSelectCallback(profileId);
    }
    
    // Emit event
    EventBus.emit(Events.PROFILE_CHANGED, { profileId });
}

/**
 * Handle profile card keyboard navigation
 * @private
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleProfileKeydown(e) {
    const grid = DOM.get('profileGrid');
    if (!grid) return;
    
    const cards = Array.from(grid.querySelectorAll('.profile-card'));
    const currentIndex = cards.findIndex(c => c === document.activeElement);
    
    if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.profile-card');
        if (card) {
            e.preventDefault();
            card.click();
        }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % cards.length;
        cards[nextIndex]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + cards.length) % cards.length;
        cards[prevIndex]?.focus();
    } else if (e.key === 'Home') {
        e.preventDefault();
        cards[0]?.focus();
    } else if (e.key === 'End') {
        e.preventDefault();
        cards[cards.length - 1]?.focus();
    }
}

/**
 * Update active profile in UI without full re-render
 * @param {string} profileId - Active profile ID
 */
function updateActiveProfile(profileId) {
    const grid = DOM.get('profileGrid');
    if (!grid) return;
    
    grid.querySelectorAll('.profile-card').forEach(card => {
        const isActive = card.dataset.profile === profileId;
        card.classList.toggle('active', isActive);
        card.setAttribute('aria-checked', String(isActive));
        card.setAttribute('tabindex', isActive ? '0' : '-1');
    });
}

// ============================================
// SHORTCUTS
// ============================================

/**
 * Render keyboard shortcuts list
 * Uses event delegation to avoid memory leaks
 * @param {Array} shortcuts - Array of shortcut objects
 * @param {Function} onEdit - Callback when shortcut is edited
 * @param {Function} formatKey - Function to format key for display
 */
function renderShortcuts(shortcuts, onEdit, formatKey) {
    const list = DOM.get('shortcutList');
    if (!list) return;
    
    // Validate shortcuts array
    if (!Array.isArray(shortcuts)) {
        console.warn('[SettingsUI] renderShortcuts: shortcuts must be an array');
        return;
    }
    
    // Store callback and formatKey for event delegation
    _shortcutEditCallback = onEdit;
    _formatKeyFn = formatKey;
    
    // Render HTML with validation
    list.innerHTML = shortcuts.map((s, index) => {
        const action = s?.action ?? `action-${index}`;
        const displayName = s?.displayName ?? 'Unknown';
        const key = s?.key ?? '';
        const formattedKey = formatKey ? formatKey(key) : escapeHtml(key);
        
        return `
            <div class="shortcut-item" data-action="${escapeAttr(action)}" role="listitem">
                <span class="shortcut-action">${escapeHtml(displayName)}</span>
                <span class="shortcut-key" 
                      data-action="${escapeAttr(action)}"
                      role="button"
                      tabindex="0"
                      aria-label="Press to change shortcut for ${escapeAttr(displayName)}">
                    ${formattedKey}
                </span>
            </div>
        `;
    }).join('');
    
    // Use event delegation - only bind once
    if (!_boundHandlers.has('shortcutList')) {
        const clickHandler = handleShortcutClick;
        const keyHandler = handleShortcutKeydown;
        
        list.addEventListener('click', clickHandler);
        list.addEventListener('keydown', keyHandler);
        
        _boundHandlers.set('shortcutList', {
            element: list,
            events: [
                { type: 'click', handler: clickHandler },
                { type: 'keydown', handler: keyHandler }
            ]
        });
    }
}

/**
 * Handle shortcut key click
 * @private
 * @param {Event} e - Click event
 */
function handleShortcutClick(e) {
    const keyEl = e.target.closest('.shortcut-key');
    if (!keyEl) return;
    
    const action = keyEl.dataset.action;
    if (_shortcutEditCallback && action) {
        _shortcutEditCallback(action, keyEl);
    }
}

/**
 * Handle shortcut key keyboard interaction
 * @private
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleShortcutKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
        const keyEl = e.target.closest('.shortcut-key');
        if (keyEl) {
            e.preventDefault();
            const action = keyEl.dataset.action;
            if (_shortcutEditCallback && action) {
                _shortcutEditCallback(action, keyEl);
            }
        }
    }
}

/**
 * Update a shortcut key display
 * @param {string} action - Shortcut action
 * @param {string} key - Key value (will be formatted)
 * @param {boolean} [isListening=false] - Whether listening for input
 */
function updateShortcutDisplay(action, key, isListening = false) {
    const list = DOM.get('shortcutList');
    if (!list) return;
    
    // Validate action to prevent selector injection
    if (!action || typeof action !== 'string' || !/^[\w-]+$/.test(action)) {
        console.warn('[SettingsUI] updateShortcutDisplay: invalid action');
        return;
    }
    
    const el = list.querySelector(`.shortcut-key[data-action="${action}"]`);
    if (el) {
        // Use innerHTML to support formatKey HTML output, but escape if no formatKey
        if (isListening) {
            el.textContent = key; // Plain text when listening
        } else {
            el.innerHTML = _formatKeyFn ? _formatKeyFn(key) : escapeHtml(key);
        }
        el.classList.toggle('listening', isListening);
        el.setAttribute('aria-busy', String(isListening));
    }
}

// ============================================
// SOUND SELECTOR
// ============================================

/**
 * Update sound selector UI
 * @param {string} activeSound - Currently active sound name
 */
function updateSoundSelector(activeSound) {
    const soundSelector = DOM.get('soundSelector');
    if (!soundSelector) return;
    
    const soundName = activeSound || 'none';
    
    soundSelector.querySelectorAll('.sound-option').forEach(btn => {
        const isActive = btn.dataset.sound === soundName;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-checked', String(isActive));
        btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    
    // Update sound button icon in controls
    const btnSound = DOM.get('btnSound');
    if (btnSound) {
        const iconHref = soundName !== 'none' ? '#icon-volume-2' : '#icon-volume-x';
        const useEl = btnSound.querySelector('use');
        if (useEl) useEl.setAttribute('href', iconHref);
        
        // Update aria-label
        btnSound.setAttribute('aria-label', `Sound: ${soundName}`);
    }
}

// ============================================
// EVENT BINDING
// ============================================

/**
 * Bind settings panel events
 * @param {Object} callbacks - Event callbacks
 */
function bindEvents(callbacks = {}) {
    if (_eventsBound) {
        console.warn('[SettingsUI] Events already bound. Call destroy() first to rebind.');
        return;
    }
    
    _callbacks = callbacks;
    
    // Font size
    bindSelectChange('settingFontSize', 'fontSize', callbacks.onFontSizeChange);
    
    // Font family
    bindSelectChange('settingFontFamily', 'fontFamily', callbacks.onFontFamilyChange, false);
    
    // Chunk size button group
    bindButtonGroup('chunkSizeGroup', 'chunkSize', callbacks.onChunkSizeChange);
    
    // Sliders - each gets its own debounce timer
    bindSlider('settingInterval', 'intervalValue', 'comprehensionInterval', callbacks.onIntervalChange);
    bindSlider('settingVolume', 'volumeValue', 'soundVolume', callbacks.onVolumeChange);
    bindSlider('settingPause', 'pauseValue', 'pauseDuration', callbacks.onPauseChange);
    bindSlider('settingWarmupDuration', 'warmupDurationValue', 'warmupDuration', callbacks.onWarmupDurationChange);
    bindSlider('settingIncrement', 'incrementValue', 'speedTrainingIncrement', (value) => {
        updateSpeedTrainingProgress();
        if (callbacks.onIncrementChange) callbacks.onIncrementChange(value);
    });
    bindSlider('settingMaxWpm', 'maxWpmValue', 'speedTrainingMaxWpm', (value) => {
        updateSpeedTrainingProgress();
        if (callbacks.onMaxWpmChange) callbacks.onMaxWpmChange(value);
    });
    
    // Toggles
    bindToggle('toggleOrp', 'orpEnabled', callbacks.onOrpToggle);
    bindToggle('toggleBionic', 'bionicMode', callbacks.onBionicToggle);
    bindToggle('togglePeripheral', 'peripheralPreview', callbacks.onPeripheralToggle);
    bindToggle('toggleFixed', 'fixedTiming', callbacks.onFixedToggle);
    
    bindToggle('togglePunctuation', 'punctuationPauses', (value) => {
        updateConditionalVisibility();
        if (callbacks.onPunctuationToggle) callbacks.onPunctuationToggle(value);
    });
    
    bindToggle('toggleWarmup', 'warmupEnabled', (value) => {
        updateConditionalVisibility();
        if (callbacks.onWarmupToggle) callbacks.onWarmupToggle(value);
    });
    
    bindToggle('toggleComprehension', 'comprehensionEnabled', (value) => {
        updateConditionalVisibility();
        if (callbacks.onComprehensionToggle) callbacks.onComprehensionToggle(value);
    });
    
    bindToggle('toggleSpeedTraining', 'speedTrainingEnabled', (value) => {
        updateConditionalVisibility();
        updateSpeedTrainingProgress();
        if (callbacks.onSpeedTrainingToggle) callbacks.onSpeedTrainingToggle(value);
    });
    
    // Sound selector
    bindSoundSelector(callbacks.onSoundChange);
    
    _eventsBound = true;
}

/**
 * Bind a button group with arrow key navigation
 * @private
 * @param {string} groupKey - DOM key for button group
 * @param {string} stateKey - State key to update
 * @param {Function} [callback] - Optional callback
 */
function bindButtonGroup(groupKey, stateKey, callback) {
    const group = DOM.get(groupKey);
    if (!group) return;
    
    const clickHandler = (e) => {
        const btn = e.target.closest('.btn-group-item');
        if (!btn) return;
        
        const value = parseIntSafe(btn.dataset.value, State.get(stateKey));
        State.set(stateKey, value);
        syncButtonGroup(groupKey, value);
        
        if (callback) callback(value);
        EventBus.emit(Events.SETTINGS_CHANGED, { key: stateKey, value });
    };
    
    const keyHandler = (e) => {
        const buttons = Array.from(group.querySelectorAll('.btn-group-item'));
        const currentIndex = buttons.findIndex(b => b === document.activeElement);
        
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = (currentIndex + 1) % buttons.length;
            buttons[nextIndex]?.focus();
            buttons[nextIndex]?.click();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = (currentIndex - 1 + buttons.length) % buttons.length;
            buttons[prevIndex]?.focus();
            buttons[prevIndex]?.click();
        }
    };
    
    group.addEventListener('click', clickHandler);
    group.addEventListener('keydown', keyHandler);
    
    _boundHandlers.set(groupKey, {
        element: group,
        events: [
            { type: 'click', handler: clickHandler },
            { type: 'keydown', handler: keyHandler }
        ]
    });
}

/**
 * Bind a select change event
 * @private
 * @param {string} selectKey - DOM key for select
 * @param {string} stateKey - State key to update
 * @param {Function} [callback] - Optional callback
 * @param {boolean} [parseAsInt=true] - Whether to parse value as integer
 */
function bindSelectChange(selectKey, stateKey, callback, parseAsInt = true) {
    const select = DOM.get(selectKey);
    if (!select) return;
    
    const handler = (e) => {
        const value = parseAsInt 
            ? parseIntSafe(e.target.value, State.get(stateKey))
            : e.target.value;
        
        State.set(stateKey, value);
        
        if (callback) callback(value);
        EventBus.emit(Events.SETTINGS_CHANGED, { key: stateKey, value });
    };
    
    select.addEventListener('change', handler);
    
    _boundHandlers.set(selectKey, {
        element: select,
        events: [{ type: 'change', handler }]
    });
}

/**
 * Bind a slider to state with per-slider debouncing
 * @private
 * @param {string} sliderKey - DOM key for slider
 * @param {string} valueKey - DOM key for value display
 * @param {string} stateKey - State key to update
 * @param {Function} [callback] - Optional callback
 */
function bindSlider(sliderKey, valueKey, stateKey, callback) {
    const slider = DOM.get(sliderKey);
    if (!slider) return;
    
    const handler = (e) => {
        // Get min/max from slider for clamping
        const min = parseIntSafe(slider.min, 0);
        const max = parseIntSafe(slider.max, 100);
        let value = parseIntSafe(e.target.value, State.get(stateKey));
        
        // Clamp to valid range
        value = Math.max(min, Math.min(max, value));
        
        // Update display immediately for responsiveness
        const valueEl = DOM.get(valueKey);
        if (valueEl) valueEl.textContent = value;
        
        // Per-slider debounce timer
        const existingTimer = _sliderDebounceTimers.get(sliderKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        
        const timer = setTimeout(() => {
            State.set(stateKey, value);
            if (callback) callback(value);
            EventBus.emit(Events.SETTINGS_CHANGED, { key: stateKey, value });
            _sliderDebounceTimers.delete(sliderKey);
        }, SLIDER_DEBOUNCE_MS);
        
        _sliderDebounceTimers.set(sliderKey, timer);
    };
    
    slider.addEventListener('input', handler);
    
    _boundHandlers.set(sliderKey, {
        element: slider,
        events: [{ type: 'input', handler }]
    });
}

/**
 * Bind a toggle to state
 * @private
 * @param {string} toggleKey - DOM key for toggle
 * @param {string} stateKey - State key to update
 * @param {Function} [callback] - Optional callback
 */
function bindToggle(toggleKey, stateKey, callback) {
    const toggle = DOM.get(toggleKey);
    if (!toggle) return;
    
    const clickHandler = () => {
        const newValue = !State.get(stateKey);
        State.set(stateKey, newValue);
        
        toggle.classList.toggle('active', newValue);
        toggle.setAttribute('aria-checked', String(newValue));
        
        if (callback) callback(newValue);
        EventBus.emit(Events.SETTINGS_CHANGED, { key: stateKey, value: newValue });
    };
    
    const keyHandler = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            clickHandler();
        }
    };
    
    toggle.addEventListener('click', clickHandler);
    toggle.addEventListener('keydown', keyHandler);
    
    // Store BOTH handlers for cleanup
    _boundHandlers.set(toggleKey, {
        element: toggle,
        events: [
            { type: 'click', handler: clickHandler },
            { type: 'keydown', handler: keyHandler }
        ]
    });
}

/**
 * Bind sound selector with state update
 * @private
 * @param {Function} [callback] - Optional callback
 */
function bindSoundSelector(callback) {
    const soundSelector = DOM.get('soundSelector');
    if (!soundSelector) return;
    
    const clickHandler = (e) => {
        const btn = e.target.closest('.sound-option');
        if (!btn) return;
        
        const sound = btn.dataset.sound || 'none';
        
        // Update state
        State.set('activeSound', sound);
        
        // Update UI
        updateSoundSelector(sound);
        
        if (callback) callback(sound);
        EventBus.emit(Events.SETTINGS_CHANGED, { key: 'activeSound', value: sound });
    };
    
    const keyHandler = (e) => {
        const buttons = Array.from(soundSelector.querySelectorAll('.sound-option'));
        const currentIndex = buttons.findIndex(b => b === document.activeElement);
        
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = (currentIndex + 1) % buttons.length;
            buttons[nextIndex]?.focus();
            buttons[nextIndex]?.click();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = (currentIndex - 1 + buttons.length) % buttons.length;
            buttons[prevIndex]?.focus();
            buttons[prevIndex]?.click();
        }
    };
    
    soundSelector.addEventListener('click', clickHandler);
    soundSelector.addEventListener('keydown', keyHandler);
    
    _boundHandlers.set('soundSelector', {
        element: soundSelector,
        events: [
            { type: 'click', handler: clickHandler },
            { type: 'keydown', handler: keyHandler }
        ]
    });
}

// ============================================
// UTILITIES
// ============================================

/**
 * Parse integer safely with fallback
 * @param {string|number} value - Value to parse
 * @param {number} [fallback=0] - Fallback value if parsing fails
 * @returns {number}
 */
function parseIntSafe(value, fallback = 0) {
    if (value == null) return fallback;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string}
 */
function escapeHtml(text) {
    if (text == null) return '';
    
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/**
 * Escape attribute value to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string}
 */
function escapeAttr(text) {
    if (text == null) return '';
    
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ============================================
// CLEANUP
// ============================================

/**
 * Clean up all event listeners and resources
 */
function destroy() {
    // Clear all slider debounce timers
    for (const timer of _sliderDebounceTimers.values()) {
        clearTimeout(timer);
    }
    _sliderDebounceTimers.clear();
    
    // Unsubscribe from all state subscriptions
    for (const unsub of _stateUnsubscribes) {
        if (typeof unsub === 'function') {
            unsub();
        }
    }
    _stateUnsubscribes = [];
    
    // Remove all bound event listeners
    for (const [key, data] of _boundHandlers.entries()) {
        const element = data.element || DOM.get(key);
        if (element && data.events) {
            for (const { type, handler } of data.events) {
                element.removeEventListener(type, handler);
            }
        }
    }
    _boundHandlers.clear();
    
    // Reset state
    _callbacks = {};
    _profileSelectCallback = null;
    _shortcutEditCallback = null;
    _formatKeyFn = null;
    _eventsBound = false;
    _initialized = false;
}

// ============================================
// EXPORT
// ============================================

export const SettingsUI = {
    // Lifecycle
    init,
    destroy,
    
    // State sync
    syncWithState,
    syncButtonGroup,
    syncSlider,
    syncToggle,
    updateConditionalVisibility,
    updateSpeedTrainingProgress,
    
    // Profiles
    renderProfiles,
    updateActiveProfile,
    
    // Shortcuts
    renderShortcuts,
    updateShortcutDisplay,
    
    // Sound
    updateSoundSelector,
    
    // Event binding
    bindEvents,
    
    // Utilities
    escapeHtml,
    escapeAttr,
    parseIntSafe
};

// Also export for testing
export { destroy as destroySettingsUI };
