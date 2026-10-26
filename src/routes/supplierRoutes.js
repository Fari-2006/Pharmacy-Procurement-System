const express = require('express');
const router = express.Router();
const {
  getSuppliers,
  getMyCompanyProfile,
  updateMyCompanyProfile,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierPerformance
} = require('../controllers/supplierController');
const { authenticate, authorizeRoles } = require('../middleware/auth');

router.use(authenticate);

// Supplier self-service company profile
router.route('/my-company')
  .get(authorizeRoles('supplier'), getMyCompanyProfile)
  .put(authorizeRoles('supplier'), updateMyCompanyProfile);

// Performance analytics (Admin & Pharmacist)
router.get('/performance', authorizeRoles('admin', 'pharmacist'), getSupplierPerformance);

// General supplier catalog routes
router.route('/')
  .get(authorizeRoles('admin', 'pharmacist'), getSuppliers)
  .post(authorizeRoles('admin', 'pharmacist'), createSupplier);

router.route('/:id')
  .get(authorizeRoles('admin', 'pharmacist'), getSupplierById)
  .put(authorizeRoles('admin', 'pharmacist'), updateSupplier)
  .delete(authorizeRoles('admin'), deleteSupplier);

module.exports = router;
