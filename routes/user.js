const express = require('express');
const router = express.Router();
const { 
    register,
    login,
    submitEntry,
    getAllUsers,
    getUserById,
    getUsersByEmployeeId,
    listLinksForUser,
    updateUser,
    updateEntry,
    setEntryStatus
} = require('../controllers/userController');

// Register endpoint
router.post('/register', register);

// Login endpoint
router.post('/login', login);
router.post('/submit', submitEntry);
router.get('/get', getAllUsers);
router.get('/getbyuserId/:userId', getUserById);
router.get('/getbyemployeeid/:employeeId', getUsersByEmployeeId);

router.post('/link', listLinksForUser);
router.post('/update', updateUser);
router.post('/updateentry', updateEntry);
router.post('/setstatus', setEntryStatus);

module.exports = router;
