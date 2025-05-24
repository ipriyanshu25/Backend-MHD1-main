// controllers/admin.controller.js
const bcrypt = require('bcrypt');
const Admin = require('../models/Admin');
const Link = require('../models/Link');
const Entry = require('../models/Entry');
const Employee = require('../models/Employee');
const BalanceHistory = require('../models/BalanceHistory'); // Add this at the top

/* ------------------------------------------------------------------ */
/*  small helpers                                                     */
/* ------------------------------------------------------------------ */
const asyncHandler = fn => (req, res, next) => fn(req, res, next).catch(next);

const badRequest = (res, msg) => res.status(400).json({ error: msg });

const notFound = (res, msg) => res.status(404).json({ error: msg });

/* ------------------------------------------------------------------ */
/*  auth                                                              */
/* ------------------------------------------------------------------ */
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const admin = await Admin.findOne({ email }).select('+password'); // password is usually select:false
  if (!admin || !(await bcrypt.compare(password, admin.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ message: 'Admin login successful', adminId: admin.adminId });
});

/* ------------------------------------------------------------------ */
/*  links                                                             */
/* ------------------------------------------------------------------ */
exports.createLink = asyncHandler(async (req, res) => {
  const { title, adminId, target, amount, expireIn } = req.body;

  // Basic validation
  if (!adminId || target == null || amount == null || expireIn == null) {
    return badRequest(res, 'adminId, target, amount, and expireIn are required');
  }

  // Validate admin existence
  const adminExists = await Admin.exists({ adminId });
  if (!adminExists) return badRequest(res, 'Invalid adminId');

  // Create new link
  const link = await Link.create({
    title,
    createdBy: adminId,
    target,
    amount,
    expireIn, // in hours
  });

  res.json({ link: `/employee/links/${link._id}` });
});

exports.listLinks = asyncHandler(async (_req, res) => {
  const links = await Link.find()
    .select('title createdBy createdAt target amount expireIn')
    .lean();

  const updatedLinks = links.map(link => {
    const expireAt = new Date(link.createdAt);
    expireAt.setHours(expireAt.getHours() + (link.expireIn || 0)); // Add expireIn hours to createdAt
    return {
      ...link,
      expireAt,
    };
  });

  res.json(updatedLinks);
});

/* ------------------------------------------------------------------ */
/*  employees & entries                                               */
/* ------------------------------------------------------------------ */
exports.getEmployees = asyncHandler(async (_req, res) => {
  const employees = await Employee.find()
    .select('name email employeeId balance')
    .lean();
  res.json(employees);
});

exports.getEntries = asyncHandler(async (req, res) => {
  const { linkId } = req.body;
  if (!linkId) return badRequest(res, 'Invalid linkId');

  const entries = await Entry.find({ linkId }).lean();
  res.json(entries);
});

/* by employee ------------------------------------------------------ */
exports.getEmployeeEntries = asyncHandler(async (req, res) => {
  const { employeeId } = req.body;
  if (!employeeId) return badRequest(res, 'Invalid employeeId');

  const entries = await Entry.find({ employeeId }).lean();
  res.json(entries);
});

// ------------------------------------------------------------------
// Links for a single employee (paginated)
// Body: { employeeId, page = 1, limit = 20 }
// ------------------------------------------------------------------
exports.getLinksByEmployee = asyncHandler(async (req, res) => {
  const { employeeId, page = 1, limit = 20 } = req.body;
  if (!employeeId) return badRequest(res, 'employeeId required');

  /* 1️⃣  collect distinct linkIds this employee has entries in */
  const allIds = await Entry.distinct('linkId', { employeeId });
  const total = allIds.length;

  if (total === 0) {
    return res.json({ links: [], total: 0, page: 1, pages: 0 });
  }

  /* 2️⃣  slice for pagination */
  const skip = (page - 1) * limit;
  const pagedIds = allIds
    .sort()                             // ensures consistent order
    .slice(skip, skip + Number(limit));

  /* 3️⃣  fetch those links, newest first */
  const links = await Link.find({ _id: { $in: pagedIds } })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    links,
    total,
    page: Number(page),
    pages: Math.ceil(total / limit),
  });
});


// ------------------------------------------------------------------
// Submissions for employee + link (paginated)
// Body: { linkId, employeeId, page = 1, limit = 20 }
// ------------------------------------------------------------------
exports.getEntriesByEmployeeAndLink = asyncHandler(async (req, res) => {
  const { employeeId, linkId, page = 1, limit = 20 } = req.body;
  if (!employeeId || !linkId) {
    return badRequest(res, 'employeeId & linkId required');
  }

  const filter = { employeeId, linkId };

  const [entries, total] = await Promise.all([
    Entry.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Entry.countDocuments(filter),
  ]);

  const totalAmount = await Entry.aggregate([
    { $match: filter },
    { $group: { _id: null, sum: { $sum: '$amount' } } },
  ]).then(r => (r[0]?.sum ?? 0));

  res.json({
    entries,
    total,
    totalAmount,
    page: Number(page),
    pages: Math.ceil(total / limit),
  });
});


/* ------------------------------------------------------------------ */
/*  link summary                                                      */
/* ------------------------------------------------------------------ */
exports.getLinkSummary = asyncHandler(async (req, res) => {
  const { linkId } = req.body;
  if (!linkId) return badRequest(res, 'linkId required');

  // Fetch link with amount and title
  const linkDoc = await Link.findById(linkId).select('title amount').lean();
  if (!linkDoc) return notFound(res, 'Link not found');

  const amountPerPerson = linkDoc.amount || 25;

  // Aggregate total amount per employee
  const rows = await Entry.aggregate([
    { $match: { linkId } },
    {
      $group: {
        _id: '$employeeId',
        employeeTotal: { $sum: '$amount' },
      },
    },
    {
      $lookup: {
        from: 'employees',
        localField: '_id',
        foreignField: 'employeeId',
        as: 'emp',
      },
    },
    { $unwind: '$emp' },
    {
      $project: {
        _id: 0,
        employeeId: '$_id',
        name: '$emp.name',
        employeeTotal: 1,
        walletBalance: '$emp.balance',
      },
    },
  ]);

  // Calculate entryCount using employeeTotal / amountPerPerson
  for (const row of rows) {
    row.entryCount = Math.round(row.employeeTotal / amountPerPerson);
  }

  const grandTotal = rows.reduce((sum, r) => sum + r.employeeTotal, 0);

  res.json({ title: linkDoc.title, rows, grandTotal });
});


exports.deleteLink = asyncHandler(async (req, res) => {
  const { linkId } = req.body;

  if (!linkId) return badRequest(res, 'linkId required');

  // Check if the link exists
  const link = await Link.findById(linkId);
  if (!link) return notFound(res, 'Link not found');

  // Delete the link
  await Link.findByIdAndDelete(linkId);

  res.json({ message: 'Link deleted successfully' });
});

exports.addEmployeeBalance = asyncHandler(async (req, res) => {
  const { employeeId, amount, adminId, note = '' } = req.body;

  if (!employeeId || !amount || !adminId) {
    return badRequest(res, 'employeeId, amount and adminId are required');
  }

  const employee = await Employee.findOne({ employeeId });
  if (!employee) return notFound(res, 'Employee not found');

  // Update employee balance
  employee.balance = (employee.balance || 0) + amount;
  await employee.save();

  // Save history
  await BalanceHistory.create({
    employeeId,
    amount,
    addedBy: adminId,
    note,
  });

  res.json({ message: 'Balance added successfully', newBalance: employee.balance });
});

// controllers/balanceController.js
exports.updateEmployeeBalance = asyncHandler(async (req, res) => {
  const { employeeId, newBalance, adminId, note = '' } = req.body;

  if (!employeeId || newBalance === undefined || adminId === undefined) {
    return badRequest(res, 'employeeId, newBalance and adminId are required');
  }

  const employee = await Employee.findOne({ employeeId });
  if (!employee) return notFound(res, 'Employee not found');

  const oldBalance = employee.balance || 0;
  employee.balance = newBalance;
  await employee.save();

  // Save history
  await BalanceHistory.create({
    employeeId,
    amount: newBalance - oldBalance, // delta
    addedBy: adminId,
    note: `Balance updated from ₹${oldBalance} to ₹${newBalance}. ${note}`,
  });

  res.json({
    message: 'Balance updated successfully',
    oldBalance,
    newBalance,
  });
});


exports.getBalanceHistory = asyncHandler(async (req, res) => {
  const { employeeId, page = 1, limit = 20 } = req.body;

  const filter = employeeId ? { employeeId } : {};

  const [history, total, sumResult] = await Promise.all([
    BalanceHistory.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    BalanceHistory.countDocuments(filter),
    BalanceHistory.aggregate([
      { $match: filter },
      { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
    ]),
  ]);

  const totalAmount = sumResult[0]?.totalAmount || 0;

  res.json({
    history,
    total,
    totalAmount,
    page: Number(page),
    pages: Math.ceil(total / limit),
  });
});

// Bulk add the same amount to multiple employees
exports.bulkAddEmployeeBalance = asyncHandler(async (req, res) => {
  const { employeeIds, amount, adminId, note = '' } = req.body;
  if (
    !Array.isArray(employeeIds) ||
    employeeIds.length === 0 ||
    typeof amount !== 'number' ||
    !adminId
  ) {
    return badRequest(res, 'employeeIds (non-empty array), amount (number) and adminId are required');
  }

  // Process all in parallel
  const results = await Promise.all(employeeIds.map(async (eid) => {
    const emp = await Employee.findOne({ employeeId: eid });
    if (!emp) return { employeeId: eid, error: 'Not found' };

    emp.balance = (emp.balance || 0) + amount;
    await emp.save();

    await BalanceHistory.create({
      employeeId: eid,
      amount,
      addedBy: adminId,
      note: note || 'Bulk add',
    });

    return { employeeId: eid, newBalance: emp.balance };
  }));

  res.json({
    message: 'Bulk add complete',
    results
  });
});

// Bulk overwrite balance for multiple employees
exports.bulkUpdateEmployeeBalance = asyncHandler(async (req, res) => {
  const { employeeIds, newBalance, adminId, note = '' } = req.body;
  if (
    !Array.isArray(employeeIds) ||
    employeeIds.length === 0 ||
    typeof newBalance !== 'number' ||
    newBalance < 0 ||
    !adminId
  ) {
    return badRequest(res, 'employeeIds (non-empty array), newBalance (non-negative number) and adminId are required');
  }

  const results = await Promise.all(employeeIds.map(async (eid) => {
    const emp = await Employee.findOne({ employeeId: eid });
    if (!emp) return { employeeId: eid, error: 'Not found' };

    const oldBal = emp.balance || 0;
    emp.balance = newBalance;
    await emp.save();

    await BalanceHistory.create({
      employeeId: eid,
      amount: newBalance - oldBal,  // record the delta
      addedBy: adminId,
      note: `Bulk update from ₹${oldBal} to ₹${newBalance}. ` + note,
    });

    return { employeeId: eid, oldBalance: oldBal, newBalance };
  }));

  res.json({
    message: 'Bulk update complete',
    results
  });
});
