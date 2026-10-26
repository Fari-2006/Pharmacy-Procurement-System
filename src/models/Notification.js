const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    eventKey: {type:String, unique:true, sparse:true},
    recipientUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    recipientRole: {
      type: String,
      enum: ['admin', 'pharmacist', 'cashier', 'supplier']
    },
    recipientSupplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier'
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    link: {
      type: String,
      default: ''
    },
    type: {
      type: String,
      enum: ['order', 'approval', 'delivery', 'receipt', 'return', 'invoice', 'payment', 'discussion', 'alert'],
      default: 'order'
    },
    readBy: [{type: mongoose.Schema.Types.ObjectId, ref: 'User'}],
    isRead: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Notification', notificationSchema);
