/**
 * RSVP Reader - Analytics Manager Module
 * Tracks reading statistics, sessions, and progress over time.
 */

import { CONFIG } from './config.js';
import { Storage } from './storage.js';
import { EventBus, Events } from './event-bus.js';

/**
 * @typedef {Object} SessionData
 * @property {number} startTime - Session start timestamp
 * @property {number} endTime - Session end timestamp
 * @property {number} wordsRead - Words read in session
 * @property {number} avgWpm - Average WPM for session
 * @property {number} duration - Session duration in ms
 */

/**
 * @typedef {Object} DailyStats
 * @property {string} date - Date string (YYYY-MM-DD)
 * @property {number} wordsRead - Total words read
 * @property {number} timeSpent - Time spent reading (ms)
 * @property {number} sessions - Number of sessions
 * @property {number} avgWpm - Average WPM
 */

/**
 * @typedef {Object} AnalyticsData
 * @property {number} totalWordsRead - Lifetime words read
 * @property {number} totalTimeSpent - Lifetime time spent (ms)
 * @property {number} totalSessions - Lifetime session count
 * @property {number} currentStreak - Current day streak
 * @property {number} longestStreak - Longest day streak
 * @property {string} lastReadDate - Last reading date (YYYY-MM-DD)
 * @property {Object<string, DailyStats>} dailyStats - Stats by date
 */

/**
 * Analytics Manager Class
 * Tracks and persists reading statistics.
 */
class AnalyticsManagerClass {
    constructor() {
        /** @type {AnalyticsData} */
        this._data = null;
        
        /** @type {SessionData|null} */
        this._currentSession = null;
        
        /** @type {boolean} */
        this._initialized = false;
        
        /** @type {number|null} */
        this._updateTimer = null;
        
        /** @type {number} */
        this._sessionWordsRead = 0;
        
        /** @type {number} */
        this._sessionWpmSum = 0;
        
        /** @type {number} */
        this._sessionWpmCount = 0;
    }

    /**
     * Initialize analytics manager
     * @returns {AnalyticsManagerClass}
     */
    init() {
        if (this._initialized) {
            return this;
        }
        
        this._loadData();
        this._initialized = true;
        
        return this;
    }

    /**
     * Ensure analytics is initialized
     * @private
     */
    _ensureInitialized() {
        if (!this._initialized) {
            console.warn('AnalyticsManager: Not initialized, call init() first');
            this.init();
        }
    }

    /**
     * Load analytics data from storage
     * @private
     */
    _loadData() {
        const defaultData = {
            totalWordsRead: 0,
            totalTimeSpent: 0,
            totalSessions: 0,
            currentStreak: 0,
            longestStreak: 0,
            lastReadDate: null,
            dailyStats: {}
        };
        
        this._data = Storage.get(CONFIG.STORAGE_KEYS.ANALYTICS, {
            validator: this._validateData.bind(this),
            defaultValue: defaultData
        });
        
        // Update streak on load
        this._updateStreak();
    }

    /**
     * Save analytics data to storage
     * @private
     * @returns {boolean} True if save succeeded
     */
    _saveData() {
        try {
            Storage.set(CONFIG.STORAGE_KEYS.ANALYTICS, this._data, { createBackup: true });
            return true;
        } catch (e) {
            console.error('AnalyticsManager: Failed to save data:', e);
            return false;
        }
    }

    /**
     * Validate analytics data structure
     * @private
     * @param {any} data
     * @returns {boolean}
     */
    _validateData(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }
        
        // Check required number fields - must be non-negative
        const requiredNumbers = [
            'totalWordsRead', 
            'totalTimeSpent', 
            'totalSessions',
            'currentStreak',
            'longestStreak'
        ];
        
        for (const field of requiredNumbers) {
            if (typeof data[field] !== 'number' || isNaN(data[field]) || data[field] < 0) {
                return false;
            }
        }
        
        // Check dailyStats is a plain object (not array, not null)
        if (typeof data.dailyStats !== 'object' || 
            data.dailyStats === null || 
            Array.isArray(data.dailyStats)) {
            return false;
        }
        
        // lastReadDate should be string or null
        if (data.lastReadDate !== null && typeof data.lastReadDate !== 'string') {
            return false;
        }
        
        // Validate lastReadDate format if present (YYYY-MM-DD)
        if (data.lastReadDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(data.lastReadDate)) {
            return false;
        }
        
        return true;
    }

    /**
     * Get today's date string in LOCAL timezone
     * @private
     * @returns {string} YYYY-MM-DD
     */
    _getToday() {
        return this._formatLocalDate(new Date());
    }

    /**
     * Get yesterday's date string in LOCAL timezone
     * @private
     * @returns {string} YYYY-MM-DD
     */
    _getYesterday() {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return this._formatLocalDate(yesterday);
    }

    /**
     * Format a date to YYYY-MM-DD in LOCAL timezone
     * @private
     * @param {Date} date
     * @returns {string} YYYY-MM-DD
     */
    _formatLocalDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Update streak based on last read date
     * Called on load to check if streak was broken
     * @private
     */
    _updateStreak() {
        const today = this._getToday();
        const yesterday = this._getYesterday();
        
        if (!this._data.lastReadDate) {
            // No previous reading, streak should be 0
            if (this._data.currentStreak !== 0) {
                this._data.currentStreak = 0;
                this._saveData();
            }
            return;
        }
        
        if (this._data.lastReadDate === today) {
            // Already read today, streak is current
            return;
        }
        
        if (this._data.lastReadDate === yesterday) {
            // Read yesterday, streak continues when they read today
            return;
        }
        
        // Streak broken - reset and save
        if (this._data.currentStreak !== 0) {
            this._data.currentStreak = 0;
            this._saveData();
        }
    }

    /**
     * Start a new reading session
     * @returns {boolean} True if session started
     */
    startSession() {
        this._ensureInitialized();
        
        if (this._currentSession) {
            // End any existing session first
            this.endSession();
        }
        
        this._currentSession = {
            startTime: Date.now(),
            endTime: null,
            wordsRead: 0,
            avgWpm: 0,
            duration: 0
        };
        
        this._sessionWordsRead = 0;
        this._sessionWpmSum = 0;
        this._sessionWpmCount = 0;
        
        // Start periodic updates
        this._startUpdateTimer();
        
        EventBus.emit(Events.SESSION_START);
        return true;
    }

    /**
     * End the current reading session
     * @returns {SessionData|null} The completed session data
     */
    endSession() {
        if (!this._currentSession) {
            return null;
        }
        
        this._ensureInitialized();
        
        // Stop update timer
        this._stopUpdateTimer();
        
        // Finalize session
        const now = Date.now();
        this._currentSession.endTime = now;
        this._currentSession.duration = now - this._currentSession.startTime;
        this._currentSession.wordsRead = this._sessionWordsRead;
        this._currentSession.avgWpm = this._sessionWpmCount > 0 
            ? Math.round(this._sessionWpmSum / this._sessionWpmCount)
            : 0;
        
        // Store session copy before clearing (in case save fails)
        const session = { ...this._currentSession };
        
        // Only count sessions with actual reading
        if (session.wordsRead > 0) {
            // Update totals
            this._data.totalWordsRead += session.wordsRead;
            this._data.totalTimeSpent += session.duration;
            this._data.totalSessions++;
            
            // Update daily stats
            this._updateDailyStats(session);
            
            // Update streak
            this._updateStreakOnRead();
            
            // Save - log warning if fails but don't crash
            if (!this._saveData()) {
                console.warn('AnalyticsManager: Failed to save session data');
            }
        }
        
        this._currentSession = null;
        
        EventBus.emit(Events.SESSION_END, session);
        EventBus.emit(Events.ANALYTICS_UPDATED, this.getSummary());
        
        return session;
    }

    /**
     * Track words read during session
     * @param {number} count - Number of words read
     * @param {number} wpm - Current WPM
     * @returns {boolean} True if tracking succeeded
     */
    trackWords(count, wpm) {
        if (!this._currentSession) {
            return false;
        }
        
        // Validate count
        if (typeof count !== 'number' || isNaN(count) || count < 0) {
            return false;
        }
        
        // Validate wpm
        if (typeof wpm !== 'number' || isNaN(wpm) || wpm <= 0) {
            return false;
        }
        
        this._sessionWordsRead += Math.floor(count);
        this._sessionWpmSum += wpm;
        this._sessionWpmCount++;
        
        return true;
    }

    /**
     * Get current session duration in milliseconds
     * @returns {number} Duration in ms, or 0 if no active session
     */
    getSessionDuration() {
        if (!this._currentSession) {
            return 0;
        }
        return Date.now() - this._currentSession.startTime;
    }

    /**
     * Pause the current session (stops timer but keeps session data)
     * @returns {boolean} True if session was paused
     */
    pauseSession() {
        if (!this._currentSession) {
            return false;
        }
        
        // Stop the update timer but don't end the session
        this._stopUpdateTimer();
        
        // Store pause time for duration calculation
        if (!this._currentSession.pausedAt) {
            this._currentSession.pausedAt = Date.now();
        }
        
        EventBus.emit(Events.SESSION_PAUSE);
        return true;
    }

    /**
     * Resume a paused session
     * @returns {boolean} True if session was resumed
     */
    resumeSession() {
        if (!this._currentSession) {
            return false;
        }
        
        // Adjust start time to account for pause duration
        if (this._currentSession.pausedAt) {
            const pauseDuration = Date.now() - this._currentSession.pausedAt;
            this._currentSession.startTime += pauseDuration;
            delete this._currentSession.pausedAt;
        }
        
        // Restart the update timer
        this._startUpdateTimer();
        
        EventBus.emit(Events.SESSION_RESUME);
        return true;
    }

    /**
     * Check if session is currently paused
     * @returns {boolean}
     */
    isSessionPaused() {
        return this._currentSession !== null && this._currentSession.pausedAt !== undefined;
    }

    /**
     * Update daily stats with session data
     * @private
     * @param {SessionData} session
     */
    _updateDailyStats(session) {
        // Validate session has required properties
        if (!session || 
            typeof session.wordsRead !== 'number' || 
            typeof session.duration !== 'number' ||
            typeof session.avgWpm !== 'number') {
            console.warn('AnalyticsManager: Invalid session data for daily stats');
            return;
        }
        
        const today = this._getToday();
        
        if (!this._data.dailyStats[today]) {
            this._data.dailyStats[today] = {
                date: today,
                wordsRead: 0,
                timeSpent: 0,
                sessions: 0,
                avgWpm: 0
            };
        }
        
        const stats = this._data.dailyStats[today];
        const prevTotal = stats.wordsRead || 0;
        const prevAvg = stats.avgWpm || 0;
        
        stats.wordsRead += session.wordsRead;
        stats.timeSpent += session.duration;
        stats.sessions++;
        
        // Weighted average WPM
        if (stats.wordsRead > 0) {
            stats.avgWpm = Math.round(
                (prevAvg * prevTotal + session.avgWpm * session.wordsRead) / stats.wordsRead
            );
        }
        
        // Prune old daily stats periodically (not every session - check if needed)
        this._maybePruneOldStats();
    }

    /**
     * Maybe prune old stats - only prunes if we have more than 100 entries
     * @private
     */
    _maybePruneOldStats() {
        const keys = Object.keys(this._data.dailyStats);
        // Only prune if we have more than 100 entries to avoid frequent checks
        if (keys.length > 100) {
            this._pruneOldStats();
        }
    }

    /**
     * Update streak when user reads
     * @private
     */
    _updateStreakOnRead() {
        const today = this._getToday();
        const yesterday = this._getYesterday();
        
        if (this._data.lastReadDate === today) {
            // Already counted today
            return;
        }
        
        if (this._data.lastReadDate === yesterday || !this._data.lastReadDate) {
            // Continue or start streak
            this._data.currentStreak++;
        } else {
            // Streak was broken, start new
            this._data.currentStreak = 1;
        }
        
        // Update longest streak
        if (this._data.currentStreak > this._data.longestStreak) {
            this._data.longestStreak = this._data.currentStreak;
        }
        
        this._data.lastReadDate = today;
    }

    /**
     * Prune daily stats older than 90 days
     * @private
     */
    _pruneOldStats() {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = this._formatLocalDate(cutoff);
        
        let pruneCount = 0;
        for (const date of Object.keys(this._data.dailyStats)) {
            if (date < cutoffStr) {
                delete this._data.dailyStats[date];
                pruneCount++;
            }
        }
        
        if (pruneCount > 0) {
            console.log(`AnalyticsManager: Pruned ${pruneCount} old daily stats entries`);
        }
    }

    /**
     * Start periodic update timer
     * @private
     */
    _startUpdateTimer() {
        this._stopUpdateTimer();
        
        this._updateTimer = setInterval(() => {
            // Emit periodic update for UI
            EventBus.emit(Events.ANALYTICS_UPDATED, this.getSummary());
        }, CONFIG.TIMING.ANALYTICS_UPDATE_INTERVAL_MS);
    }

    /**
     * Stop periodic update timer
     * @private
     */
    _stopUpdateTimer() {
        if (this._updateTimer) {
            clearInterval(this._updateTimer);
            this._updateTimer = null;
        }
    }

    // ============================================
    // PUBLIC GETTERS
    // ============================================

    /**
     * Get analytics summary
     * @returns {Object}
     */
    getSummary() {
        this._ensureInitialized();
        
        const today = this._getToday();
        const todayStats = this._data.dailyStats[today] || {
            wordsRead: 0,
            timeSpent: 0,
            sessions: 0,
            avgWpm: 0
        };
        
        return {
            // Lifetime stats
            totalWordsRead: this._data.totalWordsRead,
            totalTimeSpent: this._data.totalTimeSpent,
            totalSessions: this._data.totalSessions,
            
            // Streak
            currentStreak: this._data.currentStreak,
            longestStreak: this._data.longestStreak,
            
            // Today
            todayWordsRead: todayStats.wordsRead,
            todayTimeSpent: todayStats.timeSpent,
            todaySessions: todayStats.sessions,
            todayAvgWpm: todayStats.avgWpm,
            
            // Current session
            sessionActive: this._currentSession !== null,
            sessionWordsRead: this._sessionWordsRead,
            sessionDuration: this._currentSession 
                ? Date.now() - this._currentSession.startTime 
                : 0
        };
    }

    /**
     * Get daily stats for a date range
     * @param {number} [days=7] - Number of days to retrieve (1-365)
     * @returns {DailyStats[]}
     */
    getDailyStats(days = 7) {
        this._ensureInitialized();
        
        // Validate and clamp days parameter
        let validDays = days;
        if (typeof days !== 'number' || isNaN(days)) {
            validDays = 7;
        }
        validDays = Math.max(1, Math.min(365, Math.floor(validDays)));
        
        const stats = [];
        const today = new Date();
        
        for (let i = 0; i < validDays; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = this._formatLocalDate(date);
            
            stats.push(this._data.dailyStats[dateStr] || {
                date: dateStr,
                wordsRead: 0,
                timeSpent: 0,
                sessions: 0,
                avgWpm: 0
            });
        }
        
        return stats.reverse(); // Oldest first
    }

    /**
     * Get streak information
     * @returns {{ current: number, longest: number, lastRead: string|null }}
     */
    getStreak() {
        this._ensureInitialized();
        
        return {
            current: this._data.currentStreak,
            longest: this._data.longestStreak,
            lastRead: this._data.lastReadDate
        };
    }

    /**
     * Check if there's an active session
     * @returns {boolean}
     */
    hasActiveSession() {
        return this._currentSession !== null;
    }

    /**
     * Get current session info
     * @returns {Object|null}
     */
    getCurrentSession() {
        if (!this._currentSession) {
            return null;
        }
        
        return {
            startTime: this._currentSession.startTime,
            duration: Date.now() - this._currentSession.startTime,
            wordsRead: this._sessionWordsRead,
            avgWpm: this._sessionWpmCount > 0 
                ? Math.round(this._sessionWpmSum / this._sessionWpmCount)
                : 0
        };
    }

    /**
     * Get recent average WPM (based on stored daily stats, up to 90 days)
     * Note: This is limited to the retention period of dailyStats
     * @returns {number}
     */
    getRecentAvgWpm() {
        this._ensureInitialized();
        
        let totalWpm = 0;
        let count = 0;
        
        for (const stats of Object.values(this._data.dailyStats)) {
            if (stats && typeof stats.avgWpm === 'number' && stats.avgWpm > 0 && 
                typeof stats.wordsRead === 'number' && stats.wordsRead > 0) {
                totalWpm += stats.avgWpm * stats.wordsRead;
                count += stats.wordsRead;
            }
        }
        
        return count > 0 ? Math.round(totalWpm / count) : 0;
    }

    /**
     * Get lifetime average WPM (alias for getRecentAvgWpm for backward compatibility)
     * @deprecated Use getRecentAvgWpm() instead
     * @returns {number}
     */
    getLifetimeAvgWpm() {
        return this.getRecentAvgWpm();
    }

    /**
     * Reset all analytics data
     * @returns {boolean} True if reset succeeded
     */
    reset() {
        this._ensureInitialized();
        
        // Stop any active update timer
        this._stopUpdateTimer();
        
        this._data = {
            totalWordsRead: 0,
            totalTimeSpent: 0,
            totalSessions: 0,
            currentStreak: 0,
            longestStreak: 0,
            lastReadDate: null,
            dailyStats: {}
        };
        
        this._currentSession = null;
        this._sessionWordsRead = 0;
        this._sessionWpmSum = 0;
        this._sessionWpmCount = 0;
        
        const saved = this._saveData();
        
        EventBus.emit(Events.ANALYTICS_RESET);
        EventBus.emit(Events.ANALYTICS_UPDATED, this.getSummary());
        
        return saved;
    }

    /**
     * Format time duration for display
     * @param {number} ms - Milliseconds
     * @returns {string}
     */
    formatDuration(ms) {
        // Handle invalid input
        if (typeof ms !== 'number' || isNaN(ms) || ms < 0) {
            return '0s';
        }
        
        if (ms < 60000) {
            return `${Math.floor(ms / 1000)}s`;
        }
        
        const minutes = Math.floor(ms / 60000);
        if (minutes < 60) {
            return `${minutes}m`;
        }
        
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        
        if (hours < 24) {
            return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
        }
        
        // For very long durations (days)
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
    }

    /**
     * Format word count for display
     * @param {number} count
     * @returns {string}
     */
    formatWordCount(count) {
        // Handle invalid input
        if (typeof count !== 'number' || isNaN(count) || count < 0) {
            return '0';
        }
        
        const rounded = Math.floor(count);
        
        if (rounded < 1000) {
            return rounded.toString();
        }
        
        if (rounded < 10000) {
            // Show one decimal for 1k-9.9k
            return `${(rounded / 1000).toFixed(1)}k`;
        }
        
        if (rounded < 1000000) {
            // No decimal for 10k+
            return `${Math.round(rounded / 1000)}k`;
        }
        
        // Millions
        return `${(rounded / 1000000).toFixed(1)}M`;
    }

    /**
     * Get streak calendar data for the current year
     * Returns array of { date, wordsRead, level } for calendar visualization
     * @returns {Array<{ date: string, wordsRead: number, level: number, dayOfWeek: number, isFuture: boolean }>}
     */
    getStreakCalendar() {
        this._ensureInitialized();
        
        const today = new Date();
        const currentYear = today.getFullYear();
        
        // Start from January 1st of current year
        const startDate = new Date(currentYear, 0, 1);
        // End at December 31st of current year
        const endDate = new Date(currentYear, 11, 31);
        
        // Calculate total days in the year
        const totalDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        
        // Single pass: collect data and find max
        const calendarData = [];
        let maxWords = 0;
        
        for (let i = 0; i < totalDays; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            const dateStr = this._formatLocalDate(date);
            const stats = this._data.dailyStats[dateStr];
            const wordsRead = (stats && typeof stats.wordsRead === 'number') ? stats.wordsRead : 0;
            const isFuture = date > today;
            
            // Track max for non-future dates
            if (!isFuture && wordsRead > maxWords) {
                maxWords = wordsRead;
            }
            
            calendarData.push({
                date: dateStr,
                wordsRead,
                level: 0, // Will be calculated below
                dayOfWeek: date.getDay(),
                isFuture
            });
        }
        
        // Second pass: calculate levels (O(n) - much faster than two O(365) loops)
        if (maxWords > 0) {
            for (const entry of calendarData) {
                if (!entry.isFuture && entry.wordsRead > 0) {
                    const ratio = entry.wordsRead / maxWords;
                    if (ratio > 0.75) entry.level = 4;
                    else if (ratio > 0.5) entry.level = 3;
                    else if (ratio > 0.25) entry.level = 2;
                    else entry.level = 1;
                }
            }
        }
        
        return calendarData;
    }

    /**
     * Get WPM history for charting
     * @param {number} [days=30] - Number of days (1-365)
     * @returns {Array<{ date: string, avgWpm: number, wordsRead: number }>}
     */
    getWpmHistory(days = 30) {
        this._ensureInitialized();
        
        // Validate and clamp days parameter
        let validDays = days;
        if (typeof days !== 'number' || isNaN(days)) {
            validDays = 30;
        }
        validDays = Math.max(1, Math.min(365, Math.floor(validDays)));
        
        const history = [];
        const today = new Date();
        
        for (let i = validDays - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = this._formatLocalDate(date);
            const stats = this._data.dailyStats[dateStr];
            
            history.push({
                date: dateStr,
                avgWpm: (stats && typeof stats.avgWpm === 'number') ? stats.avgWpm : 0,
                wordsRead: (stats && typeof stats.wordsRead === 'number') ? stats.wordsRead : 0
            });
        }
        
        return history;
    }

    /**
     * Get reading activity summary for a period
     * @param {number} [days=30] - Number of days (1-365)
     * @returns {{ activeDays: number, totalDays: number, avgWordsPerDay: number, avgWpm: number }}
     */
    getActivitySummary(days = 30) {
        // getDailyStats already validates days and calls _ensureInitialized
        const stats = this.getDailyStats(days);
        
        let activeDays = 0;
        let totalWords = 0;
        let totalWpmWeighted = 0;
        let totalWpmWeight = 0;
        
        for (const day of stats) {
            if (day && typeof day.wordsRead === 'number' && day.wordsRead > 0) {
                activeDays++;
                totalWords += day.wordsRead;
                if (typeof day.avgWpm === 'number' && day.avgWpm > 0) {
                    totalWpmWeighted += day.avgWpm * day.wordsRead;
                    totalWpmWeight += day.wordsRead;
                }
            }
        }
        
        return {
            activeDays,
            totalDays: stats.length,
            avgWordsPerDay: activeDays > 0 ? Math.round(totalWords / activeDays) : 0,
            avgWpm: totalWpmWeight > 0 ? Math.round(totalWpmWeighted / totalWpmWeight) : 0
        };
    }

    /**
     * Clean up resources
     */
    destroy() {
        this._stopUpdateTimer();
        
        // End any active session
        if (this._currentSession) {
            this.endSession();
        }
        
        // Reset state
        this._data = null;
        this._sessionWordsRead = 0;
        this._sessionWpmSum = 0;
        this._sessionWpmCount = 0;
        this._initialized = false;
    }

    /**
     * Check if today has any reading activity
     * @returns {boolean}
     */
    hasReadToday() {
        this._ensureInitialized();
        const today = this._getToday();
        const stats = this._data.dailyStats[today];
        return stats && typeof stats.wordsRead === 'number' && stats.wordsRead > 0;
    }

    /**
     * Get estimated reading time based on word count and WPM
     * @param {number} wordCount - Number of words
     * @param {number} [wpm] - Words per minute (defaults to recent average)
     * @returns {{ minutes: number, formatted: string }}
     */
    estimateReadingTime(wordCount, wpm) {
        // Validate wordCount
        if (typeof wordCount !== 'number' || isNaN(wordCount) || wordCount <= 0) {
            return { minutes: 0, formatted: '0m' };
        }
        
        // Use provided WPM or fall back to recent average, then default to 250
        let effectiveWpm = wpm;
        if (typeof effectiveWpm !== 'number' || isNaN(effectiveWpm) || effectiveWpm <= 0) {
            effectiveWpm = this.getRecentAvgWpm() || 250;
        }
        
        const minutes = Math.ceil(wordCount / effectiveWpm);
        return {
            minutes,
            formatted: this.formatDuration(minutes * 60000)
        };
    }

    /**
     * Export analytics data for backup
     * @returns {AnalyticsData}
     */
    exportData() {
        this._ensureInitialized();
        return JSON.parse(JSON.stringify(this._data));
    }

    /**
     * Import analytics data from backup
     * @param {AnalyticsData} data - Data to import
     * @returns {boolean} True if import succeeded
     */
    importData(data) {
        if (!this._validateData(data)) {
            console.error('AnalyticsManager: Invalid import data');
            return false;
        }
        
        this._ensureInitialized();
        
        // Stop any active session before importing
        if (this._currentSession) {
            this._stopUpdateTimer();
            this._currentSession = null;
            this._sessionWordsRead = 0;
            this._sessionWpmSum = 0;
            this._sessionWpmCount = 0;
        }
        
        this._data = JSON.parse(JSON.stringify(data));
        
        if (!this._saveData()) {
            console.error('AnalyticsManager: Failed to save imported data');
            return false;
        }
        
        EventBus.emit(Events.ANALYTICS_UPDATED, this.getSummary());
        return true;
    }
}

// Export singleton
export const AnalyticsManager = new AnalyticsManagerClass();

// Also export class for testing
export { AnalyticsManagerClass };
