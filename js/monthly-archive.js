// Archivos adicionales: esta versión NUNCA elimina registros del navegador.
// Cada generación es independiente; el índice se publica sólo tras verificarla.
class MonthlyArchive {
    static get pointerKey() { return `monthly-archive:${Business.key('pos_sales_historical')}`; }

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
        const root = await handle.getDirectoryHandle('Historial_mensual', { create: true });
        const generation = `${Backup.formatDateStamp()}_${crypto.randomUUID()}`;
        const folder = await root.getDirectoryHandle(generation, { create: true });
        const groups = new Map();
        for (const source of ['sales', 'historicalSales']) {
            snapshot[source].forEach(record => {
                const month = this.monthOf(record);
                if (!groups.has(month)) groups.set(month, { type: 'jdl-month', version: 1, month, sales: [], historicalSales: [] });
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
        const pointer = await AutoBackup._dbOp('readonly', store => store.get(this.pointerKey));
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
