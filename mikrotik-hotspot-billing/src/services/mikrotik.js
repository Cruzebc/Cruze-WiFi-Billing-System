const { RouterOSAPI } = require('node-routeros');
const config = require('../config');

/**
 * Opens a fresh connection to the router. We connect per-operation rather
 * than holding a long-lived pool, since voucher creation is low-frequency
 * and this avoids dealing with reconnect/keepalive logic.
 */
async function connect() {
  const conn = new RouterOSAPI({
    host: config.mikrotik.host,
    port: config.mikrotik.port,
    user: config.mikrotik.user,
    password: config.mikrotik.password,
    tls: config.mikrotik.tls ? {} : undefined,
    timeout: 10,
  });
  await conn.connect();
  return conn;
}

/**
 * Creates a hotspot user (voucher) on the router.
 * @param {Object} opts
 * @param {string} opts.username
 * @param {string} opts.password
 * @param {string} opts.profile - must match an existing hotspot user profile
 * @param {string} [opts.limitUptime] - e.g. "24h"
 * @param {string} [opts.comment]
 */
async function createHotspotUser({ username, password, profile, limitUptime, comment }) {
  const conn = await connect();
  try {
    const params = [
      `=name=${username}`,
      `=password=${password}`,
      `=profile=${profile}`,
    ];
    if (limitUptime) params.push(`=limit-uptime=${limitUptime}`);
    if (config.mikrotik.hotspotServer) {
      params.push(`=server=${config.mikrotik.hotspotServer}`);
    }
    if (comment) params.push(`=comment=${comment}`);

    await conn.write('/ip/hotspot/user/add', params);
    return true;
  } finally {
    conn.close();
  }
}

/** Removes a hotspot user, e.g. for cleanup/expiry jobs. */
async function removeHotspotUser(username) {
  const conn = await connect();
  try {
    const found = await conn.write('/ip/hotspot/user/print', [
      `?name=${username}`,
    ]);
    if (found.length > 0) {
      await conn.write('/ip/hotspot/user/remove', [`=.id=${found[0]['.id']}`]);
    }
  } finally {
    conn.close();
  }
}

/**
 * Forcibly disconnects a customer whose calendar validity has expired, then
 * removes the hotspot user record so the same voucher code can't be used to
 * log back in. Safe to call even if the user isn't currently connected.
 */
async function disconnectAndRemoveUser(username) {
  const conn = await connect();
  try {
    // Kick any live session first — removing the user record alone does NOT
    // drop an already-connected client, since RouterOS tracks active
    // sessions (/ip/hotspot/active) separately from user records.
    const activeSessions = await conn.write('/ip/hotspot/active/print', [
      `?user=${username}`,
    ]);
    for (const session of activeSessions) {
      await conn.write('/ip/hotspot/active/remove', [`=.id=${session['.id']}`]);
    }

    const users = await conn.write('/ip/hotspot/user/print', [
      `?name=${username}`,
    ]);
    for (const user of users) {
      await conn.write('/ip/hotspot/user/remove', [`=.id=${user['.id']}`]);
    }

    return { disconnected: activeSessions.length > 0, removed: users.length > 0 };
  } finally {
    conn.close();
  }
}

/** Quick connectivity/credentials check, useful for a health-check route. */
async function testConnection() {
  const conn = await connect();
  try {
    const identity = await conn.write('/system/identity/print');
    return identity[0]?.name || 'connected';
  } finally {
    conn.close();
  }
}

module.exports = { createHotspotUser, removeHotspotUser, disconnectAndRemoveUser, testConnection };
