// Run with Node and Playwright available. Uses an isolated Chromium profile.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        const warnings = [];
        page.on('console', msg => {
            if (/\[(SafeJSON|StorageGuard|DataValidator)\]/.test(msg.text())) warnings.push(msg.text());
        });
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        await page.goto(pathToFileURL(path.resolve('index.html')).href);
        await page.waitForTimeout(1500);
        assert.deepEqual(errors, [], 'Browser load errors');
        console.log('Chromium load warnings:', warnings);
        const result = await page.evaluate(() => {
            const before = Object.fromEntries(Object.entries(localStorage));
            const backup = Backup.buildBackupData();
            const exactBackup = JSON.stringify(before) === JSON.stringify(backup.rawStorage);
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function () { throw new DOMException('Test quota', 'QuotaExceededError'); };
            let snapshot, quotaRecognized = false, closed = false;
            try {
                snapshot = StorageGuard.createSnapshot();
                try { SafeStorage.setItem('test', 'value'); } catch (err) { quotaRecognized = SafeStorage.isQuotaError(err); }
                // Create a valid session with the native method solely in this isolated profile.
                original.call(localStorage, Cut.storageKey, JSON.stringify({
                    id: 'TEST', openedAt: new Date().toISOString(), closedAt: null,
                    isOpen: true, initialAmount: 0, openedBy: 'Test', role: 'admin'
                }));
                const active = localStorage.getItem(Cut.storageKey);
                const history = localStorage.getItem(Cut.shiftHistoryKey);
                try { Cut.closeSession(); closed = true; } catch (err) { /* expected */ }
                const preserved = active === localStorage.getItem(Cut.storageKey) && history === localStorage.getItem(Cut.shiftHistoryKey);
                return { exactBackup, snapshot, quotaRecognized, closed, preserved };
            } finally { Storage.prototype.setItem = original; }
        });
        assert.deepEqual(result, { exactBackup: true, snapshot: null, quotaRecognized: true, closed: false, preserved: true });
        console.log('PASS: raw backup, nonblocking snapshot, quota identity, failed cut preserves active session/history');
        const recovery = await page.evaluate(async () => {
            const keys = ['pos_storage_snapshot', 'pos_backup', 'pos_local_recovery'].map(k => Business.key(k));
            const originalCopies = Object.fromEntries(keys.map((key, i) => [key, JSON.stringify({ test: i, content: 'X'.repeat(450000) })]));
            Object.entries(originalCopies).forEach(([key, value]) => localStorage.setItem(key, value));
            const sale = { id: 'TODAY-TEST', date: new Date().toISOString(), total: 150, paymentMethod: 'cash', items: [{ barcode: 'TEST', quantity: 1, amount: 150 }] };
            localStorage.setItem(SaleService.storageKey, JSON.stringify([sale]));
            localStorage.setItem(SaleService.historicalKey, JSON.stringify([sale]));
            const active = JSON.parse(localStorage.getItem(Cut.storageKey));
            active.openedAt = new Date(Date.now() - 60000).toISOString();
            localStorage.setItem(Cut.storageKey, JSON.stringify(active));
            const vipBefore = localStorage.getItem(VIPCustomer.storageKey);
            const salesBefore = localStorage.getItem(SaleService.storageKey);
            const historicalBefore = localStorage.getItem(SaleService.historicalKey);
            const inventoryBefore = localStorage.getItem(Inventory.storageKey);
            for (let i = 0; i < 100; i++) {
                try { localStorage.setItem('test-filler-' + i, 'F'.repeat(100000)); } catch { break; }
            }
            const open = indexedDB.open;
            indexedDB.open = () => { throw new Error('Test unavailable'); };
            try { await SafeStorage.prepareSpace(); } catch { /* expected */ }
            const failedMigrationPreserved = keys.every(k => localStorage.getItem(k) === originalCopies[k]);
            indexedDB.open = open;
            await SafeStorage.prepareSpace();
            const moved = keys.every(k => localStorage.getItem(k) === null && SafeStorage.getItem(k) === originalCopies[k]);
            SafeStorage.archivedCopies = {};
            await SafeStorage.prepareSpace();
            const survivesReload = keys.every(k => SafeStorage.getItem(k) === originalCopies[k]);
            const exportIncludesCopies = keys.every(k => Backup.buildBackupData().rawStorage[k] === originalCopies[k]);
            const closed = Cut.closeSession();
            return {
                failedMigrationPreserved, moved, survivesReload, exportIncludesCopies,
                closedWithTodaySale: closed.report.totalSales === 150 && closed.report.transactionCount === 1 && !Cut.isShiftOpen(),
                tablesUnchanged: localStorage.getItem(SaleService.storageKey) === salesBefore && localStorage.getItem(SaleService.historicalKey) === historicalBefore && localStorage.getItem(Inventory.storageKey) === inventoryBefore && localStorage.getItem(VIPCustomer.storageKey) === vipBefore
            };
        });
        assert.ok(Object.values(recovery).every(Boolean), JSON.stringify(recovery));
        console.log('PASS: full storage recovered, failed archive preserves originals, archived copies reload/export, today sales retained and cut saved');
        for (const name of fs.readdirSync('js').filter(n => n.endsWith('.js'))) {
            new (require('node:vm').Script)(fs.readFileSync(path.join('js', name), 'utf8'), { filename: name });
        }
        console.log('PASS: all JavaScript parses');
    } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
