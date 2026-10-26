const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const Medicine = require('../models/Medicine');
const Supplier = require('../models/Supplier');
const Sale = require('../models/Sale');
const AuditLog = require('../models/AuditLog');

dotenv.config();

const seed = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pharmacy_db';
    console.log(`[Seed] Connecting to MongoDB: ${mongoUri}...`);
    await mongoose.connect(mongoUri);

    console.log('[Seed] Clearing existing data...');
    await User.deleteMany();
    await Medicine.deleteMany();
    await Supplier.deleteMany();
    await Sale.deleteMany();
    await AuditLog.deleteMany();

    console.log('[Seed] Seeding Users with Role-Based Access Control...');
    // Create Users (password hashing handled by User schema pre-save hook)
    const adminUser = await User.create({
      name: 'Dr. Sarah Mitchell',
      email: 'admin@pharmacy.com',
      password: 'Admin@123',
      role: 'admin',
      phone: '+1-555-0199',
      isActive: true
    });

    const pharmacistUser = await User.create({
      name: 'James Wilson, PharmD',
      email: 'pharmacist@pharmacy.com',
      password: 'Pharma@123',
      role: 'pharmacist',
      phone: '+1-555-0144',
      isActive: true
    });

    const cashierUser = await User.create({
      name: 'Elena Rostova',
      email: 'cashier@pharmacy.com',
      password: 'Cashier@123',
      role: 'cashier',
      phone: '+1-555-0182',
      isActive: true
    });

    console.log('[Seed] Seeding Suppliers...');
    const supplier1 = await Supplier.create({
      name: 'Apex Healthcare Distributors',
      contactPerson: 'Marcus Vance',
      email: 'marcus@apexhealth.com',
      phone: '+1-800-555-0120',
      address: '742 Evergreen Terrace, Medical District, NY',
      suppliedCategories: ['Antibiotics', 'Analgesics / Pain Relief', 'Cardiovascular'],
      notes: 'Primary supplier for critical antibiotics and cardiological drugs'
    });

    const supplier2 = await Supplier.create({
      name: 'BioCare Global Pharmaceuticals',
      contactPerson: 'Sophia Chen',
      email: 'schen@biocare-pharma.com',
      phone: '+1-800-555-0188',
      address: '120 Science Parkway, Cambridge, MA',
      suppliedCategories: ['Antidiabetic', 'Gastrointestinal', 'Vitamins & Supplements'],
      notes: 'Reliable generic drug manufacturer with fast delivery'
    });

    const supplier3 = await Supplier.create({
      name: 'NovaCare Generics & Surgical',
      contactPerson: 'David Miller',
      email: 'contact@novacarepharma.com',
      phone: '+1-800-555-0155',
      address: '88 Industrial Way, Chicago, IL',
      suppliedCategories: ['Respiratory / Anti-Allergy', 'Dermatology / Topical', 'First Aid / Surgical'],
      notes: 'Inhalers, allergy medications, and OTC essentials'
    });

    console.log('[Seed] Seeding Medicines & Multi-Batch Inventory...');
    const today = new Date();

    // Helper dates
    const daysFromNow = (days) => new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
    const daysAgo = (days) => new Date(today.getTime() - days * 24 * 60 * 60 * 1000);

    const medicinesData = [
      {
        name: 'Amoxicillin 500mg Capsule',
        genericName: 'Amoxicillin Trihydrate',
        category: 'Antibiotics',
        dosageForm: 'Capsule',
        strength: '500 mg',
        manufacturer: 'GSK Pharmaceuticals',
        unit: 'Strips',
        reorderLevel: 25,
        rackLocation: 'Shelf A-1',
        requiresPrescription: true,
        description: 'Broad-spectrum penicillin antibiotic used for bacterial infections.',
        batches: [
          {
            batchNumber: 'AMX-2025-A1',
            mfgDate: daysAgo(180),
            expiryDate: daysFromNow(22), // Near expiry alert (within 30 days!)
            costPrice: 4.50,
            sellingPrice: 8.50,
            initialQuantity: 100,
            quantity: 15,
            supplier: supplier1._id
          },
          {
            batchNumber: 'AMX-2026-B2',
            mfgDate: daysAgo(30),
            expiryDate: daysFromNow(480), // Normal future expiry
            costPrice: 4.70,
            sellingPrice: 8.50,
            initialQuantity: 200,
            quantity: 150,
            supplier: supplier1._id
          }
        ]
      },
      {
        name: 'Paracetamol 650mg Tablet',
        genericName: 'Acetaminophen / Paracetamol',
        category: 'Analgesics / Pain Relief',
        dosageForm: 'Tablet',
        strength: '650 mg',
        manufacturer: 'Apex Labs',
        unit: 'Strips',
        reorderLevel: 50,
        rackLocation: 'Shelf B-2',
        requiresPrescription: false,
        description: 'Analgesic and antipyretic for pain and fever reduction.',
        batches: [
          {
            batchNumber: 'PCM-650-99',
            mfgDate: daysAgo(90),
            expiryDate: daysFromNow(600),
            costPrice: 1.20,
            sellingPrice: 2.50,
            initialQuantity: 500,
            quantity: 420,
            supplier: supplier1._id
          }
        ]
      },
      {
        name: 'Azithromycin 500mg Tablet',
        genericName: 'Azithromycin Dihydrate',
        category: 'Antibiotics',
        dosageForm: 'Tablet',
        strength: '500 mg',
        manufacturer: 'Pfizer',
        unit: 'Strips',
        reorderLevel: 20,
        rackLocation: 'Shelf A-3',
        requiresPrescription: true,
        description: 'Macrolide antibiotic for respiratory and skin infections.',
        batches: [
          {
            batchNumber: 'AZT-2026-01',
            mfgDate: daysAgo(60),
            expiryDate: daysFromNow(380),
            costPrice: 7.00,
            sellingPrice: 13.50,
            initialQuantity: 80,
            quantity: 65,
            supplier: supplier1._id
          }
        ]
      },
      {
        name: 'Metformin 500mg Extended Release',
        genericName: 'Metformin Hydrochloride',
        category: 'Antidiabetic',
        dosageForm: 'Tablet',
        strength: '500 mg',
        manufacturer: 'BioCare Generics',
        unit: 'Strips',
        reorderLevel: 30,
        rackLocation: 'Shelf C-1',
        requiresPrescription: true,
        description: 'First-line medication for the treatment of type 2 diabetes.',
        batches: [
          {
            batchNumber: 'MET-500-XR1',
            mfgDate: daysAgo(120),
            expiryDate: daysFromNow(500),
            costPrice: 3.00,
            sellingPrice: 6.00,
            initialQuantity: 300,
            quantity: 210,
            supplier: supplier2._id
          }
        ]
      },
      {
        name: 'Atorvastatin 20mg Tablet',
        genericName: 'Atorvastatin Calcium',
        category: 'Cardiovascular',
        dosageForm: 'Tablet',
        strength: '20 mg',
        manufacturer: 'Apex Healthcare',
        unit: 'Strips',
        reorderLevel: 25,
        rackLocation: 'Shelf C-3',
        requiresPrescription: true,
        description: 'Statin medication used to prevent cardiovascular disease and treat abnormal lipid levels.',
        batches: [
          {
            batchNumber: 'ATV-20-44',
            mfgDate: daysAgo(100),
            expiryDate: daysFromNow(420),
            costPrice: 5.20,
            sellingPrice: 10.00,
            initialQuantity: 150,
            quantity: 90,
            supplier: supplier1._id
          }
        ]
      },
      {
        name: 'Pantoprazole 40mg Tablet',
        genericName: 'Pantoprazole Sodium',
        category: 'Gastrointestinal',
        dosageForm: 'Tablet',
        strength: '40 mg',
        manufacturer: 'BioCare Global',
        unit: 'Strips',
        reorderLevel: 30,
        rackLocation: 'Shelf D-2',
        requiresPrescription: false,
        description: 'Proton pump inhibitor that decreases stomach acid production.',
        batches: [
          {
            batchNumber: 'PAN-40-101',
            mfgDate: daysAgo(80),
            expiryDate: daysFromNow(320),
            costPrice: 2.80,
            sellingPrice: 5.50,
            initialQuantity: 200,
            quantity: 145,
            supplier: supplier2._id
          }
        ]
      },
      {
        name: 'Salbutamol 100mcg Inhaler',
        genericName: 'Albuterol / Salbutamol',
        category: 'Respiratory / Anti-Allergy',
        dosageForm: 'Inhaler',
        strength: '100 mcg / dose',
        manufacturer: 'NovaCare Respirations',
        unit: 'Inhaler',
        reorderLevel: 15,
        rackLocation: 'Shelf E-1',
        requiresPrescription: true,
        description: 'Fast-acting bronchodilator for relief of asthma bronchospasm.',
        batches: [
          {
            batchNumber: 'SAL-INH-88',
            mfgDate: daysAgo(50),
            expiryDate: daysFromNow(550),
            costPrice: 12.00,
            sellingPrice: 22.00,
            initialQuantity: 50,
            quantity: 8, // Low Stock alert trigger!
            supplier: supplier3._id
          }
        ]
      },
      {
        name: 'Cetirizine 10mg Tablet',
        genericName: 'Cetirizine Dihydrochloride',
        category: 'Respiratory / Anti-Allergy',
        dosageForm: 'Tablet',
        strength: '10 mg',
        manufacturer: 'NovaCare Generics',
        unit: 'Strips',
        reorderLevel: 25,
        rackLocation: 'Shelf E-2',
        requiresPrescription: false,
        description: 'Second-generation antihistamine used to treat hay fever and allergies.',
        batches: [
          {
            batchNumber: 'CET-10-52',
            mfgDate: daysAgo(110),
            expiryDate: daysFromNow(520),
            costPrice: 1.50,
            sellingPrice: 3.20,
            initialQuantity: 300,
            quantity: 260,
            supplier: supplier3._id
          }
        ]
      },
      {
        name: 'Vitamin D3 60,000 IU Capsule',
        genericName: 'Cholecalciferol',
        category: 'Vitamins & Supplements',
        dosageForm: 'Capsule',
        strength: '60,000 IU',
        manufacturer: 'BioCare Health',
        unit: 'Strips',
        reorderLevel: 20,
        rackLocation: 'Shelf F-1',
        requiresPrescription: false,
        description: 'High dose vitamin D supplement for bone density and immune health.',
        batches: [
          {
            batchNumber: 'VIT-D3-77',
            mfgDate: daysAgo(70),
            expiryDate: daysFromNow(350),
            costPrice: 3.50,
            sellingPrice: 7.00,
            initialQuantity: 120,
            quantity: 85,
            supplier: supplier2._id
          }
        ]
      },
      {
        name: 'Ibuprofen 400mg Tablet',
        genericName: 'Ibuprofen',
        category: 'Analgesics / Pain Relief',
        dosageForm: 'Tablet',
        strength: '400 mg',
        manufacturer: 'Apex Labs',
        unit: 'Strips',
        reorderLevel: 20,
        rackLocation: 'Shelf B-3',
        requiresPrescription: false,
        description: 'Non-steroidal anti-inflammatory drug (NSAID) for inflammation and pain.',
        batches: [
          {
            batchNumber: 'IBU-400-02',
            mfgDate: daysAgo(140),
            expiryDate: daysFromNow(450),
            costPrice: 2.10,
            sellingPrice: 4.20,
            initialQuantity: 150,
            quantity: 110,
            supplier: supplier1._id
          }
        ]
      },
      {
        name: 'Tetracycline 250mg Capsule',
        genericName: 'Tetracycline Hydrochloride',
        category: 'Antibiotics',
        dosageForm: 'Capsule',
        strength: '250 mg',
        manufacturer: 'Legacy Pharma',
        unit: 'Strips',
        reorderLevel: 10,
        rackLocation: 'Quarantine / Disposal Bin',
        requiresPrescription: true,
        description: 'Antibiotic with expired batch for quarantine inspection demonstration.',
        batches: [
          {
            batchNumber: 'TET-EXP-2025',
            mfgDate: daysAgo(600),
            expiryDate: daysAgo(35), // EXPIRED batch!
            costPrice: 2.50,
            sellingPrice: 5.00,
            initialQuantity: 40,
            quantity: 40,
            supplier: supplier1._id
          }
        ]
      },
      {
        name: 'Doxycycline 100mg Capsule',
        genericName: 'Doxycycline Hyclate',
        category: 'Antibiotics',
        dosageForm: 'Capsule',
        strength: '100 mg',
        manufacturer: 'Apex Healthcare',
        unit: 'Strips',
        reorderLevel: 15,
        rackLocation: 'Shelf A-4',
        requiresPrescription: true,
        description: 'Tetracycline antibiotic currently completely out of stock.',
        batches: [] // Completely out of stock demonstration
      }
    ];

    const createdMedicines = [];
    for (const mData of medicinesData) {
      const med = new Medicine(mData);
      await med.save();
      createdMedicines.push(med);
    }

    console.log(`[Seed] Seeded ${createdMedicines.length} Medicines with batches.`);

    console.log('[Seed] Seeding Initial Sales Transactions...');
    const sale1 = await Sale.create({
      invoiceNumber: 'INV-20261025-0001',
      customerName: 'Robert Vance',
      customerPhone: '+1-555-4321',
      doctorName: 'Dr. Katherine Evans',
      items: [
        {
          medicine: createdMedicines[1]._id,
          medicineName: 'Paracetamol 650mg Tablet',
          genericName: 'Acetaminophen / Paracetamol',
          batchNumber: 'PCM-650-99',
          expiryDate: daysFromNow(600),
          quantity: 2,
          unitPrice: 2.50,
          subtotal: 5.00
        },
        {
          medicine: createdMedicines[5]._id,
          medicineName: 'Pantoprazole 40mg Tablet',
          genericName: 'Pantoprazole Sodium',
          batchNumber: 'PAN-40-101',
          expiryDate: daysFromNow(320),
          quantity: 1,
          unitPrice: 5.50,
          subtotal: 5.50
        }
      ],
      subtotal: 10.50,
      discountPercent: 5,
      discountAmount: 0.53,
      taxPercent: 5,
      taxAmount: 0.50,
      grandTotal: 10.47,
      paymentMethod: 'cash',
      paidAmount: 20.00,
      changeAmount: 9.53,
      dispensedBy: cashierUser._id,
      notes: 'Prescription verified.'
    });

    const sale2 = await Sale.create({
      invoiceNumber: 'INV-20261025-0002',
      customerName: 'Amanda Clarke',
      customerPhone: '+1-555-8765',
      doctorName: 'Dr. Michael Stevens',
      items: [
        {
          medicine: createdMedicines[0]._id,
          medicineName: 'Amoxicillin 500mg Capsule',
          genericName: 'Amoxicillin Trihydrate',
          batchNumber: 'AMX-2026-B2',
          expiryDate: daysFromNow(480),
          quantity: 2,
          unitPrice: 8.50,
          subtotal: 17.00
        },
        {
          medicine: createdMedicines[7]._id,
          medicineName: 'Cetirizine 10mg Tablet',
          genericName: 'Cetirizine Dihydrochloride',
          batchNumber: 'CET-10-52',
          expiryDate: daysFromNow(520),
          quantity: 1,
          unitPrice: 3.20,
          subtotal: 3.20
        }
      ],
      subtotal: 20.20,
      discountPercent: 0,
      discountAmount: 0.00,
      taxPercent: 5,
      taxAmount: 1.01,
      grandTotal: 21.21,
      paymentMethod: 'card',
      paidAmount: 21.21,
      changeAmount: 0.00,
      dispensedBy: pharmacistUser._id,
      notes: 'Card payment processed.'
    });

    console.log('[Seed] Seeding Initial Audit Logs...');
    await AuditLog.create([
      {
        user: adminUser._id,
        userName: adminUser.name,
        userRole: adminUser.role,
        action: 'MEDICINE_CREATED',
        details: 'Initial database population with core pharmaceutical inventory'
      },
      {
        user: pharmacistUser._id,
        userName: pharmacistUser.name,
        userRole: pharmacistUser.role,
        action: 'STOCK_IN',
        details: 'Received bulk shipment from Apex Healthcare Distributors'
      },
      {
        user: cashierUser._id,
        userName: cashierUser.name,
        userRole: cashierUser.role,
        action: 'SALE_DISPENSED',
        details: 'Dispensed invoice INV-20261025-0001 to customer Robert Vance'
      }
    ]);

    console.log('----------------------------------------------------');
    console.log('✅ DATABASE SEEDING COMPLETED SUCCESSFULLY!');
    console.log('----------------------------------------------------');
    console.log('Pre-configured Credentials:');
    console.log('1. Admin:      admin@pharmacy.com      / Admin@123');
    console.log('2. Pharmacist: pharmacist@pharmacy.com / Pharma@123');
    console.log('3. Cashier:    cashier@pharmacy.com    / Cashier@123');
    console.log('----------------------------------------------------');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('[Seed Error]:', error);
    process.exit(1);
  }
};

seed();
