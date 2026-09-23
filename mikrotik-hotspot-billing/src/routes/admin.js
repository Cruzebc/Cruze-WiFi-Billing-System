const express = require('express');
const db = require('../db');
const { testConnection } = require('../services/mikrotik');
const { normalizePhone } = require('../services/mpesa');

const router = express.Router();

/** GET /api/admin/orders - recent orders, newest first */
router.get('/orders', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100')
    .all();
  res.json(rows);
});

/** GET /api/admin/vouchers - all issued vouchers */
router.get('/vouchers', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM vouchers ORDER BY created_at DESC LIMIT 200')
    .all();
  res.json(rows);
});

/** GET /api/admin/vouchers/expiring-soon - vouchers not yet disconnected, soonest first */
router.get('/vouchers/expiring-soon', (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM vouchers WHERE disconnected = 0 AND expires_at IS NOT NULL
       ORDER BY expires_at ASC LIMIT 100`
    )
    .all();
  res.json(rows);
});

/** GET /api/admin/router-check - verifies the RouterOS API credentials/connectivity */
router.get('/router-check', async (req, res) => {
  try {
    const identity = await testConnection();
    res.json({ ok: true, routerIdentity: identity });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/admin/customers - one row per phone number, with purchase counts
 * and lifetime spend (only counting paid/provisioned orders, so abandoned
 * STK prompts don't inflate the numbers).
 */
router.get('/customers', (req, res) => {
  const rows = db
    .prepare(
      `SELECT phone,
              COUNT(*) AS total_orders,
              SUM(CASE WHEN status IN ('paid', 'provisioned') THEN amount ELSE 0 END) AS total_spent_kes,
              MAX(created_at) AS last_order_at
       FROM orders
       GROUP BY phone
       ORDER BY last_order_at DESC`
    )
    .all();
  res.json(rows);
});

/** GET /api/admin/customers/:phone - full order history for one number */
router.get('/customers/:phone', (req, res) => {
  const phone = normalizePhone(req.params.phone);
  const rows = db
    .prepare('SELECT * FROM orders WHERE phone = ? ORDER BY created_at DESC')
    .all(phone);
  res.json(rows);
});

module.exports = router;
