const express = require('express');
const router = express.Router();
const { register, login ,submitEntry,getAllUsers,getUserById} = require('../controllers/userController');

// Register endpoint
router.post('/register', register);

// Login endpoint
router.post('/login', login);
router.post('/submit',submitEntry);
router.get('/get',getAllUsers);
router.get('/getbyuserId/:userId',getUserById);

module.exports = router;
