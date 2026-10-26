const path = require('path');
const fs = require('fs');
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const PurchaseOrder = require('../models/PurchaseOrder');
const GoodsReceipt = require('../models/GoodsReceipt');
const SupplierReturn = require('../models/SupplierReturn');
const SupplierInvoice = require('../models/SupplierInvoice');

// @desc    Download / stream protected attachment
// @route   GET /api/attachments/:filename
// @access  Private (Admin, Pharmacist, or Assigned Supplier)
router.get('/:filename', authenticate, async (req, res, next) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(__dirname, '..', '..', 'uploads', 'attachments', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Attachment file not found'
      });
    }

    // Cashiers are strictly blocked
    if (req.user.role === 'cashier') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Cashiers do not have permission to view procurement attachments.'
      });
    }

    // If Supplier, verify ownership of the linked document
    if (req.user.role === 'supplier') {
      if (!req.user.supplierCompany) {
        return res.status(403).json({
          success: false,
          message: 'Supplier account is not linked to any company.'
        });
      }

      const supplierId = req.user.supplierCompany.toString();

      // Check across POs, Receipts, Returns, Invoices
      const isOwnerPO = await PurchaseOrder.exists({
        supplier: supplierId,
        'attachments.filename': filename
      });
      const isOwnerReceipt = await GoodsReceipt.exists({
        supplier: supplierId,
        'attachments.filename': filename
      });
      const isOwnerReturn = await SupplierReturn.exists({
        supplier: supplierId,
        'attachments.filename': filename
      });
      const isOwnerInvoice = await SupplierInvoice.exists({
        supplier: supplierId,
        'attachments.filename': filename
      });

      if (!isOwnerPO && !isOwnerReceipt && !isOwnerReturn && !isOwnerInvoice) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to access attachments belonging to other companies.'
        });
      }
    }

    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
