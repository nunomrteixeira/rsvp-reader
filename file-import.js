/**
 * RSVP Reader - File Import Module
 * Handles importing text from various file formats (TXT, PDF, EPUB, DOCX, HTML, MD).
 * Lazy-loads external libraries (PDF.js, JSZip) only when needed.
 * No dependencies on other app modules.
 * 
 * Security features:
 * - File size limits to prevent OOM
 * - Timeout handling for library loading
 * - Input validation
 * 
 * Supported formats:
 * - TXT: Plain text (UTF-8)
 * - PDF: Via PDF.js
 * - EPUB: Via JSZip
 * - DOCX: Via JSZip (Office Open XML)
 * - HTML/HTM: Via DOMParser
 * - MD: Markdown as plain text
 */

/**
 * @typedef {Object} ImportResult
 * @property {string} text - Extracted text content
 * @property {Object} metadata - File metadata
 * @property {string} metadata.title - Document title
 * @property {string} metadata.format - Original format
 * @property {number} [metadata.pages] - Page count (PDF)
 * @property {number} [metadata.chapters] - Chapter count (EPUB)
 * @property {number} metadata.originalSize - Original file size in bytes
 */

/**
 * @typedef {Object} ImportOptions
 * @property {function(number): void} [onProgress] - Progress callback (0-100)
 * @property {AbortSignal} [signal] - AbortSignal for cancellation
 */

/** Maximum file size in bytes (50MB) */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Library loading timeout in ms */
const LIBRARY_LOAD_TIMEOUT = 30000;

/** CDN URLs for external libraries */
const CDN = {
    PDF_JS: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    PDF_WORKER: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    JSZIP: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
};

/** Supported file extensions */
const SUPPORTED_EXTENSIONS = ['txt', 'pdf', 'epub', 'docx', 'html', 'htm', 'md', 'markdown'];

/**
 * File Import Manager
 * Singleton for importing text from various document formats.
 */
class FileImportManager {
    constructor() {
        /** @type {Object|null} Cached PDF.js library */
        this._pdfjs = null;
        
        /** @type {Object|null} Cached JSZip library */
        this._jszip = null;

        /** @type {Promise|null} Pending PDF.js load */
        this._pdfjsLoading = null;

        /** @type {Promise|null} Pending JSZip load */
        this._jszipLoading = null;
    }

    /**
     * Load an external script with timeout
     * @private
     * @param {string} src - Script URL
     * @param {string} globalName - Expected global variable name
     * @param {number} timeout - Timeout in ms
     * @returns {Promise<Object>} Loaded library
     */
    _loadScript(src, globalName, timeout = LIBRARY_LOAD_TIMEOUT) {
        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (window[globalName]) {
                resolve(window[globalName]);
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;

            const timeoutId = setTimeout(() => {
                script.remove();
                reject(new Error(`Timeout loading library from ${src}`));
            }, timeout);

            script.onload = () => {
                clearTimeout(timeoutId);
                if (window[globalName]) {
                    resolve(window[globalName]);
                } else {
                    reject(new Error(`Library loaded but ${globalName} not found`));
                }
            };

            script.onerror = () => {
                clearTimeout(timeoutId);
                script.remove();
                reject(new Error(`Failed to load library from ${src}`));
            };

            document.head.appendChild(script);
        });
    }

    /**
     * Lazy-load PDF.js library (with race condition protection)
     * @private
     * @returns {Promise<Object>} PDF.js library
     */
    async _loadPdfJs() {
        if (this._pdfjs) return this._pdfjs;
        
        // Prevent race condition - reuse pending promise
        if (this._pdfjsLoading) return this._pdfjsLoading;

        this._pdfjsLoading = (async () => {
            try {
                const pdfjs = await this._loadScript(CDN.PDF_JS, 'pdfjsLib');
                pdfjs.GlobalWorkerOptions.workerSrc = CDN.PDF_WORKER;
                this._pdfjs = pdfjs;
                return pdfjs;
            } finally {
                this._pdfjsLoading = null;
            }
        })();

        return this._pdfjsLoading;
    }

    /**
     * Lazy-load JSZip library (with race condition protection)
     * @private
     * @returns {Promise<Object>} JSZip library
     */
    async _loadJsZip() {
        if (this._jszip) return this._jszip;
        
        // Prevent race condition - reuse pending promise
        if (this._jszipLoading) return this._jszipLoading;

        this._jszipLoading = (async () => {
            try {
                const jszip = await this._loadScript(CDN.JSZIP, 'JSZip');
                this._jszip = jszip;
                return jszip;
            } finally {
                this._jszipLoading = null;
            }
        })();

        return this._jszipLoading;
    }

    /**
     * Extract file extension safely
     * @private
     * @param {string} filename - Filename to parse
     * @returns {string|null} Extension or null if none
     */
    _getExtension(filename) {
        if (!filename || typeof filename !== 'string') return null;
        
        // Find last dot that's not at the start (hidden files)
        const lastDot = filename.lastIndexOf('.');
        if (lastDot <= 0 || lastDot === filename.length - 1) {
            return null; // No extension or hidden file without extension
        }
        
        return filename.slice(lastDot + 1).toLowerCase();
    }

    /**
     * Validate file before import
     * @private
     * @param {File} file - File to validate
     * @throws {Error} If file is invalid
     */
    _validateFile(file) {
        if (!file || !(file instanceof File)) {
            throw new Error('Invalid file object');
        }

        if (file.size === 0) {
            throw new Error('File is empty');
        }

        if (file.size > MAX_FILE_SIZE) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
            const maxMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
            throw new Error(`File too large (${sizeMB}MB). Maximum size is ${maxMB}MB.`);
        }

        const ext = this._getExtension(file.name);
        if (!ext) {
            throw new Error('File has no extension. Please use a supported format.');
        }

        if (!SUPPORTED_EXTENSIONS.includes(ext)) {
            throw new Error(`Unsupported format: .${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
        }
    }

    /**
     * Import text from a file
     * Automatically detects format and extracts text.
     * 
     * @param {File} file - File to import
     * @param {ImportOptions} [options] - Import options
     * @returns {Promise<ImportResult>} Extracted text and metadata
     * @throws {Error} If format is unsupported or file is invalid
     * 
     * @example
     * const result = await FileImport.importFile(file);
     * console.log(result.text, result.metadata.title);
     * 
     * // With progress
     * const result = await FileImport.importFile(file, {
     *     onProgress: (percent) => console.log(`${percent}%`)
     * });
     */
    async importFile(file, options = {}) {
        const { onProgress, signal } = options;

        // Check for cancellation
        if (signal?.aborted) {
            throw new Error('Import cancelled');
        }

        // Validate file
        this._validateFile(file);

        const ext = this._getExtension(file.name);
        
        // Report initial progress
        onProgress?.(0);

        let result;
        
        switch (ext) {
            case 'txt':
            case 'md':
            case 'markdown':
                result = await this._importTxt(file, options);
                break;
            case 'pdf':
                result = await this._importPdf(file, options);
                break;
            case 'epub':
                result = await this._importEpub(file, options);
                break;
            case 'docx':
                result = await this._importDocx(file, options);
                break;
            case 'html':
            case 'htm':
                result = await this._importHtml(file, options);
                break;
            default:
                throw new Error(`Unsupported format: .${ext}`);
        }

        // Add original file size to metadata
        result.metadata.originalSize = file.size;

        // Report completion
        onProgress?.(100);

        // Final validation
        if (!result.text || result.text.trim().length === 0) {
            throw new Error('No text content could be extracted from the file');
        }

        return result;
    }

    /**
     * Get list of supported file extensions
     * @returns {string[]} Array of supported extensions
     */
    getSupportedFormats() {
        return [...SUPPORTED_EXTENSIONS];
    }

    /**
     * Get accept string for file input
     * @returns {string} Accept attribute value
     */
    getAcceptString() {
        return SUPPORTED_EXTENSIONS.map(ext => `.${ext}`).join(',');
    }

    /**
     * Check if a file format is supported
     * @param {string} filename - Filename to check
     * @returns {boolean} True if supported
     */
    isSupported(filename) {
        const ext = this._getExtension(filename);
        return ext !== null && SUPPORTED_EXTENSIONS.includes(ext);
    }

    /**
     * Clean and normalize extracted text
     * Preserves paragraph structure while cleaning up whitespace
     * @private
     * @param {string} text - Raw text
     * @returns {string} Cleaned text
     */
    _cleanText(text) {
        if (!text) return '';
        
        return text
            // Normalize line endings
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Replace multiple spaces/tabs with single space (but not newlines)
            .replace(/[^\S\n]+/g, ' ')
            // Replace 3+ newlines with 2 (preserve paragraph breaks)
            .replace(/\n{3,}/g, '\n\n')
            // Trim each line
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            // Final trim
            .trim();
    }

    /**
     * Import plain text file
     * @private
     * @param {File} file
     * @param {ImportOptions} options
     * @returns {Promise<ImportResult>}
     */
    async _importTxt(file, options = {}) {
        const { onProgress } = options;
        onProgress?.(50);

        const text = await file.text();
        const ext = this._getExtension(file.name);
        
        // Remove extension from title
        const extPattern = new RegExp(`\\.${ext}$`, 'i');
        const title = file.name.replace(extPattern, '');
        
        return {
            text: this._cleanText(text),
            metadata: { 
                title, 
                format: ext === 'md' || ext === 'markdown' ? 'markdown' : 'txt'
            }
        };
    }

    /**
     * Import PDF file
     * @private
     * @param {File} file
     * @param {ImportOptions} options
     * @returns {Promise<ImportResult>}
     */
    async _importPdf(file, options = {}) {
        const { onProgress, signal } = options;
        
        onProgress?.(10);
        const pdfjs = await this._loadPdfJs();
        
        if (signal?.aborted) throw new Error('Import cancelled');
        
        onProgress?.(20);
        const arrayBuffer = await file.arrayBuffer();
        
        if (signal?.aborted) throw new Error('Import cancelled');

        let pdf;
        try {
            pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        } catch (e) {
            if (e.name === 'PasswordException') {
                throw new Error('PDF is password-protected. Please provide an unprotected file.');
            }
            throw new Error(`Failed to parse PDF: ${e.message}`);
        }
        
        const textParts = [];
        const totalPages = pdf.numPages;
        
        for (let i = 1; i <= totalPages; i++) {
            if (signal?.aborted) throw new Error('Import cancelled');
            
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            // Better text extraction preserving structure
            const pageText = this._extractPdfPageText(textContent);
            if (pageText.trim()) {
                textParts.push(pageText);
            }
            
            // Report progress (20-90% for page processing)
            onProgress?.(20 + Math.round((i / totalPages) * 70));
        }
        
        // Extract title from metadata
        let title = file.name.replace(/\.pdf$/i, '');
        try {
            const metadata = await pdf.getMetadata();
            if (metadata.info?.Title && metadata.info.Title.trim()) {
                title = metadata.info.Title.trim();
            }
        } catch (e) {
            // Metadata extraction failed, use filename
        }
        
        return {
            text: this._cleanText(textParts.join('\n\n')),
            metadata: { title, format: 'pdf', pages: totalPages }
        };
    }

    /**
     * Extract text from PDF page content with structure preservation
     * @private
     * @param {Object} textContent - PDF.js textContent object
     * @returns {string} Extracted text
     */
    _extractPdfPageText(textContent) {
        if (!textContent.items || textContent.items.length === 0) {
            return '';
        }

        const lines = [];
        let currentLine = [];
        let lastY = null;
        const LINE_THRESHOLD = 5; // Y-difference threshold for new line

        for (const item of textContent.items) {
            if (!item.str) continue;

            // Check for significant Y position change (new line)
            if (lastY !== null && Math.abs(item.transform[5] - lastY) > LINE_THRESHOLD) {
                if (currentLine.length > 0) {
                    lines.push(currentLine.join(''));
                    currentLine = [];
                }
            }

            currentLine.push(item.str);
            lastY = item.transform[5];

            // Check for explicit line break
            if (item.hasEOL) {
                lines.push(currentLine.join(''));
                currentLine = [];
                lastY = null;
            }
        }

        // Don't forget the last line
        if (currentLine.length > 0) {
            lines.push(currentLine.join(''));
        }

        return lines.join('\n');
    }

    /**
     * Import EPUB file
     * @private
     * @param {File} file
     * @param {ImportOptions} options
     * @returns {Promise<ImportResult>}
     */
    async _importEpub(file, options = {}) {
        const { onProgress, signal } = options;
        
        onProgress?.(10);
        const JSZip = await this._loadJsZip();
        
        if (signal?.aborted) throw new Error('Import cancelled');
        
        onProgress?.(20);
        const arrayBuffer = await file.arrayBuffer();
        
        if (signal?.aborted) throw new Error('Import cancelled');

        let zip;
        try {
            zip = await JSZip.loadAsync(arrayBuffer);
        } catch (e) {
            throw new Error('Invalid EPUB file: Could not read archive');
        }
        
        // Read container.xml to find content location
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) {
            throw new Error('Invalid EPUB: missing META-INF/container.xml');
        }
        
        const containerXml = await containerFile.async('text');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'text/xml');
        
        // Check for XML parse errors
        if (containerDoc.querySelector('parsererror')) {
            throw new Error('Invalid EPUB: malformed container.xml');
        }
        
        const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
        if (!rootfilePath) {
            throw new Error('Invalid EPUB: missing rootfile path');
        }
        
        // Read OPF (package) file
        const opfFile = zip.file(rootfilePath);
        if (!opfFile) {
            throw new Error(`Invalid EPUB: missing package file at ${rootfilePath}`);
        }
        
        const opfContent = await opfFile.async('text');
        const opfDoc = parser.parseFromString(opfContent, 'text/xml');
        
        if (opfDoc.querySelector('parsererror')) {
            throw new Error('Invalid EPUB: malformed package file');
        }
        
        // Extract title (handle dc: namespace)
        let title = file.name.replace(/\.epub$/i, '');
        const titleSelectors = [
            'metadata title',
            'metadata > title', 
            'metadata > *[name="dc:title"]',
            '[property="dcterms:title"]'
        ];
        
        for (const selector of titleSelectors) {
            try {
                const titleEl = opfDoc.querySelector(selector);
                if (titleEl?.textContent?.trim()) {
                    title = titleEl.textContent.trim();
                    break;
                }
            } catch (e) {
                // Selector might not be supported, try next
            }
        }
        
        // Also try getElementsByTagName for namespaced elements
        if (title === file.name.replace(/\.epub$/i, '')) {
            const dcTitles = opfDoc.getElementsByTagName('dc:title');
            if (dcTitles.length > 0 && dcTitles[0].textContent?.trim()) {
                title = dcTitles[0].textContent.trim();
            }
        }
        
        onProgress?.(30);
        
        // Build manifest map (id -> href)
        const manifest = opfDoc.querySelectorAll('manifest > item');
        const idToHref = new Map();
        manifest.forEach(item => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            if (id && href) {
                idToHref.set(id, href);
            }
        });
        
        // Read spine items in order
        const spineItems = Array.from(opfDoc.querySelectorAll('spine > itemref'));
        const basePath = rootfilePath.includes('/') 
            ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1)
            : '';
        
        const textParts = [];
        
        for (let i = 0; i < spineItems.length; i++) {
            if (signal?.aborted) throw new Error('Import cancelled');
            
            const spine = spineItems[i];
            const idref = spine.getAttribute('idref');
            const href = idToHref.get(idref);
            
            if (!href) continue;
            
            // Resolve path (handle relative paths)
            const fullPath = this._resolveEpubPath(basePath, href);
            const contentFile = zip.file(fullPath);
            
            if (!contentFile) continue;
            
            try {
                const content = await contentFile.async('text');
                const doc = parser.parseFromString(content, 'text/html');
                
                // Remove script, style, and nav elements
                doc.querySelectorAll('script, style, nav').forEach(el => el.remove());
                
                const bodyText = doc.body?.textContent?.trim();
                if (bodyText) {
                    textParts.push(bodyText);
                }
            } catch (e) {
                // Skip chapters that fail to parse
                console.warn(`EPUB: Failed to parse chapter ${href}:`, e.message);
            }
            
            // Report progress (30-90% for chapter processing)
            onProgress?.(30 + Math.round((i / spineItems.length) * 60));
        }
        
        if (textParts.length === 0) {
            throw new Error('No readable content found in EPUB');
        }
        
        return {
            text: this._cleanText(textParts.join('\n\n')),
            metadata: { title, format: 'epub', chapters: spineItems.length }
        };
    }

    /**
     * Resolve EPUB internal path (handles relative paths)
     * @private
     * @param {string} basePath - Base directory path
     * @param {string} href - Href to resolve
     * @returns {string} Resolved path
     */
    _resolveEpubPath(basePath, href) {
        // Handle absolute paths
        if (href.startsWith('/')) {
            return href.slice(1);
        }
        
        // Handle relative paths with ../
        let path = basePath + href;
        
        // Normalize path (resolve ../)
        const parts = path.split('/');
        const resolved = [];
        
        for (const part of parts) {
            if (part === '..') {
                resolved.pop();
            } else if (part !== '.' && part !== '') {
                resolved.push(part);
            }
        }
        
        return resolved.join('/');
    }

    /**
     * Import DOCX file
     * @private
     * @param {File} file
     * @param {ImportOptions} options
     * @returns {Promise<ImportResult>}
     */
    async _importDocx(file, options = {}) {
        const { onProgress, signal } = options;
        
        onProgress?.(10);
        const JSZip = await this._loadJsZip();
        
        if (signal?.aborted) throw new Error('Import cancelled');
        
        onProgress?.(20);
        const arrayBuffer = await file.arrayBuffer();
        
        if (signal?.aborted) throw new Error('Import cancelled');

        let zip;
        try {
            zip = await JSZip.loadAsync(arrayBuffer);
        } catch (e) {
            throw new Error('Invalid DOCX file: Could not read archive');
        }
        
        const documentFile = zip.file('word/document.xml');
        if (!documentFile) {
            throw new Error('Invalid DOCX: missing word/document.xml');
        }
        
        const documentXml = await documentFile.async('text');
        const parser = new DOMParser();
        const doc = parser.parseFromString(documentXml, 'text/xml');
        
        if (doc.querySelector('parsererror')) {
            throw new Error('Invalid DOCX: malformed document.xml');
        }
        
        onProgress?.(50);
        
        // Extract text from paragraphs using namespace-aware method
        // DOCX uses w: namespace for elements (w:p for paragraphs, w:t for text)
        const textParts = [];
        
        // Use getElementsByTagName which handles namespaces better
        // Try with namespace prefix first, then without
        let paragraphs = doc.getElementsByTagName('w:p');
        if (paragraphs.length === 0) {
            paragraphs = doc.getElementsByTagName('p');
        }
        
        for (const p of paragraphs) {
            // Get all text nodes within paragraph
            let texts = p.getElementsByTagName('w:t');
            if (texts.length === 0) {
                texts = p.getElementsByTagName('t');
            }
            
            const paraText = Array.from(texts)
                .map(t => t.textContent || '')
                .join('');
            
            if (paraText.trim()) {
                textParts.push(paraText.trim());
            }
        }
        
        onProgress?.(80);
        
        // Try to extract title from core properties
        let title = file.name.replace(/\.docx$/i, '');
        
        try {
            const coreFile = zip.file('docProps/core.xml');
            if (coreFile) {
                const coreXml = await coreFile.async('text');
                const coreDoc = parser.parseFromString(coreXml, 'text/xml');
                
                // Try different selectors for title
                let titleEl = coreDoc.getElementsByTagName('dc:title')[0];
                if (!titleEl) {
                    titleEl = coreDoc.getElementsByTagName('title')[0];
                }
                
                if (titleEl?.textContent?.trim()) {
                    title = titleEl.textContent.trim();
                }
            }
        } catch (e) {
            // Metadata extraction failed, use filename
        }
        
        if (textParts.length === 0) {
            throw new Error('No text content found in DOCX');
        }
        
        return {
            text: this._cleanText(textParts.join('\n\n')),
            metadata: { 
                title, 
                format: 'docx' 
            }
        };
    }

    /**
     * Import HTML file
     * @private
     * @param {File} file
     * @param {ImportOptions} options
     * @returns {Promise<ImportResult>}
     */
    async _importHtml(file, options = {}) {
        const { onProgress } = options;
        
        onProgress?.(30);
        const html = await file.text();
        
        onProgress?.(50);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Remove non-content elements
        const removeSelectors = [
            'script', 'style', 'noscript', 'iframe',
            'nav', 'header', 'footer', 'aside',
            '.sidebar', '.navigation', '.menu', '.ads', '.advertisement',
            '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'
        ];
        
        for (const selector of removeSelectors) {
            try {
                doc.querySelectorAll(selector).forEach(el => el.remove());
            } catch (e) {
                // Selector might not be valid, skip
            }
        }
        
        onProgress?.(70);
        
        // Try to find main content area
        const contentSelectors = [
            'article', 'main', '[role="main"]',
            '.content', '.post-content', '.article-content', '.entry-content',
            '#content', '#main', '#article'
        ];
        
        let contentElement = null;
        for (const selector of contentSelectors) {
            try {
                contentElement = doc.querySelector(selector);
                if (contentElement) break;
            } catch (e) {
                // Selector might not be valid, skip
            }
        }
        
        // Fall back to body
        if (!contentElement) {
            contentElement = doc.body;
        }
        
        // Extract text preserving structure
        const text = this._extractHtmlText(contentElement);
        
        // Get title
        let title = doc.querySelector('title')?.textContent?.trim();
        if (!title) {
            title = doc.querySelector('h1')?.textContent?.trim();
        }
        if (!title) {
            title = file.name.replace(/\.html?$/i, '');
        }
        
        return { 
            text: this._cleanText(text), 
            metadata: { title, format: 'html' } 
        };
    }

    /**
     * Extract text from HTML element preserving paragraph structure
     * @private
     * @param {Element} element - HTML element
     * @returns {string} Extracted text
     */
    _extractHtmlText(element) {
        if (!element) return '';

        const blocks = [];
        
        // Block-level elements that should create paragraph breaks
        const blockTags = new Set([
            'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
            'ARTICLE', 'SECTION', 'LI', 'TR', 'BLOCKQUOTE',
            'PRE', 'ADDRESS', 'FIGCAPTION', 'DT', 'DD'
        ]);

        // Elements to skip entirely
        const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS']);
        
        const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                if (text) {
                    blocks.push(text);
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // Skip certain elements
                if (skipTags.has(node.tagName)) {
                    return;
                }

                // Check for hidden attribute (works without computed styles)
                if (node.hidden || node.getAttribute('aria-hidden') === 'true') {
                    return;
                }
                
                // Process children
                for (const child of node.childNodes) {
                    walk(child);
                }
                
                // Add paragraph break after block elements
                if (blockTags.has(node.tagName) && blocks.length > 0) {
                    blocks.push('\n');
                }
            }
        };
        
        walk(element);
        
        return blocks.join(' ').replace(/\s*\n\s*/g, '\n\n');
    }
}

// Export singleton instance
export const FileImport = new FileImportManager();

// Also export class for testing
export { FileImportManager };

// Export constants for external use
export { MAX_FILE_SIZE, SUPPORTED_EXTENSIONS };

