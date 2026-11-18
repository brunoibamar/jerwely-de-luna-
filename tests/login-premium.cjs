const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [], warnings = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (/\[(SafeJSON|StorageGuard|DataValidator)\]/.test(message.text())) warnings.push(message.text()); });
        await page.route('https://api.telegram.org/**', route => route.abort());
        await page.goto(pathToFileURL(path.resolve('index.html')).href);
        await page.waitForFunction(() => window.app?.isInitialized);
        await page.waitForFunction(() => document.querySelector('.login-logo')?.naturalWidth > 0);
        fs.mkdirSync('.preview-login', { recursive: true });
        const data = () => page.evaluate(() => ({ records: Object.fromEntries(AppStorage.keys().filter(k => AppStorage.managed(k)).sort().map(k => [k, AppStorage.getItem(k)])), originals: AppStorage.originals }));
        const before = await data();
        assert.equal(await page.locator('#forgot-password-btn').count(), 0);
        assert.equal(await page.locator('#role-selection .role-card').count(), 2);
        assert.equal(await page.locator('#login-restore-btn').isVisible(), true);
        await page.screenshot({ path: path.resolve('.preview-login/01-inicio.png') });
        await page.locator('.role-card[data-role="admin"]').click();
        assert.equal(await page.locator('#admin-login-form').isVisible(), true);
        assert.equal(await page.locator('#guest-login-form').isVisible(), false);
        await page.screenshot({ path: path.resolve('.preview-login/02-administrador.png') });
        await page.locator('#admin-login-form [name="username"]').fill('admin');
        await page.locator('#admin-login-form [name="password"]').fill('incorrecta');
        await page.locator('#admin-login-form button[type="submit"]').click();
        assert.match(await page.locator('#login-error').innerText(), /incorrectas/);
        await page.locator('#admin-login-form [name="password"]').fill('admin123');
        await page.locator('#admin-login-form button[type="submit"]').click();
        assert.equal(await page.locator('#cash-open-overlay').isVisible(), true);
        assert.equal(await page.locator('#initial-amount').inputValue(), '');
        await page.screenshot({ path: path.resolve('.preview-login/04-caja-administrador.png') });
        const cashStyle = () => page.locator('#cash-open-overlay .cash-modal').evaluate(el => {
            const s = getComputedStyle(el); return { width: s.width, padding: s.padding, border: s.border, background: s.background, radius: s.borderRadius };
        });
        const adminStyle = await cashStyle();
        await page.locator('#cancel-cash-open').click();
        assert.equal(await page.locator('#role-selection').isVisible(), true);
        assert.deepEqual(await data(), before);
        await page.locator('.role-card[data-role="guest"]').click();
        assert.equal(await page.locator('#guest-login-form [name="guest-key"]').getAttribute('type'), 'password');
        await page.screenshot({ path: path.resolve('.preview-login/03-invitado.png') });
        await page.locator('#back-to-roles').click();
        assert.equal(await page.locator('#role-selection').isVisible(), true);
        await page.locator('.role-card[data-role="guest"]').click();
        await page.locator('#guest-direct-btn').click();
        assert.equal(await page.locator('#cash-open-overlay').isVisible(), true);
        const guestStyle = await cashStyle();
        assert.deepEqual(guestStyle, adminStyle);
        await page.screenshot({ path: path.resolve('.preview-login/05-caja-invitado.png') });
        await page.locator('#cancel-cash-open').click();
        assert.deepEqual(await data(), before);

        await page.locator('#login-local-recovery-hint').evaluate(el => {
            el.textContent = 'Respaldo local disponible del 18/11/2026, 10:00 a. m. (programado). Use Restaurar respaldo.';
            el.classList.remove('hidden');
        });
        for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
            await page.setViewportSize(viewport);
            const assertFits = async selector => {
                await page.locator(selector).scrollIntoViewIfNeeded();
                const box = await page.locator(selector).boundingBox();
                assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1, `Horizontal overflow: ${selector} at ${viewport.width}`);
            };
            await assertFits('.role-card[data-role="guest"]');
            await page.screenshot({ path: path.resolve(`.preview-login/inicio-${viewport.width}.png`) });
            await page.locator('.role-card[data-role="guest"]').click();
            await assertFits('#guest-login-form [name="guest-key"]');
            await assertFits('#back-to-roles');
            await page.screenshot({ path: path.resolve(`.preview-login/invitado-${viewport.width}.png`) });
            await page.locator('#back-to-roles').click();
            await page.locator('.role-card[data-role="guest"]').click();
            await page.locator('#guest-direct-btn').click();
            await assertFits('#initial-amount'); await assertFits('#confirm-cash-open');
            await page.screenshot({ path: path.resolve(`.preview-login/caja-${viewport.width}.png`) });
            await page.locator('#cancel-cash-open').click();
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const motion = await page.locator('.entry-ambience span').first().evaluate(el => getComputedStyle(el).animationName);
        assert.equal(motion, 'none');
        assert.deepEqual(await data(), before);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.locator('.role-card[data-role="guest"]').click();
        await page.locator('#guest-login-form button[type="submit"]').click();
        await page.locator('#initial-amount').fill('250');
        await page.locator('#confirm-cash-open').click();
        await page.waitForFunction(() => Cut.isShiftOpen());
        assert.equal(await page.evaluate(() => Cut.getActiveSession().initialAmount), 250);
        assert.equal(await page.evaluate(() => Cut.getActiveSession().role), 'guest');
        assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
        console.log('PASS: original login/back/cancel/guest access work, both roles share identical cash-opening style, logo loads, data remains unchanged while navigating, amount opens correct guest shift, desktop/mobile layouts fit and reduced-motion works');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
