// RISHVYA Cloud Functions (1st gen, Mumbai region)
//  - onOrderCreate / onOrderUpdate / onReturnWrite : push notifications
//  - invoice : printable GST invoice page (needs a logged-in Firebase ID token)
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
const R = functions.region("asia-south1");

const LABEL = {
  pending_payment: "Payment verification pending", placed: "Order placed", payment_confirmed: "Payment confirmed",
  processing: "Processing", packed: "Packed", shipped: "Shipped", out_for_delivery: "Out for delivery",
  delivered: "Delivered", cancelled: "Cancelled", return_requested: "Return requested", returned: "Returned", refunded: "Refunded",
};
const RLABEL = { requested: "Return request received", approved: "Return approved", rejected: "Return rejected", received: "Return received", refunded: "Refund processed" };

function bad(code) { return /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code || ""); }

async function sendTo(userDocs, title, body) {
  const web = [], app = [];
  userDocs.forEach((d) => {
    const u = (d && d.exists && d.data()) || {};
    (u.fcmWeb || []).forEach((t) => web.push({ t, ref: d.ref, f: "fcmWeb" }));
    (u.fcmApp || []).forEach((t) => app.push({ t, ref: d.ref, f: "fcmApp" }));
  });
  const clean = (res, list) => Promise.all(res.responses.map((x, i) =>
    (!x.success && bad(x.error && x.error.code)) ? list[i].ref.update({ [list[i].f]: admin.firestore.FieldValue.arrayRemove(list[i].t) }).catch(() => {}) : null));
  const jobs = [];
  // web: data-only message, the service worker shows the notification
  if (web.length) jobs.push(admin.messaging().sendEachForMulticast({ tokens: web.map((x) => x.t), data: { title, body, url: "./" } }).then((r) => clean(r, web)));
  // android app: notification message
  if (app.length) jobs.push(admin.messaging().sendEachForMulticast({ tokens: app.map((x) => x.t), notification: { title, body }, data: { url: "./" } }).then((r) => clean(r, app)));
  await Promise.all(jobs);
}
const adminsDocs = async () => (await db.collection("users").where("role", "==", "admin").get()).docs;
const userDoc = (uid) => db.doc("users/" + uid).get();

exports.onOrderCreate = R.firestore.document("orders/{id}").onCreate(async (snap) => {
  const o = snap.data();
  await sendTo(await adminsDocs(), "New order " + o.orderId, "₹" + o.total + " · " + (o.customerName || "") + " · " + String(o.paymentMethod || "").toUpperCase());
  if (o.customerId) await sendTo([await userDoc(o.customerId)], "Order received " + o.orderId, "Thank you! Hum aapka order jald confirm karenge.");
});

exports.onOrderUpdate = R.firestore.document("orders/{id}").onUpdate(async (ch) => {
  const a = ch.before.data(), b = ch.after.data();
  if (!b.customerId) return;
  let title, body;
  if (b.trackingNo && b.trackingNo !== a.trackingNo) { title = "Order " + b.orderId + " shipped"; body = "🚚 " + (b.courier || "Courier") + " · Tracking: " + b.trackingNo; }
  else if (b.status !== a.status) { title = "Order " + b.orderId; body = LABEL[b.status] || b.status; }
  else return;
  await sendTo([await userDoc(b.customerId)], title, body);
});

exports.onReturnWrite = R.firestore.document("returns/{id}").onWrite(async (ch) => {
  const after = ch.after.exists ? ch.after.data() : null;
  if (!after) return;
  if (!ch.before.exists) { await sendTo(await adminsDocs(), "Return request " + after.orderId, (after.customerName || "") + " · " + (after.reason || "")); return; }
  if (ch.before.data().status !== after.status && after.customerId) await sendTo([await userDoc(after.customerId)], "Return " + after.orderId, RLABEL[after.status] || after.status);
});

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function invoiceHtml(o, st) {
  const items = (o.items || []).map((it) => { const g = Number(it.gstPct || 0), line = it.price * it.qty, base = g ? (line * 100) / (100 + g) : line; return { ...it, g, line, base, tax: line - base }; });
  const tax = items.reduce((a, x) => a + x.tax, 0), base = items.reduce((a, x) => a + x.base, 0);
  const dt = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : new Date();
  const date = dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const a = o.address || {};
  const name = st.name || "RISHVYA";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(o.orderId)}</title>
<style>body{font:14px/1.5 Arial,Helvetica,sans-serif;color:#222;margin:0;background:#f4f1ea}.pg{max-width:780px;margin:16px auto;background:#fff;padding:28px;border-radius:8px}
h1{font:600 28px Georgia,serif;letter-spacing:.2em;color:#581D32;margin:0}.sub{color:#777;font-size:12px}.row{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:8px;border-bottom:1px solid #e5ddd0;text-align:left;font-size:13px}th{background:#f7f2ea}td.r,th.r{text-align:right}
.tot td{border:0;padding:3px 8px}.btn{background:#581D32;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;cursor:pointer}
@media print{body{background:#fff}.pg{margin:0;padding:0}.np{display:none}}</style></head><body><div class="pg">
<div class="row"><div><h1>${esc(name)}</h1><div class="sub">${esc(st.address || "")}<br>${st.gstin ? "GSTIN: " + esc(st.gstin) + "<br>" : ""}${esc(st.phone || "")} ${esc(st.email || "")}</div></div>
<div style="text-align:right"><b>TAX INVOICE</b><br>Invoice no: INV-${esc(o.orderId)}<br>Order: ${esc(o.orderId)}<br>Date: ${date}<br>Payment: ${esc(String(o.paymentMethod || "").toUpperCase())}${o.utrNumber ? " (UTR " + esc(o.utrNumber) + ")" : ""}</div></div>
<div style="margin-top:16px"><b>Bill / Ship to</b><br>${esc(a.name || o.customerName)}<br>${esc(a.address)}, ${esc(a.city)} - ${esc(a.pincode)}<br>Phone: ${esc(a.phone || o.customerPhone)}</div>
<table><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate (incl. GST)</th><th class="r">GST %</th><th class="r">Amount</th></tr>
${items.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}<br><span class="sub">${esc(x.sku || "")} ${esc(x.color || "")} ${esc(x.size || "")}</span></td><td class="r">${x.qty}</td><td class="r">${inr(x.price)}</td><td class="r">${x.g}%</td><td class="r">${inr(x.line)}</td></tr>`).join("")}</table>
<table class="tot" style="width:320px;margin-left:auto"><tr><td>Taxable value</td><td class="r">${inr(base)}</td></tr><tr><td>GST (included)</td><td class="r">${inr(tax)}</td></tr><tr><td>Subtotal</td><td class="r">${inr(o.subtotal)}</td></tr>
${o.discount ? `<tr><td>Discount${o.couponCode ? " (" + esc(o.couponCode) + ")" : ""}</td><td class="r">-${inr(o.discount)}</td></tr>` : ""}<tr><td>Delivery</td><td class="r">${inr(o.shipping)}</td></tr><tr><td><b>Total</b></td><td class="r"><b>${inr(o.total)}</b></td></tr></table>
<p class="sub" style="margin-top:20px">Prices include GST. This is a computer generated invoice. Thank you for shopping with ${esc(name)}.</p>
<p class="np"><button class="btn" onclick="window.print()">Print / Save as PDF</button></p></div></body></html>`;
}

exports.invoice = R.https.onRequest(async (req, res) => {
  try {
    const id = String(req.query.o || ""), tok = String(req.query.t || "");
    const dec = await admin.auth().verifyIdToken(tok);
    const od = await db.doc("orders/" + id).get();
    if (!od.exists) return res.status(404).send("Order not found");
    const o = od.data();
    const ud = await db.doc("users/" + dec.uid).get();
    const isAdmin = ud.exists && ud.data().role === "admin";
    if (o.customerId !== dec.uid && !isAdmin) return res.status(403).send("Not allowed");
    const st = (await db.doc("settings/store").get()).data() || {};
    res.set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", "no-store").send(invoiceHtml(o, st));
  } catch (e) {
    res.status(401).send("Invoice link expire ho gaya ya galat hai. App mein wapas jaake dobara try karo.");
  }
});
