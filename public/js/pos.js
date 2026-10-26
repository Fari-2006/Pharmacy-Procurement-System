// Point of Sale (POS) & Automated Dispensing Module
const pos = {
  cart: [],
  allMedicines: [],
  currentInvoice: null,

  async init() {
    this.bindEvents();
    await this.loadCatalog();
  },

  bindEvents() {
    const searchInput = document.getElementById('posSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterCatalog(e.target.value);
      });
    }

    const discInput = document.getElementById('posDiscountPercent');
    const taxInput = document.getElementById('posTaxPercent');
    const paidInput = document.getElementById('posPaidAmount');

    if (discInput) discInput.addEventListener('input', () => this.updateTotals());
    if (taxInput) taxInput.addEventListener('input', () => this.updateTotals());
    if (paidInput) paidInput.addEventListener('input', () => this.updateTotals());

    const checkoutBtn = document.getElementById('posCheckoutBtn');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', () => this.processCheckout());
    }

    const clearBtn = document.getElementById('posClearCartBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (this.cart.length > 0 && confirm('Clear current cart?')) {
          this.clearCart();
        }
      });
    }
  },

  async loadCatalog() {
    try {
      const res = await api.get('/medicines');
      if (res.success) {
        this.allMedicines = res.medicines;
        this.renderCatalog(this.allMedicines);
      }
    } catch (error) {
      showToast('Failed to load medicine catalog for POS.', 'error');
    }
  },

  filterCatalog(query) {
    if (!query || query.trim() === '') {
      this.renderCatalog(this.allMedicines);
      return;
    }
    const q = query.toLowerCase().trim();
    const filtered = this.allMedicines.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.genericName.toLowerCase().includes(q) ||
      (m.manufacturer && m.manufacturer.toLowerCase().includes(q))
    );
    this.renderCatalog(filtered);
  },

  renderCatalog(medicines) {
    const container = document.getElementById('posMedicineList');
    if (!container) return;

    if (!medicines || medicines.length === 0) {
      container.innerHTML = '<p class="text-muted text-center py-4">No matching medicines found.</p>';
      return;
    }

    const now = new Date();

    container.innerHTML = medicines.map(med => {
      // Find active, unexpired batches with stock > 0
      const activeBatches = med.batches
        .filter(b => b.status === 'active' && b.quantity > 0 && new Date(b.expiryDate) > now)
        .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate)); // FEFO sort

      const hasStock = activeBatches.length > 0;
      const primaryBatch = activeBatches[0]; // First Expiring First Out recommended

      return `
        <div class="pos-med-card ${!hasStock ? 'opacity-50' : ''}">
          <div class="pos-med-info">
            <h4>${med.name}</h4>
            <p>${med.genericName} &bull; ${med.dosageForm} ${med.strength ? `(${med.strength})` : ''} &bull; <i class="fa-solid fa-location-dot"></i> ${med.rackLocation || 'Shelf'}</p>
            <div class="pos-med-batches">
              ${hasStock ? `
                <span class="batch-pill fefo-recommend" title="First Expired First Out recommended">
                  <i class="fa-solid fa-star"></i> FEFO: ${primaryBatch.batchNumber} (Exp: ${new Date(primaryBatch.expiryDate).toLocaleDateString()}) - $${primaryBatch.sellingPrice.toFixed(2)}
                </span>
                <span class="badge badge-success">${med.totalStock} in stock</span>
              ` : `
                <span class="badge badge-danger">Out of Stock / No Valid Batch</span>
              `}
            </div>
          </div>
          <div>
            ${hasStock ? `
              <button class="btn btn-primary btn-sm" onclick="pos.addToCart('${med._id}', '${primaryBatch.batchNumber}')">
                <i class="fa-solid fa-cart-plus"></i> Add
              </button>
            ` : `
              <button class="btn btn-secondary btn-sm" disabled>Unavailable</button>
            `}
          </div>
        </div>
      `;
    }).join('');
  },

  addToCart(medicineId, batchNumber) {
    const med = this.allMedicines.find(m => m._id === medicineId);
    if (!med) return;

    const batch = med.batches.find(b => b.batchNumber === batchNumber);
    if (!batch) return;

    // Check if already in cart
    const existingIndex = this.cart.findIndex(i => i.medicineId === medicineId && i.batchNumber === batchNumber);
    if (existingIndex > -1) {
      if (this.cart[existingIndex].quantity + 1 > batch.quantity) {
        showToast(`Cannot add more. Maximum available stock in batch ${batch.batchNumber} is ${batch.quantity}.`, 'warning');
        return;
      }
      this.cart[existingIndex].quantity += 1;
    } else {
      if (batch.quantity < 1) {
        showToast(`Batch ${batch.batchNumber} is depleted.`, 'error');
        return;
      }
      this.cart.push({
        medicineId: med._id,
        medicineName: med.name,
        genericName: med.genericName,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        unitPrice: batch.sellingPrice,
        maxStock: batch.quantity,
        quantity: 1
      });
    }

    this.renderCart();
    showToast(`Added ${med.name} (Batch: ${batch.batchNumber}) to invoice`, 'info');
  },

  updateCartQty(index, delta) {
    const item = this.cart[index];
    if (!item) return;

    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      this.cart.splice(index, 1);
    } else if (newQty > item.maxStock) {
      showToast(`Cannot exceed batch stock limit (${item.maxStock} units).`, 'warning');
      return;
    } else {
      item.quantity = newQty;
    }

    this.renderCart();
  },

  removeFromCart(index) {
    this.cart.splice(index, 1);
    this.renderCart();
  },

  clearCart() {
    this.cart = [];
    document.getElementById('posCustomerName').value = '';
    document.getElementById('posCustomerPhone').value = '';
    document.getElementById('posDoctorName').value = '';
    document.getElementById('posDiscountPercent').value = 0;
    document.getElementById('posTaxPercent').value = 0;
    document.getElementById('posPaidAmount').value = '';
    this.renderCart();
  },

  renderCart() {
    const container = document.getElementById('posCartItemsList');
    const checkoutBtn = document.getElementById('posCheckoutBtn');
    if (!container) return;

    if (this.cart.length === 0) {
      container.innerHTML = '<p class="text-muted text-center py-4">No items in cart. Click "+ Add" on medicines on the left.</p>';
      if (checkoutBtn) checkoutBtn.disabled = true;
      this.updateTotals();
      return;
    }

    if (checkoutBtn) checkoutBtn.disabled = false;

    container.innerHTML = this.cart.map((item, idx) => {
      const itemSubtotal = (item.unitPrice * item.quantity).toFixed(2);
      return `
        <div class="cart-item">
          <div class="cart-item-name">
            <strong>${item.medicineName}</strong>
            <div class="sub">Batch: ${item.batchNumber} &bull; $${item.unitPrice.toFixed(2)} / unit</div>
          </div>
          <div class="qty-counter">
            <button onclick="pos.updateCartQty(${idx}, -1)">-</button>
            <span>${item.quantity}</span>
            <button onclick="pos.updateCartQty(${idx}, 1)">+</button>
          </div>
          <div style="font-weight:700; width:65px; text-align:right;">
            $${itemSubtotal}
          </div>
          <button class="btn btn-sm btn-secondary" onclick="pos.removeFromCart(${idx})" style="padding:3px 6px; color:#ef4444;" title="Remove">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `;
    }).join('');

    this.updateTotals();
  },

  updateTotals() {
    const subtotal = this.cart.reduce((acc, i) => acc + (i.unitPrice * i.quantity), 0);
    const discPct = Math.min(Math.max(Number(document.getElementById('posDiscountPercent')?.value) || 0, 0), 100);
    const taxPct = Math.max(Number(document.getElementById('posTaxPercent')?.value) || 0, 0);

    const discountAmount = (subtotal * discPct) / 100;
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = (taxableAmount * taxPct) / 100;
    const grandTotal = taxableAmount + taxAmount;

    const paidInput = document.getElementById('posPaidAmount');
    let paid = Number(paidInput?.value);
    if (!paid || paid === 0) {
      paid = grandTotal;
    }
    const changeAmount = paid >= grandTotal ? paid - grandTotal : 0;

    document.getElementById('posSubtotal').textContent = `$${subtotal.toFixed(2)}`;
    document.getElementById('posDiscountAmount').textContent = `-$${discountAmount.toFixed(2)}`;
    document.getElementById('posTaxAmount').textContent = `+$${taxAmount.toFixed(2)}`;
    document.getElementById('posGrandTotal').textContent = `$${grandTotal.toFixed(2)}`;
    document.getElementById('posChangeAmount').textContent = `$${changeAmount.toFixed(2)}`;
  },

  async processCheckout() {
    if (this.cart.length === 0) {
      showToast('Cart is empty!', 'warning');
      return;
    }

    const customerName = document.getElementById('posCustomerName')?.value.trim() || 'Walk-in Customer';
    const customerPhone = document.getElementById('posCustomerPhone')?.value.trim() || '';
    const doctorName = document.getElementById('posDoctorName')?.value.trim() || '';
    const paymentMethod = document.getElementById('posPaymentMethod')?.value || 'cash';
    const discountPercent = Number(document.getElementById('posDiscountPercent')?.value) || 0;
    const taxPercent = Number(document.getElementById('posTaxPercent')?.value) || 0;
    const paidAmount = Number(document.getElementById('posPaidAmount')?.value) || 0;

    const items = this.cart.map(i => ({
      medicineId: i.medicineId,
      medicineName: i.medicineName,
      batchNumber: i.batchNumber,
      quantity: i.quantity
    }));

    try {
      const res = await api.post('/sales', {
        customerName,
        customerPhone,
        doctorName,
        paymentMethod,
        discountPercent,
        taxPercent,
        paidAmount,
        items
      });

      if (res.success) {
        showToast(`Invoice ${res.sale.invoiceNumber} created! Stock updated.`, 'success');
        this.currentInvoice = res.sale;

        // Clear cart
        this.clearCart();

        // Refresh inventory and dashboard data in background
        this.loadCatalog();
        inventory.loadMedicines();
        dashboard.loadStats();

        // Open Printable Receipt Modal
        this.showReceiptModal(res.sale);
      }
    } catch (error) {
      showToast(error.message || 'Checkout failed.', 'error');
    }
  },

  showReceiptModal(sale) {
    const modal = document.getElementById('receiptModal');
    const container = document.getElementById('printableReceipt');
    if (!modal || !container) return;

    container.innerHTML = `
      <div class="receipt-header">
        <h2>PharmaFlow Dispensary</h2>
        <p>Licensed Pharmacy & Healthcare Services</p>
        <p>Reg No: PH-98234-A | Helpline: (800) 555-0199</p>
      </div>

      <div class="receipt-meta">
        <div><strong>Invoice #:</strong> ${sale.invoiceNumber}</div>
        <div><strong>Date/Time:</strong> ${new Date(sale.createdAt).toLocaleString()}</div>
        <div><strong>Customer:</strong> ${sale.customerName} ${sale.customerPhone ? `(${sale.customerPhone})` : ''}</div>
        ${sale.doctorName ? `<div><strong>Prescribed By:</strong> Dr. ${sale.doctorName}</div>` : ''}
        <div><strong>Dispensed By:</strong> ${sale.dispensedBy?.name || 'Staff Pharmacist'}</div>
        <div><strong>Payment Method:</strong> ${sale.paymentMethod.toUpperCase()}</div>
      </div>

      <table class="receipt-table">
        <thead>
          <tr>
            <th>Item & Batch</th>
            <th style="text-align:center;">Qty</th>
            <th style="text-align:right;">Price</th>
            <th style="text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${sale.items.map(item => `
            <tr>
              <td>
                <div><strong>${item.medicineName}</strong></div>
                <div style="font-size:9px; color:#555;">Batch: ${item.batchNumber} | Exp: ${item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : 'N/A'}</div>
              </td>
              <td style="text-align:center;">${item.quantity}</td>
              <td style="text-align:right;">$${item.unitPrice.toFixed(2)}</td>
              <td style="text-align:right;">$${item.subtotal.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="receipt-totals">
        <div class="row">
          <span>Subtotal:</span>
          <span>$${sale.subtotal.toFixed(2)}</span>
        </div>
        ${sale.discountAmount > 0 ? `
          <div class="row">
            <span>Discount (${sale.discountPercent}%):</span>
            <span>-$${sale.discountAmount.toFixed(2)}</span>
          </div>
        ` : ''}
        ${sale.taxAmount > 0 ? `
          <div class="row">
            <span>Tax (${sale.taxPercent}%):</span>
            <span>+$${sale.taxAmount.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="row grand">
          <span>GRAND TOTAL:</span>
          <span>$${sale.grandTotal.toFixed(2)}</span>
        </div>
        <div class="row">
          <span>Amount Paid:</span>
          <span>$${(sale.paidAmount || sale.grandTotal).toFixed(2)}</span>
        </div>
        ${sale.changeAmount > 0 ? `
          <div class="row">
            <span>Change Returned:</span>
            <span>$${sale.changeAmount.toFixed(2)}</span>
          </div>
        ` : ''}
      </div>

      <div class="receipt-footer">
        <p>*** Thank you for your visit! ***</p>
        <p>Keep medicines out of reach of children. Store in a cool, dry place.</p>
        <p>Software Powered by Antigravity Pharmacy System</p>
      </div>
    `;

    modal.classList.add('active');
  },

  printReceipt() {
    window.print();
  }
};
