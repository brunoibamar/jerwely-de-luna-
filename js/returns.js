// ============================================================
//  Módulo de Anulaciones y Devoluciones
//  Jewerly De Luna - Sistema POS
//  - Gestión de devoluciones parciales y totales
//  - Anulación/cancelación de ventas (solo administrador)
//  - Registro de ajustes en caja (caja chica)
// ============================================================

// ============================================================
//  Returns: Gestión de devoluciones de piezas
//  Permite registrar devoluciones parciales o totales de
//  productos de una venta existente. Cada devolución
//  reintegra el stock y registra el ajuste en caja.
// ============================================================

class Returns {
    static get storageKey() { return Business.key('pos_returns'); }

    static getAll() {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) return [];
        const parsed = SafeJSON.parse(stored, [], 'devoluciones');
        if (!DataValidator.validateSimpleRecords(parsed) && !Array.isArray(parsed)) {
            console.warn('[Returns] Formato inválido en devoluciones; se preserva el estado.');
            return [];
        }
        return Array.isArray(parsed) ? parsed : [];
    }

    static save(returns) {
        SafeStorage.setItem(this.storageKey, SafeJSON.stringify(returns));
    }

    // --- Generar folio de devolución único ---
    static generateReturnId() {
        return Folio.next('RET', this.getAll());
    }

    // Guardar una devolución
    static add(returnRecord) {
        const returns = this.getAll();
        returnRecord.id = this.generateReturnId();
        returnRecord.date = new Date().toISOString();
        returnRecord.cashier = returnRecord.cashier || (Auth.getCurrentUser()?.name || 'Desconocido');
        returns.push(returnRecord);
        this.save(returns);
        return returnRecord;
    }

    // Obtener devoluciones por venta original
    static getBySale(saleId) {
        return this.getAll().filter(r => r.saleId === saleId);
    }

    // Obtener devoluciones por fecha (día calendario)
    static getByDate(date = DateUtil.today()) {
        return this.getAll().filter(r => DateUtil.isOnDate(r.date, date));
    }

    // Total reembolsado por devoluciones para un conjunto de ventas.
    // Sólo contabiliza devoluciones (no anulaciones ni retiros de caja), por
    // lo que puede descontarse directamente de la Ganancia Neta: las devoluciones
    // reducen las Ventas Totales y la Ganancia Neta, mientras que los retiros de
    // caja sólo impactan el Efectivo en Caja final.
    static getTotalBySales(sales = []) {
        const list = sales || [];
        const saleIds = new Set(list.map(s => s.id));
        if (!saleIds.size) return 0;
        return this.getAll()
            .filter(r => r.saleId != null && saleIds.has(r.saleId))
            .reduce((sum, r) => sum + (r.refundAmount || 0), 0);
    }

    // Total de piezas devueltas para un conjunto de ventas.
    // Suma la cantidad de cada ítem devuelto en todas las devoluciones
    // asociadas a las ventas indicadas.
    static getReturnedItemsBySales(sales = []) {
        const list = sales || [];
        const saleIds = new Set(list.map(s => s.id));
        if (!saleIds.size) return 0;
        return this.getAll()
            .filter(r => r.saleId != null && saleIds.has(r.saleId))
            .reduce((sum, r) => {
                const items = Array.isArray(r.items) ? r.items : [];
                return sum + items.reduce((acc, i) => acc + (i.quantity || 0), 0);
            }, 0);
    }

    // Devoluciones por rango de fechas (fecha local 'YYYY-MM-DD' o ISO)
    // Permite agrupar devoluciones por día calendario dentro de un período.
    static getByDateRange(isoFrom, isoTo) {
        const from = new Date(isoFrom).getTime();
        const to = new Date(isoTo).getTime();
        return this.getAll().filter(r => {
            const t = new Date(r.date).getTime();
            return t >= from && t <= to;
        });
    }

    // Total reembolsado y piezas devueltas para un rango de fechas.
    // Se usa para reportes por semana/mes/año.
    static getReturnsByDateRange(isoFrom, isoTo) {
        const returns = this.getByDateRange(isoFrom, isoTo);
        let refundTotal = 0;
        let piecesReturned = 0;
        returns.forEach(r => {
            refundTotal += r.refundAmount || 0;
            const items = Array.isArray(r.items) ? r.items : [];
            piecesReturned += items.reduce((sum, i) => sum + (i.quantity || 0), 0);
        });
        return { refundTotal, piecesReturned, records: returns };
    }

    // Obtener el total devuelto para una fecha, separado por método de pago
    static getAdjustmentByDate(date = DateUtil.today(), paymentMethod = null) {
        const returns = this.getByDate(date);
        let cashTotal = 0;
        let cardTotal = 0;
        let grandTotal = 0;

        returns.forEach(r => {
            grandTotal += r.refundAmount || 0;
            if (r.refundMethod === 'cash') {
                cashTotal += r.refundAmount || 0;
            } else if (r.refundMethod === 'card') {
                cardTotal += r.refundAmount || 0;
            }
        });

        if (paymentMethod === 'cash') return cashTotal;
        if (paymentMethod === 'card') return cardTotal;
        return { cashTotal, cardTotal, grandTotal };
    }

    static getById(returnId) {
        return this.getAll().find(r => r.id === returnId);
    }

    static remove(returnId) {
        const returns = this.getAll().filter(r => r.id !== returnId);
        this.save(returns);
    }

    static count() {
        return this.getAll().length;
    }
}

// ============================================================
//  CashAdjustment: Registro de movimientos de caja
//  Rastrea ajustes de efectivo/tarjeta que no provienen de
//  ventas directas: devoluciones, anulaciones, gastos, etc.
//  Cada ajuste se suma/resta al cálculo de cierre de caja.
// ============================================================

class CashAdjustment {
    static get storageKey() { return Business.key('pos_cash_adjustments'); }

    static getAll() {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) return [];
        const parsed = SafeJSON.parse(stored, [], 'ajustes_caja');
        if (!DataValidator.validateSimpleRecords(parsed) && !Array.isArray(parsed)) {
            console.warn('[CashAdjustment] Formato inválido en ajustes; se preserva el estado.');
            return [];
        }
        return Array.isArray(parsed) ? parsed : [];
    }

    static save(adjustments) {
        SafeStorage.setItem(this.storageKey, SafeJSON.stringify(adjustments));
    }

    static generateAdjustmentId() {
        return Folio.next('ADJ', this.getAll());
    }

    // Agregar un ajuste de caja
    // amount: positivo = entrada, negativo = salida
    // type: 'return' | 'cancel' | 'expense' | 'refund'
    static add({ type, amount, description, paymentMethod = 'cash', relatedSaleId = null, note = '' }) {
        const adj = {
            id: this.generateAdjustmentId(),
            type: type,
            amount: parseFloat(amount) || 0,
            description: description || '',
            paymentMethod: paymentMethod,
            date: new Date().toISOString(),
            relatedSaleId: relatedSaleId,
            note: note.trim(),
            cashier: Auth.getCurrentUser()?.name || 'Desconocido'
        };
        const all = this.getAll();
        all.push(adj);
        this.save(all);
        return adj;
    }

    // Obtener ajustes por fecha
    static getByDate(date = DateUtil.today()) {
        return this.getAll().filter(a => DateUtil.isOnDate(a.date, date));
    }

    // Calcular total de ajustes para una fecha y método de pago
    static getTotal(date = DateUtil.today(), paymentMethod = null) {
        const adjustments = this.getByDate(date);
        const data = { cash: 0, card: 0, total: 0 };

        adjustments.forEach(a => {
            if (a.paymentMethod === 'cash') {
                data.cash += a.amount;
            } else if (a.paymentMethod === 'card') {
                data.card += a.amount;
            }
            data.total += a.amount;
        });

        if (paymentMethod) {
            return data[paymentMethod] || 0;
        }
        return data;
    }

    static getById(id) {
        return this.getAll().find(a => a.id === id);
    }

    static clearAll() {
        localStorage.removeItem(this.storageKey);
    }
}

window.Returns = Returns;
window.CashAdjustment = CashAdjustment;
