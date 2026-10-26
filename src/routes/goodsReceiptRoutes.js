const express = require('express');
const router = express.Router();
const {
  createGoodsReceipt,
  getGoodsReceipts,
  getGoodsReceiptById
} = require('../controllers/goodsReceiptController');
const { authenticate, authorizeRoles } = require('../middleware/auth');

router.use(authenticate);

router.route('/')
  .get(authorizeRoles('admin', 'pharmacist', 'supplier'), getGoodsReceipts)
  .post(authorizeRoles('admin', 'pharmacist'), createGoodsReceipt);

router.route('/:id')
  .get(authorizeRoles('admin', 'pharmacist', 'supplier'), getGoodsReceiptById);

module.exports = router;
