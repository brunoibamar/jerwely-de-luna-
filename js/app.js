class SaleService {
    static storageKey = 'pos_sales';

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

class Settings {
    static storageKey = 'pos_settings';

    static defaultSettings = {
        taxRate: 16,
        storeName: 'Jewerly De Luna',
        receiptHeader: 'Gracias por su compra',
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
        this.receivedAmount = 0;       // Monto recibido en la calculadora de cambio
        this.paymentEventsBound = false; // Flag para evitar listeners duplicados en el modal de pago
    }

    init() {
        if (this.isInitialized) return;

        Inventory.init();
        Auth.init();

        this.bindLoginEvents();
        this.bindNavigationEvents();
        this.bindSalesEvents();
        this.bindInventoryEvents();
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

    async initApp() {
        License.setExpiration(new Date('2027-12-31T23:59:59'));

        const now = new Date();

        if (License.isTampered()) {
            License.clearTamperFlag();
        }

        License.setLastUsage(now);

        this.hideLicenseOverlay();

        Auth.logout();
        this.showLogin();

        this.updateDailyReport();
        this.updateRoleVisibility();
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
            tokenForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const tokenInput = document.getElementById('reactivation-token');
                const token = tokenInput?.value.trim();
                if (!token) return;
                this.validateReactivationToken(token);
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
    }

    restoreFromBackup(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.inventory) localStorage.setItem('pos_inventory', data.inventory);
                if (data.sales) localStorage.setItem('pos_sales', data.sales);
                if (data.settings) localStorage.setItem('pos_settings', data.settings);
                if (data.auth) {
                    if (data.auth.adminPassword) localStorage.setItem('pos_admin_password', data.auth.adminPassword);
                    if (data.auth.guestKey) localStorage.setItem('pos_guest_key', data.auth.guestKey);
                    if (data.auth.adminUsername) localStorage.setItem('pos_admin_username', data.auth.adminUsername);
                }
                if (data.license) {
                    if (data.license.expiration) localStorage.setItem('pos_license_expiration', data.license.expiration);
                    if (data.license.lastUsage) localStorage.setItem('pos_last_usage', data.license.lastUsage);
                    if (data.license.tampered) localStorage.setItem('pos_clock_tampered', data.license.tampered);
                }
                if (data.shift) localStorage.setItem('pos_shift_opened', data.shift);

                alert('Respalado importado correctamente. Recargue la página para aplicar los cambios.');
            } catch (err) {
                alert('Error al leer el archivo: ' + err.message);
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
    }

    updateRoleVisibility() {
        const isAdmin = Auth.isAdmin();
        const guestAllowedEls = document.querySelectorAll('.guest-allowed');
        const adminOnlyEls = document.querySelectorAll('.admin-only');

        guestAllowedEls.forEach(el => {
            if (!isAdmin) el.classList.remove('hidden');
            else el.classList.add('hidden');
        });

        adminOnlyEls.forEach(el => {
            el.classList.toggle('hidden', !isAdmin);
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

        // NO mostrar el POS app aún - se muestra después de la apertura de caja

        if (!Cut.isShiftOpen()) {
            Cut.openShift();
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
            alert('Ingresa un monto inicial válido');
            return;
        }

        Auth.setDrawerInitial(amount);
        const overlay = document.getElementById('cash-open-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }

        // Ahora sí mostrar el POS app
        this.showApp();
        this.updateTaxRate();
        this.cart.render();
        this.cart.updateTotals();
        this.updateRoleVisibility();
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

        Cut.closeShift();

        const report = Backup.generateDailyReport();
        this.currentReport = report;

        // Guardar copia automática en localStorage (historial interno)
        Backup.saveReportToHistory(report);

        // Mostrar el resumen en pantalla
        this.showCashSummary(report);

        // Limpiar el fondo inicial
        Auth.clearDrawerInitial();
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

                summaryEl.innerHTML = `
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
                    <div class="summary-row total">
                        <span class="summary-label">Caja Final</span>
                        <span class="summary-value gold">$${report.closingAmount.toFixed(2)}</span>
                    </div>
                    ${profitRows}
                `;
            } else {
                // --- Invitado / Cajero: solo confirmación simple + efectivo contado ---
                // No se muestra el desglose de ventas, utilidades ni detalles financieros
                summaryEl.innerHTML = `
                    <div class="summary-row">
                        <span class="summary-label">Cajero</span>
                        <span class="summary-value">${report.cashier}</span>
                    </div>
                    <div class="summary-row">
                        <span class="summary-label">Transacciones</span>
                        <span class="summary-value">${report.transactionCount}</span>
                    </div>
                    <div class="summary-row total">
                        <span class="summary-label">Corte Completado</span>
                        <span class="summary-value gold">✓</span>
                    </div>
                    <div class="guest-cash-count">
                        <div class="input-group">
                            <input type="number" id="guest-cash-count" step="0.01" min="0" placeholder=" ">
                            <label for="guest-cash-count">Efectivo Contado en Caja ($)</label>
                        </div>
                    </div>
                `;
            }
        }

        // Mostrar/ocultar botones de acción según rol
        const summaryActions = document.querySelector('.summary-actions');
        if (summaryActions) {
            summaryActions.classList.toggle('hidden', !isAdmin);
        }

        const summaryOverlay = document.getElementById('cash-summary-overlay');
        if (summaryOverlay) {
            summaryOverlay.classList.remove('hidden');
        }

        this.updateRoleVisibility();
    }

    bindSummaryEvents() {
        const sendEmailBtn = document.getElementById('send-email-btn');
        if (sendEmailBtn) {
            sendEmailBtn.addEventListener('click', async () => {
                if (!Auth.isAdmin()) {
                    alert('Permiso denegado: esta acción requiere privilegios de administrador');
                    return;
                }
                if (!this.currentReport) return;

                const result = await Backup.sendReportEmail(this.currentReport);
                alert(result.message || 'Reporte enviado al correo del administrador.');
            });
        }

        const downloadBtn = document.getElementById('download-local-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                if (!Auth.isAdmin()) {
                    alert('Permiso denegado: esta acción requiere privilegios de administrador');
                    return;
                }
                if (this.currentReport) {
                    Backup.exportReportFile(this.currentReport);
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
                <title>Cierre de Caja - Jewerly De Luna</title>
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
                <h1>Cierre de Caja - Jewerly De Luna</h1>
                <p><strong>Fecha:</strong> ${report.date}</p>
                <p><strong>Cajero:</strong> ${report.cashier}</p>
                <h3>Resumen</h3>
                <table>
                    <tr><th>Concepto</th><th>Valor</th></tr>
                    <tr><td>Monto Inicial</td><td>$${report.initialAmount.toFixed(2)}</td></tr>
                    <tr><td>Total Ventas</td><td>$${report.totalSales.toFixed(2)}</td></tr>
                    <tr><td>Efectivo</td><td>$${report.cashSales.toFixed(2)}</td></tr>
                    <tr><td>Tarjeta</td><td>$${report.cardSales.toFixed(2)}</td></tr>
                    <tr><td>Transacciones</td><td>${report.transactionCount}</td></tr>
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
                navItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const section = item.dataset.section;
                this.switchSection(section);
            });
        });

        const menuToggle = document.getElementById('menu-toggle');
        const sidebar = document.getElementById('sidebar');
        if (menuToggle && sidebar) {
            menuToggle.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
            });
        }

        const backupBtn = document.getElementById('backup-btn');
        if (backupBtn) {
            backupBtn.addEventListener('click', () => {
                if (!Auth.canAccessConfig()) {
                    alert('Permiso denegado: Esta acción requiere privilegios de administrador');
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
                alert('No hay suficiente stock disponible');
            }
        } else {
            // Si no se encuentra por barcode, buscar por descripción
            const found = Inventory.search(barcode);
            if (found.length === 1) {
                this.cart.addItem(found[0]);
            } else if (found.length > 1) {
                // Múltiples resultados: sugerir usar el código de barras exacto
                alert(`Se encontraron ${found.length} productos. Usa el código de barras para seleccionar.`);
            } else {
                alert('Producto no encontrado');
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
            alert('No hay productos en la venta');
            return;
        }
        this.showPaymentModal();
    }

    // --- Módulo de Pago y Calculadora de Cambio ---
    // Muestra el modal de pago con opciones: Efectivo, Tarjeta, Pago Mixto.
    // El modal está definido en el HTML (id="payment-modal-overlay") y se muestra
    // dinámicamente para evitar crear múltiples overlays en el DOM.
    showPaymentModal() {
        const total = this.cart.getTotal();

        // Actualizar monto total a pagar
        const totalEl = document.getElementById('payment-total');
        const cardTotalEl = document.getElementById('card-total-display');
        if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
        if (cardTotalEl) cardTotalEl.textContent = `$${total.toFixed(2)}`;

        // Reiniciar estado del calculator de cambio
        this.receivedAmount = 0;
        const receivedEl = document.getElementById('received-amount-display');
        const changeEl = document.getElementById('change-amount-display');
        if (receivedEl) receivedEl.textContent = '$0.00';
        if (changeEl) changeEl.textContent = '$0.00';

        // Reiniciar botón de confirmación de efectivo
        const confirmCashBtn = document.getElementById('confirm-cash-btn');
        if (confirmCashBtn) confirmCashBtn.disabled = true;

        // Reiniciar inputs de pago mixto
        const mixedCashInput = document.getElementById('mixed-cash-input');
        const mixedCardInput = document.getElementById('mixed-card-input');
        const mixedTotalEl = document.getElementById('mixed-total-display');
        const confirmMixedBtn = document.getElementById('confirm-mixed-btn');
        if (mixedCashInput) mixedCashInput.value = '';
        if (mixedCardInput) mixedCardInput.value = '';
        if (mixedTotalEl) mixedTotalEl.textContent = '$0.00';
        if (confirmMixedBtn) confirmMixedBtn.disabled = true;

        // Mostrar sección de efectivo por defecto
        this.showPaymentSection('cash');

        // Mostrar overlay
        const overlay = document.getElementById('payment-modal-overlay');
        if (overlay) overlay.classList.remove('hidden');

        this.bindPaymentEvents();
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
        const total = this.cart.getTotal();

        // Botones de selección de método de pago
        document.querySelectorAll('.payment-method-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const method = btn.dataset.method;
                this.showPaymentSection(method);
                this.receivedAmount = 0;
                const receivedEl = document.getElementById('received-amount-display');
                const changeEl = document.getElementById('change-amount-display');
                if (receivedEl) receivedEl.textContent = '$0.00';
                if (changeEl) changeEl.textContent = '$0.00';
            });
        });

        // Generar botones de denominaciones (MXN)
        const denomGrid = document.getElementById('denomination-grid');
        if (denomGrid) {
            denomGrid.innerHTML = '';
            PaymentProcessor.denominations.forEach(denom => {
                const btn = document.createElement('button');
                btn.className = 'denomination-btn';
                btn.textContent = `$${denom}`;
                btn.dataset.denomination = denom;
                btn.addEventListener('click', () => {
                    this.receivedAmount += parseInt(denom);
                    this.updateCashDisplay(total);
                });
                denomGrid.appendChild(btn);
            });
        }

        // Botón Limpiar (reiniciar monto recibido)
        const clearBtn = document.getElementById('clear-received-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.receivedAmount = 0;
                this.updateCashDisplay(total);
            });
        }

        // Confirmar pago en efectivo
        const confirmCashBtn = document.getElementById('confirm-cash-btn');
        if (confirmCashBtn) {
            confirmCashBtn.addEventListener('click', () => {
                const pd = PaymentProcessor.calculateChange(this.receivedAmount, total);
                if (pd.error) {
                    alert(pd.error);
                    return;
                }
                this.completeCheckout({
                    method: 'cash',
                    amountReceived: this.receivedAmount,
                    change: pd.change,
                    receivedBreakdown: pd.breakdown
                });
                this.hidePaymentModal();
            });
        }

        // Confirmar pago con tarjeta
        const confirmCardBtn = document.getElementById('confirm-card-btn');
        if (confirmCardBtn) {
            confirmCardBtn.addEventListener('click', () => {
                this.completeCheckout({ method: 'card' });
                this.hidePaymentModal();
            });
        }

        // Validar pago mixto en tiempo real
        const mixedCashInput = document.getElementById('mixed-cash-input');
        const mixedCardInput = document.getElementById('mixed-card-input');
        const mixedTotalEl = document.getElementById('mixed-total-display');
        const confirmMixedBtn = document.getElementById('confirm-mixed-btn');

        const validateMixed = () => {
            const cashAmount = parseFloat(mixedCashInput?.value) || 0;
            const cardAmount = parseFloat(mixedCardInput?.value) || 0;
            const sum = Math.round((cashAmount + cardAmount) * 100) / 100;
            if (mixedTotalEl) mixedTotalEl.textContent = `$${sum.toFixed(2)}`;
            const valid = sum >= total && cashAmount >= 0 && cardAmount >= 0 && sum > 0;
            if (confirmMixedBtn) confirmMixedBtn.disabled = !valid;
        };

        mixedCashInput?.addEventListener('input', validateMixed);
        mixedCardInput?.addEventListener('input', validateMixed);

        // Confirmar pago mixto
        if (confirmMixedBtn) {
            confirmMixedBtn.addEventListener('click', () => {
                const cashAmount = parseFloat(mixedCashInput?.value) || 0;
                const cardAmount = parseFloat(mixedCardInput?.value) || 0;
                const pd = PaymentProcessor.calculateChange(cashAmount, total);
                this.completeCheckout({
                    method: 'mixed',
                    cashAmount: cashAmount,
                    cardAmount: cardAmount,
                    amountReceived: Math.round((cashAmount + cardAmount) * 100) / 100,
                    change: pd.change > 0 ? pd.change : 0
                });
                this.hidePaymentModal();
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

            alert(`Venta completada - Folio: ${result.sale.id}`);
        } else {
            alert(result.error || 'Error al procesar la venta');
        }
    }

    updateTaxRate() {
        const settings = Settings.getSettings();
        this.cart.setTaxRate(settings.taxRate);
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
            let itemCount = 0;

            SaleService.getDailySales().forEach(sale => {
                sale.items.forEach(item => {
                    const product = Inventory.findByBarcode(item.barcode);
                    if (product && product.cost) {
                        totalCost += product.cost * item.quantity;
                    }
                    totalRevenue += item.amount;
                    itemCount++;
                });
            });

            const profit = totalRevenue - totalCost;
            const margin = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : '0.0';

            if (profitEl) profitEl.textContent = `$${profit.toFixed(2)}`;
            if (marginEl) marginEl.textContent = `${margin}%`;
        }
    }

    viewCashReport() {
        const report = Cut.generateCutReport();
        const summary = Cut.getCashDrawerSummary();
        alert(
            `Corte de Caja\n\n` +
            `Ventas del día: $${summary.grandTotal.toFixed(2)}\n` +
            `Transacciones: ${summary.totalSales}\n` +
            `Efectivo: $${summary.cashTotal.toFixed(2)}\n` +
            `Tarjeta: $${summary.cardTotal.toFixed(2)}\n\n` +
            `¿Desea imprimir el corte?`
        );
    }

    bindInventoryEvents() {
        const inventorySearch = document.getElementById('inventory-search');
        if (inventorySearch) {
            inventorySearch.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                const results = Inventory.search(query);
                this.renderInventoryResults(results);
            });
        }

        const addInventoryBtn = document.getElementById('add-inventory-btn');
        if (addInventoryBtn) {
            addInventoryBtn.addEventListener('click', () => {
                if (!Auth.canModifyInventory()) {
                    alert('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                this.showAddProductModal();
            });
        }
    }

    renderInventoryResults(products) {
        const grid = document.getElementById('inventory-grid');
        if (!grid) return;

        const canViewCosts = Auth.canViewCosts();
        grid.innerHTML = '';

        if (products.length === 0) {
            grid.innerHTML = '<p class="empty-text">No se encontraron productos</p>';
            return;
        }

        products.forEach(product => {
            const card = document.createElement('div');
            card.className = 'inventory-card';
            let costHtml = '';
            if (canViewCosts && product.cost) {
                const profit = Inventory.getProfit(product);
                const margin = Inventory.getProfitMargin(product);
                costHtml = `
                    <div class="product-cost">Costo: $${product.cost.toFixed(2)}</div>
                    <div class="product-profit">Ganancia: $${profit.toFixed(2)} (${margin.toFixed(1)}%)</div>
                `;
            }
            card.innerHTML = `
                <div class="product-name">${product.description}</div>
                <div class="product-sku">Código: ${product.barcode}</div>
                <div class="product-price">$${product.price.toFixed(2)}</div>
                <div class="product-stock">Existencia: ${product.stock} unidades</div>
                ${costHtml}
            `;
            grid.appendChild(card);
        });
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
                volumePricing: e.target.volumePricing.checked
            };

            const result = Inventory.add(product);
            if (result.success) {
                alert('Producto agregado correctamente');
                Inventory.renderCatalog();
                document.body.removeChild(overlay);
            } else {
                alert(result.error || 'Error al agregar el producto');
            }
        });
    }

    bindSettingsEvents() {
        const saveSettingsBtn = document.getElementById('save-settings-btn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => {
                if (!Auth.canAccessConfig()) {
                    alert('Permiso denegado: Esta acción requiere privilegios de administrador');
                    return;
                }
                const taxInput = document.getElementById('tax-rate-input');
                const emailInput = document.getElementById('admin-email-input');

                let saved = false;
                if (taxInput) {
                    const rate = parseFloat(taxInput.value) || 16;
                    Settings.update('taxRate', rate);
                    saved = true;
                }
                if (emailInput && emailInput.value) {
                    Auth.setAdminEmail(emailInput.value.trim());
                    saved = true;
                }

                this.updateTaxRate();
                this.updateCredentialsDisplay();
                if (saved) alert('Configuración guardada correctamente');
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

        this.updateCredentialsDisplay();
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
            alert('No hay productos en la venta para pausar');
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

                alert('Venta pausada correctamente. Puedes atender a otro cliente.');
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

        this.cart.restoreFromData({ items: held.items, taxRate: this.cart.taxRate });

        // Cerrar panel y actualizar UI
        const overlay = document.getElementById('held-sales-overlay');
        if (overlay) overlay.classList.add('hidden');

        this.updateHeldSalesButton();
        BarcodeScanner.focusInput();
        alert('Venta recuperada correctamente');
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
            alert('Debe haber al menos un rango de precio');
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
                alert('Verifica que todos los campos estén completos y válidos');
                return;
            }

            tiers.push({ min, max, price });
        }

        // Ordenar por min antes de validar
        tiers.sort((a, b) => a.min - b.min);

        const result = VolumePricing.updateTiers(tiers);
        if (result.success) {
            alert(result.message);
            // Re-renderizar para reflejar el orden
            this.renderVolumePricingTiers();
        } else {
            alert(result.error);
        }
    }

    bindVolumePricingEvents() {
        const saveBtn = document.getElementById('save-volume-pricing-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                if (!Auth.canAccessConfig()) {
                    alert('Permiso denegado: Esta acción requiere privilegios de administrador');
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
                    alert('Precios de volumen restablecidos por defecto');
                }
            });
        }

        const addBtn = document.getElementById('add-tier-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                if (!Auth.canAccessConfig()) {
                    alert('Permiso denegado: Esta acción requiere privilegios de administrador');
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

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
