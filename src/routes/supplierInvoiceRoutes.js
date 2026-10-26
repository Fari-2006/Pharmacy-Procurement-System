const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const {
  createInvoice,
  getInvoices,
  getInvoiceById,
  recordPayment,
  applyCreditNote
} = require('../controllers/supplierInvoiceController');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const SupplierInvoice = require('../models/SupplierInvoice');

router.use(authenticate);

router.route('/')
  .get(authorizeRoles('admin', 'pharmacist', 'supplier'), getInvoices)
  .post(authorizeRoles('admin', 'pharmacist'), createInvoice);

router.route('/:id')
  .get(authorizeRoles('admin', 'pharmacist', 'supplier'), getInvoiceById);

// Payment recording & credit note application (Restricted strictly to pharmacy staff!)
router.post('/:id/payments', authorizeRoles('admin', 'pharmacist'), recordPayment);
router.post('/:id/apply-credit', authorizeRoles('admin', 'pharmacist'), applyCreditNote);

// Upload invoice attachment
router.post('/:id/attachments', authorizeRoles('admin', 'pharmacist', 'supplier'), upload.single('attachment'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

    const inv = await SupplierInvoice.findById(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || inv.supplier.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    inv.attachments.push({
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user._id,
      uploadedAt: new Date()
    });

    await inv.save();

    res.json({ success: true, message: 'Invoice attachment uploaded.', attachment: inv.attachments[inv.attachments.length - 1] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
