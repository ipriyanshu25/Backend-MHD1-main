const express = require('express');
const router = express.Router();
const { register, login ,submitEntry} = require('../controllers/userController');

// Register endpoint
router.post('/register', register);

// Login endpoint
router.post('/login', login);
router.post('/submitEntry',submitEntry);

module.exports = router;
