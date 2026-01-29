/**
 * RSVP Reader - Main Application
 * Orchestrates all modules and connects UI to the engine.
 * 
 * This is the main entry point that coordinates:
 * - UI modules (DOM, Toast, Theme, Panels, ReaderDisplay, Settings)
 * - Engine (RSVPEngine)
 * - Managers (Sound, Keyboard, Analytics, Library)
 */

// Core
import { CONFIG, SAMPLE_TEXT } from './config.js';
import { State } from './state-manager.js';

// Engine
import { RSVPEngine } from './rsvp-engine.js';
import { ProfileManager } from './profile-manager.js';

// Managers
import { SoundManager } from './sound-manager.js';
import { KeyboardManager } from './keyboard-manager.js';
import { AnalyticsManager } from './analytics-manager.js';
import { LibraryManager } from './library-manager.js';

// UI
import { UI, DOM, Toast, Theme, Panels, ReaderDisplay, SettingsUI } from './ui-manager.js';

// Modules
import { validate, countWords, escapeHTML } from './text-processor.js';
import { FileImport } from './file-import.js';
import { invalidateCache as invalidateTimingCache, isWarmupActive, getWarmupProgress, resetWarmup } from './timing-manager.js';
import * as Comprehension from './comprehension.js';

/**
 * Main Application Class
 */
class App {
    constructor() {
        this.isInitialized = false;
        this.currentLibraryItemId = null;
        this._eventListeners = [];
    }

    /**
     * Register event listener for cleanup
     */
    _on(element, event, handler, options) {
        element.addEventListener(event, handler, options);
        this._eventListeners.push({ element, event, handler, options });
    }

    /**
     * Initialize the application
     */
    async init() {
        if (this.isInitialized) return;

        // Initialize core systems
        State.init();
        ProfileManager.init();
        KeyboardManager.init();
        AnalyticsManager.init();
        LibraryManager.init();

        // Initialize UI (must await - DOM caching is critical)
        await UI.init();

        // Set up UI components
        this.setupProfiles();
        this.setupShortcuts();
        SettingsUI.syncWithState();
        ReaderDisplay.updateWordStyle();
        ReaderDisplay.updatePeripheralVisibility();
        SettingsUI.updateSoundSelector(SoundManager.getActiveSound());

        // Bind events
        this.bindEvents();
        this.bindKeyboard();
        this.setupEngineCallbacks();

        this.isInitialized = true;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        for (const { element, event, handler, options } of this._eventListeners) {
            element.removeEventListener(event, handler, options);
        }
        this._eventListeners = [];
        
        SoundManager.destroy();
        KeyboardManager.destroy();
        AnalyticsManager.destroy();
        LibraryManager.destroy();
        UI.destroy();
        
        this.isInitialized = false;
        
    }

    // ============================================
    // EVENT BINDING
    // ============================================

    bindEvents() {
        // Text input
        DOM.get('textInput')?.addEventListener('input', () => this.updateWordCount());
        DOM.get('btnLoad')?.addEventListener('click', () => this.loadText());
        DOM.get('btnSample')?.addEventListener('click', () => this.loadSampleText());
        DOM.get('btnNewText')?.addEventListener('click', () => this.showInputSection());

        // Input tabs
        DOM.get('tabPaste')?.addEventListener('click', () => this.switchInputTab('paste'));
        DOM.get('tabUrl')?.addEventListener('click', () => this.switchInputTab('url'));
        DOM.get('tabFile')?.addEventListener('click', () => this.switchInputTab('file'));
        DOM.get('btnFetchUrl')?.addEventListener('click', () => this.fetchUrl());

        // File import
        this.setupFileImport();

        // Library
        DOM.get('btnLibrary')?.addEventListener('click', () => this.openLibrary());
        DOM.get('librarySearch')?.addEventListener('input', (e) => this.searchLibrary(e.target.value));
        DOM.get('btnClearLibrary')?.addEventListener('click', () => this.clearLibrary());
        DOM.get('btnExportLibrary')?.addEventListener('click', () => this.exportLibrary());
        DOM.get('btnImportLibrary')?.addEventListener('click', () => DOM.get('libraryImportInput')?.click());
        DOM.get('libraryImportInput')?.addEventListener('change', (e) => this.importLibrary(e.target.files));

        // Playback controls
        DOM.get('btnPlay')?.addEventListener('click', () => this.togglePlayback());
        DOM.get('btnPrev')?.addEventListener('click', () => RSVPEngine.prev());
        DOM.get('btnNext')?.addEventListener('click', () => RSVPEngine.next());
        DOM.get('btnReset')?.addEventListener('click', () => this.resetReading());
        DOM.get('btnWpmUp')?.addEventListener('click', () => this.adjustWpm(CONFIG.WPM.STEP));
        DOM.get('btnWpmDown')?.addEventListener('click', () => this.adjustWpm(-CONFIG.WPM.STEP));
        DOM.get('wpmDisplay')?.addEventListener('click', () => this.editWpm());

        // Sound
        DOM.get('btnSound')?.addEventListener('click', () => this.toggleSound());

        // Completion
        DOM.get('btnRestart')?.addEventListener('click', () => this.restartReading());
        DOM.get('btnNewTextComplete')?.addEventListener('click', () => this.showInputSection());

        // Focus Mode
        DOM.get('btnFocus')?.addEventListener('click', () => this.enterFocusMode());
        DOM.get('btnFocusExit')?.addEventListener('click', () => this.exitFocusMode());
        DOM.get('btnFocusPlay')?.addEventListener('click', () => this.togglePlayback());
        this.bindFocusModeKeys();

        // Header buttons
        DOM.get('btnTheme')?.addEventListener('click', () => Theme.toggle());
        DOM.get('btnSettings')?.addEventListener('click', () => Panels.openSettings());
        DOM.get('btnStats')?.addEventListener('click', () => this.openStats());

        // Bind panel events
        Panels.bindEvents();
        
        // Bind settings events
        this.bindSettingsEvents();

        // Stats modal reset
        DOM.get('btnResetStats')?.addEventListener('click', () => this.resetStats());

        // Progress bar seek
        DOM.get('progressBar')?.addEventListener('click', (e) => this.seekToPosition(e));
        
        // Settings export/import
        DOM.get('btnExportSettings')?.addEventListener('click', () => this.exportSettings());
        DOM.get('btnImportSettings')?.addEventListener('click', () => DOM.get('settingsImportInput')?.click());
        DOM.get('settingsImportInput')?.addEventListener('change', (e) => this.importSettings(e));
        
        // Reset shortcuts
        DOM.get('btnResetShortcuts')?.addEventListener('click', () => this.resetShortcuts());
    }

    bindFocusModeKeys() {
        this._on(document, 'keydown', (e) => {
            const isTyping = document.activeElement?.tagName === 'INPUT' || 
                           document.activeElement?.tagName === 'TEXTAREA';
            
            if (e.key === 'Escape' && ReaderDisplay.isInFocusMode()) {
                this.exitFocusMode();
            }
            if ((e.key === 'f' || e.key === 'F') && !isTyping) {
                const inputSection = DOM.get('inputSection');
                const readerSection = DOM.get('readerSection');
                
                if (!ReaderDisplay.isInFocusMode() && inputSection && !inputSection.classList.contains('hidden')) return;
                if (ReaderDisplay.isInFocusMode()) {
                    this.exitFocusMode();
                } else if (readerSection && !readerSection.classList.contains('hidden')) {
                    this.enterFocusMode();
                }
            }
        });
    }

    bindSettingsEvents() {
        SettingsUI.bindEvents({
            onFontSizeChange: () => ReaderDisplay.updateWordStyle(),
            onFontFamilyChange: () => ReaderDisplay.updateWordStyle(),
            onChunkSizeChange: (value) => RSVPEngine.updateChunkSize(value),
            onVolumeChange: (value) => SoundManager.setVolume(value),
            onOrpToggle: () => {
                RSVPEngine.updateORPEnabled(State.get('orpEnabled'));
                // Refresh current word display
                const state = RSVPEngine.getState();
                if (state.currentIndex >= 0) {
                    const words = RSVPEngine.getAllWords();
                    if (words[state.currentIndex]) {
                        ReaderDisplay.updateWord(words[state.currentIndex]);
                    }
                    // Also refresh peripheral words
                    if (State.get('peripheralPreview')) {
                        ReaderDisplay.updatePeripheralWords(state.currentIndex, words);
                    }
                }
            },
            onBionicToggle: () => {
                RSVPEngine.updateBionicMode(State.get('bionicMode'));
                // Refresh current word display
                const state = RSVPEngine.getState();
                if (state.currentIndex >= 0) {
                    const words = RSVPEngine.getAllWords();
                    if (words[state.currentIndex]) {
                        ReaderDisplay.updateWord(words[state.currentIndex]);
                    }
                    // Also refresh peripheral words
                    if (State.get('peripheralPreview')) {
                        ReaderDisplay.updatePeripheralWords(state.currentIndex, words);
                    }
                }
            },
            onPeripheralToggle: () => {
                ReaderDisplay.updatePeripheralVisibility(true);
                // Also refresh peripheral words if text is loaded
                const state = RSVPEngine.getState();
                if (state.totalWords > 0 && State.get('peripheralPreview')) {
                    ReaderDisplay.updatePeripheralWords(state.currentIndex, RSVPEngine.getAllWords());
                }
            },
            onFixedToggle: () => {
                invalidateTimingCache();
                RSVPEngine.recalculateDurations();
            },
            onPunctuationToggle: () => {
                invalidateTimingCache();
                RSVPEngine.recalculateDurations();
            },
            onPauseChange: () => {
                invalidateTimingCache();
                RSVPEngine.recalculateDurations();
            },
            onWarmupToggle: () => {
                // If warmup disabled mid-session, hide indicator and reset
                if (!State.get('warmupEnabled')) {
                    resetWarmup();
                    ReaderDisplay.hideWarmupIndicator();
                }
            },
            onWarmupDurationChange: () => {
                // Duration change takes effect immediately if warmup active
            },
            onIncrementChange: () => SettingsUI.updateSpeedTrainingProgress(),
            onSoundChange: (sound) => {
                SoundManager.play(sound);
                SettingsUI.updateSoundSelector(SoundManager.getActiveSound());
            }
        });
        
        // Color picker
        Theme.bindColorPicker();
    }

    bindKeyboard() {
        KeyboardManager.onMultiple({
            playPause: () => this.togglePlayback(),
            prev: () => RSVPEngine.prev(),
            next: () => RSVPEngine.next(),
            reset: () => this.resetReading(),
            speedUp: () => this.adjustWpm(CONFIG.WPM.STEP),
            speedDown: () => this.adjustWpm(-CONFIG.WPM.STEP),
            showHelp: () => Panels.openShortcuts(),
            skipComprehension: () => this.skipComprehension()
        });
    }

    setupEngineCallbacks() {
        RSVPEngine.onWordChange((word, index) => {
            ReaderDisplay.updateWord(word);
            const state = RSVPEngine.getState();
            ReaderDisplay.setTotalWords(state.totalWords);
            ReaderDisplay.updateProgress(index, state.totalWords, state.remainingMs);
            ReaderDisplay.updatePeripheralWords(index, RSVPEngine.getAllWords());
            
            // Update warmup indicator
            if (isWarmupActive()) {
                ReaderDisplay.showWarmupIndicator();
                ReaderDisplay.updateWarmupProgress(getWarmupProgress());
            } else {
                ReaderDisplay.hideWarmupIndicator();
            }
            
            // Track for analytics
            AnalyticsManager.trackWords(1, State.get('wpm'));
            
            // Save library progress periodically
            if (index % 20 === 0) {
                this.updateLibraryProgress(index);
            }
        });

        RSVPEngine.onStateChange((state) => {
            ReaderDisplay.updatePlaybackState(state);
            ReaderDisplay.setTotalWords(state.totalWords);
            
            if (state.playbackState === 'completed') {
                this.handleCompletion();
            }
        });

        RSVPEngine.onComprehensionCheck(() => {
            this.showComprehensionCheck();
        });
    }

    // ============================================
    // PROFILES & SHORTCUTS SETUP
    // ============================================

    setupProfiles() {
        const profiles = ProfileManager.getProfiles();
        SettingsUI.renderProfiles(profiles, (profileId) => {
            ProfileManager.applyProfile(profileId);
            
            // Sync UI with new state
            SettingsUI.syncWithState();
            ReaderDisplay.updateWordStyle();
            ReaderDisplay.updatePeripheralVisibility();
            
            // Refresh current word display if reading
            const state = RSVPEngine.getState();
            if (state.currentIndex >= 0) {
                const words = RSVPEngine.getAllWords();
                if (words[state.currentIndex]) {
                    ReaderDisplay.updateWord(words[state.currentIndex]);
                    ReaderDisplay.updatePeripheralWords(state.currentIndex, words);
                }
            }
            
            // Recalculate durations with new settings
            invalidateTimingCache();
            RSVPEngine.recalculateDurations();
            
            Toast.success(`${profiles.find(p => p.id === profileId)?.name || 'Profile'} applied`);
        });
    }

    setupShortcuts() {
        const shortcuts = KeyboardManager.getAllShortcuts();
        SettingsUI.renderShortcuts(
            shortcuts,
            (action, element) => this.editShortcut(action, element),
            (key) => KeyboardManager.formatKeyForDisplay(key)
        );
    }

    async editShortcut(action, element) {
        SettingsUI.updateShortcutDisplay(action, 'Press key...', true);
        
        const newKey = await KeyboardManager.waitForKeyPress(5000);
        
        if (newKey) {
            const result = KeyboardManager.setShortcut(action, newKey);
            if (result.success) {
                SettingsUI.updateShortcutDisplay(action, KeyboardManager.formatKeyForDisplay(newKey));
                Toast.success('Shortcut updated');
            } else {
                SettingsUI.updateShortcutDisplay(action, KeyboardManager.formatKeyForDisplay(KeyboardManager.getShortcut(action)));
                Toast.error(result.conflict);
            }
        } else {
            SettingsUI.updateShortcutDisplay(action, KeyboardManager.formatKeyForDisplay(KeyboardManager.getShortcut(action)));
        }
    }

    // ============================================
    // TEXT INPUT
    // ============================================

    updateWordCount() {
        const textInput = DOM.get('textInput');
        const wordCount = DOM.get('wordCount');
        if (textInput && wordCount) {
            const count = countWords(textInput.value);
            wordCount.textContent = `${count} word${count !== 1 ? 's' : ''}`;
        }
    }

    switchInputTab(tab) {
        ['Paste', 'Url', 'File'].forEach(t => {
            const tabBtn = DOM.get(`tab${t}`);
            const content = DOM.get(`content${t}`);
            const isActive = t.toLowerCase() === tab;
            
            if (tabBtn) {
                tabBtn.classList.toggle('active', isActive);
                tabBtn.setAttribute('aria-selected', isActive.toString());
            }
            if (content) {
                content.classList.toggle('active', isActive);
                content.hidden = !isActive;
            }
        });
    }

    async fetchUrl() {
        const urlInput = DOM.get('urlInput');
        const urlStatus = DOM.get('urlStatus');
        const btnFetchUrl = DOM.get('btnFetchUrl');
        
        const url = urlInput?.value.trim();
        if (!url) {
            Toast.error('Please enter a URL');
            return;
        }

        try {
            new URL(url);
        } catch {
            Toast.error('Invalid URL format');
            return;
        }

        if (urlStatus) {
            urlStatus.textContent = 'Fetching...';
            urlStatus.className = 'url-status loading';
        }
        if (btnFetchUrl) btnFetchUrl.disabled = true;

        // CORS proxies to try in order
        const corsProxies = [
            (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
            (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
            (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
        ];

        let lastError = null;
        
        for (const proxyFn of corsProxies) {
            try {
                const proxyUrl = proxyFn(url);
                console.log('[App] Trying proxy:', proxyUrl);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
                
                const response = await fetch(proxyUrl, { 
                    signal: controller.signal,
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,*/*'
                    }
                });
                clearTimeout(timeoutId);
                
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                
                const html = await response.text();
                const text = this.extractTextFromHtml(html);
                
                if (text.length < 50) throw new Error('Could not extract meaningful text');
                
                const textInput = DOM.get('textInput');
                if (textInput) textInput.value = text;
                this.updateWordCount();
                this.switchInputTab('paste');
                
                if (urlStatus) {
                    urlStatus.textContent = 'Fetched!';
                    urlStatus.className = 'url-status success';
                }
                
                Toast.success(`Extracted ${countWords(text)} words`);
                if (btnFetchUrl) btnFetchUrl.disabled = false;
                return; // Success - exit the function
                
            } catch (error) {
                console.warn('[App] Proxy failed:', error.message);
                lastError = error;
                // Continue to next proxy
            }
        }
        
        // All proxies failed
        console.error('URL fetch error - all proxies failed:', lastError);
        if (urlStatus) {
            urlStatus.textContent = 'Failed to fetch';
            urlStatus.className = 'url-status error';
        }
        Toast.error('Failed to fetch URL. Try copying text manually.');
        
        if (btnFetchUrl) btnFetchUrl.disabled = false;
    }

    extractTextFromHtml(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        doc.querySelectorAll('script, style, nav, header, footer, aside, iframe, noscript').forEach(el => el.remove());
        
        const mainContent = doc.querySelector('article, main, [role="main"], .content, .post');
        let text = mainContent ? mainContent.textContent : (doc.body?.textContent || '');
        
        return text.replace(/\s+/g, ' ').trim();
    }

    setupFileImport() {
        const fileDropZone = DOM.get('fileDropZone');
        const fileInput = DOM.get('fileInput');
        const btnBrowseFile = DOM.get('btnBrowseFile');

        btnBrowseFile?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) this.importFile(file);
        });
        
        fileDropZone?.addEventListener('click', () => fileInput?.click());
        fileDropZone?.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileDropZone.classList.add('dragover');
        });
        fileDropZone?.addEventListener('dragleave', () => {
            fileDropZone.classList.remove('dragover');
        });
        fileDropZone?.addEventListener('drop', (e) => {
            e.preventDefault();
            fileDropZone.classList.remove('dragover');
            const file = e.dataTransfer?.files[0];
            if (file) this.importFile(file);
        });
    }

    async importFile(file) {
        const fileStatus = DOM.get('fileStatus');
        
        if (fileStatus) {
            fileStatus.textContent = 'Processing...';
            fileStatus.className = 'file-status loading';
        }

        try {
            const result = await FileImport.importFile(file);
            
            if (fileStatus) {
                fileStatus.textContent = `Loaded: ${result.metadata.title}`;
                fileStatus.className = 'file-status success';
            }
            
            const textInput = DOM.get('textInput');
            if (textInput) textInput.value = result.text;
            this.updateWordCount();
            this.switchInputTab('paste');
            
            // Clear file status after switching tabs (user will see toast instead)
            if (fileStatus) {
                setTimeout(() => {
                    fileStatus.textContent = '';
                    fileStatus.className = 'file-status';
                }, 2000);
            }
            
            Toast.success(`Imported ${countWords(result.text)} words`);
        } catch (error) {
            if (fileStatus) {
                fileStatus.textContent = error.message;
                fileStatus.className = 'file-status error';
            }
            Toast.error('Failed to import file');
        }
    }

    loadText() {
        const textInput = DOM.get('textInput');
        const text = textInput?.value || '';
        const validation = validate(text);
        
        if (!validation.valid) {
            Toast.error(validation.message);
            return;
        }

        const result = RSVPEngine.load(text);
        
        if (result.success) {
            if (!this.currentLibraryItemId) {
                this.saveToLibrary(text);
            }
            
            ReaderDisplay.showReader();
            
            // CRITICAL: Cache DOM elements for hot path before updating display
            ReaderDisplay.cacheHotPathElements();
            ReaderDisplay.cacheSettings();
            
            // Initialize the display with first word and progress
            const state = RSVPEngine.getState();
            const firstWord = RSVPEngine.getCurrentWord();
            
            if (firstWord) {
                ReaderDisplay.setTotalWords(state.totalWords);
                ReaderDisplay.updateWord(firstWord);
                ReaderDisplay.updateProgress(0, state.totalWords, state.remainingMs);
                ReaderDisplay.updatePeripheralWords(0, RSVPEngine.getAllWords());
            }
            
            AnalyticsManager.startSession();
            Toast.success(`Loaded ${result.wordCount} words`);
        } else {
            Toast.error(result.error);
        }
    }

    loadSampleText() {
        const textInput = DOM.get('textInput');
        if (textInput) textInput.value = SAMPLE_TEXT;
        this.updateWordCount();
    }

    // ============================================
    // LIBRARY
    // ============================================

    openLibrary() {
        Panels.openLibrary(() => this.renderLibrary());
    }

    renderLibrary() {
        const items = LibraryManager.getAll();
        const stats = LibraryManager.getStats();
        
        const libraryCount = DOM.get('libraryCount');
        const libraryEmpty = DOM.get('libraryEmpty');
        const libraryList = DOM.get('libraryList');
        
        if (libraryCount) {
            libraryCount.textContent = `${stats.count} text${stats.count !== 1 ? 's' : ''} (${stats.storageUsedFormatted})`;
        }
        
        if (libraryEmpty) libraryEmpty.style.display = items.length === 0 ? 'flex' : 'none';
        if (libraryList) libraryList.style.display = items.length === 0 ? 'none' : 'flex';

        if (items.length === 0 || !libraryList) return;

        libraryList.innerHTML = items.map(item => `
            <div class="library-item ${item.completed ? 'completed' : ''}" data-id="${item.id}" role="listitem">
                <div class="library-item-header">
                    <span class="library-item-title" data-id="${item.id}">${escapeHTML(item.title)}</span>
                    <div class="library-item-actions">
                        <button class="library-item-edit" data-id="${item.id}" aria-label="Edit title" title="Edit title">
                            <svg class="icon" style="width:12px;height:12px" aria-hidden="true"><use href="#icon-edit"/></svg>
                        </button>
                        <button class="library-item-export" data-id="${item.id}" aria-label="Export" title="Export">
                            <svg class="icon" style="width:12px;height:12px" aria-hidden="true"><use href="#icon-download"/></svg>
                        </button>
                        <button class="library-item-delete" data-id="${item.id}" aria-label="Delete" title="Delete">
                            <svg class="icon" style="width:12px;height:12px" aria-hidden="true"><use href="#icon-trash"/></svg>
                        </button>
                    </div>
                </div>
                <div class="library-item-meta">
                    <span>${item.wordCount} words</span>
                    <div class="library-item-progress">
                        <div class="library-item-progress-bar">
                            <div class="library-item-progress-fill" style="width: ${item.progress}%"></div>
                        </div>
                        <span>${item.progress}%</span>
                    </div>
                    <span>${LibraryManager.formatRelativeTime(item.lastReadAt)}</span>
                </div>
            </div>
        `).join('');

        // Add click handlers
        libraryList.querySelectorAll('.library-item').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
                if (e.target.closest('.library-item-delete') || e.target.closest('.library-item-export') || e.target.closest('.library-item-edit')) return;
                this.loadFromLibrary(itemEl.dataset.id);
            });
        });

        libraryList.querySelectorAll('.library-item-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteFromLibrary(btn.dataset.id);
            });
        });

        libraryList.querySelectorAll('.library-item-export').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportLibraryItem(btn.dataset.id);
            });
        });

        libraryList.querySelectorAll('.library-item-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editLibraryItemTitle(btn.dataset.id);
            });
        });
    }

    searchLibrary(query) {
        const libraryList = DOM.get('libraryList');
        if (!libraryList) return;
        
        const allItems = libraryList.querySelectorAll('.library-item');
        allItems.forEach(item => {
            const title = item.querySelector('.library-item-title')?.textContent.toLowerCase() || '';
            item.style.display = title.includes(query.toLowerCase()) ? '' : 'none';
        });
    }

    loadFromLibrary(id) {
        const item = LibraryManager.get(id);
        if (!item) return;

        this.currentLibraryItemId = id;

        const textInput = DOM.get('textInput');
        if (textInput) textInput.value = item.text;
        this.updateWordCount();
        
        Panels.closeLibrary();
        this.loadText();
        
        if (item.currentPosition > 0 && !item.completed) {
            setTimeout(() => {
                RSVPEngine.seek(item.currentPosition);
                Toast.success(`Resumed from word ${item.currentPosition + 1}`);
            }, 100);
        }
    }

    deleteFromLibrary(id) {
        if (confirm('Delete this text from your library?')) {
            LibraryManager.remove(id);
            this.renderLibrary();
            Toast.success('Removed from library');
        }
    }

    clearLibrary() {
        if (confirm('Clear your entire library? This cannot be undone.')) {
            LibraryManager.clear();
            this.renderLibrary();
            Toast.success('Library cleared');
        }
    }

    exportLibrary() {
        if (LibraryManager.isEmpty()) {
            Toast.error('Library is empty');
            return;
        }
        
        if (LibraryManager.exportAll()) {
            Toast.success('Library exported');
        } else {
            Toast.error('Export failed');
        }
    }

    exportLibraryItem(id) {
        if (LibraryManager.exportItem(id)) {
            Toast.success('Text exported');
        } else {
            Toast.error('Export failed');
        }
    }

    editLibraryItemTitle(id) {
        const item = LibraryManager.get(id);
        if (!item) return;

        const titleEl = document.querySelector(`.library-item-title[data-id="${id}"]`);
        if (!titleEl) return;

        // Create inline input
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'library-item-title-input';
        input.value = item.title;
        input.maxLength = 100;

        const originalTitle = item.title;
        
        const saveTitle = () => {
            const newTitle = input.value.trim();
            if (newTitle && newTitle !== originalTitle) {
                LibraryManager.updateTitle(id, newTitle);
                Toast.success('Title updated');
            }
            this.renderLibrary();
        };

        const cancelEdit = () => {
            this.renderLibrary();
        };

        input.addEventListener('blur', saveTitle);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                input.removeEventListener('blur', saveTitle);
                cancelEdit();
            }
        });

        titleEl.replaceWith(input);
        input.focus();
        input.select();
    }

    async importLibrary(files) {
        if (!files || files.length === 0) return;
        
        let totalImported = 0;
        
        for (const file of files) {
            if (file.name.endsWith('.json')) {
                const result = await LibraryManager.importFromJson(file);
                if (result.success) {
                    totalImported += result.count;
                } else {
                    Toast.error(`Failed to import ${file.name}: ${result.error}`);
                }
            } else if (file.name.endsWith('.txt')) {
                const result = await LibraryManager.importTextFile(file);
                if (result.success) {
                    totalImported++;
                } else {
                    Toast.error(`Failed to import ${file.name}: ${result.error}`);
                }
            }
        }
        
        // Clear the input so the same file can be imported again
        const input = DOM.get('libraryImportInput');
        if (input) input.value = '';
        
        if (totalImported > 0) {
            this.renderLibrary();
            Toast.success(`Imported ${totalImported} text${totalImported > 1 ? 's' : ''}`);
        }
    }

    saveToLibrary(text, title = null) {
        const item = LibraryManager.add(text, title, {});
        this.currentLibraryItemId = item.id;
        Toast.success('Saved to library');
        return item;
    }

    updateLibraryProgress(index) {
        if (this.currentLibraryItemId) {
            LibraryManager.updatePosition(this.currentLibraryItemId, index, State.get('wpm'));
        }
    }

    // ============================================
    // SECTIONS & NAVIGATION
    // ============================================

    showInputSection() {
        // Save progress BEFORE stop() resets currentIndex
        if (this.currentLibraryItemId) {
            const state = RSVPEngine.getState();
            // Only update if not already completed (don't overwrite 100% with 1%)
            const item = LibraryManager.get(this.currentLibraryItemId);
            if (item && !item.completed) {
                this.updateLibraryProgress(state.currentIndex);
            }
        }
        
        RSVPEngine.stop();
        AnalyticsManager.endSession();
        
        this.currentLibraryItemId = null;
        ReaderDisplay.showInput();
    }

    // ============================================
    // PLAYBACK
    // ============================================

    togglePlayback() {
        if (!RSVPEngine.isLoaded()) {
            this.loadText();
            if (RSVPEngine.isLoaded()) {
                RSVPEngine.play();
            }
            return;
        }
        RSVPEngine.toggle();
    }

    resetReading() {
        RSVPEngine.stop();
        RSVPEngine.seek(0);
        
        const word = RSVPEngine.getCurrentWord();
        if (word) {
            const state = RSVPEngine.getState();
            ReaderDisplay.updateWord(word);
            ReaderDisplay.updateProgress(0, state.totalWords, state.remainingMs);
        }
    }

    adjustWpm(delta) {
        const current = State.get('wpm');
        const newWpm = Math.max(CONFIG.WPM.MIN, Math.min(CONFIG.WPM.MAX, current + delta));
        RSVPEngine.updateWPM(newWpm);
        ReaderDisplay.updateWpmDisplay(newWpm);
    }

    editWpm() {
        const wpmDisplay = DOM.get('wpmDisplay');
        if (!wpmDisplay) return;
        
        const currentWpm = State.get('wpm');
        
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'wpm-input';
        input.value = currentWpm;
        input.min = CONFIG.WPM.MIN;
        input.max = CONFIG.WPM.MAX;
        
        wpmDisplay.style.display = 'none';
        wpmDisplay.parentNode.insertBefore(input, wpmDisplay);
        input.focus();
        input.select();
        
        const finishEdit = () => {
            let newWpm = parseInt(input.value) || currentWpm;
            newWpm = Math.max(CONFIG.WPM.MIN, Math.min(CONFIG.WPM.MAX, newWpm));
            
            RSVPEngine.updateWPM(newWpm);
            ReaderDisplay.updateWpmDisplay(newWpm);
            wpmDisplay.style.display = '';
            input.remove();
        };
        
        input.addEventListener('blur', finishEdit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishEdit();
            } else if (e.key === 'Escape') {
                wpmDisplay.style.display = '';
                input.remove();
            }
        });
    }

    seekToPosition(e) {
        const progressBar = DOM.get('progressBar');
        if (!progressBar) return;
        
        const rect = progressBar.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        const totalWords = RSVPEngine.getAllWords().length;
        const index = Math.floor(ratio * totalWords);
        RSVPEngine.seek(index);
    }

    // ============================================
    // FOCUS MODE
    // ============================================

    enterFocusMode() {
        ReaderDisplay.enterFocusMode(
            RSVPEngine.getState(),
            RSVPEngine.getCurrentWord(),
            RSVPEngine.getAllWords()
        );
    }

    exitFocusMode() {
        ReaderDisplay.exitFocusMode();
    }

    // ============================================
    // COMPLETION
    // ============================================

    handleCompletion() {
        const session = AnalyticsManager.endSession();
        const summary = AnalyticsManager.getSummary();
        
        ReaderDisplay.showCompletion(session, summary);
        
        // Mark as completed in library
        if (this.currentLibraryItemId) {
            LibraryManager.updatePosition(
                this.currentLibraryItemId,
                RSVPEngine.getAllWords().length - 1,
                State.get('wpm')
            );
        }
        
        // Speed Training: increase WPM for next session
        if (State.get('speedTrainingEnabled')) {
            this.applySpeedTrainingIncrement();
        }
    }

    applySpeedTrainingIncrement() {
        const currentWpm = State.get('wpm');
        const increment = State.get('speedTrainingIncrement');
        const maxWpm = State.get('speedTrainingMaxWpm');
        const newWpm = Math.min(currentWpm + increment, maxWpm);
        
        if (newWpm > currentWpm) {
            State.set('wpm', newWpm);
            RSVPEngine.updateWPM(newWpm);
            ReaderDisplay.updateWpmDisplay(newWpm);
            Toast.success(`Speed Training: WPM increased to ${newWpm}!`);
            SettingsUI.updateSpeedTrainingProgress();
        } else {
            Toast.success(`You've reached your max training WPM of ${maxWpm}!`);
        }
    }

    restartReading() {
        ReaderDisplay.hideCompletion();
        RSVPEngine.stop();
        RSVPEngine.seek(0);
        AnalyticsManager.startSession();
        
        const word = RSVPEngine.getCurrentWord();
        if (word) {
            const state = RSVPEngine.getState();
            ReaderDisplay.updateWord(word);
            ReaderDisplay.updateProgress(0, state.totalWords, state.remainingMs);
        }
        
        RSVPEngine.play();
    }

    // ============================================
    // SOUND
    // ============================================

    toggleSound() {
        SoundManager.toggle();
        SettingsUI.updateSoundSelector(SoundManager.getActiveSound());
    }

    // ============================================
    // STATS
    // ============================================

    openStats() {
        Panels.openStats(() => this.renderStats());
    }

    renderStats() {
        const summary = AnalyticsManager.getSummary();
        
        const statsTotalWords = DOM.get('statsTotalWords');
        const statsTotalTime = DOM.get('statsTotalTime');
        const statsStreak = DOM.get('statsStreak');
        const statsSessions = DOM.get('statsSessions');
        
        if (statsTotalWords) statsTotalWords.textContent = AnalyticsManager.formatWordCount(summary.totalWordsRead);
        if (statsTotalTime) statsTotalTime.textContent = AnalyticsManager.formatDuration(summary.totalTimeSpent);
        if (statsStreak) statsStreak.textContent = summary.currentStreak;
        if (statsSessions) statsSessions.textContent = summary.totalSessions;
        
        this.renderStreakCalendar();
        this.renderWpmChart();
    }

    renderStreakCalendar() {
        const calendarData = AnalyticsManager.getStreakCalendar();
        const container = DOM.get('streakCalendar');
        if (!container) return;
        
        // Full year: weeks as columns (53 max), days (Sun-Sat) as rows
        const weeks = [];
        let currentWeek = [];
        
        // Pad the beginning if Jan 1 isn't Sunday
        const firstDayOfWeek = calendarData[0]?.dayOfWeek || 0;
        for (let i = 0; i < firstDayOfWeek; i++) {
            currentWeek.push({ empty: true });
        }
        
        for (const day of calendarData) {
            currentWeek.push(day);
            
            if (day.dayOfWeek === 6) {
                weeks.push(currentWeek);
                currentWeek = [];
            }
        }
        
        // Push remaining partial week
        if (currentWeek.length > 0) {
            // Pad to complete the week
            while (currentWeek.length < 7) {
                currentWeek.push({ empty: true });
            }
            weeks.push(currentWeek);
        }
        
        // Render grid
        container.innerHTML = weeks.map(week => `
            <div class="streak-week">
                ${week.map(day => {
                    if (day.empty) return `<div class="streak-day empty"></div>`;
                    const classes = ['streak-day', `level-${day.level}`];
                    if (day.isFuture) classes.push('future');
                    return `<div class="${classes.join(' ')}" title="${day.date}: ${day.wordsRead} words"></div>`;
                }).join('')}
            </div>
        `).join('');
    }

    renderWpmChart() {
        const history = AnalyticsManager.getWpmHistory(30);
        const canvas = DOM.get('wpmChartCanvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width - 16;
        canvas.height = rect.height - 16;
        
        const width = canvas.width;
        const height = canvas.height;
        const padding = { top: 10, right: 10, bottom: 20, left: 35 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        ctx.clearRect(0, 0, width, height);
        
        const dataWithValues = history.filter(d => d.avgWpm > 0);
        const wpmChartAvg = DOM.get('wpmChartAvg');
        const wpmChartBest = DOM.get('wpmChartBest');
        
        if (dataWithValues.length === 0) {
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted');
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No reading data yet', width / 2, height / 2);
            if (wpmChartAvg) wpmChartAvg.textContent = '0';
            if (wpmChartBest) wpmChartBest.textContent = '0';
            return;
        }
        
        const values = dataWithValues.map(d => d.avgWpm);
        const maxWpm = Math.max(...values);
        const minWpm = Math.min(...values);
        const avgWpm = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
        
        if (wpmChartAvg) wpmChartAvg.textContent = avgWpm;
        if (wpmChartBest) wpmChartBest.textContent = maxWpm;
        
        const yMin = Math.floor(minWpm / 50) * 50;
        const yMax = Math.ceil(maxWpm / 50) * 50 + 50;
        const yScale = chartHeight / (yMax - yMin);
        const xScale = chartWidth / (history.length - 1);
        
        // Grid lines
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-border-subtle');
        ctx.lineWidth = 1;
        
        for (let wpm = yMin; wpm <= yMax; wpm += 100) {
            const y = padding.top + chartHeight - (wpm - yMin) * yScale;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted');
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(wpm.toString(), padding.left - 5, y + 3);
        }
        
        // Line
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        
        let started = false;
        history.forEach((day, i) => {
            if (day.avgWpm === 0) return;
            
            const x = padding.left + i * xScale;
            const y = padding.top + chartHeight - (day.avgWpm - yMin) * yScale;
            
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();
        
        // Points
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
        history.forEach((day, i) => {
            if (day.avgWpm === 0) return;
            
            const x = padding.left + i * xScale;
            const y = padding.top + chartHeight - (day.avgWpm - yMin) * yScale;
            
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    resetStats() {
        if (confirm('Reset all reading statistics?')) {
            AnalyticsManager.reset();
            this.renderStats();
            Toast.success('Statistics reset');
        }
    }

    resetShortcuts() {
        if (confirm('Reset all keyboard shortcuts to defaults?')) {
            KeyboardManager.resetToDefaults();
            this.setupShortcuts(); // Re-render shortcuts list
            Toast.success('Shortcuts reset to defaults');
        }
    }

    // ============================================
    // COMPREHENSION
    // ============================================

    showComprehensionCheck() {
        // Randomly choose question type for variety (70% word check, 30% reflection)
        const questionType = Math.random() < 0.7 ? null : 'reflection';
        const question = Comprehension.generate(questionType);
        
        const comprehensionQuestion = DOM.get('comprehensionQuestion');
        const comprehensionOptions = DOM.get('comprehensionOptions');
        
        if (comprehensionQuestion) {
            if (question.type === 'reflection' && question.followUp) {
                // Show main question with follow-up
                comprehensionQuestion.innerHTML = `
                    <span class="reflection-prompt">${escapeHTML(question.question)}</span>
                    <span class="reflection-followup">${escapeHTML(question.followUp)}</span>
                `;
            } else {
                comprehensionQuestion.textContent = question.question;
            }
        }
        
        if (comprehensionOptions) {
            if (question.type === 'wordCheck') {
                // Word check - which word did NOT appear
                comprehensionOptions.innerHTML = question.options.map(word => `
                    <button class="comprehension-option" data-word="${escapeHTML(word)}">${escapeHTML(word)}</button>
                `).join('');

                comprehensionOptions.onclick = (e) => {
                    const btn = e.target.closest('.comprehension-option');
                    if (!btn) return;

                    const selected = btn.dataset.word;
                    const isCorrect = selected === question.correct;

                    btn.classList.add(isCorrect ? 'correct' : 'incorrect');
                    
                    if (!isCorrect) {
                        const correctBtn = comprehensionOptions.querySelector(`[data-word="${question.correct}"]`);
                        if (correctBtn) correctBtn.classList.add('correct');
                    }

                    setTimeout(() => {
                        Panels.closeComprehension();
                        RSVPEngine.play();
                    }, 1500);
                };
            } else if (question.type === 'reflection') {
                // Reflection question - show self-assessment options
                comprehensionOptions.innerHTML = question.options.map(option => `
                    <button class="comprehension-option reflection-option">${escapeHTML(option)}</button>
                `).join('');

                comprehensionOptions.onclick = (e) => {
                    const btn = e.target.closest('.comprehension-option');
                    if (!btn) return;
                    
                    // Mark selected
                    btn.classList.add('selected');
                    
                    setTimeout(() => {
                        Panels.closeComprehension();
                        RSVPEngine.play();
                    }, 500);
                };
            } else if (question.type === 'wordCount') {
                // Word count question
                comprehensionOptions.innerHTML = question.options.map(count => `
                    <button class="comprehension-option" data-count="${count}">${count} words</button>
                `).join('');

                comprehensionOptions.onclick = (e) => {
                    const btn = e.target.closest('.comprehension-option');
                    if (!btn) return;

                    const selected = parseInt(btn.dataset.count, 10);
                    const isCorrect = selected === question.correct;

                    btn.classList.add(isCorrect ? 'correct' : 'incorrect');
                    
                    if (!isCorrect) {
                        const correctBtn = comprehensionOptions.querySelector(`[data-count="${question.correct}"]`);
                        if (correctBtn) correctBtn.classList.add('correct');
                    }

                    setTimeout(() => {
                        Panels.closeComprehension();
                        RSVPEngine.play();
                    }, 1500);
                };
            }
        }

        Panels.openComprehension();
        
        // Bind skip buttons (rebind each time to ensure they work)
        const btnSkip = DOM.get('btnSkipComprehension');
        const btnSkipText = DOM.get('btnSkipComprehensionText');
        
        if (btnSkip) {
            btnSkip.onclick = () => this.skipComprehension();
        }
        if (btnSkipText) {
            btnSkipText.onclick = () => this.skipComprehension();
        }
        
        // Add Escape key listener (keyboard manager is disabled during modals)
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.skipComprehension();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }
    
    skipComprehension() {
        Panels.closeComprehension();
        RSVPEngine.play();
    }
    
    // ============================================
    // SETTINGS EXPORT/IMPORT
    // ============================================
    
    exportSettings() {
        const settings = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            settings: State.getAll(),
            keyBindings: State.get('keyBindings') || {}
        };
        
        // Remove transient state
        delete settings.settings.isPlaying;
        delete settings.settings.currentIndex;
        delete settings.settings.words;
        delete settings.settings.currentText;
        
        const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rsvp-settings-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        Toast.show('Settings exported successfully', 'success');
    }
    
    importSettings(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (!data.settings || typeof data.settings !== 'object') {
                    throw new Error('Invalid settings file format');
                }
                
                // Validate and apply settings
                const validKeys = [
                    'wpm', 'fontSize', 'fontFamily', 'chunkSize', 'theme', 'accentColor',
                    'orpEnabled', 'boldEnabled', 'peripheralEnabled', 'warmupEnabled',
                    'comprehensionEnabled', 'comprehensionInterval', 'pauseOnLongWords',
                    'pauseOnPunctuation', 'soundEnabled', 'soundType', 'soundVolume',
                    'speedTrainingEnabled', 'speedIncrement', 'speedMaxWpm', 'keyBindings',
                    'activeProfile'
                ];
                
                const importedSettings = {};
                for (const key of validKeys) {
                    if (key in data.settings) {
                        importedSettings[key] = data.settings[key];
                    }
                }
                
                State.setMultiple(importedSettings, true);
                
                // Refresh UI
                SettingsUI.syncWithState();
                ReaderDisplay.updateWordStyle();
                Theme.init();
                
                Toast.show('Settings imported successfully', 'success');
            } catch (err) {
                Toast.show('Failed to import settings: ' + err.message, 'error');
            }
        };
        
        reader.onerror = () => {
            Toast.show('Failed to read settings file', 'error');
        };
        
        reader.readAsText(file);
        event.target.value = ''; // Reset input
    }
}

// ============================================
// SERVICE WORKER
// ============================================

function registerServiceWorker() {
    const isSecureContext = window.isSecureContext;
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    
    if (!('serviceWorker' in navigator)) {
        console.log('[PWA] Service workers not supported');
        return;
    }
    
    if (!isSecureContext && !isLocalhost) {
        console.log('[PWA] Service worker requires HTTPS. Skipping registration on HTTP.');
        return;
    }
    
    window.addEventListener('load', () => {
        const swPath = new URL('sw.js', window.location.href).pathname;
        navigator.serviceWorker.register(swPath)
            .then((registration) => {
                console.log('[PWA] Service worker registered:', registration.scope);
                
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    console.log('[PWA] New service worker installing...');
                    
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('[PWA] New version available! Refresh to update.');
                        }
                    });
                });
            })
            .catch((error) => {
                console.log('[PWA] Service worker registration failed:', error);
            });
    });
}

registerServiceWorker();

// ============================================
// INITIALIZE
// ============================================

const app = new App();
app.init();

// Expose for debugging
window.RSVPApp = app;
window.RSVPEngine = RSVPEngine;
window.State = State;
