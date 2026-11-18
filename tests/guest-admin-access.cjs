const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://api.telegram.org/**', route => route.abort());
        await page.goto(pathToFileURL(path.resolve('index.html')).href);
        await page.waitForFunction(() => window.app?.isInitialized);
        await page.evaluate(async () => {
            Auth.loginGuest();
            await AppStorage.transaction(() => {
                Inventory.saveProducts([{ barcode: 'ACCESS-TEST', description: 'Producto de prueba', price: 100, cost: 40, stock: 10, category: 'Anillos', aplicaPromocion: false }]);
                Cut.openSession(350, Auth.getCurrentUser());
            });
            app.showApp(); app.switchSection('sales'); app.cart.addItem(Inventory.findByBarcode('ACCESS-TEST'));
            window.__beforeAccess = Object.fromEntries(AppStorage.keys().map(key => [key, AppStorage.getItem(key)]));
            window.__originals = JSON.stringify(AppStorage.originals);
            window.__session = JSON.stringify(Cut.getActiveSession());
        });
        assert.equal(await page.locator('.nav-item[data-section="inventory"]').isVisible(), false);
        assert.equal(await page.locator('.price-input').count(), 0);
        const denied = await page.evaluate(async () => {
            app.cart.updatePrice('ACCESS-TEST', 30);
            const update = await AppStorage.transaction(() => Inventory.update('ACCESS-TEST', { stock: 99 }));
            return { price: app.cart.items[0].price, update: update.success };
        });
        assert.equal(denied.price, 100); assert.equal(denied.update, false);
        await page.locator('#guest-admin-access-btn').click();
        assert.ok(!(await page.locator('#guest-admin-access-form').innerText()).includes('1234'));
        await page.locator('#guest-admin-access-password').fill('incorrecta');
        await page.getByRole('button', { name: 'Habilitar acceso', exact: true }).click();
        assert.match(await page.locator('#guest-admin-access-error').innerText(), /incorrecta/);
        assert.equal(await page.evaluate(() => Auth.hasAdminAccess()), false);
        await page.locator('#guest-admin-access-password').fill('1234');
        await page.getByRole('button', { name: 'Habilitar acceso', exact: true }).click();
        assert.equal(await page.locator('#guest-admin-access-dialog').isVisible(), false);
        assert.equal(await page.locator('#guest-admin-access-status').isVisible(), true);
        assert.equal(await page.locator('.nav-item[data-section="inventory"]').isVisible(), true);
        assert.equal(await page.locator('.nav-item[data-section="settings"]').isVisible(), true);
        assert.equal(await page.locator('#cash-drawer-btn').isVisible(), false);
        assert.equal(await page.locator('#cash-close-btn').isVisible(), true);
        const untouched = await page.evaluate(() => ({
            same: Object.entries(window.__beforeAccess).every(([key, value]) => AppStorage.getItem(key) === value),
            session: window.__session === JSON.stringify(Cut.getActiveSession()), role: Auth.getRole(), direct: Auth.isAdmin(),
            original: window.__originals === JSON.stringify(AppStorage.originals)
        }));
        assert.deepEqual(untouched, { same: true, session: true, role: 'guest', direct: false, original: true });
        fs.mkdirSync('.preview-access', { recursive: true });
        await page.screenshot({ path: path.resolve('.preview-access/acceso-temporal-activo.png') });
        const promotion = await page.evaluate(() => {
            const previous = AppStorage.getItem('buenFinActive');
            SafeStorage.setItem('buenFinActive', 'true');
            const cart = new Cart();
            cart.addItem({ barcode: 'PROMO', description: 'Prueba de promoción', price: 100, stock: 100, aplicaPromocion: true });
            cart.updatePrice('PROMO', 55); cart.updateQuantity('PROMO', 8);
            const result = { price: cart.items[0].price, amount: cart.getSubtotal(), free: cart.getBuenFinFreePieces() };
            if (previous === null) AppStorage.removeItem('buenFinActive'); else SafeStorage.setItem('buenFinActive', previous);
            app.cart.render(); app.cart.updateTotals();
            return result;
        });
        assert.deepEqual(promotion, { price: 55, amount: 385, free: 1 });
        await page.locator('.nav-item[data-section="settings"]').click();
        assert.equal(await page.locator('#change-guest-admin-password-btn').isDisabled(), true);
        const passwordDenied = await page.evaluate(() => ({
            access: Auth.changeGuestAdminPassword('1234', '9999', '9999').success,
            login: Auth.changeAdminPassword(Auth.getAdminPassword(), '9999', '9999').success,
            guest: Auth.changeGuestKey(Auth.getGuestKey(), '9999', '9999').success,
            passwordUnchanged: Auth.getGuestAdminPassword() === '1234'
        }));
        assert.deepEqual(passwordDenied, { access: false, login: false, guest: false, passwordUnchanged: true });
        await page.locator('.nav-item[data-section="reports"]').click();
        assert.equal(await page.locator('#reports-section').evaluate(el => el.classList.contains('active')), true);
        await page.locator('.nav-item[data-section="inventory"]').click();
        await page.evaluate(() => app.showEditProductModal('ACCESS-TEST'));
        await page.locator('#edit-product-form input[name="stock"]').fill('12');
        await page.locator('#edit-product-form button[type="submit"]').click();
        await page.waitForFunction(() => Inventory.findByBarcode('ACCESS-TEST').stock === 12);
        await page.locator('.nav-item[data-section="sales"]').click();
        await page.locator('.price-input').fill('75'); await page.locator('.price-input').press('Tab');
        assert.equal(await page.evaluate(() => app.cart.getSubtotal()), 75);
        await page.locator('#guest-admin-access-btn').click();
        assert.equal(await page.locator('.price-input').count(), 0);
        assert.equal(await page.evaluate(() => app.cart.getSubtotal()), 75);
        const sale = await page.evaluate(async () => {
            const result = await AppStorage.transaction(() => Checkout.checkout(app.cart, { method: 'cash', cashAmount: 75 }));
            return { success: result.success, total: result.sale.total, cashier: result.sale.cashier, price: Inventory.findByBarcode('ACCESS-TEST').price,
                stock: Inventory.findByBarcode('ACCESS-TEST').stock, sameSession: JSON.stringify(Cut.getActiveSession()) === window.__session };
        });
        assert.deepEqual(sale, { success: true, total: 75, cashier: 'Invitado', price: 100, stock: 11, sameSession: true });
        console.log('PASS: wrong password denied; grant/revoke preserves exact records, original migration values, user and open shift; stock update and sale-only special price work; elevated guest cannot change credentials');

        await page.evaluate(() => { app.cart.clear(); Auth.enableGuestAdminAccess('1234'); app.updateRoleVisibility(); });
        await page.reload(); await page.waitForFunction(() => window.app?.isInitialized);
        assert.equal(await page.evaluate(() => Auth.hasTemporaryAdminAccess()), false);
        assert.equal(await page.evaluate(() => Cut.getActiveSession().initialAmount), 350);
        const lifecycle = await page.evaluate(async () => {
            const enabled = Auth.enableGuestAdminAccess('1234').success;
            const originalTx = AppStorage.tx;
            AppStorage.tx = function(stores, mode, run) { if (mode === 'readwrite') return Promise.reject(new Error('Simulated commit failure')); return originalTx.call(this, stores, mode, run); };
            try { await AppStorage.transaction(() => Cut.closeSession()); } catch { /* probar conservación */ }
            AppStorage.tx = originalTx;
            const failedCutKeepsAccess = Auth.hasTemporaryAdminAccess() && Cut.isShiftOpen();
            await AppStorage.transaction(() => Cut.closeSession());
            const closedCutRevokes = !Auth.hasTemporaryAdminAccess();
            await AppStorage.transaction(() => Cut.openSession(100, Auth.getCurrentUser()));
            const nextShiftLocked = !Auth.hasTemporaryAdminAccess();
            Auth.enableGuestAdminAccess('1234'); Auth.logout();
            return { enabled, failedCutKeepsAccess, closedCutRevokes, nextShiftLocked, logoutRevokes: !Auth.hasTemporaryAdminAccess() };
        });
        assert.ok(Object.values(lifecycle).every(Boolean));
        console.log('PASS: access is not persisted, failed close preserves the shift, successful close/logout revoke access and new shifts start restricted');

        await page.evaluate(async () => {
            Auth.login('admin', Auth.getAdminPassword());
            if (Auth.changeGuestAdminPassword('1234', '9999', '9999').success) throw new Error('No debe cambiarse desde una caja abierta como invitado.');
            await AppStorage.transaction(() => Cut.closeSession());
            await AppStorage.transaction(() => Cut.openSession(350, Auth.getCurrentUser()));
            app.showApp(); app.switchSection('settings');
        });
        assert.equal(await page.locator('#change-guest-admin-password-btn').isEnabled(), true);
        await page.locator('#guest-admin-current-password').fill('1234');
        await page.locator('#guest-admin-new-password').fill('5678');
        await page.locator('#guest-admin-confirm-password').fill('5678');
        await page.locator('#change-guest-admin-password-btn').click();
        assert.match(await page.locator('#guest-admin-password-message').innerText(), /actualizada/);
        await page.reload(); await page.waitForFunction(() => window.app?.isInitialized);
        const changed = await page.evaluate(async () => {
            Auth.loginGuest();
            await AppStorage.transaction(() => Cut.closeSession());
            await AppStorage.transaction(() => Cut.openSession(100, Auth.getCurrentUser()));
            return { persisted: Auth.getGuestAdminPassword() === '5678', oldDenied: !Auth.enableGuestAdminAccess('1234').success, newWorks: Auth.enableGuestAdminAccess('5678').success };
        });
        assert.ok(Object.values(changed).every(Boolean));
        const otherTab = await page.context().newPage();
        await otherTab.route('https://api.telegram.org/**', route => route.abort());
        await otherTab.goto(pathToFileURL(path.resolve('index.html')).href);
        await otherTab.waitForFunction(() => window.app?.isInitialized);
        await otherTab.evaluate(async () => {
            Auth.login('admin', Auth.getAdminPassword());
            await AppStorage.transaction(() => Cut.closeSession());
            await AppStorage.transaction(() => Cut.openSession(100, Auth.getCurrentUser()));
            const result = Auth.changeGuestAdminPassword('5678', '8765', '8765');
            if (!result.success) throw new Error(result.error);
        });
        await page.waitForFunction(() => !Auth.hasTemporaryAdminAccess());
        await otherTab.close();
        assert.equal(await page.evaluate(() => Auth.getGuestAdminPassword()), '8765');
        assert.deepEqual(errors, []);
        console.log('PASS: only a direct administrator can change the authorization password, the new password persists, and changes from another tab revoke the old grant');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
