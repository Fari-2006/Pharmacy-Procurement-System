const SupplierReturn = require('../models/SupplierReturn');
const Medicine = require('../models/Medicine');
const Supplier = require('../models/Supplier');
const AuditLog = require('../models/AuditLog');
const { sendNotification } = require('./notificationController');

const generateReturnNumber = async () => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let isUnique = false;
  let returnNumber = '';

  while (!isUnique) {
    const randomHex = Math.floor(1000 + Math.random() * 9000);
    returnNumber = `RET-${dateStr}-${randomHex}`;
    const exists = await SupplierReturn.exists({ returnNumber });
    if (!exists) isUnique = true;
  }
  return returnNumber;
};

// @desc    Create supplier return request
// @route   POST /api/returns
// @access  Private (Pharmacist, Admin)
const createReturnRequest = async (req, res, next) => {
  try {
    const {
      medicineId,
      batchNumber,
      quantity,
      reason,
      supplierId,
      purchaseOrderId,
      notes
    } = req.body;

    const returnQty = Number(quantity);
    if (!medicineId || !batchNumber || !returnQty || returnQty <= 0 || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Medicine, batch number, positive quantity, and reason are required.'
      });
    }

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) return res.status(404).json({ success: false, message: 'Medicine not found.' });

    const cleanBatch = batchNumber.trim().toUpperCase();
    const batch = medicine.batches.find(b => b.batchNumber === cleanBatch);
    if (!batch) {
      return res.status(404).json({ success: false, message: `Batch ${cleanBatch} not found for ${medicine.name}.` });
    }

    if (batch.quantity < returnQty) {
      return res.status(400).json({
        success: false,
        message: `Cannot return ${returnQty} units. Available stock in batch ${cleanBatch} is only ${batch.quantity}.`
      });
    }

    // Determine supplier: from payload or from batch
    const targetSupplierId = supplierId || batch.supplier;
    if (!targetSupplierId) {
      return res.status(400).json({ success: false, message: 'Supplier must be specified for this return.' });
    }

    const supplierDoc = await Supplier.findById(targetSupplierId);
    if (!supplierDoc) {
      return res.status(404).json({ success: false, message: 'Supplier record not found.' });
    }

    // Policy check: Near expiry return eligibility
    if (reason === 'Near Expiry' && supplierDoc.returnPolicy) {
      if (!supplierDoc.returnPolicy.acceptsNearExpiryReturns) {
        return res.status(400).json({
          success: false,
          message: `Supplier ${supplierDoc.name} policy states they do not accept near-expiry returns. Notes: ${supplierDoc.returnPolicy.policyNotes || 'No near-expiry returns permitted.'}`
        });
      }
    }

    // Quarantine the stock to prevent selling while return is under review
    batch.quantity -= returnQty;
    if (batch.quantity === 0) {
      batch.status = 'depleted';
    }

    // Add a quarantined batch record to keep tracking separated
    medicine.batches.push({
      batchNumber: `${cleanBatch}-RET`,
      mfgDate: batch.mfgDate,
      expiryDate: batch.expiryDate,
      costPrice: batch.costPrice,
      sellingPrice: batch.sellingPrice,
      initialQuantity: returnQty,
      quantity: returnQty,
      supplier: targetSupplierId,
      rackLocation: 'Quarantine / Returns Bay',
      status: 'quarantined'
    });

    medicine.updateStockStatus();
    await medicine.save();

    const returnNumber = await generateReturnNumber();
    const unitCost = batch.costPrice || 0;
    const totalValue = Number((returnQty * unitCost).toFixed(2));

    const supplierReturn = new SupplierReturn({
      returnNumber,
      purchaseOrder: purchaseOrderId || null,
      supplier: targetSupplierId,
      medicine: medicine._id,
      medicineName: medicine.name,
      batchNumber: cleanBatch,
      quantity: returnQty,
      unitCost,
      totalValue,
      reason,
      status: 'Requested',
      resolution: 'Pending',
      statusHistory: [
        {
          status: 'Requested',
          changedBy: req.user._id,
          changedByName: req.user.name,
          changedAt: new Date(),
          notes: notes || `Return requested for ${returnQty} units of batch ${cleanBatch}.`
        }
      ],
      requestedBy: req.user._id,
      supplierNotes: ''
    });

    await supplierReturn.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'RETURN_REQUESTED',
      medicine: medicine._id,
      medicineName: medicine.name,
      batchNumber: cleanBatch,
      quantityChange: -returnQty,
      details: `Created supplier return ${returnNumber} for ${returnQty} units to ${supplierDoc.name}. Value: ₹${totalValue}`
    });

    await sendNotification({
      recipientSupplier: targetSupplierId,
      recipientRole: 'supplier',
      title: 'Supplier Return Request',
      message: `Return request ${returnNumber} filed for ${returnQty} units of ${medicine.name} (Batch: ${cleanBatch}).`,
      link: supplierReturn._id.toString(),
      type: 'return'
    });

    res.status(201).json({
      success: true,
      message: `Return request ${returnNumber} submitted successfully. Stock moved to quarantine.`,
      supplierReturn
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all supplier returns with role scoping
// @route   GET /api/returns
// @access  Private (Admin, Pharmacist, Supplier)
const getReturns = async (req, res, next) => {
  try {
    const { status, supplierId } = req.query;
    let query = {};

    if (req.user.role === 'supplier') {
      if (!req.user.supplierCompany) {
        return res.status(403).json({ success: false, message: 'Supplier account not linked to company.' });
      }
      query.supplier = req.user.supplierCompany;
    } else if (supplierId) {
      query.supplier = supplierId;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    const returns = await SupplierReturn.find(query)
      .populate('supplier', 'name email contactPerson returnPolicy')
      .populate('requestedBy', 'name role')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: returns.length, returns });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single supplier return details
// @route   GET /api/returns/:id
// @access  Private
const getReturnById = async (req, res, next) => {
  try {
    const ret = await SupplierReturn.findById(req.params.id)
      .populate('supplier', 'name email phone contactPerson address returnPolicy')
      .populate('requestedBy', 'name role');

    if (!ret) return res.status(404).json({ success: false, message: 'Return record not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || ret.supplier._id.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    res.json({ success: true, return: ret });
  } catch (error) {
    next(error);
  }
};

// @desc    Update supplier return status (Approved/Rejected by supplier, Sent Back by pharmacist)
// @route   PUT /api/returns/:id/status
// @access  Private (Supplier, Pharmacist, Admin)
const updateReturnStatus = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required.' });

    const ret = await SupplierReturn.findById(req.params.id);
    if (!ret) return res.status(404).json({ success: false, message: 'Return record not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || ret.supplier.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    ret.status = status;
    if (notes) ret.supplierNotes = notes;

    ret.statusHistory.push({
      status,
      changedBy: req.user._id,
      changedByName: req.user.name,
      changedAt: new Date(),
      notes: notes || `Return status progressed to ${status}`
    });

    await ret.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'RETURN_STATUS_UPDATED',
      details: `Updated return ${ret.returnNumber} to status ${status}`
    });

    // Notify parties
    if (req.user.role === 'supplier') {
      await sendNotification({
        recipientRole: 'pharmacist',
        title: `Return Request ${status}`,
        message: `Supplier ${status.toLowerCase()} return ${ret.returnNumber} for ${ret.medicineName}.`,
        link: ret._id.toString(),
        type: 'return'
      });
    } else {
      await sendNotification({
        recipientSupplier: ret.supplier,
        recipientRole: 'supplier',
        title: `Return Status Update: ${status}`,
        message: `Return ${ret.returnNumber} marked as ${status}.`,
        link: ret._id.toString(),
        type: 'return'
      });
    }

    res.json({ success: true, message: `Return status updated to ${status}.`, return: ret });
  } catch (error) {
    next(error);
  }
};

// @desc    Resolve return request (Credit Note, Replacement, or Refund)
// @route   PUT /api/returns/:id/resolve
// @access  Private (Supplier, Admin, Pharmacist)
const resolveReturn = async (req, res, next) => {
  try {
    const { resolution, creditNoteReference, notes } = req.body;
    // resolution: 'Credit Note', 'Replacement', 'Refund'
    if (!resolution || !['Credit Note', 'Replacement', 'Refund'].includes(resolution)) {
      return res.status(400).json({ success: false, message: 'Valid resolution type is required.' });
    }

    const ret = await SupplierReturn.findById(req.params.id);
    if (!ret) return res.status(404).json({ success: false, message: 'Return record not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || ret.supplier.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    ret.status = 'Resolved';
    ret.resolution = resolution;
    if (creditNoteReference) ret.creditNoteReference = creditNoteReference;
    if (notes) ret.supplierNotes = (ret.supplierNotes ? ret.supplierNotes + ' | ' : '') + notes;

    ret.statusHistory.push({
      status: 'Resolved',
      changedBy: req.user._id,
      changedByName: req.user.name,
      changedAt: new Date(),
      notes: `Resolved via ${resolution}. Ref: ${creditNoteReference || 'N/A'}`
    });

    await ret.save();

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action: 'RETURN_RESOLVED',
      details: `Resolved return ${ret.returnNumber} via ${resolution}. Credit Ref: ${creditNoteReference || 'None'}`
    });

    res.json({
      success: true,
      message: `Return ${ret.returnNumber} resolved via ${resolution}.`,
      return: ret
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createReturnRequest,
  getReturns,
  getReturnById,
  updateReturnStatus,
  resolveReturn
};
