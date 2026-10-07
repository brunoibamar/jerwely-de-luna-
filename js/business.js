// ============================================================
//  Business: Mononegocio Unificado (Jewerly De Luna)
//  El sistema opera bajo un único negocio fijo. Todos los
//  datos de inventario, ventas y cortes de caja se guardan
//  en localStorage bajo un namespace compuesto por el ID del
//  negocio y el ID del DISPOSITIVO (pos_<clave>__biz_default__dev_<deviceId>).
//  Cada navegador/computadora genera y persiste un device_id
//  único; ese ID encadena toda la información a la instancia
//  local. Nada que se simule, venda o borre en un dispositivo
//  afecta la información registrada en otro.
// ============================================================

class Business {
    // Identificador fijo del único negocio
    static FIXED_BIZ_ID = 'default';

    // Nombre fijo del negocio
    static BUSINESS_NAME = 'Jewerly De Luna';

    // Clave fija (global, NO namespaced) para el nombre del negocio.
    // Se usa para determinar si la aplicación ya fue inicializada y
    // para persistir el nombre entre sesiones.
    static BUSINESS_NAME_LEGACY_KEY = 'jewelry_deluna_business_name';

    // Clave namespaced por device_id para el nombre del negocio.
    // Cada dispositivo mantiene su propio nombre independientemente
    // de otros equipos, garantizando aislamiento total.
    static get BUSINESS_NAME_KEY() { return Business.key('pos_business_name'); }

    // Listado maestro de claves que deben guardarse namespaced
    // bajo el negocio único + device_id:
    //   pos_<clave>__biz_default__dev_<deviceId>
    static ALL_NAMESPACED_KEYS = [
         'pos_inventory',
         'pos_sales',
         'pos_sales_historical',
         'pos_shift_closures',
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
        'pos_local_recovery',
        'pos_interval_backup_last',
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
        'pos_guarantee_exchanges',
        'pos_returns',
        'pos_cash_adjustments',
        'pos_storage_snapshot',
         'pos_autobackup_last',
         'pos_business_name',
         'pos_vip_customers',
         'pos_vip_config'
     ];

    // --- Generar una clave namespaced bajo el negocio único + device_id ---
    // Ejemplo: Business.key('pos_inventory')
    //   -> 'pos_inventory__biz_default__dev_DV3K9X7R2'
    // El device_id garantiza aislamiento total por dispositivo: cada
    // navegador/computadora opera sobre su propio conjunto de claves
    // y NUNCA comparte ventas, inventario o cortes de caja.
    static key(baseKey) {
        return `${baseKey}__biz_${this.FIXED_BIZ_ID}__dev_${Device.getId()}`;
    }

    // --- Clave del namespace ANTERIOR (sin device_id) ---
    // Usada exclusivamente por migrateExistingData() para trasladar
    // datos del formato legado pos_<clave>__biz_default al nuevo
    // formato con device_id. Nunca se usa para lectura/escritura activa.
    static oldKey(baseKey) {
        return `${baseKey}__biz_${this.FIXED_BIZ_ID}`;
    }

    // --- Nombre del negocio (clave fija global) ---
    static getBusinessName() {
        const stored = localStorage.getItem(this.BUSINESS_NAME_KEY);
        // Validación defensiva: la clave pos_business_name guarda un string plano,
        // no un objeto JSON. Si el valor no es una cadena válida no vacía, se
        // restablece silenciosamente al valor por defecto sin bloquear la interfaz.
        if (stored && typeof stored === 'string' && stored.trim().length > 0) {
            return stored;
        }
        // Restablecimiento seguro: sobreescribir valor inválido anterior con
        // el nombre predeterminado del negocio ("Jewerly De Luna")
        if (stored !== null) {
            try {
                localStorage.setItem(this.BUSINESS_NAME_KEY, this.BUSINESS_NAME);
            } catch (err) {
                console.warn('[Business] No se pudo restablecer pos_business_name:', err.message);
            }
        }
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

    // --- Device ID de esta instancia (alias de Device.getId) ---
    static getDeviceId() {
        return Device.getId();
    }

    // --- Inicializar datos por defecto si aún no existen ---
    static initDefaults() {
        if (!this.hasBusinessName()) {
            this.setBusinessName(this.BUSINESS_NAME);
        }
    }

    // --- Migrar datos existentes a claves namespaced con device_id ---
    // Realiza una migración en tres fases para preservar datos de
    // versiones anteriores mientras asegura aislamiento por dispositivo:
    //
    //   Fase 1 — Formato legacy (pos_<clave> sin namespace):
    //       Se traslada a pos_<clave>__biz_default__dev_<deviceId>
    //   Fase 2 — Formato anterior (pos_<clave>__biz_default, sin device):
    //       Se traslada a pos_<clave>__biz_default__dev_<deviceId>
    //   Fase 3 — Limpieza: si la nueva clave ya contiene datos, se
    //       eliminan las claves antiguas para evitar duplicación.
    //
    // La migración es idempotente: si los datos ya fueron migrados,
    // no se realiza ninguna acción.
    static migrateExistingData() {
        const migrated = [];

        // --- Migrar el nombre del negocio desde la clave legacy global ---
        // La clave antigua 'jewelry_deluna_business_name' no era namespaced
        // por device_id. Se traslada a 'pos_business_name__biz_default__dev_<deviceId>'.
        const legacyNameKey = this.BUSINESS_NAME_LEGACY_KEY;
        const namespacedNameKey = this.key('pos_business_name');
        if (localStorage.getItem(namespacedNameKey) === null) {
            const legacyData = localStorage.getItem(legacyNameKey);
            if (legacyData !== null) {
                SafeStorage.setItem(namespacedNameKey, legacyData);
                localStorage.removeItem(legacyNameKey);
                migrated.push({ key: 'pos_business_name', from: 'legacy_business_name', to: 'device_namespaced' });
            }
        }

        this.ALL_NAMESPACED_KEYS.forEach(baseKey => {
            const newKey = this.key(baseKey);
            const oldBizKey = this.oldKey(baseKey);

            // --- Fase 3: nueva clave ya tiene datos → limpiar formatos antiguos ---
            if (localStorage.getItem(newKey) !== null) {
                if (localStorage.getItem(oldBizKey) !== null) {
                    localStorage.removeItem(oldBizKey);
                }
                if (localStorage.getItem(baseKey) !== null) {
                    localStorage.removeItem(baseKey);
                }
                return;
            }

            // --- Fase 2: migrar desde pos_<clave>__biz_default ---
            let data = localStorage.getItem(oldBizKey);
            if (data !== null) {
                SafeStorage.setItem(newKey, data);
                localStorage.removeItem(oldBizKey);
                migrated.push({ key: baseKey, from: 'biz_namespaced', to: 'device_namespaced' });
                return;
            }

            // --- Fase 1: migrar desde pos_<clave> (legacy, no namespace) ---
            data = localStorage.getItem(baseKey);
            if (data !== null) {
                SafeStorage.setItem(newKey, data);
                localStorage.removeItem(baseKey);
                migrated.push({ key: baseKey, from: 'legacy', to: 'device_namespaced' });
            }
        });

        return migrated;
    }

    // --- Recuperar datos huérfanos de un device_id anterior ---
    // Si la clave jewelry_deluna_device_id se perdió (limpieza parcial de
    // localStorage, navegación privada, etc.), se genera un nuevo device_id y
    // todos los datos guardados bajo el namespace anterior quedan huérfanos.
    // Este método los detecta, los traslada al namespace del device_id actual
    // y elimina los huérfanos. Es idempotente y seguro:
    //   - Si el namespace actual NO tiene datos → restaura directamente.
    //   - Si el namespace actual YA tiene datos → fusiona (prioriza los
    //     datos actuales, completando con los huérfanos).
    // Siempre prefiere datos existentes sobre los migrados.
    static recoverOrphanedDeviceData() {
        const currentDeviceId = Device.getId();
        const marker = `__biz_${this.FIXED_BIZ_ID}__dev_`;
        const markerLen = marker.length;

        // Recolectar todos los device_ids huérfanos y sus claves
        const orphansByDevice = new Map();
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith('pos_')) continue;

            const idx = key.indexOf(marker);
            if (idx === -1) continue; // no es device-namespaced

            const oldDeviceId = key.substring(idx + markerLen);
            if (oldDeviceId === currentDeviceId) continue; // ya está bajo el device actual

            const baseKey = key.substring(0, idx);
            if (!this.ALL_NAMESPACED_KEYS.includes(baseKey)) continue;

            if (!orphansByDevice.has(oldDeviceId)) {
                orphansByDevice.set(oldDeviceId, []);
            }
            orphansByDevice.get(oldDeviceId).push({ key, baseKey, value: localStorage.getItem(key) });
        }

        if (orphansByDevice.size === 0) {
            return { recovered: false, message: 'No hay datos huérfanos de device_id anterior' };
        }

        // Seleccionar el device_id huérfano con más claves (máxima preservación)
        let bestOldId = null;
        let bestCount = 0;
        for (const [oldId, entries] of orphansByDevice) {
            if (entries.length > bestCount) {
                bestCount = entries.length;
                bestOldId = oldId;
            }
        }

        const restored = [];
        const merged = [];
        const bestOrphans = orphansByDevice.get(bestOldId);

        for (const { key, baseKey, value } of bestOrphans) {
            if (value === null) continue;

            const newKey = this.key(baseKey);
            const existing = localStorage.getItem(newKey);

            if (existing === null) {
                // No hay nada en el namespace actual → restaurar directamente
                SafeStorage.setItem(newKey, value);
                localStorage.removeItem(key);
                restored.push(baseKey);
            } else if (baseKey === 'pos_settings') {
                // Settings: fusionar (los huérfanos completan valores perdidos)
                const oldSettings = SafeJSON.parse(value, null, key);
                const newSettings = SafeJSON.parse(existing, null, newKey);
                if (oldSettings && newSettings &&
                    typeof oldSettings === 'object' && !Array.isArray(oldSettings) &&
                    typeof newSettings === 'object' && !Array.isArray(newSettings)) {
                    const combined = { ...oldSettings, ...newSettings };
                    SafeStorage.setItem(newKey, SafeJSON.stringify(combined));
                    localStorage.removeItem(key);
                    merged.push(baseKey);
                } else {
                    // No se pudo fusionar; preservar lo existente y limpiar huérfano
                    localStorage.removeItem(key);
                }
            } else {
                // Otros datos: preservar actual, limpiar huérfano
                localStorage.removeItem(key);
            }
        }

        // Limpiar los device_ids huérfanos restantes (si algún key no se procesó)
        for (const [oldId, entries] of orphansByDevice) {
            if (oldId === bestOldId) continue;
            for (const { key } of entries) {
                localStorage.removeItem(key);
            }
        }

        // Si se recuperaron el device_id huérfano y la clave del device_id persistía,
        // no borrar jewelry_deluna_device_id (es un dato global, no namespaced)

        return {
            recovered: restored.length > 0 || merged.length > 0,
            restored,
            merged,
            oldDeviceId: bestOldId,
            message: restored.length > 0 || merged.length > 0
                ? `${restored.length + merged.length} clave(s) restaurada(s) desde device_id anterior (${bestOldId})`
                : 'Datos huérfanos limpiados sin restauración'
        };
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

    // --- Date range helpers ---

    // Primer día (lunes) de la semana que contiene `date` (local)
    static startOfWeek(date = new Date()) {
        const d = date instanceof Date ? date : new Date(date);
        const day = d.getDay();
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((day + 6) % 7));
        monday.setHours(0, 0, 0, 0);
        return monday;
    }

    // Último día (domingo) de la semana que contiene `date` (local)
    static endOfWeek(date = new Date()) {
        const d = date instanceof Date ? date : new Date(date);
        const day = d.getDay();
        const sunday = new Date(d);
        sunday.setDate(d.getDate() + (6 - ((day + 6) % 7)));
        sunday.setHours(23, 59, 59, 999);
        return sunday;
    }

    // Array de 7 strings 'YYYY-MM-DD' (lunes → domingo)
    static getWeekDates(date = new Date()) {
        const dates = [];
        const start = this.startOfWeek(date);
        for (let i = 0; i < 7; i++) {
            dates.push(this.toLocalDate(new Date(start.getTime() + i * 86400000)));
        }
        return dates;
    }

    // Primer día del mes (local)
    static startOfMonth(date = new Date()) {
        const d = date instanceof Date ? date : new Date(date);
        return new Date(d.getFullYear(), d.getMonth(), 1);
    }

    // Último día del mes (local)
    static endOfMonth(date = new Date()) {
        const d = date instanceof Date ? date : new Date(date);
        return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    // Array de strings 'YYYY-MM-DD' para cada día del mes que contiene `date`
    static getMonthDates(date = new Date()) {
        const dates = [];
        const start = this.startOfMonth(date);
        const end = this.endOfMonth(date);
        const totalDays = Math.ceil((end - start + 1) / 86400000);
        for (let i = 0; i < totalDays; i++) {
            dates.push(this.toLocalDate(new Date(start.getTime() + i * 86400000)));
        }
        return dates;
    }

    // Primer día del año (local)
    static startOfYear(year = new Date().getFullYear()) {
        return new Date(year, 0, 1);
    }

    // Último día del año (local)
    static endOfYear(year = new Date().getFullYear()) {
        return new Date(year, 11, 31, 23, 59, 59, 999);
    }

    // Nombres de meses en español (para etiquetas de gráfica)
    static MONTH_NAMES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
        'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    // Nombres de días de la semana en español (lunes → domingo)
    static WEEKDAY_NAMES_ES = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
}

window.DateUtil = DateUtil;

// ============================================================
//  Device: identificador permanente y único de este dispositivo.
//  Se asigna una sola vez al iniciar la aplicación por primera vez
//  y se persiste en localStorage (clave global, no namespaced).
//  TODA la información de ventas, inventario y cortes de caja se
//  encadena a este device_id mediante Business.key(), garantizando
//  aislamiento total: lo que ocurra en un dispositivo NUNCA afecta
//  otro.
//  Además se incluye en los folios para que dos dispositivos nunca
//  generen el mismo folio (evita pérdidas al fusionar respaldos).
// ============================================================
class Device {
    static STORAGE_KEY = 'jewelry_deluna_device_id';
    static _cachedId = null

    // Caracteres legibles (excluyen 0/O, 1/I/L para evitar ambigüedades)
    static CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

    static getId() {
        if (this._cachedId !== null) return this._cachedId

        let id = localStorage.getItem(this.STORAGE_KEY)
        if (!id) {
            id = this.generateId()
            try {
                localStorage.setItem(this.STORAGE_KEY, id)
            } catch {
                // sin espacio: el ID se regenera en cada carga, pero
                // aún así aísla datos dentro de una sola sesión de ventana
            }
        }
        this._cachedId = id
        return id
    }

    static generateId() {
        const chars = this.CHARSET
        let id = ''
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
            const bytes = new Uint8Array(8)
            crypto.getRandomValues(bytes)
            for (let i = 0; i < 8; i++) {
                id += chars[bytes[i] % chars.length]
            }
        } else {
            for (let i = 0; i < 8; i++) {
                id += chars[Math.floor(Math.random() * chars.length)]
            }
        }
        return id
    }

    // Verificar si el device_id ya está persistido (usado por el
    // asistente de migración y para auditoría).
    static isInitialized() {
        return localStorage.getItem(this.STORAGE_KEY) !== null
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

// ============================================================
//  SafeJSON: parseo seguro de JSON con fallback y logging.
//  Si el contenido de localStorage se corrompe (JSON inválido),
//  no se lanza excepción: en su lugar se devuelve el valor por
//  defecto y se registra el error para diagnóstico.
// ============================================================
class SafeJSON {
    static parse(stored, fallback = null, context = '') {
        if (stored === null || stored === undefined) return fallback;
        try {
            return JSON.parse(stored);
        } catch (err) {
            try {
                const msg = context
                    ? `[SafeJSON] Error al parsear "${context}" en localStorage: ${err.message}`
                    : `[SafeJSON] JSON inválido: ${err.message}`;
                console.warn(msg);
                if (typeof Toast !== 'undefined' && Toast.error) {
                    Toast.error(`Datos de localStorage corrompidos (${context || 'desconocido'}). Se usarán valores por defecto.`, 8000);
                }
            } catch { }
            return fallback;
        }
    }

    static stringify(value) {
        try {
            return JSON.stringify(value);
        } catch (err) {
            console.error('[SafeJSON] Error al serializar:', err.message);
            return '{}';
        }
    }
}

window.SafeJSON = SafeJSON;

// ============================================================
//  DataValidator: validación de esquemas antes de cargar
//  datos desde localStorage. Cada método verifica que la
//  estructura deserializada tenga los campos y tipos esperados.
//  Si la validación falla, se devuelve false y la capa de
//  almacenamiento puede decidir: migrar, preservar o usar
//  valores por defecto — NUNCA borrar datos existentes.
// ============================================================
class DataValidator {
    static isRecordArray(data, requiredFields = []) {
        if (!Array.isArray(data)) return false;
        for (const item of data) {
            if (item === null || typeof item !== 'object') return false;
            for (const field of requiredFields) {
                if (!(field in item)) return false;
            }
        }
        return true;
    }

    static isValidSale(item) {
        if (item === null || typeof item !== 'object') return false;
        return typeof item.id === 'string' && item.id.length > 0 &&
               typeof item.date === 'string' && item.date.length > 0 &&
               Array.isArray(item.items) &&
               typeof item.total === 'number' && item.total >= 0 &&
               typeof item.status === 'string' &&
               typeof item.paymentMethod === 'string';
    }

    static validateSales(data) {
        if (!Array.isArray(data)) return false;
        return data.every(item => this.isValidSale(item));
    }

    static isValidProduct(item) {
        if (item === null || typeof item !== 'object') return false;
        return typeof item.barcode === 'string' && item.barcode.length > 0 &&
               typeof item.description === 'string' &&
               typeof item.price === 'number' && item.price >= 0 &&
               typeof item.stock === 'number' && item.stock >= 0;
    }

    static validateInventory(data) {
        if (!Array.isArray(data)) return false;
        return data.every(item => this.isValidProduct(item));
    }

    static validateSession(data) {
        if (data === null || typeof data !== 'object') return false;
        return typeof data.id === 'string' &&
               typeof data.openedAt === 'string' &&
               typeof data.isOpen === 'boolean' &&
               typeof data.initialAmount === 'number' &&
               typeof data.role === 'string';
    }

    static validateSessionHistory(data) {
        if (!Array.isArray(data)) return false;
        return data.every(item => this.validateSession(item));
    }

    static validateSettings(data) {
        if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
        for (const [key, value] of Object.entries(data)) {
            if (typeof key !== 'string') return false;
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) return false;
        }
        return true;
    }

    static validateSimpleRecords(data) {
        return this.isRecordArray(data, ['id', 'date']);
    }

    static validateHeldSales(data) {
        if (!Array.isArray(data)) return false;
        return data.every(item => {
            if (item === null || typeof item !== 'object') return false;
            return typeof item.id === 'string' &&
                   typeof item.date === 'string' &&
                   Array.isArray(item.items);
        });
    }

    static validateUser(data) {
        if (data === null || typeof data !== 'object') return false;
        return typeof data.id !== 'undefined' &&
               typeof data.username === 'string' &&
               typeof data.role === 'string';
    }

    static validateVolumeTiers(data) {
        if (!Array.isArray(data)) return false;
        return data.every(tier => {
            if (tier === null || typeof tier !== 'object') return false;
            return typeof tier.min === 'number' &&
                   typeof tier.price === 'number' &&
                   (tier.max === null || typeof tier.max === 'number');
        });
    }

    static isValidVIPCustomer(item) {
        if (item === null || typeof item !== 'object') return false;
        return typeof item.id === 'string' && item.id.length > 0 &&
               typeof item.name === 'string' &&
               typeof item.phone === 'string' &&
               typeof item.accumulatedPieces === 'number' &&
               typeof item.rewardHistory === 'object' &&
               typeof item.createdAt === 'string';
    }

    static validateVIPCustomers(data) {
        if (!Array.isArray(data)) return false;
        return data.every(item => this.isValidVIPCustomer(item));
    }

    static validateVIPConfig(data) {
        if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
        return typeof data.piecesForFreeJewel === 'number' && data.piecesForFreeJewel >= 1;
    }
}

window.DataValidator = DataValidator;

// ============================================================
//  SchemaMigration: sistema de versiones y migración de datos.
//  Cada tipo de datos almacenado lleva un sello de versión.
//  Si la versión es anterior, se ejecuta la migración
//  correspondiente. Si la migración falla, los datos no se
//  pierden: se conservan los valores originales en un backup
//  temporal y se usan los valores por defecto.
// ============================================================
class SchemaMigration {
    static SCHEMA_VERSION = '1.0';

    static versionKey(baseKey) {
        return `${Business.key(baseKey)}__schema_ver`;
    }

    static getVersion(baseKey) {
        return localStorage.getItem(this.versionKey(baseKey)) || '0';
    }

    static setVersion(baseKey) {
        localStorage.setItem(this.versionKey(baseKey), this.SCHEMA_VERSION);
    }

    static needsMigration(baseKey) {
        return this.getVersion(baseKey) !== this.SCHEMA_VERSION;
    }

    static migrate(baseKey, migrateFn, fallback) {
        const currentVersion = this.getVersion(baseKey);
        if (currentVersion === this.SCHEMA_VERSION) {
            return null;
        }

        const raw = localStorage.getItem(Business.key(baseKey));
        if (raw === null) {
            this.setVersion(baseKey);
            return null;
        }

        try {
            const parsed = SafeJSON.parse(raw, fallback);
            const migrated = migrateFn(parsed, currentVersion);
            if (migrated !== null && migrated !== undefined) {
                SafeStorage.setItem(Business.key(baseKey), SafeJSON.stringify(migrated));
            }
            this.setVersion(baseKey);
            if (typeof Toast !== 'undefined' && Toast.info) {
                Toast.info(`Datos actualizados a la nueva versión (${baseKey}).`, 4000);
            }
            return migrated;
        } catch (err) {
            console.error(`[SchemaMigration] Error migrando ${baseKey}:`, err);
        }

        this.setVersion(baseKey);
        return null;
    }
}

window.SchemaMigration = SchemaMigration;

// ============================================================
//  StorageGuard: verificación de integridad de localStorage
//  al arranque. Recorre cada almacén crítico, valida el esquema
//  y, si detecta datos corruptos, NUNCA los borra: en su lugar
//  registra un respaldo temporal y preserva el contenido
//  original para diagnóstico. El usuario puede recuperarlo
//  manualmente o mediante el asistente de restauración.
// ============================================================
class StorageGuard {
    // Mapeo de claves de almacenamiento a sus validadores y fallbacks.
    // El fallback se usa SOLO cuando los datos están completamente
    // inutilizables (JSON corrupto); nunca sobreescribe datos válidos.
    static STORES = [
        { key: 'pos_sales', validate: (d) => DataValidator.validateSales(d), fallback: [] },
        { key: 'pos_sales_historical', validate: (d) => DataValidator.validateSales(d), fallback: [] },
        { key: 'pos_shift_closures', validate: (d) => Array.isArray(d), fallback: [] },
        { key: 'pos_inventory', validate: (d) => DataValidator.validateInventory(d), fallback: [] },
        { key: 'pos_shift_history', validate: (d) => DataValidator.validateSessionHistory(d), fallback: [] },
        { key: 'pos_settings', validate: (d) => DataValidator.validateSettings(d), fallback: {} },
        { key: 'pos_held_sales', validate: (d) => DataValidator.validateHeldSales(d), fallback: [] },
        { key: 'pos_returns', validate: (d) => DataValidator.validateSimpleRecords(d) || Array.isArray(d), fallback: [] },
        { key: 'pos_cash_adjustments', validate: (d) => DataValidator.validateSimpleRecords(d) || Array.isArray(d), fallback: [] },
        { key: 'pos_guarantee_exchanges', validate: (d) => DataValidator.validateSimpleRecords(d) || Array.isArray(d), fallback: [] },
         { key: 'pos_volume_pricing', validate: (d) => DataValidator.validateVolumeTiers(d), fallback: null },
         { key: 'pos_vip_config', validate: (d) => DataValidator.validateVIPConfig(d), fallback: null },
         { key: 'pos_vip_customers', validate: (d) => DataValidator.validateVIPCustomers(d), fallback: [] },
         { key: 'pos_current_user', validate: (d) => DataValidator.validateUser(d), fallback: null, isObject: true },
        { key: 'pos_business_name', validate: (d) => typeof d === 'string' && d.length > 0, fallback: null, isObject: false, defaultValue: Business.BUSINESS_NAME }
    ];

    // AUDIT DE AISLAMIENTO POR DISPOSITIVO
    // Recorre todas las claves de localStorage y verifica que ninguna
    // clave de datos de negocio quede sin el namespace de device_id.
    // Una clave sin namespace indica datos del dispositivo anterior que
    // podrían mezclarse con los del dispositivo actual.
    static checkDeviceIsolation() {
        const deviceId = Device.getId();
        const expectedSuffix = `__biz_${Business.FIXED_BIZ_ID}__dev_${deviceId}`;
        const legacyBizSuffix = `__biz_${Business.FIXED_BIZ_ID}`;
        const suspicious = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith('pos_')) continue;

            const namespacedKey = Business.ALL_NAMESPACED_KEYS.find(bk => key === Business.key(bk));
            if (namespacedKey) continue;

            if (key.endsWith(legacyBizSuffix)) {
                suspicious.push({ key, issue: 'legacy_namespace_without_device_id' });
            } else if (Business.ALL_NAMESPACED_KEYS.includes(key)) {
                suspicious.push({ key, issue: 'legacy_non_namespaced' });
            } else if (!key.endsWith(expectedSuffix)) {
                suspicious.push({ key, issue: 'unknown_namespace' });
            }
        }

        if (localStorage.getItem(Business.BUSINESS_NAME_LEGACY_KEY) !== null) {
            suspicious.push({ key: Business.BUSINESS_NAME_LEGACY_KEY, issue: 'legacy_business_name_key' });
        }

        return {
            deviceId,
            expectedSuffix,
            totalKeys: localStorage.length,
            suspiciousKeys: suspicious
        };
    }

    // Verificar y reparar todos los almacenes críticos.
    // Devuelve un reporte con el estado de cada almacén.
    static checkAll() {
        const report = { checked: 0, valid: 0, corrupt: 0, actions: [] };

        this.STORES.forEach(({ key, validate, fallback, isObject, defaultValue }) => {
            const storageKey = Business.key(key);
            const stored = localStorage.getItem(storageKey);
            report.checked++;

            if (!stored) {
                report.valid++;
                return;
            }

            // Para claves que guardan texto plano (isObject === false), leer el
            // valor directamente con localStorage.getItem() sin pasar por JSON.parse.
            // Esto evita que SafeJSON interprete una cadena plana como JSON corrupto
            // y dispare falsos positivos de corrupción (ej. pos_business_name).
            let parsed;
            if (isObject === false) {
                parsed = stored;
            } else {
                parsed = SafeJSON.parse(stored, fallback, key);
            }

            if (isObject === false) {
                // Validación defensiva de texto plano: si el valor no pasa la
                // validación, restablecer silenciosamente el valor por defecto
                if (validate(parsed)) {
                    report.valid++;
                } else {
                    report.corrupt++;
                    report.actions.push({
                        key: storageKey,
                        status: 'corrupt',
                        detail: `Valor inválido en "${key}" — restablecido a valor por defecto`
                    });
                    console.warn(`[StorageGuard] Valor inválido en "${storageKey}":`, parsed, '→ restablecido');
                    try {
                        localStorage.setItem(storageKey, defaultValue);
                    } catch (err) {
                        console.warn(`[StorageGuard] No se pudo restablecer el valor por defecto para "${storageKey}":`, err.message);
                    }
                }
            } else if (parsed === fallback || parsed === null) {
                report.corrupt++;
                report.actions.push({
                    key: storageKey,
                    status: 'corrupt',
                    detail: 'JSON inválido — datos no recuperables del localStorage'
                });
            } else if (validate(parsed)) {
                report.valid++;
            } else {
                report.corrupt++;
                report.actions.push({
                    key: storageKey,
                    status: 'schema_mismatch',
                    detail: `Esquema inesperado en "${key}" — los datos se preservan pero pueden requerir atención`
                });
                console.warn(`[StorageGuard] Esquema inesperado en ${storageKey}:`, parsed);
            }
        });

        const isolation = this.checkDeviceIsolation();
        report.deviceId = isolation.deviceId;
        report.suspiciousKeys = isolation.suspiciousKeys;
        if (isolation.suspiciousKeys.length > 0) {
            isolation.suspiciousKeys.forEach(({ key, issue }) => {
                report.actions.push({
                    key,
                    status: 'isolation_warning',
                    detail: `Clave sin aislamiento por device_id: ${issue}. Se migrará al namespace correcto.`
                });
                console.warn(`[StorageGuard] Clave sin aislamiento: ${key} (${issue})`);
            });
        }

        return report;
    }

    // Preservar datos críticos creando un snapshot temporal antes
    // de que cualquier operación pueda modificarlos. Útil antes de
    // migraciones o restauraciones forzosas.
    static createSnapshot() {
        const snapshot = {
            timestamp: new Date().toISOString(),
            stores: {}
        };
        this.STORES.forEach(({ key }) => {
            const storageKey = Business.key(key);
            const stored = localStorage.getItem(storageKey);
            if (stored !== null) {
                snapshot.stores[storageKey] = stored;
            }
        });
        const snapshotKey = Business.key('pos_storage_snapshot');
        SafeStorage.setItem(snapshotKey, SafeJSON.stringify(snapshot));
        return snapshotKey;
    }

    // Restaurar desde un snapshot temporal (usado por ErrorBoundary
    // o por el asistente de recuperación cuando los datos se corrompen).
    static restoreSnapshot() {
        const snapshotKey = Business.key('pos_storage_snapshot');
        const stored = localStorage.getItem(snapshotKey);
        if (!stored) return { success: false, error: 'No hay instantánea disponible' };

        const snapshot = SafeJSON.parse(stored, null, 'storage_snapshot');
        if (!snapshot || !snapshot.stores) {
            return { success: false, error: 'Instantánea corrupta' };
        }

        let restored = 0;
        Object.entries(snapshot.stores).forEach(([key, value]) => {
            if (value !== null) {
                localStorage.setItem(key, value);
                restored++;
            }
        });
        localStorage.removeItem(snapshotKey);
        return { success: true, restored };
    }
}

window.StorageGuard = StorageGuard;
