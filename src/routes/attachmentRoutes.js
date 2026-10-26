const express=require('express'),fs=require('fs'),path=require('path');
const router=express.Router();
const {authenticate,authorizeRoles}=require('../middleware/auth');
const upload=require('../middleware/upload');
const models={orders:require('../models/PurchaseOrder'),receipts:require('../models/GoodsReceipt'),returns:require('../models/SupplierReturn'),invoices:require('../models/SupplierInvoice')};
router.use(authenticate,authorizeRoles('admin','pharmacist','supplier'));
const query=req=>req.user.role==='supplier'?{supplier:req.user.supplierCompany}:{};
router.post('/:kind/:id',async(req,res,next)=>{try{
 const Model=models[req.params.kind];if(!Model)return res.status(404).json({message:'Unknown attachment type'});
 const doc=await Model.findOne({_id:req.params.id,...query(req)});
 if(!doc||(req.user.role==='supplier'&&req.params.kind==='orders'&&['Draft','Pending Admin Approval'].includes(doc.status)))return res.status(404).json({message:'Record not found'});
 req.attachmentDocument=doc;next();
}catch(e){next(e)}},upload.single('attachment'),async(req,res,next)=>{try{
 if(!req.file)return res.status(400).json({message:'Select a file.'});
 const bytes=fs.readFileSync(req.file.path),pdf=bytes.subarray(0,5).toString()==='%PDF-',png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!((pdf&&req.file.mimetype==='application/pdf')||(png&&req.file.mimetype==='image/png')||(jpg&&['image/jpeg','image/jpg'].includes(req.file.mimetype)))){fs.unlinkSync(req.file.path);return res.status(400).json({message:'File content must match PDF, PNG or JPEG.'});}
 const doc=req.attachmentDocument;
 doc.attachments.push({filename:req.file.filename,originalName:path.basename(req.file.originalname),path:req.file.path,mimetype:req.file.mimetype,size:req.file.size,uploadedBy:req.user._id});
 await doc.save();res.status(201).json({success:true,attachment:doc.attachments.at(-1)});
}catch(e){if(req.file)fs.rmSync(req.file.path,{force:true});next(e)}});
router.get('/:filename',async(req,res,next)=>{try{
 if(req.params.filename!==path.basename(req.params.filename))return res.sendStatus(404);
 let attachment;
 for(const [kind,Model] of Object.entries(models)){
  const q={'attachments.filename':req.params.filename,...query(req)};
  if(kind==='orders'&&req.user.role==='supplier')q.status={$nin:['Draft','Pending Admin Approval']};
  const doc=await Model.findOne(q);if(doc){attachment=doc.attachments.find(a=>a.filename===req.params.filename);break;}
 }
 if(!attachment)return res.status(404).json({message:'Attachment not found'});
 const location=path.resolve(__dirname,'../../uploads/attachments',req.params.filename);
 if(!fs.existsSync(location))return res.sendStatus(404);
 res.set('X-Content-Type-Options','nosniff');res.download(location,attachment.originalName,{dotfiles:'allow'});
}catch(e){next(e)}});
module.exports=router;
