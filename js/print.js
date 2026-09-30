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

        const logoHtml = data.logo
            ? `<div class="logo"><img src="${data.logo}" alt="${data.store}" style="max-width: 120px; max-height: 80px; display: block; margin: 0 auto;"></div>`
            : '';

        const rfcHtml = data.rfc
            ? `<div>RFC: ${data.rfc}</div>`
            : '';

        const showCashier = data.showCashier !== false;
        const showDate = data.showDate !== false;
        const showPaymentMethod = data.showPaymentMethod !== false;
        const showPaymentDetails = data.showPaymentDetails !== false;

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Ticket - ${data.store}</title>
                <style>
                    @page {
                        margin: 0;
                        size: auto;
                    }

                    @media print {
                        body {
                            margin: 0;
                            padding: 0;
                            height: auto;
                        }
                    }

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
                    .receipt-header {
                        text-align: center;
                        font-size: 11px;
                        color: #555;
                        margin-bottom: 10px;
                        font-style: italic;
                    }
                    .receipt-footer {
                        text-align: center;
                        font-size: 10px;
                        color: #555;
                        margin-top: 15px;
                    }
                </style>
            </head>
            <body>
                <div class="receipt-header">
                    ${data.receiptHeader || ''}
                </div>
                ${logoHtml}
                <div class="header">
                    <h2>${data.store}</h2>
                    <div>${data.address}</div>
                    ${data.rfc ? `<div>RFC: ${data.rfc}</div>` : ''}
                    <div>${data.phone}</div>
                </div>
                <div class="info">
                    <div>Folio: ${data.saleId}</div>
                    ${showDate ? `<div>Fecha: ${data.date}</div>` : ''}
                    ${showCashier ? `<div>Cajero: ${data.cashier}</div>` : ''}
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
                        <span>Total:</span>
                        <span>$${data.total.toFixed(2)}</span>
                    </div>
                    ${(showPaymentMethod || showPaymentDetails)
                        ? `<div style="text-align: center; margin-top: 10px; font-size: 11px;">`
                        : '<div style="display: none;">'}
                        ${showPaymentMethod ? `Pago: ${data.paymentMethod}` : ''}
                        ${showPaymentDetails && data.amountReceived > 0 ? `<br>Recibido: $${data.amountReceived.toFixed(2)}` : ''}
                        ${showPaymentDetails && data.change > 0 ? `<br>Cambio: $${data.change.toFixed(2)}` : ''}
                        ${showPaymentDetails && data.paymentMethod === 'Pago Mixto'
                            ? `<br>Efectivo: $${data.cashAmount.toFixed(2)} / Tarjeta: $${data.cardAmount.toFixed(2)}`
                            : ''}
                    </div>
                </div>
                <div class="receipt-footer">
                    ${data.receiptFooter || ''}
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

    static printDailyReport(report) {
        const content = this.formatDailyReport(report);
        const printWindow = window.open('', '_blank', 'width=800,height=600');
        printWindow.document.write(content);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
    }

    static formatDailyReport(report) {
        const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : '0.00');
        const isPrint = true;

        let sessionsHtml = '';
        if (report.sessions && report.sessions.length > 0) {
            report.sessions.forEach(s => {
                sessionsHtml += `
                    <table style="width:100%; border-collapse:collapse; margin-bottom:16px;">
                        <tr style="background:#f5f5f5;">
                            <th colspan="2" style="padding:8px; text-align:left;">Corte: ${s.sessionId} (${s.isOpen ? 'Abierto' : 'Cerrado'})</th>
                        </tr>
                        <tr><td style="padding:4px 8px;">Cajero</td><td>${s.cashier}</td></tr>
                        <tr><td style="padding:4px 8px;">Apertura</td><td>${s.formattedOpenTime}</td></tr>
                        <tr><td style="padding:4px 8px;">Cierre</td><td>${s.formattedCloseTime}</td></tr>
                        <tr><td style="padding:4px 8px;">Monto Inicial</td><td>$${fmt(s.initialAmount)}</td></tr>
                        <tr><td style="padding:4px 8px;">Total Ventas</td><td>$${fmt(s.totalSales)}</td></tr>
                        <tr><td style="padding:4px 8px;">Efectivo</td><td>$${fmt(s.cashSales)}</td></tr>
                        <tr><td style="padding:4px 8px;">Tarjeta</td><td>$${fmt(s.cardSales)}</td></tr>
                        <tr><td style="padding:4px 8px;">Transacciones</td><td>${s.transactionCount}</td></tr>
                        <tr><td style="padding:4px 8px;">Ventas en Sesión</td><td>${s.salesInSession}</td></tr>
                        <tr><td style="padding:4px 8px;">Caja Final</td><td>$${fmt(s.closingAmount)}</td></tr>
                        ${s.profit !== undefined ? `<tr><td style="padding:4px 8px;">Ganancia</td><td>$${fmt(s.profit)}</td></tr>` : ''}
                    </table>
                `;
            });
        } else {
            sessionsHtml = '<p>No hay cortes registrados para este día</p>';
        }

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                 <title>Reporte Diario - ${report.store || Business.getStoreName()}</title>
                <style>
                    @page {
                        margin: 0;
                        size: auto;
                    }

                    @media print {
                        body {
                            margin: 0;
                            padding: 0;
                            height: auto;
                        }
                    }

                    body { font-family: 'Courier New', monospace; font-size: 12px; margin: 0; padding: 20px; color: #000; }
                    h1 { color: #d4af37; border-bottom: 2px solid #d4af37; padding-bottom: 8px; }
                    h2 { color: #333; margin-top: 20px; margin-bottom: 10px; }
                    h3 { color: #d4af37; }
                    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
                    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
                    th { background: #f5f5f5; }
                    .total-row { font-weight: bold; }
                    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 16px 0; }
                    .summary-item { border: 1px solid #ddd; padding: 12px; text-align: center; }
                    .summary-label { font-size: 10px; color: #666; text-transform: uppercase; }
                    .summary-value { font-size: 18px; font-weight: bold; color: #d4af37; margin-top: 4px; }
                </style>
            </head>
            <body>
                <h1>Reporte Diario - ${report.store || Business.getStoreName()}</h1>
                <p><strong>Fecha:</strong> ${report.date}</p>
                <div class="summary-grid">
                    <div class="summary-item">
                        <div class="summary-label">Total Ventas</div>
                        <div class="summary-value">$${fmt(report.totalSales)}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">Transacciones</div>
                        <div class="summary-value">${report.transactionCount}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">Piezas Vendidas</div>
                        <div class="summary-value">${report.piecesSold || 0}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">Meta del Día (100 Pzas)</div>
                        ${(() => {
                            const goal = 100;
                            const pct = Math.round(((report.piecesSold || 0) / goal) * 100);
                            return `<div class="summary-value">${report.piecesSold || 0} / ${goal} (${pct}%)</div>`;
                        })()}
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">Cortes</div>
                        <div class="summary-value">${report.sessionCount}</div>
                    </div>
                </div>
                <h2>Consolidado por Método de Pago</h2>
                <table>
                    <tr><th>Efectivo</th><th>Tarjeta</th><th>Ganancia Neta</th><th>Margen</th></tr>
                    <tr><td>$${fmt(report.cashTotal)}</td><td>$${fmt(report.cardTotal)}</td><td>$${fmt(report.profit)}</td><td>${report.margin}%</td></tr>
                </table>
                <h2>Detalle de Cortes de Caja (${report.sessionCount})</h2>
                ${sessionsHtml}
            </body>
            </html>
        `;
    }

    static formatCutReport(report) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                 <title>Corte de Caja - ${report.store || Business.getStoreName()}</title>
                <style>
                    @page {
                        margin: 0;
                        size: auto;
                    }

                    @media print {
                        body {
                            margin: 0;
                            padding: 0;
                            height: auto;
                        }
                    }

                    body {
                        font-family: 'Courier New', monospace;
                        font-size: 12px;
                        margin: 0;
                        padding: 20px;
                        color: #000;
                    }
                    h1 { color: #d4af37; }
                    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background: #f5f5f5; }
                    .total-row { font-weight: bold; }
                    .timestamp-row td { font-size: 11px; color: #555; }
                </style>
            </head>
            <body>
                <h1>Corte de Caja - ${report.store || Business.getStoreName()}</h1>
                <p><strong>Fecha:</strong> ${report.date}</p>
                <p><strong>Cajero:</strong> ${report.cashier || report.closedBy || 'Desconocido'}</p>
                ${report.formattedOpenTime ? `<p><strong>Hora de Apertura:</strong> ${report.formattedOpenTime}</p>` : ''}
                ${report.formattedCloseTime ? `<p><strong>Hora de Cierre:</strong> ${report.formattedCloseTime}</p>` : ''}
                ${report.sessionStartTime ? `<p><strong>Apertura (ISO):</strong> ${report.sessionStartTime}</p>` : ''}
                ${report.sessionEndTime ? `<p><strong>Cierre (ISO):</strong> ${report.sessionEndTime}</p>` : ''}
                <h3>Resumen</h3>
                <table>
                    <tr><th>Concepto</th><th>Valor</th></tr>
                    <tr><td>Monto Inicial</td><td>$${report.initialAmount.toFixed(2)}</td></tr>
                    <tr><td>Total Ventas</td><td>$${report.totalSales.toFixed(2)}</td></tr>
                    <tr><td>Efectivo</td><td>$${report.cashSales.toFixed(2)}</td></tr>
                    <tr><td>Tarjeta</td><td>$${report.cardSales.toFixed(2)}</td></tr>
                    <tr><td>Transacciones</td><td>${report.transactionCount}</td></tr>
                    ${report.salesInSession !== undefined ? `<tr><td>Ventas en Sesión</td><td>${report.salesInSession}</td></tr>` : ''}
                    <tr class="total-row"><td>Caja Final</td><td>$${report.closingAmount.toFixed(2)}</td></tr>
                    ${report.profit !== undefined ? `<tr class="total-row"><td>Ganancia Neta</td><td>$${report.profit.toFixed(2)}</td></tr>` : ''}
                    ${report.margin !== undefined ? `<tr class="total-row"><td>Margen</td><td>${report.margin}%</td></tr>` : ''}
                </table>
            </body>
            </html>
        `;
    }

    // --- Ticket simplificado para el perfil Invitado ---
    // Imprime EXCLUSIVAMENTE el número total de piezas vendidas en la sesión.
    static printGuestClosure(report) {
        const content = this.formatGuestClosure(report);
        const printWindow = window.open('', '_blank', 'width=400,height=600');
        printWindow.document.write(content);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
    }

    static formatGuestClosure(report) {
        const piecesSold = report.piecesSold !== undefined
            ? report.piecesSold
            : (report.salesInSession || report.transactionCount || 0);

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                 <title>Cierre de Caja - Invitado - ${report.store || Business.getStoreName()}</title>
                <style>
                    @page { margin: 0; size: auto; }
                    @media print { body { margin: 0; padding: 0; height: auto; } }
                    body {
                        font-family: 'Courier New', monospace;
                        font-size: 12px;
                        margin: 0;
                        padding: 20px;
                        color: #000;
                    }
                    h1 { color: #d4af37; }
                    .guest-ticket-row {
                        display: flex;
                        justify-content: space-between;
                        padding: 6px 0;
                        border-bottom: 1px dashed #ddd;
                    }
                    .guest-ticket-total {
                        text-align: center;
                        margin-top: 16px;
                        padding-top: 16px;
                        border-top: 2px solid #d4af37;
                    }
                    .guest-pieces {
                        font-size: 42px;
                        font-weight: bold;
                        color: #d4af37;
                    }
                </style>
            </head>
            <body>
                <h1>Cierre de Caja - ${report.store || Business.getStoreName()}</h1>
                <p><strong>Cajero:</strong> ${report.cashier || report.closedBy || 'Desconocido'}</p>
                <p><strong>Sesión:</strong> ${report.sessionId || 'N/A'}</p>
                <p><strong>Apertura:</strong> ${report.formattedOpenTime || report.sessionStartTime || 'N/A'}</p>
                <p><strong>Cierre:</strong> ${report.formattedCloseTime || report.sessionEndTime || 'N/A'}</p>
                <div class="guest-ticket-total">
                    <div>Piezas Vendidas</div>
                    <div class="guest-pieces">${piecesSold}</div>
                </div>
            </body>
            </html>
        `;
    }
}
