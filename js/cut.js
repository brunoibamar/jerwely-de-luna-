// ============================================================
//  Cut: Gestión de turnos y cortes de caja
//  Configura cortes de caja por sesión/turno.
//  Cada sesión registra: usuario, monto inicial, apertura/cierre.
//  El cálculo de ventas se basa en la ventana de tiempo exacta
//  de la sesión (apertura → cierre), no en el calendario del día.
// ============================================================

class Cut {
    static get storageKey() { return Business.key('pos_shift_session'); }
    static get shiftHistoryKey() { return Business.key('pos_shift_history'); }

    // ============================================================
    //  FILTRADO DE VENTAS - POR DÍA Y POR SESIÓN
    // ============================================================

    // Ventas del día calendario (usado por reportes globales)
    static getDailySales(date = new Date().toISOString().split('T')[0]) {
        const allSales = SaleService.getAll();
        return allSales.filter(s => s.date.startsWith(date));
    }

    // Ventas dentro de la ventana de tiempo de una sesión:
    // desde openedAt hasta closedAt (o ahora, si aún está abierta)
    static getSessionSales(openedAt, closedAt = null) {
        const allSales = SaleService.getAll();
        const from = new Date(openedAt).getTime();
        const to = closedAt ? new Date(closedAt).getTime() : Date.now();

        return allSales.filter(s => {
            const saleTime = new Date(s.date).getTime();
            return saleTime >= from && saleTime <= to;
        });
    }

    // ============================================================
    //  CÁLCULO DE RESUMEN DE CAJA
    // ============================================================

    // Calcular resumen desde una lista de ventas.
    // Para pagos mixtos, se separa el monto en efectivo y tarjeta.
    static calculateSummary(sales, initialAmount = 0) {
        let cashTotal = 0;
        let cardTotal = 0;
        let piecesSold = 0;

        sales.forEach(s => {
            if (s.paymentMethod === 'cash') {
                cashTotal += s.total;
            } else if (s.paymentMethod === 'card') {
                cardTotal += s.total;
            } else if (s.paymentMethod === 'mixed') {
                const pd = s.paymentDetails || {};
                cashTotal += pd.cashAmount || 0;
                cardTotal += pd.cardAmount || 0;
            }
            piecesSold += s.items ? s.items.reduce((sum, item) => sum + (item.quantity || 0), 0) : 0;
        });

        const cashCount = sales.filter(s => s.paymentMethod === 'cash' || s.paymentMethod === 'mixed').length;
        const cardCount = sales.filter(s => s.paymentMethod === 'card' || s.paymentMethod === 'mixed').length;

        return {
            date: new Date().toISOString().split('T')[0],
            totalSales: sales.length,
            cashSales: cashCount,
            cardSales: cardCount,
            cashTotal,
            cardTotal,
            grandTotal: sales.reduce((sum, s) => sum + s.total, 0),
            cashInDrawer: cashTotal,
            transactionCount: sales.length,
            initialAmount,
            piecesSold
        };
    }

    // Resumen de caja para el día calendario (usado por reportes globales)
    static getCashDrawerSummary(date = null) {
        const today = date || new Date().toISOString().split('T')[0];
        const sales = this.getDailySales(today);
        return this.calculateSummary(sales);
    }

    // Resumen de caja para una sesión específica (ventana de tiempo exacta)
    static getSessionSummary(session) {
        const sales = this.getSessionSales(session.openedAt, session.closedAt);
        return this.calculateSummary(sales, session.initialAmount);
    }

    static generateCutReport(date = null) {
        return this.getCashDrawerSummary(date);
    }

    // --- Resumen restringido según rol ---
    // Administrador: resumen financiero completo.
    // Invitado / Cajero: solo información no sensible (conteo de transacciones).
    static getSummaryByRole(role = null, session = null) {
        const summary = session ? this.getSessionSummary(session) : this.getCashDrawerSummary();
        const userRole = role || Auth.getRole();

        if (userRole === 'admin') {
            return { ...summary, isFull: true };
        }

        // Guest / Cashier: ocultar todos los montos y detalles sensibles
        return {
            date: summary.date,
            totalSales: summary.totalSales,
            transactionCount: summary.transactionCount,
            piecesSold: summary.piecesSold,
            isFull: false
        };
    }

    // ============================================================
    //  GESTIÓN DE SESIÓN / TURNO
    // ============================================================

    // Abrir una nueva sesión de caja con monto inicial y usuario
    static openSession(initialAmount = 0, user = null) {
        const session = {
            id: `SESSION-${Date.now()}`,
            openedAt: new Date().toISOString(),
            closedAt: null,
            isOpen: true,
            initialAmount: parseFloat(initialAmount) || 0,
            openedBy: (user && user.name) || Auth.getCurrentUser()?.name || 'Desconocido',
            openedByUserId: (user && user.id) || Auth.getCurrentUser()?.id || 999,
            role: (user && user.role) || Auth.getRole(),
            summary: null
        };
        localStorage.setItem(this.storageKey, JSON.stringify(session));
        return session;
    }

    // Cerrar la sesión actual y guardar en historial.
    // El resumen se calcula exclusivamente sobre las ventas ocurridas
    // entre la hora exacta de apertura y el momento de cierre.
    static closeSession() {
        const session = this.getActiveSession();
        if (!session) return null;

        const now = new Date();
        session.closedAt = now.toISOString();
        session.isOpen = false;

        // Filtrar ventas dentro de la ventana de tiempo de esta sesión
        const sessionSales = this.getSessionSales(session.openedAt, session.closedAt);

        // Calcular costos y utilidad (solo admin ve estos datos)
        // También se cuenta el total de piezas vendidas en la sesión
        let totalCost = 0;
        let totalRevenue = 0;
        let piecesSold = 0;

        sessionSales.forEach(sale => {
            sale.items.forEach(item => {
                const product = Inventory.findByBarcode(item.barcode);
                if (product && product.cost) {
                    totalCost += product.cost * item.quantity;
                }
                totalRevenue += item.amount;
                piecesSold += item.quantity || 0;
            });
        });

        const profit = totalRevenue - totalCost;
        const margin = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : '0.0';

        // Resumen completo basado en la ventana de tiempo de la sesión
        const sessionSummary = this.getSessionSummary(session);

        session.summary = sessionSummary;

        session.report = {
            type: 'session',
            sessionId: session.id,
            date: now.toISOString().split('T')[0],
           store: (typeof Settings !== 'undefined' && Settings.getSettings ? Settings.getSettings().storeName : null) || Business.getStoreName(),
            cashier: session.openedBy,
            closedBy: session.openedBy,
            openedBy: session.openedBy,
            role: session.role,
            sessionStartTime: session.openedAt,
            sessionEndTime: session.closedAt,
            formattedOpenTime: new Date(session.openedAt).toLocaleString('es-MX'),
            formattedCloseTime: now.toLocaleString('es-MX'),
            initialAmount: session.initialAmount,
            totalSales: sessionSummary.grandTotal || 0,
            cashSales: sessionSummary.cashTotal || 0,
            cardSales: sessionSummary.cardTotal || 0,
            closingAmount: (sessionSummary.cashTotal || 0) + session.initialAmount,
            transactionCount: sessionSummary.transactionCount,
            cashInDrawer: (sessionSummary.cashTotal || 0) + session.initialAmount,
            salesInSession: sessionSales.length,
            piecesSold: piecesSold,
            items: sessionSales.map(s => ({
                id: s.id,
                total: s.total,
                items: s.items.length,
                paymentMethod: s.paymentMethod,
                time: new Date(s.date).toLocaleTimeString('es-MX')
            })),
            // Ajustes de caja (devoluciones y anulaciones) del día
            totalAdjustments: (CashAdjustment && CashAdjustment.getTotal)
                ? CashAdjustment.getTotal(now.toISOString().split('T')[0]).total
                : 0,
            cashAdjustments: (CashAdjustment && CashAdjustment.getTotal)
                ? CashAdjustment.getTotal(now.toISOString().split('T')[0]).cash
                : 0,
            cardAdjustments: (CashAdjustment && CashAdjustment.getTotal)
                ? CashAdjustment.getTotal(now.toISOString().split('T')[0]).card
                : 0,
            adjustmentCount: (CashAdjustment && CashAdjustment.getByDate)
                ? CashAdjustment.getByDate(now.toISOString().split('T')[0]).length
                : 0,
            profit: profit,
            margin: margin
        };

        // Guardar en historial
        const history = this.getSessionHistory();
        history.push(session);
        localStorage.setItem(this.shiftHistoryKey, JSON.stringify(history));

        localStorage.removeItem(this.storageKey);
        return session;
    }

    // Obtener la sesión activa
    static getActiveSession() {
        const stored = localStorage.getItem(this.storageKey);
        return stored ? JSON.parse(stored) : null;
    }

    // Verificar si hay una sesión abierta
    static isShiftOpen() {
        return localStorage.getItem(this.storageKey) !== null;
    }

    // Obtener el historial de sesiones
    static getSessionHistory() {
        const stored = localStorage.getItem(this.shiftHistoryKey);
        return stored ? JSON.parse(stored) : [];
    }

    // Alias para compatibilidad con código anterior
    static openShift(initialAmount = 0, user = null) {
        return this.openSession(initialAmount, user);
    }

    static closeShift() {
        return this.closeSession();
    }
}
