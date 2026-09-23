const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db = require('../db');
const { getPackage, PACKAGES } = require('../packages');
const { stkPush, normalizePhone } = require('../services/mpesa');

const router = express.Router();

function randomCode(length = 8) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no confusing 0/O/1/I
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[crypto.randomInt(chars.length)];
  }
  return out;
}

/**
 * Generates a voucher code, retrying on the (astronomically unlikely, but
 * not impossible) chance of a collision with an existing code.
 */
function generateUniqueVoucherCode(length = 8, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const code = randomCode(length);
    const exists = db.prepare('SELECT 1 FROM vouchers WHERE code = ?').get(code);
    if (!exists) return code;
  }
  throw new Error('Could not generate a unique voucher code after multiple attempts');
}

/** GET /api/vouchers/packages - list what's available to buy */
router.get('/packages', (req, res) => {
  res.json(PACKAGES);
});

/**
 * POST /api/vouchers/purchase
 * body: { phone: "0712345678", packageId: "daily-50" }
 * Kicks off an M-Pesa STK push. The voucher is created once the payment
 * callback confirms success (see routes/mpesa.js).
 */
router.post('/purchase', async (req, res) => {
  const { phone, packageId } = req.body || {};
  if (!phone || !packageId) {
    return res.status(400).json({ error: 'phone and packageId are required' });
  }

  const pkg = getPackage(packageId);
  if (!pkg) {
    return res.status(404).json({ error: `Unknown packageId: ${packageId}` });
  }

  const orderId = uuidv4();
  const normalizedPhone = normalizePhone(phone);

  try {
    const stk = await stkPush({
      phone,
      amount: pkg.priceKes,
      accountReference: orderId,
      transactionDesc: pkg.name,
    });

    if (stk.ResponseCode !== '0') {
      return res.status(502).json({ error: 'M-Pesa rejected the request', detail: stk });
    }

    db.prepare(
      `INSERT INTO orders (id, phone, package_id, amount, status, checkout_request_id, merchant_request_id)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    ).run(orderId, normalizedPhone, packageId, pkg.priceKes, stk.CheckoutRequestID, stk.MerchantRequestID);

    res.json({
      orderId,
      checkoutRequestId: stk.CheckoutRequestID,
      message: 'STK push sent. Ask the customer to enter their M-Pesa PIN, then poll /status.',
    });
  } catch (err) {
    console.error('[vouchers/purchase] failed:', err.response?.data || err.message);
    res.status(502).json({ error: 'Failed to initiate payment', detail: err.response?.data || err.message });
  }
});

/**
 * GET /api/vouchers/status/:checkoutRequestId
 * Poll this from the captive portal page after purchase until status is
 * 'provisioned' (voucher ready) or 'failed'.
 */
router.get('/status/:checkoutRequestId', (req, res) => {
  const order = db
    .prepare('SELECT * FROM orders WHERE checkout_request_id = ?')
    .get(req.params.checkoutRequestId);

  if (!order) return res.status(404).json({ error: 'Order not found' });

  let voucherPassword = null;
  if (order.voucher_code) {
    const voucher = db
      .prepare('SELECT mikrotik_password FROM vouchers WHERE code = ?')
      .get(order.voucher_code);
    voucherPassword = voucher?.mikrotik_password || null;
  }

  res.json({
    status: order.status,
    voucherCode: order.voucher_code || null,
    voucherPassword,
    failureReason: order.failure_reason || null,
  });
});

/**
 * GET /api/vouchers/history/:phone
 * Public, unauthenticated lookup used by the captive portal to show a
 * "welcome back" note. Deliberately returns only non-sensitive summary data
 * (no amounts, no M-Pesa receipts) since anyone who knows a phone number can
 * call this. If abuse becomes a concern, rate-limit this route.
 */
router.get('/history/:phone', (req, res) => {
  const phone = normalizePhone(req.params.phone);

  const orders = db
    .prepare(
      `SELECT o.created_at, o.package_id, v.expires_at, v.disconnected
       FROM orders o
       LEFT JOIN vouchers v ON v.order_id = o.id
       WHERE o.phone = ?
       ORDER BY o.created_at DESC`
    )
    .all(phone);

  if (orders.length === 0) {
    return res.json({ hasPurchasedBefore: false });
  }

  const last = orders[0];
  res.json({
    hasPurchasedBefore: true,
    totalPurchases: orders.length,
    lastPurchaseAt: last.created_at,
    lastPackageId: last.package_id,
    lastVoucherExpired: last.disconnected === 1,
    lastVoucherExpiresAt: last.expires_at || null,
  });
});

module.exports = { router, randomCode, generateUniqueVoucherCode };
