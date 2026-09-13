// Vercel serverless function: verifies a Razorpay payment signature server-side before
// anything is treated as "paid". Previously, main.js called showPaymentSuccess() directly
// from the Razorpay Checkout handler callback with zero verification — any script running
// in the page (or a forged POST to the Make.com webhook) could claim a payment succeeded.
//
// This is the only place that is allowed to tell Make.com "Payment" happened. Make.com's
// own scenario should also de-duplicate on payment_id (a "Search Rows" step before "Add a
// Row") so a retried/duplicate call here can't create a second row in the Sheet.

const crypto = require('crypto');

const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/jblxlxgjkjntcqc7k1te6h4yhq21yttk';

// Kept in sync with create-order.js's catalog so the price logged to the Sheet always
// reflects what the server actually charged, never a client-supplied value.
const CATALOG = {
  audit: { name: 'Channel Audit', amount: 2500, currency: 'USD' },
  starter_push: { name: 'Starter Push', amount: 4900, currency: 'USD' },
  growth_push: { name: 'Growth Push', amount: 19900, currency: 'USD' },
  starter_growth: { name: 'Starter Growth (Monthly Retainer)', amount: 34900, currency: 'USD' },
  managed_growth: { name: 'Managed Growth (Monthly Retainer)', amount: 69900, currency: 'USD' },
  full_channel_partner: { name: 'Full Channel Partner (Monthly Retainer)', amount: 129900, currency: 'USD' }
};

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

  try {
    await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      })
    });
  } catch (err) {
    // The payment itself is verified and real regardless of whether this notification
    // succeeds — log it so it can be reconciled manually rather than failing the response.
    console.error('Make.com webhook forward failed for payment_id=' + paymentId, err);
  }

  return res.status(200).json({ verified: true, payment_id: paymentId });
};
