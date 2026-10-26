const Medicine = require('../models/Medicine');
const AuditLog = require('../models/AuditLog');
const PurchaseOrder = require('../models/PurchaseOrder');
const Sale = require('../models/Sale');
const SystemSetting = require('../models/SystemSetting');
const Supplier = require('../models/Supplier');

// @desc    Get all medicines with search, category & stock status filters
// @route   GET /api/medicines
// @access  Private (Admin, Pharmacist, Cashier)
const getMedicines = async (req, res, next) => {
  try {
    const { search, category, status, sort } = req.query;
    let query = {};

    // Search by name, genericName, or manufacturer
    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: regex },
        { genericName: regex },
        { manufacturer: regex }
      ];
    }

    // Filter by Category
    if (category && category !== 'All') {
      query.category = category;
    }

    // Filter by Stock Status
    if (status && status !== 'all') {
      query.status = status;
    }

    let sortOption = { name: 1 };
    if (sort === 'stock_asc') sortOption = { totalStock: 1 };
    if (sort === 'stock_desc') sortOption = { totalStock: -1 };
    if (sort === 'updated_desc') sortOption = { updatedAt: -1 };

    const medicines = await Medicine.find(query)
      .populate('batches.supplier', 'name phone email')
      .sort(sortOption);

    // Ensure status is up to date dynamically with current date
    const now = new Date();
    medicines.forEach(med => {
      let changed = false;
      med.batches.forEach(b => {
        if (new Date(b.expiryDate) < now && b.status !== 'expired') {
          b.status = 'expired';
          changed = true;
        }
      });
      if (changed) {
        med.updateStockStatus();
        med.save();
      }
    });

    res.json({
      success: true,
      count: medicines.length,
      medicines
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single medicine by ID
// @route   GET /api/medicines/:id
// @access  Private
const getMedicineById = async (req, res, next) => {
  try {
    const medicine = await Medicine.findById(req.params.id)
      .populate('batches.supplier', 'name phone email contactPerson');

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found'
      });
    }

    res.json({
      success: true,
      medicine
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new medicine
// @route   POST /api/medicines
// @access  Private (Admin, Pharmacist)
const createMedicine = async (req, res, next) => {
  try {
    const {
      name,
      genericName,
      category,
      dosageForm,
      strength,
      manufacturer,
      unit,
      reorderLevel,
      rackLocation,
      requiresPrescription,
      description,
      initialBatch
    } = req.body;

    if (!name || !genericName) {
      return res.status(400).json({
        success: false,
        message: 'Brand name and generic name are required'
      });
    }

    const batches = [];
    if (initialBatch && initialBatch.batchNumber && initialBatch.quantity > 0) {
      batches.push({
        batchNumber: initialBatch.batchNumber.toUpperCase().trim(),
        mfgDate: initialBatch.mfgDate || null,
        expiryDate: initialBatch.expiryDate,
        costPrice: Number(initialBatch.costPrice) || 0,
        sellingPrice: Number(initialBatch.sellingPrice) || 0,
        initialQuantity: Number(initialBatch.quantity),
        quantity: Number(initialBatch.quantity),
        supplier: initialBatch.supplier || null,
        status: 'active'
      });
    }

    const medicine = new Medicine({
      name,
      genericName,
      category,
      dosageForm,
      strength,
      manufacturer,
      unit: unit || 'Tablets',
      reorderLevel: Number(reorderLevel) || 20,
      rackLocation: rackLocation || 'General Shelf',
      requiresPrescription: Boolean(requiresPrescription),
      description,
      batches
    });

    await medicine.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'MEDICINE_CREATED',
      medicine: medicine._id,
      medicineName: medicine.name,
      details: `Created medicine ${medicine.name} (${medicine.genericName}) with ${batches.length} initial batch(es)`
    });

    res.status(201).json({
      success: true,
      medicine
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update medicine details
// @route   PUT /api/medicines/:id
// @access  Private (Admin, Pharmacist)
const updateMedicine = async (req, res, next) => {
  try {
    const {
      name,
      genericName,
      category,
      dosageForm,
      strength,
      manufacturer,
      unit,
      reorderLevel,
      rackLocation,
      requiresPrescription,
      description
    } = req.body;

    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found'
      });
    }

    if (name) medicine.name = name;
    if (genericName) medicine.genericName = genericName;
    if (category) medicine.category = category;
    if (dosageForm) medicine.dosageForm = dosageForm;
    if (strength !== undefined) medicine.strength = strength;
    if (manufacturer !== undefined) medicine.manufacturer = manufacturer;
    if (unit) medicine.unit = unit;
    if (reorderLevel !== undefined) medicine.reorderLevel = Number(reorderLevel);
    if (rackLocation !== undefined) medicine.rackLocation = rackLocation;
    if (requiresPrescription !== undefined) medicine.requiresPrescription = Boolean(requiresPrescription);
    if (description !== undefined) medicine.description = description;

    await medicine.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'MEDICINE_UPDATED',
      medicine: medicine._id,
      medicineName: medicine.name,
      details: `Updated medicine details for ${medicine.name}`
    });

    res.json({
      success: true,
      medicine
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add new batch to medicine
// @route   POST /api/medicines/:id/batches
// @access  Private (Admin, Pharmacist)
const addBatch = async (req, res, next) => {
  try {
    const {
      batchNumber,
      mfgDate,
      expiryDate,
      costPrice,
      sellingPrice,
      quantity,
      supplier
    } = req.body;

    if (!batchNumber || !expiryDate || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Batch number, expiry date, and quantity are required'
      });
    }

    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found'
      });
    }

    const cleanBatchNum = batchNumber.toUpperCase().trim();
    // Check if batch number already exists for this medicine
    const existingBatch = medicine.batches.find(b => b.batchNumber === cleanBatchNum);
    if (existingBatch) {
      // Append to quantity
      existingBatch.quantity += Number(quantity);
      existingBatch.initialQuantity += Number(quantity);
      if (costPrice !== undefined) existingBatch.costPrice = Number(costPrice);
      if (sellingPrice !== undefined) existingBatch.sellingPrice = Number(sellingPrice);
      if (expiryDate) existingBatch.expiryDate = expiryDate;
      if (supplier) existingBatch.supplier = supplier;
    } else {
      medicine.batches.push({
        batchNumber: cleanBatchNum,
        mfgDate: mfgDate || null,
        expiryDate,
        costPrice: Number(costPrice) || 0,
        sellingPrice: Number(sellingPrice) || 0,
        initialQuantity: Number(quantity),
        quantity: Number(quantity),
        supplier: supplier || null,
        status: 'active'
      });
    }

    await medicine.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'STOCK_IN',
      medicine: medicine._id,
      medicineName: medicine.name,
      batchNumber: cleanBatchNum,
      quantityChange: Number(quantity),
      details: `Stock-in of ${quantity} units to batch ${cleanBatchNum}`
    });

    res.status(201).json({
      success: true,
      message: 'Batch added successfully',
      medicine
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Adjust batch stock (damage, discrepancy, disposal)
// @route   POST /api/medicines/:id/batches/:batchId/adjust
// @access  Private (Admin, Pharmacist)
const adjustStock = async (req, res, next) => {
  try {
    const { adjustmentType, quantity, reason } = req.body;
    // adjustmentType: 'add', 'deduct', 'set'

    if (!quantity || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Quantity and reason are required'
      });
    }

    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found'
      });
    }

    const batch = medicine.batches.id(req.params.batchId);
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found'
      });
    }

    const oldQty = batch.quantity;
    let newQty = oldQty;
    let qtyChange = 0;

    if (adjustmentType === 'add') {
      newQty = oldQty + Number(quantity);
      qtyChange = Number(quantity);
    } else if (adjustmentType === 'deduct') {
      if (oldQty < Number(quantity)) {
        return res.status(400).json({
          success: false,
          message: `Cannot deduct ${quantity} units. Current batch stock is only ${oldQty}.`
        });
      }
      newQty = oldQty - Number(quantity);
      qtyChange = -Number(quantity);
    } else if (adjustmentType === 'set') {
      newQty = Number(quantity);
      qtyChange = newQty - oldQty;
    }

    batch.quantity = newQty;
    await medicine.save();

    const isDisposal = reason.toLowerCase().includes('dispos') || reason.toLowerCase().includes('expir') || reason.toLowerCase().includes('damag');
    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: isDisposal ? 'STOCK_DISPOSAL' : 'STOCK_ADJUSTMENT',
      medicine: medicine._id,
      medicineName: medicine.name,
      batchNumber: batch.batchNumber,
      quantityChange: qtyChange,
      details: `Adjusted batch ${batch.batchNumber} from ${oldQty} to ${newQty}. Reason: ${reason}`
    });

    res.json({
      success: true,
      message: 'Batch stock adjusted successfully',
      medicine
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete medicine
// @route   DELETE /api/medicines/:id
// @access  Private (Admin only)
const deleteMedicine = async (req, res, next) => {
  try {
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found'
      });
    }

    await Medicine.findByIdAndDelete(req.params.id);

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'MEDICINE_DELETED',
      medicineName: medicine.name,
      details: `Deleted medicine ${medicine.name}`
    });

    res.json({
      success: true,
      message: 'Medicine deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get actionable alerts (low stock, expiring batches, suggested orders, open POs)
// @route   GET /api/medicines/alerts
// @access  Private
const getAlerts = async (req, res, next) => {
  try {
    const { expiryDays } = req.query;
    const settings = await SystemSetting.getSettings();
    const expiryWindow = Number(expiryDays) || settings.defaultExpiryAlertDays || 60;

    const medicines = await Medicine.find().populate('batches.supplier', 'name returnPolicy').lean();
    const now = new Date();
    const expiryHorizon = new Date(now.getTime() + expiryWindow * 24 * 60 * 60 * 1000);

    // 1. Fetch all open purchase orders to calculate incoming stock per medicine
    const openOrders = await PurchaseOrder.find({
      status: { $in: ['Submitted', 'Accepted', 'Changes Proposed', 'Packed', 'Dispatched', 'Delivered', 'Partially Received'] }
    }).select('poNumber status expectedDeliveryDate items supplier').populate('supplier', 'name');

    const incomingMap = {};
    const openPOMap = {};

    openOrders.forEach(po => {
      po.items.forEach(item => {
        const medIdStr = item.medicine.toString();
        const outstanding = Math.max((item.quantity || 0) - (item.receivedQuantity || 0), 0);
        incomingMap[medIdStr] = (incomingMap[medIdStr] || 0) + outstanding;

        if (!openPOMap[medIdStr]) openPOMap[medIdStr] = [];
        openPOMap[medIdStr].push({
          poNumber: po.poNumber,
          status: po.status,
          supplierName: po.supplier?.name || 'Unknown',
          expectedDeliveryDate: po.expectedDeliveryDate,
          orderedQuantity: item.quantity,
          outstandingQuantity: outstanding
        });
      });
    });

    // 2. Fetch sales over past 30 days to calculate daily demand rate
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const pastSales = await Sale.find({ createdAt: { $gte: thirtyDaysAgo } }).select('items');
    const salesMap = {};

    pastSales.forEach(s => {
      s.items.forEach(i => {
        const medIdStr = i.medicine ? i.medicine.toString() : '';
        if (medIdStr) {
          salesMap[medIdStr] = (salesMap[medIdStr] || 0) + (i.quantity || 0);
        }
      });
    });

    const lowStock = [];
    const outOfStock = [];
    const expiredBatches = [];
    const expiringSoonBatches = [];

    medicines.forEach(med => {
      const medIdStr = med._id.toString();

      // Usable stock: only active, unexpired, non-quarantined batches
      let usableStock = 0;
      let expiredBatchUnits = 0;
      let quarantinedUnits = 0;

      med.batches.forEach(b => {
        const exp = new Date(b.expiryDate);
        if (b.status === 'quarantined') {
          quarantinedUnits += b.quantity;
        } else if (exp < now || b.status === 'expired') {
          expiredBatchUnits += b.quantity;
          if (b.quantity > 0) {
            expiredBatches.push({
              medicineId: med._id,
              medicineName: med.name,
              genericName: med.genericName,
              category: med.category,
              batchNumber: b.batchNumber,
              quantity: b.quantity,
              costPrice: b.costPrice,
              expiryDate: b.expiryDate,
              supplier: b.supplier ? {
                id: b.supplier._id,
                name: b.supplier.name,
                acceptsNearExpiryReturns: b.supplier.returnPolicy?.acceptsNearExpiryReturns !== false
              } : null,
              isEligibleForReturn: true,
              daysExpired: Math.ceil((now - exp) / (1000 * 60 * 60 * 24))
            });
          }
        } else if (b.quantity > 0 && b.status === 'active') {
          usableStock += b.quantity;

          // Check if expiring within selected window
          if (exp <= expiryHorizon) {
            const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
            const supplierPolicy = b.supplier?.returnPolicy;
            const minDays = supplierPolicy?.minimumDaysBeforeExpiry || 45;
            const returnEligible = supplierPolicy ? (supplierPolicy.acceptsNearExpiryReturns && daysLeft >= minDays) : true;

            expiringSoonBatches.push({
              medicineId: med._id,
              medicineName: med.name,
              genericName: med.genericName,
              category: med.category,
              batchNumber: b.batchNumber,
              quantity: b.quantity,
              costPrice: b.costPrice,
              expiryDate: b.expiryDate,
              daysLeft,
              urgency: daysLeft <= 30 ? 'critical' : daysLeft <= 60 ? 'high' : 'medium',
              supplier: b.supplier ? {
                id: b.supplier._id,
                name: b.supplier.name,
                acceptsNearExpiryReturns: supplierPolicy?.acceptsNearExpiryReturns
              } : null,
              isEligibleForReturn: returnEligible,
              returnPolicyNotes: supplierPolicy?.policyNotes || 'Subject to distributor return window.'
            });
          }
        }
      });

      const incomingQty = incomingMap[medIdStr] || 0;
      const openPOs = openPOMap[medIdStr] || [];

      // Reorder suggestion logic
      const past30DaysSold = salesMap[medIdStr] || 0;
      const dailySalesRate = past30DaysSold / 30;

      let targetStock = 0;
      let explanation = '';

      if (dailySalesRate > 0) {
        const leadDays = 5;
        const safetyDays = 7;
        targetStock = Math.ceil(dailySalesRate * (leadDays + safetyDays));
        targetStock = Math.max(targetStock, med.reorderLevel || 20);
        const suggested = Math.max(targetStock - usableStock - incomingQty, 0);
        explanation = `Avg sales ${dailySalesRate.toFixed(1)}/day × 12d lead+safety buffer (target: ${targetStock}) - usable stock (${usableStock}) - incoming PO (${incomingQty}) = ${suggested} units`;
      } else {
        targetStock = Math.max((med.reorderLevel || 20) * 2, 30);
        const suggested = Math.max(targetStock - usableStock - incomingQty, 0);
        explanation = `Configured reorder level (${med.reorderLevel || 20}) target (${targetStock}) - usable stock (${usableStock}) - incoming PO (${incomingQty}) = ${suggested} units`;
      }

      const suggestedQuantity = Math.max(targetStock - usableStock - incomingQty, 0);

      // Preferred supplier from recent batch
      const preferredSupplier = med.batches.find(b => b.supplier)?.supplier || null;

      const alertPayload = {
        id: med._id,
        name: med.name,
        genericName: med.genericName,
        category: med.category,
        unit: med.unit || 'Strips',
        reorderLevel: med.reorderLevel || 20,
        usableStock,
        totalStock: med.totalStock,
        expiredBatchUnits,
        quarantinedUnits,
        incomingQuantity: incomingQty,
        openPOs,
        hasOpenPO: openPOs.length > 0,
        targetStock,
        suggestedQuantity,
        suggestionExplanation: explanation,
        preferredSupplier: preferredSupplier ? { id: preferredSupplier._id, name: preferredSupplier.name } : null
      };

      if (usableStock === 0) {
        outOfStock.push(alertPayload);
      } else if (usableStock <= (med.reorderLevel || 20)) {
        lowStock.push(alertPayload);
      }
    });

    expiringSoonBatches.sort((a, b) => a.daysLeft - b.daysLeft);

    res.json({
      success: true,
      currency: settings.currencySymbol || '₹',
      expiryWindowDays: expiryWindow,
      alerts: {
        lowStockCount: lowStock.length,
        outOfStockCount: outOfStock.length,
        expiredCount: expiredBatches.length,
        expiringSoonCount: expiringSoonBatches.length,
        lowStock,
        outOfStock,
        expiredBatches,
        expiringSoonBatches
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMedicines,
  getMedicineById,
  createMedicine,
  updateMedicine,
  addBatch,
  adjustStock,
  deleteMedicine,
  getAlerts
};
