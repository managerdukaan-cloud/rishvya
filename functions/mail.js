// Branded e-mails through any SMTP service (Brevo, Gmail app password, Zoho ...).
// Credentials come from functions/.env which the release workflow writes from GitHub secrets.
// If SMTP is not configured every send is a silent no-op.
const nodemailer = require("nodemailer");
let tx = null;
const configured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

async function sendMail(to, subject, html) {
  if (!configured() || !to) return false;
  try {
    if (!tx) {
      const port = Number(process.env.SMTP_PORT) || 587;
      tx = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    }
    await tx.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html });
    return true;
  } catch (e) {
    console.error("mail failed:", e.message);
    return false;
  }
}

function tpl(title, body) {
  return `<div style="background:#EEE8DD;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#242424">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:14px;overflow:hidden">
<div style="background:#581D32;color:#C6A46A;text-align:center;padding:18px;font:600 24px Georgia,serif;letter-spacing:.2em">RISHVYA</div>
<div style="padding:22px"><h2 style="margin:0 0 10px;font:600 20px Georgia,serif;color:#581D32">${esc(title)}</h2>${body}</div>
<div style="background:#f7f2ea;text-align:center;padding:12px;font-size:12px;color:#777">Where Elegance Meets Identity</div></div></div>`;
}

function orderRows(o) {
  const rows = (o.items || []).map((i) => `<tr><td style="padding:6px 0">${esc(i.name)}<br><span style="color:#777;font-size:12px">${esc(i.color)} ${esc(i.size)} × ${i.qty}</span></td><td style="text-align:right">${inr(i.price * i.qty)}</td></tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse;margin-top:10px">${rows}<tr><td style="padding-top:8px;border-top:1px solid #eee"><b>Total</b></td><td style="padding-top:8px;border-top:1px solid #eee;text-align:right"><b>${inr(o.total)}</b></td></tr></table>`;
}
module.exports = { configured, sendMail, tpl, orderRows, esc };
