const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Employee = require('../models/Employee'); // use capital E to match file

exports.register = async (req, res) => {
  try {
    const { name, phone, email, password, worksUnder, upiId } = req.body;
    if (!name || !phone || !email || !password || !worksUnder || !upiId) {
      return res.status(400).json({ message: 'Please provide name, phone, email, password, worksUnder (employeeId), and upiId.' });
    }

    // Validate manager exists
    const manager = await Employee.findOne({ employeeId: worksUnder });
    if (!manager) {
      return res.status(404).json({ message: 'No employee exists with the provided ID.' });
    }

    // Validate phone
    const phoneNum = Number(phone);
    if (!Number.isInteger(phoneNum)) {
      return res.status(400).json({ message: 'Phone number must be numeric.' });
    }

    // Check existing users by phone, email or upiId
    const exists = await User.findOne({ $or: [{ phone: phoneNum }, { email }, { upiId }] });
    if (exists) {
      return res.status(400).json({ message: 'User with that phone, email, or UPI ID already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // Create user
    const user = new User({ name, phone: phoneNum, email, password: hash, worksUnder, upiId });
    await user.save();

    res.status(201).json({ message: 'User registered successfully.', userId: user.userId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};

exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ message: 'Please provide phone and password.' });
    }

    const phoneNum = Number(phone);
    if (!Number.isInteger(phoneNum)) {
      return res.status(400).json({ message: 'Phone number must be numeric.' });
    }

    const user = await User.findOne({ phone: phoneNum });
    if (!user) return res.status(400).json({ message: 'Invalid credentials.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Invalid credentials.' });

    const token = jwt.sign({ userId: user.userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};