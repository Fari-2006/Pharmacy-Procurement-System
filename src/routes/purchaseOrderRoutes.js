const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const {
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  editDraftPurchaseOrder,
  submitDraftPurchaseOrder,
  cancelPurchaseOrder,
  handleAdminApproval,
  handleSupplierResponse,
  proposeChanges,
  reviewProposedChanges,
  updateShippingProgress,
  addDiscussionMessage,
  getDiscussionMessages,
  checkOpenPOs
} = require('../controllers/purchaseOrderController');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const PurchaseOrder = require('../models/PurchaseOrder');

router.use(authenticate);

// Duplicate PO warning check
router.get('/check-open', authorizeRoles('admin', 'pharmacist'), checkOpenPOs);

// Base PO list & creation
router.route('/')
  .get(authorizeRoles('admin', 'pharmacist', 'supplier'), getPurchaseOrders)
  .post(authorizeRoles('admin', 'pharmacist'), createPurchaseOrder);

// Single PO detail
router.route('/:id')
  .get(authorizeRoles('admin', 'pharmacist', 'supplier'), getPurchaseOrderById);

// Draft actions
router.put('/:id/draft', authorizeRoles('admin', 'pharmacist'), editDraftPurchaseOrder);
router.post('/:id/submit', authorizeRoles('admin', 'pharmacist'), submitDraftPurchaseOrder);
router.put('/:id/cancel', authorizeRoles('admin', 'pharmacist'), cancelPurchaseOrder);

// Admin approval
router.put('/:id/admin-approval', authorizeRoles('admin'), handleAdminApproval);

// Supplier lifecycle responses
router.put('/:id/supplier-response', authorizeRoles('supplier', 'admin'), handleSupplierResponse);
router.put('/:id/propose-changes', authorizeRoles('supplier', 'admin'), proposeChanges);
router.put('/:id/review-proposed-changes', authorizeRoles('admin', 'pharmacist'), reviewProposedChanges);
router.put('/:id/shipping', authorizeRoles('supplier', 'admin'), updateShippingProgress);

// Order discussion
router.route('/:id/discussion')
  .get(authorizeRoles('admin', 'pharmacist', 'supplier'), getDiscussionMessages)
  .post(authorizeRoles('admin', 'pharmacist', 'supplier'), addDiscussionMessage);

// Upload order attachment
router.post('/:id/attachments', authorizeRoles('admin', 'pharmacist', 'supplier'), upload.single('attachment'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || po.supplier.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    po.attachments.push({
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user._id,
      uploadedAt: new Date()
    });

    await po.save();

    res.json({
      success: true,
      message: 'Attachment uploaded successfully.',
      attachment: po.attachments[po.attachments.length - 1]
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
