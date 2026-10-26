const PurchaseOrder = require('../models/PurchaseOrder');
const stages = {
  'Pending Admin Approval': 'Awaiting Approval',
  Submitted: 'Order Placed',
  'Changes Proposed': 'Changes Proposed',
  Accepted: 'Order Accepted',
  Packed: 'Packed',
  Dispatched: 'In Transit',
  Delivered: 'Awaiting Verification',
  'Partially Received': 'Partially Received'
};
module.exports = async (medicines, role) => {
  const ids = medicines.map(m => m._id);
  const orders = ids.length ? await PurchaseOrder.find({status:{$in:Object.keys(stages)},'items.medicine':{$in:ids}})
    .select('poNumber status items.medicine items.quantity items.receivedQuantity').sort({createdAt:-1}).lean() : [];
  const byMedicine = new Map();
  for (const order of orders) for (const item of order.items) {
    const remaining = Math.max(0,item.quantity-(item.receivedQuantity||0));
    if (!remaining) continue;
    const key = String(item.medicine);
    if (!byMedicine.has(key)) byMedicine.set(key,[]);
    byMedicine.get(key).push({id:order._id,poNumber:order.poNumber,status:order.status,label:stages[order.status],outstandingQuantity:remaining});
  }
  return medicines.map(m => {
    const medicine=m.toObject ? m.toObject() : {...m};
    const pending=byMedicine.get(String(medicine._id))||[];
    medicine.incomingQuantity=pending.reduce((n,o)=>n+o.outstandingQuantity,0);
    medicine.procurementStatus=pending.length ? pending[0].label : null;
    if (role!=='cashier') medicine.openPurchaseOrders=pending;
    return medicine;
  });
};
