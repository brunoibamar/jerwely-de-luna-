class Backup {
    static get backupKey() { return Business.key('pos_backup'); }
    static get pendingReportsKey() { return Business.key('pos_pending_reports'); }
    static get emailConfigKey() { return Business.key('pos_email_config'); }
    static get reportHistoryKey() { return Business.key('pos_report_history'); }

    // Generar sello de fecha/hora con formato YYYYMMDD_HHMMSS para nombres de archivo
    static formatDateStamp(now = new Date()) {
        const pad = (n) => n.toString().padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
            `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }

    // Datos completos del respaldo (usado por la descarga manual y el respaldo automático)
    static buildBackupData() {
        return {
            version: '1.2',
            timestamp: new Date().toISOString(),
            store: Business.getStoreName(),
            businessName: Business.getBusinessName(),
            businessId: Business.getCurrentBusinessId(),
            inventory: Inventory.getAll(),
            sales: SaleService.getAll(true),
            users: Auth.adminProfile,
            settings: Settings.getSettings(),
            shiftSession: localStorage.getItem(Cut.storageKey),
            shiftHistory: localStorage.getItem(Cut.shiftHistoryKey),
            heldSales: localStorage.getItem(HeldSales.storageKey),
            returns: (typeof Returns !== 'undefined') ? Returns.getAll() : JSON.parse(localStorage.getItem(Returns.storageKey) || '[]'),
            cashAdjustments: (typeof CashAdjustment !== 'undefined') ? CashAdjustment.getAll() : JSON.parse(localStorage.getItem(CashAdjustment.storageKey) || '[]'),
            guaranteeExchanges: (typeof GuaranteeExchange !== 'undefined') ? GuaranteeExchange.getAll() : JSON.parse(localStorage.getItem(GuaranteeExchange.storageKey) || '[]'),
            lastReceiptSale: localStorage.getItem(Business.key('pos_last_receipt_sale')),
            reportHistory: localStorage.getItem(this.reportHistoryKey),
            dayChangeKey: localStorage.getItem(ReportService.dayChangeKey)
        };
    }

    static createBackup() {
        const data = this.buildBackupData();
        const backupStr = JSON.stringify(data, null, 2);
        const blob = new Blob([backupStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `POS_Backup_${this.formatDateStamp()}.json`;
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
            heldSales: HeldSales.getAll(),
            returns: (typeof Returns !== 'undefined') ? Returns.getAll() : [],
            cashAdjustments: (typeof CashAdjustment !== 'undefined') ? CashAdjustment.getAll() : [],
            guaranteeExchanges: (typeof GuaranteeExchange !== 'undefined') ? GuaranteeExchange.getAll() : []
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
        if (data.returns) localStorage.setItem(Returns.storageKey, JSON.stringify(data.returns));
        if (data.cashAdjustments) localStorage.setItem(CashAdjustment.storageKey, JSON.stringify(data.cashAdjustments));
        if (data.guaranteeExchanges) localStorage.setItem(GuaranteeExchange.storageKey, JSON.stringify(data.guaranteeExchanges));

        return { success: true, message: 'Datos restaurados correctamente' };
    }

    static importFromFile(file, options = {}) {
        return new Promise((resolve, reject) => {
            if (!file) {
                resolve({ success: false, error: 'No se seleccionó ningún archivo' });
                return;
            }

            const reader = new FileReader();
            reader.onload = e => {
                try {
                    resolve(this.importData(JSON.parse(e.target.result), options));
                } catch (err) {
                    reject({ success: false, error: 'Error al leer el archivo: ' + err.message });
                }
            };
            reader.onerror = () => reject({ success: false, error: 'Error al leer el archivo' });
            reader.readAsText(file);
        });
    }

    // Importa un respaldo ya leído (archivo manual o respaldo automático).
    // Por defecto fusiona por folio/ID sin borrar nada de lo local.
    static importData(data, options = {}) {
        const { factoryRestore = false } = options;
        if (!data.version || !data.store) {
            return { success: false, error: 'Archivo de respaldo inválido' };
        }

        if (factoryRestore) {
            this._factoryRestore(data);
            return {
                success: true,
                message: 'Restauración de fábrica completada. Recargue la página para aplicar los cambios.',
                factoryRestore: true
            };
        }

        const stats = { added: 0, updated: 0, unchanged: 0 };

        const backupSales = this._normalizeArray(data.sales);
        if (backupSales.length > 0) {
            const result = this._mergeById(
                SaleService.getAll(true),
                backupSales,
                'id',
                'date'
            );
            SaleService.save(result.merged);
            stats.added += result.added;
            stats.updated += result.updated;
            stats.unchanged += result.skipped;
        }

        const backupReturns = this._normalizeArray(data.returns);
        if (backupReturns.length > 0) {
            const result = this._mergeById(
                Returns.getAll(),
                backupReturns,
                'id',
                'date'
            );
            Returns.save(result.merged);
            stats.added += result.added;
            stats.updated += result.updated;
            stats.unchanged += result.skipped;
        }

        const backupAdjustments = this._normalizeArray(data.cashAdjustments);
        if (backupAdjustments.length > 0) {
            const result = this._mergeById(
                CashAdjustment.getAll(),
                backupAdjustments,
                'id',
                'date'
            );
            CashAdjustment.save(result.merged);
            stats.added += result.added;
            stats.updated += result.updated;
            stats.unchanged += result.skipped;
        }

        const backupGuaranteeExchanges = this._normalizeArray(data.guaranteeExchanges);
        if (typeof GuaranteeExchange !== 'undefined' && backupGuaranteeExchanges.length > 0) {
            const result = this._mergeById(
                GuaranteeExchange.getAll(),
                backupGuaranteeExchanges,
                'id',
                'date'
            );
            GuaranteeExchange.save(result.merged);
            stats.added += result.added;
            stats.updated += result.updated;
            stats.unchanged += result.skipped;
        }

        const backupHeldSales = this._normalizeArray(data.heldSales);
        if (backupHeldSales.length > 0) {
            const result = this._mergeById(
                HeldSales.getAll(),
                backupHeldSales,
                'id',
                'date'
            );
            HeldSales.save(result.merged);
            stats.added += result.added;
            stats.updated += result.updated;
            stats.unchanged += result.skipped;
        }

        const backupInventory = this._normalizeArray(data.inventory);
        if (backupInventory.length > 0) {
            const invResult = this._mergeInventory(backupInventory);
            stats.added += invResult.added;
            stats.updated += invResult.updated;
        }

        if (data.settings) {
            const backupSettings = this._normalizeObject(data.settings);
            if (Object.keys(backupSettings).length > 0) {
                const current = Settings.getSettings();
                Settings.saveSettings({ ...current, ...backupSettings });
            }
        }

        // No reemplazar un turno abierto en este momento
        if (data.shiftSession && !Cut.isShiftOpen()) localStorage.setItem(Cut.storageKey, data.shiftSession);
        // Historial de cortes: fusionar en lugar de sobrescribir
        const backupHistory = this._normalizeArray(data.shiftHistory);
        if (backupHistory.length > 0) {
            const result = this._mergeById(Cut.getSessionHistory(), backupHistory, 'id', 'openedAt');
            SafeStorage.setItem(Cut.shiftHistoryKey, JSON.stringify(result.merged));
        }
        if (data.shift) localStorage.setItem(Business.key('pos_shift_opened'), data.shift);
        if (data.lastReceiptSale) localStorage.setItem(Business.key('pos_last_receipt_sale'), data.lastReceiptSale);
        if (data.reportHistory) localStorage.setItem(this.reportHistoryKey, data.reportHistory);
        if (data.dayChangeKey) localStorage.setItem(ReportService.dayChangeKey, data.dayChangeKey);
        if (data.emailConfig) localStorage.setItem(this.emailConfigKey, data.emailConfig);

        return {
            success: true,
            message: 'Datos importados correctamente. Agregadas: ' + stats.added + ', actualizadas: ' + stats.updated + ', sin cambios: ' + stats.unchanged + '.',
            stats
        };
    }

    static _normalizeArray(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string' && value.trim()) {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }
        return [];
    }

    static _normalizeObject(value) {
        if (typeof value === 'string' && value.trim()) {
            try {
                const parsed = JSON.parse(value);
                return (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) ? parsed : {};
            } catch {
                return {};
            }
        }
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
        return {};
    }

    // Fusiona por folio/ID sin perder registros:
    // - Mismo folio y misma fecha  -> es el mismo registro; gana la versión
    //   modificada más recientemente (updatedAt / canceledAt / fecha).
    // - Mismo folio y fecha distinta -> son registros DISTINTOS (folio repetido
    //   en otro dispositivo o versión anterior); se agrega con sufijo -R2, -R3...
    static _mergeById(localArr, backupArr, idKey = 'id', dateKey = 'date') {
        const localMap = new Map();
        const result = [...localArr];
        const usedIds = new Set();

        localArr.forEach(item => {
            if (item && item[idKey] != null) {
                localMap.set(item[idKey], item);
                usedIds.add(item[idKey]);
            }
        });

        const stamp = (rec) => new Date(rec.updatedAt || rec.canceledAt || rec[dateKey] || 0).getTime();
        let added = 0, updated = 0, skipped = 0;

        backupArr.forEach(item => {
            if (!item || item[idKey] == null) {
                if (item) {
                    result.push(item);
                    added++;
                }
                return;
            }
            const existing = localMap.get(item[idKey]);
            if (!existing) {
                result.push(item);
                usedIds.add(item[idKey]);
                localMap.set(item[idKey], item);
                added++;
                return;
            }

            const sameRecord = (existing[dateKey] || '') === (item[dateKey] || '');
            if (!sameRecord) {
                // Si ya se importó antes con sufijo, no duplicar
                const alreadyImported = result.some(r =>
                    r && r.originalId === item[idKey] && (r[dateKey] || '') === (item[dateKey] || '')
                );
                if (alreadyImported) {
                    skipped++;
                    return;
                }
                let n = 2;
                let newId = `${item[idKey]}-R${n}`;
                while (usedIds.has(newId)) newId = `${item[idKey]}-R${++n}`;
                result.push({ ...item, originalId: item[idKey], [idKey]: newId });
                usedIds.add(newId);
                added++;
                return;
            }

            if (stamp(item) > stamp(existing)) {
                const idx = result.findIndex(m => m && m[idKey] === item[idKey]);
                if (idx !== -1) {
                    result[idx] = item;
                    localMap.set(item[idKey], item);
                    updated++;
                }
            } else {
                skipped++;
            }
        });

        return { merged: result, added, updated, skipped };
    }

    static _mergeInventory(backupInventory) {
        const local = Inventory.getAll();
        const localMap = new Map();
        local.forEach(p => {
            if (p && p.barcode != null) localMap.set(p.barcode, p);
        });

        let added = 0, updated = 0;
        const merged = [...local];

        backupInventory.forEach(product => {
            if (!product || product.barcode == null) return;
            const existing = localMap.get(product.barcode);
            if (!existing) {
                merged.push(product);
                added++;
            } else {
                const idx = merged.findIndex(p => p.barcode === product.barcode);
                if (idx !== -1) {
                    merged[idx] = {
                        ...existing,
                        ...product,
                        stock: Math.max(existing.stock || 0, product.stock || 0)
                    };
                    updated++;
                }
            }
        });

        Inventory.saveProducts(merged);
        return { added, updated };
    }

    static _factoryRestore(data) {
        Business.ALL_NAMESPACED_KEYS.forEach(key => {
            localStorage.removeItem(Business.key(key));
        });
        localStorage.removeItem(Business.BUSINESS_NAME_KEY);

        const backupInventory = this._normalizeArray(data.inventory);
        Inventory.saveProducts(backupInventory.length ? backupInventory : Inventory.defaultProducts);

        const backupSales = this._normalizeArray(data.sales);
        SaleService.save(backupSales);

        if (data.settings) {
            const backupSettings = this._normalizeObject(data.settings);
            Settings.saveSettings(Object.keys(backupSettings).length ? backupSettings : Settings.defaultSettings);
        }

        if (data.store) Business.setBusinessName(data.store);

        if (data.auth) {
            const auth = this._normalizeObject(data.auth);
            if (auth.adminPassword) localStorage.setItem(Auth.storageKeys.adminPassword, auth.adminPassword);
            if (auth.guestKey) localStorage.setItem(Auth.storageKeys.guestKey, auth.guestKey);
            if (auth.adminUsername) localStorage.setItem(Auth.adminUsernameKey, auth.adminUsername);
        }

        if (data.license) {
            const license = this._normalizeObject(data.license);
            if (license.expiration) localStorage.setItem(License.storageKeys.expiration, license.expiration);
            if (license.lastUsage) localStorage.setItem(License.storageKeys.lastUsage, license.lastUsage);
            if (license.tampered) localStorage.setItem(License.storageKeys.tampered, license.tampered);
        }

        if (data.shiftSession) localStorage.setItem(Cut.storageKey, data.shiftSession);
        if (data.shiftHistory) localStorage.setItem(Cut.shiftHistoryKey, data.shiftHistory);
        if (data.shift) localStorage.setItem(Business.key('pos_shift_opened'), data.shift);

        const backupHeldSales = this._normalizeArray(data.heldSales);
        localStorage.setItem(HeldSales.storageKey, JSON.stringify(backupHeldSales));

        const backupReturns = this._normalizeArray(data.returns);
        localStorage.setItem(Returns.storageKey, JSON.stringify(backupReturns));

        const backupAdjustments = this._normalizeArray(data.cashAdjustments);
        localStorage.setItem(CashAdjustment.storageKey, JSON.stringify(backupAdjustments));

        const backupGuaranteeExchanges = this._normalizeArray(data.guaranteeExchanges);
        localStorage.setItem(GuaranteeExchange.storageKey, JSON.stringify(backupGuaranteeExchanges));

        if (data.lastReceiptSale) localStorage.setItem(Business.key('pos_last_receipt_sale'), data.lastReceiptSale);
        if (data.reportHistory) localStorage.setItem(this.reportHistoryKey, data.reportHistory);
        if (data.dayChangeKey) localStorage.setItem(ReportService.dayChangeKey, data.dayChangeKey);
        if (data.emailConfig) localStorage.setItem(this.emailConfigKey, data.emailConfig);
    }

    static getBackupInfo() {
        const stored = localStorage.getItem(this.backupKey);
        if (!stored) return null;
        const data = JSON.parse(stored);
        return {
            timestamp: data.timestamp,
            inventoryCount: data.inventory?.length || 0,
            salesCount: data.sales?.length || 0,
            returnsCount: data.returns?.length || 0,
            cashAdjustmentsCount: data.cashAdjustments?.length || 0,
            guaranteeExchangesCount: data.guaranteeExchanges?.length || 0
        };
    }

    // ============================================================
    //  RESPALDO DE RECUPERACIÓN LOCAL (capa 1)
    //  Snapshot silencioso en localStorage para recuperación rápida
    //  después de una caída. Contiene el estado crítico del POS.
    // ============================================================

    static get localRecoveryKey() { return Business.key('pos_local_recovery'); }

    // Consultar el estado del snapshot de recuperación local en LocalStorage.
    // Devuelve null si no existe o está corrupto.
    static getLocalRecoveryInfo() {
        const stored = localStorage.getItem(this.localRecoveryKey);
        if (!stored) return null;
        const data = SafeJSON.parse(stored, null, 'local_recovery');
        if (!data || !data.savedAt) return null;
        return {
            savedAt: data.savedAt,
            reason: data.reason || 'manual'
        };
    }

    // Crear un snapshot de recuperación local con los datos críticos.
    // No lanza excepciones: un fallo del respaldo no debe bloquear la caja.
    static createLocalRecovery(reason = 'manual') {
        try {
            const data = {
                savedAt: new Date().toISOString(),
                reason: reason,
                inventory: Inventory.getAll(),
                sales: SaleService.getAll(true),
                settings: Settings.getSettings(),
                heldSales: HeldSales.getAll(),
                returns: Returns.getAll(),
                cashAdjustments: CashAdjustment.getAll(),
                guaranteeExchanges: GuaranteeExchange.getAll(),
                shiftSession: localStorage.getItem(Cut.storageKey),
                shiftHistory: localStorage.getItem(Cut.shiftHistoryKey)
            };
            SafeStorage.setItem(this.localRecoveryKey, SafeJSON.stringify(data));
            return { savedAt: data.savedAt, reason: data.reason };
        } catch (err) {
            console.warn('[Backup] No se pudo crear el snapshot de recuperación local:', err?.message);
            return null;
        }
    }

    // Restaurar datos desde el snapshot de recuperación local.
    // Nunca borra datos: fusiona el estado guardado sobre el actual.
    static restoreLocalRecovery() {
        const stored = localStorage.getItem(this.localRecoveryKey);
        if (!stored) return { success: false, error: 'No hay snapshot de recuperación local disponible' };

        const data = SafeJSON.parse(stored, null, 'local_recovery');
        if (!data) return { success: false, error: 'El snapshot de recuperación local está corrupto' };

        try {
            if (data.inventory) Inventory.saveProducts(data.inventory);
            if (data.sales) SaleService.save(data.sales);
            if (data.settings) Settings.saveSettings(data.settings);
            if (data.heldSales) SafeStorage.setItem(HeldSales.storageKey, SafeJSON.stringify(data.heldSales));
            if (data.returns) SafeStorage.setItem(Returns.storageKey, SafeJSON.stringify(data.returns));
            if (data.cashAdjustments) SafeStorage.setItem(CashAdjustment.storageKey, SafeJSON.stringify(data.cashAdjustments));
            if (data.guaranteeExchanges) SafeStorage.setItem(GuaranteeExchange.storageKey, SafeJSON.stringify(data.guaranteeExchanges));
            if (data.shiftSession) localStorage.setItem(Cut.storageKey, data.shiftSession);
            if (data.shiftHistory) localStorage.setItem(Cut.shiftHistoryKey, JSON.stringify(data.shiftHistory));

            return { success: true, message: 'Datos restaurados desde el snapshot local de recuperación' };
        } catch (err) {
            return { success: false, error: 'Error al restaurar el snapshot: ' + (err?.message || err) };
        }
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
        let reportDate = DateUtil.today();

        if (session) {
            reportType = 'session';
            sales = Cut.getSessionSales(session.openedAt, new Date().toISOString());
            initialAmount = session.initialAmount;
            reportDate = DateUtil.toLocalDate(session.openedAt);
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
            const returnsTotal = (typeof Returns !== 'undefined') ? Returns.getTotalBySales(sales) : 0;
            report.profit = totalRevenue - totalCost - returnsTotal;
            report.returnsTotal = returnsTotal;
            report.margin = totalCost > 0 ? ((report.profit / totalCost) * 100).toFixed(1) : '0.0';

            if (typeof CashAdjustment !== 'undefined') {
                const reportDateStr = reportDate;
                const adjustments = CashAdjustment.getByDate(reportDateStr);
                let adjCash = 0;
                let adjCard = 0;
                adjustments.forEach(a => {
                    if (a.paymentMethod === 'cash') adjCash += a.amount;
                    else if (a.paymentMethod === 'card') adjCard += a.amount;
                });
                report.cashAdjustments = adjCash;
                report.cardAdjustments = adjCard;
                report.totalAdjustments = adjCash + adjCard;
                report.adjustmentCount = adjustments.length;
            }
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

        const returnsTotal = (typeof Returns !== 'undefined') ? Returns.getTotalBySales(monthSales) : 0;
        const profit = totalRevenue - totalCost - returnsTotal;
        const margin = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : '0.0';

        return {
            type: 'monthly',
            month: m,
            year: y,
            period: `${y}-${m.toString().padStart(2, '0')}`,
            store: Business.getStoreName(),
            totalRevenue,
            totalCost,
            returnsTotal: returnsTotal,
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
            const monthReturns = (typeof Returns !== 'undefined') ? Returns.getTotalBySales(monthSales) : 0;
            monthlyData.push({
                month: m,
                revenue,
                cost,
                returnsTotal: monthReturns,
                profit: revenue - cost - monthReturns,
                transactions: monthSales.length
            });
        }

        const returnsTotal = (typeof Returns !== 'undefined') ? Returns.getTotalBySales(yearSales) : 0;
        const totalRevenue = monthlyData.reduce((sum, m) => sum + m.revenue, 0);
        const totalCost = monthlyData.reduce((sum, m) => sum + m.cost, 0);
        const profit = totalRevenue - totalCost - returnsTotal;
        const margin = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : '0.0';

        return {
            type: 'annual',
            year: year,
            store: Business.getStoreName(),
            totalRevenue,
            totalCost,
            returnsTotal: returnsTotal,
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
            if (report.adjustmentCount > 0) {
                text += `\n--- Ajustes de Caja ---\n`;
                text += `Total Ajustes: -$${fmt(Math.abs(report.totalAdjustments || 0))}\n`;
                text += `Cantidad de Ajustes: ${report.adjustmentCount}\n`;
                if (typeof CashAdjustment !== 'undefined' && report.date) {
                    const adjustments = CashAdjustment.getByDate(report.date);
                    adjustments.forEach(a => {
                        const aTypeLabel = a.type === 'return' ? 'Devolución'
                            : a.type === 'cancel' ? 'Anulación'
                            : a.type === 'expense' ? 'Retiro para Depósito'
                            : 'Ajuste';
                        const aSign = a.amount < 0 ? '-' : '+';
                        const aTime = new Date(a.date).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                        text += `${aTypeLabel} • ${aTime} • ${a.note || 'Sin nota'} • ${aSign}$${fmt(Math.abs(a.amount))}\n`;
                    });
                }
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
            if (report.adjustmentCount > 0) {
                text += `\n--- Ajustes de Caja ---\n`;
                text += `Total Ajustes: -$${fmt(Math.abs(report.totalAdjustments || 0))}\n`;
                text += `Cantidad de Ajustes: ${report.adjustmentCount}\n`;
                if (typeof CashAdjustment !== 'undefined' && report.date) {
                    const adjustments = CashAdjustment.getByDate(report.date);
                    adjustments.forEach(a => {
                        const aTypeLabel = a.type === 'return' ? 'Devolución'
                            : a.type === 'cancel' ? 'Anulación'
                            : a.type === 'expense' ? 'Retiro para Depósito'
                            : 'Ajuste';
                        const aSign = a.amount < 0 ? '-' : '+';
                        const aTime = new Date(a.date).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                        text += `${aTypeLabel} • ${aTime} • ${a.note || 'Sin nota'} • ${aSign}$${fmt(Math.abs(a.amount))}\n`;
                    });
                }
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
            a.download = `cierre-caja-${DateUtil.today()}.csv`;
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
        a.download = `cierre-caja-${DateUtil.today()}.json`;
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
        a.download = `cierre-invitado-${DateUtil.today()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return { success: true, message: 'Registro del turno guardado localmente' };
    }

    // ============================================================
    //  RESPALDO PROGRAMADO (capa 2: intervalo cada 1 hora)
    // ============================================================

    static get intervalBackupKey() { return Business.key('pos_interval_backup_last'); }

    static get intervalBackupMs() { return 60 * 60 * 1000; }

    // Consultar el estado del respaldo programado (última ejecución y próxima).
    // Lectura segura: parsea con JSON.parse local en lugar de SafeJSON.parse para
    // evitar disparar la notificación roja de "localStorage corrompido". Si la
    // clave es nueva, contiene un valor numérico/texto por defecto (ej. 3600000)
    // o es un objeto { lastRun } válido, simplemente se informa el estado sin
    // avisos. Solo si el contenido es inútil o no parsea se sobrescribe al
    // valor por defecto (intervalo configurado) de forma silenciosa.
    static getIntervalBackupInfo() {
        const key = this.intervalBackupKey;
        const stored = localStorage.getItem(key);
        if (!stored) return null;

        let data;
        try {
            data = JSON.parse(stored);
        } catch {
            this.resetIntervalBackup(key);
            return null;
        }

        if (typeof data === 'number' || typeof data === 'string') {
            return null;
        }

        if (data && typeof data === 'object' && data.lastRun) {
            try {
                const lastRun = new Date(data.lastRun);
                const nextRun = new Date(lastRun.getTime() + this.intervalBackupMs);
                return {
                    lastRun: lastRun.toISOString(),
                    nextRun: nextRun.toISOString()
                };
            } catch {
                return null;
            }
        }

        this.resetIntervalBackup(key);
        return null;
    }

    // Sobrescribir interval_backup con su valor por defecto (intervalo en ms).
    static resetIntervalBackup(key) {
        try {
            localStorage.setItem(key, String(this.intervalBackupMs));
        } catch (err) {
            console.warn('[Backup] No se pudo restablecer interval_backup:', err.message);
        }
    }

    // Iniciar el temporizador de respaldo programado (cada 1 hora).
    static startIntervalBackup() {
        try {
            if (typeof setInterval !== 'undefined') {
                setInterval(() => {
                    try { this.runScheduledBackup(); } catch (err) {
                        console.warn('[Backup] Error en respaldo programado:', err?.message);
                    }
                }, this.intervalBackupMs);
            }
        } catch (err) {
            console.warn('[Backup] No se pudo iniciar el respaldo programado:', err?.message);
        }
    }

    // Ejecutar un respaldo programado: exportar a localStorage + crear snapshot local.
    static runScheduledBackup() {
        try {
            this.exportToLocalStorage();
            const now = new Date().toISOString();
            SafeStorage.setItem(this.intervalBackupKey, JSON.stringify({ lastRun: now }));
            this.createLocalRecovery('programado');
        } catch (err) {
            console.warn('[Backup] Error al ejecutar respaldo programado:', err?.message);
        }
    }

    // Descargar un respaldo JSON con el estado completo del sistema + reporte de corte.
    static downloadCutBackup(report) {
        try {
            const data = {
                version: '1.2',
                type: 'cut_backup',
                timestamp: new Date().toISOString(),
                store: Business.getStoreName(),
                businessName: Business.getBusinessName(),
                businessId: Business.getCurrentBusinessId(),
                inventory: Inventory.getAll(),
                sales: SaleService.getAll(true),
                report: report
            };
            const backupStr = JSON.stringify(data, null, 2);
            const blob = new Blob([backupStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `respaldo_pos_${this.formatDateStamp()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            return { success: true, message: 'Respalado de corte descargado correctamente' };
        } catch (err) {
            return { success: false, error: 'Error al descargar el respaldo: ' + (err?.message || err) };
        }
    }
}

// ============================================================
//  AutoBackup: respaldo automático a un archivo en disco.
//  Usa la File System Access API (Chrome / Edge de escritorio).
//  El administrador elige el archivo una sola vez; después se
//  reescribe completo al terminar cada venta, anulación,
//  devolución, garantía y corte. El "manejador" del archivo se
//  guarda en IndexedDB para recordarlo entre recargas.
// ============================================================
class AutoBackup {
    static DB_NAME = 'jewelry_deluna_autobackup';
    static STORE = 'handles';
    static HANDLE_ID = 'backup-file';
    static get lastSaveKey() { return Business.key('pos_autobackup_last'); }

    static _handle = null;
    static _queue = Promise.resolve();
    static _pending = false;
    static _errorShown = false;
    static _permToastShown = false;
    static _blockedToastShown = false;
    static FILE_NAME = 'JewelryDeLuna_respaldo_automatico.json';

    // 'id' hace que el navegador abra siempre la misma carpeta en el selector
    static get pickerOptions() {
        return {
            id: 'jdl-autobackup',
            startIn: 'documents',
            types: [{ description: 'Respaldo JSON', accept: { 'application/json': ['.json'] } }]
        };
    }

    static isSupported() {
        return typeof window.showSaveFilePicker === 'function' && typeof indexedDB !== 'undefined';
    }

    // --- IndexedDB (persistencia del manejador del archivo) ---
    static _openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(this.STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    static async _dbOp(mode, fn) {
        const db = await this._openDb();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE, mode);
                const req = fn(tx.objectStore(this.STORE));
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } finally {
            db.close();
        }
    }

    static async _loadHandle() {
        if (this._handle) return this._handle;
        if (!this.isSupported()) return null;
        try {
            this._handle = (await this._dbOp('readonly', s => s.get(this.HANDLE_ID))) || null;
        } catch {
            this._handle = null;
        }
        return this._handle;
    }

    static async _permission(handle, request = false) {
        const opts = { mode: 'readwrite' };
        if (await handle.queryPermission(opts) === 'granted') return 'granted';
        if (request) return handle.requestPermission(opts);
        return 'prompt';
    }

    // --- Acciones del administrador ---
    static async chooseFile() {
        if (!this.isSupported()) {
            Toast.warning('Este navegador no permite respaldo automático a archivo. Use Chrome o Edge en computadora.');
            return false;
        }
        try {
            const handle = await window.showSaveFilePicker({
                ...this.pickerOptions,
                suggestedName: this.FILE_NAME
            });
            await this._dbOp('readwrite', s => s.put(handle, this.HANDLE_ID));
            this._handle = handle;
            this._errorShown = false;
            await this.saveNow('configuración');
            Toast.success('Respaldo automático activado: ' + handle.name);
            return true;
        } catch (err) {
            if (err && err.name === 'AbortError') return false;
            Toast.error('No se pudo configurar el respaldo automático: ' + (err?.message || err));
            return false;
        } finally {
            this.renderStatus();
        }
    }

    static async reauthorize() {
        const handle = await this._loadHandle();
        if (!handle) return false;
        try {
            const perm = await this._permission(handle, true);
            if (perm === 'granted') {
                this._errorShown = false;
                await this.saveNow('reactivación');
                Toast.success('Respaldo automático reactivado');
                return true;
            }
            Toast.warning('Sin permiso, el respaldo automático queda en pausa.');
            return false;
        } finally {
            this.renderStatus();
        }
    }

    static async disable() {
        try {
            await this._dbOp('readwrite', s => s.delete(this.HANDLE_ID));
        } catch { /* ignorar */ }
        this._handle = null;
        this.renderStatus();
        Toast.info('Respaldo automático desactivado');
    }

    // --- Guardado ---
    // Encola el guardado para que dos operaciones seguidas no escriban
    // el archivo al mismo tiempo. Nunca lanza excepciones: una falla del
    // respaldo no debe impedir registrar la venta.
    static save(reason = '') {
        if (!this.isSupported()) return Promise.resolve(false);
        // Si ya hay un guardado en espera, ese tomará los datos más recientes
        if (this._pending) return this._queue;
        this._pending = true;
        this._queue = this._queue.then(() => {
            this._pending = false;
            return this.saveNow(reason);
        });
        return this._queue;
    }

    static async saveNow(reason = '') {
        try {
            const handle = await this._loadHandle();
            if (!handle) return false;
            if (await this._permission(handle) !== 'granted') {
                this.notifyNeedsPermission();
                return false;
            }
            // Candado: si el archivo tiene ventas que este navegador ya no tiene
            // (se perdió información), NO sobrescribirlo; ofrecer restaurar.
            const existing = await this._readFile(handle);
            const missing = existing ? this._countMissingSales(existing) : 0;
            if (missing > 0) {
                this.notifyBlocked(missing);
                this.renderStatus();
                return false;
            }

            const data = Backup.buildBackupData();
            data.autoBackup = { savedAt: new Date().toISOString(), reason, device: Device.getId() };
            const writable = await handle.createWritable();
            await writable.write(JSON.stringify(data, null, 2));
            await writable.close();
            try { localStorage.setItem(this.lastSaveKey, data.autoBackup.savedAt); } catch { /* sin espacio */ }
            this._errorShown = false;
            this.renderStatus();
            return true;
        } catch (err) {
            if (!this._errorShown) {
                this._errorShown = true;
                Toast.warning('No se pudo actualizar el respaldo automático: ' + (err?.message || err), 6000);
            }
            this.renderStatus();
            return false;
        }
    }

    // --- Lectura del archivo de respaldo ---
    static async _readFile(handle) {
        try {
            const file = await handle.getFile();
            const text = await file.text();
            if (!text.trim()) return null;
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    // Ventas del archivo que no existen en este navegador (mismo folio y fecha,
    // o renombradas con sufijo -R al fusionar)
    static _countMissingSales(fileData) {
        const fileSales = Backup._normalizeArray(fileData.sales);
        if (fileSales.length === 0) return 0;
        const local = new Set();
        SaleService.getAll(true).forEach(s => {
            if (!s) return;
            local.add(`${s.id}|${s.date}`);
            if (s.originalId) local.add(`${s.originalId}|${s.date}`);
        });
        return fileSales.filter(s => s && s.id != null && !local.has(`${s.id}|${s.date}`)).length;
    }

    // ============================================================
    //  RESTAURAR CON UN BOTÓN
    //  - Si el navegador aún recuerda el archivo: lo lee directo.
    //  - Si se borraron los datos del navegador (el permiso también
    //    se pierde): abre el selector en la carpeta de siempre para
    //    elegir el archivo, y lo vuelve a dejar como respaldo automático.
    //  La restauración FUSIONA: no borra nada de lo que ya hay.
    // ============================================================
    static async restore() {
        if (!this.isSupported()) {
            Toast.warning('Este navegador no permite leer el respaldo automático. Use "Importar / Restaurar Copia de Seguridad".');
            return { success: false };
        }
        try {
            let handle = await this._loadHandle();
            if (handle && await this._permission(handle, true) !== 'granted') handle = null;

            if (!handle) {
                Toast.info(`Seleccione el archivo "${this.FILE_NAME}"`, 5000);
                const [picked] = await window.showOpenFilePicker({ ...this.pickerOptions, multiple: false });
                if (await this._permission(picked, true) !== 'granted') {
                    Toast.warning('Sin permiso para usar el archivo.');
                    return { success: false };
                }
                handle = picked;
                await this._dbOp('readwrite', s => s.put(handle, this.HANDLE_ID));
                this._handle = handle;
            }

            const data = await this._readFile(handle);
            if (!data) {
                Toast.error('El archivo de respaldo está vacío o dañado.');
                return { success: false };
            }

            const result = Backup.importData(data);
            if (!result.success) {
                Toast.error(result.error || 'No se pudo restaurar el respaldo');
                return result;
            }

            this._blockedToastShown = false;
            const when = data.autoBackup?.savedAt
                ? ` (respaldo del ${new Date(data.autoBackup.savedAt).toLocaleString('es-MX')})`
                : '';
            Toast.success(`Información restaurada${when}. ${result.message} La página se recargará.`, 6000);
            setTimeout(() => window.location.reload(), 3000);
            return result;
        } catch (err) {
            if (err && err.name === 'AbortError') return { success: false };
            Toast.error('Error al restaurar: ' + (err?.message || err));
            return { success: false };
        } finally {
            this.renderStatus();
        }
    }

    // Aviso cuando el respaldo tiene más información que el navegador
    static notifyBlocked(missing) {
        if (this._blockedToastShown || typeof Toast === 'undefined') return;
        this._blockedToastShown = true;
        const toast = Toast.show(
            `El archivo de respaldo tiene ${missing} venta(s) que este equipo no tiene. Para no perderlas, el respaldo automático se pausó. <button type="button" class="btn btn-outline btn-sm auto-backup-restore-toast-btn">Restaurar ahora</button>`,
            'warning',
            0
        );
        toast.querySelector('.auto-backup-restore-toast-btn')?.addEventListener('click', () => {
            Toast.hide(toast);
            this.restore();
        });
        toast.querySelector('.toast-close')?.addEventListener('click', () => {
            this._blockedToastShown = false;
        });
    }

    // Aviso con botón para volver a dar permiso (el navegador lo pide tras reiniciar)
    static notifyNeedsPermission() {
        if (this._permToastShown || typeof Toast === 'undefined') return;
        this._permToastShown = true;
        const toast = Toast.show(
            'El respaldo automático está en pausa. <button type="button" class="btn btn-outline btn-sm auto-backup-toast-btn">Reactivar</button>',
            'warning',
            0
        );
        toast.querySelector('.auto-backup-toast-btn')?.addEventListener('click', async () => {
            const ok = await this.reauthorize();
            if (ok) {
                Toast.hide(toast);
                this._permToastShown = false;
            }
        });
        // Permitir que vuelva a mostrarse si se cierra sin reactivar
        toast.querySelector('.toast-close')?.addEventListener('click', () => {
            this._permToastShown = false;
        });
    }

    // Al iniciar: si hay archivo configurado pero falta permiso, avisar
    static async checkOnStartup() {
        try {
            const handle = await this._loadHandle();
            if (handle && await this._permission(handle) !== 'granted') {
                this.notifyNeedsPermission();
            } else if (handle) {
                // Detectar pérdida de información al abrir el programa
                const existing = await this._readFile(handle);
                const missing = existing ? this._countMissingSales(existing) : 0;
                if (missing > 0) this.notifyBlocked(missing);
            }
        } catch { /* ignorar */ }
        this.renderStatus();
    }

    static async renderStatus() {
        const statusEl = document.getElementById('auto-backup-status');
        const chooseBtn = document.getElementById('auto-backup-choose-btn');
        const reauthBtn = document.getElementById('auto-backup-reauth-btn');
        const disableBtn = document.getElementById('auto-backup-disable-btn');
        if (!statusEl) return;

        if (!this.isSupported()) {
            statusEl.textContent = 'Este navegador no permite respaldo automático a archivo. Use Chrome o Edge en computadora, o exporte copias manualmente con frecuencia.';
            if (chooseBtn) chooseBtn.disabled = true;
            return;
        }

        const handle = await this._loadHandle();
        const last = localStorage.getItem(this.lastSaveKey);
        const lastText = last ? ` Último guardado: ${new Date(last).toLocaleString('es-MX')}.` : '';

        if (!handle) {
            statusEl.textContent = 'Respaldo automático DESACTIVADO.';
            if (chooseBtn) chooseBtn.textContent = 'Elegir archivo de respaldo automático';
            reauthBtn?.classList.add('hidden');
            disableBtn?.classList.add('hidden');
            return;
        }

        let perm = 'prompt';
        try { perm = await this._permission(handle); } catch { /* archivo inaccesible */ }
        if (chooseBtn) chooseBtn.textContent = 'Cambiar archivo';
        disableBtn?.classList.remove('hidden');
        if (perm === 'granted') {
            statusEl.textContent = `Respaldo automático ACTIVO en "${handle.name}".${lastText}`;
            reauthBtn?.classList.add('hidden');
        } else {
            statusEl.textContent = `Respaldo automático EN PAUSA ("${handle.name}"): presione "Reactivar".${lastText}`;
            reauthBtn?.classList.remove('hidden');
        }
    }
}

window.AutoBackup = AutoBackup;