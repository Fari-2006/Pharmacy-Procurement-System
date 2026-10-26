const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const {
  createReturnRequest,
  getReturns,
  getReturnById,
  updateReturnStatus,
  resolveReturn
} = require('../controllers/supplierReturnController');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const SupplierReturn = require('../models/SupplierReturn');

router.use(authenticate);

router.route('/')
  .get(authorizeRoles('admin', 'pharmacist', 'supplier'), getReturns)
  .post(authorizeRoles('admin', 'pharmacist'), createReturnRequest);

router.route('/:id')
  .get(authorizeRoles('admin', 'pharmacist', 'supplier'), getReturnById);

router.put('/:id/status', authorizeRoles('admin', 'pharmacist', 'supplier'), updateReturnStatus);
router.put('/:id/resolve', authorizeRoles('admin', 'pharmacist', 'supplier'), resolveReturn);

// Upload return attachment
router.post('/:id/attachments', authorizeRoles('admin', 'pharmacist', 'supplier'), upload.single('attachment'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

    const ret = await SupplierReturn.findById(req.params.id);
    if (!ret) return res.status(404).json({ success: false, message: 'Return record not found.' });

    if (req.user.role === 'supplier' && (!req.user.supplierCompany || ret.supplier.toString() !== req.user.supplierCompany.toString())) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    ret.attachments.push({
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user._id,
      uploadedAt: new Date()
    });

    await ret.save();

    res.json({ success: true, message: 'Attachment uploaded.', attachment: ret.attachments[ret.attachments.length - 1] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
