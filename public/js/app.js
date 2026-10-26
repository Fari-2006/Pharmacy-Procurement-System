// Main Application Coordinator & UI Router
const alertsManager = {
  data: null,

  async openModal(filterType = 'all') {
    try {
      const res = await api.get('/medicines/alerts');
      if (!res.success) return;
      this.data = res.alerts;

      const container = document.getElementById('alertsModalContent');
      if (!container) return;

      let html = '';

      // Expired Batches
      if (this.data.expiredBatches.length > 0) {
        html += `
          <div style="margin-bottom:20px;">
            <h4 style="color:var(--accent-danger); font-size:0.95rem; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-ban"></i> Expired Batches (${this.data.expiredBatches.length}) - Action Required
            </h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Batch</th>
                  <th>Expired Date</th>
                  <th>Units</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${this.data.expiredBatches.map(b => `
                  <tr>
                    <td><strong>${b.medicineName}</strong></td>
                    <td><span class="badge badge-danger">${b.batchNumber}</span></td>
                    <td>${new Date(b.expiryDate).toLocaleDateString()}</td>
                    <td>${b.quantity}</td>
                    <td>
                      <button class="btn btn-sm btn-danger" onclick="document.getElementById('alertsModal').classList.remove('active'); inventory.viewBatches('${b.medicineId}')">
                        Quarantine/Dispose
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      // Expiring Batches (< 90 Days)
      if (this.data.expiringSoonBatches.length > 0) {
        html += `
          <div style="margin-bottom:20px;">
            <h4 style="color:#d97706; font-size:0.95rem; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-clock"></i> Expiring Soon (FEFO Alert) (${this.data.expiringSoonBatches.length})
            </h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Batch</th>
                  <th>Expiry Date</th>
                  <th>Days Left</th>
                  <th>Available</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${this.data.expiringSoonBatches.map(b => `
                  <tr>
                    <td><strong>${b.medicineName}</strong></td>
                    <td><span class="badge badge-warning">${b.batchNumber}</span></td>
                    <td>${new Date(b.expiryDate).toLocaleDateString()}</td>
                    <td><strong>${b.daysLeft} days</strong></td>
                    <td>${b.quantity} units</td>
                    <td>
                      <button class="btn btn-sm btn-primary" onclick="document.getElementById('alertsModal').classList.remove('active'); window.appRouter.navigateTo('pos'); pos.filterCatalog('${b.medicineName}')">
                        Dispense First
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      // Low Stock / Out of Stock
      const stockIssues = [...this.data.outOfStock, ...this.data.lowStock];
      if (stockIssues.length > 0) {
        html += `
          <div>
            <h4 style="color:var(--text-main); font-size:0.95rem; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-boxes-stacked"></i> Low & Out of Stock Medicines (${stockIssues.length})
            </h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Category</th>
                  <th>Current Stock</th>
                  <th>Reorder Level</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${stockIssues.map(m => `
                  <tr>
                    <td><strong>${m.name}</strong> <small class="text-muted">(${m.genericName})</small></td>
                    <td><span class="badge badge-gray">${m.category}</span></td>
                    <td><span class="badge ${m.totalStock === 0 ? 'badge-danger' : 'badge-warning'}">${m.totalStock} units</span></td>
                    <td>${m.reorderLevel} units</td>
                    <td>
                      <button class="btn btn-sm btn-secondary" onclick="document.getElementById('alertsModal').classList.remove('active'); inventory.openAddBatchModal('${m.id}')">
                        + Add Stock
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      if (!html) {
        html = '<p class="text-center text-muted py-4">No active stock or expiry alerts! All inventory levels are optimal.</p>';
      }

      container.innerHTML = html;
      document.getElementById('alertsModal').classList.add('active');
    } catch (e) {
      showToast('Failed to load alerts detail.', 'error');
    }
  }
};

const appRouter = {
  currentView: 'dashboard',

  init() {
    this.bindNav();
    this.bindClock();
    this.bindModalForms();

    // Default view
    const initialView = auth.currentUser?.role === 'cashier' ? 'pos' : 'dashboard';
    this.navigateTo(initialView);
  },

  bindNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = item.dataset.view;
        if (targetView) this.navigateTo(targetView);
      });
    });

    // Header alerts button
    document.getElementById('headerAlertsBtn')?.addEventListener('click', () => {
      alertsManager.openModal();
    });

    // Close modals on clicking overlay or close button
    document.querySelectorAll('.modal-close, .btn-modal-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal && modal.id !== 'loginModal') {
          modal.classList.remove('active');
        }
      });
    });

    // Close on overlay backdrop click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && overlay.id !== 'loginModal') {
          overlay.classList.remove('active');
        }
      });
    });
  },

  navigateTo(viewName, params = {}) {
    this.currentView = viewName;

    // Highlight nav
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === viewName);
    });

    // Switch view sections
    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.remove('active');
    });

    const activeSec = document.getElementById(`view-${viewName}`);
    if (activeSec) activeSec.classList.add('active');

    // Update Header title
    const titleEl = document.getElementById('headerPageTitle');
    const titles = {
      dashboard: 'Dashboard Overview',
      inventory: 'Pharmaceutical Inventory & Stock',
      pos: 'Point of Sale (POS) Dispensing',
      sales: 'Sales History & Invoices',
      suppliers: 'Suppliers Directory',
      users: 'Staff & Role Management'
    };
    if (titleEl) titleEl.textContent = titles[viewName] || 'Pharmacy Stock System';

    // Load data for view
    if (viewName === 'dashboard') {
      dashboard.loadStats();
    } else if (viewName === 'inventory') {
      if (params.status) {
        const statusFilter = document.getElementById('invStatusFilter');
        if (statusFilter) statusFilter.value = params.status;
      }
      inventory.loadMedicines();
    } else if (viewName === 'pos') {
      pos.loadCatalog();
    } else if (viewName === 'sales') {
      salesHistory.loadSales();
    } else if (viewName === 'suppliers') {
      suppliersManager.loadSuppliers();
    } else if (viewName === 'users') {
      usersManager.loadUsers();
    }
  },

  bindClock() {
    const update = () => {
      const el = document.getElementById('clockDisplay');
      if (el) {
        const d = new Date();
        el.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + d.toLocaleTimeString();
      }
    };
    update();
    setInterval(update, 1000);
  },

  bindModalForms() {
    // 1. Add Medicine Form
    document.getElementById('addMedicineForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: document.getElementById('addMedName').value.trim(),
        genericName: document.getElementById('addMedGeneric').value.trim(),
        category: document.getElementById('addMedCategory').value,
        dosageForm: document.getElementById('addMedDosage').value,
        strength: document.getElementById('addMedStrength').value.trim(),
        manufacturer: document.getElementById('addMedManufacturer').value.trim(),
        unit: document.getElementById('addMedUnit').value,
        reorderLevel: Number(document.getElementById('addMedReorder').value) || 20,
        rackLocation: document.getElementById('addMedRack').value.trim(),
        requiresPrescription: document.getElementById('addMedPrescription').checked,
        description: document.getElementById('addMedDesc').value.trim()
      };

      const bNum = document.getElementById('addMedBatchNum')?.value.trim();
      const bQty = Number(document.getElementById('addMedBatchQty')?.value);
      if (bNum && bQty > 0) {
        body.initialBatch = {
          batchNumber: bNum,
          mfgDate: document.getElementById('addMedBatchMfg')?.value || null,
          expiryDate: document.getElementById('addMedBatchExp')?.value,
          costPrice: Number(document.getElementById('addMedBatchCost')?.value) || 0,
          sellingPrice: Number(document.getElementById('addMedBatchPrice')?.value) || 0,
          quantity: bQty,
          supplier: document.getElementById('addMedSupplier')?.value || null
        };
      }

      try {
        const res = await api.post('/medicines', body);
        if (res.success) {
          showToast('Medicine registered successfully!', 'success');
          document.getElementById('addMedicineModal').classList.remove('active');
          inventory.loadMedicines();
          dashboard.loadStats();
        }
      } catch (err) {
        showToast(err.message || 'Failed to save medicine.', 'error');
      }
    });

    // 2. Edit Medicine Form
    document.getElementById('editMedicineForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editMedId').value;
      const body = {
        name: document.getElementById('editMedName').value.trim(),
        genericName: document.getElementById('editMedGeneric').value.trim(),
        category: document.getElementById('editMedCategory').value,
        dosageForm: document.getElementById('editMedDosage').value,
        strength: document.getElementById('editMedStrength').value.trim(),
        manufacturer: document.getElementById('editMedManufacturer').value.trim(),
        unit: document.getElementById('editMedUnit').value,
        reorderLevel: Number(document.getElementById('editMedReorder').value),
        rackLocation: document.getElementById('editMedRack').value.trim(),
        requiresPrescription: document.getElementById('editMedPrescription').checked,
        description: document.getElementById('editMedDesc').value.trim()
      };

      try {
        const res = await api.put(`/medicines/${id}`, body);
        if (res.success) {
          showToast('Medicine details updated!', 'success');
          document.getElementById('editMedicineModal').classList.remove('active');
          inventory.loadMedicines();
        }
      } catch (err) {
        showToast(err.message || 'Failed to update medicine.', 'error');
      }
    });

    // 3. Add Batch Form
    document.getElementById('addBatchForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const medId = document.getElementById('addBatchMedId').value;
      const body = {
        batchNumber: document.getElementById('addBatchNumber').value.trim(),
        mfgDate: document.getElementById('addBatchMfg').value || null,
        expiryDate: document.getElementById('addBatchExp').value,
        costPrice: Number(document.getElementById('addBatchCost').value) || 0,
        sellingPrice: Number(document.getElementById('addBatchPrice').value) || 0,
        quantity: Number(document.getElementById('addBatchQty').value) || 0,
        supplier: document.getElementById('addBatchSupplier').value || null
      };

      try {
        const res = await api.post(`/medicines/${medId}/batches`, body);
        if (res.success) {
          showToast('Batch added and stock increased!', 'success');
          document.getElementById('addBatchModal').classList.remove('active');
          inventory.loadMedicines();
          dashboard.loadStats();
          if (inventory.selectedMedicine && inventory.selectedMedicine._id === medId) {
            inventory.viewBatches(medId);
          }
        }
      } catch (err) {
        showToast(err.message || 'Failed to add batch.', 'error');
      }
    });

    // 4. Adjust Stock Form
    document.getElementById('adjustForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const medId = document.getElementById('adjustMedId').value;
      const batchId = document.getElementById('adjustBatchId').value;
      const body = {
        adjustmentType: document.getElementById('adjustType').value,
        quantity: Number(document.getElementById('adjustQty').value),
        reason: document.getElementById('adjustReason').value.trim()
      };

      try {
        const res = await api.post(`/medicines/${medId}/batches/${batchId}/adjust`, body);
        if (res.success) {
          showToast('Stock quantity adjusted successfully!', 'success');
          document.getElementById('adjustStockModal').classList.remove('active');
          inventory.loadMedicines();
          dashboard.loadStats();
          inventory.viewBatches(medId);
        }
      } catch (err) {
        showToast(err.message || 'Failed to adjust stock.', 'error');
      }
    });

    // 5. Add Supplier Form
    document.getElementById('addSupplierForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cats = document.getElementById('addSupplierCategories').value
        .split(',')
        .map(c => c.trim())
        .filter(c => c);

      const body = {
        name: document.getElementById('addSupplierName').value.trim(),
        contactPerson: document.getElementById('addSupplierContact').value.trim(),
        email: document.getElementById('addSupplierEmail').value.trim(),
        phone: document.getElementById('addSupplierPhone').value.trim(),
        address: document.getElementById('addSupplierAddress').value.trim(),
        suppliedCategories: cats,
        notes: document.getElementById('addSupplierNotes').value.trim()
      };

      try {
        const res = await api.post('/suppliers', body);
        if (res.success) {
          showToast('Supplier registered!', 'success');
          document.getElementById('addSupplierModal').classList.remove('active');
          suppliersManager.loadSuppliers();
        }
      } catch (err) {
        showToast(err.message || 'Failed to save supplier.', 'error');
      }
    });

    // 6. Edit Supplier Form
    document.getElementById('editSupplierForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editSupplierId').value;
      const cats = document.getElementById('editSupplierCategories').value
        .split(',')
        .map(c => c.trim())
        .filter(c => c);

      const body = {
        name: document.getElementById('editSupplierName').value.trim(),
        contactPerson: document.getElementById('editSupplierContact').value.trim(),
        email: document.getElementById('editSupplierEmail').value.trim(),
        phone: document.getElementById('editSupplierPhone').value.trim(),
        address: document.getElementById('editSupplierAddress').value.trim(),
        suppliedCategories: cats,
        notes: document.getElementById('editSupplierNotes').value.trim()
      };

      try {
        const res = await api.put(`/suppliers/${id}`, body);
        if (res.success) {
          showToast('Supplier updated!', 'success');
          document.getElementById('editSupplierModal').classList.remove('active');
          suppliersManager.loadSuppliers();
        }
      } catch (err) {
        showToast(err.message || 'Failed to update supplier.', 'error');
      }
    });

    // 7. Add Staff User Form (Admin Only)
    document.getElementById('addUserForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: document.getElementById('addUserName').value.trim(),
        email: document.getElementById('addUserEmail').value.trim(),
        password: document.getElementById('addUserPassword').value,
        role: document.getElementById('addUserRole').value,
        phone: document.getElementById('addUserPhone').value.trim()
      };

      try {
        const res = await api.post('/users', body);
        if (res.success) {
          showToast('New staff user account created!', 'success');
          document.getElementById('addUserModal').classList.remove('active');
          usersManager.loadUsers();
        }
      } catch (err) {
        showToast(err.message || 'Failed to create user.', 'error');
      }
    });

    // 8. Edit Staff User Form
    document.getElementById('editUserForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editUserId').value;
      const body = {
        name: document.getElementById('editUserName').value.trim(),
        role: document.getElementById('editUserRole').value,
        phone: document.getElementById('editUserPhone').value.trim(),
        isActive: document.getElementById('editUserActive').checked
      };

      const pass = document.getElementById('editUserPassword').value;
      if (pass && pass.trim().length >= 6) {
        body.password = pass.trim();
      }

      try {
        const res = await api.put(`/users/${id}`, body);
        if (res.success) {
          showToast('Staff user updated!', 'success');
          document.getElementById('editUserModal').classList.remove('active');
          usersManager.loadUsers();
        }
      } catch (err) {
        showToast(err.message || 'Failed to update user.', 'error');
      }
    });

    // Filter listeners
    document.getElementById('invSearchInput')?.addEventListener('input', () => inventory.loadMedicines());
    document.getElementById('invCategoryFilter')?.addEventListener('change', () => inventory.loadMedicines());
    document.getElementById('invStatusFilter')?.addEventListener('change', () => inventory.loadMedicines());

    document.getElementById('salesSearchInput')?.addEventListener('input', () => salesHistory.loadSales());
    document.getElementById('salesStartDate')?.addEventListener('change', () => salesHistory.loadSales());
    document.getElementById('salesEndDate')?.addEventListener('change', () => salesHistory.loadSales());
  }
};

window.appRouter = appRouter;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  if (!await auth.init()) return;
  pos.init();
  appRouter.init();

  window.addEventListener('auth:login_success', (e) => {
    const user = e.detail;
    appRouter.navigateTo(user.role === 'cashier' ? 'pos' : 'dashboard');
  });
});
