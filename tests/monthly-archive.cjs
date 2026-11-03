const assert = require('node:assert/strict');
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
        const result = await page.evaluate(async () => {
            const sale = (id, date, total, status = 'active') => ({ id, date, total, status, paymentMethod: 'cash', items: [{ barcode: 'A', description: 'Anillo', quantity: 2, amount: total }] });
            const sales = [sale('JAN', '2026-01-15T12:00:00', 100), sale('FEB', '2026-02-15T12:00:00', 200), sale('CANCEL', '2026-02-16T12:00:00', 999, 'canceled'), sale('OLD', '2025-12-15T12:00:00', 50), sale('UNDATED', 'fecha antigua inválida', 10)];
            await AppStorage.transaction(() => {
                SaleService.save(sales); SaleService.saveHistorical(sales);
                VIPCustomer.save([{ id: 'KEEP-VIP', name: 'Conservar', phone: '0000000000', accumulatedPieces: 9, rewardHistory: [], createdAt: '2026-01-01T12:00:00.000Z' }]);
                Returns.save([{ id: 'R', saleId: 'JAN', date: '2026-02-20T12:00:00', refundAmount: 25, items: [{ barcode: 'A', quantity: 1 }] }]);
            });
            const before = Object.fromEntries(AppStorage.keys().map(key => [key, AppStorage.getItem(key)]));
            window.__monthlyFiles = new Map(); window.__monthlyMode = 'ok';
            const directory = prefix => ({
                kind: 'directory', name: prefix || 'Carpeta elegida', queryPermission: async () => window.__monthlyMode === 'permission' ? 'prompt' : 'granted',
                requestPermission: async () => 'granted',
                getDirectoryHandle: async (name, options) => {
                    if (window.__monthlyMode === 'disk' && options?.create) throw new Error('Disco lleno');
                    return directory(prefix + name + '/');
                },
                getFileHandle: async (name, options) => {
                    const key = prefix + name;
                    if (!options?.create && !window.__monthlyFiles.has(key)) throw new Error('Archivo no encontrado');
                    return {
                        createWritable: async () => { let text; return { write: async value => { text = value; }, close: async () => window.__monthlyFiles.set(key, text), abort: async () => {} }; },
                        getFile: async () => ({ text: async () => window.__monthlyMode === 'verify' ? 'dañado' : window.__monthlyFiles.get(key) })
                    };
                }
            });
            window.__monthlyDirectory = directory('');
            AutoBackup._handle = window.__monthlyDirectory;
            const first = await MonthlyArchive.create();
            if (!first.success) throw new Error(first.error);
            const read = await MonthlyArchive.read();
            const copiedVip = JSON.parse(read.complete.vipCustomers)[0];
            const totals = MonthlyArchive.summarize(read.periods.filter(p => p.month.startsWith('2026-')).flatMap(p => p.historicalSales), read.complete.returns);
            const oldFiles = [...window.__monthlyFiles];
            const originalPointer = await AutoBackup._dbOp('readonly', s => s.get(MonthlyArchive.pointerKey));
            const failures = [];
            for (const mode of ['permission', 'disk', 'verify']) {
                window.__monthlyMode = mode;
                const failed = await MonthlyArchive.create();
                const pointer = await AutoBackup._dbOp('readonly', s => s.get(MonthlyArchive.pointerKey));
                failures.push(!failed.success && JSON.stringify(pointer) === JSON.stringify(originalPointer));
            }
            window.__monthlyMode = 'ok';
            const second = await MonthlyArchive.create();
            const secondRead = await MonthlyArchive.read();
            const monthly = secondRead.index.months.find(entry => entry.month === '2026-01');
            const filename = `Historial_mensual/${secondRead.index.generation}/${monthly.name}`;
            const originalText = window.__monthlyFiles.get(filename);
            window.__monthlyFiles.set(filename, originalText.replace('JAN', 'BAD'));
            let corruptionRejected = false;
            try { await MonthlyArchive.read(); } catch { corruptionRejected = true; }
            window.__monthlyFiles.set(filename, originalText);
            const shown = await MonthlyArchive.showSummary();
            // Retry correo no crea un corte ni confirma correo pendiente como enviado.
            const beforeCuts = Cut.getSessionHistory().length;
            app.currentReport = { sessionId: 'SAME-CUT', date: new Date().toISOString(), totalSales: 300 };
            const send = Backup.sendGuestSessionEmail;
            Auth.currentUser = { role: 'guest', name: 'Empleada', id: 2 };
            Backup.sendGuestSessionEmail = async () => ({ success: true, message: 'Correo pendiente de envío.' });
            await app.sendCutReportEmail();
            const emailStatus = document.getElementById('cut-backup-status').textContent;
            Backup.sendGuestSessionEmail = send;
            const unchanged = Object.entries(before).every(([key, value]) => AppStorage.getItem(key) === value);
            return { first: first.success, second: second.success, exact: JSON.stringify(read.complete.historicalSales) === JSON.stringify(sales),
                raw: read.complete.rawStorage[SaleService.historicalKey] === before[SaleService.historicalKey], copiedVip,
                months: read.index.months.map(m => m.month), totals, failures, corruptionRejected, shown,
                oldFilesKept: oldFiles.every(([key, value]) => window.__monthlyFiles.get(key) === value), unchanged,
                reportsUnchanged: JSON.stringify(ReportService.getHistoricalSales()) === JSON.stringify(sales),
                noDuplicateCut: Cut.getSessionHistory().length === beforeCuts, emailStatus,
                summary: document.getElementById('monthly-archive-summary').textContent };
        });
        assert.equal(result.first, true); assert.equal(result.second, true);
        assert.equal(result.exact, true); assert.equal(result.raw, true);
        assert.equal(result.copiedVip.id, 'KEEP-VIP'); assert.equal(result.copiedVip.accumulatedPieces, 9);
        assert.deepEqual(result.months, ['2025-12', '2026-01', '2026-02', 'sin-fecha']);
        assert.equal(result.totals.transactions, 2); assert.equal(result.totals.net, 275); assert.equal(result.totals.pieces, 3);
        assert.ok(result.failures.every(Boolean)); assert.equal(result.corruptionRejected, true);
        assert.equal(result.shown, true); assert.ok(result.summary.includes('275'));
        assert.equal(result.oldFilesKept, true); assert.equal(result.unchanged, true); assert.equal(result.reportsUnchanged, true);
        assert.equal(result.noDuplicateCut, true); assert.ok(result.emailStatus.includes('Correo pendiente'));
        console.log('PASS: monthly files preserve exact history/raw values/VIP, isolate years, include returns/cancellations, retain invalid dates and keep operational reports unchanged');
        console.log('PASS: permission/disk/verification failures retain previous generation; corrupt files block reading; originals and browser records never removed');
        console.log('PASS: combined backup/email reports pending email honestly and never creates another cut');
        const later = await page.evaluate(async () => {
            const originalSales = SaleService.getHistoricalSales();
            await AppStorage.transaction(() => {
                const customers = VIPCustomer.getAll();
                customers.push({ id: 'NEW-VIP', name: 'Nuevo', phone: '1111111111', accumulatedPieces: 3, rewardHistory: [], createdAt: new Date().toISOString() });
                VIPCustomer.save(customers);
            });
            // Un navegador que no puede serializar el permiso debe conservar el
            // acceso de esta sesión y explicarlo, sin fingir que quedó persistido.
            const descriptor = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker');
            Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => window.__monthlyDirectory });
            const selected = await AutoBackup.chooseDirectory();
            if (descriptor) Object.defineProperty(window, 'showDirectoryPicker', descriptor);
            else delete window.showDirectoryPicker;
            const feedback = document.getElementById('auto-backup-feedback').textContent;
            const read = await MonthlyArchive.read();
            return { selected, feedback, customers: JSON.parse(read.complete.vipCustomers).map(c => c.id),
                salesUnchanged: JSON.stringify(originalSales) === JSON.stringify(SaleService.getHistoricalSales()) };
        });
        assert.equal(later.selected, true); assert.ok(later.feedback.includes('sólo quedó disponible en esta sesión'));
        assert.deepEqual(later.customers, ['KEEP-VIP', 'NEW-VIP']); assert.equal(later.salesUnchanged, true);
        console.log('PASS: newly registered VIP included in next archive; choosing folder still writes verified files when persistent permission storage fails and explains session-only access');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
