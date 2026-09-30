class Auth {
    // ============================================================
    //  CREDENCIALES PREDeterminadas (fallback si no hay nada
    //  guardado en localStorage)
    // ============================================================

    // --- Administrador ---
    // Usuario: admin
    // Contraseña: admin123
    // Para cambiar estas credenciales por defecto, modifica aquí:
    static defaultAdminUsername = 'admin';
    static defaultAdminPassword = 'admin123';

    // --- Invitado / Cajero ---
    // Clave rápida: 1234
    // El acceso de invitado también puede hacerse SIN clave
    // (botón "Ingresar como Invitado" en la pantalla de login).
    // Para cambiar la clave rápida por defecto, modifica aquí:
    static defaultGuestKey = '1234';

    // ============================================================
    //  CLAVES DE ALMACENAMIENTO EN localStorage
    //  Las credenciales modificadas se guardan en localStorage
    //  y persisten al refrescar la página.
    // ============================================================
    static get storageKeys() {
        return {
            adminPassword: Business.key('pos_admin_password'),
            guestKey: Business.key('pos_guest_key')
        };
    }

    // ============================================================
    //  USUARIO ADMINISTRADOR COMPLETO (con datos de recuperación)
    // ============================================================
    static adminProfile = {
        id: 1,
        username: 'admin',
        name: 'Administrador',
        role: 'admin',
        email: 'admin@jewerlydeluna.com',
        securityQuestion: '¿Cuál es el nombre del jefe de taller?',
        securityAnswer: 'luna'
    };

    static currentUser = null;

    static get drawerStorageKey() { return Business.key('pos_drawer_initial'); }
    static get adminEmailKey() { return Business.key('pos_admin_email'); }
    static get current_userKey() { return Business.key('pos_current_user'); }
    static get adminUsernameKey() { return Business.key('pos_admin_username'); }

    // --- Getters dinámicos que leen de localStorage ---
    static getAdminPassword() {
        return localStorage.getItem(this.storageKeys.adminPassword) || this.defaultAdminPassword;
    }

    static getGuestKey() {
        return localStorage.getItem(this.storageKeys.guestKey) || this.defaultGuestKey;
    }

    static getAdminUsername() {
        const stored = localStorage.getItem(this.adminUsernameKey);
        return stored || this.defaultAdminUsername;
    }

    // --- Fondo inicial de caja ---
    static setDrawerInitial(amount) {
        localStorage.setItem(this.drawerStorageKey, parseFloat(amount).toFixed(2));
    }

    static getDrawerInitial() {
        const stored = localStorage.getItem(this.drawerStorageKey);
        return stored ? parseFloat(stored) : 0;
    }

    static clearDrawerInitial() {
        localStorage.removeItem(this.drawerStorageKey);
    }

    // --- Email del administrador ---
    static getAdminEmail() {
        return localStorage.getItem(this.adminEmailKey) || this.adminProfile.email;
    }

    static setAdminEmail(email) {
        localStorage.setItem(this.adminEmailKey, email);
    }

    static init() {
        const stored = localStorage.getItem(this.current_userKey);
        if (stored) {
            this.currentUser = JSON.parse(stored);
            return true;
        }
        return false;
    }

    // --- Login de Administrador ---
    static login(username, password) {
        const validUsername = this.getAdminUsername();
        const validPassword = this.getAdminPassword();

        if (username === validUsername && password === validPassword) {
            this.currentUser = {
                id: this.adminProfile.id,
                username: validUsername,
                name: this.adminProfile.name,
                role: this.adminProfile.role,
                email: this.adminProfile.email,
                securityQuestion: this.adminProfile.securityQuestion
            };
            localStorage.setItem(this.current_userKey, JSON.stringify(this.currentUser));
            return { success: true, user: this.currentUser };
        }
        return { success: false, error: 'Credenciales incorrectas' };
    }

    // --- Login de Invitado (sin clave, acceso directo) ---
    static loginGuest() {
        this.currentUser = {
            id: 999,
            username: 'invitado',
            name: 'Invitado',
            role: 'guest',
            email: null,
            securityQuestion: null
        };
        localStorage.setItem(this.current_userKey, JSON.stringify(this.currentUser));
        return { success: true, user: this.currentUser };
    }

    // --- Login de Invitado (con clave rápida) ---
    static loginGuestWithKey(key) {
        const validKey = this.getGuestKey();
        if (key === validKey || key === '') {
            return this.loginGuest();
        }
        return { success: false, error: 'Clave inválida' };
    }

    // --- GESTIÓN DE CREDENCIALES DESDE EL PANEL ---

    // Cambiar la contraseña del Administrador
    // Se guarda en localStorage y persiste al refrescar.
    static changeAdminPassword(currentPassword, newPassword, confirmPassword) {
        if (newPassword !== confirmPassword) {
            return { success: false, error: 'Las contraseñas no coinciden' };
        }
        if (newPassword.length < 4) {
            return { success: false, error: 'La contraseña debe tener al menos 4 caracteres' };
        }
        if (currentPassword !== this.getAdminPassword()) {
            return { success: false, error: 'La contraseña actual es incorrecta' };
        }
        localStorage.setItem(this.storageKeys.adminPassword, newPassword);
        return { success: true, message: 'Contraseña de administrador actualizada' };
    }

    // Cambiar la clave rápida del Invitado/Cajero
    // Se guarda en localStorage y persiste al refrescar.
    static changeGuestKey(currentKey, newKey, confirmKey) {
        if (newKey !== confirmKey) {
            return { success: false, error: 'Las claves no coinciden' };
        }
        if (newKey.length < 1) {
            return { success: false, error: 'La clave no puede estar vacía' };
        }
        if (currentKey !== this.getGuestKey()) {
            return { success: false, error: 'La clave actual es incorrecta' };
        }
        localStorage.setItem(this.storageKeys.guestKey, newKey);
        return { success: true, message: 'Clave de cajero actualizada' };
    }

    // Obtener credenciales actuales (para mostrar en panel, solo admin)
    static getCredentials() {
        return {
            adminUsername: this.getAdminUsername(),
            adminPassword: this.getAdminPassword(),
            guestKey: this.getGuestKey()
        };
    }

    // --- Recuperación de contraseña ---
    static resetPassword(email) {
        const user = this.adminProfile;
        if (user.email === email) {
            return {
                success: true,
                securityQuestion: user.securityQuestion,
                message: `Se han enviado instrucciones de recuperación a ${email}`
            };
        }
        return { success: false, error: 'No se encontró la cuenta con ese correo' };
    }

    static verifySecurityAnswer(answer) {
        const user = this.adminProfile;
        if (user.securityAnswer === answer.toLowerCase()) {
            this.currentUser = {
                id: user.id,
                username: this.getAdminUsername(),
                name: user.name,
                role: user.role,
                email: user.email,
                securityQuestion: user.securityQuestion
            };
            localStorage.setItem(this.current_userKey, JSON.stringify(this.currentUser));
            return { success: true, user: this.currentUser };
        }
        return { success: false, error: 'Respuesta incorrecta' };
    }

    static logout() {
        this.currentUser = null;
        localStorage.removeItem(this.current_userKey);
    }

    static getCurrentUser() {
        return this.currentUser;
    }

    static isAuthenticated() {
        return this.currentUser !== null;
    }

    static getRole() {
        return this.currentUser ? this.currentUser.role : 'guest';
    }

    static isAdmin() {
        return this.getRole() === 'admin';
    }

    static isGuest() {
        return this.getRole() === 'guest';
    }

    static canAccessInventory() {
        return this.isAdmin();
    }

    static canAccessConfig() {
        return this.isAdmin();
    }

     static verifyAdminPassword(password) {
        return password === this.getAdminPassword();
    }

    static canAccessReports() {
        return this.isAdmin() || this.isGuest();
    }

    static canViewReportCharts() {
        return this.isAdmin();
    }

    static canManageShift() {
        return this.isAdmin();
    }

    static canAccessCashDrawer() {
        return this.isAdmin();
    }

    static canPrintReports() {
        return this.isAdmin();
    }

    static canViewCosts() {
        return this.isAdmin();
    }

    static canViewProfit() {
        return this.isAdmin();
    }

    static canModifyInventory() {
        return this.isAdmin();
    }

    static canModifyPrices() {
        return this.isAdmin();
    }

    static canPerformReturns() {
        return this.isAdmin();
    }

    static canRegisterExpenses() {
        return this.isAdmin();
    }

    static canCancelTickets() {
        return this.isAdmin();
    }

    static canPerformSales() {
        return true;
    }
}

// ============================================================
//  LICENSE - CONTROL DE RENTA Y PROTECCIÓN DE DATOS
// ============================================================

class License {
    // Clave maestra para generación y validación de tokens
    // MODIFICAR AQUÍ PARA CAMBIAR LA CLAVE MAESTRA
    static MASTER_KEY = 'JewerlySecret2026';

    static get storageKeys() {
        return {
            expiration: Business.key('pos_license_expiration'),
            lastUsage: Business.key('pos_last_usage'),
            tampered: Business.key('pos_clock_tampered')
        };
    }

    // --- Generación de tokens (usa la clave maestra + mes/año) ---
    static generateToken(month, year) {
        const data = `${this.MASTER_KEY}|${month.toString().padStart(2, '0')}|${year}`;
        let hash1 = 0;
        let hash2 = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash1 = Math.imul(hash1 ^ char, 2654435761);
            hash2 = Math.imul(hash2 ^ (char << 5), 31517171);
        }
        const h1 = (hash1 >>> 0).toString(36).padStart(6, '0');
        const h2 = (hash2 >>> 0).toString(36).padStart(6, '0');
        return (h1 + h2).toUpperCase().substring(0, 12);
    }

    // --- Validar un token contra el mes/año actual ---
    static validateToken(token, month, year) {
        const expected = this.generateToken(month, year);
        return token.toUpperCase().trim() === expected;
    }

    // --- Obtener la fecha de expiración ---
    static getExpirationDate() {
        const stored = localStorage.getItem(this.storageKeys.expiration);
        if (stored) {
            return new Date(stored);
        }
        return this.getDefaultExpiration();
    }

    // --- Fecha de expiración por defecto: fin del mes actual ---
    static getDefaultExpiration() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const lastDay = new Date(year, month + 1, 0);
        lastDay.setHours(23, 59, 59, 999);
        return lastDay;
    }

    // --- Establecer nueva fecha de expiración (al reactivar) ---
    static setExpiration(date) {
        localStorage.setItem(this.storageKeys.expiration, date.toISOString());
    }

    // --- Extender licencia al final del próximo mes ---
    static extendLicense() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const nextMonth = new Date(year, month + 2, 0);
        nextMonth.setHours(23, 59, 59, 999);
        this.setExpiration(nextMonth);
        return nextMonth;
    }

    // --- Verificar si la licencia está expirada ---
    static isExpired(now = new Date()) {
        return now > this.getExpirationDate();
    }

    // --- Obtener tiempo del servidor (online) o local (offline) ---
    static async getServerTime() {
        let timeoutId;
        try {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch('https://worldtimeapi.org/api/timezone/etc/utc', {
                signal: controller.signal
            });
            if (response.ok) {
                const data = await response.json();
                return new Date(data.datetime);
            }
        } catch (e) {
            // Sin internet o API no disponible
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
        return new Date();
    }

    // --- Último uso registrado en localStorage ---
    static getLastUsage() {
        const stored = localStorage.getItem(this.storageKeys.lastUsage);
        return stored ? new Date(stored) : null;
    }

    static setLastUsage(date) {
        localStorage.setItem(this.storageKeys.lastUsage, date.toISOString());
    }

    // --- Detectar manipulación de reloj (fecha retrocedida) ---
    static checkClockTampering(now) {
        const last = this.getLastUsage();
        if (last && now < last) {
            localStorage.setItem(this.storageKeys.tampered, 'true');
            return true;
        }
        return false;
    }

    // --- Verificar estado de manipulación ---
    static isTampered() {
        return localStorage.getItem(this.storageKeys.tampered) === 'true';
    }

    // --- Limpiar estado de manipulación (después de reactivación) ---
    static clearTamperFlag() {
        localStorage.removeItem(this.storageKeys.tampered);
    }

    // --- Reactivar licencia con token ---
    static reactivate(token) {
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        if (this.validateToken(token, month, year)) {
            this.clearTamperFlag();
            this.extendLicense();
            this.setLastUsage(new Date());
            return { success: true, message: 'Licencia reactivada correctamente' };
        }

        return { success: false, error: 'Token de reactivación inválido' };
    }

    // --- Exportar respaldo completo de localStorage (JSON) ---
    static exportBackup() {
        const backup = {
            timestamp: new Date().toISOString(),
            store: Business.getStoreName(),
            businessName: Business.getBusinessName(),
            businessId: Business.getCurrentBusinessId(),
            license: {
                expiration: localStorage.getItem(this.storageKeys.expiration),
                lastUsage: localStorage.getItem(this.storageKeys.lastUsage),
                tampered: localStorage.getItem(this.storageKeys.tampered)
            },
            auth: {
                adminPassword: localStorage.getItem(Auth.storageKeys.adminPassword),
                guestKey: localStorage.getItem(Auth.storageKeys.guestKey),
                adminUsername: localStorage.getItem(Auth.adminUsernameKey)
            },
            inventory: localStorage.getItem(Inventory.storageKey),
            sales: localStorage.getItem(SaleService.storageKey),
            settings: localStorage.getItem(Settings.storageKey),
            shift: localStorage.getItem(Business.key('pos_shift_opened')),
            shiftSession: localStorage.getItem(Cut.storageKey),
            shiftHistory: localStorage.getItem(Cut.shiftHistoryKey),
            heldSales: localStorage.getItem(HeldSales.storageKey),
            reportHistory: localStorage.getItem(Backup.reportHistoryKey),
            backup: localStorage.getItem(Backup.backupKey),
            emailConfig: localStorage.getItem(Backup.emailConfigKey),
            dayChangeKey: localStorage.getItem(ReportService.dayChangeKey)
        };

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `jewerly-de-luna-respalado-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        return { success: true, message: 'Respaldo exportado correctamente' };
    }
}
