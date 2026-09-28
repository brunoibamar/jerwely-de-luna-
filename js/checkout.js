// ============================================================
//  Checkout: Procesamiento de ventas
//  Soporta Efectivo, Tarjeta y Pago Mixto (desglose de montos).
//  Incluye detalles de pago con cambio para tickets.
// ============================================================

class Checkout {
    // Procesar el checkout con detalles de pago completos.
    // paymentDetails puede incluir: method, cashAmount, cardAmount, amountReceived, change, breakdown
    static checkout(cart, paymentDetails = { method: 'cash' }) {
        if (cart.isEmpty()) return { success: false, error: 'El carrito está vacío' };

        const sale = {
            id: this.generateSaleId(),
            date: new Date().toISOString(),
            items: cart.getItems(),
            subtotal: cart.getSubtotal(),
            tax: cart.getTax(),
            total: cart.getTotal(),
            paymentMethod: paymentDetails.method,
            // Guardar detalles completos del pago (cambio, montos mixtos, etc.)
            paymentDetails: {
                method: paymentDetails.method,
                cashAmount: paymentDetails.cashAmount || 0,
                cardAmount: paymentDetails.cardAmount || 0,
                amountReceived: paymentDetails.amountReceived || 0,
                change: paymentDetails.change || 0,
                receivedBreakdown: paymentDetails.receivedBreakdown || {}
            },
            cashier: Auth.getCurrentUser()?.name || 'Desconocido'
        };

        SaleService.saveSale(sale);
        cart.clear();

        return { success: true, sale };
    }

    // Generar folio de venta único basado en el número secuencial del día
    static generateSaleId() {
        const date = new Date();
        const dateStr = date.getFullYear().toString() +
            (date.getMonth() + 1).toString().padStart(2, '0') +
            date.getDate().toString().padStart(2, '0');
        // FIX: usar getAll() en lugar de getSales() (método inexistente)
        const existing = SaleService.getAll().length;
        return `F-${dateStr}-${(existing + 1).toString().padStart(4, '0')}`;
    }

    // Preparar los datos para el ticket de impresión
    static getReceiptData(sale) {
        const methodLabels = {
            cash: 'Efectivo',
            card: 'Tarjeta',
            mixed: 'Pago Mixto'
        };

        const pd = sale.paymentDetails || {};

        return {
            store: 'Jewerly De Luna',
            address: 'Av. Reforma 123, CDMX',
            phone: '(55) 1234-5678',
            saleId: sale.id,
            date: new Date(sale.date).toLocaleString('es-MX'),
            cashier: sale.cashier,
            items: sale.items.map(item => ({
                description: item.description,
                qty: item.quantity,
                price: item.price,
                amount: item.amount
            })),
            subtotal: sale.subtotal,
            tax: sale.tax,
            total: sale.total,
            paymentMethod: methodLabels[sale.paymentMethod] || sale.paymentMethod,
            // Detalles de pago para el ticket (cambio, montos desglosados)
            amountReceived: pd.amountReceived || 0,
            change: pd.change || 0,
            cashAmount: pd.cashAmount || 0,
            cardAmount: pd.cardAmount || 0
        };
    }
}
