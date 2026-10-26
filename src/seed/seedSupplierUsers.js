/**
 * Seed Supplier Users & Demo Purchase Orders (Development Only)
 * Run: node src/seed/seedSupplierUsers.js
 *
 * NON-DESTRUCTIVE: Uses findOne() checks, never calls deleteMany().
 * Only adds what is missing. Safe to run multiple times.
 */
'use strict';
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

// Must require models after dotenv.config() so env vars are available
const User        = require('../models/User');
const Supplier    = require('../models/Supplier');
const Medicine    = require('../models/Medicine');
const PurchaseOrder = require('../models/PurchaseOrder');
const SystemSetting = require('../models/SystemSetting');

if (process.env.NODE_ENV !== 'development') {
  console.error('[SeedSupplierUsers] ❌ Refusing to run in production. Set NODE_ENV=development.');
  process.exit(1);
}

const seed = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pharmacy_db';
    console.log(`[SeedSupplierUsers] Connecting to: ${mongoUri}`);
    await mongoose.connect(mongoUri);

    // ─── 1. Ensure SystemSetting singleton exists ────────────────────────────
    await SystemSetting.getSettings(); // auto-creates with defaults if missing
    console.log('[SeedSupplierUsers] ✅ SystemSetting singleton ensured.');

    // ─── 2. Find existing supplier companies ─────────────────────────────────
    const apex   = await Supplier.findOne({ name: /Apex Healthcare/i });
    const biocare = await Supplier.findOne({ name: /BioCare/i });
    const nova   = await Supplier.findOne({ name: /NovaCare/i });

    if (!apex || !biocare || !nova) {
      console.error('[SeedSupplierUsers] ❌ Supplier companies not found. Run main seedData.js first.');
      process.exit(1);
    }

    // Enrich suppliers with procurement fields (only if not already set)
    const enrichments = [
      {
        doc: apex,
        data: {
          leadTimeDays: 5,
          safetyStockDays: 10,
          paymentTerms: 'Net 30',
          returnPolicy: { returnWindowDays: 30, restockingFeePercent: 5, allowsReturn: true }
        }
      },
      {
        doc: biocare,
        data: {
          leadTimeDays: 7,
          safetyStockDays: 14,
          paymentTerms: 'Net 45',
          returnPolicy: { returnWindowDays: 60, restockingFeePercent: 0, allowsReturn: true }
        }
      },
      {
        doc: nova,
        data: {
          leadTimeDays: 3,
          safetyStockDays: 7,
          paymentTerms: 'Net 15',
          returnPolicy: { returnWindowDays: 14, restockingFeePercent: 10, allowsReturn: true }
        }
      }
    ];

    for (const { doc, data } of enrichments) {
      let changed = false;
      for (const [key, val] of Object.entries(data)) {
        if (doc[key] === undefined || doc[key] === null) {
          doc[key] = val;
          changed = true;
        }
      }
      if (changed) {
        await doc.save();
        console.log(`[SeedSupplierUsers] ✅ Enriched supplier: ${doc.name}`);
      } else {
        console.log(`[SeedSupplierUsers] ℹ️  Supplier already enriched: ${doc.name}`);
      }
    }

    // ─── 3. Create supplier user accounts (non-destructively) ────────────────
    const supplierUsers = [
      {
        name: 'Marcus Vance',
        email: 'supplier.apex@pharmacy.com',
        password: 'Apex@123',
        role: 'supplier',
        phone: '+91-800-555-0120',
        isActive: true,
        supplierCompany: apex._id
      },
      {
        name: 'Sophia Chen',
        email: 'supplier.biocare@pharmacy.com',
        password: 'BioCare@123',
        role: 'supplier',
        phone: '+91-800-555-0188',
        isActive: true,
        supplierCompany: biocare._id
      },
      {
        name: 'David Miller',
        email: 'supplier.nova@pharmacy.com',
        password: 'Nova@123',
        role: 'supplier',
        phone: '+91-800-555-0155',
        isActive: true,
        supplierCompany: nova._id
      }
    ];

    for (const uData of supplierUsers) {
      const existing = await User.findOne({ email: uData.email });
      if (existing) {
        console.log(`[SeedSupplierUsers] ℹ️  User already exists: ${uData.email}`);
        continue;
      }
      await User.create(uData);
      console.log(`[SeedSupplierUsers] ✅ Created supplier user: ${uData.email}`);
    }

    // ─── 4. Seed demo Purchase Orders (only if none exist) ───────────────────
    const existingPOCount = await PurchaseOrder.countDocuments();
    if (existingPOCount > 0) {
      console.log(`[SeedSupplierUsers] ℹ️  ${existingPOCount} PO(s) already exist — skipping demo POs.`);
    } else {
      // Find pharmacist user to set as creator
      const pharmacistUser = await User.findOne({ role: 'pharmacist' });
      if (!pharmacistUser) {
        console.warn('[SeedSupplierUsers] ⚠️  No pharmacist found, skipping demo POs.');
      } else {
        // Get medicine IDs
        const amox = await Medicine.findOne({ name: /Amoxicillin/i });
        const atorvastatin = await Medicine.findOne({ name: /Atorvastatin/i });
        const salbutamol = await Medicine.findOne({ name: /Salbutamol/i });

        if (amox && atorvastatin && apex) {
          // Demo PO 1: Submitted (awaiting supplier response)
          const po1 = new PurchaseOrder({
            poNumber: 'PO-DEMO-0001',
            supplier: apex._id,
            createdBy: pharmacistUser._id,
            status: 'Submitted',
            expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            deliveryAddress: 'MediVault Pharmacy, 12 Health Avenue, Mumbai 400001',
            items: [
              {
                medicine: amox._id,
                medicineName: amox.name,
                quantity: 200,
                unitPrice: 4.70, lineTotal: 940,
                taxPercent: 12
              },
              {
                medicine: atorvastatin._id,
                medicineName: atorvastatin.name,
                quantity: 100,
                unitPrice: 5.20, lineTotal: 520,
                taxPercent: 12
              }
            ],
            notes: 'Demo PO — awaiting supplier confirmation.',
            statusHistory: [
              {
                status: 'Draft',
                changedBy: pharmacistUser._id,
                changedByName: pharmacistUser.name,
                note: 'Created draft'
              },
              {
                status: 'Submitted',
                changedBy: pharmacistUser._id,
                changedByName: pharmacistUser.name,
                note: 'Submitted to supplier'
              }
            ]
          });
          po1.calculateTotals();
          await po1.save();
          console.log(`[SeedSupplierUsers] ✅ Demo PO created: ${po1.poNumber} (Submitted)`);
        }

        if (salbutamol && nova) {
          // Demo PO 2: Draft (not yet submitted)
          const po2 = new PurchaseOrder({
            poNumber: 'PO-DEMO-0002',
            supplier: nova._id,
            createdBy: pharmacistUser._id,
            status: 'Draft',
            expectedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
            deliveryAddress: 'MediVault Pharmacy, 12 Health Avenue, Mumbai 400001',
            items: [
              {
                medicine: salbutamol._id,
                medicineName: salbutamol.name,
                quantity: 50,
                unitPrice: 12.00, lineTotal: 600,
                taxPercent: 5
              }
            ],
            notes: 'Demo Draft PO — not yet submitted.',
            statusHistory: [
              {
                status: 'Draft',
                changedBy: pharmacistUser._id,
                changedByName: pharmacistUser.name,
                note: 'Created draft'
              }
            ]
          });
          po2.calculateTotals();
          await po2.save();
          console.log(`[SeedSupplierUsers] ✅ Demo PO created: ${po2.poNumber} (Draft)`);
        }
      }
    }

    // ─── Summary ─────────────────────────────────────────────────────────────
    console.log('\n----------------------------------------------------');
    console.log('✅ SUPPLIER SEED COMPLETED (non-destructive)');
    console.log('----------------------------------------------------');
    console.log('Supplier Portal Demo Credentials (DEV ONLY):');
    console.log('1. Apex:    supplier.apex@pharmacy.com    / Apex@123');
    console.log('2. BioCare: supplier.biocare@pharmacy.com / BioCare@123');
    console.log('3. NovaCare:supplier.nova@pharmacy.com    / Nova@123');
    console.log('----------------------------------------------------\n');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('[SeedSupplierUsers Error]:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
};

seed();
