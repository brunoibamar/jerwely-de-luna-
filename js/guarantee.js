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
        return stored ? JSON.parse(stored) : [];
    }

    static save(exchanges) {
        localStorage.setItem(this.storageKey, JSON.stringify(exchanges));
    }

    // --- Generar folio único de cambio por garantía ---
    static generateId() {
        const date = new Date();
        const dateStr = date.getFullYear().toString() +
            (date.getMonth() + 1).toString().padStart(2, '0') +
            date.getDate().toString().padStart(2, '0');
        const all = this.getAll();
        const seq = all.filter(r => r.id && r.id.startsWith(`GAR-${dateStr}-`)).length + 1;
        return `GAR-${dateStr}-${seq.toString().padStart(4, '0')}`;
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
    static getByDate(date = new Date().toISOString().split('T')[0]) {
        return this.getAll().filter(r => r.date.startsWith(date));
    }

    static getById(id) {
        return this.getAll().find(r => r.id === id);
    }

    static count() {
        return this.getAll().length;
    }
}

window.GuaranteeExchange = GuaranteeExchange;
