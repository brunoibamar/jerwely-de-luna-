const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, timezoneId: 'America/Mexico_City' });
        await page.route('https://api.telegram.org/**', route => route.abort());
        await page.goto(pathToFileURL(path.resolve('index.html')).href);
        await page.waitForFunction(() => window.app?.isInitialized);
        const before = await page.evaluate(() => Object.fromEntries(AppStorage.keys().map(k => [k, AppStorage.getItem(k)])));
        await page.evaluate(() => {
            Auth.currentUser = { id: 1, role: 'admin', name: 'Prueba' };
            app.showApp(); app.switchSection('settings');
            const sale = (id, month, status = 'active') => ({ id, date: `2026-${month}-15T12:00:00-06:00`, total: 100, status,
                cashier: 'Cajera de prueba', paymentMethod: 'cash', paymentDetails: { amountReceived: 200, change: 100 },
                items: [{ barcode: 'A', description: 'Anillo de prueba', quantity: 2, price: 50, amount: 100 }] });
            const october = Array.from({ length: 28 }, (_, i) => sale(`OCT-${String(i).padStart(2, '0')}`, '10'));
            october.push(sale('CANCELADA-OCT', '10', 'canceled'));
            october[0].items[0].description = '<img src=x onerror="window.__xss=true">';
            const periods = [
                { month: '2025-12', historicalSales: [{ ...sale('OLD-YEAR', '12'), date: '2025-12-15T12:00:00-06:00' }] },
                { month: '2026-10', historicalSales: october }, { month: '2026-11', historicalSales: [sale('NOV-ONLY', '11')] }
            ];
            MonthlyArchiveView.render(document.getElementById('monthly-archive-summary'), {
                index: { savedAt: '2026-11-04T06:00:00Z' }, periods,
                complete: { returns: [{ id: 'R', saleId: 'OCT-00', date: '2026-11-01T12:00:00-06:00', refundAmount: 25, refundMethod: 'cash', items: [{ quantity: 1 }] }] }
            });
            document.getElementById('monthly-archive-dialog').showModal();
        });
        await page.locator('#monthly-archive-month').selectOption('10');
        const detail = page.locator('#monthly-archive-detail');
        assert.match(await detail.innerText(), /\$2,775\.00/);
        assert.equal(await page.locator('#monthly-archive-sales > .archive-table-scroll > table > tbody > tr').count(), 25);
        assert.ok(!(await page.locator('#monthly-archive-sales').innerText()).includes('NOV-ONLY'));
        await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
        assert.equal(await page.locator('#monthly-archive-sales > .archive-table-scroll > table > tbody > tr').count(), 4);
        await page.locator('#monthly-archive-search').fill('OCT-00');
        assert.equal(await page.locator('#monthly-archive-sales > .archive-table-scroll > table > tbody > tr').count(), 1);
        await page.locator('#monthly-archive-sales summary').click();
        assert.match(await page.locator('#monthly-archive-sales').innerText(), /\$25\.00/);
        assert.match(await page.locator('#monthly-archive-sales').innerText(), /Cambio: \$100\.00/);
        assert.equal(await page.locator('#monthly-archive-sales img').count(), 0);
        assert.equal(await page.evaluate(() => !!window.__xss), false);
        await page.locator('#monthly-archive-month').selectOption('11');
        assert.match(await page.locator('#monthly-archive-sales').innerText(), /NOV-ONLY/);
        assert.ok(!(await detail.innerText()).includes('OCT-00'));
        await page.locator('#monthly-archive-month').selectOption('09');
        assert.match(await detail.innerText(), /No hay ventas registradas/);
        await page.locator('#monthly-archive-year').selectOption('2025');
        assert.equal(await page.locator('#monthly-archive-month').inputValue(), '12');
        assert.match(await page.locator('#monthly-archive-sales').innerText(), /OLD-YEAR/);
        const after = await page.evaluate(() => Object.fromEntries(AppStorage.keys().map(k => [k, AppStorage.getItem(k)])));
        assert.deepEqual(after, before);
        console.log('PASS: year/month selectors isolate sales, totals exclude cancellations and subtract later refunds, pagination/search/detail work, hostile product names remain text and consultation does not change storage');

        if (process.env.POS_REVIEW_JSON) {
            const data = JSON.parse(fs.readFileSync(process.env.POS_REVIEW_JSON, 'utf8'));
            await page.evaluate(data => {
                const groups = new Map();
                for (const sale of data.historicalSales) {
                    const month = MonthlyArchive.monthOf(sale);
                    if (!groups.has(month)) groups.set(month, []); groups.get(month).push(sale);
                }
                MonthlyArchiveView.render(document.getElementById('monthly-archive-summary'), {
                    index: { savedAt: data.timestamp }, complete: data,
                    periods: [...groups].map(([month, historicalSales]) => ({ month, historicalSales }))
                });
            }, data);
            await page.locator('#monthly-archive-year').selectOption('2026');
            await page.locator('#monthly-archive-month').selectOption('10');
            assert.match(await detail.innerText(), /\$189,421\.00/);
            assert.match(await page.locator('.archive-pagination').innerText(), /898 registros/);
            fs.mkdirSync('.preview-history', { recursive: true });
            await page.locator('#monthly-archive-dialog').screenshot({ path: path.resolve('.preview-history/octubre-detallado.png') });
            await page.setViewportSize({ width: 430, height: 1000 });
            await page.locator('#monthly-archive-dialog').screenshot({ path: path.resolve('.preview-history/octubre-movil.png') });
            const overflow = await page.evaluate(() => { const dialog = document.getElementById('monthly-archive-dialog'); return dialog.scrollWidth > dialog.clientWidth + 1; });
            assert.equal(overflow, false);
            console.log('PASS: client October backup displays 898 records and $189,421 net; desktop/mobile views rendered without page overflow');
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
