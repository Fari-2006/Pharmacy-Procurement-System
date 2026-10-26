const Notification = require('../models/Notification');
const scope = user => ({$or: [
  {recipientUser:user._id},
  ...(user.role === 'supplier' ? (user.supplierCompany ? [{recipientUser:null,recipientSupplier:user.supplierCompany,recipientRole:'supplier'}] : []) :
  [{recipientUser:null,recipientSupplier:null,recipientRole:user.role}])
]});
const sendNotification = async data => {
  try { return await Notification.create(data); } catch(e) { console.error('Notification delivery failed:', e.message); }
};
// Refresh persistent reminders on inbox polling; unique event keys avoid duplicates.
const refreshReminders=async user=>{
 if(!['admin','pharmacist'].includes(user.role))return;
 const today=new Date().toISOString().slice(0,10),role=user.role;
 const push=async(key,data)=>{try{await Notification.updateOne({eventKey:key},{$setOnInsert:{...data,recipientRole:role}},{upsert:true})}catch(e){if(e.code!==11000)throw e;}};
 const settings=await require('../models/SystemSetting').getSettings();
 const horizon=new Date(Date.now()+settings.defaultExpiryAlertDays*86400000);
 const meds=await require('../models/Medicine').find({archived:{$ne:true}}).limit(1000);
 for(const med of meds){
  const usable=med.batches.filter(b=>b.status==='active'&&b.expiryDate>new Date()).reduce((n,b)=>n+b.quantity,0);
  if(usable<=med.reorderLevel)await push(`${role}-stock-${med.id}-${today}`,{title:'Low stock: '+med.name,message:`${usable} usable units; reorder level ${med.reorderLevel}. Review outstanding orders before replenishing.`,type:'alert'});
  if(med.batches.some(b=>b.quantity>0&&b.status!=='quarantined'&&b.expiryDate<=horizon))await push(`${role}-expiry-${med.id}-${today}`,{title:'Expiry review: '+med.name,message:'Review near-expiry or expired batches and supplier return eligibility.',type:'alert'});
 }
 const due=await require('../models/SupplierInvoice').find({balanceDue:{$gt:0},dueDate:{$lte:new Date(Date.now()+7*86400000)}}).limit(1000);
 for(const inv of due)await push(`${role}-invoice-${inv.id}-${today}`,{title:inv.dueDate<new Date()?'Supplier invoice overdue':'Supplier invoice due soon',message:`${inv.invoiceNumber}: ₹${inv.balanceDue.toFixed(2)} outstanding, due ${inv.dueDate.toISOString().slice(0,10)}.`,link:inv.id,type:'invoice'});
};
const getNotifications = async (req,res,next) => {try {
 await refreshReminders(req.user);
 const query=scope(req.user), limit=Math.min(100,Math.max(1,Number(req.query.limit)||20)),page=Math.max(1,Number(req.query.page)||1);
 const unreadCount=await Notification.countDocuments({$and:[query,{readBy:{$ne:req.user._id}}]});
 const notifications=(await Notification.find(query).sort({createdAt:-1}).skip((page-1)*limit).limit(limit).lean()).map(n=>({...n,isRead:(n.readBy||[]).some(id=>String(id)===String(req.user._id))}));
 res.json({success:true,unreadCount,notifications});
 }catch(e){next(e)}};
const markAsRead = async (req,res,next) => {try {
 const notification=await Notification.findOneAndUpdate({$and:[{_id:req.params.id},scope(req.user)]},{$addToSet:{readBy:req.user._id}},{new:true});
 if(!notification)return res.status(404).json({success:false,message:'Notification not found'});
 res.json({success:true});
 }catch(e){next(e)}};
const markAllAsRead=async(req,res,next)=>{try{await Notification.updateMany(scope(req.user),{$addToSet:{readBy:req.user._id}});res.json({success:true})}catch(e){next(e)}};
module.exports={sendNotification,getNotifications,markAsRead,markAllAsRead,scope};
