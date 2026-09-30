// ============================================================
//  Business: Mononegocio Unificado (Jewerly De Luna)
//  El sistema opera bajo un único negocio fijo. Todos los
//  datos de inventario, ventas y cortes de caja se guardan
//  en una estructura única de localStorage usando un namespace
//  fijo (pos_<clave>__biz_default). Ningún usuario puede
//  sobrescribir o ver información de otro negocio porque no
//  existe selección ni creación de múltiples negocios.
// ============================================================

class Business {
    // Identificador fijo del único negocio
    static FIXED_BIZ_ID = 'default';

    // Nombre fijo del negocio
    static BUSINESS_NAME = 'Jewerly De Luna';

    // Clave fija (global, NO namespaced) para el nombre del negocio.
    // Se usa para determinar si la aplicación ya fue inicializada y
    // para persistir el nombre entre sesiones.
    static BUSINESS_NAME_KEY = 'jewelry_deluna_business_name';

    // Listado maestro de claves que deben guardarse namespaced
    // bajo el negocio único (pos_<clave>__biz_default).
    static ALL_NAMESPACED_KEYS = [
        'pos_inventory',
        'pos_sales',
        'pos_settings',
        'pos_volume_pricing',
        'pos_held_sales',
        'pos_admin_password',
        'pos_guest_key',
        'pos_admin_username',
        'pos_current_user',
        'pos_drawer_initial',
        'pos_admin_email',
        'pos_shift_opened',
        'pos_shift_session',
        'pos_shift_history',
        'pos_last_known_date',
        'pos_backup',
        'pos_pending_reports',
        'pos_email_config',
        'pos_report_history',
        'pos_last_monthly_report',
        'pos_last_annual_report',
        'pos_license_expiration',
        'pos_last_usage',
        'pos_clock_tampered',
        'pos_email_send_log'
    ];

    // --- Generar una clave namespaced bajo el negocio único ---
    // Ejemplo: Business.key('pos_inventory') -> 'pos_inventory__biz_default'
    static key(baseKey) {
        return `${baseKey}__biz_${this.FIXED_BIZ_ID}`;
    }

    // --- Nombre del negocio (clave fija global) ---
    static getBusinessName() {
        const stored = localStorage.getItem(this.BUSINESS_NAME_KEY);
        if (stored) return stored;
        return this.BUSINESS_NAME;
    }

    static setBusinessName(name) {
        if (name && name.trim()) {
            localStorage.setItem(this.BUSINESS_NAME_KEY, name.trim());
        }
    }

    static hasBusinessName() {
        return localStorage.getItem(this.BUSINESS_NAME_KEY) !== null;
    }

    // --- Nombre de la tienda (alias, mantiene compatibilidad con backup.js, cut.js, etc.) ---
    static getStoreName() {
        return this.getBusinessName();
    }

    // --- ID del negocio actual (fijo) ---
    static getCurrentBusinessId() {
        return this.FIXED_BIZ_ID;
    }

    // --- Inicializar datos por defecto si aún no existen ---
    static initDefaults() {
        if (!this.hasBusinessName()) {
            this.setBusinessName(this.BUSINESS_NAME);
        }
    }

    // --- Migrar datos existentes (no namespaced) a claves namespaced del negocio único ---
    // Se ejecuta una sola vez al iniciar para preservar datos de versiones anteriores.
    static migrateExistingData() {
        const migrated = [];
        this.ALL_NAMESPACED_KEYS.forEach(key => {
            const namespacedKey = this.key(key);
            const oldData = localStorage.getItem(key);
            if (oldData !== null && localStorage.getItem(namespacedKey) === null) {
                localStorage.setItem(namespacedKey, oldData);
                localStorage.removeItem(key);
                migrated.push(key);
            }
        });
        return migrated;
    }
}

window.Business = Business;
