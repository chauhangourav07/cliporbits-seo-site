// Meta Conversions API relay for cliporbits.com.
// main.js posts Lead, InitiateCheckout and Purchase here with the same event_id it gave the
// browser pixel, so Meta deduplicates the pair. Purchase is only forwarded after the Razorpay
// signature checks out, and its value comes from the catalog below, never from the browser.
const crypto = require('crypto');

const PIXEL_ID = process.env.META_PIXEL_ID || '1123299276925584';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const ALLOWED_EVENTS = new Set(['Lead', 'InitiateCheckout', 'Purchase']);
const ALLOWED_HOST = /(^|\.)cliporbits\.com$|\.vercel\.app$/;

// USD list prices, keyed like PRODUCT_CATALOG in main.js.
const CATALOG = {
  audit: { name: 'Channel Audit', usd: 25 },
  starter_push: { name: 'Starter Push', usd: 49 },
  growth_push: { name: 'Growth Push', usd: 199 },
  starter_growth: { name: 'Starter Growth (Monthly Retainer)', usd: 349 },
  managed_growth: { name: 'Managed Growth (Monthly Retainer)', usd: 699 },
  full_channel_partner: { name: 'Full Channel Partner (Monthly Retainer)', usd: 1299 }
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function readCookie(header, name) {
  const match = String(header || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (err) { return ''; }
}

function razorpaySignatureValid(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET;
  if (!secret || !orderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(orderId + '|' + paymentId).digest('hex');
  const given = String(signature);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

function cleanCustomData(data) {
  const out = {};
  const src = data && typeof data === 'object' ? data : {};
  ['content_name', 'content_category', 'content_type', 'currency'].forEach((k) => {
    if (typeof src[k] === 'string') out[k] = src[k].slice(0, 100);
  });
  if (typeof src.value === 'number' && isFinite(src.value)) out.value = src.value;
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const origin = req.headers.origin || req.headers.referer || '';
  if (origin && !ALLOWED_HOST.test(hostOf(origin))) return res.status(403).end();

  const token = process.env.META_CAPI_TOKEN;
  if (!token) return res.status(204).end();

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (err) { body = {}; }
  }

  const eventName = String(body.event_name || '');
  const eventId = String(body.event_id || '').slice(0, 120);
  if (!ALLOWED_EVENTS.has(eventName) || !eventId) return res.status(400).json({ error: 'Unsupported event' });

  let customData = cleanCustomData(body.custom_data);
  if (eventName === 'Purchase') {
    const product = CATALOG[body.product_id];
    const verified = razorpaySignatureValid(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature);
    if (!product || !verified || eventId !== 'purchase_' + body.razorpay_payment_id) {
      return res.status(403).json({ error: 'Purchase not verified' });
    }
    customData = {
      value: product.usd,
      currency: 'USD',
      content_name: product.name,
      content_type: 'product',
      content_ids: [body.product_id],
      order_id: String(body.razorpay_order_id)
    };
  }

  const userData = {
    client_ip_address: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined,
    client_user_agent: req.headers['user-agent'] || undefined,
    fbp: readCookie(req.headers.cookie, '_fbp'),
    fbc: readCookie(req.headers.cookie, '_fbc')
  };
  const email = String(body.email || '').trim().toLowerCase();
  if (email.includes('@')) userData.em = [sha256(email)];
  const phone = String(body.phone || '').replace(/\D/g, '');
  if (phone.length >= 8) userData.ph = [sha256(phone)];

  const sourceUrl = String(body.event_source_url || '');
  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: ALLOWED_HOST.test(hostOf(sourceUrl)) ? sourceUrl : 'https://www.cliporbits.com/',
      user_data: userData,
      custom_data: customData
    }]
  };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    if (!response.ok) console.error('Meta CAPI error', response.status, await response.text());
  } catch (err) {
    console.error('Meta CAPI request failed', err);
  }
  return res.status(204).end();
}
