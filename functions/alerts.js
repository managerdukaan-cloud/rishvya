// Pure helpers for retention alerts (kept free of Firebase calls so they can be tested).
const DAY = 864e5;
const priceDrop = (a, b) => b.status === "active" && Number(b.price) > 0 && Number(a.price) > Number(b.price);
const backInStock = (a, b) => b.status === "active" && (Number(a.stock) || 0) <= 0 && (Number(b.stock) || 0) > 0;
// customer left items in the cart 24-72h ago, was not nudged for this cart yet, and has not ordered since
const cartNudgeDue = (u, now, lastOrderMs) =>
  u.role !== "admin" && Array.isArray(u.cart) && u.cart.length > 0 && Number(u.cartAt) > 0 &&
  now - u.cartAt >= DAY && now - u.cartAt <= 3 * DAY && u.cartNudged !== u.cartAt && !(lastOrderMs > u.cartAt);
const tsJson = (k, v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v);
module.exports = { priceDrop, backInStock, cartNudgeDue, tsJson };
