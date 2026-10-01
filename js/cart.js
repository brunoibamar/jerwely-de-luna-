// ============================================================
//  Cart: Gestión del carrito de ventas
//  Integra la promoción por volumen multicategoría: suma global
//  de unidades calificadas (aplicaPromocion === true) y aplica el
//  precio unitario preferencial a cada artículo calificado cuando
//  el total alcanza el umbral configurado.
//  Soporte para guardado/restauración de carritos (ventas en espera).
// ============================================================

class Cart {
    constructor() {
        this.items = [];
    }

    // Agregar un producto al carrito.
    // El precio unitario de los artículos calificados (aplicaPromocion)
    // se evalúa de forma global/multicategoría tras cada agregado.
    addItem(product) {
        const existing = this.items.find(item => item.barcode === product.barcode);

        if (existing) {
            existing.quantity += 1;
        } else {
            this.items.push({
                barcode: product.barcode,
                description: product.description,
                price: product.price,
                originalPrice: product.price,
                quantity: 1,
                amount: product.price,
                stock: product.stock,
                aplicaPromocion: product.aplicaPromocion === true
            });
        }

        // Re-evaluar la promoción por volumen multicategoría (total global)
        this.applyVolumePromotion();

        this.render();
        this.updateTotals();
    }

    removeItem(barcode) {
        this.items = this.items.filter(item => item.barcode !== barcode);
        // Recalcular el total global: al quitar un artículo el umbral puede cambiar
        this.applyVolumePromotion();
        this.render();
        this.updateTotals();
    }

    // Actualizar el precio de venta de un producto (solo admin).
    // Recalcula el importe, el subtotal y el total en tiempo real.
    updatePrice(barcode, newPrice) {
        const item = this.items.find(i => i.barcode === barcode);
        const price = parseFloat(newPrice);
        if (item && !isNaN(price) && price >= 0) {
            item.price = price;
            item.amount = price * item.quantity;
            this.render();
            this.updateTotals();
        }
    }

    // Actualizar cantidad de un producto.
    // Re-aplica la promoción por volumen multicategoría (recalcula el total global).
    updateQuantity(barcode, quantity) {
        const item = this.items.find(i => i.barcode === barcode);
        if (item && quantity > 0) {
            item.quantity = quantity;
            this.applyVolumePromotion();
            this.render();
            this.updateTotals();
        }
    }

    // --- Promoción por volumen multicategoría ---
    // Suma global de unidades calificadas (aplicaPromocion === true) de
    // TODOS los artículos, sin agrupar por categoría. Si el total alcanza
    // o supera el umbral configurado en los rangos, aplica el precio unitario
    // preferencial a cada artículo calificado (solo cuando es un descuento
    // real frente al precio base); el resto conserva su precio.
    applyVolumePromotion() {
        const items = this.items;
        const unitPrice = VolumePricing.getGlobalUnitPrice(items);

        items.forEach(item => {
            if (typeof item.originalPrice !== 'number') {
                item.originalPrice = item.price;
            }
            if (item.aplicaPromocion === true && unitPrice !== null) {
                item.price = unitPrice < item.originalPrice ? unitPrice : item.originalPrice;
            }
            item.amount = item.price * item.quantity;
        });
    }

    canAddItem(barcode) {
        const item = this.items.find(i => i.barcode === barcode);
        if (!item) return true;
        const product = Inventory.findByBarcode(barcode);
        if (!product) return true;
        return item.quantity < product.stock;
    }

    updateTotals() {
        const subtotal = this.getSubtotal();

        this.updateDOM('subtotal-amount', `$${subtotal.toFixed(2)}`);
        this.updateDOM('total-amount', `$${subtotal.toFixed(2)}`);
    }

    updateDOM(id, textContent) {
        const el = document.getElementById(id);
        if (el) el.textContent = textContent;
    }

    render() {
        const tbody = document.getElementById('sales-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (this.items.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-row">
                        <span class="empty-text">No hay productos en la venta</span>
                    </td>
                </tr>
            `;
            return;
        }

        this.items.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="barcode-cell">${item.barcode}</td>
                <td class="description-cell">${item.description}</td>
                <td class="price-cell">
                    ${Auth.isAdmin()
                        ? `<input type="number" min="0" step="0.01" value="${item.price.toFixed(2)}"
                            onfocus="this.select()"
                            onchange="window.app.cart.updatePrice('${item.barcode}', this.value)"
                            class="price-input">`
                        : `$${item.price.toFixed(2)}`
                    }
                </td>
                <td class="qty-cell">
                    <input type="number" min="1" max="${item.stock}" value="${item.quantity}"
                           onchange="window.app.cart.updateQuantity('${item.barcode}', parseInt(this.value))"
                           class="qty-input">
                </td>
                <td class="amount-cell">$${item.amount.toFixed(2)}</td>
                <td class="stock-cell">${item.stock - item.quantity}</td>
                <td class="action-cell">
                    <button onclick="window.app.cart.removeItem('${item.barcode}')"
                            class="btn btn-icon" title="Eliminar">×</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    clear() {
        this.items = [];
        this.render();
        this.updateTotals();
    }

    // --- Métodos para ventas en espera ---

    // Exportar el estado del carrito para guardarlo como venta pausada
    getCartData() {
        return {
            items: this.items.map(item => ({ ...item })),
            timestamp: new Date().toISOString()
        };
    }

    restoreFromData(data) {
        this.items = data.items.map(item => ({ ...item }));
        this.applyVolumePromotion();
        this.render();
        this.updateTotals();
    }

    getItems() {
        return [...this.items];
    }

    getSubtotal() {
        return this.items.reduce((sum, item) => sum + item.amount, 0);
    }

    getTotal() {
        return this.getSubtotal();
    }

    getItemCount() {
        return this.items.reduce((sum, item) => sum + item.quantity, 0);
    }

    isEmpty() {
        return this.items.length === 0;
    }
}
