const Medicine = require('../models/Medicine');
const Sale = require('../models/Sale');
const AuditLog = require('../models/AuditLog');

// @desc    Get dashboard metrics & summary
// @route   GET /api/dashboard/stats
// @access  Private
const getDashboardStats = async (req, res, next) => {
  try {
    const medicines = await Medicine.find().lean();
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    let totalUnits = 0;
    let inventoryCostValue = 0;
    let inventoryRetailValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let expiredBatchesCount = 0;
    let expiring30DaysCount = 0;

    const categoryMap = {};

    medicines.forEach(med => {
      let medActiveUnits = 0;

      med.batches.forEach(b => {
        const exp = new Date(b.expiryDate);
        if (exp < now) {
          expiredBatchesCount++;
        } else if (b.quantity > 0) {
          if (exp <= in30Days) {
            expiring30DaysCount++;
          }
          medActiveUnits += b.quantity;
          inventoryCostValue += (b.costPrice || 0) * b.quantity;
          inventoryRetailValue += (b.sellingPrice || 0) * b.quantity;
        }
      });

      totalUnits += medActiveUnits;

      if (medActiveUnits === 0) {
        outOfStockCount++;
      } else if (medActiveUnits <= (med.reorderLevel || 20)) {
        lowStockCount++;
      }

      // Category breakdown
      const cat = med.category || 'Other';
      categoryMap[cat] = (categoryMap[cat] || 0) + medActiveUnits;
    });

    // Today's Sales
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const todaySales = await Sale.find({
      createdAt: { $gte: startOfToday, $lte: endOfToday }
    });

    const todayRevenue = todaySales.reduce((acc, s) => acc + (s.grandTotal || 0), 0);
    const todayInvoiceCount = todaySales.length;

    // This Month's Sales
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthSales = await Sale.find({
      createdAt: { $gte: startOfMonth }
    });
    const monthRevenue = monthSales.reduce((acc, s) => acc + (s.grandTotal || 0), 0);

    // Recent 5 Sales
    const recentSales = await Sale.find()
      .populate('dispensedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(5);

    // Recent 6 Audit Logs
    const recentLogs = await AuditLog.find()
      .sort({ createdAt: -1 })
      .limit(6);

    res.json({
      success: true,
      stats: {
        totalMedicines: medicines.length,
        totalUnits,
        inventoryCostValue: Number(inventoryCostValue.toFixed(2)),
        inventoryRetailValue: Number(inventoryRetailValue.toFixed(2)),
        lowStockCount,
        outOfStockCount,
        expiredBatchesCount,
        expiring30DaysCount,
        todayRevenue: Number(todayRevenue.toFixed(2)),
        todayInvoiceCount,
        monthRevenue: Number(monthRevenue.toFixed(2)),
        categoryBreakdown: categoryMap,
        recentSales,
        recentLogs
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboardStats };
