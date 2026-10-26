const crypto = require('crypto');
const GoodsReceipt = require('../models/GoodsReceipt');
const PurchaseOrder = require('../models/PurchaseOrder');
const Medicine = require('../models/Medicine');
const {sendNotification}=require('./notificationController');
const {atomic,fail,number,serial,audit}=require('../services/workflow');
const createGoodsReceipt=async(req,res,next)=>{try{
 await GoodsReceipt.init();
 const {receiptSubmissionKey,purchaseOrderId,items,deliveryReference,notes}=req.body;
 if(typeof receiptSubmissionKey!=='string'||!receiptSubmissionKey.trim())fail('A receipt submission key is required.');
 const key=receiptSubmissionKey.trim();
 const requestHash=crypto.createHash('sha256').update(JSON.stringify({purchaseOrderId,items,deliveryReference,notes})).digest('hex');
 const duplicate=async()=>{const r=await GoodsReceipt.findOne({receiptSubmissionKey:key});if(r&&r.requestHash!==requestHash)fail('Submission key already used for a different receipt.',409);return r;};
 const existing=await duplicate();if(existing)return res.json({success:true,isDuplicate:true,receipt:existing});
 if(!Array.isArray(items)||!items.length)fail('Receipt items are required.');
 let result;
 try{result=await atomic(async session=>{
  const replay=await GoodsReceipt.findOne({receiptSubmissionKey:key}).session(session);
  if(replay){if(replay.requestHash!==requestHash)fail('Submission key already used for a different receipt.',409);return {receipt:replay,isDuplicate:true};}
  const po=await PurchaseOrder.findById(purchaseOrderId).session(session);if(!po)fail('Order not found.',404);
  if(!['Dispatched','Delivered','Partially Received'].includes(po.status))fail('Order is not ready for receiving.');
  const receipt=new GoodsReceipt({receiptNumber:serial('GRN'),receiptSubmissionKey:key,requestHash,purchaseOrder:po._id,supplier:po.supplier,receivedBy:req.user._id,deliveryReference,notes,items:[]});
  const seen=new Set();
  for(const input of items){
   const id=String(input.medicineId||input.medicine);if(seen.has(id))fail('Combine duplicate medicine lines.');seen.add(id);
   const line=po.items.find(i=>String(i.medicine)===id);if(!line)fail('Medicine is not in this order.');
   const delivered=number(input.deliveredQuantity,'delivered quantity',{integer:true,positive:true}),accepted=number(input.acceptedQuantity,'accepted quantity',{integer:true}),rejected=number(input.rejectedQuantity??0,'rejected quantity',{integer:true});
   if(accepted+rejected!==delivered)fail('Accepted plus rejected must equal delivered.');
   if(accepted>line.quantity-line.receivedQuantity)fail('Accepted quantity exceeds outstanding order quantity.');
   if(rejected&&!input.rejectionReason?.trim())fail('Give a rejection reason.');
   const batches=input.batches||[];if(!Array.isArray(batches))fail('Invalid batches.');
   if(batches.reduce((n,b)=>n+number(b.quantity,'batch quantity',{integer:true,positive:true}),0)!==accepted)fail('Batch quantities must equal accepted units.');
   const med=await Medicine.findById(id).session(session);if(!med)fail('Medicine no longer exists.',404);
   const verified=batches.map(b=>{
    const exp=new Date(b.expiryDate),mfg=b.mfgDate?new Date(b.mfgDate):undefined;
    if(!b.batchNumber?.trim()||!Number.isFinite(+exp)||exp<=new Date()||(mfg&&(!Number.isFinite(+mfg)||mfg>exp||mfg>new Date())))fail('Invalid batch number or manufacturing/expiry dates.');
    return {batchNumber:b.batchNumber.trim().toUpperCase(),expiryDate:exp,mfgDate:mfg,costPrice:number(b.costPrice,'purchase cost'),sellingPrice:number(b.sellingPrice,'selling price'),quantity:number(b.quantity,'batch quantity',{integer:true,positive:true}),rackLocation:b.rackLocation||med.rackLocation};
   });
   for(const b of verified)med.batches.push({...b,initialQuantity:b.quantity,supplier:po.supplier,goodsReceipt:receipt._id,status:'active'});
   if(accepted){med.updateStockStatus();await med.save({session});}
   line.receivedQuantity+=accepted;
   receipt.items.push({medicine:line.medicine,medicineName:line.medicineName,genericName:line.genericName,deliveredQuantity:delivered,acceptedQuantity:accepted,rejectedQuantity:rejected,rejectionReason:input.rejectionReason,batches:verified});
  }
  po.status=po.items.every(i=>i.receivedQuantity>=i.quantity)?'Received':'Partially Received';
  po.statusHistory.push({status:po.status,changedBy:req.user._id,changedByName:req.user.name,reason:'Verified receipt '+receipt.receiptNumber});
  await receipt.save({session});await po.save({session});await audit(req,'GOODS_RECEIVED','Verified '+receipt.receiptNumber+' for '+po.poNumber,session);
  return {receipt,orderStatus:po.status,supplier:po.supplier,poId:po._id};
 });}catch(e){if(e.code===11000){const r=await duplicate();if(r)return res.json({success:true,isDuplicate:true,receipt:r});}throw e;}
 if(result.isDuplicate)return res.json({success:true,isDuplicate:true,receipt:result.receipt});
 await sendNotification({recipientSupplier:result.supplier,recipientRole:'supplier',title:'Goods verified',message:result.receipt.receiptNumber+' — '+result.orderStatus,link:String(result.poId),type:'receipt'});
 res.status(201).json({success:true,receipt:result.receipt,orderStatus:result.orderStatus});
}catch(e){next(e)}};
const scope=req=>req.user.role==='supplier'?{supplier:req.user.supplierCompany}:{};
const getGoodsReceipts=async(req,res,next)=>{try{const q=scope(req);if(req.query.purchaseOrderId)q.purchaseOrder=req.query.purchaseOrderId;const receipts=await GoodsReceipt.find(q).populate('purchaseOrder','poNumber status').sort({createdAt:-1}).limit(200);res.json({success:true,receipts})}catch(e){next(e)}};
const getGoodsReceiptById=async(req,res,next)=>{try{const receipt=await GoodsReceipt.findOne({_id:req.params.id,...scope(req)});if(!receipt)fail('Receipt not found.',404);res.json({success:true,receipt})}catch(e){next(e)}};
module.exports={createGoodsReceipt,getGoodsReceipts,getGoodsReceiptById};
