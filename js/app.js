class SaleService {
    static get storageKey() { return Business.key('pos_sales'); }

    // Banderillas para emitir diagnósticos temporales una sola vez por carga.
    static _diagLogged = false;
    static _migrateWarned = false;

    static getAll(includeCanceled = false) {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) return [];
        const all = SafeJSON.parse(stored, [], 'ventas');
        if (!Array.isArray(all)) return [];
        // Normalizar en memoria los registros legados que no cumplen el esquema
        // canónico (asigna valores por defecto a los campos faltantes) para que
        // no se descarte ninguna venta. No se modifica el localStorage.
        if (all.length && !DataValidator.validateSales(all)) {
            if (!SaleService._migrateWarned) {
                console.warn('[SaleService] Esquema de ventas inválido detectado; intentando migrar...');
                SaleService._migrateWarned = true;
            }
            for (let i = 0; i < all.length; i++) {
                if (all[i] != null && !DataValidator.isValidSale(all[i])) {
                    all[i] = this.normalizeSale(all[i]);
                }
            }
        }
        if (includeCanceled) return all;
        return all.filter(s => s && s.status !== 'canceled');
    }

    static save(sales) {
        SafeStorage.setItem(this.storageKey, SafeJSON.stringify(sales));
    }

    // ============================================================
    //  Historial Maestro de Ventas (ventas_historico)
    //  Arreglo maestro permanente donde cada venta se anexa
    //  (append) de forma definitiva con su timestamp exacto.
    //  El Corte de Caja NUNCA borra ni limpia este historial.
    //  Los reportes (diario, semanal, mensual, anual) leen desde
    //  aquí para garantizar datos completos e ininterrumpidos.
    // ============================================================

    static get historicalKey() { return Business.key('pos_sales_historical'); }

    // Leer todo el historial maestro (incluye canceladas).
    // Los registros inválidos se NORMALIZAN en memoria (no se descartan) para
    // que NINGUNA venta se pierda: se les asignan valores por defecto a los
    // campos faltantes y se mapean nombres legados (fecha/timestamp→date).
    // El localStorage se preserva intacto; sólo se transforma la lectura.
    static getHistoricalSales() {
        const stored = localStorage.getItem(this.historicalKey);
        if (!stored) return [];
        const parsed = SafeJSON.parse(stored, [], 'ventas_historico');
        if (!Array.isArray(parsed)) {
            console.warn('[SaleService] Historial maestro no es un arreglo; se preserva el estado.');
            return [];
        }
        const result = [];
        parsed.forEach(s => {
            if (s == null || typeof s !== 'object') return;
            if (DataValidator.isValidSale(s)) {
                result.push(s);
                return;
            }
            // --- DIAGNÓSTICO TEMPORAL: registrar el primer registro inválido ---
            if (!SaleService._diagLogged) {
                console.log('[SaleService][DIAG] Registro de venta inválido normalizado (inspeccione pos_sales_historical en localStorage):', JSON.parse(JSON.stringify(s)));
                SaleService._diagLogged = true;
            }
            const norm = SaleService.normalizeSale(s);
            if (norm != null) result.push(norm);
        });
        return result;
    }

    // Normaliza un registro de venta legado en memoria: asigna valores por
    // defecto a los campos faltantes o con nombre obsoleto (fecha/timestamp/
    // createdAt→date, items, total, status, paymentMethod, ...). No escribe en
    // localStorage; conserva los datos originales y evita pérdidas de ventas.
    static normalizeSale(sale) {
        if (sale === null || typeof sale !== 'object') return null;
        const s = { ...sale };

        // --- Campo de fecha: mapear nombres legados al canónico 'date' ---
        const legacyDate = s.fecha || s.timestamp || s.createdAt;
        if ((!s.date || typeof s.date !== 'string' || s.date.length === 0) && legacyDate) {
            s.date = String(legacyDate);
        }
        if (!s.date || typeof s.date !== 'string' || s.date.length === 0) {
            s.date = new Date().toISOString();
        }
        if (!s.timestamp || typeof s.timestamp !== 'string') {
            s.timestamp = s.date;
        }

        // --- id (valor por defecto estable/determinista si falta) ---
        if (typeof s.id !== 'string' || s.id.length === 0) {
            if (s.id != null && s.id !== '') {
                s.id = String(s.id);
            } else {
                s.id = this._hashSale(s);
            }
        }

        // --- items ---
        if (!Array.isArray(s.items)) {
            s.items = [];
        }

        // --- piezas (cantidad total de artículos vendidos) ---
        if (typeof s.piezas !== 'number') {
            s.piezas = Array.isArray(s.items)
                ? s.items.reduce((sum, i) => sum + (typeof i.quantity === 'number' ? i.quantity : 1), 0)
                : 0;
        }

        // --- total ---
        if (typeof s.total !== 'number' || !isFinite(s.total) || s.total < 0) {
            const fallback = (typeof s.subtotal === 'number' && isFinite(s.subtotal) && s.subtotal >= 0)
                ? s.subtotal
                : 0;
            s.total = fallback;
        }

        // --- status ---
        if (typeof s.status !== 'string' || s.status.length === 0) {
            s.status = 'active';
        }

        // --- paymentMethod ---
        if (typeof s.paymentMethod !== 'string' || s.paymentMethod.length === 0) {
            s.paymentMethod = 'cash';
        }

        // --- cajaId / version ---
        if (s.cajaId == null) {
            s.cajaId = null;
        }
        if (!s.version) {
            s.version = '1.0';
        }

        return s;
    }

    // Hash determinista sobre el contenido del registro; genera un id estable
    // cuando un registro legado no lo posee.
    static _hashSale(sale) {
        let str;
        try {
            str = JSON.stringify(sale);
        } catch (e) {
            str = String(sale);
        }
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            hash = ((hash << 5) - hash + c) | 0;
        }
        return 'migrated_' + (hash >>> 0).toString(36);
    }

    // Guardar el historial maestro completo (usado por migración y restauración)
    static saveHistorical(sales) {
        SafeStorage.setItem(this.historicalKey, SafeJSON.stringify(sales));
    }

    // Anexar una venta al historial maestro con timestamp exacto.
    // Se invoca desde saveSale() y cancelSale() para garantizar
    // persistencia permanente e ininterrumpida.
    static appendToHistory(sale) {
        if (!sale || typeof sale !== 'object') return;
        try {
            const history = this.getHistoricalSales();
            const idx = history.findIndex(s => s && s.id === sale.id);
            if (idx !== -1) {
                history[idx] = { ...sale };
            } else {
                history.push({ ...sale });
            }
            this.saveHistorical(history);
        } catch (err) {
            if (SafeStorage.isQuotaError(err)) {
                console.warn('[SaleService] Sin espacio en historial maestro; no se pudo anexar venta.');
            } else {
                console.error('[SaleService] Error al anexar al historial:', err?.message);
            }
        }
    }

    // Migrar ventas existentes al historial maestro (idempotente).
    // Se ejecuta en cada inicio y FUSIONA (no reemplaza) las ventas que aún
    // no están anexadas al historial maestro, identificadas por su id. Así,
    // si el historial se redujo a un solo registro por un error previo, las
    // ventas faltantes (p. ej. de los últimos 3 días) se recuperan de pos_sales.
    static migrateToHistorical() {
        try {
            const history = this.getHistoricalSales();
            const existingIds = new Set((history || []).map(s => s && s.id).filter(Boolean));
            const current = this.getAll(true);
            let migrated = 0;
            const merged = history.slice();
            current.forEach(sale => {
                if (sale && sale.id && !existingIds.has(sale.id)) {
                    merged.push({ ...sale });
                    migrated++;
                }
            });
            if (migrated > 0) this.saveHistorical(merged);
            return {
                migrated,
                message: migrated > 0
                    ? 'Migradas ' + migrated + ' ventas al historial maestro'
                    : 'Historial maestro actualizado'
            };
        } catch (err) {
            return { migrated: 0, error: err?.message || 'Error de migración' };
        }
    }

    // Registrar un evento de historial maestro cuando el Corte de Caja
    // cierra una sesión. NUNCA limpia las ventas acumuladas.
    static logShiftClosure(session) {
        if (!session || !session.id) return;
        try {
            const key = Business.key('pos_shift_closures');
            const stored = localStorage.getItem(key);
            const closures = stored ? SafeJSON.parse(stored, [], 'cierres_turnos') : [];
            if (!Array.isArray(closures)) {
                closures.length = 0;
            }
            closures.push({
                sessionId: session.id,
                closedAt: session.closedAt || new Date().toISOString(),
                openedAt: session.openedAt,
                initialAmount: session.initialAmount,
                totalSales: session.report ? session.report.grandTotal || 0 : 0,
                salesCount: session.report ? session.report.transactionCount : 0,
                timestamp: new Date().toISOString()
            });
            SafeStorage.setItem(key, SafeJSON.stringify(closures));
        } catch (err) {
            console.warn('[SaleService] No se pudo registrar cierre de turno en historial:', err?.message);
        }
    }

    // Repara folios duplicados generados por versiones anteriores
    // (el folio se calculaba con el conteo de ventas y se repetía al
    // anular). Conserva el primero y renombra los demás con sufijo -R2, -R3...
    static repairDuplicateIds() {
        const sales = this.getAll(true);
        const seen = new Map();
        let repaired = 0;
        sales.forEach(sale => {
            if (!sale || sale.id == null) return;
            const count = (seen.get(sale.id) || 0) + 1;
            seen.set(sale.id, count);
            if (count > 1) {
                let n = count;
                let newId = `${sale.id}-R${n}`;
                while (seen.has(newId)) newId = `${sale.id}-R${++n}`;
                sale.originalId = sale.id;
                sale.id = newId;
                seen.set(newId, 1);
                repaired++;
            }
        });
        if (repaired > 0) this.save(sales);
        return repaired;
    }

    static saveSale(sale) {
        const sales = this.getAll(true);
        sales.push(sale);
        this.save(sales);
        this.appendToHistory(sale);
        return sale;
    }

    static getById(saleId) {
        return this.getAll(true).find(s => s.id === saleId);
    }

    static getSalesByDate(date) {
        return this.getAll().filter(s => DateUtil.isOnDate(s.date, date));
    }

    static getDailySales(date = DateUtil.today()) {
        return this.getHistoricalSales().filter(s => s.status !== 'canceled' && DateUtil.isOnDate(s.date, date));
    }

    static getReportStats(date = DateUtil.today()) {
        const sales = this.getDailySales(date);
        const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
        const itemCount = sales.reduce((sum, s) => sum + s.items.length, 0);
        return {
            totalRevenue: totalSales,
            transactionCount: sales.length,
            itemsSold: itemCount
        };
    }

    // --- Anulación / Cancelación de venta (solo admin) ---
    // Marca una venta como cancelada y devuelve los datos para reversar stock y caja.
    static cancelSale(saleId, reason = '') {
        const sales = this.getAll(true);
        const index = sales.findIndex(s => s.id === saleId);
        if (index === -1) {
            return { success: false, error: 'Venta no encontrada' };
        }
        const sale = sales[index];
        if (sale.status === 'canceled') {
            return { success: false, error: 'La venta ya está anulada' };
        }
        sale.status = 'canceled';
        sale.canceledAt = new Date().toISOString();
        sale.cancelReason = reason.trim();
        sale.updatedAt = sale.canceledAt;
        this.save(sales);
        this.appendToHistory(sale);
        return { success: true, sale };
    }

    // Obtener todas las ventas anuladas del día
    static getCanceledSales(date = null) {
        const all = this.getAll(true);
        return all.filter(s => s.status === 'canceled' && (
            !date || DateUtil.isOnDate(s.date, date)
        ));
    }
}

class Toast {
    static containerId = 'toast-container';
    static activeToasts = [];

    static getContainer() {
        let container = document.getElementById(this.containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = this.containerId;
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    static show(message, type = 'info', duration = 3500) {
        const container = this.getContainer();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const iconMap = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };

        toast.innerHTML = `
            <span class="toast-icon">${iconMap[type] || iconMap.info}</span>
            <span class="toast-message">${message}</span>
            <button type="button" class="toast-close" aria-label="Cerrar">×</button>
        `;

        toast.querySelector('.toast-close').addEventListener('click', () => {
            this.hide(toast);
        });

        container.appendChild(toast);
        this.activeToasts.push(toast);

        setTimeout(() => {
            toast.classList.add('show');
        }, 10);

        if (duration > 0) {
            setTimeout(() => {
                this.hide(toast);
            }, duration);
        }

        return toast;
    }

    static hide(toast) {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            this.activeToasts = this.activeToasts.filter(t => t !== toast);
        }, 300);
    }

    static success(message, duration = 3500) {
        return this.show(message, 'success', duration);
    }

    static error(message, duration = 4000) {
        return this.show(message, 'error', duration);
    }

    static warning(message, duration = 4000) {
        return this.show(message, 'warning', duration);
    }

    static info(message, duration = 3500) {
        return this.show(message, 'info', duration);
    }
}

class Settings {
    static get storageKey() { return Business.key('pos_settings'); }

    static defaultSettings = {
        storeName: 'Jewerly De Luna',
        storeAddress: 'Av. Reforma 123, CDMX',
        storePhone: '(55) 1234-5678',
        storeRfc: '',
        storeLogo: '',
        receiptHeader: 'Gracias por su compra',
        receiptFooter: '¡Gracias por su compra!',
        receiptShowCashier: true,
        receiptShowDate: true,
        receiptShowPaymentMethod: true,
        receiptShowPaymentDetails: true,
        lowStockThreshold: 5
    };

    static getSettings() {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) {
            this.saveSettings(this.defaultSettings);
            return { ...this.defaultSettings };
        }
        const parsed = SafeJSON.parse(stored, null, 'settings');
        if (parsed === null || !DataValidator.validateSettings(parsed)) {
            if (typeof Toast !== 'undefined' && Toast.warning) {
                Toast.warning('Configuración con formato inválido. Se usarán valores por defecto, preservando datos críticos.', 6000);
            }
            return { ...this.defaultSettings };
        }
        return { ...this.defaultSettings, ...parsed };
    }

    static saveSettings(settings) {
        const merged = { ...this.defaultSettings, ...settings };
        SafeStorage.setItem(this.storageKey, SafeJSON.stringify(merged));
        return merged;
    }

    static update(key, value) {
        const settings = this.getSettings();
        settings[key] = value;
        this.saveSettings(settings);
        return settings;
    }
}

// ============================================================
//  BankData: datos bancarios para transferencias.
//  Se almacenan bajo la clave namespaced 'pos_datos_bancarios'
//  y persisten en localStorage. Si no existen, se usan los
//  valores por defecto (Titular: Hector Estrada, Banco: BBVA,
//  Cuenta/CLABE: 4152 3144 8718 3546).
// ============================================================
class BankData {
    static get storageKey() { return Business.key('pos_datos_bancarios'); }

    static defaultData = {
        bank: 'BBVA',
        clabe: '4152 3144 8718 3546',
        holder: 'Hector Estrada'
    };

    static getBankData() {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) {
            return { ...this.defaultData };
        }
        const parsed = SafeJSON.parse(stored, null, 'pos_datos_bancarios');
        if (parsed === null || !DataValidator.validateBankData(parsed)) {
            return { ...this.defaultData };
        }
        return { ...this.defaultData, ...parsed };
    }

    static saveBankData(data) {
        const merged = {
            bank: (data.bank || this.defaultData.bank).toString(),
            clabe: (data.clabe || this.defaultData.clabe).toString(),
            holder: (data.holder || this.defaultData.holder).toString()
        };
        SafeStorage.setItem(this.storageKey, SafeJSON.stringify(merged));
        return merged;
    }
}

window.BankData = BankData;

class App {
    constructor() {
        this.cart = new Cart();
        this.activeSection = 'sales';
        this.isInitialized = false;
        this.receivedAmount = 0;
        this.paymentEventsBound = false;
        this.currentVipCustomer = null;
        this.pendingReward = null;
        this.vipHighlightedIndex = -1;
        this.vipPaymentHighlightedIndex = -1;
        this.dailySalesChartInstance = null;
    }

     init() {
        if (this.isInitialized) return;

        const migrationResult = Business.migrateExistingData();
        if (migrationResult.length > 0) {
            console.info('[App] Migración de aislamiento por device_id completada:',
                migrationResult.map(m => m.key + ' (' + m.from + ')').join(', '));
        }

        // Verificar integridad del localStorage antes de cargar datos.
        // Preserva datos corruptos y reporta el estado sin borrar nada.
        // También audita aislamiento por device_id: detecta claves que
        // no están namespaced con el device_id actual.
        const guardReport = StorageGuard.checkAll();
        if (guardReport.corrupt > 0) {
            console.warn('[App] Almacenamiento con datos corruptos o esquema inesperado:', guardReport);
        }
        if (guardReport.suspiciousKeys && guardReport.suspiciousKeys.length > 0) {
            console.warn('[App] Claves detectadas sin aislamiento por device_id (se migrarán al reiniciar):', guardReport.suspiciousKeys);
        }

        // Instantánea de seguridad: si algo falla durante la reparación,
        // los datos originales pueden ser restaurados vía StorageGuard.restoreSnapshot().
        StorageGuard.createSnapshot();

        SaleService.repairDuplicateIds();
        // Migrar ventas existentes al historial maestro (idempotente)
        SaleService.migrateToHistorical();

        Inventory.init();
        Auth.init();

        this._initChartDefaults();

        this.bindLoginEvents();
        this.bindNavigationEvents();
        this.bindSalesEvents();
        this.bindInventoryEvents();
        this.bindReportsEvents();
        this.populateYearSelector();
        this.bindReportsAccessModal();
        this.bindSettingsEvents();
        this.bindRecoveryEvents();
        this.bindLicenseEvents();
        this.bindCashEvents();
        this.bindSummaryEvents();
        this.bindPosEvents();
        this.bindPauseEvents();
        this.bindHeldSalesEvents();
        this.bindReturnsEvents();
        this.bindGuaranteeEvents();
        this.bindWithdrawalEvents();
        this.bindPaymentEvents();
        this.bindVIPEvents();
        this.bindCrossTabSync();
        this.bindBackupEvents();

        this.initApp();

        this.isInitialized = true;
    }

    // ============================================================
    //  FUNCION DE CARGA AL INICIAR (onload / DOMContentLoaded)
    //  Verifica si existen las claves de almacenamiento y, en caso
    //  afirmativo, carga los datos existentes en la interfaz en lugar
    //  de reiniciar las variables a valores vacíos.
    //  Claves verificadas (aisladas por device_id):
    //    - jewelry_deluna_business_name (nombre del negocio)
    //    - pos_inventory__biz_default__dev_<deviceId>  (inventario)
    //    - pos_sales__biz_default__dev_<deviceId>      (ventas)
    //    - pos_settings__biz_default__dev_<deviceId>   (configuración)
    //    - pos_current_user__biz_default__dev_<deviceId> (usuario autenticado)
    //    - pos_shift_session__biz_default__dev_<deviceId> (turno/caja abierta)
    // ============================================================
    loadFromStorage() {
        const storageStatus = {
            businessName: Business.hasBusinessName(),
            inventory: !!localStorage.getItem(Inventory.storageKey),
            sales: !!localStorage.getItem(SaleService.storageKey),
            settings: !!localStorage.getItem(Settings.storageKey),
            currentUser: !!localStorage.getItem(Auth.current_userKey),
            shiftOpen: Cut.isShiftOpen()
        };

        // Garantizar datos por defecto solo si faltan (guardado inmediato).
        // Si los datos ya existen, se preservan sin modificar.
        Business.initDefaults();
        Inventory.init();
        Settings.getSettings();

        return storageStatus;
    }

    // ============================================================
    //  INICIALIZACIÓN DE LA APLICACIÓN
    // ============================================================
    async initApp() {
        License.setExpiration(new Date('2027-12-31T23:59:59'));

        const now = new Date();

        if (License.isTampered()) {
            License.clearTamperFlag();
        }

        License.setLastUsage(now);

        this.hideLicenseOverlay();

        // --- Cargar datos existentes desde localStorage (onload) ---
        this.loadFromStorage();

        // --- Migración de aislamiento por device_id (idempotente) ---
        // Ya se ejecuta en el handler de DOMContentLoaded antes de loadFromStorage(),
        // pero se vuelve a invocar aquí como salvaguarda para garantizar que
        // datos legados del namespace anterior (__biz_default) se trasladen
        // al namespace con device_id (__biz_default__dev_<deviceId>).
        Business.migrateExistingData();

        // Mononegocio unificado: mostrar la pantalla apropiada según el estado de autenticación.
        if (Auth.isAuthenticated() && Cut.isShiftOpen()) {
            this.showApp();
        } else {
            this.showLogin();
        }

        // Inicializar procesos en segundo plano
        this.updateDailyReport();
        this.updateRoleVisibility();
        ReportService.startDayChangeWatcher();

        // Sistema de respaldos de doble capa: iniciar temporizador programado (cada 1 hora)
        try {
            if (typeof Backup !== 'undefined' && typeof Backup.startIntervalBackup === 'function') {
                Backup.startIntervalBackup();
            }
        } catch (err) {
            console.warn('[App] Error al iniciar el respaldo programado:', err?.message);
        }

        try {
            this.renderLocalRecoveryStatus();
        } catch (err) {
            console.warn('[App] Error al renderizar estado de respaldo:', err?.message);
        }

        // Inicializar EmailJS (solo inicializa el SDK; no envía nada automáticamente)
        if (Backup.isEmailJSSet()) {
            Backup.initEmailJS();
        }
    }

    showLicenseOverlay(type = 'expired') {
        document.getElementById('login-screen')?.classList.add('hidden');
        document.getElementById('pos-app')?.classList.add('hidden');
        document.getElementById('license-overlay')?.classList.remove('hidden');

        const message = document.getElementById('license-message');
        const tamperWarning = document.getElementById('tamper-warning');

        if (message) message.style.display = 'block';
        if (tamperWarning) tamperWarning.classList.add('hidden');

        if (type === 'tampered' && message) {
            message.style.display = 'none';
            if (tamperWarning) tamperWarning.classList.remove('hidden');
        }
    }

    hideLicenseOverlay() {
        document.getElementById('license-overlay')?.classList.add('hidden');
    }

    bindLicenseEvents() {
        const tokenForm = document.getElementById('token-form');
        if (tokenForm) {
            tokenForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const tokenInput = document.getElementById('reactivation-token');
                const token = tokenInput?.value.trim();
                if (!token) return;
                const submitBtn = tokenForm.querySelector('button[type="submit"]');
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Validando...';
                }
                try {
                    await this.validateReactivationToken(token);
                } catch (err) {
                    const errorEl = document.getElementById('token-error');
                    if (errorEl) errorEl.textContent = 'Error inesperado: ' + (err?.message || err);
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Activar Licencia';
                    }
                }
            });
        }

        const exportBtn = document.getElementById('export-backup-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                License.exportBackup();
            });
        }

        const importBtn = document.getElementById('import-backup-btn');
        const importFile = document.getElementById('import-file');
        if (importBtn && importFile) {
            importBtn.addEventListener('click', () => {
                importFile.click();
            });
            importFile.addEventListener('change', (e) => {
                this.restoreFromBackup(e.target.files[0]);
            });
        }
    }

    async validateReactivationToken(token) {
        const errorEl = document.getElementById('token-error');
        const successEl = document.getElementById('token-success');

        try {
            const result = License.reactivate(token);

            if (result.success) {
                if (successEl) successEl.textContent = result.message;
                if (errorEl) errorEl.textContent = '';

                setTimeout(() => {
                    this.hideLicenseOverlay();
                    const isAuthenticated = Auth.isAuthenticated();
                    if (isAuthenticated) {
                        this.showCashOpening();
                    } else {
                        this.showLogin();
                    }
                }, 2000);
            } else {
                if (errorEl) errorEl.textContent = result.error;
                if (successEl) successEl.textContent = '';
                setTimeout(() => {
                    if (errorEl) errorEl.textContent = '';
                }, 4000);
            }
        } catch (err) {
            if (errorEl) errorEl.textContent = 'Error inesperado: ' + (err?.message || err);
            if (successEl) successEl.textContent = '';
        }
    }

    restoreFromBackup(file) {
        if (!file) return;

        Backup.importFromFile(file, { factoryRestore: false })
            .then(result => {
                if (result.success) {
                    const msg = result.stats
                        ? 'Respalado importado. Agregadas: ' + result.stats.added + ', actualizadas: ' + result.stats.updated + ', sin cambios: ' + result.stats.unchanged + '.'
                        : (result.message || 'Respalado importado correctamente.');
                    Toast.success(msg + ' Recargue la página para aplicar los cambios.');
                } else {
                    Toast.error(result.error);
                }
            })
            .catch(err => {
                Toast.error(err.error || 'Error al leer el archivo: ' + err.message);
            });
    }

    // ============================================================
    //  SINCRONIZACIÓN ENTRE PESTAÑAS DEL MISMO DISPOSITIVO
    //  localStorage es compartido entre pestañas; el evento
    //  'storage' avisa a las demás cuando una de ellas guarda.
    // ============================================================
    bindCrossTabSync() {
        window.addEventListener('storage', (e) => {
            if (!e.key) return;

            // Caja cerrada o sesión terminada en otra pestaña
            if ((e.key === Cut.storageKey || e.key === Auth.current_userKey) && e.newValue === null) {
                this.handleShiftClosedExternally();
                return;
            }

            const dataKeys = [
                SaleService.storageKey,
                Inventory.storageKey,
                Returns.storageKey,
                CashAdjustment.storageKey,
                GuaranteeExchange.storageKey,
                HeldSales.storageKey,
                VIPCustomer.storageKey,
                VIPConfig.storageKey
            ];
            if (dataKeys.includes(e.key)) {
                try {
                    this.updateDailyReport();
                    this.updateHeldSalesButton();
                    if (this.activeSection === 'inventory') Inventory.renderCatalog();
                    if (this.activeSection === 'vip') this.renderVIPTable();
                } catch { /* UI aún no lista */ }
            }
        });
    }

    // ============================================================
    //  Eventos de respaldo de doble capa (Configuración, solo admin)
    // ============================================================
    bindBackupEvents() {
        const guard = () => {
            if (!Auth.canAccessConfig()) {
                Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                return false;
            }
            return true;
        };
        document.getElementById('local-recovery-restore-btn')?.addEventListener('click', () => {
            if (guard()) this.restoreFromAnyBackup();
        });
        document.getElementById('interval-backup-now-btn')?.addEventListener('click', async () => {
            if (!guard()) return;
            const intervalBackupNowBtn = document.getElementById('interval-backup-now-btn');
            const original = intervalBackupNowBtn?.textContent;
            if (intervalBackupNowBtn) {
                intervalBackupNowBtn.disabled = true;
                intervalBackupNowBtn.textContent = 'Guardando...';
            }
            try {
                if (typeof Backup !== 'undefined' && typeof Backup.runScheduledBackup === 'function') {
                    await Backup.runScheduledBackup();
                }
            } catch (err) {
                console.warn('[App] Error en respaldo programado manual:', err?.message);
            }
            this.renderLocalRecoveryStatus();
            if (intervalBackupNowBtn) {
                intervalBackupNowBtn.disabled = false;
                intervalBackupNowBtn.textContent = original;
            }
            Toast.success('Respaldo programado ejecutado correctamente');
        });
        // Disponible sin iniciar sesión: tras perder la información no hay turno
        // abierto. Solo FUSIONA datos del respaldo, nunca borra.
        document.getElementById('login-restore-btn')?.addEventListener('click', () => {
            this.restoreFromAnyBackup();
        });
        this.renderLocalRecoveryStatus();
    }

    // Restaurar desde el snapshot local de recuperación (capa 1).
    // Nunca borra datos locales: siempre fusiona por folio/ID.
    restoreFromAnyBackup() {
        const localInfo = (typeof Backup !== 'undefined' && typeof Backup.getLocalRecoveryInfo === 'function')
            ? Backup.getLocalRecoveryInfo()
            : null;
        if (localInfo) {
            const savedAt = new Date(localInfo.savedAt).toLocaleString('es-MX');
            if (confirm(`¿Restaurar desde el respaldo local de recuperación?\nÚltimo guardado: ${savedAt} (${localInfo.reason || 'manual'}).\n\nSe fusionarán los datos sin borrar lo actual.`)) {
                const result = (typeof Backup !== 'undefined' && typeof Backup.restoreLocalRecovery === 'function')
                    ? Backup.restoreLocalRecovery()
                    : { success: false, error: 'Módulo de respaldo no disponible' };
                if (result.success) {
                    Toast.success(result.message + ' Recargue la página para aplicar los cambios.');
                } else {
                    Toast.error(result.error);
                }
            }
            return;
        }

        Toast.info('No hay respaldo disponible para restaurar.');
    }

    // Actualizar el estado visible del respaldo de doble capa en la
    // interfaz de Configuración (capa local + programada).
    renderLocalRecoveryStatus() {
        const statusEl = document.getElementById('local-recovery-status');
        if (!statusEl) return;

        const localInfo = (typeof Backup !== 'undefined' && typeof Backup.getLocalRecoveryInfo === 'function')
            ? Backup.getLocalRecoveryInfo()
            : null;
        const intervalInfo = (typeof Backup !== 'undefined' && typeof Backup.getIntervalBackupInfo === 'function')
            ? Backup.getIntervalBackupInfo()
            : null;

        const localText = localInfo
            ? `Último snapshot local: ${new Date(localInfo.savedAt).toLocaleString('es-MX')} (${localInfo.reason || 'manual'}).`
            : 'No hay snapshot local de recuperación disponible.';

        const intervalText = !intervalInfo || !intervalInfo.lastRun
            ? 'Programado (cada 1 hora): pendiente de ejecución.'
            : `Programado (cada 1 hora): último ${new Date(intervalInfo.lastRun).toLocaleString('es-MX')}, próximo ${new Date(intervalInfo.nextRun).toLocaleString('es-MX')}.`;

        statusEl.textContent = `${localText} ${intervalText}`;
    }

    // Mostrar / ocultar la pista de recuperación local en la pantalla
    // de login. Solo aparece cuando hay un snapshot de recuperación
    // disponible (capa 1 del respaldo de doble capa).
    renderLoginRecoveryHint() {
        const hintEl = document.getElementById('login-local-recovery-hint');
        if (!hintEl) return;
        const localInfo = (typeof Backup !== 'undefined' && typeof Backup.getLocalRecoveryInfo === 'function')
            ? Backup.getLocalRecoveryInfo()
            : null;
        if (localInfo) {
            const savedAt = new Date(localInfo.savedAt).toLocaleString('es-MX');
            hintEl.textContent = `Respaldo local disponible del ${savedAt} (${localInfo.reason || 'automático'}). Use "Restaurar respaldo".`;
            hintEl.classList.remove('hidden');
        } else {
            hintEl.classList.add('hidden');
        }
    }

    // La caja se cerró (o se cerró sesión) desde otra pestaña:
    // regresar al login para no registrar ventas fuera de turno.
    handleShiftClosedExternally() {
        const posApp = document.getElementById('pos-app');
        if (!posApp || posApp.classList.contains('hidden')) return;
        const summaryOverlay = document.getElementById('cash-summary-overlay');
        if (summaryOverlay && !summaryOverlay.classList.contains('hidden')) return;

        this.hidePaymentModal();
        Toast.warning('La caja se cerró en otra pestaña. Inicie sesión y abra un turno nuevo.', 6000);
        this.showLogin();
    }

    showLogin() {
        document.getElementById('login-screen')?.classList.remove('hidden');
        document.getElementById('pos-app')?.classList.add('hidden');
        const roleSelection = document.getElementById('role-selection');
        const formsWrapper = document.getElementById('login-forms-wrapper');
        if (roleSelection) roleSelection.classList.remove('hidden');
        if (formsWrapper) formsWrapper.classList.add('hidden');
        document.querySelectorAll('[data-login-form]').forEach(form => form.classList.add('hidden'));
        document.querySelectorAll('.login-error').forEach(el => { el.textContent = ''; });
        this.renderLoginRecoveryHint();
    }

    showApp() {
        document.getElementById('login-screen')?.classList.add('hidden');
        document.getElementById('pos-app')?.classList.remove('hidden');
        const userNameEl = document.getElementById('user-name');
        const currentUserLabel = document.getElementById('current-user');
        if (userNameEl) {
            userNameEl.textContent = Auth.getCurrentUser()?.name || '';
        }
        if (currentUserLabel) {
            const role = Auth.getRole();
            currentUserLabel.innerHTML = role === 'admin'
                ? `Admin: <span id="user-name"></span>`
                : `Cajero: <span id="user-name"></span>`;
            const nameSpan = currentUserLabel.querySelector('#user-name');
            if (nameSpan) nameSpan.textContent = Auth.getCurrentUser()?.name || '';
        }
        this.updateRoleVisibility();
        this.cart.render();
        this.cart.updateTotals();
        this.updateHeldSalesButton();
        this.bindVolumePricingEvents();
        this.renderStoreSettings();
        this.updateLowStockIndicator();
        this.renderDailyConsolidated();
        this.updateRoleVisibility();
    }

     updateRoleVisibility() {
        const isAdmin = Auth.isAdmin();
        const isGuest = Auth.isGuest();
        const adminOnlyEls = document.querySelectorAll('.admin-only');
        const guestOnlyEls = document.querySelectorAll('.guest-only');

        // admin-only: visibles solo para administradores
        adminOnlyEls.forEach(el => {
            el.classList.toggle('hidden', !isAdmin);
        });

        // guest-only: visibles solo para el perfil Invitado
        guestOnlyEls.forEach(el => {
            el.classList.toggle('hidden', !isGuest);
        });

        // guest-allowed: visibles para todos (admin y cajero)
        document.querySelectorAll('.guest-allowed').forEach(el => {
            el.classList.remove('hidden');
        });
    }

    bindLoginEvents() {
        const adminForm = document.getElementById('admin-login-form');
        if (adminForm) {
            adminForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const username = e.target.username.value;
                const password = e.target.password.value;
                const result = Auth.login(username, password);

                const errorEl = document.getElementById('login-error');
                if (result.success) {
                    this.showCashOpening();
                } else {
                    if (errorEl) errorEl.textContent = result.error;
                    setTimeout(() => {
                        if (errorEl) errorEl.textContent = '';
                    }, 3000);
                }
            });
        }

        const guestForm = document.getElementById('guest-login-form');
        if (guestForm) {
            guestForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const key = e.target['guest-key'].value;
                const result = Auth.loginGuestWithKey(key);
                const errorEl = document.getElementById('guest-login-error');
                if (result.success) {
                    this.showCashOpening();
                } else {
                    if (errorEl) errorEl.textContent = result.error;
                    setTimeout(() => {
                        if (errorEl) errorEl.textContent = '';
                    }, 3000);
                }
            });
        }

        const guestDirectBtn = document.getElementById('guest-direct-btn');
        if (guestDirectBtn) {
            guestDirectBtn.addEventListener('click', () => {
                const result = Auth.loginGuest();
                if (result.success) {
                    this.showCashOpening();
                }
            });
        }

        const roleCards = document.querySelectorAll('.role-card');
        const roleSelection = document.getElementById('role-selection');
        const formsWrapper = document.getElementById('login-forms-wrapper');
        const backToRolesBtn = document.getElementById('back-to-roles');

        roleCards.forEach(card => {
            card.addEventListener('click', () => {
                const role = card.dataset.role;
                roleSelection?.classList.add('hidden');
                formsWrapper?.classList.remove('hidden');
                document.querySelectorAll('[data-login-form]').forEach(form => {
                    form.classList.add('hidden');
                });
                const targetForm = document.querySelector(`[data-login-form="${role}"]`);
                if (targetForm) targetForm.classList.remove('hidden');
            });
        });

        backToRolesBtn?.addEventListener('click', () => {
            formsWrapper?.classList.add('hidden');
            roleSelection?.classList.remove('hidden');
            document.querySelectorAll('[data-login-form]').forEach(form => {
                form.classList.add('hidden');
            });
        });

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                Auth.logout();
                this.showLogin();
            });
        }
    }

    bindCashEvents() {
        const confirmOpenBtn = document.getElementById('confirm-cash-open');
        if (confirmOpenBtn) {
            confirmOpenBtn.addEventListener('click', () => {
                this.openCashDrawer();
            });
        }

        const cancelOpenBtn = document.getElementById('cancel-cash-open');
        if (cancelOpenBtn) {
            cancelOpenBtn.addEventListener('click', () => {
                Auth.logout();
                this.showLogin();
            });
        }

        const cashDrawerBtn = document.getElementById('cash-drawer-btn');
        if (cashDrawerBtn) {
            cashDrawerBtn.addEventListener('click', () => {
                if (!Auth.canAccessCashDrawer()) {
                    Toast.warning('Permiso denegado: El cierre de caja requiere privilegios de administrador');
                    return;
                }
                this.showCloseConfirmation();
            });
        }

        // Cierre de Caja simplificado para el perfil Invitado.
        // Muestra solo el total de piezas vendidas (sin totales monetarios ni ganancias).
        const cashCloseBtn = document.getElementById('cash-close-btn');
        if (cashCloseBtn) {
            cashCloseBtn.addEventListener('click', () => {
                this.showCloseConfirmation();
            });
        }

        const confirmCloseBtn = document.getElementById('confirm-close-cash');
        if (confirmCloseBtn) {
            confirmCloseBtn.addEventListener('click', () => {
                this.closeCashDrawer();
            });
        }

        const cancelCloseBtn = document.getElementById('cancel-close-cash');
        if (cancelCloseBtn) {
            cancelCloseBtn.addEventListener('click', () => {
                this.hideCloseConfirmation();
            });
        }
    }

    showCashOpening() {
        // Ocultar el login screen (ya se autenticó el usuario)
        document.getElementById('login-screen')?.classList.add('hidden');

        // Si ya hay una sesión abierta, saltar directamente al POS
        if (Cut.isShiftOpen()) {
            this.showApp();
            this.cart.render();
            this.cart.updateTotals();
            this.updateRoleVisibility();
            this.renderStoreSettings();
            return;
        }

        const userLabel = document.getElementById('cash-open-user');
        if (userLabel) {
            userLabel.textContent = `Bienvenido, ${Auth.getCurrentUser()?.name}`;
        }

        const overlay = document.getElementById('cash-open-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }

        const initialAmountInput = document.getElementById('initial-amount');
        if (initialAmountInput) {
            initialAmountInput.value = '';
            initialAmountInput.focus();
        }
    }

    openCashDrawer() {
        const amountInput = document.getElementById('initial-amount');
        const amount = parseFloat(amountInput?.value);

        if (isNaN(amount) || amount < 0) {
            Toast.error('Ingresa un monto inicial válido');
            return;
        }

        Auth.setDrawerInitial(amount);
        Cut.openSession(amount, Auth.getCurrentUser());

        const overlay = document.getElementById('cash-open-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }

        // Ahora sí mostrar el POS app
        this.showApp();
        this.cart.render();
        this.cart.updateTotals();
        this.updateRoleVisibility();
        this.renderStoreSettings();
    }

    hideCloseConfirmation() {
        const overlay = document.getElementById('cash-close-confirmation');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    showCloseConfirmation() {
        const overlay = document.getElementById('cash-close-confirmation');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    }

    async closeCashDrawer() {
        this.hideCloseConfirmation();

        // Cerrar la sesión de caja y generar reporte de corte por turno
        const session = Cut.closeSession();
        const report = (session && session.report) ? session.report : Backup.generateDailyReport();
        this.currentReport = report;

        // Generar y descargar el archivo JSON de respaldo (respaldo_pos_[FECHA].json)
        // con el estado completo del sistema: historial maestro de ventas,
        // cortes anteriores, catálogo e inventario, y movimientos de caja.
        try {
            const downloadResult = Backup.downloadCutBackup(report);
            if (downloadResult.success) {
                Toast.success(downloadResult.message, 5000);
            }
        } catch (err) {
            console.warn('[App] No se pudo generar el respaldo JSON de corte:', err?.message);
        }

        // Guardar copia en localStorage (historial interno)
        Backup.saveReportToHistory(report);
        Backup.createLocalRecovery('corte');

        // Notificar corte de caja por Telegram (en segundo plano, sin
        // interrumpir el proceso de cierre ni guardado en localStorage).
        if (typeof TelegramNotify !== 'undefined') {
            TelegramNotify.notificarCorte(report);
        }

        // Mostrar el resumen en pantalla
        this.showCashSummary(report);

        // Limpiar el fondo inicial
        Auth.clearDrawerInitial();

        // Mostrar el reporte en pantalla y notificar al usuario.
        // El envío de correo es EXCLUSIVAMENTE manual: el usuario debe
        // presionar el botón "Enviar Registro al Correo" para que se
        // envíe el reporte y respaldo. Nunca se envía automáticamente.
        Toast.info('Corte de caja completado. Presione "Enviar Registro al Correo" para enviar el reporte y respaldo por email.', 6000);
    }

    // Enviar reporte de corte por correo (admin o invitado)
    async sendCutReportEmail() {
        if (!this.currentReport) return;
        const sendEmailBtn = document.getElementById('send-email-btn');
        if (sendEmailBtn) {
            sendEmailBtn.disabled = true;
            sendEmailBtn.textContent = 'Enviando...';
        }
        try {
            let result;
            if (Auth.isGuest()) {
                result = await Backup.sendGuestSessionEmail(this.currentReport);
            } else {
                result = await Backup.sendReportEmail(this.currentReport);
            }
            Toast.info(result.message || 'Reporte enviado al correo del administrador.');
        } catch (err) {
            Toast.error('Error al enviar el correo: ' + (err?.message || err));
        } finally {
            if (sendEmailBtn) {
                sendEmailBtn.disabled = false;
                sendEmailBtn.textContent = 'Enviar Registro al Correo';
            }
        }
    }

    showCashSummary(report) {
        const isAdmin = Auth.isAdmin();

        const summaryEl = document.getElementById('cash-summary-content');
        if (summaryEl) {
            if (isAdmin) {
                // --- Administrador: resumen financiero completo ---
                let profitRows = '';
                if (report.profit !== undefined) {
                    profitRows = `
                        <div class="summary-row">
                            <span class="summary-label">Ganancia Neta</span>
                            <span class="summary-value gold">$${report.profit.toFixed(2)}</span>
                        </div>
                        <div class="summary-row">
                            <span class="summary-label">Margen</span>
                            <span class="summary-value gold">${report.margin}%</span>
                        </div>
                    `;
                }

                const openTime = report.formattedOpenTime || '';
                const closeTime = report.formattedCloseTime || '';

                 summaryEl.innerHTML = `
                     <div class="session-timestamps">
                         <div class="session-time-row">
                             <span class="summary-label">Apertura:</span>
                             <span class="summary-value">${openTime}</span>
                         </div>
                         <div class="session-time-row">
                             <span class="summary-label">Cierre:</span>
                             <span class="summary-value">${closeTime}</span>
                         </div>
                     </div>
                     <div class="summary-row">
                         <span class="summary-label">Monto Inicial</span>
                         <span class="summary-value">$${report.initialAmount.toFixed(2)}</span>
                     </div>
                     <div class="summary-row">
                         <span class="summary-label">Total Ventas</span>
                         <span class="summary-value">$${report.totalSales.toFixed(2)}</span>
                     </div>
                     <div class="summary-row">
                         <span class="summary-label">Efectivo</span>
                         <span class="summary-value">$${report.cashSales.toFixed(2)}</span>
                     </div>
                      <div class="summary-row">
                          <span class="summary-label">Tarjeta</span>
                          <span class="summary-value">$${report.cardSales.toFixed(2)}</span>
                      </div>
                      ${report.transferTotal ? `
                      <div class="summary-row">
                          <span class="summary-label">Transferencia</span>
                          <span class="summary-value">$${report.transferTotal.toFixed(2)}</span>
                      </div>
                      ` : ''}
                      ${report.adjustmentCount > 0 ? `
                      <div class="summary-row">
                          <span class="summary-label">Devoluciones / Anulaciones / Retiros</span>
                          <span class="summary-value" style="color: var(--danger);">-${Math.abs(report.totalAdjustments).toFixed(2)}</span>
                      </div>
                      ` : ''}
                     <div class="summary-row">
                         <span class="summary-label">Transacciones</span>
                         <span class="summary-value">${report.transactionCount}</span>
                     </div>
                     <div class="summary-row">
                         <span class="summary-label">Ventas en Sesión</span>
                         <span class="summary-value">${report.salesInSession !== undefined ? report.salesInSession : report.transactionCount}</span>
                     </div>
                     <div class="summary-row total">
                         <span class="summary-label">Caja Final</span>
                         <span class="summary-value gold">$${report.closingAmount.toFixed(2)}</span>
                     </div>
                     ${profitRows}
                 `;
            } else {
                // --- Invitado / Cajero: vista restringida ---
                // No se muestra dinero, ganancias ni montos totales.
                // Únicamente el total de piezas vendidas en el turno/sesión.
                const piecesSold = report.piecesSold !== undefined
                    ? report.piecesSold
                    : (report.salesInSession || report.transactionCount || 0);

                summaryEl.innerHTML = `
                    <div class="summary-row guest-pieces-sold">
                        <span class="summary-label">Piezas Vendidas</span>
                        <span class="summary-value gold">${piecesSold}</span>
                    </div>
                `;
            }
        }

        // Mostrar botones de acción (visibles para todos; el comportamiento es role-aware)
        const summaryActions = document.querySelector('.summary-actions');
        if (summaryActions) {
            summaryActions.classList.remove('hidden');
        }

        const summaryOverlay = document.getElementById('cash-summary-overlay');
        if (summaryOverlay) {
            summaryOverlay.classList.remove('hidden');
        }

        this.updateRoleVisibility();
    }

    bindSummaryEvents() {
        const printCutBtn = document.getElementById('print-cut-btn');
        if (printCutBtn) {
            printCutBtn.addEventListener('click', () => {
                // Usar el reporte de la sesión/turno recién cerrado
                const report = this.currentReport || Cut.generateCutReport();
                if (Auth.isGuest()) {
                    // Invitado: ticket simplificado (solo piezas vendidas)
                    Print.printGuestClosure(report);
                } else {
                    // Administrador: corte financiero completo
                    Print.printCutReport(report);
                }
            });
        }

        const sendEmailBtn = document.getElementById('send-email-btn');
        if (sendEmailBtn) {
            sendEmailBtn.addEventListener('click', async () => {
                await this.sendCutReportEmail();
            });
        }

        const downloadBtn = document.getElementById('download-local-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                if (this.currentReport) {
                    if (Auth.isGuest()) {
                        // Invitado: registro de sesión simplificado (solo piezas vendidas)
                        Backup.exportGuestSession(this.currentReport);
                    } else {
                        // Administrador: reporte completo + respaldo JSON (respaldo_pos_[FECHA].json)
                        Backup.exportReportFile(this.currentReport);
                        Backup.downloadCutBackup(this.currentReport);
                    }
                }
            });
        }

        const closeSummaryBtn = document.getElementById('close-summary-btn');
        if (closeSummaryBtn) {
            closeSummaryBtn.addEventListener('click', () => {
                // Ocultar todos los overlays de efectivo visibles
                const summaryOverlay = document.getElementById('cash-summary-overlay');
                if (summaryOverlay) summaryOverlay.classList.add('hidden');
                const openOverlay = document.getElementById('cash-open-overlay');
                if (openOverlay) openOverlay.classList.add('hidden');
                const closeOverlay = document.getElementById('cash-close-confirmation');
                if (closeOverlay) closeOverlay.classList.add('hidden');

                // Limpiar carrito, cerrar sesión y redirigir al login
                this.cart.clear();
                Auth.logout();
                this.showLogin();
            });
        }
    }

    formatCloseReportHTML(report) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Cierre de Caja - ${report.store || Business.getStoreName()}</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; color: #000; }
                    h1 { color: #d4af37; }
                    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background: #f5f5f5; }
                    .total-row { font-weight: bold; }
                </style>
            </head>
            <body>
                <h1>Cierre de Caja - ${report.store || Business.getStoreName()}</h1>
                <p><strong>Fecha:</strong> ${report.date}</p>
                <p><strong>Cajero:</strong> ${report.cashier || report.closedBy || 'Desconocido'}</p>
                ${report.formattedOpenTime ? `<p><strong>Hora de Apertura:</strong> ${report.formattedOpenTime}</p>` : ''}
                ${report.formattedCloseTime ? `<p><strong>Hora de Cierre:</strong> ${report.formattedCloseTime}</p>` : ''}
                <h3>Resumen</h3>
                <table>
                    <tr><th>Concepto</th><th>Valor</th></tr>
                     <tr><td>Monto Inicial</td><td>$${report.initialAmount.toFixed(2)}</td></tr>
                     <tr><td>Total Ventas</td><td>$${report.totalSales.toFixed(2)}</td></tr>
                     <tr><td>Efectivo</td><td>$${report.cashSales.toFixed(2)}</td></tr>
                     <tr><td>Tarjeta</td><td>$${report.cardSales.toFixed(2)}</td></tr>
                     <tr><td>Transacciones</td><td>${report.transactionCount}</td></tr>
                     ${report.salesInSession !== undefined ? `<tr><td>Ventas en Sesión</td><td>${report.salesInSession}</td></tr>` : ''}
                      ${report.adjustmentCount > 0 ? `<tr><td>Devoluciones / Anulaciones / Retiros</td><td style="color:#e74c3c;">-${Math.abs(report.totalAdjustments || 0).toFixed(2)}</td></tr>` : ''}
                     <tr class="total-row"><td>Caja Final</td><td>$${report.closingAmount.toFixed(2)}</td></tr>
                    ${report.profit !== undefined ? `<tr class="total-row"><td>Ganancia Neta</td><td>$${report.profit.toFixed(2)}</td></tr>` : ''}
                    ${report.margin !== undefined ? `<tr class="total-row"><td>Margen</td><td>${report.margin}%</td></tr>` : ''}
                </table>
            </body>
            </html>
        `;
    }

    bindRecoveryEvents() {
        const forgotBtn = document.getElementById('forgot-password-btn');
        const modal = document.getElementById('recovery-modal');
        const cancelBtn = document.getElementById('cancel-recovery');

        if (forgotBtn && modal) {
            forgotBtn.addEventListener('click', () => {
                modal.classList.remove('hidden');
            });
        }

        if (cancelBtn && modal) {
            cancelBtn.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        }
    }

    bindNavigationEvents() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.dataset.section;

                // Guest accessing Reports: require admin password
                if (section === 'reports' && Auth.isGuest()) {
                    this.showReportsPasswordModal();
                    return;
                }

                navItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this.switchSection(section);
            });
        });

        const backupBtn = document.getElementById('backup-btn');
        if (backupBtn) {
            backupBtn.addEventListener('click', () => {
                if (!Auth.canAccessConfig()) {
                    Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                Backup.createBackup();
            });
        }
    }

    switchSection(sectionId) {
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        const target = document.getElementById(`${sectionId}-section`);
        if (target) {
            target.classList.add('active');
        }
        this.activeSection = sectionId;

        if (sectionId === 'inventory') {
            Inventory.renderCatalog();
        }
        if (sectionId === 'reports') {
            this.updateDailyReport();
            this.renderDailyConsolidated();
            this.updateRoleVisibility();
        }
        if (sectionId === 'vip') {
            this.renderVIPTable();
        }
        if (sectionId === 'sales') {
            BarcodeScanner.focusInput();
        }
        if (sectionId === 'settings') {
            this.renderStoreSettings();
        }
    }

    bindSalesEvents() {
        const barcodeInput = document.getElementById('barcode-input');
        if (barcodeInput) {
            barcodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleBarcodeScan();
                }
            });
        }

        const addProductBtn = document.getElementById('add-product-btn');
        if (addProductBtn) {
            addProductBtn.addEventListener('click', () => {
                barcodeInput?.focus();
            });
        }

        const clearCartBtn = document.getElementById('clear-cart-btn');
        if (clearCartBtn) {
            clearCartBtn.addEventListener('click', () => {
                if (this.cart.isEmpty() && !this.currentVipCustomer) return;
                if (confirm('¿Estás seguro de limpiar la venta?')) {
                    this.cart.clear();
                    this.clearVipSalesSelection();
                    this.dismissRewardAlert();
                    BarcodeScanner.focusInput();
                }
            });
        }

        const checkoutBtn = document.getElementById('checkout-btn');
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => {
                this.processCheckout();
            });
        }

        const reprintLastBtn = document.getElementById('reprint-last-btn');
        if (reprintLastBtn) {
            reprintLastBtn.addEventListener('click', () => {
                this.reprintLastTicket();
            });
        }

        // --- Buscador / picker de Cliente VIP en Caja ---
        this.bindVipSalesEvents();
    }

    // --- Ingreso de productos dual ---
    // barcodeValue: código escaneado (opcional, viene del escáner global)
    // Si no se pasa, lee del campo #barcode-input (enter en teclado)
    handleBarcodeScan(barcodeValue) {
        const barcodeInput = document.getElementById('barcode-input');
        let barcode = barcodeValue;

        // Si no viene del escáner global, leer del campo de texto
        if (!barcode) {
            barcode = barcodeInput?.value.trim();
        }

        if (!barcode) return;

        // Buscar producto por código de barras exacto
        const product = Inventory.findByBarcode(barcode);

        if (product) {
            if (this.cart.canAddItem(product.barcode)) {
                this.cart.addItem(product);
            } else {
                Toast.warning('No hay suficiente stock disponible');
            }
        } else {
            // Si no se encuentra por barcode, buscar por descripción
            const found = Inventory.search(barcode);
            if (found.length === 1) {
                const p = found[0];
                // El stock 0 sólo impide agregar al carrito de ventas.
                if (this.cart.canAddItem(p.barcode)) {
                    this.cart.addItem(p);
                } else {
                    Toast.warning('No hay suficiente stock disponible');
                }
            } else if (found.length > 1) {
                // Múltiples resultados: sugerir usar el código de barras exacto
                Toast.warning(`Se encontraron ${found.length} productos. Usa el código de barras para seleccionar.`);
            } else {
                Toast.warning('Producto no encontrado');
            }
        }

        // Limpiar campo y mantener foco para el siguiente escaneo
        if (barcodeInput) {
            barcodeInput.value = '';
            barcodeInput.focus();
        }
    }

    processCheckout() {
        // Validar que el carrito no esté vacío antes de mostrar el pago
        if (this.cart.isEmpty()) {
            Toast.warning('No hay productos en la venta');
            return;
        }
        this.showPaymentModal();
    }

    // --- Módulo de Pago y Calculadora de Cambio ---
    // Muestra el modal de pago con opciones: Efectivo, Tarjeta, Pago Mixto.
    // El modal está definido en el HTML (id="payment-modal-overlay") y se muestra
    // dinámicamente para evitar crear múltiples overlays en el DOM.
    showPaymentModal() {
        // Actualizar monto total a pagar (neto, sin IVA)
        const total = this.cart.getTotal();
        this.currentPaymentTotal = total;

        const totalEl = document.getElementById('payment-total');
        const cardTotalEl = document.getElementById('card-total-display');
        if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
        if (cardTotalEl) cardTotalEl.textContent = `$${total.toFixed(2)}`;

        // Reiniciar estado del calculator de cambio
        this.receivedAmount = 0;
        this.updateCashDisplay(total);

        // Reiniciar inputs de pago mixto y validar
        const mixedCashInput = document.getElementById('mixed-cash-input');
        const mixedCardInput = document.getElementById('mixed-card-input');
        if (mixedCashInput) mixedCashInput.value = '';
        if (mixedCardInput) mixedCardInput.value = '';
        this.validateMixedPayment();

        // Ocultar dropdown de búsqueda VIP del modal de pago al abrir
        this.hideVipPaymentDropdown();

        // Limpiar selección de cliente VIP
        // (preserva la selección hecha en pantalla de Caja si la hay)
        const vipPhoneInput = document.getElementById('vip-phone-input');
        const vipInfoEl = document.getElementById('vip-info');
        if (this.currentVipCustomer) {
            // Mostrar el cliente VIP elegido en Caja dentro del módulo de pago
            const customer = VIPCustomer.findById(this.currentVipCustomer.id);
            if (customer) {
                this.currentVipCustomer = customer;
                if (vipPhoneInput) vipPhoneInput.value = customer.phone;
                this.renderVipPaymentInfo(customer);
            } else {
                // El cliente fue eliminado entre la selección y el pago: limpiar selección
                this.currentVipCustomer = null;
                if (vipPhoneInput) vipPhoneInput.value = '';
                if (vipInfoEl) {
                    vipInfoEl.classList.add('hidden');
                    vipInfoEl.innerHTML = '';
                }
            }
        } else {
            if (vipPhoneInput) vipPhoneInput.value = '';
            if (vipInfoEl) {
                vipInfoEl.classList.add('hidden');
                vipInfoEl.innerHTML = '';
            }
        }

        // Activar aviso de recompensa si el cliente VIP seleccionado es elegible
        this.checkAndShowVipReward(this.currentVipCustomer);

        // Mostrar sección de efectivo por defecto
        this.showPaymentSection('cash');

        // Mostrar overlay
        const overlay = document.getElementById('payment-modal-overlay');
        if (overlay) overlay.classList.remove('hidden');

        this.bindPaymentEvents();
    }

    // Validar pago mixto en tiempo real
    // Habilita la confirmación solo si la suma de efectivo + tarjeta >= total a pagar
    validateMixedPayment() {
        const total = this.currentPaymentTotal || this.cart.getTotal();
        const mixedCashInput = document.getElementById('mixed-cash-input');
        const mixedCardInput = document.getElementById('mixed-card-input');
        const mixedTotalEl = document.getElementById('mixed-total-display');
        const confirmMixedBtn = document.getElementById('confirm-mixed-btn');

        const cashAmount = parseFloat(mixedCashInput?.value) || 0;
        const cardAmount = parseFloat(mixedCardInput?.value) || 0;
        const sum = Math.round((cashAmount + cardAmount) * 100) / 100;

        if (mixedTotalEl) mixedTotalEl.textContent = `$${sum.toFixed(2)}`;

        const valid = sum >= total && cashAmount >= 0 && cardAmount >= 0 && sum > 0;
        if (confirmMixedBtn) confirmMixedBtn.disabled = !valid;
    }

    // Mostrar la sección de pago correspondiente al método seleccionado
    showPaymentSection(method) {
        document.querySelectorAll('.payment-section').forEach(section => {
            section.classList.add('hidden');
        });
        document.querySelectorAll('.payment-method-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        if (method === 'cash') {
            document.getElementById('cash-calculator-section')?.classList.remove('hidden');
            document.querySelector('.payment-method-btn[data-method="cash"]')?.classList.add('active');
        } else if (method === 'card') {
            document.getElementById('card-payment-section')?.classList.remove('hidden');
            document.querySelector('.payment-method-btn[data-method="card"]')?.classList.add('active');
        } else if (method === 'mixed') {
            document.getElementById('mixed-payment-section')?.classList.remove('hidden');
            document.querySelector('.payment-method-btn[data-method="mixed"]')?.classList.add('active');
        } else if (method === 'transfer') {
            document.getElementById('transfer-payment-section')?.classList.remove('hidden');
            document.querySelector('.payment-method-btn[data-method="transfer"]')?.classList.add('active');
            this.populateTransferData();
        }
    }

    // Poblar los datos bancarios de transferencia desde el almacenamiento persistente
    populateTransferData() {
        const total = this.cart.getTotal();
        const totalEl = document.getElementById('transfer-total-display');
        if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;

        const bankData = BankData.getBankData();
        const bankInput = document.getElementById('transfer-bank-input');
        const clabeInput = document.getElementById('transfer-clabe-input');
        const holderInput = document.getElementById('transfer-holder-input');

        if (bankInput) bankInput.value = bankData.bank || '';
        if (clabeInput) clabeInput.value = bankData.clabe || '';
        if (holderInput) holderInput.value = bankData.holder || '';

        const refInput = document.getElementById('transfer-reference-input');
        if (refInput) refInput.value = '';
    }

    // Vincular eventos del modal de pago
    bindPaymentEvents() {
        // Evitar duplicar listeners si el modal ya fue inicializado
        if (this.paymentEventsBound) return;
        this.paymentEventsBound = true;

        // Búsqueda de Cliente VIP con autocompletado en el modal de pago
        const vipPhoneInput = document.getElementById('vip-phone-input');
        const vipDropdown = document.getElementById('vip-payment-dropdown');
        if (vipPhoneInput) {
            let searchTimeout = null;
            vipPhoneInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                const query = vipPhoneInput.value.trim();
                if (query.length >= 1) {
                    searchTimeout = setTimeout(() => this.renderVipPaymentDropdown(query), 200);
                } else {
                    this.hideVipPaymentDropdown();
                }
            });

            vipPhoneInput.addEventListener('keydown', (e) => {
                const items = vipDropdown ? vipDropdown.querySelectorAll('.vip-dropdown-item') : [];
                if (items.length === 0) {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        this.hideVipPaymentDropdown();
                        vipPhoneInput.value = '';
                    }
                    if (e.key === 'Enter' && vipPhoneInput.value.trim()) {
                        e.preventDefault();
                        this.lookupVipCustomerByPhone(vipPhoneInput.value.trim());
                    }
                    return;
                }
                switch (e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        this.vipPaymentHighlightedIndex =
                            (this.vipPaymentHighlightedIndex + 1) % items.length;
                        this.scrollAndHighlightPaymentItem(items, this.vipPaymentHighlightedIndex);
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        this.vipPaymentHighlightedIndex =
                            this.vipPaymentHighlightedIndex <= 0
                                ? items.length - 1
                                : this.vipPaymentHighlightedIndex - 1;
                        this.scrollAndHighlightPaymentItem(items, this.vipPaymentHighlightedIndex);
                        break;
                    case 'Enter':
                        e.preventDefault();
                        if (this.vipPaymentHighlightedIndex >= 0 && this.vipPaymentHighlightedIndex < items.length) {
                            const id = items[this.vipPaymentHighlightedIndex].dataset.id;
                            const customer = VIPCustomer.findById(id);
                            if (customer) this.selectVipInPayment(customer);
                        } else if (vipPhoneInput && vipPhoneInput.value.trim()) {
                            this.hideVipPaymentDropdown();
                            this.lookupVipCustomerByPhone(vipPhoneInput.value.trim());
                        } else {
                            this.hideVipPaymentDropdown();
                        }
                        break;
                    case 'Escape':
                        e.preventDefault();
                        this.hideVipPaymentDropdown();
                        vipPhoneInput.value = '';
                        break;
                }
            });

            if (vipDropdown) {
                vipDropdown.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                });
                vipDropdown.addEventListener('mousemove', (e) => {
                    const item = e.target.closest('.vip-dropdown-item');
                    if (item) {
                        const idx = Array.prototype.indexOf.call(
                            vipDropdown.querySelectorAll('.vip-dropdown-item'),
                            item
                        );
                        if (idx !== this.vipPaymentHighlightedIndex) {
                            this.vipPaymentHighlightedIndex = idx;
                            this.scrollAndHighlightPaymentItem(
                                vipDropdown.querySelectorAll('.vip-dropdown-item'),
                                idx
                            );
                        }
                    }
                });
                vipDropdown.addEventListener('click', (e) => {
                    const item = e.target.closest('.vip-dropdown-item');
                    if (item) {
                        const customer = VIPCustomer.findById(item.dataset.id);
                        if (customer) this.selectVipInPayment(customer);
                    }
                });

                document.addEventListener('click', (e) => {
                    const phoneInput = document.getElementById('vip-phone-input');
                    if (!vipDropdown.contains(e.target) && e.target !== phoneInput) {
                        this.hideVipPaymentDropdown();
                    }
                });
            }
        }

        // Desvincular cliente VIP desde el módulo de pago
        const vipInfoEl = document.getElementById('vip-info');
        if (vipInfoEl) {
            vipInfoEl.addEventListener('click', (e) => {
                const unlinkBtn = e.target.closest('.vip-payment-unlink-btn');
                if (unlinkBtn) {
                    this.clearVipPaymentSelection();
                    Toast.info('Cliente VIP desvinculado de la venta');
                }
            });
        }

        // Botones de selección de método de pago
        document.querySelectorAll('.payment-method-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const method = btn.dataset.method;
                this.showPaymentSection(method);
                this.receivedAmount = 0;
                this.updateCashDisplay(this.cart.getTotal());
                // Al cambiar método, también validar pago mixto por si se vuelve atrás
                if (method === 'mixed') this.validateMixedPayment();
            });
        });

        // Generar botones de denominaciones (MXN)
        const denomGrid = document.getElementById('denomination-grid');
        if (denomGrid) {
            denomGrid.innerHTML = '';
            PaymentProcessor.denominations.forEach(denom => {
                const btn = document.createElement('button');
                btn.className = 'denomination-btn';
                btn.textContent = PaymentProcessor.formatDenomination(denom);
                btn.dataset.denomination = denom;
                btn.addEventListener('click', () => {
                    this.receivedAmount += parseInt(denom);
                    this.updateCashDisplay(this.cart.getTotal());
                });
                denomGrid.appendChild(btn);
             });
        }

        // Generar botones de denominaciones rápidas para Pago Mixto (MXN)
        // Billetes y monedas suman al campo de "Monto en Efectivo ($)".
        const mixedBillDenoms = [1000, 500, 200, 100, 50, 20];
        const mixedCoinDenoms = [20, 10, 5, 2, 1];

        const renderMixedDenoms = (grid, denoms) => {
            if (!grid) return;
            grid.innerHTML = '';
            denoms.forEach(denom => {
                const btn = document.createElement('button');
                btn.className = 'denomination-btn';
                btn.textContent = PaymentProcessor.formatDenomination(denom);
                btn.dataset.denomination = denom;
                btn.addEventListener('click', () => {
                    const input = document.getElementById('mixed-cash-input');
                    if (!input) return;
                    const current = parseFloat(input.value) || 0;
                    input.value = (Math.round((current + denom) * 100) / 100).toFixed(2);
                    this.validateMixedPayment();
                });
                grid.appendChild(btn);
            });
        };

        renderMixedDenoms(document.getElementById('mixed-denom-bills'), mixedBillDenoms);
        renderMixedDenoms(document.getElementById('mixed-denom-coins'), mixedCoinDenoms);
        
        // Botón Limpiar (reiniciar monto recibido)
        const clearBtn = document.getElementById('clear-received-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.receivedAmount = 0;
                this.updateCashDisplay(this.cart.getTotal());
            });
        }

        // Botón Efectivo Exacto (Recibido = Total, Cambio = $0.00, confirmar en un clic)
        const exactCashBtn = document.getElementById('exact-cash-btn');
        if (exactCashBtn) {
            exactCashBtn.addEventListener('click', () => {
                const total = this.cart.getTotal();
                this.receivedAmount = total;
                this.updateCashDisplay(total);
                const confirmBtn = document.getElementById('confirm-cash-btn');
                if (confirmBtn && !confirmBtn.disabled) {
                    confirmBtn.click();
                }
            });
        }

    // Confirmar pago en efectivo
        // Cambio = Monto Recibido - Total Venta
        const confirmCashBtn = document.getElementById('confirm-cash-btn');
        if (confirmCashBtn) {
            confirmCashBtn.addEventListener('click', () => {
                const total = this.cart.getTotal();
                const pd = PaymentProcessor.calculateChange(this.receivedAmount, total);
                if (pd.error) {
                    Toast.error(pd.error);
                    return;
                }
                this.completeCheckout({
                    method: 'cash',
                    amountReceived: this.receivedAmount,
                    change: pd.change,
                    receivedBreakdown: pd.breakdown
                });
            });
        }

        // Confirmar pago con tarjeta
        const confirmCardBtn = document.getElementById('confirm-card-btn');
        if (confirmCardBtn) {
            confirmCardBtn.addEventListener('click', () => {
                this.completeCheckout({ method: 'card' });
            });
        }

        // Inputs de pago mixto: captura de texto/números habilitada
        // Validar dinámicamente que la suma >= total antes de permitir confirmación
        const mixedCashInput = document.getElementById('mixed-cash-input');
        const mixedCardInput = document.getElementById('mixed-card-input');

        mixedCashInput?.addEventListener('input', () => this.validateMixedPayment());
        mixedCardInput?.addEventListener('input', () => this.validateMixedPayment());

        // Confirmar pago mixto
        const confirmMixedBtn = document.getElementById('confirm-mixed-btn');
        if (confirmMixedBtn) {
            confirmMixedBtn.addEventListener('click', () => {
                const total = this.cart.getTotal();
                const cashAmount = parseFloat(mixedCashInput?.value) || 0;
                const cardAmount = parseFloat(mixedCardInput?.value) || 0;
                // Cambio = (Efectivo + Tarjeta) - Total Venta (solo sobre el efectivo recibido)
                const receivedTotal = Math.round((cashAmount + cardAmount) * 100) / 100;
                if (receivedTotal < total) {
                    Toast.error('El monto ingresado es insuficiente');
                    return;
                }
                this.completeCheckout({
                    method: 'mixed',
                    cashAmount: cashAmount,
                    cardAmount: cardAmount,
                    amountReceived: receivedTotal,
                    change: Math.max(0, Math.round((receivedTotal - total) * 100) / 100)
                });
            });
        }

        // Botón Copiar Cuenta (Transferencia)
        const copyClabeBtn = document.getElementById('copy-clabe-btn');
        if (copyClabeBtn) {
            copyClabeBtn.addEventListener('click', () => {
                const clabeInput = document.getElementById('transfer-clabe-input');
                const clabe = clabeInput?.value.trim() || '';
                if (!clabe) {
                    Toast.warning('No hay cuenta para copiar');
                    return;
                }
                navigator.clipboard.writeText(clabe).then(() => {
                    Toast.success('Cuenta copiada al portapapeles');
                    copyClabeBtn.textContent = 'Copiada';
                    setTimeout(() => { copyClabeBtn.textContent = 'Copiar Cuenta'; }, 2000);
                }).catch(() => {
                    Toast.error('No se pudo copiar la cuenta');
                });
            });
        }

        // Boton Guardar Datos Bancarios (Transferencia)
        const saveBankDataBtn = document.getElementById('save-bank-data-btn');
        if (saveBankDataBtn) {
            saveBankDataBtn.addEventListener('click', () => {
                const bankInput = document.getElementById('transfer-bank-input');
                const clabeInput = document.getElementById('transfer-clabe-input');
                const holderInput = document.getElementById('transfer-holder-input');
                BankData.saveBankData({
                    bank: (bankInput?.value || '').trim(),
                    clabe: (clabeInput?.value || '').trim(),
                    holder: (holderInput?.value || '').trim()
                });
                Toast.success('Datos bancarios guardados correctamente');
            });
        }

        // Confirmar pago con transferencia
        const confirmTransferBtn = document.getElementById('confirm-transfer-btn');
        if (confirmTransferBtn) {
            confirmTransferBtn.addEventListener('click', () => {
                const bankInput = document.getElementById('transfer-bank-input');
                const clabeInput = document.getElementById('transfer-clabe-input');
                const holderInput = document.getElementById('transfer-holder-input');
                const refInput = document.getElementById('transfer-reference-input');
                const bank = (bankInput?.value || '').trim();
                const clabe = (clabeInput?.value || '').trim();
                const holder = (holderInput?.value || '').trim();
                const reference = (refInput?.value || '').trim();

                if (!bank || !clabe || !holder) {
                    Toast.warning('Complete todos los datos bancarios');
                    return;
                }

                BankData.saveBankData({ bank, clabe, holder });

                this.completeCheckout({
                    method: 'transfer',
                    transferBank: bank,
                    transferClabe: clabe,
                    transferHolder: holder,
                    transferReference: reference,
                    amountReceived: this.cart.getTotal(),
                    change: 0
                });
            });
        }

        // Cancelar
        const cancelBtn = document.getElementById('cancel-payment-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.hidePaymentModal();
            });
        }

        // Click fuera del modal para cerrar
        const overlay = document.getElementById('payment-modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.hidePaymentModal();
                }
            });
        }
    }

    // Actualizar la pantalla de la calculadora de cambio
    // Cambio = Monto Recibido - Total Venta (en tiempo real)
    updateCashDisplay(total) {
        const receivedEl = document.getElementById('received-amount-display');
        const changeEl = document.getElementById('change-amount-display');
        const confirmBtn = document.getElementById('confirm-cash-btn');

        if (receivedEl) receivedEl.textContent = `$${this.receivedAmount.toFixed(2)}`;

        const pd = PaymentProcessor.calculateChange(this.receivedAmount, total);
        if (changeEl) {
            changeEl.textContent = `$${pd.change.toFixed(2)}`;
            changeEl.className = 'calc-value ' + (this.receivedAmount >= total ? 'change-positive' : 'change-negative');
        }

        if (confirmBtn) {
            confirmBtn.disabled = this.receivedAmount < total;
        }
    }

    hidePaymentModal() {
        const overlay = document.getElementById('payment-modal-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    // --- Integración VIP en el módulo de pago ---

    // Resolver un cliente VIP a partir de una consulta (nombre o teléfono).
    // 1. Intenta coincidencia exacta de teléfono (escenario común: escribir el teléfono completo).
    // 2. Si falla, intenta búsqueda difusa por nombre o teléfono; si hay exactamente
    //    un resultado, lo devuelve para vinculación automática.
    resolveVipCustomer(query) {
        if (!query) return null;
        let customer = VIPCustomer.findByPhone(query);
        if (!customer) {
            const results = VIPCustomer.search(query);
            if (results.length === 1) {
                customer = results[0];
            }
        }
        return customer;
    }

    lookupVipCustomerByPhone(query) {
        const customer = this.resolveVipCustomer(query);
        if (customer) {
            this.selectVipInPayment(customer);
        } else {
            this.hideVipPaymentDropdown();
            Toast.warning('No se encontró cliente VIP');
        }
    }

    clearVipPaymentSelection() {
        const vipInfoEl = document.getElementById('vip-info');
        const vipPhoneInput = document.getElementById('vip-phone-input');
        if (vipInfoEl) {
            vipInfoEl.classList.add('hidden');
            vipInfoEl.innerHTML = '';
        }
        if (vipPhoneInput) vipPhoneInput.value = '';
        this.currentVipCustomer = null;
        this.vipPaymentHighlightedIndex = -1;
        this.updateVipSalesBadge();
        this.checkAndShowVipReward(null);
    }

    // Renderizar la tarjeta de información del cliente VIP seleccionado
    // en el módulo de pago, mostrando: Nombre, Teléfono, Piezas Acumuladas
    // y un botón para Desvincular / cambiar de cliente.
    renderVipPaymentInfo(customer) {
        const vipInfoEl = document.getElementById('vip-info');
        if (!vipInfoEl || !customer) return false;

        const status = VIPCustomer.getCurrentStatus(customer);
        const phone = customer.phone || '';
        const pieces = customer.accumulatedPieces || 0;

        vipInfoEl.innerHTML = `
            <div class="vip-payment-info">
                <span class="vip-payment-name">${this.escapeHtml(customer.name)}</span>
                <span class="vip-payment-phone">${this.escapeHtml(phone)}</span>
                <span class="vip-payment-pieces">Piezas: ${pieces}</span>
                <span class="status-badge ${status.className}">${status.text}</span>
                <button type="button" class="vip-payment-unlink-btn" title="Desvincular cliente VIP">Desvincular</button>
            </div>
        `;
        vipInfoEl.classList.remove('hidden');
        return true;
    }

    renderVipPaymentDropdown(query) {
        const dropdown = document.getElementById('vip-payment-dropdown');
        if (!dropdown) return;

        this.vipPaymentHighlightedIndex = -1;

        const results = VIPCustomer.search(query);
        dropdown.classList.remove('hidden');

        if (results.length === 0) {
            dropdown.innerHTML = '<div class="vip-dropdown empty-text">Sin coincidencias</div>';
            return;
        }

        const lower = query.toLowerCase();
        dropdown.innerHTML = results.slice(0, 10).map(c => {
            const nameHtml = this.highlightMatch(c.name, lower);
            const phoneHtml = this.highlightMatch(c.phone || '', lower);
            const pieces = c.accumulatedPieces || 0;
            return `
                <div class="vip-dropdown-item" data-id="${c.id}">
                    <span class="vip-dropdown-name">${nameHtml}</span>
                    <span class="vip-dropdown-phone">${phoneHtml} · <span class="vip-dropdown-pieces">Piezas: ${pieces}</span></span>
                </div>
            `;
        }).join('');
    }

    hideVipPaymentDropdown() {
        const dropdown = document.getElementById('vip-payment-dropdown');
        if (dropdown) dropdown.classList.add('hidden');
        this.vipPaymentHighlightedIndex = -1;
    }

    selectVipInPayment(customer) {
        if (!customer) return;
        this.currentVipCustomer = customer;
        this.hideVipPaymentDropdown();

        const vipPhoneInput = document.getElementById('vip-phone-input');
        if (vipPhoneInput) vipPhoneInput.value = customer.phone || '';

        this.renderVipPaymentInfo(customer);
        this.updateVipSalesBadge();
        this.checkAndShowVipReward(customer);
    }

    scrollAndHighlightPaymentItem(items, index) {
        items.forEach((item, i) => {
            item.classList.toggle('vip-dropdown-item-highlighted', i === index);
        });
        const activeItem = items[index];
        if (activeItem && typeof activeItem.scrollIntoView === 'function') {
            activeItem.scrollIntoView({ block: 'nearest' });
        }
    }

    // Verificar elegibilidad a recompensa VIP e activar el aviso si corresponde.
    // Si el cliente alcanza o supera la meta de piezas para Joya Gratis,
    // muestra de inmediato el aviso resaltado en pantalla. Si no lo es,
    // descarta cualquier aviso previo.
    checkAndShowVipReward(customer, sale = null, delay = 0) {
        if (customer) {
            const threshold = VIPConfig.getPiecesForFreeJewel();
            if ((customer.accumulatedPieces || 0) >= threshold) {
                const pendingReward = {
                    customer: customer,
                    threshold: threshold,
                    sale: sale
                };
                this.pendingReward = pendingReward;
                if (delay > 0) {
                    setTimeout(() => this.showRewardAlert(pendingReward), delay);
                } else {
                    this.showRewardAlert(pendingReward);
                }
                return;
            }
        }
        this.dismissRewardAlert();
    }

    // Acumular piezas y monto para el cliente VIP después de completar una venta.
    // Registra la compra completa (piezas + monto + historial individual) en la
    // base de datos 'Clientes VIP' y verifica elegibilidad a Joya Gratis.
    processVipAccumulation(sale) {
        if (!this.currentVipCustomer || !sale || !sale.items) return;

        const totalPieces = sale.items.reduce((sum, item) => sum + item.quantity, 0);
        if (totalPieces === 0) return;

        const totalAmount = sale.items.reduce((sum, item) => sum + (item.amount || 0), 0);

        // addPurchase acumula piezas, registra el monto y guarda el detalle
        // individual en el historial de compras y en rewardHistory (tipo 'venta').
        const result = VIPCustomer.addPurchase(this.currentVipCustomer.id, sale, `Venta ${sale.id}`);
        if (!result.success) {
            console.warn('[VIP] No se pudieron registrar piezas y monto:', result.error);
            return;
        }

        Toast.success(`Se acumularon ${totalPieces} pieza(s) - $${totalAmount.toFixed(2)} al cliente ${this.currentVipCustomer.name}`);

        const customer = VIPCustomer.findById(this.currentVipCustomer.id);
        if (!customer) return;

        this.checkAndShowVipReward(customer, sale, 300);
    }

    // --- Alerta de Premio destacada ---
    // Muestra un aviso resaltado en pantalla de caja cuando un cliente
    // alcanza o supera la meta de piezas para Joya Gratis, con la
    // opción de canjear la recompensa (reiniciando el contador a cero).
    showRewardAlert(pendingReward) {
        if (!pendingReward || !pendingReward.customer) return;
        const { customer, threshold } = pendingReward;

        const alertEl = document.getElementById('vip-reward-alert');
        const customerEl = document.getElementById('reward-alert-customer');
        const redeemBtn = document.getElementById('reward-redeem-btn');
        const dismissBtn = document.getElementById('reward-dismiss-btn');

        if (!alertEl || !customerEl || !redeemBtn || !dismissBtn) return;

        customerEl.textContent = `${customer.name} | ${customer.accumulatedPieces || 0} piezas acumuladas (meta ${threshold})`;
        alertEl.classList.remove('hidden');

        const onRedeem = () => {
            const result = VIPCustomer.redeemAndReset(customer.id, `Canje pos-venta ${customer.name}`);
            if (result.success) {
                Toast.success('¡Joya Gratis canjeada! Contador reiniciado para ' + customer.name);
                if (typeof AutoBackup !== 'undefined' && AutoBackup.save) AutoBackup.save('canje_vip');
                if (typeof Backup !== 'undefined' && Backup.createLocalRecovery) {
                    Backup.createLocalRecovery('canje_vip');
                }
                this.renderVIPTable();
            } else {
                Toast.error(result.error);
            }
            this.dismissRewardAlert();
        };

        const onDismiss = () => {
            this.dismissRewardAlert();
            Toast.info('Recuerda canjear la Joya Gratis desde el módulo Clientes VIP cuando lo desees.', 5000);
        };

        redeemBtn.replaceWith(redeemBtn.cloneNode(true));
        const redeemBtnRef = alertEl.querySelector('#reward-redeem-btn');
        redeemBtnRef.addEventListener('click', onRedeem);

        dismissBtn.replaceWith(dismissBtn.cloneNode(true));
        const dismissBtnRef = alertEl.querySelector('#reward-dismiss-btn');
        dismissBtnRef.addEventListener('click', onDismiss);

        alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    dismissRewardAlert() {
        const alertEl = document.getElementById('vip-reward-alert');
        if (alertEl) {
            alertEl.classList.add('hidden');
        }
        this.pendingReward = null;
    }

    // --- Picker de Cliente VIP en pantalla de Caja ---

    bindVipSalesEvents() {
        const vipInput = document.getElementById('vip-search-input');
        const dropdown = document.getElementById('vip-search-dropdown');
        const clearBtn = document.getElementById('vip-clear-sales-btn');
        const addBtn = document.getElementById('add-vip-quick-btn');

        if (vipInput) {
            let searchTimer = null;
            vipInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                const query = vipInput.value.trim();
                this.vipHighlightedIndex = -1;
                if (query.length >= 1) {
                    searchTimer = setTimeout(() => this.renderVipDropdown(query), 200);
                } else {
                    this.renderVipDropdown('');
                }
            });

            vipInput.addEventListener('keydown', (e) => {
                const items = dropdown ? dropdown.querySelectorAll('.vip-dropdown-item') : [];
                if (items.length === 0) {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        this.hideVipDropdown();
                        vipInput.value = '';
                    }
                    if (e.key === 'Enter' && vipInput.value.trim()) {
                        e.preventDefault();
                        const customer = this.resolveVipCustomer(vipInput.value.trim());
                        if (customer) {
                            this.selectVipInSales(customer);
                        } else {
                            this.hideVipDropdown();
                            Toast.warning('No se encontró cliente VIP');
                        }
                    }
                    return;
                }

                switch (e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        this.vipHighlightedIndex =
                            (this.vipHighlightedIndex + 1) % items.length;
                        this.scrollAndHighlightItem(items, this.vipHighlightedIndex);
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        this.vipHighlightedIndex =
                            this.vipHighlightedIndex <= 0
                                ? items.length - 1
                                : this.vipHighlightedIndex - 1;
                        this.scrollAndHighlightItem(items, this.vipHighlightedIndex);
                        break;
                    case 'Enter':
                        e.preventDefault();
                        if (this.vipHighlightedIndex >= 0 && this.vipHighlightedIndex < items.length) {
                            const id = items[this.vipHighlightedIndex].dataset.id;
                            const customer = VIPCustomer.findById(id);
                            if (customer) this.selectVipInSales(customer);
                        } else {
                            const query = vipInput.value.trim();
                            if (query) {
                                const customer = this.resolveVipCustomer(query);
                                if (customer) {
                                    this.selectVipInSales(customer);
                                } else {
                                    this.hideVipDropdown();
                                    Toast.warning('No se encontró cliente VIP');
                                }
                            } else {
                                this.hideVipDropdown();
                            }
                        }
                        break;
                    case 'Escape':
                        e.preventDefault();
                        this.hideVipDropdown();
                        vipInput.value = '';
                        break;
                }
            });

            vipInput.addEventListener('focus', () => {
                this.vipHighlightedIndex = -1;
            });

            document.addEventListener('click', (e) => {
                if (dropdown && !dropdown.contains(e.target) && e.target !== vipInput) {
                    this.hideVipDropdown();
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearVipSalesSelection();
                this.dismissRewardAlert();
            });
        }

        // Botón "Desvincular": cambiar o quitar al cliente VIP asociado en caja
        const unlinkBtn = document.getElementById('vip-unlink-sales-btn');
        if (unlinkBtn) {
            unlinkBtn.addEventListener('click', () => {
                this.clearVipSalesSelection();
                this.dismissRewardAlert();
                Toast.info('Cliente VIP desvinculado de la venta');
            });
        }

        if (addBtn) {
            addBtn.addEventListener('click', () => {
                if (!Auth.canModifyInventory()) {
                    Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                this.showQuickAddVipModal();
            });
        }

        if (dropdown) {
            dropdown.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });
            dropdown.addEventListener('mousemove', (e) => {
                const item = e.target.closest('.vip-dropdown-item');
                if (item) {
                    const idx = Array.prototype.indexOf.call(
                        dropdown.querySelectorAll('.vip-dropdown-item'),
                        item
                    );
                    if (idx !== this.vipHighlightedIndex) {
                        this.vipHighlightedIndex = idx;
                        this.scrollAndHighlightItem(
                            dropdown.querySelectorAll('.vip-dropdown-item'),
                            idx
                        );
                    }
                }
            });
            dropdown.addEventListener('click', (e) => {
                const item = e.target.closest('.vip-dropdown-item');
                if (item) {
                    const id = item.dataset.id;
                    const customer = VIPCustomer.findById(id);
                    if (customer) {
                        this.selectVipInSales(customer);
                    }
                }
            });
        }
    }

    scrollAndHighlightItem(items, index) {
        items.forEach((item, i) => {
            item.classList.toggle('vip-dropdown-item-highlighted', i === index);
        });
        const activeItem = items[index];
        if (activeItem && typeof activeItem.scrollIntoView === 'function') {
            activeItem.scrollIntoView({ block: 'nearest' });
        }
    }

    // Renderizar el dropdown de autocompletado con búsqueda por Nombre o Teléfono
    renderVipDropdown(query) {
        const dropdown = document.getElementById('vip-search-dropdown');
        if (!dropdown) return;

        this.vipHighlightedIndex = -1;

        const results = query ? VIPCustomer.search(query) : VIPCustomer.getAll().slice(0, 10);
        dropdown.classList.remove('hidden');

        if (results.length === 0) {
            dropdown.innerHTML = '<div class="vip-dropdown empty-text">Sin coincidencias</div>';
            return;
        }

        const lower = query.toLowerCase();
        dropdown.innerHTML = results.slice(0, 10).map(c => {
            const nameHtml = this.highlightMatch(c.name, lower);
            const phoneHtml = this.highlightMatch(c.phone || '', lower);
            const pieces = c.accumulatedPieces || 0;
            return `
                <div class="vip-dropdown-item" data-id="${c.id}">
                    <span class="vip-dropdown-name">${nameHtml}</span>
                    <span class="vip-dropdown-phone">${phoneHtml} · <span class="vip-dropdown-pieces">Piezas: ${pieces}</span></span>
                </div>
            `;
        }).join('');
    }

    highlightMatch(text, term) {
        if (!term) return this.escapeHtml(text || '');
        const idx = String(text || '').toLowerCase().indexOf(term);
        if (idx === -1) return this.escapeHtml(text || '');
        const before = this.escapeHtml(text.substring(0, idx));
        const match = this.escapeHtml(text.substring(idx, idx + term.length));
        const after = this.escapeHtml(text.substring(idx + term.length));
        return `${before}<span class="vip-dropdown-highlight">${match}</span>${after}`;
    }

    hideVipDropdown() {
        const dropdown = document.getElementById('vip-search-dropdown');
        if (dropdown) dropdown.classList.add('hidden');
        this.vipHighlightedIndex = -1;
    }

    selectVipInSales(customer) {
        if (!customer) return;
        this.currentVipCustomer = customer;
        this.hideVipDropdown();

        const vipInput = document.getElementById('vip-search-input');
        if (vipInput) {
            vipInput.value = '';
            vipInput.classList.add('hidden');
        }

        this.updateVipSalesBadge();
        this.checkAndShowVipReward(customer);
        BarcodeScanner.focusInput();

        if (typeof AutoBackup !== 'undefined') AutoBackup.save('seleccion_vip');
    }

    updateVipSalesBadge() {
        const badge = document.getElementById('vip-selected-badge');
        const nameEl = document.getElementById('vip-badge-name');
        const piecesEl = document.getElementById('vip-badge-pieces');
        const phoneEl = document.getElementById('vip-badge-phone');
        const vipInput = document.getElementById('vip-search-input');
        const rewardAlert = document.getElementById('vip-reward-alert');

        if (!badge || !nameEl || !piecesEl) return;

        if (this.currentVipCustomer) {
            const c = this.currentVipCustomer;
            nameEl.textContent = c.name;
            piecesEl.textContent = `Piezas: ${c.accumulatedPieces || 0}`;
            if (phoneEl) phoneEl.textContent = c.phone || '';
            badge.classList.remove('hidden');
            if (vipInput) {
                vipInput.classList.add('hidden');
                vipInput.value = '';
            }
            if (rewardAlert && !rewardAlert.classList.contains('hidden')) {
                rewardAlert.classList.add('hidden');
            }
        } else {
            badge.classList.add('hidden');
            if (vipInput) vipInput.classList.remove('hidden');
        }
    }

    clearVipSalesSelection() {
        this.currentVipCustomer = null;
        this.vipHighlightedIndex = -1;
        const vipInput = document.getElementById('vip-search-input');
        const badge = document.getElementById('vip-selected-badge');
        if (vipInput) {
            vipInput.classList.remove('hidden');
            vipInput.value = '';
        }
        if (badge) badge.classList.add('hidden');
        this.hideVipDropdown();
    }

    // Registro rápido de un nuevo cliente VIP desde la caja,
    // sin salir ni limpiar la venta actual.
    showQuickAddVipModal() {
        const overlay = document.createElement('div');
        overlay.className = 'payment-overlay';
        overlay.innerHTML = `
            <div class="payment-modal" style="max-width: 480px;">
                <div class="payment-modal-header">
                    <h3 class="payment-title">Nuevo Cliente VIP</h3>
                </div>
                <form id="vip-quick-form" class="vip-form">
                    <div class="input-group">
                        <input type="text" name="name" placeholder=" " required>
                        <label>Nombre Completo</label>
                    </div>
                    <div class="input-group">
                        <input type="tel" name="phone" placeholder=" " required>
                        <label>Número de Teléfono</label>
                    </div>
                    <div class="input-group">
                        <textarea name="notes" placeholder=" " rows="3" maxlength="500"></textarea>
                        <label>Notas</label>
                    </div>
                    <div class="payment-actions" style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button type="button" class="btn btn-outline" id="vip-quick-cancel-btn">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Guardar y Usar</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);

        const cleanup = () => {
            if (overlay.parentNode) document.body.removeChild(overlay);
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup();
        });

        overlay.querySelector('#vip-quick-cancel-btn')?.addEventListener('click', cleanup);

        overlay.querySelector('#vip-quick-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const name = formData.get('name').trim();
            const phone = formData.get('phone').trim();
            const notes = formData.get('notes').trim();

            if (!name || !phone) {
                Toast.error('El nombre y teléfono son obligatorios');
                return;
            }

            const result = VIPCustomer.add({ name, phone, notes });
            if (result.success) {
                Toast.success('Cliente VIP agregado');
                this.selectVipInSales(result.customer);
                this.renderVIPTable();
                if (typeof AutoBackup !== 'undefined') AutoBackup.save('cliente_vip');
                if (typeof Backup !== 'undefined' && Backup.createLocalRecovery) {
                    Backup.createLocalRecovery('cliente_vip');
                }
            } else {
                Toast.error(result.error);
            }
            cleanup();
        });
    }

    // Completar checkout con detalles de pago completos
    // Agregar información del cliente VIP a los detalles de pago
    buildVipPaymentDetails(baseDetails) {
        const details = { ...baseDetails };
        if (this.currentVipCustomer) {
            details.vipCustomerId = this.currentVipCustomer.id;
            details.vipCustomerName = this.currentVipCustomer.name;
        }
        return details;
    }

    completeCheckout(paymentDetails = { method: 'cash' }) {
        try {
            // Si la caja se cerró en otra pestaña, no registrar ventas fuera de turno
            if (!Cut.isShiftOpen()) {
                Toast.error('La caja fue cerrada (posiblemente en otra pestaña). Abra un nuevo turno para seguir vendiendo.');
                this.handleShiftClosedExternally();
                return;
            }

            // Guarda la venta y descuenta el inventario de forma atómica
            const result = Checkout.checkout(
                this.cart,
                this.buildVipPaymentDetails(paymentDetails)
            );

            if (result.success) {
                // Acumular piezas para cliente VIP si está seleccionado
                this.processVipAccumulation(result.sale);

                // Capa 1 (doble capa): snapshot silencioso en localStorage para recuperación local
                Backup.createLocalRecovery('venta');

                // Limpiar selección de cliente VIP (la venta ya fue procesada);
                // el aviso de premio usa pendingReward, independiente de esta variable
                this.clearVipSalesSelection();

                // Guardar referencia a la venta recién completada para reimpresión rápida
                try {
                    this.saveLastPrintedSale(result.sale);
                } catch { /* no crítico */ }

                setTimeout(() => {
                    Print.printReceipt(result.sale);
                }, 300);

                this.updateDailyReport();
                this.updateHeldSalesButton();
                BarcodeScanner.focusInput();

                Toast.success(`Venta completada - Folio: ${result.sale.id}`);

                // Notificar venta por Telegram (en segundo plano, sin interrumpir
                // la venta en localStorage ni la impresión del ticket).
                if (typeof notificarTelegram === 'function') {
                    notificarTelegram(TelegramNotify.formatearVenta(result.sale));
                }
            } else {
                Toast.error(result.error || 'Error al procesar la venta');
            }
        } catch (err) {
            Toast.error('Error al procesar el pago: ' + (err?.message || err));
        } finally {
            this.hidePaymentModal();
        }
    }

    // --- Reimpresión de tickets ---

    static get lastReceiptKey() { return Business.key('pos_last_receipt_sale'); }

    // Guardar la última venta completada para reimpresión rápida
    saveLastPrintedSale(sale) {
        localStorage.setItem(App.lastReceiptKey, SafeJSON.stringify(sale));
    }

    // Obtener la última venta imprimida desde localStorage
    getLastPrintedSale() {
        const stored = localStorage.getItem(App.lastReceiptKey);
        return stored ? SafeJSON.parse(stored, null, 'ultima_venta') : null;
    }

    // Reimprimir el último ticket generado
    reprintLastTicket() {
        const sale = this.getLastPrintedSale();
        if (!sale) {
            Toast.warning('No hay tickets recientes para reimprimir');
            return;
        }
        Print.printReceipt(sale);
        Toast.info(`Reimprimiendo ticket - Folio: ${sale.id}`);
    }

    // Reimprimir un ticket específico por su ID de venta
    reprintTicket(saleId) {
        const sale = SaleService.getById(saleId);
        if (!sale) {
            Toast.error('No se encontró la venta seleccionada');
            return;
        }
        Print.printReceipt(sale);
        Toast.info(`Reimprimiendo ticket - Folio: ${sale.id}`);
    }

    updateDailyReport() {
        const hoy = DateUtil.today();

        // Fuente alineada a la jornada/caja de hoy: combina las ventas de la
        // sesión activa con los cortes cerrados hoy; si no hay sesión activa,
        // filtra estrictamente por la fecha local exacta. No altera localStorage.
        const ventasHoy = Cut.getDashboardSales(hoy);

        const totalRevenue = ventasHoy.reduce((sum, s) => sum + (s.total || 0), 0);
        const transactionCount = ventasHoy.length;

        let totalCost = 0;
        let revenueFromItems = 0;
        let piecesSold = 0;

        ventasHoy.forEach(sale => {
            (sale.items || []).forEach(item => {
                const product = Inventory.findByBarcode(item.barcode);
                if (product && product.cost) {
                    totalCost += product.cost * item.quantity;
                }
                revenueFromItems += item.amount || 0;
                piecesSold += item.quantity || 0;
            });
        });

        const profit = revenueFromItems - totalCost - ((typeof Returns !== 'undefined') ? Returns.getTotalBySales(ventasHoy) : 0);
        const margin = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : '0.0';

        const salesEl = document.getElementById('daily-sales');
        const countEl = document.getElementById('daily-transactions');
        const piecesEl = document.getElementById('daily-pieces');
        const profitEl = document.getElementById('daily-profit');
        const marginEl = document.getElementById('avg-margin');

        if (salesEl) salesEl.textContent = `$${totalRevenue.toFixed(2)}`;
        if (countEl) countEl.textContent = transactionCount;
        if (piecesEl) piecesEl.textContent = piecesSold;

        if (Auth.isAdmin()) {
            if (profitEl) profitEl.textContent = `$${profit.toFixed(2)}`;
            if (marginEl) marginEl.textContent = `${margin}%`;

            // Populate daily summary cards for withdrawals, returns, guarantees
            const dailyReport = ReportService.getConsolidatedDaily(hoy);
            const withdrawalsEl = document.getElementById('daily-withdrawals-count');
            const returnsCountEl = document.getElementById('daily-returns-count');
            const guaranteesCountEl = document.getElementById('daily-guarantees-count');
            if (withdrawalsEl) withdrawalsEl.textContent = dailyReport.withdrawalCount || 0;
            if (returnsCountEl) returnsCountEl.textContent = dailyReport.returnsCount || 0;
            if (guaranteesCountEl) guaranteesCountEl.textContent = dailyReport.guaranteeExchangeCount || 0;
        }

        this.renderDailyConsolidated(hoy);

        if (Auth.isAdmin()) {
            try {
            this.renderDailyFinancialChart();
            this.renderDailyVolumeChart();
            this.renderDailySalesChart();
            this._renderPeriodReports();
            } catch (err) {
                if (typeof console !== 'undefined' && console.error) {
                    console.error('[DataValidator] Error al renderizar gráficas diarias:', err);
                }
                if (typeof Toast !== 'undefined' && Toast.error) {
                    Toast.error('No se pudieron cargar las gráficas de reportes. Intenta recargar.');
                }
            }
        }
    }

    // --- Actualizar tarjetas métricas de un período (Día/Semana/Mes/Año) ---
    _updatePeriodSummary(cardIds, summary) {
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        const fmt = (v) => '$' + (typeof v === 'number' ? v.toFixed(2) : '0.00');
        if (cardIds.sales) set(cardIds.sales, fmt(summary.netSales));
        if (cardIds.transactions) set(cardIds.transactions, summary.transactionCount);
        if (cardIds.profit) set(cardIds.profit, fmt(summary.profit));
        if (cardIds.margin) set(cardIds.margin, summary.margin + '%');
        if (cardIds.pieces) set(cardIds.pieces, summary.netPieces);
    }

    // --- Mejor mes (Total Ventas) para vistas Mes y Año ---
    _updateBestMonthCard(cardId, valueId, year) {
        const bestMonthCard = document.getElementById(cardId);
        const bestMonthValue = document.getElementById(valueId);
        if (!bestMonthCard || !bestMonthValue) return;

        let bestMonth = null;
        let bestNet = -Infinity;
        const monthNames = DateUtil.MONTH_NAMES_ES;
        for (let m = 1; m <= 12; m++) {
            const sales = ReportService.getMonthlySales(m, year);
            const summary = ReportService.summarizeSales(sales);
            if (summary.netSales > bestNet) {
                bestNet = summary.netSales;
                bestMonth = monthNames[m - 1];
            }
        }
        bestMonthCard.textContent = bestMonth || '—';
        bestMonthValue.textContent = '$' + (bestNet >= 0 ? bestNet.toFixed(2) : '0.00');
    }

    // --- Renderizar todas las tarjetas y gráficas de los reportes por período ---
    _renderPeriodReports() {
        if (!Auth.isAdmin()) return;

        const now = new Date();
        const year = now.getFullYear();

        // Semana: semana actual
        const weekSummary = ReportService.getWeeklySummary();
        this._updatePeriodSummary(
            { sales: 'weekly-sales', transactions: 'weekly-transactions',
              profit: 'weekly-profit', margin: 'weekly-margin',
              pieces: 'weekly-pieces' },
            weekSummary
        );

        // Mes: mes actual
        const monthSummary = ReportService.getMonthlySummary();
        this._updatePeriodSummary(
            { sales: 'monthly-sales', transactions: 'monthly-transactions',
              profit: 'monthly-profit', margin: 'monthly-margin',
              pieces: 'monthly-pieces' },
            monthSummary
        );
        this._updateBestMonthCard('monthly-best-month', 'monthly-best-month-value', year);

        // Año: año actual
        const yearSummary = ReportService.getYearlySummary(year);
        this._updatePeriodSummary(
            { sales: 'annual-sales', transactions: 'annual-transactions',
              profit: 'annual-profit', margin: 'annual-margin',
              pieces: 'annual-pieces' },
            yearSummary
        );
        this._updateBestMonthCard('annual-best-month', 'annual-best-month-value', year);

        // Gráficas de períodos (financieras + volumen)
        try {
            this.renderWeeklyFinancialChart();
            this.renderWeeklyVolumeChart();
            this.renderMonthlyFinancialChart();
            this.renderMonthlyVolumeChart();
            this.renderAnnualFinancialChart();
            this.renderAnnualVolumeChart();
        } catch (err) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[DataValidator] Error al renderizar gráficas de período:', err);
            }
            if (typeof Toast !== 'undefined' && Toast.error) {
                Toast.error('No se pudieron cargar las gráficas de período.');
            }
        }
    }


    // ============================================================
    //  GRÁFICAS FINANCIERAS Y DE VOLUMEN CON CHART.JS
    //  Utiliza Chart.js para renderizado interactivo con tooltips.
    //  - Se destruye la instancia previa antes de crear una nueva.
    //  - Se limpia el contenedor HTML para evitar duplicar <canvas>.
    //  - No se muestran etiquetas de texto sobre las barras; los
    //    montos aparecen solo en el tooltip al pasar el ratón.
    // ============================================================

    // --- Desactivar globalmente el plugin datalabels ---
    // El plugin chartjs-plugin-datalabels está cargado, pero NO debe
    // renderizar etiquetas de texto sobre las barras. La información
    // ($ y piezas) SOLO se muestra al pasar el cursor (tooltip).
    _initChartDefaults() {
        if (typeof Chart !== 'undefined' && Chart.defaults && Chart.defaults.plugins) {
            Chart.defaults.plugins.datalabels = false;
        }
    }

    // --- Helper: destruir instancia previa y limpiar contenedor ---
    _resetChart(chartVar, canvasId) {
        if (window[chartVar]) {
            window[chartVar].destroy();
            window[chartVar] = null;
        }
        const canvas = document.getElementById(canvasId);
        if (canvas && canvas.parentElement) {
            canvas.parentElement.innerHTML = '';
        }
    }

    // --- Helper: crear canvas limpio dentro del contenedor ---
    _makeCanvas(container, canvasId) {
        const canvas = document.createElement('canvas');
        canvas.id = canvasId;
        canvas.width = 600;
        canvas.height = 300;
        container.appendChild(canvas);
        return canvas;
    }

    // --- Gráfica financiera (Ventas $) ---
    _renderFinancialChart(container, canvasId, chartVar, labels, salesData) {
        if (typeof Chart === 'undefined') {
            if (typeof Toast !== 'undefined') {
                Toast.warning('Chart.js no está disponible. Las gráficas no se pueden mostrar.');
            }
            return;
        }

        if (!container) return;

        this._resetChart(chartVar, canvasId);

        const canvas = this._makeCanvas(container, canvasId);
        const ctx = canvas.getContext('2d');

        window[chartVar] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Ventas ($)',
                        data: salesData,
                        backgroundColor: 'rgba(212, 175, 55, 0.7)',
                        borderColor: '#d4af37',
                        borderWidth: 1,
                        borderRadius: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#a0a0b0',
                            font: { weight: 'bold', size: 12 },
                            padding: 12
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 20, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#c0c0d0',
                        borderColor: '#2a2a3a',
                        cornerRadius: 6,
                        callbacks: {
                            label: function(context) {
                                const v = context.parsed.y;
                                return `${context.dataset.label}: $${v.toFixed(2)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        beginAtZero: true,
                        ticks: {
                            color: '#a0a0b0',
                            callback: function(value) {
                                return '$' + Math.round(value);
                            }
                        },
                        grid: {
                            color: 'rgba(42, 42, 58, 0.5)'
                        }
                    },
                    x: {
                        ticks: {
                            color: '#a0a0b0',
                            maxRotation: 45,
                            minRotation: 45,
                            autoSkip: true
                        },
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });

        window[chartVar].update();
    }

    // --- Gráfica de volumen (Piezas Vendidas) ---
    _renderVolumeChart(container, canvasId, chartVar, labels, data) {
        if (typeof Chart === 'undefined') {
            if (typeof Toast !== 'undefined') {
                Toast.warning('Chart.js no está disponible. Las gráficas no se pueden mostrar.');
            }
            return;
        }

        if (!container) return;

        this._resetChart(chartVar, canvasId);

        const canvas = this._makeCanvas(container, canvasId);
        const ctx = canvas.getContext('2d');

        window[chartVar] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Piezas Vendidas',
                    data: data,
                    backgroundColor: 'rgba(52, 152, 219, 0.7)',
                    borderColor: '#3498db',
                    borderWidth: 1,
                    borderRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#a0a0b0',
                            font: { weight: 'bold', size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 20, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#c0c0d0',
                        borderColor: '#2a2a3a',
                        cornerRadius: 6,
                        callbacks: {
                            label: function(context) {
                                const v = context.parsed.y;
                                return `Piezas Vendidas: ${Math.round(v)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        beginAtZero: true,
                        ticks: {
                            color: '#a0a0b0'
                        },
                        grid: {
                            color: 'rgba(42, 42, 58, 0.5)'
                        }
                    },
                    x: {
                        ticks: {
                            color: '#a0a0b0',
                            maxRotation: 45,
                            minRotation: 45,
                            autoSkip: true
                        },
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });

        window[chartVar].update();
    }

    // ============================================================
    //  GRÁFICA DIARIA (por hora)
    // ============================================================

    // --- Ventas por hora del día ---
    renderDailyFinancialChart() {
        const container = document.querySelector('#daily-financial-chart-container');
        if (!container) return;

        const today = DateUtil.today();
        const sales = Cut.getDashboardSales(today);

        const hourlySales = {};
        for (let h = 0; h < 24; h++) {
            hourlySales[h] = 0;
        }

        sales.forEach(s => {
            const hour = new Date(s.date).getHours();
            if (hour >= 0 && hour < 24) {
                hourlySales[hour] += s.total;
            }
        });

        const labels = Object.keys(hourlySales).map(h => `${h}:00`);
        const salesData = Object.values(hourlySales);

        this._renderFinancialChart(
            container, 'daily-financial-chart', 'myChartVentas',
            labels, salesData
        );
    }

    // --- Piezas Vendidas por hora del día ---
    renderDailyVolumeChart() {
        const container = document.querySelector('#daily-volume-chart-container');
        if (!container) return;

        const today = DateUtil.today();
        const sales = Cut.getDashboardSales(today);

        const hourlyPieces = {};
        for (let h = 0; h < 24; h++) hourlyPieces[h] = 0;

        sales.forEach(s => {
            const hour = new Date(s.date).getHours();
            if (hour >= 0 && hour < 24) {
                (s.items || []).forEach(item => {
                    hourlyPieces[hour] += item.quantity || 0;
                });
            }
        });

        const labels = Object.keys(hourlyPieces).map(h => `${h}:00`);
        const data = Object.values(hourlyPieces);

        this._renderVolumeChart(
            container, 'daily-volume-chart', 'myChartPiezas',
            labels, data
        );
    }

    // --- Ventas por hora del día (Gráfica 3) ---
    renderDailySalesChart() {
        const canvas = document.getElementById('daily-sales-chart');
        if (!canvas) return;

        if (Chart.getChart(canvas)) {
            Chart.getChart(canvas).destroy();
        }

        let chartInstance = this.dailySalesChartInstance;
        if (chartInstance) chartInstance.destroy();

        const ctx = canvas.getContext('2d');
        const today = DateUtil.today();
        const sales = Cut.getDashboardSales(today);

        const hourlySales = {};
        for (let h = 0; h < 24; h++) hourlySales[h] = 0;

        sales.forEach(s => {
            const hour = new Date(s.date).getHours();
            if (hour >= 0 && hour < 24) {
                hourlySales[hour] += s.total;
            }
        });

        const labels = Object.keys(hourlySales).map(h => `${h}:00`);
        const data = Object.values(hourlySales);

        this.dailySalesChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Ventas $',
                    data: data,
                    backgroundColor: 'rgba(212, 175, 55, 0.2)',
                    borderColor: '#d4af37',
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: '#d4af37',
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#a0a0b0',
                            font: { weight: 'bold', size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 20, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#c0c0d0',
                        borderColor: '#2a2a3a',
                        cornerRadius: 6,
                        callbacks: {
                            label: function(context) {
                                const v = context.parsed.y;
                                return `Ventas: $${v.toFixed(2)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        beginAtZero: true,
                        ticks: {
                            color: '#a0a0b0',
                            callback: function(value) {
                                return '$' + Math.round(value);
                            }
                        },
                        grid: {
                            color: 'rgba(42, 42, 58, 0.5)'
                        }
                    },
                    x: {
                        ticks: {
                            color: '#a0a0b0',
                            maxRotation: 45,
                            minRotation: 45,
                            autoSkip: true
                        },
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });

        this.dailySalesChartInstance.update();
    }


    // ============================================================
    //  GRÁFICAS DE PERÍODO (Semana / Mes / Año)
    // ============================================================

    // --- Ventas por día de la semana (lunes → domingo) ---
    renderWeeklyFinancialChart() {
        const container = document.querySelector('#weekly-financial-chart-container');
        if (!container) return;

        const labels = DateUtil.WEEKDAY_NAMES_ES;
        const salesData = [];
        const dates = DateUtil.getWeekDates(new Date());
        dates.forEach(dateStr => {
            const sales = ReportService.getDailySales(dateStr);
            const summary = ReportService.summarizeSales(sales);
            salesData.push(summary.netSales);
        });

        this._renderFinancialChart(
            container, 'weekly-financial-chart', 'myChartVentasSemana',
            labels, salesData
        );
    }

    // --- Piezas Vendidas por día de la semana (lunes → domingo) ---
    renderWeeklyVolumeChart() {
        const container = document.querySelector('#weekly-volume-chart-container');
        if (!container) return;

        const labels = DateUtil.WEEKDAY_NAMES_ES;
        const data = [];
        const dates = DateUtil.getWeekDates(new Date());
        dates.forEach(dateStr => {
            const sales = ReportService.getDailySales(dateStr);
            const summary = ReportService.summarizeSales(sales);
            data.push(summary.netPieces);
        });

        this._renderVolumeChart(
            container, 'weekly-volume-chart', 'myChartPiezasSemana',
            labels, data
        );
    }

    // --- Ventas por día del mes actual ---
    renderMonthlyFinancialChart() {
        const container = document.querySelector('#monthly-financial-chart-container');
        if (!container) return;

        const dates = DateUtil.getMonthDates(new Date());
        const labels = dates.map(d => d.split('-')[2]);
        const salesData = [];
        dates.forEach(dateStr => {
            const sales = ReportService.getDailySales(dateStr);
            const summary = ReportService.summarizeSales(sales);
            salesData.push(summary.netSales);
        });

        this._renderFinancialChart(
            container, 'monthly-financial-chart', 'myChartVentasMes',
            labels, salesData
        );
    }

    // --- Piezas Vendidas por día del mes actual ---
    renderMonthlyVolumeChart() {
        const container = document.querySelector('#monthly-volume-chart-container');
        if (!container) return;

        const dates = DateUtil.getMonthDates(new Date());
        const labels = dates.map(d => d.split('-')[2]);
        const data = [];
        dates.forEach(dateStr => {
            const sales = ReportService.getDailySales(dateStr);
            const summary = ReportService.summarizeSales(sales);
            data.push(summary.netPieces);
        });

        this._renderVolumeChart(
            container, 'monthly-volume-chart', 'myChartPiezasMes',
            labels, data
        );
    }

    // --- Ventas por mes del año seleccionado ---
    renderAnnualFinancialChart(year = new Date().getFullYear()) {
        const container = document.querySelector('#annual-financial-chart-container');
        if (!container) return;

        const labels = DateUtil.MONTH_NAMES_ES;
        const salesData = [];
        for (let m = 1; m <= 12; m++) {
            const sales = ReportService.getMonthlySales(m, year);
            const summary = ReportService.summarizeSales(sales);
            salesData.push(summary.netSales);
        }

        this._renderFinancialChart(
            container, 'annual-financial-chart', 'myChartVentasAnio',
            labels, salesData
        );
    }

    // --- Piezas Vendidas por mes del año seleccionado ---
    renderAnnualVolumeChart(year = new Date().getFullYear()) {
        const container = document.querySelector('#annual-volume-chart-container');
        if (!container) return;

        const labels = DateUtil.MONTH_NAMES_ES;
        const data = [];
        for (let m = 1; m <= 12; m++) {
            const sales = ReportService.getMonthlySales(m, year);
            const summary = ReportService.summarizeSales(sales);
            data.push(summary.netPieces);
        }

        this._renderVolumeChart(
            container, 'annual-volume-chart', 'myChartPiezasAnio',
            labels, data
        );
    }

    // ============================================================
    //  AÑO HISTÓRICO-COMPLETO: selector de años + gráfica
    //  muestra datos mensuales para todo el histórico disponible.
    // ============================================================

    // Poblar el selector de años con los años que tienen datos históricos
    populateYearSelector() {
        const selector = document.getElementById('year-selector');
        if (!selector) return;

        const years = [];
        const sales = ReportService.getHistoricalSales();
        sales.forEach(s => {
            const y = new Date(s.date).getFullYear();
            if (!years.includes(y)) years.push(y);
        });

        years.sort((a, b) => b - a);

        const currentYear = new Date().getFullYear();
        if (!years.includes(currentYear)) years.unshift(currentYear);

        selector.innerHTML = '';
        years.forEach(y => {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            selector.appendChild(opt);
        });
    }

    // Actualizar la tarjeta de resumen y gráficas del Año histórico
    updateHistoricalAnnual() {
        if (!Auth.isAdmin()) return;
        const selector = document.getElementById('year-selector');
        if (!selector) return;
        const year = parseInt(selector.value);
        if (isNaN(year)) return;

        const sales = ReportService.getYearlySales(year);
        const summary = ReportService.summarizeSales(sales);

        this._updatePeriodSummary(
            { sales: 'annual-sales', transactions: 'annual-transactions',
              profit: 'annual-profit', margin: 'annual-margin',
              pieces: 'annual-pieces' },
            summary
        );
        this._updateBestMonthCard('annual-best-month', 'annual-best-month-value', year);

        try {
            this.renderAnnualFinancialChart(year);
            this.renderAnnualVolumeChart(year);
        } catch (err) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[DataValidator] Error al renderizar gráficas anuales:', err);
            }
        }
    }

    // --- Cambiar pestaña activa en el módulo de reportes ---
    switchReportTab(tab) {
        const tabs = document.querySelectorAll('.report-tab-content');
        tabs.forEach(t => {
            t.classList.toggle('hidden', t.dataset.reportTab !== tab);
        });
        const btns = document.querySelectorAll('.reports-tab-btn');
        btns.forEach(b => {
            b.classList.toggle('active', b.dataset.reportTab === tab);
        });
    }

    viewCashReport() {
        const session = Cut.getActiveSession();
        if (session) {
            const summary = Cut.getSessionSummary(session);
            const openTime = new Date(session.openedAt).toLocaleString('es-MX');
            Toast.info(
                `Corte de Caja (Sesión)\n\n` +
                `Apertura: ${openTime}\n` +
                `Ventas en sesión: $${summary.grandTotal.toFixed(2)}\n` +
                `Transacciones: ${summary.transactionCount}\n` +
                `Efectivo: $${summary.cashTotal.toFixed(2)}\n` +
                `Tarjeta: $${summary.cardTotal.toFixed(2)}`,
                0
            );
        } else {
            const summary = Cut.getCashDrawerSummary();
            Toast.info(
                `Corte de Caja\n\n` +
                `Ventas del día: $${summary.grandTotal.toFixed(2)}\n` +
                `Transacciones: ${summary.totalSales}\n` +
                `Efectivo: $${summary.cashTotal.toFixed(2)}\n` +
                `Tarjeta: $${summary.cardTotal.toFixed(2)}`,
                0
            );
        }
    }

    bindInventoryEvents() {
        const inventorySearch = document.getElementById('inventory-search');
        if (inventorySearch) {
             inventorySearch.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                const results = Inventory.search(query);
                this.renderInventoryResults(results);
                this.updateLowStockIndicator();
            });
        }

        const addInventoryBtn = document.getElementById('add-inventory-btn');
        if (addInventoryBtn) {
            addInventoryBtn.addEventListener('click', () => {
                if (!Auth.canModifyInventory()) {
                    Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                this.showAddProductModal();
            });
        }
    }

    // ============================================================
    //  EVENTOS DEL MÓDULO DE REPORTES POR DÍA
    //  Incluye: selector de fecha, consolidado diario,
    //  detalle de cortes/sesiones, y exportación.
    // ============================================================

    bindReportsEvents() {
        const dateSelect = document.getElementById('report-date-select');
        if (dateSelect) {
            dateSelect.addEventListener('change', (e) => {
                const selectedDate = e.target.value;
                if (selectedDate) {
                    this.renderDailyConsolidated(selectedDate);
                }
            });
        }

        const todayBtn = document.getElementById('report-today-btn');
        if (todayBtn) {
            todayBtn.addEventListener('click', () => {
                const today = DateUtil.today();
                if (dateSelect) dateSelect.value = today;
                this.renderDailyConsolidated(today);
            });
        }

        const exportBtn = document.getElementById('export-daily-report-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                if (!Auth.isAdmin()) {
                    Toast.warning('Permiso denegado: esta acción requiere privilegios de administrador');
                    return;
                }
                this.exportDailyReport();
            });
        }

        const printBtn = document.getElementById('print-daily-report-btn');
        if (printBtn) {
            printBtn.addEventListener('click', () => {
                if (!Auth.isAdmin()) {
                    Toast.warning('Permiso denegado: esta acción requiere privilegios de administrador');
                    return;
                }
                const dateSelect = document.getElementById('report-date-select');
                const date = dateSelect ? dateSelect.value : null;
                const report = ReportService.getConsolidatedDaily(date);
                Print.printDailyReport(report);
            });
        }

        const refreshDailyChartBtn = document.getElementById('refresh-daily-chart');
        if (refreshDailyChartBtn) {
            refreshDailyChartBtn.addEventListener('click', () => {
                this.renderDailyFinancialChart();
                this.renderDailyVolumeChart();
                this.renderDailySalesChart();
            });
        }

        const refreshDashboardBtn = document.getElementById('refresh-dashboard-btn');
        if (refreshDashboardBtn) {
            refreshDashboardBtn.addEventListener('click', () => {
                this.refreshDashboard();
            });
        }

        // --- Selector de pestañas de reportes (Día / Semana / Mes / Año) ---
        const tabBtns = document.querySelectorAll('.reports-tab-btn[data-report-tab]');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.reportTab;
                this.switchReportTab(tab);
                if (Auth.isAdmin()) {
                    if (tab === 'anio') {
                        this.populateYearSelector();
                        this.updateHistoricalAnnual();
                    } else if (tab === 'dia') {
                        this.renderDailyFinancialChart();
                        this.renderDailyVolumeChart();
                        this.renderDailySalesChart();
                    } else {
                        this._renderPeriodReports();
                    }
                }
            });
        });

        // --- Botones de refresco de gráficas de períodos ---
        const refreshWeeklyBtn = document.getElementById('refresh-weekly-chart');
        if (refreshWeeklyBtn) {
            refreshWeeklyBtn.addEventListener('click', () => {
                if (Auth.isAdmin()) {
                    this.renderWeeklyFinancialChart();
                    this.renderWeeklyVolumeChart();
                }
            });
        }

        const refreshMonthlyBtn = document.getElementById('refresh-monthly-chart');
        if (refreshMonthlyBtn) {
            refreshMonthlyBtn.addEventListener('click', () => {
                if (Auth.isAdmin()) {
                    this.renderMonthlyFinancialChart();
                    this.renderMonthlyVolumeChart();
                    this._updateBestMonthCard('monthly-best-month', 'monthly-best-month-value',
                        new Date().getFullYear());
                }
            });
        }

        const refreshAnnualBtn = document.getElementById('refresh-annual-chart');
        if (refreshAnnualBtn) {
            refreshAnnualBtn.addEventListener('click', () => {
                if (Auth.isAdmin()) {
                    this.updateHistoricalAnnual();
                }
            });
        }

        const refreshHistoricalBtn = document.getElementById('refresh-historical-chart');
        if (refreshHistoricalBtn) {
            refreshHistoricalBtn.addEventListener('click', () => {
                if (Auth.isAdmin()) {
                    this.updateHistoricalAnnual();
                }
            });
        }

        // --- Selector de año para Año histórico ---
        const yearSelector = document.getElementById('year-selector');
        if (yearSelector) {
            yearSelector.addEventListener('change', () => {
                if (Auth.isAdmin()) {
                    this.updateHistoricalAnnual();
                }
            });
        }

        const today = DateUtil.today();
        if (dateSelect) dateSelect.value = today;
    }

    refreshDashboard() {
        const today = DateUtil.today();
        const dateSelect = document.getElementById('report-date-select');
        if (dateSelect) dateSelect.value = today;

        this.updateDailyReport();
        this.renderDailyFinancialChart();
        this.renderDailyVolumeChart();
        this.renderDailySalesChart();

        if (Auth.isAdmin()) {
            this._renderPeriodReports();
        }

        Toast.success('Dashboard actualizado para el día de hoy');
    }

    // ============================================================
    //  ACCESO PROTEGIDO A REPORTES PARA PERFIL INVITADO
    //  El Invitado ve la pestaña de Reportes (clase guest-allowed),
    //  pero al hacer clic debe introducir la contraseña del
    //  Administrador. Si es correcta, accede a los reportes; si
    //  no, permanece en el módulo de ventas.
    // ============================================================

    showReportsPasswordModal() {
        const modal = document.getElementById('reports-password-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        const input = document.getElementById('reports-admin-password');
        const errorEl = document.getElementById('reports-password-error');
        if (input) {
            input.value = '';
            input.disabled = false;
            input.readOnly = false;
        }
        if (errorEl) errorEl.textContent = '';
        setTimeout(() => {
            if (input) {
                input.focus();
                input.select();
            }
        }, 50);
    }

    hideReportsPasswordModal() {
        const modal = document.getElementById('reports-password-modal');
        if (modal) modal.classList.add('hidden');
    }

    bindReportsAccessModal() {
        const modal = document.getElementById('reports-password-modal');
        const confirmBtn = document.getElementById('confirm-reports-access');
        const cancelBtn = document.getElementById('cancel-reports-access');
        const input = document.getElementById('reports-admin-password');
        const errorEl = document.getElementById('reports-password-error');

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                const password = input?.value || '';
                if (Auth.verifyAdminPassword(password)) {
                    this.hideReportsPasswordModal();
                    const navItems = document.querySelectorAll('.nav-item');
                    const reportsItem = document.querySelector('.nav-item[data-section="reports"]');
                    navItems.forEach(i => i.classList.remove('active'));
                    if (reportsItem) reportsItem.classList.add('active');
                    this.switchSection('reports');
                    Toast.success('Acceso a reportes concedido');
                } else {
                    if (errorEl) {
                        errorEl.textContent = 'Contraseña incorrecta. Acceso denegado.';
                    }
                    setTimeout(() => {
                        if (errorEl) errorEl.textContent = '';
                    }, 3000);
                    this.hideReportsPasswordModal();
                }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.hideReportsPasswordModal();
            });
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideReportsPasswordModal();
                }
            });
        }

        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmBtn?.click();
                }
            });
        }
    }

    // Renderizar el consolidado diario para la fecha indicada
    renderDailyConsolidated(date = null) {
        const container = document.getElementById('daily-consolidated-container');
        if (!container) return;

        ReportService.setLastKnownDate(ReportService.getDailyDate(date));
        const report = ReportService.getConsolidatedDaily(date);
        container.innerHTML = ReportService.formatConsolidatedHTML(report);

        if (Auth.isAdmin()) {
            report.sessions.forEach(s => {
                this.loadSessionDetail(s.sessionId, s);
            });
        }

        this.renderCategoryBreakdownReport();
    }

    // ============================================================
    //  DESGLOSE POR CATEGORÍA Y PRODUCTOS MÁS VENDIDOS
    //  Se calcula sobre el historial maestro de ventas (todos los
    //  períodos disponibles) y se actualiza dinámicamente al
    //  confirmar una nueva venta (ver updateDailyReport).
    // ============================================================

    // Renderiza las tarjetas numéricas por categoría + gráfica de barras,
    // y el Top 5 de productos más vendidos + su gráfica de barras.
    renderCategoryBreakdownReport() {
        if (!Auth.isAdmin()) return;

        const section = document.getElementById('category-breakdown-section');
        if (!section) return;

        // Sólo recalcular cuando la vista de Reportes está activa: así las
        // métricas se actualizan dinámicamente al confirmar una venta (mientras
        // se consulta el módulo) sin recorrer todo el histórico en cada venta.
        const reportsSection = document.getElementById('reports-section');
        if (!reportsSection || !reportsSection.classList.contains('active')) return;

        const report = ReportService.getCategorySales();
        const top = ReportService.getTopProducts(5);

        const fmt = (v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : '$0.00');

        // --- Tarjetas dinámicas por categoría ---
        const cardsContainer = document.getElementById('category-breakdown-cards');
        if (cardsContainer) {
            if (report.categories.length === 0) {
                cardsContainer.innerHTML = '<p class="empty-text">Sin ventas registradas</p>';
            } else {
                cardsContainer.innerHTML = report.categories.map(c => `
                    <div class="report-card">
                        <h3>${this.escapeHtml(c.category)}</h3>
                        <p class="report-value">${c.pieces}</p>
                        <span class="report-subvalue">${fmt(c.revenue)}</span>
                    </div>
                `).join('');
            }
        }

        const totalEl = document.getElementById('category-pieces-total');
        if (totalEl) totalEl.textContent = `${report.totalPieces} piezas · ${fmt(report.totalRevenue)}`;

        // --- Gráfica: piezas vendidas por categoría ---
        this._renderCategoryBreakdownChart(report.categories);

        // --- Lista dinámica: Top 5 productos ---
        const listContainer = document.getElementById('top-products-list');
        if (listContainer) {
            if (top.length === 0) {
                listContainer.innerHTML = '<p class="empty-text">Sin ventas registradas</p>';
            } else {
                listContainer.innerHTML = top.map((p, i) => `
                    <div class="top-product-card report-card">
                        <h3>
                            <span class="top-product-rank">${i + 1}</span>
                            ${this.escapeHtml(p.description || 'Producto')}
                        </h3>
                        <p class="report-value">${p.quantity}</p>
                        <span class="report-subvalue">${fmt(p.revenue)}</span>
                    </div>
                `).join('');
            }
        }

        const subEl = document.getElementById('top-products-subtitle');
        if (subEl) subEl.textContent = `${top.length} productos en el ranking`;

        // --- Gráfica: top 5 productos ---
        this._renderTopProductsChart(top);
    }

    // Gráfica de barras: piezas vendidas por categoría
    _renderCategoryBreakdownChart(categories) {
        const container = document.getElementById('category-breakdown-chart-container');
        if (!container || !categories.length) return;
        const labels = categories.map(c => c.category);
        const data = categories.map(c => c.pieces);
        this._renderVolumeChart(
            container, 'category-breakdown-chart', 'chartCategorias', labels, data
        );
    }

    // Gráfica de barras: top productos más vendidos
    _renderTopProductsChart(products) {
        const container = document.getElementById('top-products-chart-container');
        if (!container || !products.length) return;
        const labels = products.map(p => {
            const d = p.description || 'Producto';
            return d.length > 24 ? d.substring(0, 22) + '…' : d;
        });
        const data = products.map(p => p.quantity);
        this._renderVolumeChart(
            container, 'top-products-chart', 'chartTopProducts', labels, data
        );
    }

    // Alternar visibilidad del detalle individual de una sesión/corte
    toggleSessionDetail(sessionId) {
        const detail = document.getElementById(`detail-${sessionId}`);
        if (detail) {
            detail.classList.toggle('hidden');
        }
    }

    // Cargar el detalle individual de una sesión en el contenedor
    loadSessionDetail(sessionId, sessionReport) {
        const detailEl = document.getElementById(`detail-${sessionId}`);
        if (!detailEl) return;

        const session = ReportService.getDailySessions().find(
            s => s.id === sessionId || s.sessionId === sessionId
        ) || Cut.getSessionHistory().find(s => s.id === sessionId);

        if (!session) return;

        const sales = ReportService.getSessionSalesDetail(session);

        let salesHtml = '';
        if (sales.length === 0) {
            salesHtml = '<p class="empty-text">No hay ventas en esta sesión</p>';
        } else {
            salesHtml = `
                <table class="session-detail-table">
                    <thead>
                        <tr>
                            <th>Folio</th>
                            <th>Hora</th>
                            <th>Producto(s)</th>
                            <th>Cant.</th>
                            <th>Total</th>
                            <th>Pago</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sales.map(s => `
                            <tr>
                                <td class="barcode-cell">${s.id}</td>
                                <td>${s.time}</td>
                                <td>
                                    ${s.items.map(i => `${i.description} (${i.quantity}x)`).join('<br>')}
                                </td>
                                <td class="qty-cell">${s.itemCount}</td>
                                <td class="amount-cell">$${s.total.toFixed(2)}</td>
                                <td>${s.paymentMethod === 'cash' ? 'Efectivo' : s.paymentMethod === 'card' ? 'Tarjeta' : s.paymentMethod === 'mixed' ? 'Mixto' : s.paymentMethod === 'transfer' ? 'Transferencia' : s.paymentMethod}</td>
                                <td class="action-cell">
                                    <button class="btn btn-icon btn-sm"
                                            onclick="window.app.reprintTicket('${s.id}')"
                                            title="Reimprimir ticket">
                                        ↻
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        detailEl.innerHTML = `
            <div class="session-detail-content">
                <div class="session-detail-summary">
                    <div class="detail-row">
                        <span class="detail-label">Monto Inicial</span>
                        <span class="detail-value">$${sessionReport.initialAmount.toFixed(2)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Ventas en Sesión</span>
                        <span class="detail-value">${sessionReport.salesInSession}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Total Ventas</span>
                        <span class="detail-value">$${sessionReport.totalSales.toFixed(2)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Efectivo</span>
                        <span class="detail-value">$${sessionReport.cashSales.toFixed(2)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Tarjeta</span>
                        <span class="detail-value">$${sessionReport.cardSales.toFixed(2)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Caja Final</span>
                        <span class="detail-value gold">$${sessionReport.closingAmount.toFixed(2)}</span>
                    </div>
                </div>
                <div class="session-detail-sales">
                    <h5>Transacciones (${sales.length})</h5>
                    ${salesHtml}
                </div>
            </div>
        `;
    }

    // Exportar el consolidado diario como archivo
    exportDailyReport() {
        const dateSelect = document.getElementById('report-date-select');
        const date = dateSelect ? dateSelect.value : null;
        const report = ReportService.getConsolidatedDaily(date);

        const reportWithDetails = {
            ...report,
            sessions: report.sessions.map(s => ({
                sessionId: s.sessionId,
                cashier: s.cashier,
                date: s.date,
                initialAmount: s.initialAmount,
                totalSales: s.totalSales,
                cashSales: s.cashSales,
                cardSales: s.cardSales,
                closingAmount: s.closingAmount,
                transactionCount: s.transactionCount,
                salesInSession: s.salesInSession,
                profit: s.profit,
                margin: s.margin,
                isOpen: s.isOpen,
                formattedOpenTime: s.formattedOpenTime,
                formattedCloseTime: s.formattedCloseTime
            }))
        };

        Backup.exportReportFile(reportWithDetails, 'json');
    }

        // Handler del evento de cambio de día automático
    async onDayChange(fromDate, toDate) {
        this.updateDailyReport();
        this.renderDailyConsolidated(toDate);
        this.updateRoleVisibility();

        // NOTA: El envío de reporte por correo NO es automático.
        // Solo se activa al hacer clic en "Enviar Registro al Correo"
        // dentro del modal de Cierre de Caja (bindSummaryEvents).

        if (typeof alert !== 'undefined' && toDate > fromDate) {
            alert(`Cambio de día: ${fromDate} → ${toDate}\nLos cortes y ventas del día previo se han consolidado.`);
        }
    }

    // Indicador de stock bajo: muestra notificación en el buscador de inventario
    updateLowStockIndicator() {
        const lowStock = Inventory.getLowStockProducts();
        if (lowStock.length === 0) return;

        const lowStockText = lowStock.map(p => `${p.description} (${p.stock})`).join(', ');
        const inventorySection = document.getElementById('inventory-section');
        if (!inventorySection || !inventorySection.classList.contains('active')) return;

        let notice = document.getElementById('low-stock-notice');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'low-stock-notice';
            notice.className = 'low-stock-notice';
            inventorySection.insertBefore(notice, inventorySection.firstChild);
        }
        notice.innerHTML = `⚠️ Productos con stock bajo: ${lowStockText}`;
    }

    renderInventoryResults(products) {
        const grid = document.getElementById('inventory-grid');
        if (!grid) return;

        const canViewCosts = Auth.canViewCosts();
        const lowStockThreshold = Settings.getSettings().lowStockThreshold || 5;
        grid.innerHTML = '';

        if (products.length === 0) {
            grid.innerHTML = '<p class="empty-text">No se encontraron productos</p>';
            return;
        }

        products.forEach(product => {
            const card = document.createElement('div');
            card.className = 'inventory-card';
            const isLowStock = product.stock <= lowStockThreshold;
            if (isLowStock) card.classList.add('low-stock');

            let costHtml = '';
            if (canViewCosts && product.cost) {
                const profit = Inventory.getProfit(product);
                const margin = Inventory.getProfitMargin(product);
                costHtml = `
                    <div class="product-cost">Costo: $${product.cost.toFixed(2)}</div>
                    <div class="product-profit">Ganancia: $${profit.toFixed(2)} (${margin.toFixed(1)}%)</div>
                `;
            }

            const stockClass = isLowStock ? 'stock-low' : '';
            const canDelete = canViewCosts;
            const deleteBtn = canDelete
                ? `<button class="btn btn-icon btn-sm delete-product-btn admin-only" data-barcode="${product.barcode}" title="Borrar producto">×</button>`
                : '';
            card.innerHTML = `
                <div class="product-name">${product.description}</div>
                <div class="product-sku">Código: ${product.barcode}</div>
                <div class="product-category-badge" title="Categoría">${this.escapeHtml(product.category || 'Otros')}</div>
                <div class="product-price">$${product.price.toFixed(2)}</div>
                <div class="product-stock ${stockClass}">Existencia: ${product.stock} unidades${isLowStock ? ' ⚠ Bajo' : ''}</div>
                ${costHtml}
                ${deleteBtn}
            `;
            grid.appendChild(card);

            card.addEventListener('click', () => {
                this.showEditProductModal(product.barcode);
            });

            if (canDelete && card.querySelector('.delete-product-btn')) {
                card.querySelector('.delete-product-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteProduct(product.barcode, product.description);
                });
            }
        });
    }

    deleteProduct(barcode, description) {
        if (!Auth.canModifyInventory()) {
            Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
            return;
        }
        if (confirm(`¿Estás seguro de borrar "${description}" del inventario? No se podrá recuperar.`)) {
            const result = Inventory.remove(barcode);
            if (result.success) {
                this.renderInventoryResults(Inventory.search(''));
                this.updateLowStockIndicator();
            }
        }
    }

    showAddProductModal() {
        const overlay = document.createElement('div');
        overlay.className = 'payment-overlay';
        overlay.innerHTML = `
            <div class="payment-modal">
                <h3 class="payment-title">Nuevo Producto</h3>
                <form id="add-product-form" class="add-product-form">
                    <div class="input-group">
                        <input type="text" name="barcode" placeholder=" " required>
                        <label>Código de Barras</label>
                    </div>
                    <div class="input-group">
                        <input type="text" name="description" placeholder=" " required>
                        <label>Descripción del Producto</label>
                    </div>
                    <div class="input-group">
                        <input type="number" name="price" step="0.01" min="0" placeholder=" " required>
                        <label>Precio Venta</label>
                    </div>
                    <div class="input-group">
                        <input type="number" name="stock" min="0" placeholder=" " required>
                        <label>Existencia Inicial</label>
                    </div>
                     <div class="input-group">
                         ${Inventory.renderCategorySelect('Otros')}
                         <label>Categoría</label>
                     </div>
                     <div class="input-group admin-only-field">
                         <input type="number" name="cost" step="0.01" min="0" placeholder=" ">
                         <label>Costo de Adquisición</label>
                     </div>
                    <div class="input-group">
                        <div class="checkbox-group" style="margin-top: 12px;">
                            <input type="checkbox" id="product-volume-pricing" name="aplicaPromocion" value="1" style="margin-right: 8px;">
                            <label for="product-volume-pricing" style="position: static; transform: none; background: none; padding: 0; display: inline;">
                                Precio Mayoreo por Volumen
                            </label>
                        </div>
                        <p class="volume-help-text-small">
                            Aplica precios automáticos según la cantidad agregada
                            (configurable en Configuración &gt; Precios por Volumen).
                        </p>
                    </div>
                    <div class="payment-actions" style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button type="button" class="btn btn-outline" id="cancel-add">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Guardar</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });

        overlay.querySelector('#cancel-add')?.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });

        const form = overlay.querySelector('#add-product-form');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const product = {
                barcode: formData.get('barcode').trim(),
                description: formData.get('description').trim(),
                price: parseFloat(formData.get('price')),
                stock: parseInt(formData.get('stock')),
                cost: formData.get('cost') ? parseFloat(formData.get('cost')) : 0,
                category: formData.get('category') ? formData.get('category').trim() : 'Otros',
                aplicaPromocion: e.target.aplicaPromocion.checked
            };

            const result = Inventory.add(product);
            if (result.success) {
                Toast.success('Producto agregado correctamente');
                Inventory.renderCatalog();
                document.body.removeChild(overlay);
            } else {
                Toast.error(result.error || 'Error al agregar el producto');
            }
        });
    }

    showEditProductModal(barcode) {
        const product = Inventory.findByBarcode(barcode);
        if (!product) {
            Toast.error('Producto no encontrado');
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'payment-overlay';
        overlay.innerHTML = `
            <div class="payment-modal" style="max-width: 500px;">
                <div class="payment-modal-header">
                    <h3 class="payment-title">Editar Producto</h3>
                </div>
                <form id="edit-product-form" class="add-product-form">
                    <div class="input-group">
                        <input type="text" name="barcode" placeholder=" " required value="${this.escapeHtml(product.barcode)}" readonly>
                        <label>Código de Barras</label>
                    </div>
                    <div class="input-group">
                        <input type="text" name="description" placeholder=" " required value="${this.escapeHtml(product.description)}">
                        <label>Descripción del Producto</label>
                    </div>
                    <div class="input-group">
                        <input type="number" name="price" step="0.01" min="0" placeholder=" " required value="${product.price.toFixed(2)}">
                        <label>Precio Venta</label>
                    </div>
                    <div class="input-group">
                        <input type="number" name="stock" min="0" placeholder=" " required value="${product.stock}">
                        <label>Existencia</label>
                    </div>
                    <div class="input-group" style="display: flex; gap: 8px; align-items: flex-end;">
                        <div style="flex: 1;">
                            <input type="number" name="reestock" min="1" placeholder=" " style="width: 100%;">
                            <label style="position: static; transform: none; top: auto; left: auto; background: none; padding: 0; font-size: 12px; color: var(--text-secondary);">Cantidad a reponer</label>
                        </div>
                        <button type="button" class="btn btn-outline btn-sm" id="edit-restock-btn" title="Reponer stock" style="height: 40px; padding: 0 14px;">+</button>
                    </div>
                    <div class="input-group">
                        ${Inventory.renderCategorySelect(product.category || 'Otros')}
                        <label>Categoría</label>
                    </div>
                    <div class="input-group admin-only-field">
                        <input type="number" name="cost" step="0.01" min="0" placeholder=" " value="${product.cost ? product.cost.toFixed(2) : ''}">
                        <label>Costo de Adquisición</label>
                    </div>
                    <div class="input-group">
                        <div class="checkbox-group" style="margin-top: 12px;">
                            <input type="checkbox" id="edit-product-volume-pricing" name="aplicaPromocion" value="1" style="margin-right: 8px;" ${product.aplicaPromocion ? 'checked' : ''}>
                            <label for="edit-product-volume-pricing" style="position: static; transform: none; background: none; padding: 0; display: inline;">
                                Precio Mayoreo por Volumen
                            </label>
                        </div>
                        <p class="volume-help-text-small">
                            Aplica precios automáticos según la cantidad agregada
                            (configurable en Configuración &gt; Precios por Volumen).
                        </p>
                    </div>
                    <div class="payment-actions" style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button type="button" class="btn btn-outline" id="cancel-edit">Cancelar</button>
                        <button type="submit" class="btn btn-primary">Guardar Cambios</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });

        overlay.querySelector('#cancel-edit')?.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });

        overlay.querySelector('#edit-restock-btn')?.addEventListener('click', () => {
            const stockInput = overlay.querySelector('input[name="stock"]');
            const reestockInput = overlay.querySelector('input[name="reestock"]');
            const currentStock = parseInt(stockInput.value) || 0;
            const reestockQty = parseInt(reestockInput.value) || 0;
            if (reestockQty > 0) {
                stockInput.value = currentStock + reestockQty;
                reestockInput.value = '';
            } else {
                Toast.warning('Ingresa una cantidad válida para reponer');
            }
        });

        const form = overlay.querySelector('#edit-product-form');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const product = Inventory.findByBarcode(barcode);
            if (!product) {
                Toast.error('Producto no encontrado');
                document.body.removeChild(overlay);
                return;
            }

            const stock = parseInt(formData.get('stock'));
            const updatedProduct = {
                description: formData.get('description').trim(),
                price: parseFloat(formData.get('price')) || 0,
                stock: isNaN(stock) ? 0 : stock,
                cost: formData.get('cost') ? parseFloat(formData.get('cost')) : 0,
                category: formData.get('category') ? formData.get('category').trim() : 'Otros',
                aplicaPromocion: form.aplicaPromocion.checked
            };

            const result = Inventory.update(barcode, updatedProduct);
            if (result.success) {
                Toast.success('Producto actualizado correctamente');
                this.renderInventoryResults(Inventory.search(''));
                this.updateLowStockIndicator();
                document.body.removeChild(overlay);
            } else {
                Toast.error(result.error || 'Error al actualizar el producto');
            }
        });
    }

    bindSettingsEvents() {
        const saveSettingsBtn = document.getElementById('save-settings-btn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => {
                if (!Auth.canAccessConfig()) {
                    Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                const emailInput = document.getElementById('admin-email-input');

                let saved = false;
                if (emailInput && emailInput.value) {
                    Auth.setAdminEmail(emailInput.value.trim());
                    saved = true;
                }

                // Guardar configuración de la tienda
                const nameEl = document.getElementById('store-name-input');
                const addressEl = document.getElementById('store-address-input');
                const phoneEl = document.getElementById('store-phone-input');
                const headerEl = document.getElementById('receipt-header-input');
                const footerEl = document.getElementById('receipt-footer-input');

                 const settings = Settings.getSettings();
                 if (nameEl) { settings.storeName = nameEl.value.trim() || settings.storeName; saved = true; }
                 if (addressEl) { settings.storeAddress = addressEl.value.trim(); saved = true; }
                 if (phoneEl) { settings.storePhone = phoneEl.value.trim(); saved = true; }

                  const rfcEl = document.getElementById('store-rfc-input');
                  if (rfcEl) { settings.storeRfc = rfcEl.value.trim(); saved = true; }

                   // Guardar datos bancarios de transferencia
                   const transferBankEl = document.getElementById('settings-transfer-bank-input');
                   const transferClabeEl = document.getElementById('settings-transfer-clabe-input');
                   const transferHolderEl = document.getElementById('settings-transfer-holder-input');
                   if (transferBankEl || transferClabeEl || transferHolderEl) {
                       BankData.saveBankData({
                           bank: transferBankEl ? transferBankEl.value.trim() : '',
                           clabe: transferClabeEl ? transferClabeEl.value.trim() : '',
                           holder: transferHolderEl ? transferHolderEl.value.trim() : ''
                       });
                       saved = true;
                   }

                 if (headerEl) { settings.receiptHeader = headerEl.value.trim() || settings.receiptHeader; saved = true; }
                 if (footerEl) { settings.receiptFooter = footerEl.value.trim() || settings.receiptFooter; saved = true; }

                 const showCashierEl = document.getElementById('receipt-show-cashier');
                 if (showCashierEl) { settings.receiptShowCashier = showCashierEl.checked; saved = true; }
                 const showDateEl = document.getElementById('receipt-show-date');
                 if (showDateEl) { settings.receiptShowDate = showDateEl.checked; saved = true; }
                 const showPaymentMethodEl = document.getElementById('receipt-show-payment-method');
                 if (showPaymentMethodEl) { settings.receiptShowPaymentMethod = showPaymentMethodEl.checked; saved = true; }
                 const showPaymentDetailsEl = document.getElementById('receipt-show-payment-details');
                 if (showPaymentDetailsEl) { settings.receiptShowPaymentDetails = showPaymentDetailsEl.checked; saved = true; }

                 const stockEl = document.getElementById('low-stock-input');
                 if (stockEl && stockEl.value) {
                     settings.lowStockThreshold = parseInt(stockEl.value) || 5;
                     saved = true;
                 }

                   Settings.saveSettings(settings);
                   Business.setBusinessName(settings.storeName);

                  // Guardar configuración de EmailJS
                  const emailJSCtrl = this.saveEmailJSConfig();
                  if (emailJSCtrl) {
                      saved = true;
                  }

                  this.updateCredentialsDisplay();
                 this.updateRoleVisibility();
                 if (saved) {
                     Toast.success('Configuración guardada correctamente');
                 }
             });
         }

         const adminEmailInput = document.getElementById('admin-email-input');
         if (adminEmailInput) {
             adminEmailInput.value = Auth.getAdminEmail();
         }

         const changeAdminPassBtn = document.getElementById('change-admin-pass-btn');
         if (changeAdminPassBtn) {
             changeAdminPassBtn.addEventListener('click', () => {
                 this.changeAdminPassword();
             });
         }

         const changeGuestKeyBtn = document.getElementById('change-guest-key-btn');
         if (changeGuestKeyBtn) {
             changeGuestKeyBtn.addEventListener('click', () => {
                 this.changeGuestKey();
             });
         }

         this.renderStoreSettings();
         this.bindLogoUpload();
         this.updateCredentialsDisplay();

           const testEmailBtn = document.getElementById('test-email-btn');
           if (testEmailBtn) {
               testEmailBtn.addEventListener('click', async () => {
                   if (!Auth.isAdmin()) {
                       Toast.warning('Permiso denegado: esta acción requiere privilegios de administrador');
                       return;
                   }

                   const originalText = testEmailBtn.textContent;
                   testEmailBtn.disabled = true;
                   testEmailBtn.textContent = 'Enviando...';

                   try {
                       const report = Backup.generateDailyReport();
                       const config = Backup.getEmailConfig();
                       const valid = config && config.publicKey && config.serviceId && config.templateId;
                       if (valid) {
                           const result = await Backup.sendReportEmail(report);
                           Toast.info(result.message || 'Reporte de prueba procesado.');
                       } else {
                           const email = Auth.getAdminEmail();
                           if (!email) {
                               Toast.error('No se ha configurado el correo del administrador');
                               return;
                           }
                           const result = await Backup.sendReportEmail(report);
                           Toast.info(result.message || 'Reporte de prueba procesado.');
                       }
                   } catch (err) {
                       Toast.error('Error al enviar correo de prueba: ' + (err?.message || err));
                   } finally {
                       testEmailBtn.disabled = false;
                       testEmailBtn.textContent = originalText;
                   }
                });
            }

          // --- Respaldo y Restauración (Exportar / Importar .json) ---
          // Módulo 1: sincronización remota y recuperación ante fallos.
          // Requiere privilegios de administrador (Configuración).
          const exportBackupSettingBtn = document.getElementById('export-backup-setting-btn');
          if (exportBackupSettingBtn) {
              exportBackupSettingBtn.addEventListener('click', () => {
                  if (!Auth.canAccessConfig()) {
                      Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                      return;
                  }
                  const result = Backup.createBackup();
                  Toast.success(result.message);
              });
          }

          const importBackupSettingBtn = document.getElementById('import-backup-setting-btn');
          const importBackupSettingFile = document.getElementById('import-backup-setting-file');
          const factoryRestoreCheckbox = document.getElementById('factory-restore-checkbox');
          if (importBackupSettingBtn && importBackupSettingFile) {
              importBackupSettingBtn.addEventListener('click', () => {
                  if (!Auth.canAccessConfig()) {
                      Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                      return;
                  }
                  importBackupSettingFile.click();
              });
              importBackupSettingFile.addEventListener('change', (e) => {
                  this.importBackupFile(e.target.files[0]);
                  e.target.value = '';
              });
          }

          if (factoryRestoreCheckbox) {
              factoryRestoreCheckbox.addEventListener('change', () => {
                  if (importBackupSettingBtn) {
                      importBackupSettingBtn.textContent = factoryRestoreCheckbox.checked
                          ? 'Restaurar (Fábrica)'
                          : 'Importar / Cargar Base de Datos (.json)';
                  }
              });
          }

         }

     // Importar una copia de seguridad .json exportada por el sistema
    async importBackupFile(file) {
        if (!file) return;

        const errorEl = document.getElementById('backup-setting-error');
        const successEl = document.getElementById('backup-setting-success');
        if (errorEl) errorEl.textContent = '';
        if (successEl) successEl.textContent = '';

        const factoryCheckbox = document.getElementById('factory-restore-checkbox');
        const factoryRestore = factoryCheckbox ? factoryCheckbox.checked : false;

        if (factoryRestore) {
            if (!confirm('¿Estás seguro? La Restauración de Fábrica borrará TODOS los datos locales y los reemplazará con los del archivo. Este proceso no se puede deshacer.')) {
                if (factoryCheckbox) factoryCheckbox.checked = false;
                return;
            }
        }

        try {
            const result = await Backup.importFromFile(file, { factoryRestore: factoryRestore });
            if (result.success) {
                const baseMsg = result.factoryRestore
                    ? 'Restauración de fábrica completada.'
                    : 'Datos importados con fusión inteligente por folio/ID.';
                if (successEl) successEl.textContent = baseMsg + ' Recargue la página para aplicar los cambios.';
                Toast.success(result.message + '. Recargue la página para aplicar los cambios.');
                if (factoryCheckbox) factoryCheckbox.checked = false;
            } else {
                if (errorEl) errorEl.textContent = result.error;
                Toast.error(result.error);
            }
        } catch (err) {
            const msg = 'Error al leer el archivo: ' + (err?.message || err);
            if (errorEl) errorEl.textContent = msg;
            Toast.error(msg);
         }
     }

     saveEmailJSConfig() {
        const pubKey = document.getElementById('emailjs-public-key')?.value.trim() || '';
        const serviceId = document.getElementById('emailjs-service-id')?.value.trim() || '';
        const templateId = document.getElementById('emailjs-template-id')?.value.trim() || '';
        // El envío de correos es exclusivamente manual: configuración de EmailJS
        // se guarda, pero NUNCA se dispara automáticamente en ningún flujo.
        const autoSend = false;

        if (!pubKey && !serviceId && !templateId) {
            return false;
        }

        const config = { publicKey: pubKey, serviceId, templateId, enabled: autoSend };
        Backup.saveEmailConfig(config);
        Backup.initEmailJS();
        return true;
    }

    // Renderizar la vista previa del logotipo
    renderLogoPreview(logoData) {
        const preview = document.getElementById('logo-preview');
        const placeholder = document.getElementById('logo-placeholder');
        const container = document.getElementById('logo-preview-container');

        if (preview && placeholder && container) {
            if (logoData) {
                preview.src = logoData;
                preview.style.display = 'block';
                placeholder.style.display = 'none';
                container.classList.add('active');
            } else {
                preview.src = '';
                preview.style.display = 'none';
                placeholder.style.display = 'flex';
                container.classList.remove('active');
            }
        }
    }

    // Vincular eventos de carga y eliminación de logotipo
    bindLogoUpload() {
        if (this.logoUploadBound) return;
        this.logoUploadBound = true;

        const uploadInput = document.getElementById('store-logo-input');
        const uploadBtn = document.getElementById('logo-upload-btn');
        const removeBtn = document.getElementById('logo-remove-btn');

        if (uploadBtn && uploadInput) {
            uploadBtn.addEventListener('click', () => {
                uploadInput.click();
            });
        }

        if (uploadInput) {
            uploadInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                if (!file.type.startsWith('image/')) {
                    Toast.error('El archivo seleccionado no es una imagen válida');
                    return;
                }

                if (file.size > 500 * 1024) {
                    Toast.error('El logotipo no debe superar los 500 KB');
                    return;
                }

                const reader = new FileReader();
                reader.onload = (ev) => {
                    const logoData = ev.target.result;
                    try {
                        Settings.update('storeLogo', logoData);
                    } catch {
                        return; // SafeStorage ya mostró el aviso de espacio lleno
                    }
                    this.renderLogoPreview(logoData);
                    Toast.success('Logotipo actualizado correctamente');
                };
                reader.readAsDataURL(file);
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                Settings.update('storeLogo', '');
                this.renderLogoPreview('');
                Toast.success('Logotipo eliminado');
            });
        }
    }

    updateCredentialsDisplay() {
        if (!Auth.isAdmin()) return;

        const creds = Auth.getCredentials();
        const adminUserEl = document.getElementById('display-admin-user');
        const guestKeyEl = document.getElementById('display-guest-key');

        if (adminUserEl) adminUserEl.textContent = creds.adminUsername;
        if (guestKeyEl) guestKeyEl.textContent = creds.guestKey;
    }

    changeAdminPassword() {
        const currentPass = document.getElementById('admin-current-pass')?.value || '';
        const newPass = document.getElementById('admin-new-pass')?.value || '';
        const confirmPass = document.getElementById('admin-confirm-pass')?.value || '';

        const result = Auth.changeAdminPassword(currentPass, newPass, confirmPass);
        const errorEl = document.getElementById('settings-error');
        const successEl = document.getElementById('settings-success');

        if (result.success) {
            if (successEl) successEl.textContent = result.message;
            if (errorEl) errorEl.textContent = '';
            this.clearSettingsFields(['admin-current-pass', 'admin-new-pass', 'admin-confirm-pass']);
        } else {
            if (errorEl) errorEl.textContent = result.error;
            if (successEl) successEl.textContent = '';
        }

        setTimeout(() => {
            if (errorEl) errorEl.textContent = '';
            if (successEl) successEl.textContent = '';
        }, 4000);
    }

    changeGuestKey() {
        const currentKey = document.getElementById('guest-current-key')?.value || '';
        const newKey = document.getElementById('guest-new-key')?.value || '';
        const confirmKey = document.getElementById('guest-confirm-key')?.value || '';

        const result = Auth.changeGuestKey(currentKey, newKey, confirmKey);
        const errorEl = document.getElementById('settings-error');
        const successEl = document.getElementById('settings-success');

        if (result.success) {
            if (successEl) successEl.textContent = result.message;
            if (errorEl) errorEl.textContent = '';
            this.clearSettingsFields(['guest-current-key', 'guest-new-key', 'guest-confirm-key']);
            this.updateCredentialsDisplay();
        } else {
            if (errorEl) errorEl.textContent = result.error;
            if (successEl) successEl.textContent = '';
        }

        setTimeout(() => {
            if (errorEl) errorEl.textContent = '';
            if (successEl) successEl.textContent = '';
        }, 4000);
    }

    clearSettingsFields(ids) {
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }

    // ============================================================
    //  EVENTOS DEL MÓDULO POS
    //  Incluye: escáner en segundo plano, búsqueda de productos,
    //  ventas en espera, y precios de volumen.
    // ============================================================

    bindPosEvents() {
        // Escáner de código de barras: escucha activa en segundo plano
        BarcodeScanner.startListening((barcode) => {
            this.handleBarcodeScan(barcode);
        });
        BarcodeScanner.keepFocusOnSales();

        // Renderizar contador de ventas en espera
        this.updateHeldSalesButton();
    }

    // --- Ventas en espera ---

    updateHeldSalesButton() {
        const countEl = document.getElementById('held-count');
        const count = HeldSales.getCount();
        if (countEl) {
            countEl.textContent = count;
            // Mostrar/ocultar el botón si no hay ventas en espera
            const btn = document.getElementById('held-sales-btn');
            if (btn) btn.classList.toggle('hidden', count === 0 && !btn.classList.contains('always-visible'));
        }
    }

    // Pausar la venta actual mostrando el modal de nota
    holdCurrentSale() {
        if (this.cart.isEmpty()) {
            Toast.warning('No hay productos en la venta para pausar');
            return;
        }

        const overlay = document.getElementById('pause-sale-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            const noteInput = document.getElementById('pause-note-input');
            if (noteInput) noteInput.value = '';
        }
    }

    bindPauseEvents() {
        // Vincular el botón "Pausar Venta" de la barra de herramientas
        const pauseBtn = document.getElementById('pause-sale-btn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => {
                this.holdCurrentSale();
            });
        }

        const overlay = document.getElementById('pause-sale-overlay');
        const cancelBtn = document.getElementById('cancel-pause-btn');
        const confirmBtn = document.getElementById('confirm-pause-btn');

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                if (overlay) overlay.classList.add('hidden');
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                const noteInput = document.getElementById('pause-note-input');
                const note = noteInput ? noteInput.value.trim() : '';

                // Guardar los items del carrito como venta en espera
                HeldSales.hold(this.cart.getCartData().items, note);
                this.cart.clear();

                if (overlay) overlay.classList.add('hidden');
                this.updateHeldSalesButton();
                BarcodeScanner.focusInput();

                Toast.info('Venta pausada correctamente. Puedes atender a otro cliente.');
            });
        }

        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.add('hidden');
                }
            });
        }
    }

    // Mostrar el panel de ventas en espera
    showHeldSalesModal() {
        const overlay = document.getElementById('held-sales-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            this.renderHeldSales();
        }
    }

    // Renderizar la lista de ventas pausadas
    renderHeldSales() {
        const list = document.getElementById('held-sales-list');
        if (!list) return;

        const heldSales = HeldSales.getAll();

        if (heldSales.length === 0) {
            list.innerHTML = '<p class="empty-text">No hay ventas en espera</p>';
            return;
        }

        list.innerHTML = '';
        heldSales.forEach(held => {
            const card = document.createElement('div');
            card.className = 'held-sale-card';
            const time = new Date(held.date).toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit'
            });
            const shortId = held.id.substring(5, 15);

            card.innerHTML = `
                <div class="held-sale-info">
                    <div class="held-sale-id">ID: ${shortId}</div>
                    <div class="held-sale-details">
                        <span>${held.itemCount} piezas • $${held.subtotal.toFixed(2)}</span>
                        <span class="held-sale-time">${time}</span>
                    </div>
                    ${held.note ? `<div class="held-sale-note">Nota: ${held.note}</div>` : ''}
                </div>
                <div class="held-sale-actions">
                    <button class="btn btn-icon btn-sm" data-action="retrieve" data-id="${held.id}" title="Recuperar venta">
                        ↺
                    </button>
                    <button class="btn btn-icon btn-sm" data-action="remove" data-id="${held.id}" title="Eliminar venta">
                        ×
                    </button>
                </div>
            `;
            list.appendChild(card);
        });

        // Vincular botones de recuperar
        list.querySelectorAll('[data-action="retrieve"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                this.resumeHeldSale(id);
            });
        });

        // Vincular botones de eliminar
        list.querySelectorAll('[data-action="remove"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                if (confirm('¿Eliminar esta venta pausada? No se podrá recuperar.')) {
                    HeldSales.remove(id);
                    this.renderHeldSales();
                    this.updateHeldSalesButton();
                }
            });
        });
    }

    bindHeldSalesEvents() {
        const btn = document.getElementById('held-sales-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                this.showHeldSalesModal();
            });
        }

        const closeBtn = document.getElementById('close-held-sales-btn');
        const overlay = document.getElementById('held-sales-overlay');

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (overlay) overlay.classList.add('hidden');
            });
        }

        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.add('hidden');
                }
            });
        }
    }

    // Recuperar una venta pausada al carrito actual
    resumeHeldSale(id) {
        const held = HeldSales.retrieve(id);
        if (!held) return;

        // Si el carrito no está vacío, pedir confirmación
        if (!this.cart.isEmpty()) {
            if (!confirm('Esto reemplazará los productos actuales en el carrito. ¿Continuar?')) {
                return;
            }
        }

        this.cart.restoreFromData({ items: held.items });

        // Cerrar panel y actualizar UI
        const overlay = document.getElementById('held-sales-overlay');
        if (overlay) overlay.classList.add('hidden');

        this.updateHeldSalesButton();
        BarcodeScanner.focusInput();
        Toast.success('Venta recuperada correctamente');
    }

    // ============================================================
    //  MÓDULO DE DEVOLUCIONES Y ANULACIONES
    //  - Devolución de piezas: reintegra stock y registra ajuste en caja
    //  - Anulación de ventas: revierte montos y stock del día
    //  Ambos son exclusivos del rol Administrador.
    // ============================================================

    bindReturnsEvents() {
        const returnsBtn = document.getElementById('returns-btn');
        if (returnsBtn) {
            returnsBtn.addEventListener('click', () => {
                if (!Auth.canPerformReturns()) {
                    Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                this.showReturnsModal();
            });
        }

        const cancelSaleBtn = document.getElementById('cancel-sale-btn');
        if (cancelSaleBtn) {
            cancelSaleBtn.addEventListener('click', () => {
                if (!Auth.canCancelTickets()) {
                    Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                this.showCancelSaleModal();
            });
        }

        const returnSearch = document.getElementById('return-sale-search');
        if (returnSearch) {
            returnSearch.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                this.renderReturnsSaleList(query);
            });
        }

        const confirmReturnBtn = document.getElementById('confirm-return-btn');
        if (confirmReturnBtn) {
            confirmReturnBtn.addEventListener('click', () => {
                this.processReturn();
            });
        }

        const cancelReturnsBtn = document.getElementById('cancel-returns-btn');
        if (cancelReturnsBtn) {
            cancelReturnsBtn.addEventListener('click', () => {
                this.hideReturnsModal();
            });
        }

        const returnsBackBtn = document.getElementById('returns-back-btn');
        if (returnsBackBtn) {
            returnsBackBtn.addEventListener('click', () => {
                this.switchReturnStep('search');
            });
        }

        const returnsOverlay = document.getElementById('returns-overlay');
        if (returnsOverlay) {
            returnsOverlay.addEventListener('click', (e) => {
                if (e.target === returnsOverlay) {
                    this.hideReturnsModal();
                }
            });
        }

        // Refund method selector buttons
        const refundMethodBtns = document.querySelectorAll('[data-refund-method]');
        refundMethodBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                refundMethodBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Cancel sale search
        const cancelSearch = document.getElementById('cancel-sale-search');
        if (cancelSearch) {
            cancelSearch.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                this.renderCancelSaleList(query);
            });
        }

        const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
        if (confirmCancelBtn) {
            confirmCancelBtn.addEventListener('click', () => {
                this.cancelSaleConfirm();
            });
        }

        const cancelModalCloseBtn = document.getElementById('cancel-modal-close-btn');
        if (cancelModalCloseBtn) {
            cancelModalCloseBtn.addEventListener('click', () => {
                this.hideCancelSaleModal();
            });
        }

        const cancelBackBtn = document.getElementById('cancel-back-btn');
        if (cancelBackBtn) {
            cancelBackBtn.addEventListener('click', () => {
                this.switchCancelStep('search');
            });
        }

        const cancelOverlay = document.getElementById('cancel-sale-overlay');
        if (cancelOverlay) {
            cancelOverlay.addEventListener('click', (e) => {
                if (e.target === cancelOverlay) {
                    this.hideCancelSaleModal();
                }
            });
        }
    }

    // --- Devolución de Piezas ---

    showReturnsModal() {
        const overlay = document.getElementById('returns-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        this.switchReturnStep('search');
        const searchInput = document.getElementById('return-sale-search');
        if (searchInput) {
            searchInput.value = '';
            this.renderReturnsSaleList('');
        }
    }

    hideReturnsModal() {
        const overlay = document.getElementById('returns-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    switchReturnStep(step) {
        const searchStep = document.getElementById('returns-step-search');
        const itemsStep = document.getElementById('returns-step-items');
        const confirmBtn = document.getElementById('confirm-return-btn');

        if (step === 'items') {
            if (searchStep) searchStep.classList.add('hidden');
            if (itemsStep) itemsStep.classList.remove('hidden');
        } else {
            if (searchStep) searchStep.classList.remove('hidden');
            if (itemsStep) itemsStep.classList.add('hidden');
            if (confirmBtn) confirmBtn.disabled = true;
        }
    }

    // Renderizar la lista de ventas activas para buscar devolución
    renderReturnsSaleList(query) {
        const list = document.getElementById('returns-sale-list');
        if (!list) return;

        let sales = SaleService.getAll();
        sales = sales.filter(s => s.status !== 'canceled');

        if (query) {
            sales = sales.filter(s =>
                s.id.toLowerCase().includes(query.toLowerCase()) ||
                s.cashier?.toLowerCase().includes(query.toLowerCase())
            );
        }

        sales = sales.sort((a, b) => new Date(b.date) - new Date(a.date));
        sales = sales.slice(0, 20);

        if (sales.length === 0) {
            list.innerHTML = '<p class="empty-text">No se encontraron ventas</p>';
            return;
        }

        list.innerHTML = '';
        sales.forEach(sale => {
            const card = document.createElement('div');
            card.className = 'returns-sale-card';
            const time = new Date(sale.date).toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit'
            });
            const date = new Date(sale.date).toLocaleDateString('es-MX');
            card.innerHTML = `
                <div class="returns-sale-id">${sale.id} • ${time}</div>
                <div class="returns-sale-meta">
                    ${date} • ${sale.items.length} pieza(s) • $${sale.total.toFixed(2)} • ${sale.cashier || 'N/A'}
                </div>
            `;
            card.addEventListener('click', () => {
                list.querySelectorAll('.returns-sale-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.selectReturnSale(sale);
            });
            list.appendChild(card);
        });
    }

    selectedReturnSale = null;
    currentRefundMethod = 'cash';
    returnItemStates = {};

    selectReturnSale(sale) {
        this.selectedReturnSale = sale;
        this.returnItemStates = {};
        sale.items.forEach(item => {
            this.returnItemStates[item.barcode] = Math.min(1, item.quantity);
        });

        const idEl = document.getElementById('returns-selected-sale-id');
        const metaEl = document.getElementById('returns-selected-sale-meta');
        if (idEl) idEl.textContent = sale.id;

        const date = new Date(sale.date).toLocaleString('es-MX');
        const totalItems = sale.items.reduce((sum, i) => sum + i.quantity, 0);
        if (metaEl) {
            metaEl.innerHTML = `
                <div>Fecha: ${date}</div>
                <div>Total: $${sale.total.toFixed(2)}</div>
                <div>Pago: ${sale.paymentMethod === 'cash' ? 'Efectivo' : sale.paymentMethod === 'card' ? 'Tarjeta' : sale.paymentMethod === 'mixed' ? 'Mixto' : sale.paymentMethod === 'transfer' ? 'Transferencia' : sale.paymentMethod}</div>
                <div>${totalItems} pieza(s) • ${sale.cashier || 'N/A'}</div>
            `;
        }

        this.renderReturnItems(sale);
        this.updateReturnRefundAmount();
        this.switchReturnStep('items');
    }

    renderReturnItems(sale) {
        const container = document.getElementById('returns-items-list');
        if (!container) return;

        container.innerHTML = '';

        sale.items.forEach(item => {
            const maxQty = item.quantity;
            const returnQty = this.returnItemStates[item.barcode] || 0;
            const refundableAmount = (returnQty * item.price).toFixed(2);

            const row = document.createElement('div');
            row.className = 'returns-item';
            row.innerHTML = `
                <div class="returns-item-name">${item.description}</div>
                <div class="returns-item-price">$${item.price.toFixed(2)}</div>
                <div class="returns-item-qty">
                    <label>Devolver:</label>
                    <input type="number" min="0" max="${maxQty}" value="${returnQty}"
                           onchange="window.app.updateReturnItemQty('${item.barcode}', parseInt(this.value))"
                           style="width: 60px; text-align: center;">
                    <span>/ ${maxQty}</span>
                </div>
                <div class="returns-item-amount">$${refundableAmount}</div>
            `;
            container.appendChild(row);
        });
    }

    updateReturnItemQty(barcode, quantity) {
        const sale = this.selectedReturnSale;
        if (!sale) return;
        const item = sale.items.find(i => i.barcode === barcode);
        if (!item) return;

        const qty = Math.max(0, Math.min(quantity, item.quantity));
        this.returnItemStates[barcode] = qty;
        this.updateReturnRefundAmount();
        this.renderReturnItems(sale);
    }

    updateReturnRefundAmount() {
        const sale = this.selectedReturnSale;
        const confirmBtn = document.getElementById('confirm-return-btn');
        const amountEl = document.getElementById('returns-refund-amount');

        if (!sale) return;

        let total = 0;
        sale.items.forEach(item => {
            const qty = this.returnItemStates[item.barcode] || 0;
            total += qty * item.price;
        });

        if (amountEl) amountEl.textContent = `$${total.toFixed(2)}`;
        if (confirmBtn) confirmBtn.disabled = total <= 0;
    }

    processReturn() {
        const sale = this.selectedReturnSale;
        if (!sale) {
            Toast.error('No has seleccionado una venta');
            return;
        }

        const refundMethodBtns = document.querySelectorAll('[data-refund-method]');
        let method = 'cash';
        refundMethodBtns.forEach(btn => {
            if (btn.classList.contains('active')) {
                method = btn.dataset.refundMethod;
            }
        });
        this.currentRefundMethod = method;

        const itemsToReturn = [];
        sale.items.forEach(item => {
            const qty = this.returnItemStates[item.barcode] || 0;
            if (qty > 0) {
                itemsToReturn.push({
                    barcode: item.barcode,
                    description: item.description,
                    quantity: qty,
                    price: item.price,
                    amount: qty * item.price
                });
            }
        });

        if (itemsToReturn.length === 0) {
            Toast.warning('Selecciona al menos una pieza para devolver');
            return;
        }

        const refundAmount = itemsToReturn.reduce((sum, i) => sum + i.amount, 0);
        const noteInput = document.getElementById('return-note-input');
        const note = noteInput ? noteInput.value.trim() : '';

        try {
            // Reabastecer stock
            Inventory.increaseStock(itemsToReturn.map(i => ({
                barcode: i.barcode,
                quantity: i.quantity
            })));

            // Registrar la devolución
            const returnRecord = Returns.add({
                saleId: sale.id,
                items: itemsToReturn,
                refundAmount: refundAmount,
                refundMethod: method,
                note: note
            });

            // Registrar ajuste en caja
            CashAdjustment.add({
                type: 'return',
                amount: -refundAmount,
                description: `Devolución parcial - Venta ${sale.id}`,
                paymentMethod: method,
                relatedSaleId: sale.id,
                note: note
            });

            // Notificar devolución por Telegram
            if (typeof notificarTelegram === 'function' && typeof TelegramNotify !== 'undefined') {
                const firstItem = itemsToReturn[0] || {};
                TelegramNotify.notificarDevolucion({
                    saleId: sale.id,
                    productName: firstItem.description || 'Producto',
                    refundAmount: refundAmount,
                    cashier: returnRecord.cashier || (Auth.getCurrentUser()?.name || 'Invitado'),
                    motivo: note
                });
            }

            Backup.createLocalRecovery('devolución');

            // Actualizar reportes y UI
            this.updateDailyReport();
            this.renderDailyConsolidated();
            this.updateHeldSalesButton();
            BarcodeScanner.focusInput();

            Toast.success(`Devolución procesada - Folio: ${returnRecord.id} | $${refundAmount.toFixed(2)} reembolsados`);
            this.hideReturnsModal();
        } catch (err) {
            Toast.error('Error al procesar la devolución: ' + (err?.message || err));
        }
    }

    // --- Anulación de Ventas (solo admin) ---

    showCancelSaleModal() {
        const overlay = document.getElementById('cancel-sale-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        this.switchCancelStep('search');
        const searchInput = document.getElementById('cancel-sale-search');
        if (searchInput) {
            searchInput.value = '';
            this.renderCancelSaleList('');
        }
    }

    hideCancelSaleModal() {
        const overlay = document.getElementById('cancel-sale-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    switchCancelStep(step) {
        const searchStep = document.getElementById('cancel-step-search');
        const confirmStep = document.getElementById('cancel-step-confirm');
        const confirmBtn = document.getElementById('confirm-cancel-btn');

        if (step === 'confirm') {
            if (searchStep) searchStep.classList.add('hidden');
            if (confirmStep) confirmStep.classList.remove('hidden');
        } else {
            if (searchStep) searchStep.classList.remove('hidden');
            if (confirmStep) confirmStep.classList.add('hidden');
            if (confirmBtn) confirmBtn.disabled = true;
        }
    }

    // Renderizar la lista de ventas para buscar anulación
    renderCancelSaleList(query) {
        const list = document.getElementById('cancel-sale-list');
        if (!list) return;

        let sales = SaleService.getAll(true);
        sales = sales.filter(s => s.status !== 'canceled');

        if (query) {
            sales = sales.filter(s =>
                s.id.toLowerCase().includes(query.toLowerCase()) ||
                s.cashier?.toLowerCase().includes(query.toLowerCase())
            );
        }

        sales = sales.sort((a, b) => new Date(b.date) - new Date(a.date));
        sales = sales.slice(0, 20);

        if (sales.length === 0) {
            list.innerHTML = '<p class="empty-text">No se encontraron ventas</p>';
            return;
        }

        list.innerHTML = '';
        sales.forEach(sale => {
            const card = document.createElement('div');
            card.className = 'cancel-sale-card';
            const time = new Date(sale.date).toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit'
            });
            const date = new Date(sale.date).toLocaleDateString('es-MX');
            card.innerHTML = `
                <div class="cancel-sale-id">${sale.id} • ${time}</div>
                <div class="cancel-sale-meta">
                    ${date} • ${sale.items.length} pieza(s) • $${sale.total.toFixed(2)} • ${sale.cashier || 'N/A'}
                </div>
            `;
            card.addEventListener('click', () => {
                list.querySelectorAll('.cancel-sale-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.selectCancelSale(sale);
            });
            list.appendChild(card);
        });
    }

    selectedCancelSale = null;

    selectCancelSale(sale) {
        this.selectedCancelSale = sale;

        const idEl = document.getElementById('cancel-selected-sale-id');
        const metaEl = document.getElementById('cancel-selected-sale-meta');
        const statusEl = document.querySelector('.cancel-sale-status');
        const reasonInput = document.getElementById('cancel-reason-input');

        if (idEl) idEl.textContent = sale.id;

        const date = new Date(sale.date).toLocaleString('es-MX');
        const totalItems = sale.items.reduce((sum, i) => sum + i.quantity, 0);
        if (metaEl) {
            metaEl.innerHTML = `
                <div>Fecha: ${date}</div>
                <div>Total: $${sale.total.toFixed(2)}</div>
                <div>Pago: ${sale.paymentMethod === 'cash' ? 'Efectivo' : sale.paymentMethod === 'card' ? 'Tarjeta' : sale.paymentMethod === 'mixed' ? 'Mixto' : sale.paymentMethod === 'transfer' ? 'Transferencia' : sale.paymentMethod}</div>
                <div>${totalItems} pieza(s) • ${sale.cashier || 'N/A'}</div>
            `;
        }

        if (statusEl) {
            statusEl.textContent = 'Activa';
            statusEl.className = 'cancel-sale-status active';
        }

        if (reasonInput) reasonInput.value = '';
        this.updateCancelConfirmState();
        this.switchCancelStep('confirm');
    }

    updateCancelConfirmState() {
        const confirmBtn = document.getElementById('confirm-cancel-btn');
        if (confirmBtn) {
            confirmBtn.disabled = !this.selectedCancelSale;
        }
    }

    cancelSaleConfirm() {
        const sale = this.selectedCancelSale;
        if (!sale) {
            Toast.error('No has seleccionado una venta');
            return;
        }

        if (!Auth.canCancelTickets()) {
            Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
            return;
        }

        const reasonInput = document.getElementById('cancel-reason-input');
        const reason = reasonInput ? reasonInput.value.trim() : '';
        if (!reason) {
            if (!confirm('¿Estás seguro de anular esta venta sin motivo?')) {
                return;
            }
        }

        try {
            // Anular la venta en SaleService
            const result = SaleService.cancelSale(sale.id, reason);
            if (!result.success) {
                Toast.error(result.error || 'Error al anular la venta');
                return;
            }

            // Reabastecer stock de los productos involucrados
            Inventory.increaseStock(sale.items.map(i => ({
                barcode: i.barcode,
                quantity: i.quantity
            })));

            // Registrar ajuste en caja (revertir montos del día)
            CashAdjustment.add({
                type: 'cancel',
                amount: -sale.total,
                description: `Anulación de venta ${sale.id}`,
                paymentMethod: sale.paymentMethod,
                relatedSaleId: sale.id,
                note: reason
            });

            Backup.createLocalRecovery('anulación');

            // Actualizar reportes y UI
            this.updateDailyReport();
            this.renderDailyConsolidated();
            this.updateHeldSalesButton();
            BarcodeScanner.focusInput();

            Toast.success(`Venta anulada - Folio: ${sale.id} | $${sale.total.toFixed(2)} revertidos`);
            this.hideCancelSaleModal();
        } catch (err) {
            Toast.error('Error al anular la venta: ' + (err?.message || err));
        }
    }

    // ============================================================
    //  MÓDULO DE CAMBIO POR GARANTÍA / DEFECTO
    //  - Reingreso de pieza defectuosa con estatus "Merma por Garantía / Pieza Rota"
    //  - Salida de pieza de reemplazo (del inventario)
    //  - Impacto contable: $0.00 (ningún movimiento en caja)
    //  - Ajuste físico: descuenta pieza entregada, registra pieza recibida
    //  Disponible para roles Administrador e Invitado.
    // ============================================================

    bindGuaranteeEvents() {
        const guaranteeBtn = document.getElementById('guarantee-btn');
        if (guaranteeBtn) {
            guaranteeBtn.addEventListener('click', () => {
                if (!Auth.canManageGuarantees()) {
                    Toast.warning('Permiso denegado: esta acción no está disponible para tu rol');
                    return;
                }
                this.showGuaranteeModal();
            });
        }

        const guaranteeSearch = document.getElementById('guarantee-sale-search');
        if (guaranteeSearch) {
            guaranteeSearch.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                this.renderGuaranteeSaleList(query);
            });
        }

        const confirmBtn = document.getElementById('guarantee-confirm-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                this.processGuaranteeExchange();
            });
        }

        const cancelBtn = document.getElementById('guarantee-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.hideGuaranteeModal();
            });
        }

        const backBtn = document.getElementById('guarantee-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.switchGuaranteeStep('search');
            });
        }

        const prevBtn = document.getElementById('guarantee-prev-btn');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.switchGuaranteeStep('items');
            });
        }

        const nextBtn = document.getElementById('guarantee-next-btn');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.prepareGuaranteeConfirm();
            });
        }

        const inventorySearch = document.getElementById('guarantee-inventory-search');
        if (inventorySearch) {
            inventorySearch.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                this.renderGuaranteeInventoryResults(query);
            });
        }

        const overlay = document.getElementById('guarantee-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.hideGuaranteeModal();
                }
            });
        }
    }

    showGuaranteeModal() {
        const overlay = document.getElementById('guarantee-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        this.switchGuaranteeStep('search');
        const searchInput = document.getElementById('guarantee-sale-search');
        if (searchInput) {
            searchInput.value = '';
            this.renderGuaranteeSaleList('');
        }
    }

    hideGuaranteeModal() {
        const overlay = document.getElementById('guarantee-overlay');
        if (overlay) overlay.classList.add('hidden');
        this.selectedGuaranteeSale = null;
        this.defectiveItemStates = {};
        this.replacementItems = {};
    }

    switchGuaranteeStep(step) {
        const searchStep = document.getElementById('guarantee-step-search');
        const itemsStep = document.getElementById('guarantee-step-items');
        const confirmStep = document.getElementById('guarantee-step-confirm');
        const cancelBtn = document.getElementById('guarantee-cancel-btn');
        const prevBtn = document.getElementById('guarantee-prev-btn');
        const nextBtn = document.getElementById('guarantee-next-btn');
        const confirmExchangeBtn = document.getElementById('guarantee-confirm-btn');

        if (searchStep) searchStep.classList.add('hidden');
        if (itemsStep) itemsStep.classList.add('hidden');
        if (confirmStep) confirmStep.classList.add('hidden');

        if (prevBtn) prevBtn.classList.add('hidden');
        if (nextBtn) nextBtn.classList.add('hidden');
        if (confirmExchangeBtn) confirmExchangeBtn.classList.add('hidden');

        if (cancelBtn) cancelBtn.classList.remove('hidden');

        if (step === 'search') {
            if (searchStep) searchStep.classList.remove('hidden');
        } else if (step === 'items') {
            if (itemsStep) itemsStep.classList.remove('hidden');
            if (prevBtn) prevBtn.classList.remove('hidden');
            if (nextBtn) nextBtn.classList.remove('hidden');
            const inventorySearch = document.getElementById('guarantee-inventory-search');
            if (inventorySearch) inventorySearch.value = '';
            this.renderGuaranteeInventoryResults('');
        } else if (step === 'confirm') {
            if (confirmStep) confirmStep.classList.remove('hidden');
            if (prevBtn) prevBtn.classList.remove('hidden');
            if (confirmExchangeBtn) confirmExchangeBtn.classList.remove('hidden');
        }

        this.updateGuaranteeNextBtnState();
    }

    updateGuaranteeNextBtnState() {
        const nextBtn = document.getElementById('guarantee-next-btn');
        if (!nextBtn) return;
        const hasDefective = Object.values(this.defectiveItemStates || {}).some(q => q > 0);
        nextBtn.disabled = !hasDefective;
    }

    selectedGuaranteeSale = null;
    defectiveItemStates = {};
    replacementItems = {};

    renderGuaranteeSaleList(query) {
        const list = document.getElementById('guarantee-sale-list');
        if (!list) return;

        let sales = SaleService.getAll();

        if (query) {
            sales = sales.filter(s =>
                s.id.toLowerCase().includes(query.toLowerCase()) ||
                s.cashier?.toLowerCase().includes(query.toLowerCase())
            );
        }

        sales = sales.sort((a, b) => new Date(b.date) - new Date(a.date));
        sales = sales.slice(0, 20);

        if (sales.length === 0) {
            list.innerHTML = '<p class="empty-text">No se encontraron ventas</p>';
            return;
        }

        list.innerHTML = '';
        sales.forEach(sale => {
            const card = document.createElement('div');
            card.className = 'guarantee-sale-card';
            const time = new Date(sale.date).toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit'
            });
            const date = new Date(sale.date).toLocaleDateString('es-MX');
            card.innerHTML = `
                <div class="guarantee-sale-id">${sale.id} • ${time}</div>
                <div class="guarantee-sale-meta">
                    ${date} • ${sale.items.length} pieza(s) • $${sale.total.toFixed(2)} • ${sale.cashier || 'N/A'}
                </div>
            `;
            card.addEventListener('click', () => {
                list.querySelectorAll('.guarantee-sale-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.selectGuaranteeSale(sale);
            });
            list.appendChild(card);
        });
    }

    selectGuaranteeSale(sale) {
        this.selectedGuaranteeSale = sale;
        this.defectiveItemStates = {};
        this.replacementItems = {};

        sale.items.forEach(item => {
            this.defectiveItemStates[item.barcode] = 0;
        });

        const idEl = document.getElementById('guarantee-selected-sale-id');
        const metaEl = document.getElementById('guarantee-selected-sale-meta');
        if (idEl) idEl.textContent = sale.id;

        const date = new Date(sale.date).toLocaleString('es-MX');
        const totalItems = sale.items.reduce((sum, i) => sum + i.quantity, 0);
        if (metaEl) {
            metaEl.innerHTML = `
                <div>Fecha: ${date}</div>
                <div>Total: $${sale.total.toFixed(2)}</div>
                <div>Pago: ${sale.paymentMethod === 'cash' ? 'Efectivo' : sale.paymentMethod === 'card' ? 'Tarjeta' : sale.paymentMethod === 'mixed' ? 'Mixto' : sale.paymentMethod === 'transfer' ? 'Transferencia' : sale.paymentMethod}</div>
                <div>${totalItems} pieza(s) • ${sale.cashier || 'N/A'}</div>
            `;
        }

        this.renderGuaranteeDefectiveItems(sale);
        this.renderGuaranteeReplacementSummary();
        this.updateGuaranteeNextBtnState();
        this.switchGuaranteeStep('items');
    }

    renderGuaranteeDefectiveItems(sale) {
        const container = document.getElementById('guarantee-defective-items');
        if (!container) return;

        container.innerHTML = '';

        sale.items.forEach(item => {
            const maxQty = item.quantity;
            const selectedQty = this.defectiveItemStates[item.barcode] || 0;
            const row = document.createElement('div');
            row.className = 'returns-item';
            row.innerHTML = `
                <div class="returns-item-name">${item.description}</div>
                <div class="returns-item-price">$${item.price.toFixed(2)}</div>
                <div class="returns-item-qty">
                    <label>Defectuosa:</label>
                    <input type="number" min="0" max="${maxQty}" value="${selectedQty}"
                           onchange="window.app.updateDefectiveItemQty('${item.barcode}', parseInt(this.value))"
                           style="width: 60px; text-align: center;">
                    <span>/ ${maxQty}</span>
                </div>
                <div class="returns-item-amount">$${((selectedQty * item.price)).toFixed(2)}</div>
            `;
            container.appendChild(row);
        });
    }

    updateDefectiveItemQty(barcode, quantity) {
        const sale = this.selectedGuaranteeSale;
        if (!sale) return;
        const item = sale.items.find(i => i.barcode === barcode);
        if (!item) return;

        const qty = Math.max(0, Math.min(quantity, item.quantity));
        this.defectiveItemStates[barcode] = qty;
        this.renderGuaranteeDefectiveItems(sale);
        this.updateGuaranteeNextBtnState();
    }

    renderGuaranteeInventoryResults(query) {
        const container = document.getElementById('guarantee-inventory-results');
        if (!container) return;

        let products = query ? Inventory.search(query) : Inventory.getAll();
        products = products.slice(0, 20);

        if (products.length === 0) {
            container.innerHTML = '<p class="empty-text">No se encontraron piezas</p>';
            return;
        }

        container.innerHTML = '';
        products.forEach(product => {
            const isSelected = this.replacementItems[product.barcode] !== undefined;
            const selectedQty = this.replacementItems[product.barcode] || 0;
            const card = document.createElement('div');
            card.className = 'guarantee-inventory-card';
            if (isSelected) card.classList.add('selected');
            card.innerHTML = `
                <div class="guarantee-inventory-name">${product.description}</div>
                <div class="guarantee-inventory-sku">Código: ${product.barcode}</div>
                <div class="product-price">$${product.price.toFixed(2)}</div>
                <div class="product-stock">Existencia: ${product.stock} unidades</div>
                ${product.stock > 0 ? `
                <div class="guarantee-inventory-qty" style="margin-top: 8px;">
                    <label>Cant. a Entregar:</label>
                    <input type="number" min="1" max="${product.stock}" value="${selectedQty || 1}"
                           onchange="window.app.updateReplacementQty('${product.barcode}', parseInt(this.value))"
                           style="width: 60px; text-align: center;">
                </div>
                ` : '<div style="color: var(--danger); font-size: 12px; margin-top: 8px;">Sin stock</div>'}
            `;
            container.appendChild(card);
        });
    }

    updateReplacementQty(barcode, quantity) {
        const product = Inventory.findByBarcode(barcode);
        if (!product) return;

        const qty = Math.max(1, Math.min(quantity, product.stock));
        if (qty > 0) {
            this.replacementItems[barcode] = qty;
        } else {
            delete this.replacementItems[barcode];
        }
        this.renderGuaranteeReplacementSummary();
    }

    renderGuaranteeReplacementSummary() {
        const summary = document.getElementById('guarantee-replacement-summary');
        if (!summary) return;

        const barcodes = Object.keys(this.replacementItems || {});
        if (barcodes.length === 0) {
            summary.innerHTML = '<p class="empty-text">No has seleccionado piezas de reemplazo</p>';
            return;
        }

        let html = '<div class="guarantee-replacement-list">';
        barcodes.forEach(barcode => {
            const product = Inventory.findByBarcode(barcode);
            const qty = this.replacementItems[barcode];
            if (!product) return;
            html += `
                <div class="returns-item">
                    <div class="returns-item-name">${product.description} <span style="color: var(--text-muted); font-size: 11px;">[${barcode}]</span></div>
                    <div class="returns-item-price">$${product.price.toFixed(2)}</div>
                    <div class="returns-item-qty">${qty}x</div>
                    <div class="action-cell">
                        <button onclick="window.app.removeReplacementItem('${barcode}')"
                                class="btn btn-icon btn-sm" title="Quitar">×</button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        summary.innerHTML = html;

        this.updateGuaranteeNextBtnStateWithReplacements();
    }

    updateGuaranteeNextBtnStateWithReplacements() {
        const nextBtn = document.getElementById('guarantee-next-btn');
        if (!nextBtn) return;
        const hasDefective = Object.values(this.defectiveItemStates || {}).some(q => q > 0);
        const hasReplacement = Object.keys(this.replacementItems || {}).length > 0;
        nextBtn.disabled = !hasDefective || !hasReplacement;
    }

    removeReplacementItem(barcode) {
        delete this.replacementItems[barcode];
        this.renderGuaranteeReplacementSummary();
        this.renderGuaranteeInventoryResults('');
        this.updateGuaranteeNextBtnStateWithReplacements();
    }

    prepareGuaranteeConfirm() {
        const sale = this.selectedGuaranteeSale;
        if (!sale) {
            Toast.error('No has seleccionado una venta');
            return;
        }

        const hasDefective = Object.values(this.defectiveItemStates || {}).some(q => q > 0);
        const hasReplacement = Object.keys(this.replacementItems || {}).length > 0;

        if (!hasDefective) {
            Toast.warning('Selecciona al menos una pieza defectuosa');
            return;
        }
        if (!hasReplacement) {
            Toast.warning('Selecciona al menos una pieza de reemplazo');
            return;
        }

        const idEl = document.getElementById('guarantee-confirm-sale-id');
        if (idEl) idEl.textContent = sale.id;

        this.renderGuaranteeConfirmDefective();
        this.renderGuaranteeConfirmReplacement();

        const noteInput = document.getElementById('guarantee-note-input');
        if (noteInput) noteInput.value = '';

        this.switchGuaranteeStep('confirm');
    }

    renderGuaranteeConfirmDefective() {
        const container = document.getElementById('guarantee-confirm-defective-list');
        if (!container) return;

        const sale = this.selectedGuaranteeSale;
        if (!sale) return;

        let html = '';
        sale.items.forEach(item => {
            const qty = this.defectiveItemStates[item.barcode] || 0;
            if (qty > 0) {
                html += `
                    <div class="returns-item">
                        <div class="returns-item-name">${item.description} <span class="sale-canceled-badge">Merma por Garantía / Pieza Rota</span></div>
                        <div class="returns-item-price">$${item.price.toFixed(2)}</div>
                        <div class="returns-item-qty">${qty}x</div>
                        <div class="returns-item-amount">$${(qty * item.price).toFixed(2)}</div>
                    </div>
                `;
            }
        });
        container.innerHTML = html;
    }

    renderGuaranteeConfirmReplacement() {
        const container = document.getElementById('guarantee-confirm-replacement-list');
        if (!container) return;

        let html = '';
        Object.keys(this.replacementItems || {}).forEach(barcode => {
            const product = Inventory.findByBarcode(barcode);
            const qty = this.replacementItems[barcode];
            if (!product) return;
            html += `
                <div class="returns-item">
                    <div class="returns-item-name">${product.description} <span style="color: var(--text-muted); font-size: 11px;">[${barcode}]</span></div>
                    <div class="returns-item-price">$${product.price.toFixed(2)}</div>
                    <div class="returns-item-qty">${qty}x</div>
                    <div class="returns-item-amount">$${(qty * product.price).toFixed(2)}</div>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    processGuaranteeExchange() {
        const sale = this.selectedGuaranteeSale;
        if (!sale) {
            Toast.error('No has seleccionado una venta');
            return;
        }

        if (!Auth.canManageGuarantees()) {
            Toast.warning('Permiso denegado: esta acción no está disponible para tu rol');
            return;
        }

        const defectiveItems = [];
        sale.items.forEach(item => {
            const qty = this.defectiveItemStates[item.barcode] || 0;
            if (qty > 0) {
                defectiveItems.push({
                    barcode: item.barcode,
                    description: item.description,
                    quantity: qty,
                    price: item.price,
                    amount: qty * item.price,
                    status: 'Merma por Garantía / Pieza Rota'
                });
            }
        });

        const replacementItems = [];
        const stockUpdates = [];
        Object.keys(this.replacementItems || {}).forEach(barcode => {
            const product = Inventory.findByBarcode(barcode);
            const qty = this.replacementItems[barcode];
            if (!product) return;
            replacementItems.push({
                barcode: barcode,
                description: product.description,
                quantity: qty,
                price: product.price,
                amount: qty * product.price
            });
            stockUpdates.push({ barcode: barcode, quantity: qty });
        });

        if (defectiveItems.length === 0) {
            Toast.warning('Selecciona al menos una pieza defectuosa');
            return;
        }
        if (replacementItems.length === 0) {
            Toast.warning('Selecciona al menos una pieza de reemplazo');
            return;
        }

        const noteInput = document.getElementById('guarantee-note-input');
        const note = noteInput ? noteInput.value.trim() : '';

        try {
            // Deduct replacement pieces from inventory stock
            Inventory.updateStock(stockUpdates);

            // Guardar el intercambio por garantía (sin movimiento de caja)
            const exchangeRecord = GuaranteeExchange.add({
                saleId: sale.id,
                itemsReceived: defectiveItems,
                itemsDelivered: replacementItems,
                note: note,
                amount: 0,
                cashAdjustment: false
            });

            // Notificar cambio por garantía a Telegram
            if (typeof notificarTelegram === 'function' && typeof TelegramNotify !== 'undefined') {
                TelegramNotify.notificarCambioGarantia(exchangeRecord);
            }

            Backup.createLocalRecovery('garantía');

            // Actualizar reportes y UI
            this.updateDailyReport();
            this.updateHeldSalesButton();
            BarcodeScanner.focusInput();

            Toast.success(`Cambio por garantía registrado - Folio: ${exchangeRecord.id} | $${exchangeRecord.amount.toFixed(2)} en caja (sin movimiento)`);
            this.hideGuaranteeModal();
        } catch (err) {
            Toast.error('Error al registrar el cambio por garantía: ' + (err?.message || err));
        }
    }

    // ============================================================
    //  MÓDULO DE RETIRO PARA DEPÓSITO
    //  - Retiro de efectivo de la caja para depositar en banco
    //    u otra fuente externa
    //  - Registra un ajuste de caja (tipo 'expense') con la
    //    nota explicativa proporcionada
    //  - Impacto: resta del efectivo en efectivo del reporte de caja
    //  - Disponible para roles Administrador e Invitado.
    // ============================================================

    bindWithdrawalEvents() {
        const withdrawalBtn = document.getElementById('withdrawal-btn');
        if (withdrawalBtn) {
            withdrawalBtn.addEventListener('click', () => {
                if (!Auth.canRegisterExpenses()) {
                    Toast.warning('Permiso denegado: esta acción no está disponible para tu rol');
                    return;
                }
                this.showWithdrawalModal();
            });
        }

        const confirmBtn = document.getElementById('withdrawal-confirm-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                this.processWithdrawal();
            });
        }

        const cancelBtn = document.getElementById('withdrawal-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.hideWithdrawalModal();
            });
        }

        const overlay = document.getElementById('withdrawal-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.hideWithdrawalModal();
                }
            });
        }

        const amountInput = document.getElementById('withdrawal-amount-input');
        if (amountInput) {
            amountInput.addEventListener('input', () => {
                this.updateWithdrawalConfirmBtn();
            });
        }
    }

    showWithdrawalModal() {
        const overlay = document.getElementById('withdrawal-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');

        const amountInput = document.getElementById('withdrawal-amount-input');
        const noteInput = document.getElementById('withdrawal-note-input');
        if (amountInput) {
            amountInput.value = '';
        }
        if (noteInput) {
            noteInput.value = '';
        }
        this.updateWithdrawalConfirmBtn();
        setTimeout(() => {
            if (amountInput) amountInput.focus();
        }, 50);
    }

    hideWithdrawalModal() {
        const overlay = document.getElementById('withdrawal-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    updateWithdrawalConfirmBtn() {
        const amountInput = document.getElementById('withdrawal-amount-input');
        const confirmBtn = document.getElementById('withdrawal-confirm-btn');
        if (!confirmBtn || !amountInput) return;

        const amount = parseFloat(amountInput.value);
        confirmBtn.disabled = isNaN(amount) || amount <= 0;
    }

    processWithdrawal() {
        if (!Auth.canRegisterExpenses()) {
            Toast.error('Permiso denegado: esta acción no está disponible para tu rol');
            return;
        }

        const amountInput = document.getElementById('withdrawal-amount-input');
        const noteInput = document.getElementById('withdrawal-note-input');

        const amount = parseFloat(amountInput?.value || 0);
        if (isNaN(amount) || amount <= 0) {
            Toast.error('Ingresa un monto válido mayor a 0');
            return;
        }

        const note = (noteInput?.value || '').trim();

        try {
            const cashierName = Auth.getCurrentUser()?.name || 'Invitado';
            CashAdjustment.add({
                type: 'expense',
                amount: -amount,
                description: 'Retiro para Depósito',
                paymentMethod: 'cash',
                relatedSaleId: null,
                note: note
            });

            if (typeof notificarTelegram === 'function' && typeof TelegramNotify !== 'undefined') {
                TelegramNotify.notificarRetiroEfectivo({
                    amount: amount,
                    cashier: cashierName,
                    note: note
                });
            }

            Backup.createLocalRecovery('retiro para depósito');

            this.updateDailyReport();
            this.renderDailyConsolidated();

            Toast.success(`Retiro para depósito registrado - $${amount.toFixed(2)} | Nota: ${note}`);
            this.hideWithdrawalModal();
        } catch (err) {
            Toast.error('Error al registrar el retiro: ' + (err?.message || err));
        }
    }

    // --- Precios de volumen (configuración admin) ---

    // Renderizar los inputs de rangos de volumen en el panel de admin
    renderVolumePricingTiers() {
        const container = document.getElementById('volume-tiers');
        if (!container) return;

        const tiers = VolumePricing.getTiers();
        let html = '';

        tiers.forEach((tier, index) => {
            html += `
                <div class="volume-tier-row" data-index="${index}">
                    <div class="tier-inputs">
                        <input type="number" min="1" class="tier-min" value="${tier.min}" title="Cantidad mínima">
                        <span class="tier-separator">—</span>
                        <input type="number" min="${tier.min}" class="tier-max" value="${tier.max === null ? '' : tier.max}" title="Cantidad máxima (vacío = sin límite)">
                        <span class="tier-separator">=</span>
                        <input type="number" min="0" step="0.01" class="tier-price" value="${tier.price}" title="Precio unitario">
                    </div>
                    <button class="btn btn-icon btn-sm remove-tier-btn admin-only" data-index="${index}" title="Eliminar rango">×</button>
                </div>
            `;
        });

        container.innerHTML = html;

        // Vincular botones de eliminar rango
        container.querySelectorAll('.remove-tier-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                this.removeVolumeTier(index);
            });
        });
    }

    // Agregar un nuevo rango de volumen
    addVolumeTier() {
        const tiers = VolumePricing.getTiers();
        const lastTier = tiers[tiers.length - 1];
        const newMin = lastTier.max !== null ? lastTier.max + 1 : lastTier.min + 1;
        tiers.push({ min: newMin, max: null, price: 0 });
        VolumePricing.saveTiers(tiers);
        this.renderVolumePricingTiers();
    }

    // Eliminar un rango de volumen (mínimo 1)
    removeVolumeTier(index) {
        const tiers = VolumePricing.getTiers();
        if (tiers.length <= 1) {
            Toast.warning('Debe haber al menos un rango de precio');
            return;
        }
        tiers.splice(index, 1);
        // Re-ordenar los mínimos para mantener coherencia
        let currentMin = 1;
        for (const tier of tiers) {
            tier.min = currentMin;
            currentMin = (tier.max === null ? currentMin + 1 : tier.max + 1);
        }
        VolumePricing.saveTiers(tiers);
        this.renderVolumePricingTiers();
    }

    // Guardar los rangos de volumen desde los inputs del admin
    saveVolumePricing() {
        const container = document.getElementById('volume-tiers');
        if (!container) return;

        const tiers = [];
        const rows = container.querySelectorAll('.volume-tier-row');

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const min = parseInt(row.querySelector('.tier-min').value);
            const maxInput = row.querySelector('.tier-max').value;
            const max = maxInput === '' ? null : parseInt(maxInput);
            const price = parseFloat(row.querySelector('.tier-price').value);

            if (isNaN(min) || isNaN(price)) {
                Toast.error('Verifica que todos los campos estén completos y válidos');
                return;
            }

            tiers.push({ min, max, price });
        }

        // Ordenar por min antes de validar
        tiers.sort((a, b) => a.min - b.min);

        const result = VolumePricing.updateTiers(tiers);
        if (result.success) {
            Toast.success(result.message);
            // Re-renderizar para reflejar el orden
            this.renderVolumePricingTiers();
        } else {
            Toast.error(result.error);
        }
    }

    bindVolumePricingEvents() {
        const saveBtn = document.getElementById('save-volume-pricing-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                if (!Auth.canAccessConfig()) {
                    Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                this.saveVolumePricing();
            });
        }

        const resetBtn = document.getElementById('reset-volume-pricing-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('¿Restablecer precios de volumen por defecto?')) {
                    VolumePricing.resetToDefault();
                    this.renderVolumePricingTiers();
                    Toast.info('Precios de volumen restablecidos por defecto');
                }
            });
        }

        const addBtn = document.getElementById('add-tier-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                if (!Auth.canAccessConfig()) {
                    Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                this.addVolumeTier();
            });
        }

         this.renderVolumePricingTiers();
    }

    // ============================================================
    //  MÓDULO VIP: CLIENTES VIP (PROGRAMA DE FIDELIZACIÓN)
    //  Permite registrar y administrar clientes VIP con nombre,
    //  teléfono (clave de búsqueda), notas, piezas acumuladas,
    //  historial de recompensas y estado actual.
    // ============================================================

    bindVIPEvents() {
        const vipSearch = document.getElementById('vip-search');
        if (vipSearch) {
            vipSearch.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                this.renderVIPTable(query);
            });
        }

        const addVipBtn = document.getElementById('add-vip-btn');
        if (addVipBtn) {
            addVipBtn.addEventListener('click', () => {
                if (!Auth.canModifyInventory()) {
                    Toast.warning('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                this.showAddVIPModal();
            });
        }

        const piecesInput = document.getElementById('vip-pieces-for-free-input');
        if (piecesInput) {
            piecesInput.addEventListener('change', () => {
                if (!Auth.canAccessConfig()) return;
                const value = parseInt(piecesInput.value);
                if (!isNaN(value) && value >= 1) {
                    VIPConfig.savePiecesForFreeJewel(value);
                } else {
                    piecesInput.value = VIPConfig.getPiecesForFreeJewel();
                }
            });
        }

        this.renderStoreSettings();
    }

    renderVIPTable(query = '') {
        const tbody = document.getElementById('vip-table-body');
        if (!tbody) return;

        let customers = VIPCustomer.getAll();
        if (query) {
            customers = VIPCustomer.search(query);
        }

        const isAdmin = Auth.isAdmin();
        tbody.innerHTML = '';

        if (customers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-text">No se encontraron clientes VIP</td></tr>';
            return;
        }

        const threshold = VIPConfig.getPiecesForFreeJewel();

        customers.forEach(customer => {
            const status = VIPCustomer.getCurrentStatus(customer);
            const history = VIPCustomer.getRewardHistory(customer);
            const pieces = customer.accumulatedPieces || 0;
            const progressPercent = Math.min(100, (pieces / threshold) * 100);
            const isEligible = pieces >= threshold;
            const row = document.createElement('tr');
            row.className = 'vip-table-row';

            let actionsHtml = '';
            if (isAdmin) {
                actionsHtml = `
                    <td class="action-cell">
                        <div class="vip-action-group">
                            <button class="btn btn-vip-icon btn-sm ${isEligible ? 'btn-gold' : 'btn-gold-outline'}" data-action="redeem" data-id="${customer.id}" title="Canjear joya gratis">
                                🎁
                            </button>
                            <button class="btn btn-vip-icon btn-sm btn-green" data-action="add-pieces" data-id="${customer.id}" title="Aumentar piezas acumuladas">
                                ＋
                            </button>
                            <button class="btn btn-vip-icon btn-sm btn-red" data-action="remove-pieces" data-id="${customer.id}" title="Disminuir piezas acumuladas">
                                －
                            </button>
                            <button class="btn btn-vip-icon btn-sm btn-blue" data-action="set-pieces" data-id="${customer.id}" title="Editar valor total de piezas">
                                ⚙
                            </button>
                            <button class="btn btn-vip-icon btn-sm" data-action="edit" data-id="${customer.id}" title="Editar cliente">
                                ✎
                            </button>
                            <button class="btn btn-vip-icon btn-sm btn-red" data-action="delete" data-id="${customer.id}" title="Eliminar cliente">
                                🗑
                            </button>
                        </div>
                    </td>
                `;
            } else {
                actionsHtml = '<td></td>';
            }

            row.innerHTML = `
                <td class="vip-name-cell">
                    <span class="vip-name" title="${this.escapeHtml(customer.name)}">${this.escapeHtml(customer.name)}</span>
                </td>
                <td class="vip-phone-cell">
                    <span class="vip-phone-muted">${this.escapeHtml(customer.phone)}</span>
                </td>
                <td>
                    <div class="vip-pieces-cell">
                        <span class="vip-pieces-value" title="Editar valor total" data-action="set-pieces" data-id="${isAdmin ? customer.id : ''}" style="${isAdmin ? 'cursor:pointer;' : ''}">${pieces}</span>
                        <div class="vip-progress-container">
                            <div class="vip-progress-bar ${isEligible ? 'vip-progress-eligible' : ''}" style="width: ${progressPercent}%"></div>
                        </div>
                        <div class="vip-progress-label">
                            <span class="vip-progress-text">${progressPercent.toFixed(0)}%</span>
                            <span class="vip-threshold-text">${pieces} / ${threshold} piezas</span>
                        </div>
                    </div>
                </td>
                <td class="vip-history-cell">
                    ${history.length > 0
                        ? `<span class="vip-history-badge" data-id="${customer.id}">${history.length} registro(s)</span>`
                        : '<span class="text-muted">Sin historial</span>'
                    }
                </td>
                <td>
                    <span class="status-badge ${status.className}">
                        <span class="status-dot ${isEligible ? 'dot-green' : 'dot-blue'}"></span>
                        ${status.text}
                    </span>
                </td>
                ${actionsHtml}
            `;
            tbody.appendChild(row);
        });

        tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                this.showAddVIPModal(id);
            });
        });

        tbody.querySelectorAll('[data-action="add-pieces"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                this.showAdjustPiecesModal(id, 'add');
            });
        });

        tbody.querySelectorAll('[data-action="remove-pieces"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                this.showAdjustPiecesModal(id, 'remove');
            });
        });

        tbody.querySelectorAll('[data-action="set-pieces"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                if (id) this.showAdjustPiecesModal(id, 'set');
            });
        });

        tbody.querySelectorAll('[data-action="redeem"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                this.redeemVIPReward(id);
            });
        });

        tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                this.deleteVIPCustomer(id);
            });
        });

        tbody.querySelectorAll('.vip-history-badge').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                this.showVIPHistoryModal(id);
            });
        });

        const countEl = document.getElementById('vip-section-count');
        if (countEl) {
            const total = VIPCustomer.count();
            countEl.textContent = `${total} cliente(s)`;
        }
    }

    showAddVIPModal(id = null) {
        const customer = id ? VIPCustomer.findById(id) : null;
        const isEdit = !!customer;

        const overlay = document.createElement('div');
        overlay.className = 'payment-overlay';
        overlay.innerHTML = `
            <div class="payment-modal" style="max-width: 480px;">
                <div class="payment-modal-header">
                    <h3 class="payment-title">${isEdit ? 'Editar Cliente VIP' : 'Nuevo Cliente VIP'}</h3>
                </div>
                <form id="vip-form" class="vip-form">
                    <div class="input-group">
                        <input type="text" name="name" placeholder=" " required value="${customer ? this.escapeHtml(customer.name) : ''}">
                        <label>Nombre Completo</label>
                    </div>
                    <div class="input-group">
                        <input type="tel" name="phone" placeholder=" " required value="${customer ? this.escapeHtml(customer.phone) : ''}" ${isEdit ? 'readonly' : ''}>
                        <label>Número de Teléfono</label>
                    </div>
                    <div class="input-group">
                        <textarea name="notes" placeholder=" " rows="3" maxlength="500">${customer ? this.escapeHtml(customer.notes || '') : ''}</textarea>
                        <label>Notas</label>
                    </div>
                    <div class="payment-actions" style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button type="button" class="btn btn-outline" id="vip-cancel-btn">Cancelar</button>
                        <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar Cambios' : 'Guardar'}</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });

        overlay.querySelector('#vip-cancel-btn')?.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });

        overlay.querySelector('#vip-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const phone = formData.get('phone').trim();
            const name = formData.get('name').trim();
            const notes = formData.get('notes').trim();

            if (!name || !phone) {
                Toast.error('El nombre y teléfono son obligatorios');
                return;
            }

            if (isEdit) {
                const result = VIPCustomer.update(id, { name, phone, notes });
                if (result.success) {
                    Toast.success('Cliente VIP actualizado');
                } else {
                    Toast.error(result.error);
                }
            } else {
                const result = VIPCustomer.add({ name, phone, notes });
                if (result.success) {
                    Toast.success('Cliente VIP agregado');
                } else {
                    Toast.error(result.error);
                }
            }

            this.renderVIPTable();
            if (typeof AutoBackup !== 'undefined') {
                AutoBackup.save('cliente_vip');
            }
            if (typeof Backup !== 'undefined' && Backup.createLocalRecovery) {
                Backup.createLocalRecovery('cliente_vip');
            }
            document.body.removeChild(overlay);
        });
    }

    showAdjustPiecesModal(id, mode = 'add') {
        const customer = VIPCustomer.findById(id);
        if (!customer) return;

        const current = customer.accumulatedPieces || 0;

        const modeConfig = {
            add: {
                title: 'Aumentar Piezas',
                label: 'Número de Piezas a Agregar',
                button: 'Aumentar',
                buttonClass: 'btn-primary',
                min: 1,
                defaultValue: '',
                validate: (pieces) => {
                    if (isNaN(pieces) || pieces <= 0) return 'Ingresa un número válido de piezas mayor a 0';
                    return null;
                },
                action: (pieces, note) => VIPCustomer.addPieces(id, pieces, note),
                successVerb: 'agregadas'
            },
            remove: {
                title: 'Disminuir Piezas',
                label: 'Número de Piezas a Restar',
                button: 'Disminuir',
                buttonClass: 'btn-danger',
                min: 1,
                defaultValue: '',
                validate: (pieces) => {
                    if (isNaN(pieces) || pieces <= 0) return 'Ingresa un número válido de piezas mayor a 0';
                    if (pieces > current) return `Solo hay ${current} pieza(s) disponible(s) para restar`;
                    return null;
                },
                action: (pieces, note) => VIPCustomer.removePieces(id, pieces, note),
                successVerb: 'restadas'
            },
            set: {
                title: 'Editar Valor Total',
                label: 'Valor Total de Piezas',
                button: 'Guardar',
                buttonClass: 'btn-primary',
                min: 0,
                defaultValue: String(current),
                validate: (pieces) => {
                    if (isNaN(pieces) || pieces < 0) return 'Ingresa un número válido de piezas (0 o mayor)';
                    return null;
                },
                action: (pieces, note) => VIPCustomer.setPieces(id, pieces, note),
                successVerb: 'ajustadas'
            }
        };

        const config = modeConfig[mode];
        if (!config) return;

        const overlay = document.createElement('div');
        overlay.className = 'payment-overlay';
        overlay.innerHTML = `
            <div class="payment-modal" style="max-width: 420px;">
                <div class="payment-modal-header">
                    <h3 class="payment-title">${config.title} - ${this.escapeHtml(customer.name)}</h3>
                </div>
                <div class="payment-info">
                    <p>Piezas acumuladas actuales: <strong>${current}</strong></p>
                </div>
                <form id="vip-adjust-form" class="vip-adjust-form">
                    <div class="input-group">
                        <input type="number" name="pieces" min="${config.min}" placeholder=" " required value="${config.defaultValue}">
                        <label>${config.label}</label>
                    </div>
                    <div class="input-group">
                        <textarea name="note" placeholder=" " rows="2" maxlength="200"></textarea>
                        <label>Nota (opcional)</label>
                    </div>
                    <div class="payment-actions" style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button type="button" class="btn btn-outline" id="vip-adjust-cancel-btn">Cancelar</button>
                        <button type="submit" class="btn ${config.buttonClass}">${config.button}</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });

        overlay.querySelector('#vip-adjust-cancel-btn')?.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });

        overlay.querySelector('#vip-adjust-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const pieces = parseInt(formData.get('pieces'));
            const note = formData.get('note').trim();

            const validationError = config.validate(pieces);
            if (validationError) {
                Toast.error(validationError);
                return;
            }

            const result = config.action(pieces, note);
            if (result.success) {
                Toast.success(`${pieces} pieza(s) ${config.successVerb} al cliente ${customer.name}`);
                this.renderVIPTable();
            } else {
                Toast.error(result.error);
            }

            if (typeof AutoBackup !== 'undefined') AutoBackup.save('piezas_vip');
            if (typeof Backup !== 'undefined' && Backup.createLocalRecovery) {
                Backup.createLocalRecovery('piezas_vip');
            }
            document.body.removeChild(overlay);
        });
    }

    redeemVIPReward(id) {
        const customer = VIPCustomer.findById(id);
        if (!customer) return;

        const threshold = VIPConfig.getPiecesForFreeJewel();
        if (customer.accumulatedPieces < threshold) return;

        if (!confirm(`¿Canjear Joya Gratis por ${customer.name}?\nSe descontarán ${threshold} piezas de ${customer.accumulatedPieces} acumuladas.`)) {
            return;
        }

        const noteInput = prompt('Nota del canje (opcional):', '');
        if (noteInput !== null) {
            const result = VIPCustomer.redeemReward(id, noteInput || '');
            if (result.success) {
                Toast.success(`Joya Gratis canjeada - ${customer.name} | ${threshold} piezas descontadas`);
                this.renderVIPTable();
            } else {
                Toast.error(result.error);
            }

            if (typeof AutoBackup !== 'undefined') AutoBackup.save('canje_vip');
            if (typeof Backup !== 'undefined' && Backup.createLocalRecovery) {
                Backup.createLocalRecovery('canje_vip');
            }
        }
    }

    deleteVIPCustomer(id) {
        const customer = VIPCustomer.findById(id);
        if (!customer) return;

        if (!confirm(`¿Estás seguro de eliminar a ${customer.name}?\nSe perderán todos sus datos de fidelización.`)) {
            return;
        }

        VIPCustomer.remove(id);
        Toast.success('Cliente VIP eliminado');
        this.renderVIPTable();

        if (typeof AutoBackup !== 'undefined') AutoBackup.save('eliminacion_vip');
        if (typeof Backup !== 'undefined' && Backup.createLocalRecovery) {
            Backup.createLocalRecovery('eliminacion_vip');
        }
    }

    showVIPHistoryModal(id) {
        const customer = VIPCustomer.findById(id);
        if (!customer) return;

        const history = VIPCustomer.getRewardHistory(customer);

        const overlay = document.createElement('div');
        overlay.className = 'payment-overlay';
        overlay.innerHTML = `
            <div class="payment-modal" style="max-width: 560px;">
                <div class="payment-modal-header">
                    <h3 class="payment-title">Historial de Recompensas - ${this.escapeHtml(customer.name)}</h3>
                </div>
                <div class="payment-info">
                    <p>Piezas acumuladas: <strong>${customer.accumulatedPieces || 0}</strong></p>
                </div>
                ${history.length === 0
                    ? '<p class="empty-text">No hay historial de recompensas</p>'
                    : `
                    <table class="data-table" style="margin-top: 16px;">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Tipo</th>
                                <th>Piezas</th>
                                <th>Detalle</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${history.map(h => `
                                <tr>
                                    <td>${new Date(h.date).toLocaleString('es-MX')}</td>
                                    <td>${h.type === 'canje' ? 'Canje' : 'Acumulación'}</td>
                                    <td style="${h.type === 'canje' ? 'color: var(--danger);' : 'color: var(--success);'}">${h.type === 'canje' ? `-${h.pieces}` : `+${h.pieces}`}</td>
                                    <td>${this.escapeHtml(h.description)}${h.note ? ' • ' + this.escapeHtml(h.note) : ''}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    `
                }
                <div class="payment-actions" style="margin-top: 20px; display: flex; justify-content: flex-end;">
                    <button type="button" class="btn btn-outline" id="vip-history-close-btn">Cerrar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });

        overlay.querySelector('#vip-history-close-btn')?.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
    }

    escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    // Renderizar la configuración VIP en el panel de admin
    renderStoreSettings() {
        const settings = Settings.getSettings();

        const nameEl = document.getElementById('store-name-input');
        if (nameEl) nameEl.value = Business.getStoreName();

        const addressEl = document.getElementById('store-address-input');
        if (addressEl) addressEl.value = settings.storeAddress || '';

        const phoneEl = document.getElementById('store-phone-input');
        if (phoneEl) phoneEl.value = settings.storePhone || '';

        const rfcEl = document.getElementById('store-rfc-input');
        if (rfcEl) rfcEl.value = settings.storeRfc || '';

        const transferBankEl = document.getElementById('settings-transfer-bank-input');
        if (transferBankEl) transferBankEl.value = BankData.getBankData().bank || '';

        const transferClabeEl = document.getElementById('settings-transfer-clabe-input');
        if (transferClabeEl) transferClabeEl.value = BankData.getBankData().clabe || '';

        const transferHolderEl = document.getElementById('settings-transfer-holder-input');
        if (transferHolderEl) transferHolderEl.value = BankData.getBankData().holder || '';

        const headerEl = document.getElementById('receipt-header-input');
        if (headerEl) headerEl.value = settings.receiptHeader || 'Gracias por su compra';

        const footerEl = document.getElementById('receipt-footer-input');
        if (footerEl) footerEl.value = settings.receiptFooter || '¡Gracias por su compra!';

        const stockEl = document.getElementById('low-stock-input');
        if (stockEl) stockEl.value = settings.lowStockThreshold || 5;

        const showCashierEl = document.getElementById('receipt-show-cashier');
        if (showCashierEl) showCashierEl.checked = settings.receiptShowCashier !== false;

        const showDateEl = document.getElementById('receipt-show-date');
        if (showDateEl) showDateEl.checked = settings.receiptShowDate !== false;

        const showPaymentMethodEl = document.getElementById('receipt-show-payment-method');
        if (showPaymentMethodEl) showPaymentMethodEl.checked = settings.receiptShowPaymentMethod !== false;

        const showPaymentDetailsEl = document.getElementById('receipt-show-payment-details');
        if (showPaymentDetailsEl) showPaymentDetailsEl.checked = settings.receiptShowPaymentDetails !== false;

        this.renderLogoPreview(settings.storeLogo);

        // Renderizar configuración de EmailJS
        const emailConfig = Backup.getEmailConfig();
        const emailjsPubKey = document.getElementById('emailjs-public-key');
        const emailjsServiceId = document.getElementById('emailjs-service-id');
        const emailjsTemplateId = document.getElementById('emailjs-template-id');
        const emailjsAutoSend = document.getElementById('emailjs-auto-send');
        if (emailjsPubKey) emailjsPubKey.value = emailConfig?.publicKey || '';
        if (emailjsServiceId) emailjsServiceId.value = emailConfig?.serviceId || '';
        if (emailjsTemplateId) emailjsTemplateId.value = emailConfig?.templateId || '';
        if (emailjsAutoSend) emailjsAutoSend.checked = true; // Envío es exclusivamente manual

        // Renderizar configuración VIP
        const vipPiecesInput = document.getElementById('vip-pieces-for-free-input');
        if (vipPiecesInput) {
            vipPiecesInput.value = VIPConfig.getPiecesForFreeJewel();
        }

        // Cargar correo del administrador
        const adminEmailInput = document.getElementById('admin-email-input');
        if (adminEmailInput) {
            adminEmailInput.value = Auth.getAdminEmail();
        }

        // Renderizar rangos de precios de volumen siempre que se muestre Configuración
        this.renderVolumePricingTiers();

        // Actualizar la visualización de credenciales
        this.updateCredentialsDisplay();
    }
}

const app = new App();
window.app = app;

document.addEventListener('DOMContentLoaded', ErrorBoundary.wrap('app-init', () => {
    // --- Validación de seguridad: verificar que business.js se haya cargado ---
    // Si Business no está definido, el sistema no puede acceder a las claves
    // namespaced por device_id y no puede inicializarse. Se evita el colapso
    // de la aplicación con un error claro en lugar de una excepción en cadena.
    if (typeof Business === 'undefined') {
        console.error('[app-init] El archivo business.js no se ha cargado correctamente. Business no está definido.');
        return;
    }

    // Migrar datos a la nueva namespace con device_id ANTES de cualquier
    // acceso a localStorage. Si se llamara a loadFromStorage() antes,
    // Inventory.init() / Settings.getSettings() crearían valores por
    // defecto en la nueva clave, bloqueando la migración de datos existentes.
    Business.migrateExistingData();
    app.loadFromStorage();
    app.init();
}));
