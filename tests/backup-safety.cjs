const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(pathToFileURL(path.resolve('index.html')).href);
        await page.waitForFunction(() => window.app?.isInitialized);
        const result = await page.evaluate(async () => {
            const sale = { id: 'HISTORICAL-ORIGINAL', date: '2026-01-01T12:00:00.000Z', total: 100, paymentMethod: 'cash', status: 'active', items: [{ barcode: 'ORIGINAL', quantity: 1, amount: 100 }] };
            const second = { ...sale, id: 'SECOND', date: '2026-02-01T12:00:00.000Z' };
            await AppStorage.transaction(() => {
            AppStorage.setItem(SaleService.storageKey, JSON.stringify([sale]));
            AppStorage.setItem(SaleService.historicalKey, JSON.stringify([sale]));
            AppStorage.setItem(VIPCustomer.storageKey, JSON.stringify([{ id: 'VIP-ORIGINAL', name: 'Cliente de prueba', phone: '0000000000', accumulatedPieces: 7, rewardHistory: [], createdAt: '2026-01-01T12:00:00.000Z' }]));
            const products = JSON.parse(AppStorage.getItem(Inventory.storageKey));
            products[0].stock = 3;
            AppStorage.setItem(Inventory.storageKey, JSON.stringify(products));
            });
            const before = Object.fromEntries(AppStorage.keys().map(key => [key, AppStorage.getItem(key)]));
            await Backup.createLocalRecovery('test');
            await AutoBackup._queue;
            const noOperationalChanges = Object.entries(before).every(([k, v]) => AppStorage.getItem(k) === v);
            const internalOutsideSmallStorage = AppStorage.getItem(Backup.localRecoveryKey) === null && SafeStorage.getItem(Backup.localRecoveryKey).includes('HISTORICAL-ORIGINAL');
            const full = Backup.buildBackupData();
            const base = Business.key('pos_sales');
            const hist = Business.key('pos_sales_historical');
            full.rawStorage[base] = JSON.stringify([sale, second]);
            full.rawStorage[hist] = JSON.stringify([sale, second]);
            const imported = await Backup.importData(full);
            const importedAgain = await Backup.importData(full);
            const current = JSON.parse(AppStorage.getItem(base));
            const exactHistory = JSON.stringify(current[0]) === JSON.stringify(sale) && current.length === 2;
            const conflictFile = structuredClone(full);
            conflictFile.rawStorage[base] = JSON.stringify([{ ...sale, total: 999 }]);
            await Backup.importData(conflictFile);
            const conflictPreserved = JSON.parse(AppStorage.getItem(base))[0].total === 100;
            const malformed = structuredClone(full);
            malformed.rawStorage[hist] = '{bad JSON';
            const prior = AppStorage.getItem(base);
            const rejected = await Backup.importData(malformed);
            const preflightPreserved = !rejected.success && AppStorage.getItem(base) === prior;

            // Simular error después de escribir una de las dos tablas; revertir.
            const addition = { ...sale, id: 'ROLLBACK' };
            full.rawStorage[base] = JSON.stringify([sale, second, addition]);
            full.rawStorage[hist] = JSON.stringify([sale, second, addition]);
            const setItem = SafeStorage.setItem;
            SafeStorage.setItem = function (key, value) {
                if (key === hist) throw new DOMException('Test full', 'QuotaExceededError');
                return setItem.call(this, key, value);
            };
            const failed = await Backup.importData(full);
            SafeStorage.setItem = setItem;
            const rollbackPreserved = !failed.success && AppStorage.getItem(base) === prior;

            // Manejadores simulados: verificar nombres únicos y contenido leído.
            const files = new Map();
            const directory = {
                kind: 'directory', name: 'Backups', queryPermission: async () => 'granted',
                getDirectoryHandle: async day => ({ getFileHandle: async name => {
                    const key = day + '/' + name;
                    return { createWritable: async () => { let pending; return { write: async text => { pending = text; }, close: async () => files.set(key, pending) }; }, getFile: async () => ({ text: async () => files.get(key) }) };
                } })
            };
            AutoBackup._handle = directory;
            const one = await AutoBackup.save('venta');
            const two = await AutoBackup.save('corte');
            const fileVersions = one && two && files.size === 2 && [...files.values()].every(text => JSON.parse(text).rawStorage[base] === prior);
            const originalFile = [...files.values()][0];
            const corruptFile = { kind: 'file', name: 'old.json', queryPermission: async () => 'granted', getFile: async () => ({ text: async () => '{broken' }), createWritable: async () => { throw new Error('Must not overwrite'); } };
            AutoBackup._handle = corruptFile;
            const blocked = !await AutoBackup.save('test');
            AutoBackup._handle = { ...directory, getDirectoryHandle: async () => { throw new Error('Disk full'); } };
            const diskFailure = !await AutoBackup.save('test');
            AutoBackup._handle = { ...directory, getDirectoryHandle: async () => ({ getFileHandle: async () => ({
                createWritable: async () => ({ write: async () => {}, close: async () => {} }),
                getFile: async () => ({ text: async () => 'damaged bytes' })
            }) }) };
            const verificationFailure = !await AutoBackup.save('test');
            AutoBackup._handle = null;
            await Backup.renderMonthlyReminder();
            const monthlyDue = document.getElementById('monthly-backup-status').textContent.includes('Pendiente');
            return { noOperationalChanges, internalOutsideSmallStorage, importOk: imported.success && importedAgain.success,
                exactHistory, conflictPreserved, preflightPreserved, rollbackPreserved, fileVersions,
                blocked, diskFailure, verificationFailure, monthlyDue, previousFilePreserved: [...files.values()][0] === originalFile };
        });
        assert.ok(Object.values(result).every(Boolean), JSON.stringify(result));
        console.log('PASS:', JSON.stringify(result));
        await page.evaluate(() => {
            Auth.currentUser = { id: 1, username: 'admin', name: 'Administrador', role: 'admin' };
            AppStorage.setItem(Auth.current_userKey, JSON.stringify(Auth.currentUser));
            app.showApp(); app.switchSection('settings');
        });
        const originalSales = await page.evaluate(() => AppStorage.getItem(SaleService.storageKey));
        await page.evaluate(async () => {
            window.__pickerDescriptors = ['showDirectoryPicker', 'showSaveFilePicker'].map(key => [key, Object.getOwnPropertyDescriptor(window, key)]);
            for (const [key] of window.__pickerDescriptors) Object.defineProperty(window, key, { value: undefined, configurable: true });
            await AutoBackup.renderStatus();
        });
        assert.equal(await page.locator('#auto-backup-choose-btn').isEnabled(), true);
        await page.locator('#auto-backup-choose-btn').click();
        assert.ok((await page.locator('#auto-backup-feedback').textContent()).includes('Brave'));
        assert.ok((await page.locator('#auto-backup-status').textContent()).includes('no los transfiere'));
        await page.evaluate(async () => {
            Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => {
                window.__pickerCalledWithActivation = navigator.userActivation.isActive;
                throw new DOMException('Test blocked', 'SecurityError');
            } });
            await AutoBackup.renderStatus();
        });
        assert.equal(await page.evaluate(() => AutoBackup.isSupported()), true, 'Directory picker does not depend on save-file picker');
        await page.locator('#auto-backup-choose-btn').click();
        await page.waitForFunction(() => document.getElementById('auto-backup-feedback').textContent.includes('no permitió'));
        assert.equal(await page.evaluate(() => window.__pickerCalledWithActivation), true);
        await page.evaluate(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => { throw new DOMException('Cancel', 'AbortError'); } }));
        await page.locator('#auto-backup-choose-btn').click();
        await page.waitForFunction(() => document.getElementById('auto-backup-feedback').textContent.includes('No se seleccionó'));
        assert.equal(await page.locator('#auto-backup-choose-btn').isEnabled(), true);
        assert.equal(await page.evaluate(() => AppStorage.getItem(SaleService.storageKey)), originalSales);
        await page.evaluate(async () => {
            for (const [key, descriptor] of window.__pickerDescriptors) {
                if (descriptor) Object.defineProperty(window, key, descriptor);
                else delete window[key];
            }
            await AutoBackup.renderStatus();
        });
        console.log('PASS: unsupported browser, blocked picker and cancellation explain the result without touching sales; supported click keeps user activation');
        assert.equal(await page.locator('#backup-restore-section, #export-backup-setting-btn, #import-backup-setting-btn').count(), 0);
        // Ejercitar la descarga mensual con confirmación explícita del archivo.
        page.on('dialog', dialog => dialog.accept());
        const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#monthly-backup-btn').click()]);
        const json = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
        assert.ok(json.rawStorage && json.historicalSales && json.deviceId);
        const beforeUIImport = await page.evaluate(() => AppStorage.getItem(SaleService.storageKey));
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#auto-backup-import-btn').click()]);
        await chooser.setFiles({ name: 'respaldo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
        await page.waitForFunction(() => document.getElementById('backup-setting-success').textContent.includes('Recuperación completada'));
        assert.equal(await page.evaluate(() => AppStorage.getItem(SaleService.storageKey)), beforeUIImport);
        const manual = await page.evaluate(() => Backup.runScheduledBackup());
        assert.equal(manual.local, true);
        assert.equal(manual.external, null);
        console.log('PASS: one download and JSON import flow; importing via UI preserves sales; manual backup distinguishes unconfigured external folder');
        const fresh = await browser.newPage();
        await fresh.goto(pathToFileURL(path.resolve('index.html')).href);
        await fresh.waitForFunction(() => window.app?.isInitialized);
        const restored = await fresh.evaluate(async data => {
            const result = await Backup.importData(data);
            return { success: result.success,
                historical: JSON.parse(AppStorage.getItem(SaleService.historicalKey)),
                vip: JSON.parse(AppStorage.getItem(VIPCustomer.storageKey)),
                inventory: JSON.parse(AppStorage.getItem(Inventory.storageKey)) };
        }, json);
        assert.ok(restored.success);
        const originalHistorical = JSON.parse(json.rawStorage[`pos_sales_historical__biz_default__dev_${json.deviceId}`]);
        assert.deepEqual(restored.historical, originalHistorical);
        assert.equal(restored.vip[0].accumulatedPieces, 7);
        assert.equal(restored.inventory[0].stock, 3);
        await fresh.close();
        console.log('PASS: recovery in a fresh browser retains exact historical records, customer rewards and stock');
        await page.waitForFunction(() => document.getElementById('monthly-backup-status').textContent.includes('confirmada'));
        await page.reload();
        await page.waitForFunction(() => window.app?.isInitialized);
        await page.evaluate(() => Backup.renderMonthlyReminder());
        assert.ok((await page.locator('#monthly-backup-status').textContent()).includes('confirmada'));
        await page.evaluate(async () => {
            const previous = new Date(); previous.setMonth(previous.getMonth() - 1);
            await AutoBackup._dbOp('readwrite', s => s.put(previous.toISOString(), 'monthly-confirmed'));
            await Backup.renderMonthlyReminder();
        });
        assert.ok((await page.locator('#monthly-backup-status').textContent()).includes('Pendiente'));
        console.log('PASS: monthly full JSON download and reminder survive reload');
    } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
