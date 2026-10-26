const SupplierReturn=require('../models/SupplierReturn');
const GoodsReceipt=require('../models/GoodsReceipt');
const Medicine=require('../models/Medicine');
const Supplier=require('../models/Supplier');
const {sendNotification}=require('./notificationController');
const {atomic,number,fail,serial,audit}=require('../services/workflow');
const createReturnRequest=async(req,res,next)=>{try{
 const {medicineId,batchId,batchNumber,supplierId,goodsReceiptId,reason,notes}=req.body;
 const qty=number(req.body.quantity,'return quantity',{integer:true,positive:true});
 const ret=await atomic(async session=>{
  const med=await Medicine.findById(medicineId).session(session);if(!med)fail('Medicine not found.',404);
  const matches=med.batches.filter(b=>batchId?String(b._id)===batchId:b.batchNumber===String(batchNumber).trim().toUpperCase());
  if(matches.length!==1)fail('Select the exact batch ID; batch number is missing or ambiguous.');
  const batch=matches[0];if(batch.status==='quarantined'||batch.quantity<qty)fail('Insufficient available stock in batch.');
  const supplier=await Supplier.findById(batch.supplier||supplierId).session(session);if(!supplier)fail('Supplier not found.');
  if(supplierId&&String(supplier._id)!==supplierId)fail('Supplier does not match source batch.');
  const receiptId=batch.goodsReceipt||goodsReceiptId;
  const receipt=receiptId?await GoodsReceipt.findOne({_id:receiptId,supplier:supplier._id,'items.medicine':med._id}).session(session):null;
  if(!receipt)fail('Select a source goods receipt for this supplier and batch.');
  if(!receipt.items.some(i=>String(i.medicine)===String(med._id)&&i.batches.some(b=>b.batchNumber===batch.batchNumber)))fail('Batch is not in source receipt.');
  const policy=supplier.returnPolicy;
  if(reason==='Near Expiry'&&(!policy?.acceptsNearExpiryReturns||(+batch.expiryDate-Date.now())/86400000<(policy.minimumDaysBeforeExpiry||0)))fail('This batch is not eligible under the supplier near-expiry policy.');
  if(reason==='Damaged / Defective'&&!policy?.acceptsDamagedReturns)fail('Supplier does not accept damaged returns.');
  const ret=new SupplierReturn({returnNumber:serial('RET'),medicine:med._id,medicineName:med.name,supplier:supplier._id,goodsReceipt:receipt._id,purchaseOrder:receipt.purchaseOrder,batchNumber:batch.batchNumber,sourceBatchId:batch._id,quantity:qty,unitCost:batch.costPrice,totalValue:qty*batch.costPrice,reason,requestedBy:req.user._id,statusHistory:[{status:'Requested',changedBy:req.user._id,changedByName:req.user.name,notes}]});
  batch.quantity-=qty;
  med.batches.push({batchNumber:batch.batchNumber,mfgDate:batch.mfgDate,expiryDate:batch.expiryDate,costPrice:batch.costPrice,sellingPrice:batch.sellingPrice,initialQuantity:qty,quantity:qty,supplier:supplier._id,goodsReceipt:receipt._id,returnReference:ret._id,rackLocation:'Quarantine / Returns',status:'quarantined'});
  ret.quarantineBatchId=med.batches[med.batches.length-1]._id;
  await med.save({session});await ret.save({session});await audit(req,'RETURN_REQUESTED',ret.returnNumber+' quarantined '+qty+' units',session);
  return ret;
 });
 await sendNotification({recipientRole:'supplier',recipientSupplier:ret.supplier,title:'Return requested',message:ret.returnNumber+' — '+ret.medicineName,link:String(ret._id),type:'return'});
 res.status(201).json({success:true,supplierReturn:ret});
}catch(e){next(e)}};
const updateReturnStatus=async(req,res,next)=>{try{
 const {status,notes}=req.body;
 const result=await atomic(async session=>{
  const ret=await SupplierReturn.findById(req.params.id).session(session);if(!ret)fail('Return not found.',404);
  if(req.user.role==='supplier'&&String(ret.supplier)!==String(req.user.supplierCompany))fail('Return not found.',404);
  const allowed={Requested:['Approved','Rejected'],Approved:['Sent Back'],'Sent Back':['Supplier Received']};
  if(!allowed[ret.status]?.includes(status))fail('Invalid return transition.');
  if(req.user.role==='supplier'&&status==='Sent Back')fail('Only pharmacy staff can send goods back.',403);
  if(req.user.role==='pharmacist'&&status!=='Sent Back')fail('Supplier must review and acknowledge the return.',403);
  if(status==='Rejected'&&!notes?.trim())fail('A rejection reason is required.');
  if(status==='Sent Back'){
   const med=await Medicine.findById(ret.medicine).session(session),batch=med?.batches.id(ret.quarantineBatchId);
   if(!batch||batch.quantity!==ret.quantity)fail('Quarantine quantity does not match return.');
   batch.quantity=0;await med.save({session});
  }
  // Rejected returns remain quarantined. Staff must inspect/dispose them; never automatically resell damaged drugs.
  ret.status=status;ret.statusHistory.push({status,changedBy:req.user._id,changedByName:req.user.name,notes:notes||''});await ret.save({session});await audit(req,'RETURN_STATUS_UPDATED',ret.returnNumber+' → '+status,session);return ret;
 });
 await sendNotification({recipientRole:req.user.role==='supplier'?'pharmacist':'supplier',recipientSupplier:req.user.role==='supplier'?undefined:result.supplier,title:'Return '+status,message:result.returnNumber,link:String(result._id),type:'return'});
 res.json({success:true,return:result});
}catch(e){next(e)}};
const resolveReturn=async(req,res,next)=>{try{
 if(req.user.role==='pharmacist')fail('Supplier or admin must confirm resolution.',403);
 const ret=await SupplierReturn.findById(req.params.id);if(!ret)fail('Return not found.',404);
 if(req.user.role==='supplier'&&String(ret.supplier)!==String(req.user.supplierCompany))fail('Return not found.',404);
 if(ret.status!=='Supplier Received')fail('Supplier must acknowledge returned goods before resolution.');
 if(!['Credit Note','Replacement','Refund'].includes(req.body.resolution))fail('Choose a valid resolution.');
 if(req.body.resolution==='Credit Note'&&!req.body.creditNoteReference?.trim())fail('Credit note reference is required.');
 ret.status='Resolved';ret.resolution=req.body.resolution;ret.creditNoteReference=req.body.creditNoteReference||'';
 ret.statusHistory.push({status:'Resolved',changedBy:req.user._id,changedByName:req.user.name,notes:req.body.notes||ret.resolution});await ret.save();await audit(req,'RETURN_RESOLVED',ret.returnNumber+' via '+ret.resolution);
 await sendNotification({recipientRole:'pharmacist',title:'Return resolved',message:ret.returnNumber+' via '+ret.resolution,link:String(ret._id),type:'return'});
 res.json({success:true,return:ret});
}catch(e){next(e)}};

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


module.exports={createReturnRequest,getReturns,getReturnById,updateReturnStatus,resolveReturn};
