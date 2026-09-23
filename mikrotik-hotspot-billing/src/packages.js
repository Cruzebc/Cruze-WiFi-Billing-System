// Define your hotspot packages here. Each mikrotikProfile must already exist
// under /ip hotspot user profile on your router (they control speed limits,
// shared-users, etc). limitUptime uses RouterOS duration format, e.g. "1h",
// "24h", "7d". Leave limitUptime blank for unlimited time (rely on validity
// instead, or bytesLimit for data caps).

const PACKAGES = [
  {
    id: 'hourly-10',
    name: '1 Hour Access',
    priceKes: 10,
    limitUptime: '1h',
    mikrotikProfile: 'default',
  },
  {
    id: 'daily-50',
    name: '24 Hour Access',
    priceKes: 50,
    limitUptime: '24h',
    mikrotikProfile: 'default',
  },
  {
    id: 'weekly-250',
    name: '7 Day Access',
    priceKes: 250,
    limitUptime: '168h',
    mikrotikProfile: 'default',
  },
];

function getPackage(id) {
  return PACKAGES.find((p) => p.id === id);
}

module.exports = { PACKAGES, getPackage };
