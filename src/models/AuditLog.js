const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    userName: {
      type: String
    },
    userRole: {
      type: String
    },
    action: {
      type: String,
      required: true,
      enum: [
        'STOCK_IN',
        'STOCK_ADJUSTMENT',
        'STOCK_DISPOSAL',
        'SALE_DISPENSED',
        'MEDICINE_CREATED',
        'MEDICINE_UPDATED',
        'MEDICINE_DELETED',
        'SUPPLIER_CREATED',
        'USER_MANAGEMENT',
        'PO_CREATED',
        'PO_DRAFT_EDITED',
        'PO_SUBMITTED',
        'PO_CANCELLED',
        'PO_ADMIN_APPROVAL',
        'PO_SUPPLIER_RESPONSE',
        'PO_CHANGES_PROPOSED',
        'PO_CHANGES_REVIEWED',
        'PO_SHIPPING_UPDATED',
        'GOODS_RECEIVED',
        'RETURN_REQUESTED',
        'RETURN_STATUS_UPDATED',
        'RETURN_RESOLVED',
        'INVOICE_RECORDED',
        'PAYMENT_RECORDED',
        'SETTINGS_UPDATED'
      ]
    },
    medicine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine'
    },
    medicineName: {
      type: String
    },
    batchNumber: {
      type: String
    },
    quantityChange: {
      type: Number
    },
    details: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
