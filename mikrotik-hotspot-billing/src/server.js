const express = require('express');
const cors = require('cors');
const config = require('./config');

const voucherRoutes = require('./routes/vouchers').router;
const mpesaRoutes = require('./routes/mpesa');
const adminRoutes = require('./routes/admin');
const { startExpiryJob } = require('./jobs/expireVouchers');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/vouchers', voucherRoutes);
app.use('/api/mpesa', mpesaRoutes);
app.use('/api/admin', adminRoutes);

app.listen(config.port, () => {
  console.log(`Hotspot billing server listening on port ${config.port}`);
});

startExpiryJob();
