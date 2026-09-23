const express = require('express');
const db = require('../db');
const { getPackage } = require('../packages');
const { createHotspotUser } = require('../services/mikrotik');
const { randomCode, generateUniqueVoucherCode } = require('./vouchers');
const { parseDurationToMs } = require('../utils/duration');

const router = express.Router();

/**
 * POST /api/mpesa/callback
 * This is the CallBackURL you set in .env / your STK push request.
 * Safaricom calls this once the customer accepts/rejects/times out on the
 * STK prompt. Must be publicly reachable over HTTPS (use ngrok in dev).
 */
router.post('/callback', async (req, res) => {
  // Always ack Safaricom immediately so they don't retry; do the real work below.
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback) {
      console.warn('[mpesa/callback] Unexpected payload shape:', JSON.stringify(req.body));
      return;
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    const order = db
      .prepare('SELECT * FROM orders WHERE checkout_request_id = ?')
      .get(CheckoutRequestID);

    if (!order) {
      console.warn('[mpesa/callback] No matching order for', CheckoutRequestID);
      return;
    }

    if (ResultCode !== 0) {
      db.prepare(
        `UPDATE orders SET status = 'failed', failure_reason = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(ResultDesc, order.id);
      return;
    }

    // Payment succeeded. Pull the M-Pesa receipt number out of the metadata array.
    const items = CallbackMetadata?.Item || [];
    const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value || null;

    db.prepare(
      `UPDATE orders SET status = 'paid', mpesa_receipt = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(receipt, order.id);

    // Provision the voucher on the router.
    const pkg = getPackage(order.package_id);
    if (!pkg) {
      db.prepare(
        `UPDATE orders SET status = 'failed', failure_reason = 'Unknown package at provisioning time', updated_at = datetime('now') WHERE id = ?`
      ).run(order.id);
      return;
    }

    const code = generateUniqueVoucherCode();
    const voucherPassword = randomCode(6);

    await createHotspotUser({
      username: code,
      password: voucherPassword,
      profile: pkg.mikrotikProfile,
      limitUptime: pkg.limitUptime,
      comment: `order:${order.id} phone:${order.phone}`,
    });

    // limit-uptime already caps *actual connected minutes* at the router
    // level. This expires_at is the separate calendar backstop: e.g. a "24
    // Hour Access" pass should stop working 24 hours after purchase even if
    // the customer barely used it. A background job (src/jobs/expireVouchers.js)
    // enforces this side.
    const durationMs = parseDurationToMs(pkg.limitUptime);
    const expiresAt = durationMs
      ? new Date(Date.now() + durationMs).toISOString()
      : null;

    db.prepare(
      `INSERT INTO vouchers (code, order_id, package_id, mikrotik_username, mikrotik_password, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(code, order.id, pkg.id, code, voucherPassword, expiresAt);

    db.prepare(
      `UPDATE orders SET status = 'provisioned', voucher_code = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(code, order.id);

    console.log(`[mpesa/callback] Provisioned voucher ${code} for order ${order.id}`);
  } catch (err) {
    console.error('[mpesa/callback] Error handling callback:', err);
  }
});

module.exports = router;
