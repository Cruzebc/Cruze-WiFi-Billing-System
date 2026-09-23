const axios = require('axios');
const config = require('../config');

let cachedToken = null;
let tokenExpiresAt = 0;

/** Fetches (and caches) an OAuth access token from Safaricom. */
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const auth = Buffer.from(
    `${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`
  ).toString('base64');

  const { data } = await axios.get(
    `${config.mpesa.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  cachedToken = data.access_token;
  // Safaricom tokens last ~1hr; refresh a minute early to be safe.
  tokenExpiresAt = Date.now() + (Number(data.expires_in) - 60) * 1000;
  return cachedToken;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/** Normalizes a Kenyan phone number to the 2547XXXXXXXX format Daraja expects. */
function normalizePhone(phone) {
  let p = phone.replace(/\s+/g, '').replace(/^\+/, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  return p;
}

/**
 * Initiates an STK Push (Lipa na M-Pesa Online) prompt to the customer's phone.
 * @param {Object} opts
 * @param {string} opts.phone
 * @param {number} opts.amount
 * @param {string} opts.accountReference - shown to the customer, e.g. order id
 * @param {string} opts.transactionDesc
 */
async function stkPush({ phone, amount, accountReference, transactionDesc }) {
  const token = await getAccessToken();
  const ts = timestamp();
  const password = Buffer.from(
    `${config.mpesa.shortcode}${config.mpesa.passkey}${ts}`
  ).toString('base64');

  const payload = {
    BusinessShortCode: config.mpesa.shortcode,
    Password: password,
    Timestamp: ts,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: normalizePhone(phone),
    PartyB: config.mpesa.shortcode,
    PhoneNumber: normalizePhone(phone),
    CallBackURL: config.mpesa.callbackUrl,
    AccountReference: accountReference.slice(0, 12),
    TransactionDesc: transactionDesc.slice(0, 13),
  };

  const { data } = await axios.post(
    `${config.mpesa.baseUrl}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // data contains MerchantRequestID, CheckoutRequestID, ResponseCode, etc.
  return data;
}

module.exports = { stkPush, normalizePhone };
