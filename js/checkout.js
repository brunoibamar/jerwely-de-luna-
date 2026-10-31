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
        if (!Cut.getActiveSession()?.isOpen) return { success: false, error: 'No hay un turno abierto válido. No se registró la venta.' };
        for (const item of cart.getItems()) {
            const product = Inventory.findByBarcode(item.barcode);
            if (!product || !Number.isFinite(item.quantity) || item.quantity <= 0 || product.stock < item.quantity) {
                return { success: false, error: 'El inventario cambió o no tiene existencias suficientes. Revise el carrito.' };
            }
        }

        const subtotal = cart.getSubtotal();
        const buenFinDiscount = cart.getBuenFinDiscount ? cart.getBuenFinDiscount() : 0;
        const buenFinFreePieces = cart.getBuenFinFreePieces ? cart.getBuenFinFreePieces() : 0;

        const sale = {
            id: this.generateSaleId(),
            date: new Date().toISOString(),
            items: cart.getItems(),
            subtotal: subtotal,
            total: subtotal,
            buenFinActive: cart.isBuenFinActive ? cart.isBuenFinActive() : false,
            buenFinDiscount: buenFinDiscount,
            buenFinFreePieces: buenFinFreePieces,
            paymentMethod: paymentDetails.method,
            // Guardar detalles completos del pago (cambio, montos mixtos, etc.)
            paymentDetails: {
                method: paymentDetails.method,
                cashAmount: paymentDetails.cashAmount || 0,
                cardAmount: paymentDetails.cardAmount || 0,
                amountReceived: paymentDetails.amountReceived || 0,
                change: paymentDetails.change || 0,
                receivedBreakdown: paymentDetails.receivedBreakdown || {},
                transferBank: paymentDetails.transferBank || '',
                transferClabe: paymentDetails.transferClabe || '',
                transferHolder: paymentDetails.transferHolder || '',
                transferReference: paymentDetails.transferReference || ''
            },
            cashier: Auth.getCurrentUser()?.name || 'Desconocido',
            status: 'active',
            vipCustomerId: paymentDetails.vipCustomerId || null,
            vipCustomerName: paymentDetails.vipCustomerName || null
        };

        // El llamador prepara venta, historial, inventario y puntos en una
        // sola transacción de AppStorage. Un fallo descarta todos los cambios.
        SaleService.saveSale(sale);
        Inventory.updateStock(sale.items.map(i => ({ barcode: i.barcode, quantity: i.quantity })));
        if (sale.vipCustomerId) {
            const vip = VIPCustomer.addPurchase(sale.vipCustomerId, sale, `Venta ${sale.id}`);
            if (!vip.success) throw new Error(vip.error || 'No se pudieron guardar los puntos VIP');
        }

        return { success: true, sale };
    }

    // Generar folio de venta único: F-YYYYMMDD-DISP-NNNN
    // (consecutivo del día por dispositivo, nunca se repite)
    static generateSaleId() {
        return Folio.next('F', SaleService.getAll(true));
    }

    // Preparar los datos para el ticket de impresión
    // Usa Settings para personalizar la plantilla del ticket
    static getReceiptData(sale) {
        const settings = Settings.getSettings();
        const methodLabels = {
            cash: 'Efectivo',
            card: 'Tarjeta',
            mixed: 'Pago Mixto',
            transfer: 'Transferencia'
        };

        const pd = sale.paymentDetails || {};

        const items = sale.items.map(item => ({
            description: item.description,
            qty: item.quantity,
            price: item.price,
            amount: item.amount,
            originalPrice: item.originalPrice || item.price,
            buenFinFreeQty: item.buenFinFreeQty || 0
        }));

        const totalSavings = items.reduce((sum, item) => {
            const saved = Math.max(0, (item.originalPrice - item.price) * item.qty);
            return sum + saved;
        }, 0);

        const buenFinDiscount = typeof sale.buenFinDiscount === 'number' ? sale.buenFinDiscount : 0;
        const buenFinFreePieces = typeof sale.buenFinFreePieces === 'number' ? sale.buenFinFreePieces : 0;

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
            buenFinActive: sale.buenFinActive === true,
            buenFinDiscount: parseFloat(buenFinDiscount.toFixed(2)),
            buenFinFreePieces: buenFinFreePieces,
            totalSavings: parseFloat(totalSavings.toFixed(2)),
             paymentMethod: methodLabels[sale.paymentMethod] || sale.paymentMethod,
             // Detalles de pago para el ticket (cambio, montos desglosados)
             amountReceived: pd.amountReceived || 0,
             change: pd.change || 0,
             cashAmount: pd.cashAmount || 0,
             cardAmount: pd.cardAmount || 0,
             transferBank: pd.transferBank || '',
             transferClabe: pd.transferClabe || '',
             transferHolder: pd.transferHolder || '',
             transferReference: pd.transferReference || ''
         };
    }
}
