const express = require('express');
const router = express.Router();
const { createSale, getSales, getSaleById } = require('../controllers/saleController');
const { authenticate, authorizeRoles } = require('../middleware/auth');

router.use(authenticate, authorizeRoles('admin', 'pharmacist', 'cashier'));

router.route('/')
  .get(getSales)
  .post(createSale);

router.route('/:id')
  .get(getSaleById);

module.exports = router;
