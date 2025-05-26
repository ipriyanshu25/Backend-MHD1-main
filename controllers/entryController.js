// controllers/entryController.js
const { v4: uuidv4 } = require('uuid');
const { PNG }        = require('pngjs');
const { Jimp }       = require('jimp');
const QrCode         = require('qrcode-reader');
const { parse }      = require('querystring');

const Entry     = require('../models/Entry');
const Link      = require('../models/Link');
const Employee  = require('../models/Employee');
const User      = require('../models/User');

const asyncHandler = fn => (req, res, next) => fn(req, res, next).catch(next);
const badRequest   = (res, msg) => res.status(400).json({ error: msg });
const notFound     = (res, msg) => res.status(404).json({ error: msg });

function isValidUpi(upi) {
  return /^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+$/.test(upi);
}

/* ------------------------------------------------------------------ */
/*  1) CREATE by employee (type 0)                                     */
/*     - manual UPI or QR decode                                       */
/* ------------------------------------------------------------------ */
exports.createEmployeeEntry = asyncHandler(async (req, res) => {
  const { name, amount, employeeId, notes = '', upiId: manualUpi } = req.body;
  const { linkId } = req.body;
  if (!name || amount == null || !employeeId || !linkId)
    return badRequest(res, 'employeeId, linkId, name & amount required');

  // determine UPI
  let upiId = manualUpi?.trim();
  if (!upiId && req.file) {
    // decode QR
    try {
      const img = await Jimp.read(req.file.buffer);
      const upiString = await new Promise((resolve, reject) => {
        const qr = new QrCode();
        let done = false;
        qr.callback = (err, value) => {
          if (done) return;
          done = true;
          if (err || !value) return reject(new Error('QR decode failed'));
          resolve(value.result);
        };
        qr.decode(img.bitmap);
        setTimeout(() => !done && reject(new Error('QR decode timeout')), 5000);
      });
      upiId = upiString.startsWith('upi://')
        ? parse(upiString.split('?')[1]).pa
        : upiString.trim();
    } catch (e) {
      return badRequest(res, 'Invalid or unreadable QR code');
    }
  }

  if (!upiId)             return badRequest(res, 'UPI ID is required');
  if (!isValidUpi(upiId)) return badRequest(res, 'Invalid UPI format');

  const emp = await Employee.findOne({ employeeId });
  if (!emp) return notFound(res, 'Employee not found');
  if (emp.balance < amount) return badRequest(res, 'Insufficient balance');

  // prevent duplicate UPI on same link
  if (await Entry.exists({ linkId, upiId }))
    return badRequest(res, 'This UPI ID has already been used for this link');

  const entry = await Entry.create({
    entryId: uuidv4(),
    type: 0,
    employeeId,
    linkId,
    name: name.trim(),
    upiId,
    amount,
    notes: notes.trim()
  });

  emp.balance -= amount;
  await emp.save();

  res.status(201).json({ message: 'Employee entry submitted', entry });
});

/* ------------------------------------------------------------------ */
/*  2) CREATE by user (type 1)                                         */
/*     - verify user exists + matches UPI                               */
/* ------------------------------------------------------------------ */
exports.createUserEntry = asyncHandler(async (req, res) => {
  const { userId, linkId, name, upiId, noOfPersons, telegramLink } = req.body;
  if (!userId || !linkId || !name || !upiId || !noOfPersons || !telegramLink)
    return badRequest(res, 'userId, linkId, name, upiId, noOfPersons & telegramLink required');

  const user = await User.findOne({ userId });
  if (!user) return notFound(res, 'User not found');
  if (user.upiId !== upiId.trim())
    return badRequest(res, 'Provided UPI does not match your account');

  const link = await Link.findById(linkId).lean();
  if (!link) return notFound(res, 'Invalid linkId');

  // prevent duplicate by same user or reuse of UPI
  if (await Entry.exists({ type: 1, userId, linkId }))
    return badRequest(res, 'You have already submitted for this link');
  if (await Entry.exists({ linkId, upiId: upiId.trim() }))
    return badRequest(res, 'This UPI ID has already been used for this link');

  const totalAmount = link.amount * Number(noOfPersons);

  const entry = await Entry.create({
    entryId: uuidv4(),
    type: 1,
    userId,
    linkId,
    name: name.trim(),
    upiId: upiId.trim(),
    noOfPersons: Number(noOfPersons),
    linkAmount: link.amount,
    totalAmount,
    telegramLink: telegramLink.trim()
  });

  res.status(201).json({ message: 'User entry submitted', entry });
});

/* ------------------------------------------------------------------ */
/*  3) READ / LIST (type-aware, optional link filter)                  */
/*     ➜ POST /entries/list                                           */
/* ------------------------------------------------------------------ */
exports.listEntries = asyncHandler(async (req, res) => {
  const { type, employeeId, userId, linkId, page = 1, limit = 20 } = req.body;
  const t = Number(type);
  let filter = {};

  if (t === 0) {
    if (!employeeId) return badRequest(res, 'employeeId required');
    filter = { type: 0, employeeId };
  } else if (t === 1) {
    if (!userId) return badRequest(res, 'userId required');
    filter = { type: 1, userId };
  } else if (t === 2) {
    // admin – all entries
  } else {
    return badRequest(res, 'type must be 0, 1 or 2');
  }

  if (linkId) filter.linkId = linkId;

  const [entries, total] = await Promise.all([
    Entry.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    Entry.countDocuments(filter)
  ]);

  res.json({
    entries,
    total,
    page: Number(page),
    pages: Math.ceil(total / limit)
  });
});

/* ------------------------------------------------------------------ */
/*  4) FETCH single by entryId                                         */
/* ------------------------------------------------------------------ */
exports.getEntryById = asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const entry = await Entry.findOne({ entryId }).lean();
  if (!entry) return notFound(res, 'Entry not found');
  res.json({ entry });
});

/* ------------------------------------------------------------------ */
/*  5) UPDATE – employee can edit name/UPI/amount/notes                */
/*             user can only change head-count                         */
/* ------------------------------------------------------------------ */
exports.updateEntry = asyncHandler(async (req, res) => {
  const { entryId, name, upiId, notes, amount, noOfPersons } = req.body;
  if (!entryId) return badRequest(res, 'entryId required');

  const entry = await Entry.findOne({ entryId });
  if (!entry) return notFound(res, 'Entry not found');

  if (entry.type === 0) {
    // employee flow
    if (!name || !upiId || amount == null)
      return badRequest(res, 'name, upiId & amount required for employee entries');

    if (!isValidUpi(upiId.trim()))
      return badRequest(res, 'Invalid UPI format');

    const emp = await Employee.findOne({ employeeId: entry.employeeId });
    if (!emp) return notFound(res, 'Employee not found');

    const diff = amount - entry.amount;
    if (diff > 0 && emp.balance < diff)
      return badRequest(res, 'Insufficient balance');

    entry.name       = name.trim();
    entry.upiId      = upiId.trim();
    entry.notes      = (notes || '').trim();
    entry.amount     = amount;
    emp.balance     -= diff;
    await emp.save();

  } else {
    // user flow
    if (noOfPersons == null)
      return badRequest(res, 'noOfPersons required for user entries');

    entry.noOfPersons = Number(noOfPersons);
    entry.totalAmount = entry.noOfPersons * entry.linkAmount;
  }

  await entry.save();
  res.json({ message: 'Entry updated', entry });
});

/* ------------------------------------------------------------------ */
/*  6) APPROVE / REJECT                                               */
/* ------------------------------------------------------------------ */
exports.setEntryStatus = asyncHandler(async (req, res) => {
  const { entryId, approve } = req.body;
  if (!entryId)                 return badRequest(res, 'entryId required');
  if (![0, 1].includes(Number(approve)))
    return badRequest(res, 'approve must be 0 or 1');

  const entry = await Entry.findOneAndUpdate(
    { entryId },
    { status: Number(approve) },
    { new: true }
  );
  if (!entry) return notFound(res, 'Entry not found');

  res.json({
    message: approve ? 'Approved' : 'Rejected',
    entry: { entryId: entry.entryId, status: entry.status }
  });
});
