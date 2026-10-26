const PurchaseOrder=require('../models/PurchaseOrder');
const SupplierInvoice=require('../models/SupplierInvoice');
const {scope}=require('./notificationController');
const Notification=require('../models/Notification');
exports.summary=async(req,res,next)=>{try{
 const q=req.user.role==='supplier'?{supplier:req.user.supplierCompany,status:{$nin:['Draft','Pending Admin Approval']}}:{};
 const counts=await PurchaseOrder.aggregate([{$match:q},{$group:{_id:'$status',count:{$sum:1}}}]);
 const metrics=Object.fromEntries(counts.map(c=>[c._id,c.count]));
 const recent=await PurchaseOrder.find(q).populate('supplier','name').sort({createdAt:-1}).limit(5);
 const upcoming=await PurchaseOrder.find({...q,status:{$in:['Accepted','Packed','Dispatched']}}).sort({expectedDeliveryDate:1}).limit(5);
 const invoices=await SupplierInvoice.aggregate([{$match:req.user.role==='supplier'?{supplier:req.user.supplierCompany}:{}},{$group:{_id:null,balance:{$sum:'$balanceDue'}}}]);
 const unread=await Notification.countDocuments({$and:[scope(req.user),{readBy:{$ne:req.user._id}}]});
 res.json({success:true,metrics,recent,upcoming,outstanding:invoices[0]?.balance||0,unread});
}catch(e){next(e)}};
