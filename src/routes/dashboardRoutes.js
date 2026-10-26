const express = require('express');
const router = express.Router();
const { getDashboardStats } = require('../controllers/dashboardController');
const { authenticate, authorizeRoles } = require('../middleware/auth');

router.use(authenticate, authorizeRoles('admin', 'pharmacist'));

router.get('/stats', getDashboardStats);

module.exports = router;
