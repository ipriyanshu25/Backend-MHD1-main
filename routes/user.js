const express = require('express');
const router = express.Router();
const { register, login ,submitEntry,getAllUsers,getUserById,getUsersByEmployeeId , listLinksForUser} = require('../controllers/userController');

// Register endpoint
router.post('/register', register);

// Login endpoint
router.post('/login', login);
router.post('/submit',submitEntry);
router.get('/get',getAllUsers);
router.get('/getbyuserId/:userId',getUserById);
router.get('/getbyemployeeid/:employeeId',getUsersByEmployeeId);
// In routes/link.js (or user.js):
router.post('/linksstatus',listLinksForUser);

module.exports = router;
