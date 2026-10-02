// ============================================================
//  Módulo VIP: Programa de Fidelización
//  Jewerly De Luna - Sistema POS
//  - Gestión de clientes VIP con: Nombre Completo, Teléfono
//    (clave de búsqueda), Notas y Piezas Acumuladas
//  - Historial de recompensas (canje de Joyas Gratis)
//  - Configuración exclusiva de administrador: meta de
//    "Número de piezas para Joya Gratis"
// ============================================================

class VIPConfig {
    static get storageKey() { return Business.key('pos_vip_config'); }

    static getDefaultConfig() {
        return {
            piecesForFreeJewel: 10
        };
    }

    static getConfig() {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) {
            this.saveConfig(this.getDefaultConfig());
            return { ...this.getDefaultConfig() };
        }
        const parsed = SafeJSON.parse(stored, null, 'vip_config');
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ...this.getDefaultConfig() };
        }
        return { ...this.getDefaultConfig(), ...parsed };
    }

    static getPiecesForFreeJewel() {
        return this.getConfig().piecesForFreeJewel || 10;
    }

    static savePiecesForFreeJewel(value) {
        const config = this.getConfig();
        const parsed = parseInt(value);
        config.piecesForFreeJewel = isNaN(parsed) || parsed < 1 ? this.getDefaultConfig().piecesForFreeJewel : parsed;
        this.saveConfig(config);
        return config;
    }

    static saveConfig(config) {
        SafeStorage.setItem(this.storageKey, SafeJSON.stringify(config));
    }

    static resetToDefault() {
        this.saveConfig(this.getDefaultConfig());
        return { success: true, message: 'Configuración VIP restablecida por defecto' };
    }
}

class VIPCustomer {
    static get storageKey() { return Business.key('pos_vip_customers'); }

    static getAll() {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) return [];
        const parsed = SafeJSON.parse(stored, [], 'vip_clientes');
        if (!DataValidator.validateVIPCustomers(parsed)) {
            console.warn('[VIPCustomer] Formato inválido en clientes VIP; se preserva el estado.');
            return [];
        }
        return parsed;
    }

    static save(customers) {
        SafeStorage.setItem(this.storageKey, SafeJSON.stringify(customers));
    }

    static findByPhone(phone) {
        return this.getAll().find(c => c.phone === phone) || null;
    }

    static findById(id) {
        return this.getAll().find(c => c.id === id) || null;
    }

    static search(query) {
        if (!query) return this.getAll();
        const lower = query.toLowerCase();
        return this.getAll().filter(c =>
            c.name.toLowerCase().includes(lower) ||
            c.phone.includes(query)
        );
    }

    static generateId() {
        return `vip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    }

    static add(customer) {
        const customers = this.getAll();
        if (customers.some(c => c.phone === customer.phone)) {
            return { success: false, error: 'Ya existe un cliente con ese número de teléfono' };
        }
        const newCustomer = {
            id: this.generateId(),
            name: customer.name.trim(),
            phone: customer.phone.trim(),
            notes: customer.notes.trim() || '',
            accumulatedPieces: 0,
            rewardHistory: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        customers.push(newCustomer);
        this.save(customers);
        return { success: true, customer: newCustomer };
    }

    static update(id, updatedCustomer) {
        const customers = this.getAll();
        const index = customers.findIndex(c => c.id === id);
        if (index === -1) return { success: false, error: 'Cliente no encontrado' };
        customers[index] = { ...customers[index], ...updatedCustomer, updatedAt: new Date().toISOString() };
        this.save(customers);
        return { success: true };
    }

    static remove(id) {
        const customers = this.getAll().filter(c => c.id !== id);
        this.save(customers);
        return { success: true };
    }

    static addPieces(id, pieces, note = '') {
        const customer = this.findById(id);
        if (!customer) return { success: false, error: 'Cliente no encontrado' };
        const count = parseInt(pieces);
        if (isNaN(count) || count <= 0) {
            return { success: false, error: 'El número de piezas debe ser mayor a 0' };
        }
        customer.accumulatedPieces = (customer.accumulatedPieces || 0) + count;
        customer.updatedAt = new Date().toISOString();
        customer.rewardHistory.push({
            id: `rw_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: new Date().toISOString(),
            type: 'acumulacion',
            pieces: count,
            description: `Se acumularon ${count} pieza(s)`,
            note: note.trim()
        });
        return this.update(id, customer);
    }

    static redeemReward(id, note = '') {
        const customer = this.findById(id);
        if (!customer) return { success: false, error: 'Cliente no encontrado' };

        const threshold = VIPConfig.getPiecesForFreeJewel();
        if (customer.accumulatedPieces < threshold) {
            return { success: false, error: `Se requieren ${threshold} piezas acumuladas para canjear` };
        }

        customer.accumulatedPieces = (customer.accumulatedPieces || 0) - threshold;
        customer.updatedAt = new Date().toISOString();
        customer.rewardHistory.push({
            id: `rw_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: new Date().toISOString(),
            type: 'canje',
            pieces: -threshold,
            description: 'Joya Gratis canjeada',
            note: note.trim()
        });
        this.update(id, customer);
        return { success: true, customer: this.findById(id) };
    }

    static redeemAndReset(id, note = '') {
        const customer = this.findById(id);
        if (!customer) return { success: false, error: 'Cliente no encontrado' };

        const threshold = VIPConfig.getPiecesForFreeJewel();
        if (customer.accumulatedPieces < threshold) {
            return { success: false, error: `Se requieren ${threshold} piezas acumuladas para canjear` };
        }

        const redeemed = customer.accumulatedPieces || 0;
        customer.accumulatedPieces = 0;
        customer.updatedAt = new Date().toISOString();
        customer.rewardHistory.push({
            id: `rw_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: new Date().toISOString(),
            type: 'canje',
            pieces: -redeemed,
            description: 'Joya Gratis canjeada (contador reiniciado)',
            note: note.trim()
        });
        this.update(id, customer);
        return { success: true, customer: this.findById(id) };
    }

    static getCurrentStatus(customer) {
        const threshold = VIPConfig.getPiecesForFreeJewel();
        const pieces = customer.accumulatedPieces || 0;
        if (pieces >= threshold) {
            return { text: 'Elegible para Joya Gratis', className: 'status-eligible' };
        }
        return { text: `Acumulando (${pieces} / ${threshold})`, className: 'status-accumulating' };
    }

    static getRewardHistory(customer) {
        return customer.rewardHistory || [];
    }

    static count() {
        return this.getAll().length;
    }
}

window.VIPConfig = VIPConfig;
window.VIPCustomer = VIPCustomer;
