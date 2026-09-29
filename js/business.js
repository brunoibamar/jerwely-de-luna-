// ============================================================
//  Business: Aislamiento de Datos por Negocio/Cliente
//  Todos los datos de inventario, ventas y cortes de caja
//  se guardan de forma aislada usando prefijos de negocio
//  en localStorage. Ningún usuario puede sobrescribir o ver
//  la información de otro negocio.
// ============================================================

class Business {
    // Claves globales (NO namespaced) para el registro de negocios
    static CURRENT_BIZ_KEY = 'pos_current_business';
    static REGISTRY_KEY = 'pos_business_registry';

    // Listado maestro de todas las claves que deben ser namespaced
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
        'pos_clock_tampered'
    ];

    // --- Obtener el ID del negocio actual ---
    static getCurrentBusinessId() {
        return localStorage.getItem(this.CURRENT_BIZ_KEY) || 'default';
    }

    // --- Establecer el negocio activo ---
    static setCurrentBusinessId(id) {
        localStorage.setItem(this.CURRENT_BIZ_KEY, id);
    }

    // --- Verificar si hay un negocio seleccionado ---
    static hasCurrentBusiness() {
        return localStorage.getItem(this.CURRENT_BIZ_KEY) !== null;
    }

    // --- Generar una clave namespaced por negocio ---
    // Ejemplo: Business.key('pos_inventory') -> 'pos_inventory__biz_default'
    static key(baseKey) {
        const id = this.getCurrentBusinessId();
        return `${baseKey}__biz_${id}`;
    }

    // --- Registro de negocios disponibles ---
    static getBusinesses() {
        const stored = localStorage.getItem(this.REGISTRY_KEY);
        const defaultBiz = this.getDefaultBusiness();
        if (!stored) return [defaultBiz];
        try {
            const parsed = JSON.parse(stored);
            if (!Array.isArray(parsed) || parsed.length === 0) return [defaultBiz];
            return parsed;
        } catch {
            return [defaultBiz];
        }
    }

    static getDefaultBusiness() {
        return {
            id: 'default',
            name: 'Jewerly De Luna',
            isDefault: true,
            createdAt: new Date().toISOString()
        };
    }

    static saveBusinesses(businesses) {
        localStorage.setItem(this.REGISTRY_KEY, JSON.stringify(businesses));
    }

    static createBusiness(name) {
        if (!name || !name.trim()) {
            return { success: false, error: 'El nombre del negocio es requerido' };
        }
        const businesses = this.getBusinesses();
        const id = `biz_${Date.now()}`;
        const newBiz = {
            id,
            name: name.trim(),
            isDefault: false,
            createdAt: new Date().toISOString()
        };
        businesses.push(newBiz);
        this.saveBusinesses(businesses);
        this.setCurrentBusinessId(id);
        this.migrateExistingData();
        return { success: true, business: newBiz };
    }

    static selectBusiness(id) {
        const businesses = this.getBusinesses();
        const biz = businesses.find(b => b.id === id);
        if (!biz) {
            return { success: false, error: 'Negocio no encontrado' };
        }
        this.setCurrentBusinessId(id);
        this.migrateExistingData();
        return { success: true, business: biz };
    }

    static getBusiness(id = null) {
        const bizId = id || this.getCurrentBusinessId();
        const businesses = this.getBusinesses();
        return businesses.find(b => b.id === bizId) || this.getDefaultBusiness();
    }

    static getStoreName() {
        const biz = this.getBusiness();
        return biz?.name || 'Jewerly De Luna';
    }

    // --- Migrar datos existentes (no namespaced) a claves namespaced ---
    // Se ejecuta al seleccionar o crear un negocio por primera vez.
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

    // --- Borrar todos los datos del negocio actual ---
    static clearCurrentBusinessData() {
        this.ALL_NAMESPACED_KEYS.forEach(key => {
            localStorage.removeItem(this.key(key));
        });
    }

    // --- Eliminar un negocio y sus datos ---
    static deleteBusiness(id) {
        if (id === 'default') {
            return { success: false, error: 'No se puede eliminar el negocio predeterminado' };
        }
        const businesses = this.getBusinesses();
        const filtered = businesses.filter(b => b.id !== id);
        this.saveBusinesses(filtered);

        this.ALL_NAMESPACED_KEYS.forEach(key => {
            localStorage.removeItem(`${key}__biz_${id}`);
        });

        if (this.getCurrentBusinessId() === id) {
            this.setCurrentBusinessId('default');
        }

        return { success: true, message: 'Negocio eliminado correctamente' };
    }
}

window.Business = Business;
