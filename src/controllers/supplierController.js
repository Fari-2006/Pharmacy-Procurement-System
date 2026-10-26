const Supplier = require('../models/Supplier');
const PurchaseOrder = require('../models/PurchaseOrder');
const GoodsReceipt = require('../models/GoodsReceipt');
const SupplierReturn = require('../models/SupplierReturn');
const AuditLog = require('../models/AuditLog');

// @desc    Get all suppliers
// @route   GET /api/suppliers
// @access  Private (Admin, Pharmacist)
const getSuppliers = async (req, res, next) => {
  try {
    const suppliers = await Supplier.find().sort({ name: 1 });
    res.json({
      success: true,
      count: suppliers.length,
      suppliers
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get logged-in supplier's own company profile
// @route   GET /api/suppliers/my-company
// @access  Private (Supplier role)
const getMyCompanyProfile = async (req, res, next) => {
  try {
    if (req.user.role !== 'supplier' || !req.user.supplierCompany) {
      return res.status(403).json({ success: false, message: 'Only linked supplier accounts can access company profile.' });
    }

    const supplier = await Supplier.findById(req.user.supplierCompany);
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier company record not found.' });
    }

    res.json({ success: true, supplier });
  } catch (error) {
    next(error);
  }
};

// @desc    Update logged-in supplier's own company profile
// @route   PUT /api/suppliers/my-company
// @access  Private (Supplier role)
const updateMyCompanyProfile = async (req, res, next) => {
  try {
    if (req.user.role !== 'supplier' || !req.user.supplierCompany) {
      return res.status(403).json({ success: false, message: 'Only linked supplier accounts can update company profile.' });
    }

    const supplier = await Supplier.findById(req.user.supplierCompany);
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier company record not found.' });
    }

    const { contactPerson, email, phone, address, leadTimeDays, bankDetails, returnPolicy } = req.body;
    if (contactPerson) supplier.contactPerson = contactPerson;
    if (email) supplier.email = email;
    if (phone) supplier.phone = phone;
    if (address) supplier.address = address;
    if (leadTimeDays !== undefined) supplier.leadTimeDays = Number(leadTimeDays) || 5;

    if (bankDetails && typeof bankDetails === 'object') {
      supplier.bankDetails = {
        accountName: bankDetails.accountName || supplier.bankDetails?.accountName || '',
        accountNumber: bankDetails.accountNumber || supplier.bankDetails?.accountNumber || '',
        ifscCode: bankDetails.ifscCode || supplier.bankDetails?.ifscCode || '',
        bankName: bankDetails.bankName || supplier.bankDetails?.bankName || '',
        upiId: bankDetails.upiId || supplier.bankDetails?.upiId || ''
      };
    }

    if (returnPolicy && typeof returnPolicy === 'object') {
      supplier.returnPolicy = {
        acceptsNearExpiryReturns: returnPolicy.acceptsNearExpiryReturns !== undefined ? Boolean(returnPolicy.acceptsNearExpiryReturns) : supplier.returnPolicy?.acceptsNearExpiryReturns,
        minimumDaysBeforeExpiry: Number(returnPolicy.minimumDaysBeforeExpiry) || supplier.returnPolicy?.minimumDaysBeforeExpiry || 45,
        acceptsDamagedReturns: returnPolicy.acceptsDamagedReturns !== undefined ? Boolean(returnPolicy.acceptsDamagedReturns) : supplier.returnPolicy?.acceptsDamagedReturns,
        policyNotes: returnPolicy.policyNotes || supplier.returnPolicy?.policyNotes || ''
      };
    }

    await supplier.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'USER_MANAGEMENT',
      details: `Supplier ${req.user.name} updated company profile for ${supplier.name}`
    });

    res.json({ success: true, message: 'Company profile updated successfully.', supplier });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single supplier
// @route   GET /api/suppliers/:id
// @access  Private (Admin, Pharmacist)
const getSupplierById = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }
    res.json({
      success: true,
      supplier
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create supplier
// @route   POST /api/suppliers
// @access  Private (Admin, Pharmacist)
const createSupplier = async (req, res, next) => {
  try {
    const {
      name,
      contactPerson,
      email,
      phone,
      address,
      suppliedCategories,
      notes,
      leadTimeDays,
      safetyStockDays,
      paymentTerms,
      bankDetails,
      returnPolicy
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name is required'
      });
    }

    const supplier = await Supplier.create({
      name,
      contactPerson,
      email,
      phone,
      address,
      suppliedCategories: Array.isArray(suppliedCategories) ? suppliedCategories : [],
      notes,
      leadTimeDays: Number(leadTimeDays) || 5,
      safetyStockDays: Number(safetyStockDays) || 7,
      paymentTerms: paymentTerms || 'Net 30',
      bankDetails: bankDetails || {},
      returnPolicy: returnPolicy || {}
    });

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'SUPPLIER_CREATED',
      details: `Created supplier: ${supplier.name}`
    });

    res.status(201).json({
      success: true,
      supplier
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update supplier
// @route   PUT /api/suppliers/:id
// @access  Private (Admin, Pharmacist)
const updateSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    res.json({
      success: true,
      supplier
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete supplier
// @route   DELETE /api/suppliers/:id
// @access  Private (Admin only)
const deleteSupplier = async (req, res, next) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // Traceability check: Do not delete if purchase orders or invoices reference this supplier
    const hasPOs = await PurchaseOrder.exists({ supplier: supplier._id });
    if (hasPOs) {
      // Deactivate instead to preserve historical audit trail
      supplier.isActive = false;
      await supplier.save();
      return res.json({
        success: true,
        message: 'Supplier has linked historical purchase orders. Company was deactivated instead of permanently deleted to preserve audit traceability.'
      });
    }

    supplier.isActive = false;
    await supplier.save();

    res.json({
      success: true,
      message: 'Supplier deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Calculate supplier performance analytics from actual database records
// @route   GET /api/suppliers/performance
// @access  Private (Admin, Pharmacist)
const getSupplierPerformance = async (req, res, next) => {
  try {
    const { supplierId } = req.query;
    let supplierQuery = {};
    if (supplierId && supplierId !== 'all') {
      supplierQuery._id = supplierId;
    }

    const suppliers = await Supplier.find(supplierQuery).select('name leadTimeDays returnPolicy');
    const performanceList = [];

    for (const sup of suppliers) {
      // 1. Fetch all POs for supplier
      const poList = await PurchaseOrder.find({ supplier: sup._id });
      const totalOrders = poList.length;

      if (totalOrders === 0) {
        performanceList.push({
          supplierId: sup._id,
          supplierName: sup.name,
          totalOrders: 0,
          deliveredOrders: 0,
          timelinessRate: null,
          avgDelayDays: 0,
          fulfillmentRate: null,
          shortageRate: null,
          rejectionRate: null,
          avgReturnResolutionDays: null,
          dataStatus: 'insufficient_data',
          explanation: 'No completed purchase orders recorded yet for this supplier.'
        });
        continue;
      }

      // Delivered / Received POs
      const completedOrDelivered = poList.filter(p => ['Delivered', 'Partially Received', 'Received'].includes(p.status) && p.shippingDetails?.deliveredAt);

      let onTimeCount = 0;
      let totalDelayDays = 0;

      completedOrDelivered.forEach(p => {
        const deliveredAt = new Date(p.shippingDetails.deliveredAt);
        const expected = new Date(p.expectedDeliveryDate);
        if (deliveredAt <= expected) {
          onTimeCount++;
        } else {
          const delayDays = Math.ceil((deliveredAt - expected) / (1000 * 60 * 60 * 24));
          totalDelayDays += Math.max(delayDays, 0);
        }
      });

      const timelinessRate = completedOrDelivered.length > 0
        ? Math.round((onTimeCount / completedOrDelivered.length) * 100)
        : null;

      const avgDelayDays = completedOrDelivered.length > 0
        ? Number((totalDelayDays / completedOrDelivered.length).toFixed(1))
        : 0;

      // 2. Fetch all GoodsReceipts for supplier
      const receipts = await GoodsReceipt.find({ supplier: sup._id });
      let totalDeliveredUnits = 0;
      let totalAcceptedUnits = 0;
      let totalRejectedUnits = 0;

      receipts.forEach(r => {
        r.items.forEach(item => {
          totalDeliveredUnits += (item.deliveredQuantity || 0);
          totalAcceptedUnits += (item.acceptedQuantity || 0);
          totalRejectedUnits += (item.rejectedQuantity || 0);
        });
      });

      // Calculate total ordered units across non-cancelled POs
      let totalOrderedUnits = 0;
      poList.filter(p => ['Delivered','Partially Received','Received'].includes(p.status)).forEach(p => {
        p.items.forEach(i => {
          totalOrderedUnits += (i.quantity || 0);
        });
      });

      const fulfillmentRate = totalOrderedUnits > 0
        ? Math.min(Math.round((totalAcceptedUnits / totalOrderedUnits) * 100), 100)
        : null;

      const shortageUnits = Math.max(totalOrderedUnits - totalDeliveredUnits, 0);
      const shortageRate = totalOrderedUnits > 0
        ? Math.round((shortageUnits / totalOrderedUnits) * 100)
        : 0;

      const rejectionRate = totalDeliveredUnits > 0
        ? Math.round((totalRejectedUnits / totalDeliveredUnits) * 100)
        : 0;

      // 3. Return Resolution Time
      const returns = await SupplierReturn.find({ supplier: sup._id });
      const resolvedReturns = returns.filter(r => r.status === 'Resolved');
      let totalResolutionDays = 0;

      resolvedReturns.forEach(r => {
        const diffDays = Math.ceil((new Date(r.updatedAt) - new Date(r.createdAt)) / (1000 * 60 * 60 * 24));
        totalResolutionDays += Math.max(diffDays, 0);
      });

      const avgReturnResolutionDays = resolvedReturns.length > 0
        ? Number((totalResolutionDays / resolvedReturns.length).toFixed(1))
        : null;

      performanceList.push({
        supplierId: sup._id,
        supplierName: sup.name,
        totalOrders,
        deliveredOrders: completedOrDelivered.length,
        timelinessRate,
        avgDelayDays,
        fulfillmentRate,
        shortageRate,
        rejectionRate,
        avgReturnResolutionDays,
        totalOrderedUnits,
        totalAcceptedUnits,
        totalRejectedUnits,
        dataStatus: 'sufficient_data',
        explanation: `Calculated from ${totalOrders} orders and ${receipts.length} receipts.`
      });
    }

    res.json({
      success: true,
      performance: performanceList
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSuppliers,
  getMyCompanyProfile,
  updateMyCompanyProfile,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierPerformance
};
