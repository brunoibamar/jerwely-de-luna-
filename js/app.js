class SaleService {
    static get storageKey() { return Business.key('pos_sales'); }

    static getAll() {
        const stored = localStorage.getItem(this.storageKey);
        return stored ? JSON.parse(stored) : [];
    }

    static save(sales) {
        localStorage.setItem(this.storageKey, JSON.stringify(sales));
    }

    static saveSale(sale) {
        const sales = this.getAll();
        sales.push(sale);
        this.save(sales);
        return sale;
    }

    static getById(saleId) {
        return this.getAll().find(s => s.id === saleId);
    }

    static getSalesByDate(date) {
        return this.getAll().filter(s => s.date.startsWith(date));
    }

    static getDailySales(date = new Date().toISOString().split('T')[0]) {
        return this.getSalesByDate(date);
    }

    static getReportStats(date = new Date().toISOString().split('T')[0]) {
        const sales = this.getDailySales(date);
        const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
        const itemCount = sales.reduce((sum, s) => sum + s.items.length, 0);
        return {
            totalRevenue: totalSales,
            transactionCount: sales.length,
            itemsSold: itemCount
        };
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
        return { ...this.defaultSettings, ...JSON.parse(stored) };
    }

    static saveSettings(settings) {
        const merged = { ...this.defaultSettings, ...settings };
        localStorage.setItem(this.storageKey, JSON.stringify(merged));
        return merged;
    }

    static update(key, value) {
        const settings = this.getSettings();
        settings[key] = value;
        this.saveSettings(settings);
        return settings;
    }
}

class App {
    constructor() {
        this.cart = new Cart();
        this.activeSection = 'sales';
        this.isInitialized = false;
        this.receivedAmount = 0;
        this.paymentEventsBound = false;
    }

    init() {
        if (this.isInitialized) return;

        Business.migrateExistingData();

        Inventory.init();
        Auth.init();

        this.bindLoginEvents();
        this.bindNavigationEvents();
        this.bindSalesEvents();
        this.bindInventoryEvents();
        this.bindReportsEvents();
        this.bindReportsAccessModal();
        this.bindSettingsEvents();
        this.bindRecoveryEvents();
        this.bindLicenseEvents();
        this.bindCashEvents();
        this.bindSummaryEvents();
        this.bindPosEvents();
        this.bindPauseEvents();
        this.bindHeldSalesEvents();
        this.bindPaymentEvents();

        this.initApp();

        this.isInitialized = true;
    }

    // ============================================================
    //  FUNCION DE CARGA AL INICIAR (onload / DOMContentLoaded)
    //  Verifica si existen las claves de almacenamiento y, en caso
    //  afirmativo, carga los datos existentes en la interfaz en lugar
    //  de reiniciar las variables a valores vacíos.
    //  Claves verificadas (mononegocio, namespace fijo __biz_default):
    //    - jewelry_deluna_business_name (nombre del negocio)
    //    - pos_inventory__biz_default   (inventario)
    //    - pos_sales__biz_default       (ventas)
    //    - pos_settings__biz_default    (configuración)
    //    - pos_current_user__biz_default (usuario autenticado)
    //    - pos_shift_session__biz_default (turno/cesa abierta)
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

        // --- Mononegocio unificado: migrar datos legados ---
        // El sistema opera con un único negocio fijo (Jewerly De Luna).
        // Se migran datos antiguos a la estructura namespaced única.
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

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.inventory) localStorage.setItem(Inventory.storageKey, data.inventory);
                if (data.sales) localStorage.setItem(SaleService.storageKey, data.sales);
                if (data.settings) localStorage.setItem(Settings.storageKey, data.settings);
                if (data.store) Business.setBusinessName(data.store);
                if (data.auth) {
                    if (data.auth.adminPassword) localStorage.setItem(Auth.storageKeys.adminPassword, data.auth.adminPassword);
                    if (data.auth.guestKey) localStorage.setItem(Auth.storageKeys.guestKey, data.auth.guestKey);
                    if (data.auth.adminUsername) localStorage.setItem(Auth.adminUsernameKey, data.auth.adminUsername);
                }
                if (data.license) {
                    if (data.license.expiration) localStorage.setItem(License.storageKeys.expiration, data.license.expiration);
                    if (data.license.lastUsage) localStorage.setItem(License.storageKeys.lastUsage, data.license.lastUsage);
                    if (data.license.tampered) localStorage.setItem(License.storageKeys.tampered, data.license.tampered);
                }
                if (data.shift) localStorage.setItem(Business.key('pos_shift_opened'), data.shift);
                if (data.shiftSession) localStorage.setItem(Cut.storageKey, data.shiftSession);
                if (data.shiftHistory) localStorage.setItem(Cut.shiftHistoryKey, data.shiftHistory);
                if (data.reportHistory) localStorage.setItem(Backup.reportHistoryKey, data.reportHistory);
                if (data.dayChangeKey) localStorage.setItem(ReportService.dayChangeKey, data.dayChangeKey);
                if (data.emailConfig) localStorage.setItem(Backup.emailConfigKey, data.emailConfig);

                Toast.success('Respalado importado correctamente. Recargue la página para aplicar los cambios.');
            } catch (err) {
                Toast.error('Error al leer el archivo: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    showLogin() {
        document.getElementById('login-screen')?.classList.remove('hidden');
        document.getElementById('pos-app')?.classList.add('hidden');
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

        const loginTabs = document.querySelectorAll('.login-tab-btn');
        loginTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                loginTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const loginType = tab.dataset.loginType;
                document.querySelectorAll('[data-login-form]').forEach(form => {
                    form.classList.add('hidden');
                });
                const targetForm = document.querySelector(`[data-login-form="${loginType}"]`);
                if (targetForm) targetForm.classList.remove('hidden');
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

        // Guardar copia en localStorage (historial interno)
        Backup.saveReportToHistory(report);

        // Mostrar el resumen en pantalla
        this.showCashSummary(report);

        // Limpiar el fondo inicial
        Auth.clearDrawerInitial();

        // NOTA: El envío de reporte por correo NO es automático.
        // Solo se activa al hacer clic en "Enviar Registro al Correo"
        // dentro del modal de Cierre de Caja (bindSummaryEvents).
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
                if (!this.currentReport) return;

                const originalText = sendEmailBtn.textContent;
                sendEmailBtn.disabled = true;
                sendEmailBtn.textContent = 'Enviando...';

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
                    sendEmailBtn.disabled = false;
                    sendEmailBtn.textContent = originalText;
                }
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
                        // Administrador: reporte completo
                        Backup.exportReportFile(this.currentReport);
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

        const menuToggle = document.getElementById('menu-toggle');
        const sidebar = document.getElementById('sidebar');
        const posApp = document.getElementById('pos-app');
        if (menuToggle && sidebar) {
            menuToggle.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
                posApp.classList.toggle('sidebar-collapsed');
            });
        }

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
        if (sectionId === 'sales') {
            BarcodeScanner.focusInput();
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

        // --- Búsqueda manual por descripción ---
        // La búsqueda se realiza mediante Enter en el input principal de búsqueda
        const productSearch = document.getElementById('product-search');
        if (productSearch) {
            productSearch.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const query = productSearch.value.trim();
                    if (query) {
                        this.handleBarcodeScan(query);
                    }
                }
            });
            productSearch.addEventListener('focus', () => {
                productSearch.select();
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
                if (this.cart.isEmpty()) return;
                if (confirm('¿Estás seguro de limpiar la venta?')) {
                    this.cart.clear();
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
                this.cart.addItem(found[0]);
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
        }
    }

    // Vincular eventos del modal de pago
    bindPaymentEvents() {
        // Evitar duplicar listeners si el modal ya fue inicializado
        if (this.paymentEventsBound) return;
        this.paymentEventsBound = true;

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

    // Completar checkout con detalles de pago completos
    completeCheckout(paymentDetails = { method: 'cash' }) {
        try {
            const result = Checkout.checkout(this.cart, paymentDetails);

            if (result.success) {
                Inventory.updateStock(
                    result.sale.items.map(i => ({ barcode: i.barcode, quantity: i.quantity }))
                );

                setTimeout(() => {
                    Print.printReceipt(result.sale);
                }, 300);

                this.updateDailyReport();
                this.updateHeldSalesButton();
                BarcodeScanner.focusInput();

                Toast.success(`Venta completada - Folio: ${result.sale.id}`);
            } else {
                Toast.error(result.error || 'Error al procesar la venta');
            }
        } catch (err) {
            Toast.error('Error al procesar el pago: ' + (err?.message || err));
        } finally {
            this.hidePaymentModal();
        }
    }

    updateDailyReport() {
        const stats = SaleService.getReportStats();
        const salesEl = document.getElementById('daily-sales');
        const countEl = document.getElementById('daily-transactions');
        const profitEl = document.getElementById('daily-profit');
        const marginEl = document.getElementById('avg-margin');

        if (salesEl) salesEl.textContent = `$${stats.totalRevenue.toFixed(2)}`;
        if (countEl) countEl.textContent = stats.transactionCount;

        if (Auth.isAdmin()) {
            let totalCost = 0;
            let totalRevenue = 0;

            SaleService.getDailySales().forEach(sale => {
                sale.items.forEach(item => {
                    const product = Inventory.findByBarcode(item.barcode);
                    if (product && product.cost) {
                        totalCost += product.cost * item.quantity;
                    }
                    totalRevenue += item.amount;
                });
            });

            const profit = totalRevenue - totalCost;
            const margin = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : '0.0';

            if (profitEl) profitEl.textContent = `$${profit.toFixed(2)}`;
            if (marginEl) marginEl.textContent = `${margin}%`;
        }

        if (Auth.isAdmin()) {
            this.renderDailySalesChart();
            this.renderMonthlySalesChart();
        }
    }

    // --- Gráfica de ventas diarias (por hora) ---
    renderDailySalesChart() {
        const canvas = document.getElementById('daily-sales-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const sales = SaleService.getDailySales();

        const hourlyData = {};
        for (let h = 0; h < 24; h++) hourlyData[h] = 0;
        sales.forEach(s => {
            const hour = new Date(s.date).getHours();
            hourlyData[hour] += s.total;
        });

        const labels = Object.keys(hourlyData).map(h => `${h}:00`);
        const data = Object.values(hourlyData);

        this.drawBarChart(ctx, canvas, labels, data, '#d4af37', 'Ventas por Hora');
    }

    // --- Gráfica mensual de ventas (últimos 12 meses) ---
    renderMonthlySalesChart() {
        const canvas = document.getElementById('monthly-sales-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const allSales = SaleService.getAll();
        const monthlyData = {};

        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            monthlyData[key] = 0;
        }

        allSales.forEach(s => {
            const d = new Date(s.date);
            const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            if (monthlyData.hasOwnProperty(key)) {
                monthlyData[key] += s.total;
            }
        });

        const labels = Object.keys(monthlyData);
        const data = Object.values(monthlyData);

        this.drawBarChart(ctx, canvas, labels, data, '#e6c14a', 'Ventas Mensuales (últimos 12 meses)');
    }

    // Dibujar una gráfica de barras simple con Canvas API
    drawBarChart(ctx, canvas, labels, data, color, title) {
        const w = canvas.width;
        const h = canvas.height;
        const padding = { top: 40, right: 16, bottom: 50, left: 50 };
        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;
        const max = Math.max(...data, 1);

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#d4af37';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(title, w / 2, 24);

        ctx.strokeStyle = '#2a2a3a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, padding.top + chartH);
        ctx.lineTo(padding.left + chartW, padding.top + chartH);
        ctx.stroke();

        const barW = chartW / data.length * 0.7;
        const gap = chartW / data.length;

        data.forEach((val, i) => {
            const barH = (val / max) * chartH;
            ctx.fillStyle = val > 0 ? color : '#2a2a3a';
            ctx.fillRect(padding.left + i * gap + (gap - barW) / 2, padding.top + chartH - barH, barW, barH);

            ctx.fillStyle = '#a0a0b0';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            if (val > 0) {
                ctx.fillText(`$${val.toFixed(0)}`, padding.left + i * gap + gap / 2, padding.top + chartH - barH - 4);
            }
        });

        ctx.fillStyle = '#a0a0b0';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';

        for (let i = 0; i < labels.length; i += Math.ceil(labels.length / 6)) {
            ctx.fillText(labels[i], padding.left + i * gap + gap / 2, padding.top + chartH + 16);
        }

        ctx.fillStyle = '#d4af37';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`$${max.toFixed(2)}`, padding.left - 8, padding.top - 8);
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
                const today = new Date().toISOString().split('T')[0];
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

        const today = new Date().toISOString().split('T')[0];
        if (dateSelect) dateSelect.value = today;
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
                                <td>${s.paymentMethod}</td>
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
                <div class="product-price">$${product.price.toFixed(2)}</div>
                <div class="product-stock ${stockClass}">Existencia: ${product.stock} unidades${isLowStock ? ' ⚠ Bajo' : ''}</div>
                ${costHtml}
                ${deleteBtn}
            `;
            grid.appendChild(card);

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
                        <input type="text" name="category" placeholder=" ">
                        <label>Categoría</label>
                    </div>
                    <div class="input-group admin-only-field">
                        <input type="number" name="cost" step="0.01" min="0" placeholder=" ">
                        <label>Costo de Adquisición</label>
                    </div>
                    <div class="input-group">
                        <div class="checkbox-group" style="margin-top: 12px;">
                            <input type="checkbox" id="product-volume-pricing" name="volumePricing" value="1" style="margin-right: 8px;">
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
                category: formData.get('category') ? formData.get('category').trim() : 'General',
                volumePricing: e.target.volumePricing.checked
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
    }

    // Renderizar campos de configuración de tienda
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
        if (emailjsAutoSend) emailjsAutoSend.checked = emailConfig?.enabled !== false;
    }

    saveEmailJSConfig() {
        const pubKey = document.getElementById('emailjs-public-key')?.value.trim() || '';
        const serviceId = document.getElementById('emailjs-service-id')?.value.trim() || '';
        const templateId = document.getElementById('emailjs-template-id')?.value.trim() || '';
        const autoSend = document.getElementById('emailjs-auto-send')?.checked ?? true;

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
                    Settings.update('storeLogo', logoData);
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
}

const app = new App();
window.app = app;

document.addEventListener('DOMContentLoaded', ErrorBoundary.wrap('app-init', () => {
    app.loadFromStorage();
    app.init();
}));
