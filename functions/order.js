// Pure order logic (no Firebase calls) so it can be tested. Used by the placeOrder function.
class OrderError extends Error { constructor(code, message) { super(message); this.code = code; } }
const E = (c, m) => new OrderError(c, m);
const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const prefixes = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);

const csv = (v) => String(v || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
function applyCoupon(c, lines, sub, userUses, hasOrders, now, email) {
  if (!c) throw E("not-found", "Coupon galat hai");
  if (!c.active) throw E("failed-precondition", "Coupon active nahi hai");
  if (c.expiry && new Date(c.expiry + "T23:59:59+05:30") < now) throw E("failed-precondition", "Coupon expire ho gaya");
  if (sub < (c.minOrder || 0)) throw E("failed-precondition", "Rs. " + c.minOrder + " ya usse upar ke order par chalega");
  if (c.maxUses > 0 && (c.used || 0) >= c.maxUses) throw E("failed-precondition", "Is coupon ki limit khatam ho gayi");
  if (c.perUser > 0 && userUses >= c.perUser) throw E("failed-precondition", "Aap ye coupon pehle hi use kar chuke ho");
  if (c.firstOrder && hasOrders) throw E("failed-precondition", "Ye coupon sirf pehle order ke liye hai");
  const emails = csv(c.emails), cats = csv(c.categories), skus = csv(c.skus);
  if (emails.length && !emails.includes(String(email || "").toLowerCase())) throw E("failed-precondition", "Ye coupon aapke account ke liye nahi hai");
  let base = sub;
  if (cats.length || skus.length) {
    base = lines.filter((l) => cats.includes(String(l.category || "").toLowerCase()) || skus.includes(String(l.sku || "").toLowerCase())).reduce((t, l) => t + l.price * l.qty, 0);
    if (base <= 0) throw E("failed-precondition", "Ye coupon aapke cart ke products par nahi chalta");
  }
  let dc = c.type === "percent" ? Math.floor((base * c.value) / 100) : Number(c.value) || 0;
  if (c.type === "percent" && c.maxDiscount > 0) dc = Math.min(dc, c.maxDiscount);
  return { dc: Math.max(0, Math.min(dc, base)), freeShip: !!c.freeShip };
}

// products: {id -> product data}; returns {order, stockWrites, couponCode}
function buildOrder({ data, uid, email, products, ship, coupon, couponCode, userUses, hasOrders, orderId, now, clientRef }) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length || items.length > 30) throw E("invalid-argument", "Cart khali ya bahut bada hai");
  const a = data.address || {};
  const name = str(a.name, 80), phone = str(a.phone, 15), pin = str(a.pincode, 6), addr = str(a.address, 300), city = str(a.city, 80);
  if (!name || !addr || !city) throw E("invalid-argument", "Naam, address aur city bharo");
  if (!/^[6-9]\d{9}$/.test(phone)) throw E("invalid-argument", "Sahi 10-digit mobile number likho");
  if (!/^[1-9]\d{5}$/.test(pin)) throw E("invalid-argument", "Sahi 6-digit pincode likho");
  const bl = prefixes(ship.blockedPrefixes), al = prefixes(ship.allowedPrefixes);
  if (bl.some((p) => pin.indexOf(p) === 0) || (al.length && !al.some((p) => pin.indexOf(p) === 0))) throw E("failed-precondition", "Is pincode par abhi delivery nahi hoti.");
  const pm = data.paymentMethod === "upi" ? "upi" : "cod";
  const utr = pm === "upi" ? str(data.utrNumber, 12) : "";
  if (pm === "upi" && !/^\d{12}$/.test(utr)) throw E("invalid-argument", "12-digit UTR number likho");

  const byProd = {}, lines = [];
  for (const it of items) {
    const id = str(it && it.id, 60), size = str(it && it.size, 20), color = str(it && it.color, 40), qty = Math.floor(Number(it && it.qty));
    if (!id || !(qty >= 1 && qty <= 10)) throw E("invalid-argument", "Quantity 1 se 10 ke beech honi chahiye");
    const p = products[id];
    if (!p || p.status !== "active") throw E("failed-precondition", "Ek product ab available nahi hai");
    const bp = byProd[id] || (byProd[id] = { variants: (p.variants || []).map((v) => ({ ...v })), sold: 0 });
    const v = bp.variants.find((x) => String(x.size) === size && String(x.color || "") === color);
    if (!v) throw E("failed-precondition", p.name + ": ye size/colour ab available nahi hai");
    if ((Number(v.stock) || 0) < qty) throw E("failed-precondition", "Stock kam hai: " + p.name + " (" + size + " " + color + ")");
    v.stock = Number(v.stock) - qty;
    bp.sold += qty;
    lines.push({ id, name: p.name, sku: p.sku || "", image: (p.images && p.images[0] && p.images[0].url) || p.image || "", size, color, price: Number(p.price), gstPct: Number(p.gstPct) || 0, category: p.category || "", returnable: p.returnEligible !== false, qty });
  }
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  let dc = 0, freeShip = false, code = "";
  if (couponCode) { const r = applyCoupon(coupon, lines, subtotal, userUses, hasOrders, now, email); dc = r.dc; freeShip = r.freeShip; code = couponCode; }
  const charge = typeof ship.charge === "number" ? ship.charge : 49, freeAbove = Number(ship.freeAbove) > 0 ? Number(ship.freeAbove) : 999;
  const shipping = subtotal > 0 && subtotal < freeAbove && !freeShip ? charge : 0;
  const total = subtotal - dc + shipping;
  const loc = data.location && typeof data.location.lat === "number" && typeof data.location.lng === "number" ? { lat: data.location.lat, lng: data.location.lng } : null;
  const order = {
    orderId, customerId: uid, customerName: name, customerEmail: email || "", customerPhone: phone,
    address: { name, phone, pincode: pin, address: addr, city }, paymentMethod: pm, utrNumber: utr, items: lines, location: loc,
    subtotal, shipping, discount: dc, couponCode: code, total, status: pm === "upi" ? "pending_payment" : "placed", stockDeducted: true, clientRef: str(clientRef, 40),
  };
  const stockWrites = Object.keys(byProd).map((id) => ({ id, variants: byProd[id].variants, stock: byProd[id].variants.reduce((s, v) => s + (Number(v.stock) || 0), 0), sold: byProd[id].sold }));
  return { order, stockWrites, couponCode: code };
}

// returns updated variants per product after giving an order's items back to stock
function restockPlan(order, products) {
  const out = {};
  (order.items || []).forEach((x) => {
    const p = products[x.id]; if (!p) return;
    const vs = out[x.id] || (out[x.id] = (p.variants || []).map((v) => ({ ...v })));
    const r = vs.find((y) => String(y.size) === String(x.size) && String(y.color || "") === String(x.color || ""));
    if (r) r.stock = (Number(r.stock) || 0) + x.qty;
  });
  return Object.keys(out).map((id) => ({ id, variants: out[id], stock: out[id].reduce((s, v) => s + (Number(v.stock) || 0), 0) }));
}
module.exports = { OrderError, applyCoupon, buildOrder, restockPlan };
