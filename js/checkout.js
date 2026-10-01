// ============================================================
//  Checkout: Procesamiento de ventas
//  Soporta Efectivo, Tarjeta y Pago Mixto (desglose de montos).
//  Incluye detalles de pago con cambio para tickets.
//  Todos los precios son montos finales netos (sin IVA).
// ============================================================

class Checkout {
    // Procesar el checkout con detalles de pago completos.
    // paymentDetails puede incluir: method, cashAmount, cardAmount, amountReceived, change, receivedBreakdown
    static checkout(cart, paymentDetails = { method: 'cash' }) {
        if (cart.isEmpty()) return { success: false, error: 'El carrito está vacío' };

        const subtotal = cart.getSubtotal();

        const sale = {
            id: this.generateSaleId(),
            date: new Date().toISOString(),
            items: cart.getItems(),
            subtotal: subtotal,
            total: subtotal,
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
            cashier: Auth.getCurrentUser()?.name || 'Desconocido',
            status: 'active'
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
        const existing = SaleService.getAll().length;
        return `F-${dateStr}-${(existing + 1).toString().padStart(4, '0')}`;
    }

    // Preparar los datos para el ticket de impresión
    // Usa Settings para personalizar la plantilla del ticket
    static getReceiptData(sale) {
        const settings = Settings.getSettings();
        const methodLabels = {
            cash: 'Efectivo',
            card: 'Tarjeta',
            mixed: 'Pago Mixto'
        };

        const pd = sale.paymentDetails || {};

        const items = sale.items.map(item => ({
            description: item.description,
            qty: item.quantity,
            price: item.price,
            amount: item.amount,
            originalPrice: item.originalPrice || item.price
        }));

        const totalSavings = items.reduce((sum, item) => {
            const saved = Math.max(0, (item.originalPrice - item.price) * item.qty);
            return sum + saved;
        }, 0);

        return {
            store: settings.storeName || 'Jewerly De Luna',
            address: settings.storeAddress || 'Av. Reforma 123, CDMX',
            phone: settings.storePhone || '(55) 1234-5678',
            rfc: settings.storeRfc || '',
            logo: settings.storeLogo || '',
            receiptHeader: settings.receiptHeader || 'Gracias por su compra',
            receiptFooter: settings.receiptFooter || '¡Gracias por su compra!',
            showCashier: settings.receiptShowCashier !== false,
            showDate: settings.receiptShowDate !== false,
            showPaymentMethod: settings.receiptShowPaymentMethod !== false,
            showPaymentDetails: settings.receiptShowPaymentDetails !== false,
            saleId: sale.id,
            date: new Date(sale.date).toLocaleString('es-MX'),
            cashier: sale.cashier,
            items: items,
            subtotal: sale.subtotal,
            total: sale.total,
            totalSavings: parseFloat(totalSavings.toFixed(2)),
            paymentMethod: methodLabels[sale.paymentMethod] || sale.paymentMethod,
            // Detalles de pago para el ticket (cambio, montos desglosados)
            amountReceived: pd.amountReceived || 0,
            change: pd.change || 0,
            cashAmount: pd.cashAmount || 0,
            cardAmount: pd.cardAmount || 0
        };
    }
}
