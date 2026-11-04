// El retiro de meses requiere una copia verificada y una acción del administrador.
// Cada generación es independiente; el índice se publica sólo tras verificarla.
class MonthlyArchive {
    static get pointerKey() { return `monthly-archive:${Business.key('pos_sales_historical')}`; }
    static get stateKey() { return Business.key('pos_archive_state'); }

    static state() {
        const state = SafeJSON.parse(AppStorage.getItem(this.stateKey), null, 'archivo mensual');
        if (state === null) return { months: [] };
        if (!state || !Array.isArray(state.months) || state.months.some(m => !/^\d{4}-\d{2}$/.test(m))) throw new Error('El estado del archivo requiere revisión.');
        return state;
    }

    static mergeRecords(archived, current) {
        const records = new Map();
        for (const list of [archived, current]) {
            const seen = new Set();
            for (const record of list) {
                if (!record || record.id == null) throw new Error('Hay registros sin identificador; no se archivó información.');
                const key = JSON.stringify([record.id, record.date]);
                if (seen.has(key)) throw new Error('Hay registros repetidos que requieren revisión.');
                seen.add(key); records.set(key, record);
            }
        }
        return [...records.values()];
    }

    static async completeSnapshot(snapshot) {
        const state = this.state();
        if (!state.months.length) return snapshot;
        const previous = await this.read();
        if (state.months.some(month => !previous.periods.some(p => p.month === month))) throw new Error('Falta un mes archivado. Reconecte la carpeta original antes de respaldar.');
        const result = { ...snapshot, rawStorage: { ...snapshot.rawStorage } };
        for (const source of ['sales', 'historicalSales']) {
            const older = previous.periods.filter(p => state.months.includes(p.month)).flatMap(p => p[source]);
            result[source] = this.mergeRecords(older, snapshot[source]);
            const key = source === 'sales' ? SaleService.storageKey : SaleService.historicalKey;
            result.rawStorage[key] = JSON.stringify(result[source]);
        }
        return result;
    }

    static feedback(message) {
        const el = document.getElementById('monthly-archive-status');
        if (el) el.textContent = message;
    }

    static async digest(text) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
    }

    static monthOf(record) {
        // Usar el calendario local, igual que los reportes del punto de venta.
        if (!record || typeof record.date !== 'string' || !record.date.trim()) return 'sin-fecha';
        const date = new Date(record.date);
        if (!Number.isFinite(date.getTime())) return 'sin-fecha';
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    static async writeVerified(folder, name, data) {
        const text = JSON.stringify(data, null, 2);
        const handle = await folder.getFileHandle(name, { create: true });
        const writer = await handle.createWritable();
        try { await writer.write(text); await writer.close(); }
        catch (error) { try { await writer.abort(); } catch { /* conservar el error original */ } throw error; }
        if (await (await handle.getFile()).text() !== text) throw new Error(`No coincidió la verificación de ${name}`);
        return { name, sha256: await this.digest(text) };
    }

    static async write(handle, snapshot) {
        if (handle?.kind !== 'directory') throw new Error('Elija una carpeta de respaldos; un archivo individual no permite organizar meses.');
        if (await AutoBackup._permission(handle) !== 'granted') throw new Error('Reactive el permiso de la carpeta.');
        if (!Array.isArray(snapshot.historicalSales) || !Array.isArray(snapshot.sales)) throw new Error('El historial no tiene un formato válido. No se modificó ningún registro.');
        snapshot = await this.completeSnapshot(snapshot);
        const root = await handle.getDirectoryHandle('Historial_mensual', { create: true });
        const generation = `${Backup.formatDateStamp()}_${crypto.randomUUID()}`;
        const folder = await root.getDirectoryHandle(generation, { create: true });
        const groups = new Map();
        for (const source of ['sales', 'historicalSales']) {
            snapshot[source].forEach(record => {
                const month = this.monthOf(record);
                if (!groups.has(month)) groups.set(month, { type: 'jdl-month', version: 1, month, sales: [], historicalSales: [], returns: snapshot.returns, inventory: snapshot.inventory });
                groups.get(month)[source].push(record);
            });
        }
        const complete = await this.writeVerified(folder, 'Respaldo_completo.json', snapshot);
        const months = [];
        for (const [month, data] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
            months.push({ month, sales: data.sales.length, historicalSales: data.historicalSales.length,
                ...await this.writeVerified(folder, `${month}.json`, data) });
        }
        const manifest = { type: 'jdl-month-index', version: 1, generation, businessId: snapshot.businessId,
            deviceId: snapshot.deviceId, savedAt: new Date().toISOString(), complete, months,
            salesCount: snapshot.sales.length, historicalCount: snapshot.historicalSales.length,
            browserRecordsRemoved: false };
        const index = await this.writeVerified(folder, 'Indice.json', manifest);
        // Un puntero portable permite leer la carpeta después de perder el permiso local.
        await this.writeVerified(root, 'Ultima_copia.json', { generation, index });
        // El puntero sólo se cambia al terminar; una copia anterior nunca se sobrescribe.
        await AutoBackup._dbOp('readwrite', store => store.put({ generation, index }, this.pointerKey));
        this.feedback(`Historial mensual verificado en “${handle.name}/Historial_mensual/${generation}”. ${months.length} archivo(s) de períodos. Todos los registros siguen en el navegador.`);
        return manifest;
    }

    static create() {
        const job = AutoBackup._queue.catch(() => false).then(async () => {
            try {
                let snapshot;
                await AppStorage.transaction(() => { snapshot = Backup.buildBackupData(); });
                const manifest = await this.write(await AutoBackup._loadHandle(), snapshot);
                return { success: true, manifest };
            } catch (error) {
                this.feedback('No se confirmó el archivo mensual: ' + error.message + ' Los registros del navegador no se modificaron.');
                return { success: false, error: error.message };
            }
        });
        AutoBackup._queue = job.then(result => result.success);
        return job;
    }

    static async read() {
        const handle = await AutoBackup._loadHandle();
        if (handle?.kind !== 'directory' || await AutoBackup._permission(handle) !== 'granted') throw new Error('Elija la carpeta o reactive su permiso.');
        const pointer = await this.loadPointer(handle);
        if (!pointer || !/^[\w-]+$/.test(pointer.generation)) throw new Error('Primero cree una copia mensual verificada en esta carpeta.');
        const root = await handle.getDirectoryHandle('Historial_mensual');
        const folder = await root.getDirectoryHandle(pointer.generation);
        const readChecked = async entry => {
            if (!entry || !/^[\w.-]+\.json$/.test(entry.name)) throw new Error('Nombre de archivo inválido.');
            const text = await (await folder.getFileHandle(entry.name)).getFile().then(file => file.text());
            if (await this.digest(text) !== entry.sha256) throw new Error(`El archivo ${entry.name} está incompleto o cambió. No se mostrará un reporte parcial.`);
            return JSON.parse(text);
        };
        const index = await readChecked(pointer.index);
        if (index.type !== 'jdl-month-index' || index.version !== 1 || index.generation !== pointer.generation || index.businessId !== Business.getCurrentBusinessId() || index.deviceId !== Device.getId()) throw new Error('El índice no corresponde a este negocio y dispositivo.');
        const complete = await readChecked(index.complete);
        if (complete.businessId !== index.businessId || complete.deviceId !== index.deviceId || complete.sales?.length !== index.salesCount || complete.historicalSales?.length !== index.historicalCount) throw new Error('El respaldo completo no coincide con el índice.');
        const reconstructed = { sales: [], historicalSales: [] };
        const periods = [];
        for (const entry of index.months) {
            const data = await readChecked(entry);
            if (data.type !== 'jdl-month' || data.version !== 1 || data.month !== entry.month) throw new Error('El período no coincide con el índice.');
            for (const source of ['sales', 'historicalSales']) {
                if (!Array.isArray(data[source]) || data[source].length !== entry[source] || data[source].some(record => this.monthOf(record) !== entry.month)) throw new Error('Los registros del mes no coinciden.');
                reconstructed[source].push(...data[source]);
            }
            periods.push(data);
        }
        // Comparación como multiconjunto: conserva duplicados y detecta omisiones.
        for (const source of ['sales', 'historicalSales']) {
            const canonical = values => JSON.stringify(values.map(record => JSON.stringify(record)).sort());
            if (!Array.isArray(complete[source]) || canonical(complete[source]) !== canonical(reconstructed[source])) throw new Error('El conjunto mensual no coincide con el respaldo completo.');
        }
        return { index, complete, periods };
    }

    static async loadPointer(handle) {
        const root = await handle.getDirectoryHandle('Historial_mensual');
        try {
            const file = await root.getFileHandle('Ultima_copia.json');
            return JSON.parse(await (await file.getFile()).text());
        } catch (error) {
            if (error.name !== 'NotFoundError' && !/Archivo no encontrado/.test(error.message)) throw error;
            return AutoBackup._dbOp('readonly', store => store.get(this.pointerKey));
        }
    }

    // Lee índice y sólo los archivos solicitados. No importa datos al navegador.
    static async readPeriod(year, month = null) {
        if (!Number.isInteger(year) || year < 1900 || year > 9999 || (month !== null && (!Number.isInteger(month) || month < 1 || month > 12))) throw new Error('Seleccione un período válido.');
        const handle = await AutoBackup._loadHandle();
        if (handle?.kind !== 'directory' || await AutoBackup._permission(handle) !== 'granted') throw new Error('Elija la carpeta de respaldos o reactive su permiso.');
        const pointer = await this.loadPointer(handle);
        if (!pointer || !/^[\w-]+$/.test(pointer.generation)) throw new Error('Primero guarde un respaldo mensual.');
        const root = await handle.getDirectoryHandle('Historial_mensual');
        const folder = await root.getDirectoryHandle(pointer.generation);
        const checked = async entry => {
            if (!entry || !/^[\w.-]+\.json$/.test(entry.name)) throw new Error('El índice contiene un archivo inválido.');
            const text = await (await (await folder.getFileHandle(entry.name)).getFile()).text();
            if (await this.digest(text) !== entry.sha256) throw new Error(`No se pudo verificar ${entry.name}. El reporte no está disponible.`);
            return JSON.parse(text);
        };
        const index = await checked(pointer.index);
        if (index.type !== 'jdl-month-index' || index.version !== 1 || index.generation !== pointer.generation || index.businessId !== Business.getCurrentBusinessId() || index.deviceId !== Device.getId() || !Array.isArray(index.months)) throw new Error('La carpeta no corresponde a este negocio y dispositivo.');
        const prefix = `${year}-${month === null ? '' : String(month).padStart(2, '0')}`;
        const entries = index.months.filter(entry => month === null ? entry.month.startsWith(prefix) : entry.month === prefix);
        if (this.state().months.some(m => (month === null ? m.startsWith(prefix) : m === prefix) && !entries.some(e => e.month === m))) throw new Error('Falta un mes archivado. No se mostrará un reporte incompleto.');
        const periods = [];
        for (const entry of entries) {
            const data = await checked(entry);
            if (data.type !== 'jdl-month' || data.month !== entry.month || !DataValidator.validateSales(data.historicalSales) || !DataValidator.validateSales(data.sales) || data.sales.length !== entry.sales || data.historicalSales.length !== entry.historicalSales || [...data.sales, ...data.historicalSales].some(s => this.monthOf(s) !== entry.month)) throw new Error('Un archivo mensual requiere revisión.');
            if (!Array.isArray(data.returns)) {
                const legacy = await this.read();
                return { index, sales: legacy.periods.filter(p => entries.some(e => e.month === p.month)).flatMap(p => p.historicalSales), returns: legacy.complete.returns };
            }
            if (!DataValidator.validateSimpleRecords(data.returns)) throw new Error('Las devoluciones requieren revisión.');
            periods.push(data);
        }
        return { index, sales: periods.flatMap(p => p.historicalSales), returns: this.mergeRecords([], periods.flatMap(p => p.returns).filter((r, i, all) => all.findIndex(other => other.id === r.id && other.date === r.date) === i)) };
    }

    static async archiveClosedMonths() {
        if (!Auth.canAccessConfig()) throw new Error('Se requieren permisos de administrador.');
        if (Cut.isShiftOpen()) throw new Error('Cierre la caja antes de archivar meses terminados.');
        if (!confirm('Se verificará una copia completa y se retirarán del navegador sólo las ventas de meses terminados. El mes activo se conserva. ¿Continuar?')) return false;
        const job = AutoBackup._queue.catch(() => false).then(async () => {
            let snapshot;
            await AppStorage.transaction(() => { snapshot = Backup.buildBackupData(); });
            const handle = await AutoBackup._loadHandle();
            await this.write(handle, snapshot);
            const verified = await this.read();
            const current = this.monthOf({ date: new Date().toISOString() });
            const months = verified.periods.map(p => p.month).filter(m => /^\d{4}-\d{2}$/.test(m) && m < current);
            const eligible = sale => months.includes(this.monthOf(sale));
            // Comparación exacta dentro de la transacción: otra pestaña no puede
            // cambiar ventas o abrir caja entre la comprobación y el retiro.
            await AppStorage.transaction(() => {
                if (Cut.isShiftOpen()) throw new Error('Se abrió una caja. No se retiraron registros.');
                for (const [source, key] of [['sales', SaleService.storageKey], ['historicalSales', SaleService.historicalKey]]) {
                    const records = SafeJSON.parse(AppStorage.getItem(key), [], key);
                    if (!DataValidator.validateSales(records)) throw new Error('Hay ventas que requieren revisión.');
                    const copy = new Set(verified.complete[source].map(s => JSON.stringify(s)));
                    if (records.filter(eligible).some(s => !copy.has(JSON.stringify(s)))) throw new Error('Las ventas cambiaron durante la verificación. Reintente.');
                    SafeStorage.setItem(key, SafeJSON.stringify(records.filter(s => !eligible(s))));
                }
                SafeStorage.setItem(this.stateKey, SafeJSON.stringify({ months: [...new Set([...this.state().months, ...months])], savedAt: verified.index.savedAt }));
            });
            this.feedback(`Meses archivados: ${months.join(', ') || 'ninguno pendiente'}. Se conservan el mes activo y los originales de recuperación. Los reportes anteriores requieren esta carpeta.`);
            return true;
        });
        AutoBackup._queue = job.catch(() => false);
        return job;
    }

    static summarize(records, returns) {
        if (!Array.isArray(returns)) throw new Error('Las devoluciones del respaldo no tienen un formato válido.');
        const sales = records.filter(sale => {
            if (!sale || typeof sale !== 'object' || !Array.isArray(sale.items)) throw new Error('Hay una venta que requiere revisión; no se mostrarán totales parciales.');
            return sale.status !== 'canceled';
        });
        const number = value => {
            if (value == null) return 0;
            if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Hay un importe o cantidad que requiere revisión.');
            return value;
        };
        const products = new Map();
        let gross = 0, pieces = 0, refunded = 0;
        for (const sale of sales) for (const item of sale.items) {
            if (!item || typeof item !== 'object') throw new Error('Hay una partida inválida.');
            const quantity = number(item.quantity) - number(item.buenFinFreeQty);
            gross += number(item.amount); pieces += quantity;
            const key = item.barcode || item.description || 'Sin descripción';
            const product = products.get(key) || { description: item.description || String(key), pieces: 0 };
            product.pieces += quantity; products.set(key, product);
        }
        const ids = new Set(sales.map(sale => sale.id));
        for (const record of returns) {
            if (!record || typeof record !== 'object') throw new Error('Hay una devolución inválida.');
            if (record.saleId == null || !ids.has(record.saleId)) continue;
            refunded += number(record.refundAmount);
            if (record.items != null && !Array.isArray(record.items)) throw new Error('Hay una devolución con partidas inválidas.');
            for (const item of record.items || []) pieces -= number(item.quantity);
        }
        return { transactions: sales.length, gross, refunded, net: gross - refunded, pieces,
            top: [...products.values()].sort((a, b) => b.pieces - a.pieces).slice(0, 5) };
    }

    static async showSummary() {
        const output = document.getElementById('monthly-archive-summary');
        if (output) output.textContent = '';
        try {
            const { index, complete, periods } = await this.read();
            // Consulta aislada: nunca suma las copias a los registros operativos.
            if (output) {
                const title = document.createElement('p');
                title.textContent = `Copia del ${new Date(index.savedAt).toLocaleString('es-MX')}. Historial: ${index.historicalCount} registros, incluidas cancelaciones. Esta consulta muestra esa copia, no movimientos posteriores. Los reportes habituales siguen disponibles.`;
                output.appendChild(title);
                const years = [...new Set(periods.filter(period => /^\d{4}-\d{2}$/.test(period.month)).map(period => period.month.slice(0, 4)))].sort();
                const label = document.createElement('label'); label.textContent = 'Año de la copia: ';
                const select = document.createElement('select'); select.id = 'monthly-archive-year';
                for (const year of years) { const option = document.createElement('option'); option.value = year; option.textContent = year; select.appendChild(option); }
                if (years.length) select.value = years[years.length - 1];
                label.appendChild(select); output.appendChild(label);
                const detail = document.createElement('div'); output.appendChild(detail);
                const render = () => {
                    detail.textContent = '';
                    const selected = periods.filter(period => period.month.startsWith(select.value + '-'));
                    const totals = this.summarize(selected.flatMap(period => period.historicalSales), complete.returns);
                    const money = value => value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
                    const line = text => { const p = document.createElement('p'); p.textContent = text; detail.appendChild(p); };
                    line(`${select.value || 'Sin períodos fechados'}: ${totals.transactions} ventas vigentes; ventas netas ${money(totals.net)}; devoluciones ${money(totals.refunded)}; piezas netas ${totals.pieces}.`);
                    for (let month = 1; month <= 12 && select.value; month++) {
                        const key = `${select.value}-${String(month).padStart(2, '0')}`;
                        const period = selected.find(item => item.month === key);
                        const sum = this.summarize(period?.historicalSales || [], complete.returns);
                        line(`${key}: ${sum.transactions} ventas; neto ${money(sum.net)}; piezas netas ${sum.pieces}.`);
                    }
                    line('Productos más vendidos por piezas antes de devoluciones: ' + (totals.top.map(product => `${product.description}: ${product.pieces}`).join('; ') || 'Sin ventas.'));
                    const undated = periods.find(period => period.month === 'sin-fecha');
                    if (undated) line(`Hay ${undated.historicalSales.length} registros sin fecha válida conservados en sin-fecha.json. No se incluyen en un año; requieren revisión.`);
                };
                select.addEventListener('change', () => {
                    try { render(); }
                    catch (error) { detail.textContent = 'No se pudieron calcular los totales: ' + error.message; }
                });
                try { render(); } catch (error) { detail.textContent = 'Archivos verificados, pero no se pudieron calcular los totales: ' + error.message; }
            }
            this.feedback('Todos los archivos mensuales y el respaldo completo fueron leídos y verificados. No se importó ni borró información.');
            return true;
        } catch (error) { this.feedback('No se pudo verificar la copia mensual: ' + error.message); return false; }
    }
}
window.MonthlyArchive = MonthlyArchive;
