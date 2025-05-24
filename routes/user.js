const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/userController');

// Register endpoint
router.post('/register', register);

// Login endpoint
router.post('/login', login);

module.exports = router;
