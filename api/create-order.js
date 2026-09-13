// Vercel serverless function: server-side Razorpay order creation.
// The client sends only a product_id — the price is always resolved here, from this
// fixed catalog, never from anything the browser supplies. This closes the P0 gap where
// main.js previously read window.currentOrder.price (client-controlled) straight into
// the Razorpay Checkout options.

const CATALOG = {
  audit: { name: 'Channel Audit', amount: 2500, currency: 'USD' },
  starter_push: { name: 'Starter Push', amount: 4900, currency: 'USD' },
  growth_push: { name: 'Growth Push', amount: 19900, currency: 'USD' },
  starter_growth: { name: 'Starter Growth (Monthly Retainer)', amount: 34900, currency: 'USD' },
  managed_growth: { name: 'Managed Growth (Monthly Retainer)', amount: 69900, currency: 'USD' },
  full_channel_partner: { name: 'Full Channel Partner (Monthly Retainer)', amount: 129900, currency: 'USD' }
};

const RAZORPAY_KEY_ID = 'rzp_live_TNBr7uq276OFVi'; // public key, safe to expose

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const productId = body.product_id;
  const product = CATALOG[productId];

  if (!product) {
    return res.status(400).json({ error: 'Invalid product_id' });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return res.status(500).json({ error: 'Payment is not configured on the server yet.' });
  }

  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${keySecret}`).toString('base64');
  const receipt = `co_${productId}_${Date.now()}`;

  try {
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`
      },
      body: JSON.stringify({
        amount: product.amount,
        currency: product.currency,
        receipt,
        notes: { product_id: productId }
      })
    });

    const data = await rzpRes.json();
    if (!rzpRes.ok || !data.id) {
      console.error('Razorpay order creation failed', data);
      return res.status(502).json({ error: 'Could not start your order. Please try again.' });
    }

    return res.status(200).json({
      order_id: data.id,
      amount: data.amount,
      currency: data.currency,
      key_id: RAZORPAY_KEY_ID,
      product_id: productId,
      product_name: product.name
    });
  } catch (err) {
    console.error('Razorpay order creation error', err);
    return res.status(500).json({ error: 'Could not start your order. Please try again.' });
  }
};
