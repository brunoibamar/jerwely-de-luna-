const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        const warnings = [];
        page.on('console', msg => { if (/\[(SafeJSON|StorageGuard|DataValidator)\]/.test(msg.text())) warnings.push(msg.text()); });
        await page.goto(pathToFileURL(path.resolve('index.html')).href);
        await page.waitForFunction(() => window.app?.isInitialized);
        assert.deepEqual(warnings, [], 'Storage warnings on fresh startup');
        const result = await page.evaluate(async () => {
            const sale = { id: 'TODAY-TEST', date: new Date().toISOString(), total: 150, paymentMethod: 'cash', status: 'active', items: [{ barcode: 'TEST', description: 'Test', price: 150, quantity: 1, amount: 150 }] };
            await AppStorage.transaction(() => {
                SaleService.save([sale]); SaleService.saveHistorical([sale]);
                Cut.openSession(0, { id: 1, name: 'Test', role: 'admin' });
            });
            const keys = ['pos_storage_snapshot', 'pos_backup', 'pos_local_recovery'].map(k => Business.key(k));
            const copies = Object.fromEntries(keys.map((key, i) => [key, JSON.stringify({ test: i, content: 'X'.repeat(400000) })]));
            Object.entries(copies).forEach(([key, value]) => localStorage.setItem(key, value));
            for (let i = 0; i < 100; i++) { try { localStorage.setItem('test-filler-' + i, 'F'.repeat(100000)); } catch { break; } }
            let quota = false;
            try { SafeStorage.setItem('test-native-too-large', 'F'.repeat(100000)); } catch (error) { quota = SafeStorage.isQuotaError(error); }
            const open = indexedDB.open;
            indexedDB.open = () => { throw new Error('Test auxiliary database unavailable'); };
            try { await SafeStorage.prepareSpace(); } catch { /* expected */ }
            indexedDB.open = open;
            const intact = keys.every(key => localStorage.getItem(key) === copies[key]);
            await SafeStorage.prepareSpace();
            const archived = keys.every(key => localStorage.getItem(key) === null && SafeStorage.getItem(key) === copies[key]);
            const complete = keys.every(key => Backup.buildBackupData().rawStorage[key] === copies[key]);
            // Native quota no longer prevents an operational database transaction.
            await AppStorage.transaction(() => CashAdjustment.add({ type: 'test', amount: 1, description: 'Test', paymentMethod: 'cash' }));
            return { quota, intact, archived, complete, operationalWrite: CashAdjustment.getByDate(DateUtil.today()).length === 1,
                saleIntact: AppStorage.getItem(SaleService.storageKey) === JSON.stringify([sale]) };
        });
        assert.ok(Object.values(result).every(Boolean), JSON.stringify(result));
        console.log('PASS: native quota does not block operational writes; auxiliary archive preserves originals and export');
        let navigations = 0;
        page.on('framenavigated', () => navigations++);
        await page.evaluate(() => {
            app.isInitialized = false;
            for (let i = 0; i < 12; i++) { ErrorBoundary.errorCooldown = 0; ErrorBoundary.handleError({ message: 'El almacenamiento del navegador está lleno.' }); }
        });
        await page.waitForTimeout(1800);
        assert.equal(navigations, 0);
        const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#error-backup-btn').click()]);
        const emergency = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
        assert.ok(Object.values(emergency.rawStorage).some(value => value.includes('TODAY-TEST')));
        assert.ok(emergency.migrationOriginals && emergency.operationalRecords);
        const literalMatch = await page.evaluate(raw => AppStorage.keys().every(key => raw[key] === AppStorage.getItem(key)), emergency.rawStorage);
        assert.ok(literalMatch);
        for (const file of fs.readdirSync('js').filter(name => name.endsWith('.js'))) new (require('node:vm').Script)(fs.readFileSync(path.join('js', file), 'utf8'), { filename: file });
        console.log('PASS: repeated errors do not reload; emergency JSON preserves database records and originals; all scripts parse');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
