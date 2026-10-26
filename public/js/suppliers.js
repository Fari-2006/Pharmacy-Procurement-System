// Supplier Management Module
const suppliersManager = {
  suppliers: [],

  async loadSuppliers() {
    try {
      const res = await api.get('/suppliers');
      if (res.success) {
        this.suppliers = res.suppliers;
        this.renderTable(this.suppliers);
      }
    } catch (error) {
      showToast(error.message || 'Failed to load suppliers.', 'error');
    }
  },

  renderTable(list) {
    const tbody = document.getElementById('suppliersTableBody');
    if (!tbody) return;

    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No suppliers recorded. Click "Add Supplier" to register one.</td></tr>';
      return;
    }

    const isAdmin = auth.hasRole('admin');

    tbody.innerHTML = list.map(sup => `
      <tr>
        <td><strong>${sup.name}</strong></td>
        <td>${sup.contactPerson || '-'}</td>
        <td>
          <div>${sup.email ? `<i class="fa-solid fa-envelope text-muted"></i> ${sup.email}` : ''}</div>
          <div>${sup.phone ? `<i class="fa-solid fa-phone text-muted"></i> ${sup.phone}` : ''}</div>
        </td>
        <td><small>${sup.address || '-'}</small></td>
        <td>
          ${(sup.suppliedCategories || []).map(c => `<span class="badge badge-gray" style="margin:2px;">${c}</span>`).join('') || '-'}
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-secondary btn-sm" onclick="suppliersManager.openEditModal('${sup._id}')" title="Edit">
              <i class="fa-solid fa-pen"></i>
            </button>
            ${isAdmin ? `
              <button class="btn btn-danger btn-sm" onclick="suppliersManager.deleteSupplier('${sup._id}')" title="Delete">
                <i class="fa-solid fa-trash"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  },

  openAddModal() {
    document.getElementById('addSupplierForm').reset();
    document.getElementById('addSupplierModal').classList.add('active');
  },

  openEditModal(id) {
    const sup = this.suppliers.find(s => s._id === id);
    if (!sup) return;

    document.getElementById('editSupplierId').value = sup._id;
    document.getElementById('editSupplierName').value = sup.name;
    document.getElementById('editSupplierContact').value = sup.contactPerson || '';
    document.getElementById('editSupplierEmail').value = sup.email || '';
    document.getElementById('editSupplierPhone').value = sup.phone || '';
    document.getElementById('editSupplierAddress').value = sup.address || '';
    document.getElementById('editSupplierCategories').value = (sup.suppliedCategories || []).join(', ');
    document.getElementById('editSupplierNotes').value = sup.notes || '';

    document.getElementById('editSupplierModal').classList.add('active');
  },

  async deleteSupplier(id) {
    if (!confirm('Are you sure you want to delete this supplier?')) return;

    try {
      const res = await api.delete(`/suppliers/${id}`);
      if (res.success) {
        showToast('Supplier deleted.', 'success');
        this.loadSuppliers();
      }
    } catch (error) {
      showToast(error.message || 'Failed to delete supplier.', 'error');
    }
  }
};
