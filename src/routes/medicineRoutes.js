const express = require('express');
const router = express.Router();
const {
  getMedicines,
  getMedicineById,
  createMedicine,
  updateMedicine,
  addBatch,
  adjustStock,
  deleteMedicine,
  getAlerts
} = require('../controllers/medicineController');
const { authenticate, authorizeRoles } = require('../middleware/auth');

router.use(authenticate, authorizeRoles('admin', 'pharmacist', 'cashier'));

// Alerts route
router.get('/alerts', authorizeRoles('admin', 'pharmacist'), getAlerts);

// Main medicine routes
router.route('/')
  .get(getMedicines)
  .post(authorizeRoles('admin', 'pharmacist'), createMedicine);

router.route('/:id')
  .get(getMedicineById)
  .put(authorizeRoles('admin', 'pharmacist'), updateMedicine)
  .delete(authorizeRoles('admin'), deleteMedicine);

// Batch management routes
router.post('/:id/batches', authorizeRoles('admin', 'pharmacist'), addBatch);
router.post('/:id/batches/:batchId/adjust', authorizeRoles('admin', 'pharmacist'), adjustStock);

module.exports = router;
