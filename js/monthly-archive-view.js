// Consulta de una copia verificada. Sólo crea elementos de pantalla; no importa datos.
class MonthlyArchiveView {
    static money(value) { return value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }); }
    static node(tag, text, className) {
        const el = document.createElement(tag);
        if (text !== undefined) el.textContent = text;
        if (className) el.className = className;
        return el;
    }
    static table(headers, rows, caption) {
        const wrap = this.node('div', undefined, 'archive-table-scroll');
        const table = this.node('table', undefined, 'archive-table');
        table.appendChild(this.node('caption', caption));
        const head = table.createTHead().insertRow();
        for (const title of headers) { const th = this.node('th', title); th.scope = 'col'; head.appendChild(th); }
        const body = table.createTBody();
        for (const values of rows) {
            const row = body.insertRow();
            for (const value of values) {
                const cell = row.insertCell();
                if (value instanceof Node) cell.appendChild(value); else cell.textContent = String(value ?? '—');
            }
        }
        wrap.appendChild(table);
        return wrap;
    }
    static paymentLabel(method) {
        return { cash: 'Efectivo', card: 'Tarjeta', mixed: 'Mixto', transfer: 'Transferencia' }[method] || method || 'No registrado';
    }
    static saleDetail(sale, returns) {
        const detail = this.node('details', undefined, 'archive-sale-detail');
        detail.appendChild(this.node('summary', 'Ver productos y pago'));
        detail.appendChild(this.table(['Código', 'Producto', 'Cantidad', 'Precio unitario', 'Importe'], sale.items.map(item => [
            item.barcode, item.description || 'Sin descripción', item.quantity,
            typeof item.price === 'number' ? this.money(item.price) : 'No registrado', this.money(item.amount || 0)
        ]), 'Productos de la venta'));
        const payment = sale.paymentDetails || {};
        const pieces = sale.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
        detail.appendChild(this.node('p', `${pieces} piezas entregadas. Forma de pago: ${this.paymentLabel(sale.paymentMethod)}.`));
        const fields = [['cashAmount', 'Efectivo'], ['cardAmount', 'Tarjeta'], ['amountReceived', 'Recibido'], ['change', 'Cambio']];
        const amounts = fields.filter(([key]) => typeof payment[key] === 'number').map(([key, label]) => `${label}: ${this.money(payment[key])}`);
        if (amounts.length) detail.appendChild(this.node('p', amounts.join(' · ')));
        if (sale.vipCustomerName) detail.appendChild(this.node('p', `Cliente VIP: ${sale.vipCustomerName}`));
        const refunds = returns.filter(r => r.saleId === sale.id);
        if (refunds.length) detail.appendChild(this.table(['Fecha', 'Importe devuelto', 'Forma de devolución'], refunds.map(r => [
            new Date(r.date).toLocaleString('es-MX'), this.money(r.refundAmount || 0), this.paymentLabel(r.refundMethod)
        ]), 'Devoluciones asociadas a esta venta'));
        if (sale.status === 'canceled') detail.appendChild(this.node('p', 'Venta cancelada: se conserva como referencia y no suma a los totales.', 'archive-notice'));
        return detail;
    }
    static render(output, { index, complete, periods }) {
        output.replaceChildren(); output.classList.add('archive-view');
        output.appendChild(this.node('h3', 'Historial de ventas por mes'));
        output.appendChild(this.node('p', `Respaldo verificado del ${new Date(index.savedAt).toLocaleString('es-MX')}. La consulta muestra esa copia; para incluir ventas posteriores, guarde un nuevo respaldo.`, 'archive-note'));
        const dated = periods.filter(p => /^\d{4}-\d{2}$/.test(p.month));
        const years = [...new Set(dated.map(p => p.month.slice(0, 4)))].sort().reverse();
        const controls = this.node('div', undefined, 'archive-controls');
        const field = (text, input) => {
            const label = this.node('label', text, 'archive-field');
            label.htmlFor = input.id; label.appendChild(input); controls.appendChild(label);
        };
        const year = this.node('select'); year.id = 'monthly-archive-year';
        for (const value of years) { const option = this.node('option', value); option.value = value; year.appendChild(option); }
        const month = this.node('select'); month.id = 'monthly-archive-month';
        field('Año', year); field('Mes', month);
        output.appendChild(controls);
        const annual = this.node('p', undefined, 'archive-note'); output.appendChild(annual);
        const detail = this.node('div'); detail.id = 'monthly-archive-detail'; output.appendChild(detail);
        const undated = periods.find(p => p.month === 'sin-fecha');
        if (undated) output.appendChild(this.node('p', `${undated.historicalSales.length} registros sin fecha válida permanecen en el respaldo. No se asignan a ningún mes.`, 'archive-notice'));

        const renderMonth = () => {
            detail.replaceChildren();
            const key = `${year.value}-${month.value}`;
            const period = dated.find(p => p.month === key);
            const records = period?.historicalSales || [];
            const totals = MonthlyArchive.summarize(records, complete.returns);
            const monthName = new Date(Number(year.value), Number(month.value) - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
            detail.appendChild(this.node('h4', monthName.charAt(0).toUpperCase() + monthName.slice(1)));
            const cards = this.node('div', undefined, 'archive-metrics');
            for (const [label, value] of [
                ['Ventas vigentes', totals.transactions], ['Ventas antes de devoluciones', this.money(totals.gross)],
                ['Devoluciones', this.money(totals.refunded)], ['Ventas netas', this.money(totals.net)],
                ['Piezas netas', totals.pieces], ['Venta promedio neta', this.money(totals.transactions ? totals.net / totals.transactions : 0)],
                ['Ventas canceladas', records.filter(s => s.status === 'canceled').length]
            ]) {
                const card = this.node('div', undefined, 'archive-metric');
                card.append(this.node('span', label), this.node('strong', String(value))); cards.appendChild(card);
            }
            detail.appendChild(cards);
            detail.appendChild(this.node('p', 'Las cancelaciones no suman. Las devoluciones se descuentan del mes de la venta original, aunque se hayan realizado después.', 'archive-note'));
            if (!records.length) { detail.appendChild(this.node('p', 'No hay ventas registradas para este mes en esta copia.', 'archive-empty')); return; }

            const payments = [...new Set(records.filter(s => s.status !== 'canceled').map(s => s.paymentMethod))];
            detail.appendChild(this.table(['Forma de pago', 'Ventas', 'Antes de devoluciones', 'Devoluciones', 'Neto'], payments.map(method => {
                const sum = MonthlyArchive.summarize(records.filter(s => s.paymentMethod === method), complete.returns);
                return [this.paymentLabel(method), sum.transactions, this.money(sum.gross), this.money(sum.refunded), this.money(sum.net)];
            }), 'Ventas por forma de pago (las ventas mixtas se muestran como un grupo)'));

            const search = this.node('input'); search.type = 'search'; search.id = 'monthly-archive-search'; search.placeholder = 'Folio, producto o cajero';
            const searchLabel = this.node('label', 'Buscar en el historial del mes', 'archive-field'); searchLabel.htmlFor = search.id; searchLabel.appendChild(search);
            detail.appendChild(this.node('h4', 'Todas las ventas del mes')); detail.appendChild(searchLabel);
            detail.appendChild(this.node('p', 'Se muestran 25 ventas por página. Use Anterior y Siguiente para recorrer todo el mes. En pantallas pequeñas, deslice la tabla hacia los lados para ver todas las columnas.', 'archive-note'));
            const history = this.node('div'); history.id = 'monthly-archive-sales'; detail.appendChild(history);
            const pages = this.node('div', undefined, 'archive-pagination');
            const previous = this.node('button', 'Anterior', 'btn btn-outline btn-sm'); previous.type = 'button';
            const next = this.node('button', 'Siguiente', 'btn btn-outline btn-sm'); next.type = 'button';
            const count = this.node('span'); count.setAttribute('role', 'status');
            pages.append(previous, count, next); detail.appendChild(pages);
            let page = 0;
            const renderSales = () => {
                const query = search.value.trim().toLocaleLowerCase('es-MX');
                const selected = records.filter(s => `${s.id} ${s.cashier || ''} ${s.items.map(i => `${i.barcode || ''} ${i.description || ''}`).join(' ')}`.toLocaleLowerCase('es-MX').includes(query))
                    .sort((a, b) => new Date(b.date) - new Date(a.date) || String(a.id).localeCompare(String(b.id)));
                const start = page * 25;
                history.replaceChildren(this.table(['Fecha y hora', 'Folio', 'Cajero', 'Pago', 'Importe registrado', 'Estado', 'Detalle'], selected.slice(start, start + 25).map(sale => [
                    new Date(sale.date).toLocaleString('es-MX'), sale.id, sale.cashier || 'No registrado', this.paymentLabel(sale.paymentMethod),
                    this.money(sale.total), sale.status === 'canceled' ? 'Cancelada' : 'Vigente', this.saleDetail(sale, complete.returns)
                ]), 'Historial de ventas del mes seleccionado'));
                if (!selected.length) history.appendChild(this.node('p', 'No hay ventas que coincidan con la búsqueda.', 'archive-empty'));
                count.textContent = selected.length ? `${start + 1}–${Math.min(start + 25, selected.length)} de ${selected.length} registros` : '0 registros';
                previous.disabled = page === 0; next.disabled = start + 25 >= selected.length;
            };
            search.addEventListener('input', () => { page = 0; renderSales(); });
            previous.addEventListener('click', () => { page--; renderSales(); }); next.addEventListener('click', () => { page++; renderSales(); });
            renderSales();

            const products = new Map(), days = new Map();
            for (const sale of records) {
                const day = DateUtil.toLocalDate(sale.date);
                if (!days.has(day)) days.set(day, []); days.get(day).push(sale);
                if (sale.status === 'canceled') continue;
                for (const item of sale.items) {
                    const id = item.barcode || item.description;
                    const product = products.get(id) || { name: item.description || String(id), pieces: 0, amount: 0 };
                    product.pieces += (item.quantity || 0) - (item.buenFinFreeQty || 0); product.amount += item.amount || 0; products.set(id, product);
                }
            }
            const daily = this.node('details', undefined, 'archive-breakdown'); daily.appendChild(this.node('summary', 'Ver desglose por día'));
            daily.appendChild(this.table(['Fecha', 'Ventas vigentes', 'Ventas netas', 'Piezas netas'], [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, sales]) => {
                const sum = MonthlyArchive.summarize(sales, complete.returns); return [day, sum.transactions, this.money(sum.net), sum.pieces];
            }), 'Resumen diario del mes')); detail.appendChild(daily);
            const productDetail = this.node('details', undefined, 'archive-breakdown'); productDetail.appendChild(this.node('summary', 'Ver productos vendidos'));
            productDetail.appendChild(this.node('p', 'Piezas e importes antes de devoluciones; excluye ventas canceladas.', 'archive-note'));
            productDetail.appendChild(this.table(['Producto', 'Piezas vendidas', 'Importe'], [...products.values()].sort((a, b) => b.pieces - a.pieces).map(p => [p.name, p.pieces, this.money(p.amount)]), 'Productos vendidos durante el mes')); detail.appendChild(productDetail);
        };
        const renderYear = () => {
            month.replaceChildren();
            const sum = MonthlyArchive.summarize(dated.filter(p => p.month.startsWith(year.value + '-')).flatMap(p => p.historicalSales), complete.returns);
            annual.textContent = `Resumen de ${year.value}: ${sum.transactions} ventas vigentes · ventas netas ${this.money(sum.net)}. Seleccione un mes para ver su historial completo.`;
            for (let value = 1; value <= 12; value++) {
                const code = String(value).padStart(2, '0');
                const option = this.node('option', new Date(2000, value - 1, 1).toLocaleDateString('es-MX', { month: 'long' })); option.value = code; month.appendChild(option);
            }
            const last = dated.filter(p => p.month.startsWith(year.value + '-')).map(p => p.month).sort().pop();
            month.value = last?.slice(5) || '01'; renderMonth();
        };
        const safely = fn => { try { fn(); } catch (error) { detail.replaceChildren(this.node('p', 'No se pudo mostrar el detalle: ' + error.message, 'archive-notice')); } };
        year.addEventListener('change', () => safely(renderYear)); month.addEventListener('change', () => safely(renderMonth));
        if (years.length) safely(renderYear); else detail.appendChild(this.node('p', 'Esta copia no contiene ventas con una fecha válida.', 'archive-empty'));
    }
}
window.MonthlyArchiveView = MonthlyArchiveView;
