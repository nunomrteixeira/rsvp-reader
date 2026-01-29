/**
 * RSVP Reader - Service Worker
 * 
 * Provides offline caching, update management, and PWA functionality.
 * 
 * Cache Strategy:
 * - App Shell (HTML, CSS, JS): Network-first with cache fallback
 * - Fonts: Cache-first (immutable, long-lived)
 * - External resources: Network-first with cache fallback
 * 
 * Features:
 * - Offline support for core app functionality
 * - Share target handling for receiving shared text/files
 * - Background cache updates
 * - Version-based cache invalidation
 * - Dynamic cache size limits
 * 
 * @version 1.20.0
 */

// ============================================
// CONFIGURATION
// ============================================

// Version this cache - increment to force update
const CACHE_VERSION = 'v1.20.0';
const CACHE_NAME = `rsvp-reader-${CACHE_VERSION}`;
const FONT_CACHE = 'rsvp-fonts-v1';

/**
 * Core app shell - files required for offline functionality
 * NOTE: All files are at the root level, not in subdirectories
 */
const APP_SHELL = [
    // HTML & Assets
    '/',
    '/index.html',
    '/app.css',
    '/manifest.json',
    
    // Main app entry
    '/app.js',
    
    // Core modules (Phase 1-2)
    '/config.js',
    '/storage.js',
    '/state-manager.js',
    '/event-bus.js',
    '/dom-cache.js',
    '/file-import.js',
    
    // Processing modules (Phase 3)
    '/text-processor.js',
    '/orp-calculator.js',
    '/timing-manager.js',
    '/comprehension.js',
    
    // Manager modules (Phase 4)
    '/keyboard-manager.js',
    '/sound-manager.js',
    '/analytics-manager.js',
    '/library-manager.js',
    '/profile-manager.js',
    
    // Engine (Phase 5)
    '/rsvp-engine.js',
    
    // UI modules (Phase 6)
    '/toast.js',
    '/theme.js',
    '/panels.js',
    '/reader-display.js',
    '/settings-ui.js',
    '/ui-manager.js'
];

// Font URLs to cache (Google Fonts and CDN fonts)
const FONT_ORIGINS = [
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://fonts.cdnfonts.com'
];

// Maximum entries for dynamic content cache
const MAX_DYNAMIC_CACHE_SIZE = 50;

// Allowed message types from clients
const ALLOWED_MESSAGES = new Set([
    'SKIP_WAITING',
    'skipWaiting',
    'CLEAR_CACHE',
    'clearCache',
    'GET_VERSION',
    'CACHE_URLS',
    'GET_SHARED_FILE'
]);

// ============================================
// INSTALL EVENT
// ============================================

/**
 * Install event - pre-cache the app shell
 */
self.addEventListener('install', (event) => {
    console.log(`[SW] Installing ${CACHE_VERSION}...`);
    
    event.waitUntil(
        (async () => {
            try {
                const cache = await caches.open(CACHE_NAME);
                console.log('[SW] Caching app shell...');
                
                // Cache all app shell files
                // Use individual adds to identify which file fails
                const results = await Promise.allSettled(
                    APP_SHELL.map(async (url) => {
                        try {
                            const response = await fetch(url);
                            if (response.ok) {
                                await cache.put(url, response);
                                return { url, success: true };
                            } else {
                                console.warn(`[SW] Failed to fetch ${url}: ${response.status}`);
                                return { url, success: false, status: response.status };
                            }
                        } catch (error) {
                            console.warn(`[SW] Failed to cache ${url}:`, error.message);
                            return { url, success: false, error: error.message };
                        }
                    })
                );
                
                const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
                const failed = results.length - successful;
                
                console.log(`[SW] Cached ${successful}/${results.length} files (${failed} failed)`);
                
                // Skip waiting to activate immediately
                await self.skipWaiting();
                console.log('[SW] Install complete');
                
            } catch (error) {
                console.error('[SW] Install failed:', error);
                // Don't throw - allow SW to install even with failures
            }
        })()
    );
});

// ============================================
// ACTIVATE EVENT
// ============================================

/**
 * Activate event - clean up old caches and claim clients
 */
self.addEventListener('activate', (event) => {
    console.log(`[SW] Activating ${CACHE_VERSION}...`);
    
    event.waitUntil(
        (async () => {
            try {
                // Clean up old caches
                const cacheNames = await caches.keys();
                const deletePromises = cacheNames
                    .filter((name) => {
                        // Delete old app caches but keep font cache
                        return name.startsWith('rsvp-reader-') && name !== CACHE_NAME;
                    })
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    });
                
                await Promise.all(deletePromises);
                
                // Clean up dynamic cache entries
                await cleanupDynamicCache();
                
                // Take control of all clients immediately
                await self.clients.claim();
                
                console.log('[SW] Activation complete');
                
                // Notify all clients that a new version is active
                const clients = await self.clients.matchAll();
                clients.forEach((client) => {
                    client.postMessage({
                        type: 'SW_ACTIVATED',
                        version: CACHE_VERSION
                    });
                });
                
            } catch (error) {
                console.error('[SW] Activation error:', error);
            }
        })()
    );
});

// ============================================
// FETCH EVENT
// ============================================

/**
 * Fetch event - implement caching strategies
 */
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Handle share target POST requests
    if (request.method === 'POST' && url.searchParams.get('action') === 'share') {
        event.respondWith(handleShareTarget(request));
        return;
    }
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Skip chrome-extension and other non-http(s) protocols
    if (!url.protocol.startsWith('http')) {
        return;
    }
    
    // Strategy 1: Font requests - Cache first, long-lived
    if (isFontRequest(url)) {
        event.respondWith(fontCacheStrategy(request));
        return;
    }
    
    // Strategy 2: Same-origin requests - Network first with cache fallback
    if (url.origin === self.location.origin) {
        event.respondWith(networkFirstWithCache(request));
        return;
    }
    
    // Strategy 3: External requests - Network first, no cache
    event.respondWith(networkFirst(request));
});

// ============================================
// CACHING STRATEGIES
// ============================================

/**
 * Check if request is for fonts
 * @param {URL} url - Request URL
 * @returns {boolean}
 */
function isFontRequest(url) {
    // Check font CDN origins
    if (FONT_ORIGINS.some((origin) => url.href.startsWith(origin))) {
        return true;
    }
    
    // Check file extensions
    const fontExtensions = ['.woff', '.woff2', '.ttf', '.otf', '.eot'];
    return fontExtensions.some((ext) => url.pathname.endsWith(ext));
}

/**
 * Font cache strategy - Cache first, never expire
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function fontCacheStrategy(request) {
    try {
        const cache = await caches.open(FONT_CACHE);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        const networkResponse = await fetch(request);
        
        // Cache successful font responses
        if (networkResponse.ok) {
            // Clone before caching (response can only be read once)
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
        
    } catch (error) {
        console.warn('[SW] Font fetch failed:', request.url);
        // Return empty response - browser will use fallback fonts
        return new Response('', { 
            status: 404, 
            statusText: 'Font unavailable' 
        });
    }
}

/**
 * Network-first with cache fallback strategy
 * Always tries network first for fresh content, falls back to cache if offline
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirstWithCache(request) {
    const cache = await caches.open(CACHE_NAME);
    
    try {
        // Try network first
        const networkResponse = await fetch(request);
        
        // Cache successful responses
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
        
    } catch (error) {
        // Network failed, try cache
        console.warn('[SW] Network failed, trying cache:', request.url);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Offline fallback for HTML navigation requests
        if (request.mode === 'navigate' || 
            request.headers.get('accept')?.includes('text/html')) {
            const fallback = await cache.match('/index.html');
            if (fallback) {
                return fallback;
            }
        }
        
        // Return offline error
        return new Response('Offline - Resource not cached', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

/**
 * Network-first strategy for external resources (no caching)
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
    try {
        return await fetch(request);
    } catch (error) {
        // Try cache as last resort for external resources
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

// ============================================
// SHARE TARGET HANDLING
// ============================================

/**
 * Handle share target POST requests
 * Extracts shared data and redirects to app with data in URL
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleShareTarget(request) {
    try {
        const formData = await request.formData();
        
        // Extract shared data
        const title = formData.get('title') || '';
        const text = formData.get('text') || '';
        const url = formData.get('url') || '';
        const file = formData.get('file');
        
        // Build redirect URL with shared data
        const redirectUrl = new URL('/', self.location.origin);
        redirectUrl.searchParams.set('action', 'share');
        
        if (title) redirectUrl.searchParams.set('title', title);
        if (text) redirectUrl.searchParams.set('text', text);
        if (url) redirectUrl.searchParams.set('url', url);
        
        // Handle file sharing
        if (file instanceof File) {
            // Store file in cache temporarily for the app to retrieve
            const cache = await caches.open(CACHE_NAME);
            const fileResponse = new Response(file, {
                headers: {
                    'Content-Type': file.type || 'application/octet-stream',
                    'X-Filename': encodeURIComponent(file.name)
                }
            });
            await cache.put('/_shared-file', fileResponse);
            redirectUrl.searchParams.set('hasFile', 'true');
        }
        
        // Redirect to app
        return Response.redirect(redirectUrl.toString(), 303);
        
    } catch (error) {
        console.error('[SW] Share target error:', error);
        // Redirect to app even on error
        return Response.redirect('/?action=share&error=true', 303);
    }
}

// ============================================
// MESSAGE HANDLING
// ============================================

/**
 * Handle messages from the main thread
 */
self.addEventListener('message', (event) => {
    const { data } = event;
    
    // Validate message has expected structure
    if (!data) return;
    
    const messageType = data.type || data;
    
    // Validate message type is allowed
    if (!ALLOWED_MESSAGES.has(messageType)) {
        console.warn('[SW] Unknown message type:', messageType);
        return;
    }
    
    // Process message
    switch (messageType) {
        case 'skipWaiting':
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'CLEAR_CACHE':
        case 'clearCache':
            clearAllCaches().then(() => {
                // Respond if port available
                event.ports?.[0]?.postMessage({ success: true });
            });
            break;
            
        case 'GET_VERSION':
            event.ports?.[0]?.postMessage({ 
                version: CACHE_VERSION,
                cacheName: CACHE_NAME
            });
            break;
            
        case 'CACHE_URLS':
            if (data.urls && Array.isArray(data.urls)) {
                cacheUrls(data.urls).then((results) => {
                    event.ports?.[0]?.postMessage({ 
                        success: true, 
                        cached: results.filter(r => r.success).length,
                        failed: results.filter(r => !r.success).length
                    });
                });
            }
            break;
            
        case 'GET_SHARED_FILE':
            // Retrieve and clean up shared file from cache
            (async () => {
                try {
                    const cache = await caches.open(CACHE_NAME);
                    const response = await cache.match('/_shared-file');
                    
                    if (response) {
                        // Get file data before deleting
                        const blob = await response.blob();
                        const filename = decodeURIComponent(
                            response.headers.get('X-Filename') || 'shared-file'
                        );
                        const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
                        
                        // Delete from cache
                        await cache.delete('/_shared-file');
                        
                        event.ports?.[0]?.postMessage({
                            success: true,
                            hasFile: true,
                            filename,
                            contentType,
                            // Can't send Blob via postMessage, send as ArrayBuffer
                            data: await blob.arrayBuffer()
                        });
                    } else {
                        event.ports?.[0]?.postMessage({
                            success: true,
                            hasFile: false
                        });
                    }
                } catch (error) {
                    event.ports?.[0]?.postMessage({
                        success: false,
                        error: error.message
                    });
                }
            })();
            break;
    }
});

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Clear all caches
 * @returns {Promise<void>}
 */
async function clearAllCaches() {
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames.map((name) => caches.delete(name))
    );
    console.log('[SW] All caches cleared');
    
    // Notify clients
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
        client.postMessage({ type: 'CACHE_CLEARED' });
    });
}

/**
 * Cache additional URLs (for prefetching)
 * @param {string[]} urls - URLs to cache
 * @returns {Promise<Array<{url: string, success: boolean}>>}
 */
async function cacheUrls(urls) {
    const cache = await caches.open(CACHE_NAME);
    const results = [];
    
    for (const url of urls) {
        try {
            // Only cache same-origin URLs for security
            const parsedUrl = new URL(url, self.location.origin);
            if (parsedUrl.origin !== self.location.origin) {
                console.warn('[SW] Skipping cross-origin URL:', url);
                results.push({ url, success: false, reason: 'cross-origin' });
                continue;
            }
            
            const response = await fetch(url);
            if (response.ok) {
                await cache.put(url, response);
                results.push({ url, success: true });
            } else {
                results.push({ url, success: false, status: response.status });
            }
        } catch (error) {
            console.warn('[SW] Failed to cache:', url, error.message);
            results.push({ url, success: false, error: error.message });
        }
    }
    
    return results;
}

/**
 * Clean up dynamic cache entries to prevent unbounded growth
 * Removes oldest entries beyond MAX_DYNAMIC_CACHE_SIZE
 * @returns {Promise<void>}
 */
async function cleanupDynamicCache() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const keys = await cache.keys();
        
        // Identify dynamic entries (not in app shell)
        const appShellSet = new Set(APP_SHELL.map(url => 
            new URL(url, self.location.origin).href
        ));
        
        const dynamicKeys = keys.filter((request) => {
            return !appShellSet.has(request.url);
        });
        
        // Remove oldest entries if over limit
        if (dynamicKeys.length > MAX_DYNAMIC_CACHE_SIZE) {
            const toDelete = dynamicKeys.slice(0, dynamicKeys.length - MAX_DYNAMIC_CACHE_SIZE);
            await Promise.all(toDelete.map((key) => cache.delete(key)));
            console.log(`[SW] Cleaned up ${toDelete.length} old cache entries`);
        }
    } catch (error) {
        console.warn('[SW] Cache cleanup error:', error);
    }
}
