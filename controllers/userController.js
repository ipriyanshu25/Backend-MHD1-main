const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Employee = require('../models/Employee'); // use capital E to match file
const Link   = require('../models/Link'); 

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
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    // Authentication successful — return userId
    return res.status(200).json({ message:"Login Successful",userId: user.userId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error.' });
  }
};


exports.submitEntry = async (req, res) => {
  try {
    const { userId, name, upiId, linkId, noOfPersons,telegramLink } = req.body;
    if (!userId || !name || !upiId || !linkId || !noOfPersons || !telegramLink) {
      return res.status(400).json({ message: 'Provide userId, name, upiId, linkId and noOfPersons.' });
    }

    // 1. Fetch the link by its _id and amount
    const link = await Link.findById(linkId);
    if (!link) {
      return res.status(404).json({ message: 'Invalid linkId.' });
    }
    const linkAmount = link.amount;

    // 2. Calculate totalAmount
    const totalAmount = noOfPersons * linkAmount;

    // 3. Verify user exists and UPI matches
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'No user found with that userId.' });
    }
    if (user.upiId !== upiId) {
      return res.status(400).json({ message: 'Provided UPI ID does not match your account.' });
    }

    // 4. Prevent duplicate entry by same user
    if (user.entries.some(entry => entry.linkId.toString() === linkId)) {
      return res.status(400).json({ message: 'You have already submitted for this link.' });
    }

    // 5. Prevent reuse of same UPI by another user
    const conflict = await User.findOne({
      'entries.linkId': linkId,
      'entries.upiId': upiId
    });
    if (conflict) {
      return res.status(400).json({ message: 'This link has already been claimed with that UPI ID.' });
    }

    // 6. Prepare new entry and push via updateOne (avoids validating existing entries)
    const newEntry = { linkId, noOfPersons, upiId, name, userId,telegramLink, linkAmount, totalAmount, submittedAt: new Date() };
    await User.updateOne(
      { userId },
      { $push: { entries: newEntry } }
    );

    // 7. Return response with the newly created entry
    return res.status(201).json({ message: 'Entry submitted successfully.', entry: newEntry });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error.' });
  }
};


exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}, '-password -__v').lean();
    res.status(200).json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};


exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: 'Please provide a userId.' });
    }
    // Fetch user
    const user = await User.findOne({ userId }, '-password -__v').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    // Fetch manager name
    const manager = await Employee.findOne({ employeeId: user.worksUnder }, 'name').lean();
    user.worksUnderName = manager ? manager.name : null;

    // Fetch link titles for each entry
    if (user.entries && user.entries.length) {
      const entriesWithTitles = await Promise.all(
        user.entries.map(async entry => {
          const linkDoc = await Link.findById(entry.linkId, 'title').lean();
          return {
            ...entry,
            linkTitle: linkDoc ? linkDoc.title : null
          };
        })
      );
      user.entries = entriesWithTitles;
    }

    res.status(200).json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};

exports.getUsersByEmployeeId = async (req, res) => {
  try {
    const { employeeId } = req.params;
    if (!employeeId) {
      return res.status(400).json({ message: 'Please provide an employeeId.' });
    }
    // Find users who work under the given employee
    const users = await User.find(
      { worksUnder: employeeId },
      '-password -__v'
    ).lean();
    res.status(200).json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};


exports.listLinksForUser = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'Please provide userId.' });
    }

    // Fetch all links
    const links = await Link.find().lean();
    if (links.length === 0) {
      return res.json([]);
    }

    // Determine the latest link
    const latestLink = links.reduce((prev, curr) =>
      new Date(prev.createdAt) > new Date(curr.createdAt) ? prev : curr
    );
    const latestId = latestLink._id.toString();

    // Fetch user's completed link IDs
    const user = await User.findOne({ userId }, 'entries').lean();
    const completedSet = new Set(
      (user && user.entries || []).map(entry => entry.linkId.toString())
    );

    // Annotate links
    const annotated = links.map(link => ({
      ...link,
      isLatest: link._id.toString() === latestId,
      isCompleted: completedSet.has(link._id.toString()) ? 1 : 0
    }));

    // Return in reverse order
    return res.json(annotated.reverse());
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error.' });
  }
};


// controllers/UserController.js

exports.updateUser = async (req, res) => {
  try {
    const { userId, name, upiId } = req.body;

    // 1) Must have userId
    if (!userId) {
      return res.status(400).json({ message: 'Please provide userId.' });
    }
    // 2) Must have something to update
    if (!name && !upiId) {
      return res.status(400).json({ message: 'Provide at least one of name or upiId to update.' });
    }

    // 3) If upiId is changing, ensure it's not in use
    if (upiId) {
      const conflict = await User.findOne({ upiId });
      if (conflict && conflict.userId !== userId) {
        return res.status(400).json({ message: 'This UPI ID is already in use.' });
      }
    }

    // 4) Build the $set payload
    const updates = {};
    if (name)  updates.name  = name;
    if (upiId) updates.upiId = upiId;

    // 5) Atomic update (won't re-validate every sub-document)
    const updatedUser = await User.findOneAndUpdate(
      { userId },
      { $set: updates },
      { new: true, projection: { password: 0, __v: 0 } }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // 6) Return only the changed bits
    return res.status(200).json({
      message: 'User updated successfully.',
      user: {
        userId: updatedUser.userId,
        name: updatedUser.name,
        upiId: updatedUser.upiId
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error.' });
  }
};
