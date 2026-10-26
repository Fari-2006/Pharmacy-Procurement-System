// Sales Invoices History Module
const salesHistory = {
  sales: [],

  async loadSales() {
    const search = document.getElementById('salesSearchInput')?.value || '';
    const startDate = document.getElementById('salesStartDate')?.value || '';
    const endDate = document.getElementById('salesEndDate')?.value || '';

    try {
      let query = '?page=1&limit=50';
      if (search) query += `&search=${encodeURIComponent(search)}`;
      if (startDate) query += `&startDate=${encodeURIComponent(startDate)}`;
      if (endDate) query += `&endDate=${encodeURIComponent(endDate)}`;

      const res = await api.get(`/sales${query}`);
      if (res.success) {
        this.sales = res.sales;
        this.renderTable(this.sales);
      }
    } catch (error) {
      showToast(error.message || 'Failed to load sales history.', 'error');
    }
  },

  renderTable(list) {
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) return;

    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No sales records found.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(s => {
      let payBadge = 'badge-success';
      if (s.paymentMethod === 'card') payBadge = 'badge-info';
      if (s.paymentMethod === 'upi') payBadge = 'badge-warning';

      return `
        <tr>
          <td><strong>${s.invoiceNumber}</strong></td>
          <td>
            <div>${s.customerName}</div>
            ${s.customerPhone ? `<small class="text-muted">${s.customerPhone}</small>` : ''}
          </td>
          <td><span class="badge badge-gray">${s.items.length} item(s)</span></td>
          <td><strong>₹${s.grandTotal.toFixed(2)}</strong></td>
          <td><span class="badge ${payBadge}">${s.paymentMethod.toUpperCase()}</span></td>
          <td>${s.dispensedBy?.name || 'Staff'}</td>
          <td><small class="text-muted">${new Date(s.createdAt).toLocaleString()}</small></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="salesHistory.viewInvoice('${s._id}')" title="View & Print Invoice">
              <i class="fa-solid fa-receipt"></i> Receipt
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  async viewInvoice(saleId) {
    try {
      const res = await api.get(`/sales/${saleId}`);
      if (res.success && res.sale) {
        pos.showReceiptModal(res.sale);
      }
    } catch (error) {
      showToast(error.message || 'Failed to fetch invoice details.', 'error');
    }
  }
};
