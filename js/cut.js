// ============================================================
//  Cut: Gestión de turnos y cortes de caja
//  Actualizado para manejar pagos mixtos (efectivo + tarjeta)
//  en los resúmenes de cierre.
// ============================================================

class Cut {
    static storageKey = 'pos_daily_sales';

    static getDailySales(date = new Date().toISOString().split('T')[0]) {
        const allSales = SaleService.getAll();
        return allSales.filter(s => s.date.startsWith(date));
    }

    // Calcular el resumen de caja.
    // Para pagos mixtos, se separa el monto en efectivo y tarjeta.
    static getCashDrawerSummary(date = null) {
        const today = date || new Date().toISOString().split('T')[0];
        const sales = this.getDailySales(today);

        let cashTotal = 0;
        let cardTotal = 0;

        sales.forEach(s => {
            if (s.paymentMethod === 'cash') {
                cashTotal += s.total;
            } else if (s.paymentMethod === 'card') {
                cardTotal += s.total;
            } else if (s.paymentMethod === 'mixed') {
                // Pago mixto: separar montos de efectivo y tarjeta
                const pd = s.paymentDetails || {};
                cashTotal += pd.cashAmount || 0;
                cardTotal += pd.cardAmount || 0;
            }
        });

        const cashCount = sales.filter(s => s.paymentMethod === 'cash' || s.paymentMethod === 'mixed').length;
        const cardCount = sales.filter(s => s.paymentMethod === 'card' || s.paymentMethod === 'mixed').length;

        return {
            date,
            totalSales: sales.length,
            cashSales: cashCount,
            cardSales: cardCount,
            cashTotal,
            cardTotal,
            grandTotal: sales.reduce((sum, s) => sum + s.total, 0),
            cashInDrawer: cashTotal
        };
    }

    static generateCutReport(date = null) {
        return this.getCashDrawerSummary(date);
    }

    // --- Resumen restringido según rol ---
    // Administrador: resumen financiero completo.
    // Invitado / Cajero: solo información no sensible (conteo de transacciones).
    // No se exponen montos, utilidades ni detalles financieros privados.
    static getSummaryByRole(role = null) {
        const summary = this.getCashDrawerSummary();
        const userRole = role || Auth.getRole();

        if (userRole === 'admin') {
            return { ...summary, transactionCount: summary.totalSales, isFull: true };
        }

        // Guest / Cashier: ocultar todos los montos y detalles sensibles
        return {
            date: summary.date,
            totalSales: summary.totalSales,
            transactionCount: summary.totalSales,
            isFull: false
        };
    }

    static closeShift() {
        const summary = this.getSummaryByRole();
        const shift = {
            id: `SHIFT-${new Date().toISOString()}`,
            openedAt: localStorage.getItem('pos_shift_opened') || new Date().toISOString(),
            closedAt: new Date().toISOString(),
            summary,
            closedBy: Auth.getCurrentUser()?.name || 'Desconocido'
        };
        localStorage.setItem('pos_last_shift', JSON.stringify(shift));
        localStorage.removeItem('pos_shift_opened');
        return shift;
    }

    static openShift() {
        localStorage.setItem('pos_shift_opened', new Date().toISOString());
    }

    static isShiftOpen() {
        return localStorage.getItem('pos_shift_opened') !== null;
    }
}
