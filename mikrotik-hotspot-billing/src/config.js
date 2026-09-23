require('dotenv').config();

function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    console.warn(`[config] Warning: ${name} is not set in .env`);
  }
  return val;
}

module.exports = {
  port: Number(process.env.PORT || 3000),

  mikrotik: {
    host: required('MIKROTIK_HOST'),
    port: Number(process.env.MIKROTIK_PORT || 8728),
    user: required('MIKROTIK_USER'),
    password: required('MIKROTIK_PASSWORD'),
    tls: process.env.MIKROTIK_TLS === 'true',
    hotspotServer: process.env.MIKROTIK_HOTSPOT_SERVER || undefined,
  },

  mpesa: {
    env: process.env.MPESA_ENV || 'sandbox',
    baseUrl:
      process.env.MPESA_ENV === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke',
    consumerKey: required('MPESA_CONSUMER_KEY'),
    consumerSecret: required('MPESA_CONSUMER_SECRET'),
    shortcode: required('MPESA_SHORTCODE'),
    passkey: required('MPESA_PASSKEY'),
    callbackUrl: required('MPESA_CALLBACK_URL'),
  },
};
