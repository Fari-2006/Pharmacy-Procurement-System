// Dashboard Overview Module
const dashboard = {
  async loadStats() {
    try {
      const res = await api.get('/dashboard/stats');
      if (res.success) {
        this.renderMetrics(res.stats);
        this.renderBanners(res.stats);
        this.renderRecentSales(res.stats.recentSales);
        this.renderAuditLogs(res.stats.recentLogs);
        this.renderCategories(res.stats.categoryBreakdown);
      }
    } catch (error) {
      console.error('Failed to load dashboard metrics:', error);
    }
  },

  renderMetrics(stats) {
    document.getElementById('metricTotalMedicines').textContent = stats.totalMedicines;
    document.getElementById('metricTotalUnits').textContent = stats.totalUnits.toLocaleString();
    document.getElementById('metricCostValuation').textContent = `$${stats.inventoryCostValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById('metricTodaySales').textContent = `$${stats.todayRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById('metricLowStockCount').textContent = stats.lowStockCount + stats.outOfStockCount;
    document.getElementById('metricExpiringCount').textContent = stats.expiring30DaysCount + stats.expiredBatchesCount;

    // Update alerts count in sidebar/header badge
    const totalAlerts = stats.lowStockCount + stats.outOfStockCount + stats.expiring30DaysCount + stats.expiredBatchesCount;
    const badgeEl = document.getElementById('headerAlertsBadge');
    if (badgeEl) {
      badgeEl.textContent = totalAlerts;
      badgeEl.style.display = totalAlerts > 0 ? 'inline-flex' : 'none';
    }
  },

  renderBanners(stats) {
    const container = document.getElementById('dashboardAlertsBanner');
    if (!container) return;
    container.innerHTML = '';

    if (stats.expiredBatchesCount > 0) {
      const banner = document.createElement('div');
      banner.className = 'alert-banner critical';
      banner.innerHTML = `
        <div class="alert-left">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span><strong>Urgent Attention:</strong> ${stats.expiredBatchesCount} batch(es) have expired and must be quarantined or disposed!</span>
        </div>
        <button onclick="alertsManager.openModal('expired')">Review Expired</button>
      `;
      container.appendChild(banner);
    }

    if (stats.expiring30DaysCount > 0) {
      const banner = document.createElement('div');
      banner.className = 'alert-banner warning';
      banner.innerHTML = `
        <div class="alert-left">
          <i class="fa-solid fa-clock"></i>
          <span><strong>Near Expiry:</strong> ${stats.expiring30DaysCount} batch(es) will expire within the next 30 days. Recommend FEFO dispensing.</span>
        </div>
        <button onclick="alertsManager.openModal('expiring')">View Items</button>
      `;
      container.appendChild(banner);
    }

    if (stats.lowStockCount > 0 || stats.outOfStockCount > 0) {
      const banner = document.createElement('div');
      banner.className = 'alert-banner warning';
      banner.innerHTML = `
        <div class="alert-left">
          <i class="fa-solid fa-boxes-stacked"></i>
          <span><strong>Stock Warning:</strong> ${stats.lowStockCount} medicines are below reorder threshold and ${stats.outOfStockCount} are out of stock.</span>
        </div>
        <button onclick="window.appRouter.navigateTo('inventory', { status: 'low_stock' })">Reorder Stock</button>
      `;
      container.appendChild(banner);
    }
  },

  renderRecentSales(sales) {
    const tbody = document.getElementById('dashboardRecentSalesTable');
    if (!tbody) return;

    if (!sales || sales.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No recent sales records.</td></tr>';
      return;
    }

    tbody.innerHTML = sales.map(s => `
      <tr>
        <td><strong>${s.invoiceNumber}</strong></td>
        <td>${s.customerName}</td>
        <td><span class="badge badge-info">${s.items.length} item(s)</span></td>
        <td><strong>$${s.grandTotal.toFixed(2)}</strong></td>
        <td><small class="text-muted">${new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></td>
      </tr>
    `).join('');
  },

  renderAuditLogs(logs) {
    const container = document.getElementById('dashboardAuditLogs');
    if (!container) return;

    if (!logs || logs.length === 0) {
      container.innerHTML = '<p class="text-muted text-center py-3">No recent activities logged.</p>';
      return;
    }

    container.innerHTML = logs.map(log => {
      let icon = 'fa-arrow-right';
      let badgeClass = 'badge-info';

      if (log.action === 'STOCK_IN') {
        icon = 'fa-plus';
        badgeClass = 'badge-success';
      } else if (log.action === 'SALE_DISPENSED') {
        icon = 'fa-cart-shopping';
        badgeClass = 'badge-info';
      } else if (log.action.includes('DISPOSAL') || log.action.includes('DELETED')) {
        icon = 'fa-trash';
        badgeClass = 'badge-danger';
      } else if (log.action.includes('ADJUSTMENT')) {
        icon = 'fa-sliders';
        badgeClass = 'badge-warning';
      }

      return `
        <div style="display:flex; align-items:flex-start; gap:12px; padding:10px 0; border-bottom:1px solid #f1f5f9;">
          <div style="width:28px; height:28px; border-radius:50%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; font-size:12px; color:#475569; flex-shrink:0;">
            <i class="fa-solid ${icon}"></i>
          </div>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
              <span class="badge ${badgeClass}" style="font-size:0.68rem;">${log.action.replace('_', ' ')}</span>
              <small style="color:#94a3b8; font-size:0.75rem;">${new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
            </div>
            <p style="font-size:0.83rem; margin:0; color:#334155; word-break:break-word;">${log.details || ''}</p>
            <small style="color:#64748b; font-size:0.75rem;">By: ${log.userName || 'System'}</small>
          </div>
        </div>
      `;
    }).join('');
  },

  renderCategories(categoryMap) {
    const container = document.getElementById('dashboardCategoryList');
    if (!container) return;

    if (!categoryMap || Object.keys(categoryMap).length === 0) {
      container.innerHTML = '<p class="text-muted text-center">No inventory category data.</p>';
      return;
    }

    const totalUnits = Object.values(categoryMap).reduce((a, b) => a + b, 0) || 1;
    const sorted = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);

    container.innerHTML = sorted.map(([cat, units]) => {
      const pct = Math.round((units / totalUnits) * 100);
      return `
        <div style="margin-bottom: 12px;">
          <div style="display:flex; justify-content:space-between; font-size:0.82rem; margin-bottom:4px;">
            <span style="font-weight:600; color:#334155;">${cat}</span>
            <span style="color:#64748b;">${units} units (${pct}%)</span>
          </div>
          <div style="width:100%; height:6px; background:#f1f5f9; border-radius:3px; overflow:hidden;">
            <div style="width:${pct}%; height:100%; background:var(--primary); border-radius:3px;"></div>
          </div>
        </div>
      `;
    }).join('');
  }
};
