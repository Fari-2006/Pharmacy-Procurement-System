const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./src/config/db');
const errorHandler = require('./src/middleware/errorHandler');

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

// Body Parser Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS
app.use(cors());

// Serve Static Frontend Assets
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    system: 'Pharmacy Stock Management System',
    timestamp: new Date().toISOString()
  });
});

// Serve uploaded files (attachments)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount API Routes
app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/users', require('./src/routes/userRoutes'));
app.use('/api/medicines', require('./src/routes/medicineRoutes'));
app.use('/api/sales', require('./src/routes/saleRoutes'));
app.use('/api/suppliers', require('./src/routes/supplierRoutes'));
app.use('/api/dashboard', require('./src/routes/dashboardRoutes'));
app.use('/api/settings', require('./src/routes/settingsRoutes'));
app.use('/api/notifications', require('./src/routes/notificationRoutes'));
app.use('/api/purchase-orders', require('./src/routes/purchaseOrderRoutes'));
app.use('/api/goods-receipts', require('./src/routes/goodsReceiptRoutes'));
app.use('/api/returns', require('./src/routes/supplierReturnRoutes'));
app.use('/api/supplier-invoices', require('./src/routes/supplierInvoiceRoutes'));
app.use('/api/attachments', require('./src/routes/attachmentRoutes'));

// Fallback to SPA index.html for non-API client routes
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ success: false, message: 'API Endpoint not found' });
  }
});

// Global Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[Pharmacy Server] Running on http://localhost:${PORT}`);
  console.log(`[Pharmacy Server] Environment: ${process.env.NODE_ENV || 'development'}`);
});
