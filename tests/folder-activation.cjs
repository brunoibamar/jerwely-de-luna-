const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
    const root = path.resolve(__dirname, '..');
    const server = http.createServer((req, res) => {
        const name = new URL(req.url, 'http://localhost').pathname;
        const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
        if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
        fs.readFile(file, (error, bytes) => {
            if (error) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
            res.end(bytes);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const page = await browser.newPage();
        await page.route('https://api.telegram.org/**', route => route.abort());
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => window.app?.isInitialized);
        await page.evaluate(async () => {
            Auth.currentUser = { id: 1, role: 'admin', name: 'Prueba' };
            app.showApp(); app.switchSection('settings');
            const sale = { id: 'FOLDER-KEEP', date: new Date().toISOString(), total: 100, paymentMethod: 'cash', status: 'active', items: [{ barcode: 'A', description: 'Prueba', quantity: 1, amount: 100 }] };
            await AppStorage.transaction(() => { SaleService.save([sale]); SaleService.saveHistorical([sale]); });
            window.__savedHistory = AppStorage.getItem(SaleService.historicalKey);
            window.__successCalls = 0;
            const success = Toast.success;
            Toast.success = (...args) => { window.__successCalls++; return success.call(Toast, ...args); };
            Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => {
                window.__activation = navigator.userActivation.isActive;
                throw new DOMException('The request was aborted by the user agent', 'AbortError');
            } });
        });
        await page.locator('#interval-backup-now-btn').click();
        await page.waitForFunction(() => !document.getElementById('interval-backup-now-btn').disabled);
        const rejected = await page.evaluate(() => ({ activation: window.__activation, successes: window.__successCalls,
            feedback: document.getElementById('auto-backup-feedback').textContent,
            status: document.getElementById('auto-backup-status').textContent,
            unchanged: window.__savedHistory === AppStorage.getItem(SaleService.historicalKey) }));
        assert.equal(rejected.activation, true); assert.equal(rejected.successes, 0); assert.equal(rejected.unchanged, true);
        assert.match(rejected.feedback, /navegador rechazó/); assert.match(rejected.feedback, /Escritorio/); assert.match(rejected.feedback, /subcarpeta/);
        assert.match(rejected.status, /DESACTIVADO/);
        console.log('PASS: manual backup requests folder directly from click; rejected selection explains protected folders, restores controls and never announces external success');

        // Handles nativos y escritura real en el almacenamiento privado del perfil
        // aislado. El selector del sistema y su permiso todavía requieren prueba manual.
        await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            window.__nativeDirectory = await root.getDirectoryHandle('respaldos-prueba', { create: true });
            Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => {
                window.__activation = navigator.userActivation.isActive;
                return window.__nativeDirectory;
            } });
        });
        await page.locator('#interval-backup-now-btn').click();
        await page.waitForFunction(() => !document.getElementById('interval-backup-now-btn').disabled);
        const saved = await page.evaluate(async () => {
            const read = await MonthlyArchive.read();
            return { activation: window.__activation, status: document.getElementById('auto-backup-status').textContent,
                ids: read.complete.historicalSales.map(s => s.id), unchanged: window.__savedHistory === AppStorage.getItem(SaleService.historicalKey) };
        });
        assert.equal(saved.activation, true); assert.match(saved.status, /ACTIVO/);
        assert.deepEqual(saved.ids, ['FOLDER-KEEP']); assert.equal(saved.unchanged, true);
        await page.reload();
        await page.waitForFunction(() => window.app?.isInitialized);
        const restored = await page.evaluate(async () => {
            AutoBackup._handle = null;
            const handle = await AutoBackup._loadHandle();
            const copy = await MonthlyArchive.read();
            return { name: handle.name, ids: copy.complete.historicalSales.map(s => s.id) };
        });
        assert.equal(restored.name, 'respaldos-prueba'); assert.deepEqual(restored.ids, ['FOLDER-KEEP']);
        console.log('PASS: native browser file handles write and verify full/monthly JSON, persist through reload, and preserve operational sales');
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
