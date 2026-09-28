class Inventory {
    static storageKey = 'pos_inventory';

    static defaultProducts = [
        { barcode: '7501000100018', description: 'Anillo de Plata Luna Creciente', price: 450.00, cost: 225.00, stock: 25 },
        { barcode: '7501000100025', description: 'Collar de Oro 18K', price: 1250.00, cost: 750.00, stock: 8 },
        { barcode: '7501000100032', description: 'Pulsera de Cuero con Metal', price: 320.00, cost: 140.00, stock: 15 },
        { barcode: '7501000100049', description: 'Aretes de Diamantes Sintéticos', price: 890.00, cost: 445.00, stock: 12 },
        { barcode: '7501000100056', description: 'Anillo de Compromiso Tradicional', price: 2100.00, cost: 1200.00, stock: 5 },
        { barcode: '7501000100063', description: 'Reloj de Pulsera de Acero', price: 750.00, cost: 400.00, stock: 10 },
        { barcode: '7501000100070', description: 'Collar de Cadenas Dobles', price: 680.00, cost: 340.00, stock: 18 },
        { barcode: '7501000100087', description: 'Anillo de Plata con Zircon', price: 520.00, cost: 260.00, stock: 22 },
        { barcode: '7501000100094', description: 'Aro de Plata 925', price: 70.00, cost: 30.00, stock: 100, volumePricing: true },
        { barcode: '7501000100100', description: 'Collar de Plata Simple', price: 70.00, cost: 30.00, stock: 80, volumePricing: true }
    ];

    static init() {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) {
            this.saveProducts(this.defaultProducts);
        }
    }

    static getAll() {
        const stored = localStorage.getItem(this.storageKey);
        return stored ? JSON.parse(stored) : [];
    }

    static saveProducts(products) {
        localStorage.setItem(this.storageKey, JSON.stringify(products));
    }

    static findByBarcode(barcode) {
        return this.getAll().find(p => p.barcode === barcode) || null;
    }

    static search(query) {
        if (!query) return this.getAll();
        const lower = query.toLowerCase();
        return this.getAll().filter(p =>
            p.description.toLowerCase().includes(lower) ||
            p.barcode.includes(query)
        );
    }

    static add(product) {
        const products = this.getAll();
        if (products.some(p => p.barcode === product.barcode)) {
            return { success: false, error: 'Ya existe un producto con ese código' };
        }
        products.push(product);
        this.saveProducts(products);
        return { success: true };
    }

    static update(barcode, updatedProduct) {
        const products = this.getAll();
        const index = products.findIndex(p => p.barcode === barcode);
        if (index === -1) return { success: false, error: 'Producto no encontrado' };
        products[index] = { ...products[index], ...updatedProduct };
        this.saveProducts(products);
        return { success: true };
    }

    static remove(barcode) {
        const products = this.getAll();
        const filtered = products.filter(p => p.barcode !== barcode);
        this.saveProducts(filtered);
        return { success: true };
    }

    static updateStock(barcodes) {
        const products = this.getAll();
        barcodes.forEach(({ barcode, quantity }) => {
            const product = products.find(p => p.barcode === barcode);
            if (product) {
                product.stock = Math.max(0, product.stock - quantity);
            }
        });
        this.saveProducts(products);
    }

    static getProfitMargin(product) {
        if (!product.cost || !product.price || product.cost === 0) return 0;
        return ((product.price - product.cost) / product.cost) * 100;
    }

    static getProfit(product) {
        if (!product.cost || !product.price) return 0;
        return product.price - product.cost;
    }

    static renderList() {
        const grid = document.getElementById('inventory-grid');
        if (!grid) return;

        const products = this.search('');
        const canViewCosts = window.app ? Auth.canViewCosts() : true;
        grid.innerHTML = '';

        if (products.length === 0) {
            grid.innerHTML = '<p class="empty-text">No hay productos en el inventario</p>';
            return;
        }

        products.forEach(product => {
            const card = document.createElement('div');
            card.className = 'inventory-card';
            let costHtml = '';
            if (canViewCosts) {
                const profit = this.getProfit(product);
                const margin = this.getProfitMargin(product);
                costHtml = `
                    <div class="product-cost">Costo: $${product.cost.toFixed(2)}</div>
                    <div class="product-profit">Ganancia: $${profit.toFixed(2)} (${margin.toFixed(1)}%)</div>
                `;
            }
            card.innerHTML = `
                <div class="product-name">${product.description}</div>
                <div class="product-sku">Código: ${product.barcode}</div>
                <div class="product-price">$${product.price.toFixed(2)}</div>
                <div class="product-stock">Existencia: ${product.stock} unidades</div>
                ${costHtml}
            `;
            grid.appendChild(card);
        });
    }

    static renderCatalog() {
        this.renderList();
    }
}
