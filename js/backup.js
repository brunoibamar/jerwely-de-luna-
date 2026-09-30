class Backup {
    static get backupKey() { return Business.key('pos_backup'); }
    static get pendingReportsKey() { return Business.key('pos_pending_reports'); }
    static get emailConfigKey() { return Business.key('pos_email_config'); }
    static get reportHistoryKey() { return Business.key('pos_report_history'); }

    static createBackup() {
        const data = {
            version: '1.2',
            timestamp: new Date().toISOString(),
            store: Business.getStoreName(),
            businessName: Business.getBusinessName(),
            businessId: Business.getCurrentBusinessId(),
            inventory: Inventory.getAll(),
            sales: SaleService.getAll(),
            users: Auth.adminProfile,
            settings: Settings.getSettings(),
            shiftSession: localStorage.getItem(Cut.storageKey),
            shiftHistory: localStorage.getItem(Cut.shiftHistoryKey),
            heldSales: HeldSales.getAll(),
            reportHistory: localStorage.getItem(this.reportHistoryKey),
            dayChangeKey: localStorage.getItem(ReportService.dayChangeKey)
        };

        const backupStr = JSON.stringify(data, null, 2);
        const blob = new Blob([backupStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `jewerly-de-luna-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        return { success: true, message: 'Respaldo descargado correctamente' };
    }

    static exportToLocalStorage() {
        const data = {
            timestamp: new Date().toISOString(),
            inventory: Inventory.getAll(),
            sales: SaleService.getAll(),
            settings: Settings.getSettings(),
            heldSales: HeldSales.getAll()
        };
        localStorage.setItem(this.backupKey, JSON.stringify(data));
        return { success: true, message: 'Respaldo guardado en localStorage' };
    }

    static restoreFromLocalStorage() {
        const stored = localStorage.getItem(this.backupKey);
        if (!stored) return { success: false, error: 'No hay respaldo disponible' };

        const data = JSON.parse(stored);
        Inventory.saveProducts(data.inventory || Inventory.defaultProducts);
        SaleService.save(data.sales || []);
        Settings.saveSettings(data.settings || {});
        if (data.heldSales) localStorage.setItem(HeldSales.storageKey, JSON.stringify(data.heldSales));

        return { success: true, message: 'Datos restaurados correctamente' };
    }

    static importFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.version || !data.store) {
                        resolve({ success: false, error: 'Archivo de respaldo inválido' });
                        return;
                    }
                    if (data.inventory) Inventory.saveProducts(data.inventory);
                    if (data.sales) SaleService.save(data.sales);
                    if (data.settings) Settings.saveSettings(data.settings);
                    if (data.store) Business.setBusinessName(data.store);
                    if (data.shiftSession) localStorage.setItem(Cut.storageKey, data.shiftSession);
                    if (data.shiftHistory) localStorage.setItem(Cut.shiftHistoryKey, data.shiftHistory);
                    if (data.heldSales) localStorage.setItem(HeldSales.storageKey, JSON.stringify(data.heldSales));
                    if (data.reportHistory) localStorage.setItem(this.reportHistoryKey, JSON.stringify(data.reportHistory));
                    if (data.dayChangeKey) localStorage.setItem(ReportService.dayChangeKey, data.dayChangeKey);
                    resolve({ success: true, message: 'Datos importados correctamente' });
                } catch (err) {
                    reject({ success: false, error: 'Error al leer el archivo: ' + err.message });
                }
            };
            reader.onerror = () => reject({ success: false, error: 'Error al leer el archivo' });
            reader.readAsText(file);
        });
    }

    static getBackupInfo() {
        const stored = localStorage.getItem(this.backupKey);
        if (!stored) return null;
        const data = JSON.parse(stored);
        return {
            timestamp: data.timestamp,
            inventoryCount: data.inventory?.length || 0,
            salesCount: data.sales?.length || 0
        };
    }

    // ============================================================
    //  REPORTES POR CORREO
    // ============================================================

    static isOnline() {
        return navigator.onLine;
    }

    static generateDailyReport() {
        const session = Cut.getActiveSession();
        let sales;
        let initialAmount;
        let reportType = 'daily';
        let reportDate = new Date().toISOString().split('T')[0];

        if (session) {
            reportType = 'session';
            sales = Cut.getSessionSales(session.openedAt, new Date().toISOString());
            initialAmount = session.initialAmount;
            reportDate = session.openedAt.split('T')[0];
        } else {
            sales = SaleService.getDailySales();
            initialAmount = Auth.getDrawerInitial();
        }

        const summary = Cut.getSummaryByRole(null, session || null);
        const now = new Date();

        const report = {
            type: reportType,
            date: reportDate,
            store: Business.getStoreName(),
            cashier: Auth.getCurrentUser()?.name || 'Desconocido',
            role: Auth.getRole(),
            initialAmount: summary.isFull ? initialAmount : 0,
            totalSales: summary.isFull ? summary.grandTotal : 0,
            cashSales: summary.isFull ? summary.cashTotal : 0,
            cardSales: summary.isFull ? summary.cardTotal : 0,
            transactionCount: summary.transactionCount,
            cashInDrawer: summary.isFull ? summary.cashTotal + initialAmount : 0,
            closingAmount: summary.isFull ? summary.cashTotal + initialAmount : 0,
            piecesSold: summary.piecesSold || 0,
            items: summary.isFull ? sales.map(s => ({
                id: s.id,
                total: s.total,
                items: s.items.length,
                paymentMethod: s.paymentMethod,
                time: new Date(s.date).toLocaleTimeString('es-MX')
            })) : []
        };

        if (session) {
            report.sessionId = session.id;
            report.cashier = session.openedBy;
            report.sessionStartTime = session.openedAt;
            report.sessionEndTime = now.toISOString();
            report.formattedOpenTime = new Date(session.openedAt).toLocaleString('es-MX');
            report.formattedCloseTime = now.toLocaleString('es-MX');
            report.salesInSession = sales.length;
        }

        if (Auth.isAdmin()) {
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
            report.profit = totalRevenue - totalCost;
            report.margin = totalCost > 0 ? ((report.profit / totalCost) * 100).toFixed(1) : '0.0';
        }

        return report;
    }

    static generateMonthlyReport(month = null, year = null) {
        const now = new Date();
        const m = month || now.getMonth() + 1;
        const y = year || now.getFullYear();

        const allSales = SaleService.getAll();
        const monthSales = allSales.filter(s => {
            const d = new Date(s.date);
            return d.getMonth() === m - 1 && d.getFullYear() === y;
        });

        const totalRevenue = monthSales.reduce((sum, s) => sum + s.total, 0);
        const transactionCount = monthSales.length;

        let totalCost = 0;
        monthSales.forEach(sale => {
            sale.items.forEach(item => {
                const product = Inventory.findByBarcode(item.barcode);
                if (product && product.cost) {
                    totalCost += product.cost * item.quantity;
                }
            });
        });

        const profit = totalRevenue - totalCost;
        const margin = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : '0.0';

        return {
            type: 'monthly',
            month: m,
            year: y,
            period: `${y}-${m.toString().padStart(2, '0')}`,
            store: Business.getStoreName(),
            totalRevenue,
            totalCost,
            profit,
            margin,
            transactionCount,
            itemsSold: monthSales.reduce((sum, s) => sum + s.items.reduce((c, i) => c + i.quantity, 0), 0),
            generatedAt: new Date().toISOString()
        };
    }

    static generateAnnualReport(year = new Date().getFullYear()) {
        const allSales = SaleService.getAll();
        const yearSales = allSales.filter(s => {
            return new Date(s.date).getFullYear() === year;
        });

        const monthlyData = [];
        for (let m = 1; m <= 12; m++) {
            const monthSales = yearSales.filter(s => {
                const d = new Date(s.date);
                return d.getMonth() === m - 1 && d.getFullYear() === year;
            });
            const revenue = monthSales.reduce((sum, s) => sum + s.total, 0);
            let cost = 0;
            monthSales.forEach(sale => {
                sale.items.forEach(item => {
                    const product = Inventory.findByBarcode(item.barcode);
                    if (product && product.cost) {
                        cost += product.cost * item.quantity;
                    }
                });
            });
            monthlyData.push({
                month: m,
                revenue,
                cost,
                profit: revenue - cost,
                transactions: monthSales.length
            });
        }

        const totalRevenue = monthlyData.reduce((sum, m) => sum + m.revenue, 0);
        const totalCost = monthlyData.reduce((sum, m) => sum + m.cost, 0);
        const profit = totalRevenue - totalCost;
        const margin = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : '0.0';

        return {
            type: 'annual',
            year: year,
            store: Business.getStoreName(),
            totalRevenue,
            totalCost,
            profit,
            margin,
            totalTransactions: yearSales.length,
            monthlyData,
            generatedAt: new Date().toISOString()
        };
    }

    // ============================================================
    //  EMAILJS - CONFIGURACIÓN Y ENVÍO DIRECTO DE CORREOS
    //  Los reportes de corte de caja y cierre de día se envían
    //  mediante el servicio de envío directo de EmailJS API
    //  (segundo plano), SIN abrir pestañas nuevas ni enlaces mailto:.
    // ============================================================

    static getEmailConfig() {
        const stored = localStorage.getItem(this.emailConfigKey);
        if (!stored) return null;
        try {
            return JSON.parse(stored);
        } catch {
            return null;
        }
    }

    static saveEmailConfig(config) {
        localStorage.setItem(this.emailConfigKey, JSON.stringify(config));
    }

    static isEmailJSSet() {
        const config = this.getEmailConfig();
        return !!(config && config.publicKey && config.serviceId && config.templateId);
    }

    // Inicializar el SDK de EmailJS con la public key configurada
    static initEmailJS() {
        const config = this.getEmailConfig();
        if (config && config.publicKey && typeof emailjs !== 'undefined') {
            try {
                emailjs.init({ publicKey: config.publicKey });
                return true;
            } catch (e) {
                return false;
            }
        }
        return false;
    }

    // Envío directo vía EmailJS SDK (sin abrir cliente de correo)
    static async sendViaEmailJS(report, recipient, customSubject, customBody) {
        const config = this.getEmailConfig();
        if (!config || !config.publicKey || !config.serviceId || !config.templateId) {
            return { success: false, message: 'EmailJS no configurado' };
        }

        const reportTypeLabel = report.type === 'daily' ? 'Diario'
            : report.type === 'monthly' ? 'Mensual'
            : report.type === 'annual' ? 'Anual'
            : 'Cierre de Caja por Sesión';

        const subject = customSubject || `[${Business.getStoreName()}] Reporte ${reportTypeLabel} - ${new Date().toLocaleDateString('es-MX')}`;
        const body = customBody || this.formatReportForEmail(report);
        const email = recipient || Auth.getAdminEmail();

        if (!email) {
            return { success: false, message: 'No se ha configurado el correo del administrador' };
        }

        if (typeof emailjs === 'undefined') {
            return { success: false, message: 'Error de conexión EmailJS: SDK no disponible' };
        }

        try {
            // Inicialización explícita del SDK v4 con la Public Key leída de localStorage
            emailjs.init({ publicKey: config.publicKey });

            const templateParams = {
                to_email: email,
                subject: subject,
                message: body,
                report_data: JSON.stringify(report, null, 2),
                report_type: reportTypeLabel,
                report_date: new Date().toISOString()
            };

            // Envío mediante el SDK: Service ID, Template ID, template params, Public Key
            const response = await emailjs.send(
                config.serviceId,
                config.templateId,
                templateParams,
                config.publicKey
            );

            const isOk = response && (response.status === 200 || response.status === 201 || response.text === 'OK');
            if (isOk) {
                return { success: true, message: `Reporte enviado a ${email} via EmailJS` };
            } else {
                const errorMessage = (response && (response.text || response.message)) || 'Error al enviar el correo';
                return { success: false, message: `Error EmailJS: ${errorMessage}` };
            }
        } catch (err) {
            const errorMessage = (err && (err.text || err.message)) || String(err);
            return { success: false, message: `Error de conexión EmailJS: ${errorMessage}` };
        }
    }

    // --- Envío de reporte por email al administrador ---
    // Utiliza el envío directo vía EmailJS API (segundo plano, sin abrir pestañas).
    // Si EmailJS no está configurado o falla el envío, guarda localmente para
    // reintentar después. NO utiliza mailto: ni window.open.
    static async sendReportEmail(report, recipient) {
        try {
            const email = recipient || Auth.getAdminEmail();

            if (!email) {
                return { success: false, message: 'No se ha configurado el correo del administrador' };
            }

            // Si EmailJS está configurado, enviar directamente vía API
            if (this.isEmailJSSet()) {
                const result = await this.sendViaEmailJS(report, email);
                if (result.success) {
                    // Registrar envío exitoso en el historial
                    this.saveEmailSendLog(report, email, 'emailjs', result.message);
                    return result;
                }
                // Si falla el envío directo, guardar localmente para reintentar después
                this.savePendingReport(report, email);
                return { success: true, message: `Envío directo falló (${result.message}). Reporte guardado localmente y se intentará enviar cuando esté disponible.` };
            }

            // EmailJS no configurado: guardar localmente para envío manual explícito
            this.savePendingReport(report, email);
            return { success: true, message: 'EmailJS no configurado. Reporte guardado localmente para envío manual.' };
        } catch (err) {
            // Si falla el envío directo, guardar localmente para reintentar después
            this.savePendingReport(report, recipient || Auth.getAdminEmail?.() || '');
            return { success: false, message: 'Error inesperado al enviar el correo: ' + (err?.message || err) };
        } finally {
            // Siempre registrar el intento en el historial
            this.saveReportToHistory(report);
        }
    }

    // --- Reporte simplificado para el perfil Invitado ---
    // Construye un reporte que contiene ÚNICAMENTE la información de la
    // sesión (sin montos, ganancias ni desgloses financieros sensibles).
    static buildGuestSessionReport(report) {
        const piecesSold = report.piecesSold !== undefined
            ? report.piecesSold
            : (report.salesInSession || report.transactionCount || 0);

        return {
            type: 'guest-session',
            date: report.date,
            store: report.store,
            cashier: report.cashier || report.closedBy || 'Desconocido',
            role: report.role || 'guest',
            sessionId: report.sessionId,
            sessionStartTime: report.sessionStartTime,
            sessionEndTime: report.sessionEndTime,
            formattedOpenTime: report.formattedOpenTime,
            formattedCloseTime: report.formattedCloseTime,
            transactionCount: report.transactionCount,
            salesInSession: report.salesInSession !== undefined
                ? report.salesInSession
                : report.transactionCount,
            piecesSold: piecesSold
        };
    }

    // Texto plano con la información de la sesión para invitado (sin datos financieros)
    static formatGuestSessionForEmail(report) {
        const guestReport = this.buildGuestSessionReport(report);
        let text = `CIERRE DE CAJA - Sesión de Invitado\n`;
        text += `========================================\n\n`;
        text += `Sesión: ${guestReport.sessionId || 'N/A'}\n`;
        text += `Fecha: ${guestReport.date}\n`;
        text += `Cajero: ${guestReport.cashier}\n\n`;
        text += `--- Horario de Sesión ---\n`;
        text += `Apertura: ${guestReport.formattedOpenTime || guestReport.sessionStartTime || 'N/A'}\n`;
        text += `Cierre: ${guestReport.formattedCloseTime || guestReport.sessionEndTime || 'N/A'}\n\n`;
        text += `--- Resumen de la Sesión ---\n`;
        text += `Transacciones: ${guestReport.transactionCount}\n`;
        text += `Ventas en Sesión: ${guestReport.salesInSession}\n`;
        text += `Piezas Vendidas: ${guestReport.piecesSold}\n`;
        text += `\n========================================\n`;
        text += `Registro generado por ${Business.getStoreName()} POS\n`;
        return text;
    }

    // Envío por email de la información de cierre de caja.
    // Para el rol Invitado/Cajero se envía el MISMO reporte financiero completo
    // que para el administrador, calculando y adjuntando todos los valores
    // monetarios, caja final y utilidades. La restricción visual (solo piezas
    // vendidas) aplica exclusivamente a la pantalla del POS, no al correo.
    static async sendGuestSessionEmail(report, recipient) {
        try {
            const email = recipient || Auth.getAdminEmail();

            if (!email) {
                return { success: false, message: 'No se ha configurado el correo del administrador' };
            }

            const subject = `[${Business.getStoreName()}] Cierre de Caja - ${report.cashier || 'Invitado'} - ${new Date().toLocaleDateString('es-MX')}`;
            const body = this.formatReportForEmail(report);

            if (this.isEmailJSSet()) {
                const result = await this.sendViaEmailJS(report, email, subject, body);
                if (result.success) {
                    this.saveEmailSendLog(report, email, 'emailjs', result.message);
                    return result;
                }
                this.savePendingReport(report, email);
                return { success: true, message: `Envío directo falló (${result.message}). Registro guardado localmente.` };
            }

            this.savePendingReport(report, email);
            return { success: true, message: 'EmailJS no configurado. Registro guardado localmente para envío manual.' };
        } catch (err) {
            this.savePendingReport(report, recipient || (Auth.getAdminEmail ? Auth.getAdminEmail() : ''));
            return { success: false, message: 'Error inesperado al enviar el correo: ' + (err?.message || err) };
        } finally {
            this.saveReportToHistory(report);
        }
    }

    static get emailSendLogKey() { return Business.key('pos_email_send_log'); }

    static saveEmailSendLog(report, email, method, message) {
        const log = this.getEmailSendLog();
        log.push({
            timestamp: new Date().toISOString(),
            reportType: report.type,
            reportDate: report.date || null,
            recipient: email,
            method: method,
            result: message,
            reportHash: this.hashReport(report)
        });
        localStorage.setItem(this.emailSendLogKey, JSON.stringify(log));
    }

    static getEmailSendLog() {
        const stored = localStorage.getItem(this.emailSendLogKey);
        return stored ? JSON.parse(stored) : [];
    }

    static hashReport(report) {
        const str = JSON.stringify(report);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = Math.imul(hash ^ char, 2654435761);
        }
        return (hash >>> 0).toString(36).padStart(8, '0');
    }

    static formatReportForEmail(report) {
        const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : '0.00');

        if (report.type === 'session') {
            let text = `CIERRE DE CAJA POR SESIÓN - ${Business.getStoreName()}\n`;
            text += `========================================\n\n`;
            text += `Sesión: ${report.sessionId || 'N/A'}\n`;
            text += `Fecha: ${report.date}\n`;
            text += `Cajero: ${report.cashier}\n`;
            text += `Rol: ${report.role}\n`;
            text += `\n--- Horario de Sesión ---\n`;
            text += `Apertura: ${report.formattedOpenTime || report.sessionStartTime || 'N/A'}\n`;
            text += `Cierre: ${report.formattedCloseTime || report.sessionEndTime || 'N/A'}\n`;
            text += `\n--- Resumen Financiero ---\n`;
            text += `Monto Inicial: $${fmt(report.initialAmount)}\n`;
            text += `Total Ventas: $${fmt(report.totalSales)}\n`;
            text += `Efectivo: $${fmt(report.cashSales)}\n`;
            text += `Tarjeta: $${fmt(report.cardSales)}\n`;
            text += `Transacciones: ${report.transactionCount}\n`;
            text += `Ventas en Sesión: ${report.salesInSession}\n`;
            text += `Caja Final: $${fmt(report.closingAmount)}\n`;
            text += `Efectivo en Caja: $${fmt(report.cashInDrawer)}\n`;
            text += `Piezas Vendidas: ${report.piecesSold || 0}\n`;
            if (report.profit !== undefined) {
                text += `\n--- Utilidades (Solo Admin) ---\n`;
                text += `Ganancia Neta: $${fmt(report.profit)}\n`;
                text += `Margen: ${report.margin}%\n`;
            }
            if (report.items && report.items.length > 0) {
                text += `\n--- Detalle de Transacciones ---\n`;
                report.items.forEach(item => {
                    text += `${item.id} | ${item.time} | $${fmt(item.total)} | ${item.paymentMethod}\n`;
                });
            }
            text += `\n========================================\n`;
            text += `Reporte generado automáticamente por ${Business.getStoreName()} POS\n`;
            return text;
        }

        if (report.type === 'daily') {
            let text = `REPORTE DE CIERRE DE CAJA - ${Business.getStoreName()}\n`;
            text += `========================================\n\n`;
            text += `Fecha: ${report.date}\n`;
            text += `Cajero: ${report.cashier}\n`;
            text += `Rol: ${report.role}\n`;
            text += `\n--- Resumen Financiero ---\n`;
            text += `Monto Inicial: $${fmt(report.initialAmount)}\n`;
            text += `Total Ventas: $${fmt(report.totalSales)}\n`;
            text += `Efectivo: $${fmt(report.cashSales)}\n`;
            text += `Tarjeta: $${fmt(report.cardSales)}\n`;
            text += `Transacciones: ${report.transactionCount}\n`;
            text += `Caja Final: $${fmt(report.closingAmount)}\n`;
            text += `Piezas Vendidas: ${report.piecesSold || 0}\n`;
            if (report.profit !== undefined) {
                text += `\n--- Utilidades (Solo Admin) ---\n`;
                text += `Ganancia Neta: $${fmt(report.profit)}\n`;
                text += `Margen: ${report.margin}%\n`;
            }
            if (report.items && report.items.length > 0) {
                text += `\n--- Detalle de Transacciones ---\n`;
                report.items.forEach(item => {
                    text += `${item.id} | ${item.time} | $${fmt(item.total)} | ${item.paymentMethod}\n`;
                });
            }
            text += `\n========================================\n`;
            text += `Reporte generado automáticamente por ${Business.getStoreName()} POS\n`;
            return text;
        }
        return JSON.stringify(report, null, 2);
    }

    // --- Guardar reporte pendiente (offline) ---
    static savePendingReport(report, email) {
        const pending = this.getPendingReports();
        pending.push({
            report,
            email,
            savedAt: new Date().toISOString()
        });
        localStorage.setItem(this.pendingReportsKey, JSON.stringify(pending));
    }

    static getPendingReports() {
        const stored = localStorage.getItem(this.pendingReportsKey);
        return stored ? JSON.parse(stored) : [];
    }

    static clearPendingReport(index) {
        const pending = this.getPendingReports();
        pending.splice(index, 1);
        localStorage.setItem(this.pendingReportsKey, JSON.stringify(pending));
    }

    // --- Procesar reportes pendientes al iniciar (online) ---
    static async processPendingReports() {
        let sent = 0;
        try {
            if (!this.isOnline()) return { success: false, message: 'Sin conexión' };

            const pending = this.getPendingReports();
            if (pending.length === 0) return { success: true, message: 'No hay reportes pendientes' };

            for (const item of pending) {
                const result = await this.sendReportEmail(item.report, item.email);
                if (result.success) {
                    sent++;
                    const index = pending.indexOf(item);
                    this.clearPendingReport(index);
                }
            }

            return { success: true, message: `${sent} reporte(s) enviado(s) correctamente` };
        } catch (err) {
            return { success: false, message: 'Error al procesar reportes pendientes: ' + (err?.message || err) };
        } finally {
            if (sent > 0) {
                this.saveReportToHistory({ type: 'pending-batch', sent, date: new Date().toISOString() });
            }
        }
    }

    // --- Reportes recurrentes ---

    static get monthlyReportKey() { return Business.key('pos_last_monthly_report'); }
    static get annualReportKey() { return Business.key('pos_last_annual_report'); }

    static async checkMonthlyReport() {
        let report = null;
        try {
            const now = new Date();
            const currentKey = `${now.getFullYear()}-${(now.getMonth() + 1)}`;
            const lastSent = localStorage.getItem(this.monthlyReportKey);

            if (lastSent !== currentKey && Auth.isAdmin()) {
                report = this.generateMonthlyReport();
                const result = await this.sendReportEmail(report);
                if (result.success) {
                    localStorage.setItem(this.monthlyReportKey, currentKey);
                }
                this.saveReportToHistory(report);
                return result;
            }
            return { success: false, message: 'Ya se envió el reporte mensual' };
        } catch (err) {
            if (report) this.saveReportToHistory(report);
            return { success: false, message: 'Error al enviar el reporte mensual: ' + (err?.message || err) };
        }
    }

    static async checkAnnualReport() {
        let report = null;
        try {
            const now = new Date();
            const currentYear = now.getFullYear().toString();
            const lastSent = localStorage.getItem(this.annualReportKey);

            if (lastSent !== currentYear && Auth.isAdmin()) {
                report = this.generateAnnualReport(now.getFullYear());
                const result = await this.sendReportEmail(report);
                if (result.success) {
                    localStorage.setItem(this.annualReportKey, currentYear);
                }
                this.saveReportToHistory(report);
                return result;
            }
            return { success: false, message: 'Ya se envió el reporte anual' };
        } catch (err) {
            if (report) this.saveReportToHistory(report);
            return { success: false, message: 'Error al enviar el reporte anual: ' + (err?.message || err) };
        }
    }

    // --- Historial local de reportes ---
    static saveReportToHistory(report) {
        const history = this.getReportHistory();
        history.push({
            report,
            savedAt: new Date().toISOString()
        });
        localStorage.setItem(this.reportHistoryKey, JSON.stringify(history));
    }

    static getReportHistory() {
        const stored = localStorage.getItem(this.reportHistoryKey);
        return stored ? JSON.parse(stored) : [];
    }

    // --- Exportar reporte como archivo (JSON/CSV) ---
    static exportReportFile(report, format = 'json') {
        if (format === 'csv') {
            const csvLines = [
                'Concepto,Valor',
                `Tipo, ${report.type || 'daily'}`,
                ...(report.formattedOpenTime ? [`Apertura, ${report.formattedOpenTime}`] : []),
                ...(report.formattedCloseTime ? [`Cierre, ${report.formattedCloseTime}`] : []),
                `Monto Inicial, $${report.initialAmount.toFixed(2)}`,
                `Total Ventas, $${report.totalSales.toFixed(2)}`,
                `Efectivo, $${report.cashSales.toFixed(2)}`,
                `Tarjeta, $${report.cardSales.toFixed(2)}`,
                `Transacciones, ${report.transactionCount}`,
                ...(report.salesInSession !== undefined ? [`Ventas en Sesión, ${report.salesInSession}`] : []),
                `Caja Final, $${report.closingAmount.toFixed(2)}`,
                `Piezas Vendidas, ${report.piecesSold || 0}`,
                ...(report.profit !== undefined ? [
                    `Ganancia Neta, $${report.profit.toFixed(2)}`,
                    `Margen, ${report.margin}%`
                ] : [])
            ];
            const csvContent = csvLines.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cierre-caja-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return { success: true, message: 'Reporte CSV descargado' };
        }

        // Default: JSON
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cierre-caja-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return { success: true, message: 'Reporte JSON descargado' };
    }

    // --- Guardado local simplificado para el perfil Invitado ---
    // Descarga/guarda ÚNICAMENTE el registro de la sesión actual,
    // sin desgloses financieros sensibles (solo piezas vendidas).
    static exportGuestSession(report) {
        const guestReport = this.buildGuestSessionReport(report);
        const blob = new Blob([JSON.stringify(guestReport, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cierre-invitado-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return { success: true, message: 'Registro del turno guardado localmente' };
    }
}