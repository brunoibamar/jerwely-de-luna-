// Almacenamiento operativo. Las lecturas usan una vista de datos confirmados;
// las escrituras sólo son válidas dentro de una transacción explícita.
class AppStorage {
    static native = window.localStorage;
    static ready = false;
    static records = new Map();
    static originals = {};
    static conflicts = {};
    static staged = null;
    static queue = Promise.resolve();
    static bases = new Set([
        'pos_inventory', 'pos_sales', 'pos_sales_historical', 'pos_shift_closures',
        'pos_settings', 'pos_volume_pricing', 'pos_held_sales', 'pos_shift_session',
        'pos_shift_history', 'pos_returns', 'pos_cash_adjustments',
        'pos_guarantee_exchanges', 'pos_vip_customers', 'pos_vip_config',
        'pos_datos_bancarios', 'pos_report_history', 'pos_last_receipt_sale',
        'pos_pending_reports', 'pos_email_send_log'
    ]);

    static managed(key) { return this.bases.has(String(key).split('__')[0]); }
    static keys() {
        const keys = new Set(Object.keys(this.native).filter(k => !this.ready || !this.managed(k)));
        if (this.ready) for (const key of this.records.keys()) keys.add(key);
        if (this.staged) for (const [key, value] of this.staged) {
            if (value === null) keys.delete(key); else keys.add(key);
        }
        return [...keys];
    }
    static get length() { return this.keys().length; }
    static key(index) { return this.keys()[index] ?? null; }
    static getItem(key) {
        if (!this.ready || !this.managed(key)) return this.native.getItem(key);
        if (this.staged?.has(key)) return this.staged.get(key);
        return this.records.get(key) ?? null;
    }
    static setItem(key, value) {
        if (!this.managed(key)) return this.native.setItem(key, value);
        this.stage(key, String(value));
    }
    static removeItem(key) {
        if (!this.managed(key)) return this.native.removeItem(key);
        this.stage(key, null);
    }
    static stage(key, value) {
        if (!this.ready || !this.staged) throw new Error('El guardado requiere una transacción confirmada. No se modificaron los datos.');
        try {
            const previous = this.getItem(key);
            const oldData = previous === null ? null : JSON.parse(previous);
            const nextData = value === null ? null : JSON.parse(value);
            const validators = {
                pos_sales: 'validateSales', pos_sales_historical: 'validateSales',
                pos_inventory: 'validateInventory', pos_vip_customers: 'validateVIPCustomers',
                pos_shift_history: 'validateSessionHistory', pos_held_sales: 'validateHeldSales',
                pos_shift_session: 'validateSession',
                pos_returns: 'validateSimpleRecords', pos_cash_adjustments: 'validateSimpleRecords',
                pos_guarantee_exchanges: 'validateSimpleRecords', pos_shift_closures: 'isRecordArray',
                pos_report_history: 'isRecordArray', pos_pending_reports: 'isRecordArray', pos_email_send_log: 'isRecordArray',
                pos_settings: 'validateSettings', pos_datos_bancarios: 'validateBankData',
                pos_vip_config: 'validateVIPConfig', pos_volume_pricing: 'validateVolumeTiers'
            };
            const validator = validators[key.split('__')[0]];
            const legacyCopy = previous === null && Object.values(this.originals).includes(value);
            if (value !== null && validator && !legacyCopy && !window.DataValidator[validator](nextData) &&
                (previous === null || window.DataValidator[validator](oldData))) {
                throw new Error('Los cambios no cumplen el formato esperado. La operación no se confirmó.');
            }
            if (previous !== null && validator && !window.DataValidator[validator](oldData)) {
                if (!Array.isArray(oldData) || !Array.isArray(nextData)) throw new Error('Un registro original requiere revisión; se conservó intacto.');
                const available = new Map();
                for (const item of nextData) { const raw = JSON.stringify(item); available.set(raw, (available.get(raw) || 0) + 1); }
                for (const item of oldData) {
                    const raw = JSON.stringify(item), count = available.get(raw) || 0;
                    if (!count) throw new Error('No se permite reemplazar registros originales con formato pendiente de revisión.');
                    available.set(raw, count - 1);
                }
            }
            this.staged.set(key, value);
        } catch (err) { this.tainted = err; throw err; }
    }
    static busy(message) {
        let panel = document.getElementById('storage-busy');
        if (!message) { panel?.remove(); return; }
        if (!panel) {
            panel = document.createElement('div'); panel.id = 'storage-busy';
            panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
            panel.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(10,12,27,.92);color:#fff;display:flex;flex-direction:column;gap:20px;align-items:center;justify-content:center;padding:32px;text-align:center;font:18px sans-serif';
            document.body.appendChild(panel);
        }
        panel.textContent = message;
        if (Object.keys(this.conflicts).length) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'btn btn-primary';
            button.textContent = 'Descargar respaldo de emergencia';
            button.addEventListener('click', () => window.ErrorBoundary?.downloadEmergencyBackup());
            panel.appendChild(button);
        }
    }
    static async lock(fn) {
        if (!navigator.locks?.request) throw new Error('Este navegador no permite coordinar el guardado seguro. Conserve sus datos y descargue un respaldo de emergencia.');
        return navigator.locks.request('jdl-operational-storage', fn);
    }
    static tx(stores, mode, run) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
            let result;
            try { result = run(tx); } catch (err) { tx.abort(); reject(err); return; }
            tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result);
            tx.onerror = () => reject(tx.error || new Error('No se completó el guardado'));
            tx.onabort = () => reject(tx.error || new Error('El guardado se canceló; no se confirmó la operación'));
        });
    }
    static async refresh() {
        const data = await this.tx(['records', 'meta'], 'readonly', tx => {
            const keys = tx.objectStore('records').getAllKeys(), values = tx.objectStore('records').getAll();
            const state = tx.objectStore('meta').get('state');
            return () => ({ entries: keys.result.map((key, i) => [key, values.result[i]]), state: state.result });
        });
        this.records = new Map(data.entries);
        if (!data.state || Object.keys(data.state).length !== this.records.size) throw new Error('No coincide la lista de registros guardados. Se detuvo el sistema para conservar las copias originales.');
        for (const [key, value] of this.records) {
            if (data.state[key] !== await this.fingerprint(value)) throw new Error('No se verificó un registro guardado. Descargue un respaldo de emergencia; no se reemplazaron los datos.');
        }
        this.manifest = data.state;
    }
    static async fingerprint(value) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    static async init() {
        this.busy('Preparando el almacenamiento de la joyería. No cierre esta página.');
        try {
            await this.lock(async () => {
                this.db = await new Promise((resolve, reject) => {
                    const req = indexedDB.open('jdl_operational_v1', 1);
                    req.onupgradeneeded = () => { for (const name of ['records', 'originals', 'meta', 'conflicts']) req.result.createObjectStore(name); };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                    req.onblocked = () => reject(new Error('Cierre las otras pestañas del punto de venta y vuelva a abrir ésta.'));
                });
                this.db.onversionchange = () => { this.db.close(); this.ready = false; this.busy('Se actualizó el almacenamiento. Recargue esta página antes de continuar.'); };
                const meta = await this.tx(['meta'], 'readonly', tx => { const req = tx.objectStore('meta').get('migration'); return () => req.result; });
                const initial = {};
                for (const key of Object.keys(this.native)) if (this.managed(key)) initial[key] = this.native.getItem(key);
                if (!meta) {
                    this.busy('Copiando los registros originales. No cierre esta página.');
                    const state = Object.fromEntries(await Promise.all(Object.entries(initial).map(async ([key, value]) => [key, await this.fingerprint(value)])));
                    await this.tx(['records', 'originals', 'meta'], 'readwrite', tx => {
                        for (const [key, value] of Object.entries(initial)) {
                            tx.objectStore('records').put(value, key);
                            tx.objectStore('originals').add(value, key);
                        }
                        tx.objectStore('meta').put({ completedAt: new Date().toISOString(), keys: Object.keys(initial) }, 'migration');
                        tx.objectStore('meta').put(state, 'state');
                    });
                }
                this.originals = await this.tx(['originals'], 'readonly', tx => {
                    const keys = tx.objectStore('originals').getAllKeys(), values = tx.objectStore('originals').getAll();
                    return () => Object.fromEntries(keys.result.map((key, i) => [key, values.result[i]]));
                });
                await this.refresh();
                this.conflicts = await this.tx(['conflicts'], 'readonly', tx => {
                    const keys = tx.objectStore('conflicts').getAllKeys(), values = tx.objectStore('conflicts').getAll();
                    return () => Object.fromEntries(keys.result.map((key, i) => [key, values.result[i]]));
                });
                this.busy('Verificando la copia de los registros. No cierre esta página.');
                if (!meta && (this.records.size !== Object.keys(initial).length || Object.entries(initial).some(([key, value]) => this.records.get(key) !== value || this.originals[key] !== value))) {
                    throw new Error('La copia no coincidió con los originales. Se conservó el almacenamiento anterior.');
                }
                for (const [key, value] of Object.entries(initial)) {
                    if (this.native.getItem(key) !== value || (this.records.get(key) !== value && this.originals[key] !== value)) {
                        this.conflicts[key] = this.native.getItem(key);
                    }
                }
                for (const key of Object.keys(this.native)) {
                    if (this.managed(key) && !Object.hasOwn(initial, key)) this.conflicts[key] = this.native.getItem(key);
                }
                if (Object.keys(this.conflicts).length) {
                    await this.tx(['conflicts'], 'readwrite', tx => { for (const [key, value] of Object.entries(this.conflicts)) tx.objectStore('conflicts').put(value, key); });
                    throw new Error('Otra pestaña o una versión anterior tiene datos diferentes. Se conservaron ambas copias. Descargue el respaldo de emergencia antes de continuar.');
                }
                // Se retira sólo el duplicado, después de verificar original y
                // copia. Los originales permanecen inmutables en IndexedDB.
                for (const [key, value] of Object.entries(initial)) if (this.native.getItem(key) === value) this.native.removeItem(key);
                this.ready = true;
            });
            this.channel = new BroadcastChannel('jdl-operational-updates');
            this.channel.onmessage = () => {
                this.queue = this.queue.catch(() => {}).then(async () => {
                    const before = new Map(this.records); await this.refresh();
                    for (const key of new Set([...before.keys(), ...this.records.keys()])) {
                        const oldValue = before.get(key) ?? null, newValue = this.records.get(key) ?? null;
                        if (oldValue !== newValue) window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: this.native }));
                    }
                });
            };
            window.addEventListener('storage', event => {
                if (event.storageArea !== this.native || !this.managed(event.key) || event.newValue === null || this.records.get(event.key) === event.newValue) return;
                this.conflicts[event.key] = event.newValue;
                this.tx(['conflicts'], 'readwrite', tx => tx.objectStore('conflicts').put(event.newValue, event.key)).catch(() => {});
                this.busy('Hay otra pestaña usando una versión anterior del punto de venta. Cierre esa pestaña y descargue un respaldo de emergencia antes de continuar.');
            });
        } finally { if (!Object.keys(this.conflicts).length) this.busy(null); }
    }
    static transaction(fn) {
        if (this.staged) throw new Error('No se permiten transacciones asíncronas anidadas');
        const run = () => this.lock(async () => {
            if (!this.ready || Object.keys(this.conflicts).length) throw new Error('El almacenamiento no está listo. No se confirmó la operación.');
            await this.refresh();
            this.staged = new Map(); this.tainted = null;
            let result, changes;
            try {
                result = fn();
                if (result?.then) throw new Error('La preparación de los cambios debe ser síncrona');
                if (this.tainted) throw this.tainted;
                changes = this.staged;
            } finally { this.staged = null; }
            if (result?.success === false) return result;
            if (changes.size) {
                const manifest = { ...this.manifest };
                for (const [key, value] of changes) {
                    if (value === null) delete manifest[key];
                    else manifest[key] = await this.fingerprint(value);
                }
                await this.tx(['records', 'meta'], 'readwrite', tx => {
                    const store = tx.objectStore('records');
                    for (const [key, value] of changes) {
                        if (value === null) store.delete(key); else store.put(value, key);
                    }
                    tx.objectStore('meta').put(manifest, 'state');
                });
                this.manifest = manifest;
                for (const [key, value] of changes) { if (value === null) this.records.delete(key); else this.records.set(key, value); }
                try { this.channel?.postMessage({ updated: Date.now() }); }
                catch (err) { console.warn('[AppStorage] Operación confirmada; no se notificó a las otras pestañas:', err?.message); }
            }
            return result;
        });
        this.pending = (this.pending || 0) + 1;
        this.busy('Guardando y verificando la operación. Espere un momento.');
        const result = this.queue.catch(() => {}).then(run);
        this.queue = result.catch(() => {});
        return result.finally(() => { if (--this.pending === 0) this.busy(null); });
    }
}
window.AppStorage = AppStorage;
