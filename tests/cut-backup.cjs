const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        await page.route('https://api.telegram.org/**', route => route.abort());
        await page.goto(pathToFileURL(path.resolve('index.html')).href);
        await page.waitForFunction(() => window.app?.isInitialized);
        await page.evaluate(async () => {
            Auth.currentUser = { id: 2, username: 'empleada', name: 'Empleada', role: 'guest' };
            TelegramNotify.notificarCorte = () => {};
            await AppStorage.transaction(() => {
                Inventory.saveProducts([{ barcode: 'TEST', description: 'Prueba', stock: 5, price: 100, cost: 50, category: 'Anillos' }]);
                const sale = { id: 'SALE-KEEP', date: new Date().toISOString(), total: 100, status: 'active', paymentMethod: 'cash', items: [{ barcode: 'TEST', description: 'Prueba', price: 100, quantity: 1, amount: 100 }] };
                SaleService.save([sale]); SaleService.saveHistorical([sale]);
                VIPCustomer.save([{ id: 'VIP-KEEP', name: 'Prueba', phone: '0000000000', accumulatedPieces: 7, rewardHistory: [], createdAt: new Date().toISOString() }]);
            });
            window.__files = new Map();
            window.__mode = 'success';
            window.__directory = {
                kind: 'directory', name: 'Respaldos Joyería', queryPermission: async () => window.__mode === 'permission' ? 'prompt' : 'granted',
                getDirectoryHandle: async day => {
                    if (window.__mode === 'disk') throw new Error('Test full disk');
                    return { getFileHandle: async name => {
                        const key = day + '/' + name;
                        return {
                            createWritable: async () => { let pending; return { write: async text => { pending = text; }, close: async () => window.__files.set(key, pending) }; },
                            getFile: async () => ({ text: async () => window.__mode === 'verification' ? 'damaged' : window.__files.get(key) })
                        };
                    } };
                }
            };
        });
        let downloads = 0;
        page.on('download', () => downloads++);
        const prepare = mode => page.evaluate(async mode => {
            window.__mode = mode;
            AutoBackup._handle = mode === 'unconfigured' ? null : window.__directory;
            AutoBackup._errorShown = false;
            await AppStorage.transaction(() => Cut.openSession(50, Auth.getCurrentUser()));
            return Cut.getActiveSession().id;
        }, mode);
        const session = await prepare('success');
        // A cut must wait behind older backups without being merged into them.
        await page.evaluate(() => {
            window.__priorQueue = AutoBackup._queue = new Promise(resolve => { window.__release = resolve; });
            window.__closing = app.closeCashDrawer();
        });
        await page.waitForFunction(() => !Cut.isShiftOpen() && AutoBackup._queue !== window.__priorQueue);
        assert.equal(await page.evaluate(() => window.__files.size), 0);
        await page.evaluate(async () => { window.__release(true); await window.__closing; });
        const successful = await page.evaluate(() => ({
            files: [...window.__files.entries()], status: document.getElementById('cut-backup-status').textContent,
            role: Auth.getRole(), cuts: Cut.getSessionHistory().length
        }));
        assert.equal(downloads, 0);
        assert.equal(successful.role, 'guest'); assert.equal(successful.cuts, 1);
        assert.equal(successful.files.length, 1);
        assert.ok(successful.files[0][0].includes('Corte_'));
        const json = JSON.parse(successful.files[0][1]);
        assert.equal(json.type, 'cut_backup'); assert.equal(json.report.sessionId, session);
        assert.equal(json.autoBackup.reason, 'corte');
        assert.equal(json.shiftSession, null);
        assert.ok(json.rawStorage && json.vipCustomers && json.historicalSales);
        assert.ok(JSON.parse(json.shiftHistory).some(cut => cut.id === session));
        assert.ok(successful.status.includes('verificado'));
        console.log('PASS: employee cut waits for its own verified full JSON in the configured folder, with no manual download');
        const [manualDownload] = await Promise.all([
            page.waitForEvent('download'), page.locator('#download-local-btn').click()
        ]);
        const manual = JSON.parse(fs.readFileSync(await manualDownload.path(), 'utf8'));
        assert.equal(manual.report.sessionId, session); assert.ok(manual.vipCustomers);
        assert.equal(await page.evaluate(() => Cut.getSessionHistory().length), 1);
        console.log('PASS: manual summary download retries a full JSON without creating another cut');
        const firstFile = successful.files[0];
        for (const mode of ['permission', 'disk', 'verification', 'unconfigured']) {
            const closedId = await prepare(mode);
            const pendingDownload = page.waitForEvent('download');
            await page.evaluate(() => app.closeCashDrawer());
            const download = await pendingDownload;
            const fallback = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
            assert.equal(fallback.type, 'cut_backup'); assert.equal(fallback.report.sessionId, closedId);
            assert.ok(JSON.parse(fallback.shiftHistory).some(cut => cut.id === closedId));
            const state = await page.evaluate(([name, contents]) => ({
                status: document.getElementById('cut-backup-status').textContent,
                closed: !Cut.isShiftOpen(), sales: SaleService.getAll(true).length,
                points: VIPCustomer.findById('VIP-KEEP').accumulatedPieces,
                stock: Inventory.findByBarcode('TEST').stock,
                firstUnchanged: window.__files.get(name) === contents
            }), firstFile);
            assert.ok(state.status.includes('sí quedó guardado'));
            assert.ok(state.status.includes('descarga JSON'));
            assert.equal(state.closed, true); assert.equal(state.sales, 1);
            assert.equal(state.points, 7); assert.equal(state.stock, 5); assert.equal(state.firstUnchanged, true);
            console.log('PASS: ' + mode + ' failure preserves the cut and prior files, explains the outcome and downloads complete fallback JSON');
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
