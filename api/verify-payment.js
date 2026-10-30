// Vercel serverless function: verifies a Razorpay payment signature server-side before
// anything is treated as "paid". Previously, main.js called showPaymentSuccess() directly
// from the Razorpay Checkout handler callback with zero verification — any script running
// in the page (or a forged POST to the Make.com webhook) could claim a payment succeeded.
//
// This is the only place that is allowed to tell Make.com "Payment" happened. Make.com's
// own scenario should also de-duplicate on payment_id (a "Search Rows" step before "Add a
// Row") so a retried/duplicate call here can't create a second row in the Sheet.
//
// 2026-10-29: after a verified payment this function now also sends the Purchase event to the
// Meta Conversions API itself, with event_id "purchase_<payment_id>", the same id the browser
// pixel and /api/meta-event use, so Meta counts each purchase once. Until now Purchase reached
// Meta only from the browser: a closed tab or a late pixel lost it, and Events Manager received
// no Purchase for 1 to 28 Oct 2026 although the Make sheet logged real payments. The server copy
// is sent only when the request carries the pixel's _fbp cookie (for UK/EEA visitors the pixel
// loads only after consent, so no cookie means no consent or a blocker) or tracking_allowed:true.

const crypto = require('crypto');

const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/jblxlxgjkjntcqc7k1te6h4yhq21yttk';

const META_PIXEL_ID = process.env.META_PIXEL_ID || '1123299276925584';
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const META_TIMEOUT_MS = 4000;
const SITE_URL = /^https:\/\/(www\.)?cliporbits\.com\//;

// Kept in sync with create-order.js's catalog so the price logged to the Sheet always
// reflects what the server actually charged, never a client-supplied value.
const CATALOG = {
  audit: { name: 'Channel Audit', amount: 2500, currency: 'USD' },
  starter_push: { name: 'Starter Push', amount: 4900, currency: 'USD' },
  growth_push: { name: 'Growth Push', amount: 12900, currency: 'USD' },
  starter_growth: { name: 'Starter Growth (Monthly Retainer)', amount: 34900, currency: 'USD' },
  managed_growth: { name: 'Managed Growth (Monthly Retainer)', amount: 69900, currency: 'USD' },
  full_channel_partner: { name: 'Full Channel Partner (Monthly Retainer)', amount: 129900, currency: 'USD' }
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function readCookie(header, name) {
  const match = String(header || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function forwardToMake(payload, paymentId) {
  try {
    await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return 'sent';
  } catch (err) {
    // The payment itself is verified and real regardless of whether this notification
    // succeeds — log it so it can be reconciled manually rather than failing the response.
    console.error('Make.com webhook forward failed for payment_id=' + paymentId, err);
    return 'failed';
  }
}

// Server-side Purchase for Meta. Returns a short status string for the response and the logs.
async function sendMetaPurchase(req, body, product, productId, orderId, paymentId, leadData) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return 'skipped: META_CAPI_TOKEN not set';
  if (!product) return 'skipped: unknown product_id';

  const fbp = readCookie(req.headers.cookie, '_fbp');
  const fbc = readCookie(req.headers.cookie, '_fbc');
  if (body.tracking_allowed !== true && !fbp) return 'skipped: no consent signal (no _fbp cookie)';

  const userData = {
    client_ip_address: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined,
    client_user_agent: req.headers['user-agent'] || undefined,
    fbp: fbp || undefined,
    fbc: fbc || undefined
  };
  const email = String(leadData.email || '').trim().toLowerCase();
  if (email.includes('@')) userData.em = [sha256(email)];
  const phone = String(leadData.phone || '').replace(/\D/g, '');
  if (phone.length >= 8) userData.ph = [sha256(phone)];

  const referer = String(req.headers.referer || '');
  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: 'purchase_' + paymentId,
      action_source: 'website',
      event_source_url: SITE_URL.test(referer) ? referer : 'https://www.cliporbits.com/',
      user_data: userData,
      custom_data: {
        value: product.amount / 100,
        currency: product.currency,
        content_name: product.name,
        content_type: 'product',
        content_ids: [productId],
        order_id: String(orderId)
      }
    }]
  };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal }
    );
    if (!response.ok) {
      console.error('Meta CAPI Purchase error for payment_id=' + paymentId, response.status, await response.text());
      return 'error ' + response.status;
    }
    return 'sent';
  } catch (err) {
    console.error('Meta CAPI Purchase request failed for payment_id=' + paymentId, err);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
    product_id: productId,
    product_name: productName,
    lead,
    utm_first_touch: utmFirst,
    utm_last_touch: utmLast
  } = body;

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ verified: false, error: 'Missing payment fields' });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return res.status(500).json({ verified: false, error: 'Payment is not configured on the server yet.' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const isValid =
    typeof signature === 'string' &&
    expectedSignature.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));

  if (!isValid) {
    return res.status(400).json({ verified: false, error: 'Signature verification failed' });
  }

  const leadData = lead && typeof lead === 'object' ? lead : {};
  const product = CATALOG[productId];
  const priceLabel = product ? `${product.currency} ${(product.amount / 100).toFixed(2)}` : '';

  const makePayload = {
    event: 'Payment',
    name: leadData.name || '',
    email: leadData.email || '',
    phone: leadData.phone || '',
    link: leadData.link || '',
    niche: leadData.niche || '',
    package: (product && product.name) || productName || productId || '',
    price: priceLabel,
    payment_id: paymentId,
    order_id: orderId,
    source_page: 'Checkout',
    utm_first_touch: utmFirst || {},
    utm_last_touch: utmLast || {}
  };

  // Both notifications run together and neither can fail the response: the payment is verified.
  const [makeResult, metaResult] = await Promise.allSettled([
    forwardToMake(makePayload, paymentId),
    sendMetaPurchase(req, body, product, productId, orderId, paymentId, leadData)
  ]);
  const metaStatus = metaResult.status === 'fulfilled' ? metaResult.value : 'failed';
  const makeStatus = makeResult.status === 'fulfilled' ? makeResult.value : 'failed';

  return res.status(200).json({ verified: true, payment_id: paymentId, make: makeStatus, meta_purchase: metaStatus });
};
