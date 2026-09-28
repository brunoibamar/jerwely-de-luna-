class Backup {
    static backupKey = 'pos_backup';
    static pendingReportsKey = 'pos_pending_reports';
    static emailConfigKey = 'pos_email_config';
    static reportHistoryKey = 'pos_report_history';

    static createBackup() {
        const data = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            store: 'Jewerly De Luna',
            inventory: Inventory.getAll(),
            sales: SaleService.getAll(),
            users: Auth.adminUsers,
            settings: Settings.getSettings()
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
            settings: Settings.getSettings()
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
        const sales = SaleService.getDailySales();
        const summary = Cut.getSummaryByRole();
        const initialAmount = Auth.getDrawerInitial();

        const report = {
            type: 'daily',
            date: new Date().toISOString().split('T')[0],
            store: 'Jewerly De Luna',
            cashier: Auth.getCurrentUser()?.name || 'Desconocido',
            role: Auth.getRole(),
            initialAmount: summary.isFull ? initialAmount : 0,
            totalSales: summary.isFull ? summary.grandTotal : 0,
            cashSales: summary.isFull ? summary.cashTotal : 0,
            cardSales: summary.isFull ? summary.cardTotal : 0,
            transactionCount: summary.transactionCount,
            cashInDrawer: summary.isFull ? summary.cashTotal + initialAmount : 0,
            closingAmount: summary.isFull ? summary.cashTotal + initialAmount : 0,
            items: summary.isFull ? sales.map(s => ({
                id: s.id,
                total: s.total,
                items: s.items.length,
                paymentMethod: s.paymentMethod,
                time: new Date(s.date).toLocaleTimeString('es-MX')
            })) : []
        };

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
            store: 'Jewerly De Luna',
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
            store: 'Jewerly De Luna',
            totalRevenue,
            totalCost,
            profit,
            margin,
            totalTransactions: yearSales.length,
            monthlyData,
            generatedAt: new Date().toISOString()
        };
    }

    // --- Envío de reporte por email al administrador ---
    // Usa mailto: para abrir el cliente de correo predeterminado con
    // la información estructurada del corte. Si EmailJS estuviera configurado,
    // se podría usar su API en su lugar.
    static async sendReportEmail(report, recipient) {
        const email = recipient || Auth.getAdminEmail();

        if (!email) {
            return { success: false, message: 'No se ha configurado el correo del administrador' };
        }

        const subject = `[Jewerly De Luna] Reporte ${report.type === 'daily' ? 'Diario' :
            report.type === 'monthly' ? 'Mensual' : 'Anual'} - ${new Date().toLocaleDateString('es-MX')}`;

        const body = this.formatReportForEmail(report);

        if (this.isOnline()) {
            // Abrir cliente de correo predeterminado con la información estructurada
            const mailtoLink = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            const newWin = window.open(mailtoLink, '_blank', 'noopener,noreferrer');

            if (!newWin) {
                // Popup bloqueado: guardar localmente y notificar
                this.savePendingReport(report, email);
                return { success: true, message: 'No se pudo abrir el cliente de correo. Reporte guardado localmente y se enviará cuando esté disponible.' };
            }

            return { success: true, message: `Reporte enviado a ${email}` };
        } else {
            this.savePendingReport(report, email);
            return { success: true, message: 'Sin conexión. Reporte guardado localmente y se enviará cuando haya red.' };
        }
    }

    static formatReportForEmail(report) {
        const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : '0.00');

        if (report.type === 'daily') {
            let text = `REPORTE DE CIERRE DE CAJA - Jewerly De Luna\n`;
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
            text += `Reporte generado automáticamente por Jewerly De Luna POS\n`;
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
        if (!this.isOnline()) return { success: false, message: 'Sin conexión' };

        const pending = this.getPendingReports();
        if (pending.length === 0) return { success: true, message: 'No hay reportes pendientes' };

        let sent = 0;
        for (const item of pending) {
            const result = await this.sendReportEmail(item.report, item.email);
            if (result.success) {
                sent++;
                const index = pending.indexOf(item);
                this.clearPendingReport(index);
            }
        }

        return { success: true, message: `${sent} reporte(s) enviado(s) correctamente` };
    }

    // --- Reportes recurrentes ---

    static monthlyReportKey = 'pos_last_monthly_report';
    static annualReportKey = 'pos_last_annual_report';

    static checkMonthlyReport() {
        const now = new Date();
        const currentKey = `${now.getFullYear()}-${(now.getMonth() + 1)}`;
        const lastSent = localStorage.getItem(this.monthlyReportKey);

        if (lastSent !== currentKey && Auth.isAdmin()) {
            const report = this.generateMonthlyReport();
            const result = this.sendReportEmail(report);
            if (result.success) {
                localStorage.setItem(this.monthlyReportKey, currentKey);
            }
            return result;
        }
        return { success: false, message: 'Ya se envió el reporte mensual' };
    }

    static checkAnnualReport() {
        const now = new Date();
        const currentYear = now.getFullYear().toString();
        const lastSent = localStorage.getItem(this.annualReportKey);

        if (lastSent !== currentYear && Auth.isAdmin()) {
            const report = this.generateAnnualReport(now.getFullYear());
            const result = this.sendReportEmail(report);
            if (result.success) {
                localStorage.setItem(this.annualReportKey, currentYear);
            }
            return result;
        }
        return { success: false, message: 'Ya se envió el reporte anual' };
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
                `Monto Inicial, $${report.initialAmount.toFixed(2)}`,
                `Total Ventas, $${report.totalSales.toFixed(2)}`,
                `Efectivo, $${report.cashSales.toFixed(2)}`,
                `Tarjeta, $${report.cardSales.toFixed(2)}`,
                `Transacciones, ${report.transactionCount}`,
                `Caja Final, $${report.closingAmount.toFixed(2)}`,
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
}