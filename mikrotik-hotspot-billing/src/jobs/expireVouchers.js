const cron = require('node-cron');
const db = require('../db');
const { disconnectAndRemoveUser } = require('../services/mikrotik');

/**
 * Runs every minute. Finds vouchers whose calendar validity window has
 * passed and haven't been cleaned up yet, kicks their active session on the
 * router (if any), removes the hotspot user so the code can't be reused,
 * and marks them disconnected so we don't retry forever.
 */
function startExpiryJob() {
  cron.schedule('* * * * *', async () => {
    const expired = db
      .prepare(
        `SELECT * FROM vouchers
         WHERE disconnected = 0
           AND expires_at IS NOT NULL
           AND expires_at <= datetime('now')`
      )
      .all();

    if (expired.length === 0) return;

    for (const voucher of expired) {
      try {
        const result = await disconnectAndRemoveUser(voucher.mikrotik_username);
        db.prepare('UPDATE vouchers SET disconnected = 1 WHERE code = ?').run(voucher.code);
        console.log(
          `[expiry-job] ${voucher.code} expired — disconnected=${result.disconnected} removed=${result.removed}`
        );
      } catch (err) {
        // Leave disconnected = 0 so we retry next minute (router might be
        // temporarily unreachable).
        console.error(`[expiry-job] Failed to clean up ${voucher.code}:`, err.message);
      }
    }
  });

  console.log('[expiry-job] Scheduled: checking for expired vouchers every minute.');
}

module.exports = { startExpiryJob };
