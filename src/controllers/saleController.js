const Sale = require('../models/Sale');
const Medicine = require('../models/Medicine');
const AuditLog = require('../models/AuditLog');

const {atomic,number,money,fail,audit}=require('../services/workflow');
const mongoose=require('mongoose');
const Counter=mongoose.models.Counter||mongoose.model('Counter',new mongoose.Schema({_id:String,value:{type:Number,default:0}}));
const createSale=async(req,res,next)=>{try{
 const body=req.body;if(!Array.isArray(body.items)||!body.items.length)fail('Cart is empty.');
 const discount=number(body.discountPercent??0,'discount'),tax=number(body.taxPercent??0,'tax');if(discount>100)fail('Discount cannot exceed 100%.');
 if(!['cash','card','upi','insurance'].includes(body.paymentMethod||'cash'))fail('Invalid payment mode.');
 const sale=await atomic(async session=>{
  const entries=[],meds=new Map();let subtotal=0;
  for(const i of body.items){
   const qty=number(i.quantity,'sale quantity',{integer:true,positive:true});
   let med=meds.get(String(i.medicineId));if(!med){med=await Medicine.findOne({_id:i.medicineId,archived:{$ne:true}}).session(session);if(!med)fail('Medicine not found.',404);meds.set(String(i.medicineId),med);}
   const valid=med.batches.filter(b=>b.status==='active'&&b.quantity>0&&b.expiryDate>new Date()).sort((a,b)=>a.expiryDate-b.expiryDate);
   const b=i.batchNumber?valid.find(b=>b.batchNumber===String(i.batchNumber).toUpperCase().trim()):valid[0];
   if(!b||b.quantity<qty)fail('Selected batch is unavailable, expired, quarantined or has insufficient stock.');
   b.quantity-=qty;const line=money(qty*b.sellingPrice);subtotal+=line;
   entries.push({medicine:med._id,medicineName:med.name,genericName:med.genericName,batchNumber:b.batchNumber,expiryDate:b.expiryDate,quantity:qty,unitPrice:b.sellingPrice,subtotal:line});
  }
  subtotal=money(subtotal);const discountAmount=money(subtotal*discount/100),taxAmount=money((subtotal-discountAmount)*tax/100),grandTotal=money(subtotal-discountAmount+taxAmount);
  const paid=body.paidAmount===undefined?grandTotal:number(body.paidAmount,'paid amount');if(paid<grandTotal)fail('Payment is less than the bill total.');
  const day=new Date().toISOString().slice(0,10).replaceAll('-','');
  if(!await Counter.exists({_id:'sale-'+day}).session(session)){
   const existing=await Sale.find({invoiceNumber:{$regex:'^INV-'+day+'-[0-9]+$'}}).select('invoiceNumber').session(session);
   const maximum=existing.reduce((n,s)=>Math.max(n,Number(s.invoiceNumber.split('-').at(-1))||0),0);
   await Counter.updateOne({_id:'sale-'+day},{$setOnInsert:{value:maximum}},{upsert:true,session});
  }
  const counter=await Counter.findOneAndUpdate({_id:'sale-'+day},{$inc:{value:1}},{new:true,upsert:true,session});
  const record=new Sale({invoiceNumber:`INV-${day}-${String(counter.value).padStart(4,'0')}`,customerName:body.customerName||'Walk-in Customer',customerPhone:body.customerPhone,doctorName:body.doctorName,items:entries,subtotal,discountPercent:discount,discountAmount,taxPercent:tax,taxAmount,grandTotal,paymentMethod:body.paymentMethod||'cash',paidAmount:paid,changeAmount:money(paid-grandTotal),dispensedBy:req.user._id,notes:body.notes});
  for(const med of meds.values())await med.save({session});
  await record.save({session});await audit(req,'SALE_DISPENSED','Dispensed '+record.invoiceNumber,session);return record;
 });
 await sale.populate('dispensedBy','name role email');res.status(201).json({success:true,sale,message:'Sale completed'});
}catch(e){next(e)}};

// @desc    Get sales history
// @route   GET /api/sales
// @access  Private
const getSales = async (req, res, next) => {
  try {
    const { search, startDate, endDate, page = 1, limit = 25 } = req.query;
    let query = {};

    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { invoiceNumber: regex },
        { customerName: regex },
        { customerPhone: regex }
      ];
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // If role is cashier, cashier can optionally only view their own sales, or all sales
    // Typically in a pharmacy, cashiers can see their daily transactions
    const skip = (Number(page) - 1) * Number(limit);
    const total = await Sale.countDocuments(query);
    const sales = await Sale.find(query)
      .populate('dispensedBy', 'name role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true,
      count: sales.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      sales
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get sale by ID (for receipt printing)
// @route   GET /api/sales/:id
// @access  Private
const getSaleById = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id)
      .populate('dispensedBy', 'name role');

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: 'Sale/Invoice record not found'
      });
    }

    res.json({
      success: true,
      sale
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSale,
  getSales,
  getSaleById
};
