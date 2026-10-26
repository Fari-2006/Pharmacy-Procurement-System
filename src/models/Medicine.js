const mongoose = require('mongoose');

const batchSchema = new mongoose.Schema({
  rackLocation: String,
  goodsReceipt: {type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt'},
  returnReference: {type: mongoose.Schema.Types.ObjectId, ref: 'SupplierReturn'},
  batchNumber: {
    type: String,
    required: [true, 'Batch number is required'],
    trim: true,
    uppercase: true
  },
  mfgDate: {
    type: Date
  },
  expiryDate: {
    type: Date,
    required: [true, 'Expiry date is required']
  },
  costPrice: {
    type: Number,
    required: [true, 'Purchase/cost price is required'],
    min: [0, 'Cost price cannot be negative']
  },
  sellingPrice: {
    type: Number,
    required: [true, 'Selling price is required'],
    min: [0, 'Selling price cannot be negative']
  },
  initialQuantity: {
    type: Number,
    default: 0
  },
  quantity: {
    type: Number,
    required: [true, 'Batch quantity is required'],
    min: [0, 'Quantity cannot be negative'],
    default: 0
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'depleted', 'quarantined'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const medicineSchema = new mongoose.Schema(
  {
    archived: {type:Boolean, default:false},
    name: {
      type: String,
      required: [true, 'Medicine brand name is required'],
      trim: true,
      index: true
    },
    genericName: {
      type: String,
      required: [true, 'Generic chemical name is required'],
      trim: true,
      index: true
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      enum: [
        'Antibiotics',
        'Analgesics / Pain Relief',
        'Antipyretics',
        'Cardiovascular',
        'Antidiabetic',
        'Gastrointestinal',
        'Respiratory / Anti-Allergy',
        'Vitamins & Supplements',
        'Dermatology / Topical',
        'Ophthalmic / ENT',
        'Neurology / Psych',
        'First Aid / Surgical',
        'Other'
      ],
      default: 'Other'
    },
    dosageForm: {
      type: String,
      trim: true,
      enum: ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Drops', 'Inhaler', 'Powder', 'Suppository', 'Other'],
      default: 'Tablet'
    },
    strength: {
      type: String,
      trim: true,
      default: ''
    },
    manufacturer: {
      type: String,
      trim: true,
      default: ''
    },
    unit: {
      type: String,
      trim: true,
      default: 'Tablets'
    },
    reorderLevel: {
      type: Number,
      default: 20,
      min: [0, 'Reorder level cannot be negative']
    },
    rackLocation: {
      type: String,
      trim: true,
      default: 'General Shelf'
    },
    requiresPrescription: {
      type: Boolean,
      default: false
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    totalStock: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['in_stock', 'low_stock', 'out_of_stock'],
      default: 'out_of_stock'
    },
    batches: [batchSchema]
  },
  {
    optimisticConcurrency: true,
    timestamps: true
  }
);

// Method to compute total stock and batch statuses
medicineSchema.methods.updateStockStatus = function () {
  const now = new Date();
  let total = 0;

  this.batches.forEach(b => {
    // Check if expired
    if (b.status === 'quarantined') {
      // Quarantine survives expiry until an explicit disposition.
    } else if (new Date(b.expiryDate) <= now) {
      b.status = 'expired';
    } else if (b.quantity <= 0) {
      b.status = 'depleted';
    } else if (b.status === 'quarantined') {
      // Keep quarantined status
    } else {
      b.status = 'active';
    }

    // Only active, unexpired, non-quarantined batches count towards sellable total
    if (b.status === 'active') {
      total += b.quantity;
    }
  });

  this.totalStock = total;

  if (total === 0) {
    this.status = 'out_of_stock';
  } else if (total <= this.reorderLevel) {
    this.status = 'low_stock';
  } else {
    this.status = 'in_stock';
  }
};

// Automatically run status update before save
medicineSchema.pre('save', function () {
  this.updateStockStatus();
});

// Create text index for search
medicineSchema.index({ name: 'text', genericName: 'text', manufacturer: 'text' });

module.exports = mongoose.model('Medicine', medicineSchema);
