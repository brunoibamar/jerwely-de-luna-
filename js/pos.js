// ============================================================
//  MÓDULO POS - Jewerly De Luna
//  Producto: Ingreso dual, Precios mayoreo, Ventas en espera,
//  Procesamiento de pago y calculadora de cambio
// ============================================================

// ============================================================
//  VolumePricing: Gestión de precios mayoreo por volumen
//  Aplica descuentos automáticos según la cantidad total de
//  piezas del mismo tipo agregadas a la venta.
//  Rangos por defecto: 1→$70, 2→$65, 3-4→$60, 5+→$50
//  Modificable desde el panel de Administrador.
// ============================================================

class VolumePricing {
    static get storageKey() { return Business.key('pos_volume_pricing'); }

    // --- Rangos de volumen por defecto (precios mayoreo) ---
    static defaultTiers = [
        { min: 1, max: 1, price: 70 },
        { min: 2, max: 2, price: 65 },
        { min: 3, max: 4, price: 60 },
        { min: 5, max: null, price: 50 }
    ];

    static getTiers() {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) {
            this.saveTiers(this.defaultTiers);
            return [...this.defaultTiers];
        }
        try {
            const parsed = JSON.parse(stored);
            if (!Array.isArray(parsed) || parsed.length === 0) {
                this.saveTiers(this.defaultTiers);
                return [...this.defaultTiers];
            }
            return parsed;
        } catch {
            this.saveTiers(this.defaultTiers);
            return [...this.defaultTiers];
        }
    }

    static saveTiers(tiers) {
        localStorage.setItem(this.storageKey, JSON.stringify(tiers));
    }

    // Obtener el precio unitario según la cantidad
    static getUnitPrice(quantity) {
        const tiers = this.getTiers();
        for (let i = tiers.length - 1; i >= 0; i--) {
            const tier = tiers[i];
            if (quantity >= tier.min && (tier.max === null || quantity <= tier.max)) {
                return tier.price;
            }
        }
        return tiers.length > 0 ? tiers[tiers.length - 1].price : 0;
    }

    // Actualizar todos los rangos de volumen (usado por admin)
    static updateTiers(tiers) {
        for (const tier of tiers) {
            if (tier.min < 1) {
                return { success: false, error: 'La cantidad mínima no puede ser menor a 1' };
            }
            if (tier.max !== null && tier.max < tier.min) {
                return { success: false, error: 'La cantidad máxima no puede ser menor a la mínima' };
            }
            if (tier.price < 0) {
                return { success: false, error: 'El precio no puede ser negativo' };
            }
        }
        tiers.sort((a, b) => a.min - b.min);
        this.saveTiers(tiers);
        return { success: true, message: 'Precios de volumen actualizados correctamente' };
    }

    static resetToDefault() {
        this.saveTiers(this.defaultTiers);
        return { success: true, message: 'Precios de volumen restablecidos por defecto' };
    }

    // Verificar si un producto usa precios de volumen
    static isProductEligible(product) {
        return product.volumePricing === true;
    }
}

// ============================================================
//  HeldSales: Gestión de ventas en espera/pausadas
//  Permite pausar la venta actual para atender otro cliente
//  y recuperarla posteriormente.
// ============================================================

class HeldSales {
    static get storageKey() { return Business.key('pos_held_sales'); }

    static getAll() {
        const stored = localStorage.getItem(this.storageKey);
        return stored ? JSON.parse(stored) : [];
    }

    static save(heldSales) {
        localStorage.setItem(this.storageKey, JSON.stringify(heldSales));
    }

    // Guardar la venta actual como "en espera"
    static hold(items, note = '') {
        const heldSales = this.getAll();
        const held = {
            id: `held_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            items: items.map(item => ({ ...item })),
            date: new Date().toISOString(),
            subtotal: items.reduce((sum, i) => sum + i.amount, 0),
            itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
            note: note.trim()
        };
        heldSales.push(held);
        this.save(heldSales);
        return held;
    }

    // Recuperar una venta pausada por ID
    static retrieve(id) {
        const heldSales = this.getAll();
        const index = heldSales.findIndex(h => h.id === id);
        if (index === -1) return null;
        const held = heldSales[index];
        heldSales.splice(index, 1);
        this.save(heldSales);
        return held;
    }

    // Eliminar una venta pausada sin recuperar
    static remove(id) {
        const heldSales = this.getAll();
        const filtered = heldSales.filter(h => h.id !== id);
        this.save(filtered);
    }

    static clearAll() {
        localStorage.removeItem(this.storageKey);
    }

    static getCount() {
        return this.getAll().length;
    }
}

// ============================================================
//  BarcodeScanner: Escaneo activo y en segundo plano
//  Mantiene el enfoque activo en el campo de código de
//  barras y captura entrada de pistola escáner en segundo plano.
// ============================================================

class BarcodeScanner {
    static isListening = false;
    static scanBuffer = '';
    static lastKeystrokeTime = 0;
    static SCAN_TIMEOUT = 100;       // ms entre pulsaciones para detectar escáner
    static SCAN_MIN_LENGTH = 4;       // longitud mínima de código de barras válido
    static callback = null;

    static isModalOpen() {
        const visible = document.querySelectorAll('.modal-overlay:not(.hidden), .payment-overlay:not(.hidden), .license-overlay:not(.hidden)');
        return visible.length > 0;
    }

    static startListening(callback) {
        this.callback = callback;
        this.isListening = true;
        this.scanBuffer = '';
        this.lastKeystrokeTime = 0;
        this.bindGlobalListener();
    }

    static stopListening() {
        this.isListening = false;
        this.scanBuffer = '';
        this.callback = null;
    }

    // Listener global para capturar entrada de escáner en segundo plano
    // Funciona incluso cuando el foco está en otros elementos
    static bindGlobalListener() {
        let bound = false;
        if (bound) return;
        bound = true;

        document.addEventListener('keypress', (e) => {
            if (!this.isListening) return;
            if (this.isModalOpen()) return;

            const tag = document.activeElement?.tagName?.toLowerCase();
            const id = document.activeElement?.id || '';

            // Si el foco está en el campo de barcode-input, el handler existente lo maneja
            if (tag === 'input' && id === 'barcode-input') return;

            // No interceptar cuando se escribe en campos de búsqueda
            if (tag === 'input' && ['product-search', 'inventory-search'].includes(id)) return;

            // Acumular pulsaciones rápidas (características de un escáner HID)
            const now = Date.now();
            if (now - this.lastKeystrokeTime > this.SCAN_TIMEOUT) {
                this.scanBuffer = '';
            }
            this.lastKeystrokeTime = now;
            this.scanBuffer += e.key;
        });

        document.addEventListener('keydown', (e) => {
            if (!this.isListening) return;
            if (this.isModalOpen()) return;

            if (e.key === 'Enter') {
                const now = Date.now();
                if (this.scanBuffer.length >= this.SCAN_MIN_LENGTH &&
                    now - this.lastKeystrokeTime <= this.SCAN_TIMEOUT) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    const barcode = this.scanBuffer.trim();
                    this.scanBuffer = '';
                    if (this.callback && barcode) {
                        this.callback(barcode);
                    }
                }
            }
        });
    }

    // Mantener foco activo en el campo de código de barras
    static keepFocusOnSales() {
        const barcodeInput = document.getElementById('barcode-input');
        if (!barcodeInput) return;

        // Auto-enfocar cuando se navega a la sección de ventas
        document.querySelectorAll('.nav-item[data-section="sales"]').forEach(item => {
            item.addEventListener('click', () => {
                setTimeout(() => barcodeInput.focus(), 100);
            });
        });

        // Re-enfocar tras perder el foco (mantener escucha activa)
        barcodeInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (this.isModalOpen()) return;
                const salesSection = document.getElementById('sales-section');
                if (salesSection && salesSection.classList.contains('active')) {
                    // No re-enfocar si el usuario está editando otro campo en la tabla
                    const activeEl = document.activeElement;
                    const isEditingCart = activeEl && (
                        activeEl.classList.contains('price-input') ||
                        activeEl.classList.contains('qty-input')
                    );
                    if (!isEditingCart) {
                        barcodeInput.focus();
                    }
                }
            }, 100);
        });
    }

    static focusInput() {
        const el = document.getElementById('barcode-input');
        if (el) {
            el.focus();
            el.select();
        }
    }
}

// ============================================================
//  PaymentProcessor: Procesamiento de pagos y calculadora
//  Soporta Efectivo, Tarjeta y Pago Mixto (desglose).
//  Calculadora de cambio con denominaciones de MXN.
// ============================================================

class PaymentProcessor {
    // Denominaciones de billetes y monedas mexicanas (mayor a menor)
    static denominations = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

    // Calcular el cambio y su desglose óptimo
    // Fórmula: Cambio = Monto Recibido - Total Venta
    static calculateChange(amountReceived, totalDue) {
        const roundedReceived = Math.round(amountReceived * 100) / 100;
        const roundedDue = Math.round(totalDue * 100) / 100;

        if (roundedReceived < roundedDue) {
            return {
                change: 0,
                breakdown: {},
                coins: 0,
                error: 'El monto recibido es insuficiente'
            };
        }

        const change = Math.round((roundedReceived - roundedDue) * 100) / 100;
        const breakdown = {};
        let remaining = change;

        for (const denom of this.denominations) {
            if (remaining >= denom) {
                const count = Math.floor(remaining / denom);
                breakdown[denom] = count;
                remaining = Math.round((remaining - denom * count) * 100) / 100;
            }
        }

        return {
            change: change,
            breakdown: breakdown,
            coins: remaining
        };
    }

    // Formatear el desglose de cambio como texto legible
    static formatBreakdown(breakdown) {
        return Object.entries(breakdown)
            .map(([denom, count]) => `$${denom} x ${count} = $${(parseInt(denom) * count).toFixed(2)}`)
            .join('\n');
    }

    // Formatear denominación como etiqueta de botón
    static formatDenomination(denom) {
        return `$${denom}`;
    }
}
