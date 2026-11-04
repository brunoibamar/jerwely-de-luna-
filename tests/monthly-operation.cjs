const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage({ timezoneId: 'America/Mexico_City' });
        const warnings = [];
        page.on('pageerror', error => warnings.push(error.message));
        await page.route('https://api.telegram.org/**', route => route.abort());
        await page.goto(pathToFileURL(path.resolve('index.html')).href);
        await page.waitForFunction(() => window.app?.isInitialized);
        const result = await page.evaluate(async () => {
            Auth.currentUser = { id: 1, role: 'admin', name: 'Prueba' };
            window.confirm = () => true;
            const now = new Date();
            const old = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
            const sale = (id, date, total) => ({ id, date: date.toISOString(), total, status: 'active', paymentMethod: 'cash', items: [{ barcode: 'A', description: 'Anillo', quantity: 1, amount: total }] });
            const past = sale('PAST', old, 120), current = sale('CURRENT', now, 200);
            await AppStorage.transaction(() => {
                SaleService.save([past, current]); SaleService.saveHistorical([past, current]);
                Returns.save([{ id: 'RETURN', saleId: past.id, date: now.toISOString(), refundAmount: 20, items: [] }]);
            });
            const files = new Map(), reads = [];
            let mode = 'ok';
            const dir = (prefix = '') => ({
                kind: 'directory', name: 'Pruebas', queryPermission: async () => mode === 'permission' ? 'prompt' : 'granted',
                getDirectoryHandle: async name => dir(prefix + name + '/'),
                getFileHandle: async (name, options) => {
                    const key = prefix + name;
                    if (!options?.create && !files.has(key)) throw new DOMException('Missing', 'NotFoundError');
                    return {
                        createWritable: async () => { if (mode === 'disk') throw new Error('Disco lleno'); let text; return { write: async value => { text = value; }, close: async () => files.set(key, text), abort: async () => {} }; },
                        getFile: async () => { reads.push(key); return { text: async () => files.get(key) }; }
                    };
                }
            });
            AutoBackup._handle = dir();
            const saved = await AutoBackup.save('venta');
            const pointer = JSON.parse(files.get('Historial_mensual/Ultima_copia.json'));
            reads.length = 0;
            const monthly = await MonthlyArchive.readPeriod(old.getFullYear(), old.getMonth() + 1);
            const onlyMonth = reads.every(name => name.endsWith('Ultima_copia.json') || name.endsWith('Indice.json') || name.endsWith(MonthlyArchive.monthOf(past) + '.json'));
            const net = MonthlyArchive.summarize(monthly.sales, monthly.returns).net;
            const inventory = AppStorage.getItem(Inventory.storageKey);
            const originals = JSON.stringify(AppStorage.originals);
            await MonthlyArchive.archiveClosedMonths();
            const activeKept = SaleService.getHistoricalSales().map(s => s.id);
            const full = await MonthlyArchive.completeSnapshot(Backup.buildBackupData());
            const fullRaw = JSON.parse(full.rawStorage[SaleService.historicalKey]).map(s => s.id);
            // Una venta posterior no debe sustituir el mes archivado por uno vacío.
            const next = sale('NEXT', now, 50);
            await AppStorage.transaction(() => { SaleService.save([current, next]); SaleService.saveHistorical([current, next]); });
            await AutoBackup.save('venta');
            const after = await MonthlyArchive.read();
            document.getElementById('report-month-select').value = MonthlyArchive.monthOf(past);
            await app.updateSelectedMonthly();
            const monthlyCard = document.getElementById('monthly-sales').textContent;
            const localAfterReport = SaleService.getHistoricalSales().map(s => s.id);
            app.populateYearSelector();
            document.getElementById('year-selector').value = String(now.getFullYear());
            await app.updateHistoricalAnnual();
            const yearlyCard = document.getElementById('annual-sales').textContent;
            // El puntero portable funciona aunque se pierda la referencia local.
            await AutoBackup._dbOp('readwrite', s => s.delete(MonthlyArchive.pointerKey));
            const portable = await MonthlyArchive.readPeriod(old.getFullYear(), old.getMonth() + 1);
            const newPointer = JSON.parse(files.get('Historial_mensual/Ultima_copia.json'));
            const entry = after.index.months.find(e => e.month === MonthlyArchive.monthOf(past));
            const file = `Historial_mensual/${newPointer.generation}/${entry.name}`;
            const original = files.get(file);
            files.set(file, original + ' ');
            await app.updateSelectedMonthly();
            const failureMessage = document.getElementById('report-month-status').textContent;
            const failedCard = document.getElementById('monthly-sales').textContent;
            let rejected = false;
            try { await MonthlyArchive.archiveClosedMonths(); } catch { rejected = true; }
            files.set(file, original);
            mode = 'disk';
            const disk = await AutoBackup.save('venta');
            mode = 'permission';
            const permission = await AutoBackup.save('venta');
            mode = 'ok';
            const retried = await AutoBackup.save('venta');
            return { saved, onlyMonth, net, activeKept, fullRaw,
                allIds: after.complete.historicalSales.map(s => s.id), monthlyCard, localAfterReport, yearlyCard,
                portable: portable.sales.map(s => s.id), failureMessage, failedCard, rejected, disk, permission, retried,
                inventoryUnchanged: inventory === AppStorage.getItem(Inventory.storageKey), originalsUnchanged: originals === JSON.stringify(AppStorage.originals),
                archiveState: MonthlyArchive.state(), originalGenerationKept: [...files.keys()].some(key => key.includes(pointer.generation + '/')) };
        });
        assert.equal(result.saved, true); assert.equal(result.onlyMonth, true); assert.equal(result.net, 100);
        assert.deepEqual(result.activeKept, ['CURRENT']);
        assert.deepEqual(result.fullRaw, ['PAST', 'CURRENT']);
        assert.deepEqual(result.allIds, ['PAST', 'CURRENT', 'NEXT']);
        assert.equal(result.monthlyCard, '$100.00'); assert.deepEqual(result.localAfterReport, ['CURRENT', 'NEXT']);
        assert.equal(result.yearlyCard, new Date().getMonth() === 0 ? '$250.00' : '$350.00');
        assert.deepEqual(result.portable, ['PAST']); assert.equal(result.failedCard, '—');
        assert.match(result.failureMessage, /no disponible/); assert.equal(result.rejected, true);
        assert.equal(result.disk, false); assert.equal(result.permission, false); assert.equal(result.retried, true);
        assert.equal(result.inventoryUnchanged, true); assert.equal(result.originalsUnchanged, true); assert.equal(result.originalGenerationKept, true);
        assert.deepEqual(warnings, []);
        console.log('PASS: per-sale verified monthly backup, selected-month reads, returns, safe archive, active month preserved, full export includes archived sales, portable pointer, corrupt-file rejection, permission/disk failures and retry');

        // Datos reales opcionales: el archivo nunca se incluye en el repositorio.
        if (process.env.POS_REVIEW_JSON) {
            const data = JSON.parse(fs.readFileSync(process.env.POS_REVIEW_JSON, 'utf8'));
            const isolated = await browser.newPage({ timezoneId: 'America/Mexico_City' });
            await isolated.route('https://api.telegram.org/**', route => route.abort());
            await isolated.goto(pathToFileURL(path.resolve('index.html')).href);
            await isolated.waitForFunction(() => window.app?.isInitialized);
            const recovery = await isolated.evaluate(async data => {
                const imported = await Backup.importData(data);
                const importedAgain = await Backup.importData(data);
                const history = SaleService.getHistoricalSales();
                const totals = MonthlyArchive.summarize(history, Returns.getAll());
                return { ok: imported.success, repeated: importedAgain.success, count: history.length, unique: new Set(history.map(s => s.id)).size, transactions: totals.transactions };
            }, data);
            assert.equal(recovery.ok, true); assert.equal(recovery.repeated, true);
            assert.equal(recovery.count, data.historicalSales.length); assert.equal(recovery.unique, data.historicalSales.length);
            assert.equal(recovery.transactions, data.historicalSales.filter(s => s.status !== 'canceled').length);
            console.log('PASS: supplied backup imports twice in an isolated profile without duplicate sales');
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
