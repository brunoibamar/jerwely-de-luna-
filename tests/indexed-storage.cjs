const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
    const root = path.resolve('.');
    const server = http.createServer((request, response) => {
        const target = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
        if (!target.startsWith(root + path.sep) && target !== root) { response.writeHead(403).end(); return; }
        const file = target === root ? path.join(root, 'index.html') : target;
        fs.readFile(file, (error, data) => {
            if (error) return response.writeHead(404).end();
            response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
            response.end(data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const suffix = '__biz_default__dev_TESTDEVICE';
    const now = Date.now();
    const product = { barcode: 'PRODUCT', description: 'Prueba', stock: 20, price: 100, cost: 50, category: 'Anillos', aplicaPromocion: false };
    const oldSale = { id: 'OLD-UNCHANGED', date: new Date(now - 60000).toISOString(), total: 100, paymentMethod: 'cash', status: 'active', items: [{ barcode: 'PRODUCT', description: 'Prueba', price: 100, quantity: 1, amount: 100 }], note: 'X'.repeat(350000) };
    const vip = { id: 'VIP-OLD', name: 'Prueba VIP', phone: '0000000000', accumulatedPieces: 2, rewardHistory: [], createdAt: new Date(now - 86400000).toISOString() };
    const seed = {
        ['pos_inventory' + suffix]: JSON.stringify([product]),
        ['pos_sales' + suffix]: JSON.stringify([oldSale]),
        ['pos_sales_historical' + suffix]: JSON.stringify([oldSale]),
        ['pos_vip_customers' + suffix]: JSON.stringify([vip]),
        ['pos_shift_history' + suffix]: '[]',
        ['pos_returns' + suffix]: '[]', ['pos_cash_adjustments' + suffix]: '[]',
        ['pos_guarantee_exchanges' + suffix]: '[]',
        ['pos_shift_session' + suffix]: JSON.stringify({ id: 'SHIFT-OLD', openedAt: new Date(now - 120000).toISOString(), isOpen: true, initialAmount: 100, openedBy: 'Empleada', role: 'guest', closedAt: null })
    };
    async function contextWithSeed(options = {}) {
        const context = await browser.newContext();
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
        await context.addInitScript(({ seed, suffix, full, fail, interrupt }) => {
            if (!localStorage.getItem('_test_seeded')) {
                localStorage.setItem('jewelry_deluna_device_id', 'TESTDEVICE');
                localStorage.setItem('pos_current_user' + suffix, JSON.stringify({ id: 2, username: 'empleada', name: 'Empleada', role: 'guest' }));
                for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
                localStorage.setItem('_test_seeded', 'yes');
                if (full) for (let i = 0; i < 100; i++) {
                    try { localStorage.setItem('_unrelated_filler_' + i, 'F'.repeat(100000)); } catch { break; }
                }
            }
            if (fail) indexedDB.open = () => { throw new Error('Test database unavailable'); };
            if (interrupt && !localStorage.getItem('_test_interrupted')) {
                const remove = Storage.prototype.removeItem; let count = 0;
                Storage.prototype.removeItem = function (key) {
                    if (String(key).startsWith('pos_') && ++count === 2) {
                        localStorage.setItem('_test_interrupted', 'yes'); throw new Error('Test interruption');
                    }
                    return remove.call(this, key);
                };
            }
        }, { seed, suffix, full: options.full, fail: options.fail, interrupt: options.interrupt });
        return context;
    }
    try {
        const context = await contextWithSeed({ full: true });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        await page.waitForFunction(() => window.app?.isInitialized);
        assert.deepEqual(errors, []);
        const migrated = await page.evaluate(expected => ({
            exact: Object.entries(expected).every(([key, value]) => AppStorage.getItem(key) === value && AppStorage.originals[key] === value),
            nativeFreed: Object.keys(expected).every(key => localStorage.getItem(key) === null),
            employee: Auth.getRole(), ready: AppStorage.ready,
            emergencyIncludesOriginals: Backup.buildBackupData().migrationOriginals[SaleService.storageKey] === expected[SaleService.storageKey]
        }), seed);
        assert.deepEqual(migrated, { exact: true, nativeFreed: true, employee: 'guest', ready: true, emergencyIncludesOriginals: true });
        console.log('PASS: full native storage migrates byte-for-byte, originals preserved, employee access unchanged');
        const sale = await page.evaluate(async () => {
            const cart = new Cart(); cart.addItem(Inventory.findByBarcode('PRODUCT'));
            const result = await AppStorage.transaction(() => Checkout.checkout(cart, { method: 'cash', vipCustomerId: 'VIP-OLD' }));
            return { success: result.success, stock: Inventory.findByBarcode('PRODUCT').stock,
                count: SaleService.recordsForWrite(SaleService.storageKey).length,
                vip: VIPCustomer.findById('VIP-OLD').accumulatedPieces,
                original: AppStorage.originals[SaleService.storageKey], first: SaleService.recordsForWrite(SaleService.storageKey)[0] };
        });
        assert.equal(sale.success, true); assert.equal(sale.stock, 19); assert.equal(sale.count, 2); assert.equal(sale.vip, 3);
        assert.equal(sale.original, seed['pos_sales' + suffix]); assert.deepEqual(sale.first, oldSale);
        console.log('PASS: sale, historical record, inventory and VIP points commit together; old records unchanged');
        const failed = await page.evaluate(async () => {
            const before = Object.fromEntries(AppStorage.records);
            const tx = AppStorage.tx;
            AppStorage.tx = function (stores, mode, run) {
                if (mode === 'readwrite' && stores.includes('records')) return tx.call(this, stores, mode, transaction => {
                    const result = run(transaction);
                    // Abort after queued writes have executed inside the transaction.
                    const verify = transaction.objectStore('records').get(SaleService.storageKey);
                    verify.onsuccess = () => transaction.abort();
                    return result;
                });
                return tx.call(this, stores, mode, run);
            };
            const cart = new Cart(); cart.addItem(Inventory.findByBarcode('PRODUCT'));
            let rejected = false;
            try { await AppStorage.transaction(() => Checkout.checkout(cart, { method: 'cash', vipCustomerId: 'VIP-OLD' })); } catch { rejected = true; }
            AppStorage.tx = tx;
            await AppStorage.refresh();
            return { rejected, unchanged: JSON.stringify(Object.fromEntries(AppStorage.records)) === JSON.stringify(before), cartRetained: !cart.isEmpty() };
        });
        assert.deepEqual(failed, { rejected: true, unchanged: true, cartRetained: true });
        console.log('PASS: failed commit leaves all tables unchanged and keeps cart');
        const ui = await page.evaluate(async () => {
            window.notificarTelegram = () => {};
            Print.printReceipt = () => {};
            app.currentVipCustomer = VIPCustomer.findById('VIP-OLD');
            app.cart.addItem(Inventory.findByBarcode('PRODUCT'));
            const successes = [], success = Toast.success, tx = AppStorage.tx;
            Toast.success = message => { successes.push(message); };
            AppStorage.tx = function (stores, mode, run) {
                if (mode === 'readwrite' && stores.includes('records')) return Promise.reject(new Error('Test UI commit error'));
                return tx.call(this, stores, mode, run);
            };
            await app.completeCheckout({ method: 'cash' });
            const failureKeptCart = !app.cart.isEmpty() && !successes.some(s => s.includes('Venta completada'));
            AppStorage.tx = tx;
            await Promise.all([app.completeCheckout({ method: 'cash' }), app.completeCheckout({ method: 'cash' })]);
            Toast.success = success;
            return { failureKeptCart, oneSuccess: successes.filter(s => s.includes('Venta completada')).length === 1,
                sales: SaleService.recordsForWrite(SaleService.storageKey).length, vip: VIPCustomer.findById('VIP-OLD').accumulatedPieces };
        });
        assert.deepEqual(ui, { failureKeptCart: true, oneSuccess: true, sales: 3, vip: 4 });
        console.log('PASS: employee checkout waits for commit, keeps failed cart and blocks double submission');
        await page.reload(); await page.waitForFunction(() => window.app?.isInitialized);
        assert.equal(await page.evaluate(() => SaleService.recordsForWrite(SaleService.storageKey).length), 3);
        const other = await context.newPage(); await other.goto(url); await other.waitForFunction(() => window.app?.isInitialized);
        await Promise.all([page, other].map(tab => tab.evaluate(() => AppStorage.transaction(() => VIPCustomer.addPieces('VIP-OLD', 1, 'two tabs')))));
        await page.evaluate(() => AppStorage.refresh());
        assert.equal(await page.evaluate(() => VIPCustomer.findById('VIP-OLD').accumulatedPieces), 6);
        console.log('PASS: reload and concurrent tabs preserve both updates');
        const cutFailed = await page.evaluate(async () => {
            const before = AppStorage.getItem(Cut.storageKey), tx = AppStorage.tx;
            AppStorage.tx = function (stores, mode, run) {
                if (mode === 'readwrite' && stores.includes('records')) return Promise.reject(new Error('Test failed cut'));
                return tx.call(this, stores, mode, run);
            };
            let rejected = false;
            try { await AppStorage.transaction(() => Cut.closeSession()); } catch { rejected = true; }
            AppStorage.tx = tx;
            return rejected && AppStorage.getItem(Cut.storageKey) === before && Cut.getSessionHistory().length === 0;
        });
        assert.ok(cutFailed);
        const cut = await page.evaluate(() => AppStorage.transaction(() => Cut.closeSession()));
        assert.equal(cut.report.transactionCount, 3);
        await other.waitForFunction(() => !Cut.isShiftOpen());
        await page.reload(); await page.waitForFunction(() => window.app?.isInitialized);
        assert.equal(await page.evaluate(() => Cut.getSessionHistory().length), 1);
        console.log('PASS: failed cut keeps shift open; successful cut persists and synchronizes');

        // Read a real export and restore it in an independent, new browser profile.
        const backup = await page.evaluate(() => Backup.buildBackupData());
        const fresh = await browser.newContext();
        await fresh.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
        const recovered = await fresh.newPage(); await recovered.goto(url); await recovered.waitForFunction(() => window.app?.isInitialized);
        const restored = await recovered.evaluate(async data => {
            const first = await Backup.importData(data), again = await Backup.importData(data);
            return { success: first.success && again.success, sales: SaleService.recordsForWrite(SaleService.storageKey).length,
                cuts: Cut.getSessionHistory().length, vip: VIPCustomer.findById('VIP-OLD').accumulatedPieces,
                stock: Inventory.findByBarcode('PRODUCT').stock };
        }, backup);
        assert.deepEqual(restored, { success: true, sales: 3, cuts: 1, vip: 6, stock: 18 });
        console.log('PASS: complete JSON recovery and repeated import preserve sales, cuts, rewards and stock');
        await fresh.close();
        await context.close();

        const unavailable = await contextWithSeed({ fail: true });
        const blocked = await unavailable.newPage(); await blocked.goto(url);
        await blocked.waitForFunction(() => document.getElementById('error-boundary-banner'));
        assert.equal(await blocked.evaluate(expected => Object.entries(expected).every(([key, value]) => localStorage.getItem(key) === value), seed), true);
        assert.equal(await blocked.evaluate(() => !!app.isInitialized), false);
        console.log('PASS: unavailable IndexedDB fails closed and preserves native originals');
        await unavailable.close();
        const interrupted = await contextWithSeed({ interrupt: true });
        const resume = await interrupted.newPage(); await resume.goto(url);
        await resume.waitForFunction(() => document.getElementById('error-boundary-banner'));
        await resume.reload(); await resume.waitForFunction(() => window.app?.isInitialized);
        assert.equal(await resume.evaluate(expected => Object.entries(expected).every(([key, value]) => AppStorage.getItem(key) === value && AppStorage.originals[key] === value), seed), true);
        console.log('PASS: interrupted migration resumes without rewriting originals or losing records');
        await resume.evaluate(async () => {
            await AppStorage.tx(['records'], 'readwrite', tx => tx.objectStore('records').put('[]', SaleService.storageKey));
        });
        await resume.reload(); await resume.waitForFunction(() => document.getElementById('error-boundary-banner'));
        assert.equal(await resume.evaluate(() => !!app.isInitialized), false);
        assert.equal(await resume.evaluate(expected => AppStorage.originals[SaleService.storageKey] === expected, seed['pos_sales' + suffix]), true);
        console.log('PASS: integrity mismatch stops startup, preserves baseline and avoids fresh empty records');
        await interrupted.close();
        const movementContext = await contextWithSeed();
        const movementPage = await movementContext.newPage(); await movementPage.goto(url);
        await movementPage.waitForFunction(() => window.app?.isInitialized);
        const movements = await movementPage.evaluate(async () => {
            Auth.currentUser = { id: 1, username: 'admin', name: 'Admin de prueba', role: 'admin' };
            SafeStorage.setItem(Auth.current_userKey, JSON.stringify(Auth.currentUser));
            window.notificarTelegram = () => {};
            TelegramNotify.notificarDevolucion = () => {};
            TelegramNotify.notificarCambioGarantia = () => {};
            const createSale = () => AppStorage.transaction(() => { const cart = new Cart(); cart.addItem(Inventory.findByBarcode('PRODUCT')); return Checkout.checkout(cart, { method: 'cash' }); });
            const second = await createSale(), third = await createSale();
            app.selectedReturnSale = SaleService.getById('OLD-UNCHANGED'); app.returnItemStates = { PRODUCT: 1 };
            await app.processReturn();
            app.selectedGuaranteeSale = second.sale; app.defectiveItemStates = { PRODUCT: 1 }; app.replacementItems = { PRODUCT: 1 };
            await app.processGuaranteeExchange();
            app.selectedCancelSale = third.sale;
            document.getElementById('cancel-reason-input').value = 'Prueba';
            await app.cancelSaleConfirm();
            document.getElementById('withdrawal-amount-input').value = '10';
            await app.processWithdrawal();
            const held = await AppStorage.transaction(() => HeldSales.hold([{ barcode: 'PRODUCT', quantity: 1, price: 100, amount: 100, description: 'Prueba' }], 'test'));
            await app.resumeHeldSale(held.id);
            return { returns: Returns.getAll().length, guarantees: GuaranteeExchange.getAll().length,
                canceled: SaleService.getById(third.sale.id).status, adjustments: CashAdjustment.getAll().length,
                stock: Inventory.findByBarcode('PRODUCT').stock, held: HeldSales.getCount(), resumed: app.cart.getItems().length,
                original: JSON.parse(AppStorage.originals[SaleService.storageKey])[0].status };
        });
        assert.deepEqual(movements, { returns: 1, guarantees: 1, canceled: 'canceled', adjustments: 3, stock: 19, held: 0, resumed: 1, original: 'active' });
        console.log('PASS: returns, warranty, cancellation, cash movements and held-sale UI use durable transactions');
        const postCommitFailure = await movementPage.evaluate(async () => {
            const update = app.updateDailyReport, warning = Toast.warning, notify = AppStorage.channel.postMessage;
            const messages = [];
            Print.printReceipt = () => {};
            app.updateDailyReport = () => { throw new Error('Test UI error after saved sale'); };
            Toast.warning = message => messages.push(message);
            AppStorage.channel.postMessage = () => { throw new Error('Test notification unavailable'); };
            const before = SaleService.getAll(true).length;
            await app.completeCheckout({ method: 'cash' });
            app.updateDailyReport = update; Toast.warning = warning; AppStorage.channel.postMessage = notify;
            return SaleService.getAll(true).length === before + 1 && app.cart.isEmpty() && messages.some(message => message.includes('no repita el cobro'));
        });
        assert.ok(postCommitFailure);
        console.log('PASS: a post-commit UI/notification error is reported as saved, not as a failed charge');
        const committedBeforeConflict = await movementPage.evaluate(() => AppStorage.getItem(SaleService.storageKey));
        const legacy = await movementContext.newPage(); await legacy.goto(url); await legacy.waitForFunction(() => window.app?.isInitialized);
        await legacy.evaluate(() => localStorage.setItem(SaleService.storageKey, '[{"legacy":"unsynchronized"}]'));
        await movementPage.waitForFunction(() => Object.keys(AppStorage.conflicts).length > 0);
        assert.equal(await movementPage.evaluate(() => AppStorage.getItem(SaleService.storageKey)), committedBeforeConflict);
        const blockedWrite = await movementPage.evaluate(async () => {
            try { await AppStorage.transaction(() => VIPCustomer.addPieces('VIP-OLD', 1)); return false; }
            catch { return true; }
        });
        assert.ok(blockedWrite);
        // The blocked write removes its busy overlay; the page can still export
        // through the emergency handler without modifying either stored version.
        const [conflictBackup] = await Promise.all([
            movementPage.waitForEvent('download'), movementPage.evaluate(() => ErrorBoundary.downloadEmergencyBackup())
        ]);
        const conflictData = JSON.parse(fs.readFileSync(await conflictBackup.path(), 'utf8'));
        assert.equal(conflictData.operationalRecords['pos_sales' + suffix], committedBeforeConflict);
        assert.equal(conflictData.nativeConflicts['pos_sales' + suffix], '[{"legacy":"unsynchronized"}]');
        console.log('PASS: older-tab writes freeze new mutations and emergency export preserves both versions');
        await movementContext.close();
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
