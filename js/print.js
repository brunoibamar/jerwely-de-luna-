class Print {
    static printReceipt(sale) {
        const receiptData = Checkout.getReceiptData(sale);
        const content = this.formatReceipt(receiptData);

        const printWindow = window.open('', '_blank', 'width=300,height=600');
        printWindow.document.write(content);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
    }

    static formatReceipt(data) {
        const itemsRows = data.items.map(item => `
            <tr>
                <td style="text-align: left; padding: 4px 0;">${item.description}</td>
                <td style="text-align: center; padding: 4px 0;">${item.qty}</td>
                <td style="text-align: right; padding: 4px 0;">$${item.price.toFixed(2)}</td>
                <td style="text-align: right; padding: 4px 0;">$${item.amount.toFixed(2)}</td>
            </tr>
        `).join('');

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Ticket - ${data.store}</title>
                <style>
                    body {
                        font-family: 'Courier New', monospace;
                        font-size: 12px;
                        margin: 0;
                        padding: 10px;
                        color: #000;
                    }
                    .header {
                        text-align: center;
                        border-bottom: 1px dashed #000;
                        padding-bottom: 10px;
                        margin-bottom: 10px;
                    }
                    .header h2 {
                        font-size: 16px;
                        font-weight: bold;
                        margin: 0;
                    }
                    .info {
                        font-size: 11px;
                        text-align: center;
                        margin-bottom: 10px;
                    }
                    .item {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    .item td {
                        padding: 2px 0;
                    }
                    .total-row {
                        border-top: 1px dashed #000;
                        margin-top: 10px;
                        padding-top: 10px;
                    }
                    .total-value {
                        font-weight: bold;
                        font-size: 14px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>${data.store}</h2>
                    <div>${data.address}</div>
                    <div>${data.phone}</div>
                </div>
                <div class="info">
                    <div>Folio: ${data.saleId}</div>
                    <div>Fecha: ${data.date}</div>
                    <div>Cajero: ${data.cashier}</div>
                </div>
                <table class="item" style="width: 100%;">
                    <thead>
                        <tr>
                            <th style="text-align: left; font-size: 10px;">Producto</th>
                            <th style="text-align: center; font-size: 10px;">Cant.</th>
                            <th style="text-align: right; font-size: 10px;">Precio</th>
                            <th style="text-align: right; font-size: 10px;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsRows}
                    </tbody>
                </table>
                <div class="total-row">
                    <div style="display: flex; justify-content: space-between;">
                        <span>Subtotal:</span>
                        <span>$${data.subtotal.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span>IVA (${(data.tax / data.subtotal * 100).toFixed(0)}%):</span>
                        <span>$${data.tax.toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                        <span class="total-value">TOTAL:</span>
                        <span class="total-value">$${data.total.toFixed(2)}</span>
                    </div>
                    <div style="text-align: center; margin-top: 10px; font-size: 11px;">
                       Pago: ${data.paymentMethod}
                       ${data.amountReceived > 0 ? `<br>Recibido: $${data.amountReceived.toFixed(2)}` : ''}
                       ${data.change > 0 ? `<br>Cambio: $${data.change.toFixed(2)}` : ''}
                       ${data.paymentMethod === 'Pago Mixto' 
                           ? `<br>Efectivo: $${data.cashAmount.toFixed(2)} / Tarjeta: $${data.cardAmount.toFixed(2)}` 
                           : ''}
                    </div>
                </div>
                <div style="text-align: center; margin-top: 15px; font-size: 10px;">
                    ¡Gracias por su compra!
                </div>
            </body>
            </html>
        `;
    }

    static printCutReport(report) {
        const content = this.formatCutReport(report);
        const printWindow = window.open('', '_blank', 'width=400,height=600');
        printWindow.document.write(content);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
    }

    static formatCutReport(report) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Corte de Caja - Jewerly De Luna</title>
                <style>
                    body {
                        font-family: 'Courier New', monospace;
                        font-size: 12px;
                        margin: 0;
                        padding: 20px;
                        color: #000;
                    }
                    .header {
                        text-align: center;
                        border-bottom: 2px solid #000;
                        padding-bottom: 10px;
                        margin-bottom: 20px;
                    }
                    .header h2 {
                        font-size: 18px;
                        font-weight: bold;
                    }
                    .report-grid {
                        display: grid;
                        gap: 10px;
                    }
                    .report-row {
                        display: flex;
                        justify-content: space-between;
                        padding: 5px 0;
                    }
                    .report-row.total {
                        border-top: 1px solid #000;
                        font-weight: bold;
                        font-size: 14px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>CORTE DE CAJA</h2>
                    <div>Jewerly De Luna</div>
                    <div>Fecha: ${report.date || new Date().toLocaleDateString('es-MX')}</div>
                    <div>Cajero: ${report.closedBy || Auth.getCurrentUser()?.name}</div>
                </div>
                <div class="report-grid">
                    <div class="report-row">
                        <span>Total de Ventas:</span>
                        <span>${report.totalSales}</span>
                    </div>
                    <div class="report-row">
                        <span>Ventas en Efectivo:</span>
                        <span>${report.cashTotal.toFixed(2)}</span>
                    </div>
                    <div class="report-row">
                        <span>Ventas con Tarjeta:</span>
                        <span>${report.cardTotal.toFixed(2)}</span>
                    </div>
                    <div class="report-row total">
                        <span>CAJA TOTAL:</span>
                        <span>$${report.grandTotal.toFixed(2)}</span>
                    </div>
                </div>
            </body>
            </html>
        `;
    }
}
