/**
 * Parses a RouterOS-style duration string ("1h", "30m", "24h", "7d", "45s")
 * into milliseconds. Supports d/h/m/s units, single unit only (matches what
 * we use in packages.js). Returns null if it can't be parsed.
 */
function parseDurationToMs(value) {
  if (!value) return null;
  const match = /^(\d+)\s*(d|h|m|s)$/i.exec(value.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * unitMs;
}

module.exports = { parseDurationToMs };
