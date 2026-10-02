// ============================================================
//  Módulo de Cambio por Garantía / Defecto
//  Jewerly De Luna - Sistema POS
//  - Gestión de intercambios por piezas defectuosas/defecto
//  - Sin reembolso de dinero ($0.00 en caja)
//  - Ajuste físico de inventario: descuenta pieza de reemplazo,
//    registra pieza recibida con estatus "Baja por Garantía"
// ============================================================

class GuaranteeExchange {
    static get storageKey() { return Business.key('pos_guarantee_exchanges'); }

    static getAll() {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) return [];
        const parsed = SafeJSON.parse(stored, [], 'garantias');
        if (!DataValidator.validateSimpleRecords(parsed) && !Array.isArray(parsed)) {
            console.warn('[GuaranteeExchange] Formato inválido en garantías; se preserva el estado.');
            return [];
        }
        return Array.isArray(parsed) ? parsed : [];
    }

    static save(exchanges) {
        SafeStorage.setItem(this.storageKey, SafeJSON.stringify(exchanges));
    }

    // --- Generar folio único de cambio por garantía ---
    static generateId() {
        return Folio.next('GAR', this.getAll());
    }

    // Guardar un intercambio por garantía
    static add(record) {
        const exchanges = this.getAll();
        record.id = this.generateId();
        record.date = new Date().toISOString();
        record.cashier = record.cashier || (Auth.getCurrentUser()?.name || 'Desconocido');
        record.amount = 0;
        record.status = 'completed';
        exchanges.push(record);
        this.save(exchanges);
        return record;
    }

    // Obtener intercambios por venta original
    static getBySale(saleId) {
        return this.getAll().filter(r => r.saleId === saleId);
    }

    // Obtener intercambios por fecha (día calendario)
    static getByDate(date = DateUtil.today()) {
        return this.getAll().filter(r => DateUtil.isOnDate(r.date, date));
    }

    static getById(id) {
        return this.getAll().find(r => r.id === id);
    }

    static count() {
        return this.getAll().length;
    }
}

window.GuaranteeExchange = GuaranteeExchange;
