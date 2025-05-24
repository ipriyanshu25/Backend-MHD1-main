const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const entrySchema = new mongoose.Schema({
  linkId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Link', required: true },
  noOfPersons: { type: Number, required: true, min: [1, 'At least one person required'] },
  name:        { type: String, required: true },
  userId:      { type: String, required: true },
  upiId:       { type: String, required: true },
  linkAmount:  { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  submittedAt: { type: Date,   default: Date.now }
}, { _id: false });

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, default: uuidv4 },
    name: { type: String, required: true },
    phone: {
        type: Number,
        required: true,
        unique: true,
        validate: {
            validator: Number.isInteger,
            message: 'Phone number must be an integer.'
        }
    },
    email: {
        type: String,
        required: true,
        unique: true,
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please fill a valid email address']
    },
    password: { type: String, required: true },
    worksUnder: { type: String, required: true, ref: 'Employee' },
    upiId: { type: String, required: true, unique: true },

    // ← new: embedded entries
    entries: [entrySchema]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
