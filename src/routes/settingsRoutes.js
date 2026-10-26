const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { authenticate, authorizeRoles } = require('../middleware/auth');

router.use(authenticate);

router.route('/')
  .get(getSettings)
  .put(authorizeRoles('admin'), updateSettings);

module.exports = router;
