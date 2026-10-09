const TELEGRAM_BOT_TOKEN = "8701513052:AAHXRjqTRbrCZfADkEHmBVXfKm43_qsbhv0".trim();
const TELEGRAM_CHAT_ID = "1227954906".trim();

async function enviarNotificacionTelegram(mensaje) {
  try {
    const endpoint = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: mensaje,
        parse_mode: "HTML"
      })
    });

    const resData = await response.json();
    console.log("Respuesta Telegram:", resData);

    if (!resData.ok) {
      alert("Error de Telegram: " + resData.description);
    } else {
      console.log("Notificación enviada con éxito");
    }
  } catch (err) {
    console.error("Error de red enviando a Telegram:", err);
  }
}

// Alias esperado por app.js (fire-and-forget, sin interrumpir la venta)
async function notificarTelegram(mensaje) {
  return enviarNotificacionTelegram(mensaje);
}

window.enviarNotificacionTelegram = enviarNotificacionTelegram;
window.notificarTelegram = notificarTelegram;

window.testTelegram = function() {
  enviarNotificacionTelegram("<b>Test desde POS Jewelry De Luna</b>\n¡Prueba de conexión exitosa!");
};

// ============================================================
//  TelegramNotify: Integración de notificaciones de ventas y
//  cortes de caja por Telegram.
// ============================================================
class TelegramNotify {
    static METODO_PAGO_LABELS = {
        cash: 'Efectivo',
        card: 'Tarjeta',
        mixed: 'Pago Mixto',
        transfer: 'Transferencia'
    };

    static escaparHtml(texto) {
        if (texto === null || texto === undefined) return '';
        return String(texto)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    static formatearMonto(monto) {
        const valor = parseFloat(monto) || 0;
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(valor);
    }

    static notificarVenta(sale) {
        if (!sale) {
            console.warn('[TelegramNotify] notificarVenta recibio un objeto de venta vacio.');
            return;
        }
        const mensaje = this.formatearVenta(sale);
        enviarNotificacionTelegram(mensaje);
    }

    static formatearVenta(sale) {
        const fecha = (typeof DateUtil !== 'undefined' && DateUtil.toLocalDate)
            ? DateUtil.toLocalDate(sale.date || new Date())
            : new Date(sale.date || new Date()).toLocaleString('es-MX');

        const metodo = (sale.paymentDetails && sale.paymentDetails.method) || sale.paymentMethod || 'cash';
        const metodoLabel = this.METODO_PAGO_LABELS[metodo] || metodo;

        const lineas = [];
        lineas.push('Nueva Venta - Jewelry De Luna');
        lineas.push('');
        lineas.push('Ticket #: ' + this.escaparHtml(sale.id || 'N/A'));
        lineas.push('Fecha: ' + this.escaparHtml(fecha));
        lineas.push('Cajero: ' + this.escaparHtml(sale.cashier || 'Desconocido'));
        lineas.push('Total: ' + this.formatearMonto(sale.total));
        lineas.push('Metodo de Pago: ' + metodoLabel);
        lineas.push('');

        lineas.push('Productos:');
        if (sale.items && sale.items.length > 0) {
            sale.items.forEach(item => {
                const qty = item.quantity || 1;
                const amount = this.formatearMonto(item.amount);
                lineas.push('  - ' + qty + 'x ' + this.escaparHtml(item.description || 'Producto') + ' - ' + amount);
            });
        } else {
            lineas.push('  - (sin productos)');
        }
        lineas.push('');

        if (sale.vipCustomerName) {
            lineas.push('Cliente VIP: ' + this.escaparHtml(sale.vipCustomerName));
        }

        const pd = sale.paymentDetails || {};
        if (pd.change && pd.change > 0) {
            lineas.push('Cambio: ' + this.formatearMonto(pd.change));
        }
        if (pd.amountReceived && pd.amountReceived > 0) {
            lineas.push('Recibido: ' + this.formatearMonto(pd.amountReceived));
        }

        // Detalles bancarios para transferencia
        if (metodo === 'transfer') {
            if (pd.transferBank) {
                lineas.push('Banco: ' + this.escaparHtml(pd.transferBank));
            }
            if (pd.transferClabe) {
                lineas.push('Cuenta/CLABE: ' + this.escaparHtml(pd.transferClabe));
            }
            if (pd.transferHolder) {
                lineas.push('Titular: ' + this.escaparHtml(pd.transferHolder));
            }
            if (pd.transferReference) {
                lineas.push('Referencia: ' + this.escaparHtml(pd.transferReference));
            }
            lineas.push('');
            lineas.push('TRANSFERENCIA - Folio de referencia: ' + this.escaparHtml(pd.transferReference || 'N/A'));
        }

        return lineas.join('\n');
    }

    static notificarCorte(report) {
        if (!report) return;
        const mensaje = this.formatearCorte(report);
        enviarNotificacionTelegram(mensaje);
    }

    static formatearCorte(report) {
        const rol = (typeof Auth !== 'undefined') ? Auth.getRole() : 'admin';
        const esAdmin = rol === 'admin';

        const lineas = [];
        lineas.push('Corte de Caja - Jewelry De Luna');
        lineas.push('');
        lineas.push('Fecha: ' + this.escaparHtml(report.date || ''));

        if (report.formattedOpenTime) {
            lineas.push('Apertura: ' + this.escaparHtml(report.formattedOpenTime));
        }
        if (report.formattedCloseTime) {
            lineas.push('Cierre: ' + this.escaparHtml(report.formattedCloseTime));
        }

        lineas.push('');
        lineas.push('Transacciones: ' + this.escaparHtml(String(report.transactionCount || report.salesInSession || 0)));
        lineas.push('Piezas Vendidas: ' + this.escaparHtml(String(report.piecesSold || 0)));
        lineas.push('Total Ventas: ' + this.formatearMonto(report.totalSales));
        lineas.push('Efectivo: ' + this.formatearMonto(report.cashSales));
        lineas.push('Tarjeta: ' + this.formatearMonto(report.cardSales));
        if (report.transferTotal) {
            lineas.push('Transferencia: ' + this.formatearMonto(report.transferTotal));
        }

        if (report.initialAmount) {
            lineas.push('Fondo Inicial: ' + this.formatearMonto(report.initialAmount));
            lineas.push('En Caja (Efectivo + Fondo): ' + this.formatearMonto(report.cashInDrawer));
        }

        if (esAdmin && report.profit !== undefined) {
            lineas.push('');
            lineas.push('Ganancia Neta: ' + this.formatearMonto(report.profit));
            lineas.push('Margen: ' + this.escaparHtml(String(report.margin || '0.0')) + '%');
        }

        if (report.cashier) {
            lineas.push('');
            lineas.push('Cajero: ' + this.escaparHtml(report.cashier));
        }

        return lineas.join('\n');
    }

    static test() {
        const mensaje = 'Prueba de Telegram Notify\n\nConexion exitosa.';
        return enviarNotificacionTelegram(mensaje);
    }

    static formatearRetiroEfectivo(data) {
        const now = new Date();
        const fechaHora = now.toLocaleString('es-MX');
        const cashier = data.cashier || (Auth.getCurrentUser()?.name || 'Invitado');
        const monto = this.formatearMonto(data.amount || 0);
        const motivo = this.escaparHtml(data.note || 'Sin concepto');

        const lineas = [];
        lineas.push('<b>⚠️ RETIRO DE EFECTIVO EN CAJA</b>');
        lineas.push('<b>Monto:</b> ' + monto);
        lineas.push('<b>Cajero:</b> ' + this.escaparHtml(cashier));
        lineas.push('<b>Motivo/Concepto:</b> ' + motivo);
        lineas.push('<b>Fecha/Hora:</b> ' + this.escaparHtml(fechaHora));
        return lineas.join('\n');
    }

    static notificarRetiroEfectivo(data) {
        if (!data) {
            console.warn('[TelegramNotify] notificarRetiroEfectivo recibió datos vacíos.');
            return;
        }
        const mensaje = this.formatearRetiroEfectivo(data);
        enviarNotificacionTelegram(mensaje);
    }

    static formatearDevolucion(data) {
        const cashier = data.cashier || (Auth.getCurrentUser()?.name || 'Invitado');
        const monto = this.formatearMonto(data.refundAmount || data.amount || 0);
        const motivo = this.escaparHtml(data.motivo || data.note || 'Sin motivo');
        const ticketAfectado = this.escaparHtml(data.saleId || data.ticketId || 'N/A');
        const producto = this.escaparHtml(data.productName || data.producto || 'Producto');

        const lineas = [];
        lineas.push('<b>🔄 DEVOLUCIÓN REGISTRADA</b>');
        lineas.push('<b>Ticket Afectado:</b> ' + ticketAfectado);
        lineas.push('<b>Producto:</b> ' + producto);
        lineas.push('<b>Monto Devuelto:</b> ' + monto);
        lineas.push('<b>Cajero:</b> ' + this.escaparHtml(cashier));
        lineas.push('<b>Motivo:</b> ' + motivo);
        return lineas.join('\n');
    }

    static notificarDevolucion(data) {
        if (!data) {
            console.warn('[TelegramNotify] notificarDevolucion recibió datos vacíos.');
            return;
        }
        const mensaje = this.formatearDevolucion(data);
        enviarNotificacionTelegram(mensaje);
    }

    static formatearCambioGarantia(data) {
        const now = new Date();
        const fechaHora = typeof DateUtil !== 'undefined' && DateUtil.toLocalDate
            ? DateUtil.toLocalDate(now) + ' ' + now.toLocaleTimeString('es-MX')
            : now.toLocaleString('es-MX');
        const cashier = data.cashier || (Auth.getCurrentUser()?.name || 'Invitado');

        const defectiveItems = Array.isArray(data.itemsReceived) ? data.itemsReceived : [];
        const replacementItems = Array.isArray(data.itemsDelivered) ? data.itemsDelivered : [];

        const piezasDanadas = defectiveItems.map(i => {
            const desc = this.escaparHtml(i.description || 'Producto');
            const qty = i.quantity > 1 ? ` (${i.quantity}x)` : '';
            return desc + qty;
        }).join('\n') || 'N/A';

        const piezasEntregadas = replacementItems.map(i => {
            const desc = this.escaparHtml(i.description || 'Producto');
            const qty = i.quantity > 1 ? ` (${i.quantity}x)` : '';
            return desc + qty;
        }).join('\n') || 'N/A';

        const motivo = this.escaparHtml(data.note || data.motivo || 'Sin motivo');
        const folio = this.escaparHtml(data.id || data.folio || 'N/A');

        const lineas = [];
        lineas.push('<b>🛡️ CAMBIO POR GARANTÍA REGISTRADO</b>');
        lineas.push('<b>Folio:</b> ' + folio);
        lineas.push('<b>Pieza Dañada/Devuelta:</b> ' + piezasDanadas);
        lineas.push('<b>Pieza Entregada:</b> ' + piezasEntregadas);
        lineas.push('<b>Cajero:</b> ' + this.escaparHtml(cashier));
        lineas.push('<b>Motivo/Detalle del daño:</b> ' + (motivo || 'Sin detalle'));
        lineas.push('<b>Fecha/Hora:</b> ' + this.escaparHtml(fechaHora));
        return lineas.join('\n');
    }

    static notificarCambioGarantia(data) {
        if (!data) {
            console.warn('[TelegramNotify] notificarCambioGarantia recibió datos vacíos.');
            return;
        }
        const mensaje = this.formatearCambioGarantia(data);
        enviarNotificacionTelegram(mensaje);
    }
}

window.TelegramNotify = TelegramNotify;
