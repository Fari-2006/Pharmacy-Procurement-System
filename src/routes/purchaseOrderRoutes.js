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

router.get('/summary', authorizeRoles('admin','pharmacist','supplier'), require('../controllers/portalController').summary);
// Duplicate PO warning check
router.get('/check-open', authorizeRoles('admin', 'pharmacist'), checkOpenPOs);

// Base PO list & creation
router.route('/')
  .get(authorizeRoles('admin', 'pharmacist', 'supplier'), getPurchaseOrders)
  .post(authorizeRoles('admin', 'pharmacist'), createPurchaseOrder);

router.use('/:id', async (req,res,next)=>{try{
 if(req.user.role==='supplier'){
  const order=await PurchaseOrder.findOne({_id:req.params.id,supplier:req.user.supplierCompany,status:{$nin:['Draft','Pending Admin Approval']}});
  if(!order)return res.status(404).json({success:false,message:'Order not found.'});
 }
 next();
}catch(e){next(e)}});
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

module.exports = router;
