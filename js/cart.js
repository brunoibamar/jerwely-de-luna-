// ============================================================
//  Cart: Gestión del carrito de ventas
//  Integra precios de volumen (wholesale) y soporte para
//  guardado/restauración de carritos (ventas en espera).
// ============================================================

class Cart {
    constructor() {
        this.items = [];
        this.taxRate = 0.16;
    }

    // Agregar un producto al carrito.
    // Si el producto tiene volumePricing activado, el precio unitario
    // se calcula dinámicamente según la cantidad total en el carrito.
    addItem(product) {
        const existing = this.items.find(item => item.barcode === product.barcode);

        if (existing) {
            existing.quantity += 1;
        } else {
            this.items.push({
                barcode: product.barcode,
                description: product.description,
                price: product.price,
                quantity: 1,
                amount: product.price,
                stock: product.stock,
                hasVolumePricing: product.volumePricing === true
            });
        }

        // Re-evaluar el precio unitario con precios de volumen si aplica
        const item = existing || this.items[this.items.length - 1];
        if (item.hasVolumePricing) {
            const unitPrice = VolumePricing.getUnitPrice(item.quantity);
            item.price = unitPrice;
            item.amount = unitPrice * item.quantity;
        } else {
            item.amount = item.price * item.quantity;
        }

        this.render();
        this.updateTotals();
    }

    removeItem(barcode) {
        this.items = this.items.filter(item => item.barcode !== barcode);
        this.render();
        this.updateTotals();
    }

    // Actualizar cantidad de un producto.
    // Re-aplica precios de volumen si el producto los usa.
    updateQuantity(barcode, quantity) {
        const item = this.items.find(i => i.barcode === barcode);
        if (item && quantity > 0) {
            item.quantity = quantity;

            if (item.hasVolumePricing) {
                const unitPrice = VolumePricing.getUnitPrice(item.quantity);
                item.price = unitPrice;
                item.amount = unitPrice * item.quantity;
            } else {
                item.amount = item.price * item.quantity;
            }

            this.render();
            this.updateTotals();
        }
    }

    canAddItem(barcode) {
        const item = this.items.find(i => i.barcode === barcode);
        if (!item) return true;
        const product = Inventory.findByBarcode(barcode);
        if (!product) return true;
        return item.quantity < product.stock;
    }

    updateTotals() {
        const subtotal = this.items.reduce((sum, item) => sum + item.amount, 0);
        const tax = subtotal * this.taxRate;
        const total = subtotal + tax;

        this.updateDOM('subtotal-amount', `$${subtotal.toFixed(2)}`);
        this.updateDOM('tax-amount', `$${tax.toFixed(2)}`);
        this.updateDOM('total-amount', `$${total.toFixed(2)}`);
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
                <td class="price-cell">$${item.price.toFixed(2)}</td>
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
            taxRate: this.taxRate,
            timestamp: new Date().toISOString()
        };
    }

    // Restaurar el carrito desde datos guardados
    restoreFromData(data) {
        this.items = data.items.map(item => ({ ...item }));
        if (data.taxRate !== undefined) {
            this.taxRate = data.taxRate;
        }
        this.render();
        this.updateTotals();
    }

    // --- Métodos de consulta ---

    getItems() {
        return [...this.items];
    }

    getSubtotal() {
        return this.items.reduce((sum, item) => sum + item.amount, 0);
    }

    getTax() {
        return this.getSubtotal() * this.taxRate;
    }

    getTotal() {
        return this.getSubtotal() + this.getTax();
    }

    getItemCount() {
        return this.items.reduce((sum, item) => sum + item.quantity, 0);
    }

    isEmpty() {
        return this.items.length === 0;
    }

    setTaxRate(rate) {
        this.taxRate = rate / 100;
        this.updateTotals();
    }
}
