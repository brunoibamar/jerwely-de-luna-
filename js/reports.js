// ============================================================
//  ReportService: Módulo de Reportes por Día
//  Consolidado diario, agrupación de cortes de caja por
//  sesión, y detección automática de cambio de día.
//
//  3.1 Relación entre Cortes de Caja y Reportes por Día:
//  - Múltiples cortes: si hay 2+ cortes en la misma fecha
//    calendario, cada corte mantiene su desglose independiente.
//  - Consolidado diario: suma acumulada de todas las ventas y
//    cortes dentro de las 00:00:00 y 23:59:59 del dispositivo.
//    Permite desplegar el detalle individual de cada sesión.
//  - Cambio de día automático: al llegar a las 00:00:00 hora
//    local, el sistema abre la nueva fecha en el historial sin
//    traslapar operaciones del día previo.
// ============================================================

class ReportService {
    static get dayChangeKey() { return Business.key('pos_last_known_date'); }

    // ============================================================
    //  FILTRADO POR DÍA CALENDARIO
    //  Ventas dentro de 00:00:00 y 23:59:59 de la fecha indicada.
    // ============================================================

    static getDailyDate(date = null) {
        if (date) return date;
        return new Date().toISOString().split('T')[0];
    }

    static getDailySales(date = null) {
        const target = this.getDailyDate(date);
        const allSales = SaleService.getAll();
        return allSales.filter(s => s.date.startsWith(target));
    }

    // ============================================================
    //  OBTENER TODOS LOS CORTE DE CAJA (SESIONES) DE UNA FECHA
    //  Incluye cortes cerrados y la sesión abierta (si existe)
    //  cuya fecha de apertura coincide.
    // ============================================================

    static getDailySessions(date = null) {
        const target = this.getDailyDate(date);
        const allSessions = Cut.getSessionHistory();

        const closedSessions = allSessions.filter(s => {
            const sessionDate = new Date(s.openedAt).toISOString().split('T')[0];
            return sessionDate === target;
        });

        const active = Cut.getActiveSession();
        if (active) {
            const activeDate = new Date(active.openedAt).toISOString().split('T')[0];
            if (activeDate === target) {
                closedSessions.push(active);
            }
        }

        return closedSessions.sort((a, b) => {
            return new Date(a.openedAt) - new Date(b.openedAt);
        });
    }

    // ============================================================
    //  OBTENER EL CORTE INDEPENDIENTE DE UNA SESIÓN
    //  Cada corte (sesión) mantiene su desglose por turno.
    //  Si la sesión está abierta, calcula sobre la ventana actual.
    // ============================================================

    static getSessionCutReport(session) {
        const isClosed = session.closedAt !== null;

        if (isClosed && session.report) {
            return session.report;
        }

        if (!isClosed) {
            const sales = Cut.getSessionSales(session.openedAt, null);
            const summary = Cut.calculateSummary(sales, session.initialAmount);

            let totalCost = 0;
            let totalRevenue = 0;
            sales.forEach(sale => {
                sale.items.forEach(item => {
                    const product = Inventory.findByBarcode(item.barcode);
                    if (product && product.cost) {
                        totalCost += product.cost * item.quantity;
                    }
                    totalRevenue += item.amount;
                });
            });

            const profit = totalRevenue - totalCost;
            const margin = totalCost > 0
                ? ((profit / totalCost) * 100).toFixed(1)
                : '0.0';

            return {
                type: 'session',
                sessionId: session.id,
                date: new Date().toISOString().split('T')[0],
                cashier: session.openedBy,
                role: session.role,
                openedBy: session.openedBy,
                sessionStartTime: session.openedAt,
                formattedOpenTime: new Date(session.openedAt).toLocaleString('es-MX'),
                formattedCloseTime: 'En vivo',
                initialAmount: session.initialAmount,
                totalSales: summary.grandTotal || 0,
                cashSales: summary.cashTotal || 0,
                cardSales: summary.cardTotal || 0,
                closingAmount: (summary.cashTotal || 0) + session.initialAmount,
                transactionCount: summary.transactionCount,
                salesInSession: sales.length,
                cashInDrawer: (summary.cashTotal || 0) + session.initialAmount,
                profit: profit,
                margin: margin,
                isOpen: true
            };
        }

        const sales = Cut.getSessionSales(session.openedAt, session.closedAt);
        const summary = Cut.calculateSummary(sales, session.initialAmount);
        return {
            type: 'session',
            sessionId: session.id,
            date: new Date(session.openedAt).toISOString().split('T')[0],
            cashier: session.openedBy,
            role: session.role,
            sessionStartTime: session.openedAt,
            formattedOpenTime: new Date(session.openedAt).toLocaleString('es-MX'),
            formattedCloseTime: new Date(session.closedAt).toLocaleString('es-MX'),
            initialAmount: session.initialAmount,
            totalSales: summary.grandTotal || 0,
            cashSales: summary.cashTotal || 0,
            cardSales: summary.cardTotal || 0,
            closingAmount: (summary.cashTotal || 0) + session.initialAmount,
            transactionCount: summary.transactionCount,
            salesInSession: sales.length,
            cashInDrawer: (summary.cashTotal || 0) + session.initialAmount,
            profit: 0,
            margin: '0.0',
            isOpen: false
        };
    }

    // ============================================================
    //  CONSOLIDADO DIARIO
    //  Suma acumulada de todas las ventas y cortes del día.
    //  Agrega las ventas que no pertenecen a ninguna sesión cerrada.
    // ============================================================

    static getConsolidatedDaily(date = null) {
        const target = this.getDailyDate(date);
        const sessions = this.getDailySessions(target);
        const reportSessions = sessions.map(s => this.getSessionCutReport(s));

        const allSales = this.getDailySales(target);
        let sessionAssignedSales = 0;
        sessions.forEach(s => {
            const cut = this.getSessionCutReport(s);
            sessionAssignedSales += cut.salesInSession;
        });

        let totalCost = 0;
        let totalRevenue = 0;
        allSales.forEach(sale => {
            sale.items.forEach(item => {
                const product = Inventory.findByBarcode(item.barcode);
                if (product && product.cost) {
                    totalCost += product.cost * item.quantity;
                }
                totalRevenue += item.amount;
            });
        });

        const profit = totalRevenue - totalCost;
        const margin = totalCost > 0
            ? ((profit / totalCost) * 100).toFixed(1)
            : '0.0';

        const cashSales = allSales.filter(s => s.paymentMethod === 'cash').length;
        const cardSales = allSales.filter(s => s.paymentMethod === 'card').length;
        const mixedSales = allSales.filter(s => s.paymentMethod === 'mixed').length;

        let cashTotal = 0;
        let cardTotal = 0;
        allSales.forEach(s => {
            if (s.paymentMethod === 'cash') {
                cashTotal += s.total;
            } else if (s.paymentMethod === 'card') {
                cardTotal += s.total;
            } else if (s.paymentMethod === 'mixed') {
                const pd = s.paymentDetails || {};
                cashTotal += pd.cashAmount || 0;
                cardTotal += pd.cardAmount || 0;
            }
        });

        return {
            date: target,
            totalSales: allSales.reduce((sum, s) => sum + s.total, 0),
            transactionCount: allSales.length,
            cashTransactionCount: cashSales,
            cardTransactionCount: cardSales,
            mixedTransactionCount: mixedSales,
            cashTotal: cashTotal,
            cardTotal: cardTotal,
            profit: profit,
            margin: margin,
            sessions: reportSessions,
            sessionCount: sessions.length
        };
    }

    // ============================================================
    //  DETALLE INDIVIDUAL DE SESIÓN
    //  Devuelve las ventas de una sesión específica para desplegar
    //  el detalle individual.
    // ============================================================

    static getSessionSalesDetail(session) {
        const sales = Cut.getSessionSales(session.openedAt, session.closedAt);
        return sales.map(s => ({
            id: s.id,
            time: new Date(s.date).toLocaleTimeString('es-MX'),
            total: s.total,
            paymentMethod: s.paymentMethod === 'cash' ? 'Efectivo'
                : s.paymentMethod === 'card' ? 'Tarjeta'
                : s.paymentMethod === 'mixed' ? 'Mixto' : s.paymentMethod,
            itemCount: s.items.length,
            items: s.items.map(i => ({
                barcode: i.barcode,
                description: i.description,
                quantity: i.quantity,
                price: i.price,
                amount: i.amount
            }))
        }));
    }

    // ============================================================
    //  CAMBIO DE DÍA AUTOMÁTICO
    //  Al llegar a las 00:00:00 hora local, el sistema abre la
    //  nueva fecha en el historial sin traslapar operaciones del
    //  día previo.
    // ============================================================

    static getLastKnownDate() {
        return localStorage.getItem(this.dayChangeKey) || this.getDailyDate();
    }

    static setLastKnownDate(date) {
        localStorage.setItem(this.dayChangeKey, date);
    }

    static checkDayChange() {
        const today = this.getDailyDate();
        const lastKnown = this.getLastKnownDate();

        if (today !== lastKnown) {
            this.setLastKnownDate(today);
            this.notifyDayChange(lastKnown, today);
            return { changed: true, from: lastKnown, to: today };
        }
        return { changed: false };
    }

    static notifyDayChange(fromDate, toDate) {
        const event = new CustomEvent('daychange', {
            detail: { from: fromDate, to: toDate }
        });
        document.dispatchEvent(event);

        const handler = window.onDayChange;
        if (typeof handler === 'function') {
            handler(fromDate, toDate);
        }

        if (typeof Toast !== 'undefined' && toDate > fromDate) {
            Toast.info(`Cambio de día: ${fromDate} → ${toDate}\nLos cortes y ventas del día previo se han consolidado.`, 5000);
        }
    }

    static startDayChangeWatcher() {
        this.checkDayChange();

        if (this._dayChangeTimer) {
            clearInterval(this._dayChangeTimer);
        }

        this._dayChangeTimer = setInterval(() => {
            this.checkDayChange();
        }, 60000);

        if (!this._dayChangeListenerBound) {
            this._dayChangeListenerBound = true;
            document.addEventListener('daychange', (e) => {
                window.app?.onDayChange(e.detail.from, e.detail.to);
            });
        }

        const now = new Date();
        const msToEnd = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            23, 59, 59, 999
        ).getTime() - now.getTime();

        if (msToEnd > 0 && msToEnd < 86400000) {
            setTimeout(() => {
                this.checkDayChange();
                this.startDayChangeWatcher();
            }, msToEnd + 1000);
        }
    }

    // ============================================================
    //  FORMATO Y EXPORTACIÓN
    // ============================================================

    static formatConsolidatedHTML(report) {
        const fmt = (v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : '$0.00');

        let sessionsHtml = '';
        report.sessions.forEach(s => {
            sessionsHtml += `
                <div class="session-cut-card ${s.isOpen ? 'open' : ''}" data-session="${s.sessionId}">
                    <div class="session-cut-header" onclick="window.app.toggleSessionDetail('${s.sessionId}')">
                        <div class="session-cut-info">
                            <span class="session-cut-id">${s.sessionId}</span>
                            <span class="session-cut-time">${s.formattedOpenTime} → ${s.formattedCloseTime}</span>
                            <span class="session-cut-cashier">Cajero: ${s.cashier}</span>
                        </div>
                        <div class="session-cut-summary">
                            <span class="session-cut-total">${fmt(s.totalSales)}</span>
                            <span class="session-cut-badge ${s.isOpen ? 'badge-open' : 'badge-closed'}">${s.isOpen ? 'Abierto' : 'Cerrado'}</span>
                        </div>
                        <span class="session-expand-icon">▼</span>
                    </div>
                    <div class="session-cut-detail hidden" id="detail-${s.sessionId}">
                    </div>
                </div>
            `;
        });

        return `
            <div class="daily-consolidated">
                <div class="consolidated-header">
                    <h3>Fecha: ${report.date}</h3>
                    <span class="session-count-badge">${report.sessionCount} ${report.sessionCount === 1 ? 'corte' : 'cortes'}</span>
                </div>
                <div class="consolidated-grid">
                    <div class="consolidated-card">
                        <span class="consolidated-label">Total Ventas</span>
                        <span class="consolidated-value">${fmt(report.totalSales)}</span>
                    </div>
                    <div class="consolidated-card">
                        <span class="consolidated-label">Transacciones</span>
                        <span class="consolidated-value">${report.transactionCount}</span>
                    </div>
                    <div class="consolidated-card">
                        <span class="consolidated-label">Efectivo</span>
                        <span class="consolidated-value">${fmt(report.cashTotal)}</span>
                    </div>
                    <div class="consolidated-card">
                        <span class="consolidated-label">Tarjeta</span>
                        <span class="consolidated-value">${fmt(report.cardTotal)}</span>
                    </div>
                    <div class="consolidated-card admin-only">
                        <span class="consolidated-label">Ganancia Neta</span>
                        <span class="consolidated-value">${fmt(report.profit)}</span>
                    </div>
                    <div class="consolidated-card admin-only">
                        <span class="consolidated-label">Margen</span>
                        <span class="consolidated-value">${report.margin}%</span>
                    </div>
                </div>
                <div class="sessions-container">
                    <h4>Cortes de Caja del Día (${report.sessionCount})</h4>
                    ${sessionsHtml || '<p class="empty-text">No hay cortes registrados para este día</p>'}
                </div>
            </div>
        `;
    }
}
