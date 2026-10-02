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
        'pos_last_receipt_sale',
        'pos_license_expiration',
        'pos_last_usage',
        'pos_clock_tampered',
        'pos_email_send_log',
        'pos_guarantee_exchanges'
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

// ============================================================
//  DateUtil: fechas en hora LOCAL del dispositivo.
//  Nunca usar toISOString().split('T')[0] para obtener "el día",
//  porque devuelve la fecha en UTC (en México, después de las
//  18:00 ya es "mañana" en UTC).
// ============================================================
class DateUtil {
    // 'YYYY-MM-DD' en hora local para una fecha (Date o ISO string)
    static toLocalDate(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d.getTime())) return '';
        const pad = (n) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    // Fecha local de hoy 'YYYY-MM-DD'
    static today() {
        return this.toLocalDate(new Date());
    }

    // 'YYYYMMDD' en hora local (para folios y nombres de archivo)
    static compact(value = new Date()) {
        return this.toLocalDate(value).replace(/-/g, '');
    }

    // ¿El registro con fecha ISO cae en el día local indicado?
    static isOnDate(isoDate, localDate) {
        if (!isoDate || !localDate) return false;
        return this.toLocalDate(isoDate) === localDate;
    }
}

window.DateUtil = DateUtil;

// ============================================================
//  Device: identificador corto y permanente de este dispositivo.
//  Se incluye en los folios para que dos dispositivos nunca
//  generen el mismo folio (evita pérdidas al fusionar respaldos).
// ============================================================
class Device {
    static STORAGE_KEY = 'jewelry_deluna_device_id';

    static getId() {
        let id = localStorage.getItem(this.STORAGE_KEY);
        if (!id) {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            id = '';
            for (let i = 0; i < 4; i++) {
                id += chars[Math.floor(Math.random() * chars.length)];
            }
            try { localStorage.setItem(this.STORAGE_KEY, id); } catch { /* sin espacio: se regenera */ }
        }
        return id;
    }
}

window.Device = Device;

// ============================================================
//  Folio: generador de folios únicos PREFIJO-YYYYMMDD-DISP-NNNN
//  El consecutivo se calcula con el MAYOR folio existente del
//  día y dispositivo (incluyendo anulados), por lo que nunca se
//  repite aunque se anulen o borren registros.
// ============================================================
class Folio {
    static next(prefix, existingRecords = []) {
        const base = `${prefix}-${DateUtil.compact()}-${Device.getId()}-`;
        let max = 0;
        existingRecords.forEach(r => {
            if (r && typeof r.id === 'string' && r.id.startsWith(base)) {
                const n = parseInt(r.id.slice(base.length), 10);
                if (!isNaN(n) && n > max) max = n;
            }
        });
        return `${base}${(max + 1).toString().padStart(4, '0')}`;
    }
}

window.Folio = Folio;

// ============================================================
//  SafeStorage: escritura en localStorage con error claro cuando
//  el almacenamiento del navegador está lleno.
// ============================================================
class SafeStorage {
    static isQuotaError(err) {
        return err && (
            err.name === 'QuotaExceededError' ||
            err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
            err.code === 22 || err.code === 1014
        );
    }

    static setItem(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (err) {
            if (this.isQuotaError(err)) {
                const msg = 'El almacenamiento del navegador está lleno. Exporte un respaldo y libere espacio (por ejemplo, quite el logo de la tienda).';
                if (typeof Toast !== 'undefined') Toast.error(msg, 8000);
                throw new Error(msg);
            }
            throw err;
        }
    }
}

window.SafeStorage = SafeStorage;
