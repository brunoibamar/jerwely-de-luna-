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
        return stored ? JSON.parse(stored) : [];
    }

    static save(returns) {
        localStorage.setItem(this.storageKey, JSON.stringify(returns));
    }

    // --- Generar folio de devolución único ---
    static generateReturnId() {
        const date = new Date();
        const dateStr = date.getFullYear().toString() +
            (date.getMonth() + 1).toString().padStart(2, '0') +
            date.getDate().toString().padStart(2, '0');
        const all = this.getAll();
        const seq = all.filter(r => r.id && r.id.startsWith(`RET-${dateStr}-`))
            .length + 1;
        return `RET-${dateStr}-${seq.toString().padStart(4, '0')}`;
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
    static getByDate(date = new Date().toISOString().split('T')[0]) {
        return this.getAll().filter(r => r.date.startsWith(date));
    }

    // Obtener el total devuelto para una fecha, separado por método de pago
    static getAdjustmentByDate(date = new Date().toISOString().split('T')[0], paymentMethod = null) {
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
        return stored ? JSON.parse(stored) : [];
    }

    static save(adjustments) {
        localStorage.setItem(this.storageKey, JSON.stringify(adjustments));
    }

    static generateAdjustmentId() {
        const date = new Date();
        const dateStr = date.getFullYear().toString() +
            (date.getMonth() + 1).toString().padStart(2, '0') +
            date.getDate().toString().padStart(2, '0');
        const count = this.getAll().filter(a => a.id && a.id.startsWith(`ADJ-${dateStr}-`)).length + 1;
        return `ADJ-${dateStr}-${count.toString().padStart(4, '0')}`;
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
    static getByDate(date = new Date().toISOString().split('T')[0]) {
        return this.getAll().filter(a => a.date.startsWith(date));
    }

    // Calcular total de ajustes para una fecha y método de pago
    static getTotal(date = new Date().toISOString().split('T')[0], paymentMethod = null) {
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
