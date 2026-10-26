// Inventory & Stock Management Module
const inventory = {
  medicines: [],
  selectedMedicine: null,

  async loadMedicines() {
    const search = document.getElementById('invSearchInput')?.value || '';
    const category = document.getElementById('invCategoryFilter')?.value || 'All';
    const status = document.getElementById('invStatusFilter')?.value || 'all';

    try {
      let query = `?category=${encodeURIComponent(category)}&status=${encodeURIComponent(status)}`;
      if (search) query += `&search=${encodeURIComponent(search)}`;

      const res = await api.get(`/medicines${query}`);
      if (res.success) {
        this.medicines = res.medicines;
        this.renderTable(this.medicines);
      }
    } catch (error) {
      showToast(error.message || 'Failed to load medicines.', 'error');
    }
  },

  renderTable(list) {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No medicines found matching criteria.</td></tr>';
      return;
    }

    const isAdminOrPharmacist = auth.hasRole('admin', 'pharmacist');
    const isAdmin = auth.hasRole('admin');

    tbody.innerHTML = list.map(med => {
      let statusBadge = '<span class="badge badge-success">In Stock</span>';
      if (med.status === 'out_of_stock') {
        statusBadge = '<span class="badge badge-danger">Out of Stock</span>';
      } else if (med.status === 'low_stock') {
        statusBadge = `<span class="badge badge-warning">Low Stock (&le; ${med.reorderLevel})</span>`;
      }

      const activeBatchesCount = med.batches.filter(b => b.status === 'active' && b.quantity > 0).length;

      return `
        <tr>
          <td>
            <div style="font-weight:600; color:var(--text-main); font-size:0.92rem;">${med.name}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${med.genericName}</div>
          </td>
          <td><span class="badge badge-gray">${med.category}</span></td>
          <td>${med.dosageForm} ${med.strength ? `(${med.strength})` : ''}</td>
          <td><span style="font-size:0.8rem; background:#f8fafc; border:1px solid #e2e8f0; padding:2px 6px; border-radius:4px;"><i class="fa-solid fa-location-dot" style="font-size:10px; margin-right:3px; color:#64748b;"></i>${med.rackLocation || 'Shelf'}</span></td>
          <td>
            <strong style="font-size:0.95rem;">${med.totalStock}</strong> <small class="text-muted">${med.unit}</small>
          </td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="inventory.viewBatches('${med._id}')" title="View Batches">
              <i class="fa-solid fa-boxes-packing"></i> ${activeBatchesCount} active
            </button>
          </td>
          <td>${statusBadge}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="inventory.viewBatches('${med._id}')" title="Batches & Stock">
                <i class="fa-solid fa-list-check"></i>
              </button>
              ${isAdminOrPharmacist ? `
                <button class="btn btn-primary btn-sm" onclick="inventory.openAddBatchModal('${med._id}')" title="Add Stock/Batch">
                  <i class="fa-solid fa-plus"></i>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="inventory.openEditModal('${med._id}')" title="Edit Medicine">
                  <i class="fa-solid fa-pen"></i>
                </button>
              ` : ''}
              ${isAdmin ? `
                <button class="btn btn-danger btn-sm" onclick="inventory.deleteMedicine('${med._id}')" title="Delete Medicine">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  async viewBatches(medicineId) {
    try {
      const res = await api.get(`/medicines/${medicineId}`);
      if (!res.success) return;

      const med = res.medicine;
      this.selectedMedicine = med;

      document.getElementById('batchModalMedName').textContent = `${med.name} (${med.genericName})`;
      document.getElementById('batchModalTotalStock').textContent = `${med.totalStock} ${med.unit}`;

      const tbody = document.getElementById('batchesModalTableBody');
      const now = new Date();

      if (!med.batches || med.batches.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No batches recorded for this medicine yet. Click "Add Batch" to receive stock.</td></tr>';
      } else {
        tbody.innerHTML = med.batches.map(b => {
          const expDate = new Date(b.expiryDate);
          const isExpired = expDate < now;
          const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

          let expiryBadge = `<span class="badge badge-success">${expDate.toLocaleDateString()} (${daysLeft}d)</span>`;
          if (isExpired) {
            expiryBadge = `<span class="badge badge-danger">EXPIRED (${expDate.toLocaleDateString()})</span>`;
          } else if (daysLeft <= 30) {
            expiryBadge = `<span class="badge badge-danger">${expDate.toLocaleDateString()} (${daysLeft}d left)</span>`;
          } else if (daysLeft <= 90) {
            expiryBadge = `<span class="badge badge-warning">${expDate.toLocaleDateString()} (${daysLeft}d left)</span>`;
          }

          let statusBadge = `<span class="badge badge-success">Active</span>`;
          if (b.status === 'expired' || isExpired) statusBadge = `<span class="badge badge-danger">Expired</span>`;
          if (b.status === 'depleted' || b.quantity === 0) statusBadge = `<span class="badge badge-gray">Depleted</span>`;

          const canManage = auth.hasRole('admin', 'pharmacist');

          return `
            <tr>
              <td><strong>${b.batchNumber}</strong></td>
              <td>${expiryBadge}</td>
              <td>$${(b.costPrice || 0).toFixed(2)}</td>
              <td><strong>$${(b.sellingPrice || 0).toFixed(2)}</strong></td>
              <td><strong>${b.quantity}</strong> / ${b.initialQuantity || b.quantity}</td>
              <td>${statusBadge}</td>
              <td>
                ${canManage ? `
                  <button class="btn btn-secondary btn-sm" onclick="inventory.openAdjustModal('${med._id}', '${b._id}', '${b.batchNumber}', ${b.quantity})">
                    <i class="fa-solid fa-sliders"></i> Adjust
                  </button>
                ` : '<span class="text-muted">-</span>'}
              </td>
            </tr>
          `;
        }).join('');
      }

      document.getElementById('viewBatchesModal').classList.add('active');
    } catch (error) {
      showToast(error.message || 'Failed to fetch batches.', 'error');
    }
  },

  openAddMedicineModal() {
    document.getElementById('addMedicineForm').reset();
    document.getElementById('addMedicineModal').classList.add('active');
    this.populateSupplierDropdowns();
  },

  openAddBatchModal(medId) {
    const med = this.medicines.find(m => m._id === medId) || this.selectedMedicine;
    if (!med) return;

    this.selectedMedicine = med;
    document.getElementById('addBatchMedId').value = med._id;
    document.getElementById('addBatchMedName').textContent = med.name;
    document.getElementById('addBatchForm').reset();
    document.getElementById('addBatchModal').classList.add('active');
    this.populateSupplierDropdowns();
  },

  openAdjustModal(medId, batchId, batchNumber, currentQty) {
    document.getElementById('adjustMedId').value = medId;
    document.getElementById('adjustBatchId').value = batchId;
    document.getElementById('adjustBatchNumber').textContent = batchNumber;
    document.getElementById('adjustCurrentQty').textContent = currentQty;
    document.getElementById('adjustForm').reset();
    document.getElementById('adjustStockModal').classList.add('active');
  },

  async openEditModal(medId) {
    try {
      const res = await api.get(`/medicines/${medId}`);
      if (!res.success) return;
      const med = res.medicine;

      document.getElementById('editMedId').value = med._id;
      document.getElementById('editMedName').value = med.name;
      document.getElementById('editMedGeneric').value = med.genericName;
      document.getElementById('editMedCategory').value = med.category;
      document.getElementById('editMedDosage').value = med.dosageForm;
      document.getElementById('editMedStrength').value = med.strength || '';
      document.getElementById('editMedManufacturer').value = med.manufacturer || '';
      document.getElementById('editMedUnit').value = med.unit || 'Tablets';
      document.getElementById('editMedReorder').value = med.reorderLevel || 20;
      document.getElementById('editMedRack').value = med.rackLocation || '';
      document.getElementById('editMedPrescription').checked = Boolean(med.requiresPrescription);
      document.getElementById('editMedDesc').value = med.description || '';

      document.getElementById('editMedicineModal').classList.add('active');
    } catch (error) {
      showToast(error.message || 'Failed to load medicine details.', 'error');
    }
  },

  async deleteMedicine(medId) {
    if (!confirm('Are you sure you want to permanently delete this medicine and all its batch history?')) {
      return;
    }

    try {
      const res = await api.delete(`/medicines/${medId}`);
      if (res.success) {
        showToast('Medicine deleted successfully.', 'success');
        this.loadMedicines();
        dashboard.loadStats();
      }
    } catch (error) {
      showToast(error.message || 'Failed to delete medicine.', 'error');
    }
  },

  async populateSupplierDropdowns() {
    try {
      const res = await api.get('/suppliers');
      if (res.success) {
        const optionsHtml = '<option value="">-- Select Supplier (Optional) --</option>' +
          res.suppliers.map(s => `<option value="${s._id}">${s.name}</option>`).join('');

        const dropdowns = ['addMedSupplier', 'addBatchSupplier'];
        dropdowns.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerHTML = optionsHtml;
        });
      }
    } catch (e) {
      // suppliers might be empty or role restricted
    }
  }
};
