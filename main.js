document.addEventListener('DOMContentLoaded', function () {
  var menuToggle = document.getElementById('menuToggle');
  var navLinks = document.getElementById('navLinks');
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', function () { navLinks.classList.toggle('open'); });
  }

  var learnBtn = document.getElementById('learnBtn');
  var learnPanel = document.getElementById('learnPanel');
  if (learnBtn && learnPanel) {
    learnBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = !learnPanel.hidden;
      learnPanel.hidden = isOpen;
      learnBtn.setAttribute('aria-expanded', String(!isOpen));
    });
    document.addEventListener('click', function (e) {
      var dropdown = document.getElementById('learnDropdown');
      if (dropdown && !dropdown.contains(e.target)) {
        learnPanel.hidden = true;
        learnBtn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { learnPanel.hidden = true; learnBtn.setAttribute('aria-expanded', 'false'); }
    });
  }

  var current = document.body.getAttribute('data-page');
  if (current) {
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === current);
    });
  }

  var modal = document.getElementById('leadModal');
  if (modal) {
    modal.addEventListener('click', function (e) { if (e.target.id === 'leadModal') closeLeadModal(); });
  }

  initCheckoutFromStorage();
  captureUtmParams();
});

document.addEventListener('keydown', function (e) {
  var modal = document.getElementById('leadModal');
  if (e.key === 'Escape' && modal && !modal.hidden) closeLeadModal();
});

function showFormNote(id) {
  var note = document.getElementById('note-' + id);
  if (note) {
    note.classList.add('show');
    setTimeout(function () { note.classList.remove('show'); }, 6000);
  }
}

/* ---------- Campaign carousel (homepage only; guarded) ---------- */
(function () {
  var track = document.getElementById('campaignCarousel');
  if (!track) return;
  var dots = document.querySelectorAll('#carouselDots .carousel-dot');

  function stepWidth() {
    var slide = track.querySelector('.carousel-slide');
    var gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || 0) || 0;
    return slide.offsetWidth + gap;
  }

  window.scrollCarousel = function (dir) {
    track.scrollBy({ left: dir * stepWidth(), behavior: 'smooth' });
  };
  window.goToSlide = function (i) {
    track.scrollTo({ left: i * stepWidth(), behavior: 'smooth' });
  };

  var scrollTimeout;
  track.addEventListener('scroll', function () {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(function () {
      var index = Math.round(track.scrollLeft / stepWidth());
      dots.forEach(function (d, i) { d.classList.toggle('active', i === index); });
    }, 100);
  });
})();

/* ---------- Lead modal -> checkout flow ---------- */
var currentOrder = { name: 'Channel Audit', price: '$25' };

function openLeadModal(name, price, prefillLink, prefillEmail) {
  currentOrder = { name: name, price: price };
  document.getElementById('modalPkgName').textContent = name;
  document.getElementById('modalPkgPrice').textContent = price;
  document.getElementById('leadForm').reset();
  if (prefillLink) document.getElementById('leadLink').value = prefillLink;
  if (prefillEmail) document.getElementById('leadEmail').value = prefillEmail;
  document.getElementById('leadModal').hidden = false;
  document.body.style.overflow = 'hidden';
  trackEvent('begin_checkout', { package: name });
}

function openLeadModalFromForm(e, formEl, name, price) {
  e.preventDefault();
  var linkInput = formEl.querySelector('[data-role="channel-link"]');
  var emailInput = formEl.querySelector('input[type="email"]');
  openLeadModal(name, price, linkInput ? linkInput.value : '', emailInput ? emailInput.value : '');
  return false;
}

function closeLeadModal() {
  document.getElementById('leadModal').hidden = true;
  document.body.style.overflow = '';
}

/* ---------- Make.com automation: lead capture sync to Google Sheet ---------- */
/* NOTE: the Payment event is no longer sent from here — it is fired server-side by
   /api/verify-payment.js only after the Razorpay signature has been verified, so a
   client can no longer forge a "payment succeeded" webhook call. */
var MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/jblxlxgjkjntcqc7k1te6h4yhq21yttk';

function sendToWebhook(payload) {
  try {
    fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () {});
  } catch (err) {}
}

/* ---------- GA4 event helper (never send PII as event params) ---------- */
function trackEvent(name, params) {
  try {
    if (typeof gtag === 'function') gtag('event', name, params || {});
  } catch (err) {}
}

/* ---------- UTM capture: first-touch (kept forever) + last-touch (refreshed each visit) ---------- */
function captureUtmParams() {
  try {
    var params = new URLSearchParams(window.location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'];
    var current = {};
    var found = false;
    keys.forEach(function (k) {
      var v = params.get(k);
      if (v) { current[k] = v; found = true; }
    });
    if (found) {
      current.landing_page = window.location.pathname;
      current.timestamp = new Date().toISOString();
      localStorage.setItem('clipOrbitsUtmLast', JSON.stringify(current));
      if (!localStorage.getItem('clipOrbitsUtmFirst')) {
        localStorage.setItem('clipOrbitsUtmFirst', JSON.stringify(current));
      }
    }
  } catch (err) {}
}

function getUtmData() {
  var data = { first_touch: {}, last_touch: {} };
  try {
    data.first_touch = JSON.parse(localStorage.getItem('clipOrbitsUtmFirst') || '{}');
    data.last_touch = JSON.parse(localStorage.getItem('clipOrbitsUtmLast') || '{}');
  } catch (err) {}
  return data;
}

function submitLeadForm(e) {
  e.preventDefault();
  var lead = {
    name: document.getElementById('leadName').value,
    email: document.getElementById('leadEmail').value,
    phone: document.getElementById('leadPhone').value,
    link: document.getElementById('leadLink').value,
    niche: document.getElementById('leadNiche').value,
    package: currentOrder.name,
    price: currentOrder.price
  };
  try {
    sessionStorage.setItem('clipOrbitsLead', JSON.stringify(lead));
    sessionStorage.setItem('clipOrbitsOrder', JSON.stringify(currentOrder));
  } catch (err) {}

  var utm = getUtmData();
  sendToWebhook({
    event: 'Lead',
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    link: lead.link,
    niche: lead.niche,
    package: lead.package,
    price: lead.price,
    payment_id: '',
    source_page: document.body.getAttribute('data-page') || '',
    utm_first_touch: utm.first_touch,
    utm_last_touch: utm.last_touch
  });
  trackEvent('lead', { package: lead.package });

  window.location.href = 'checkout.html';
  return false;
}

function submitContactForm(e) {
  e.preventDefault();
  var name = document.getElementById('contactName').value;
  var email = document.getElementById('contactEmail').value;
  var link = document.getElementById('contactLink').value;
  var message = document.getElementById('contactMessage').value;

  sendToWebhook({
    event: 'Contact',
    name: name,
    email: email,
    phone: '',
    link: link,
    niche: '',
    package: 'Contact Form',
    price: '',
    payment_id: '',
    source_page: document.body.getAttribute('data-page') || 'Contact',
    message: message
  });

  document.getElementById('contactForm').reset();
  showFormNote('contact');
  return false;
}

/* ---------- Checkout page (reads the lead captured on the previous page) ---------- */
function initCheckoutFromStorage() {
  var summaryEl = document.getElementById('checkoutLeadSummary');
  if (!summaryEl) return;

  var lead = {}, order = { name: 'Channel Audit', price: '$25' };
  try {
    lead = JSON.parse(sessionStorage.getItem('clipOrbitsLead') || '{}');
    order = JSON.parse(sessionStorage.getItem('clipOrbitsOrder') || '{}') || order;
  } catch (err) {}

  window.currentLead = lead;
  window.currentOrder = order.name ? order : { name: 'Channel Audit', price: '$25' };

  document.getElementById('checkoutPkgName').textContent = window.currentOrder.name;
  document.getElementById('checkoutPkgPrice').textContent = window.currentOrder.price;
  document.getElementById('checkoutTotal').textContent = window.currentOrder.price;
  document.getElementById('checkoutPayBtnAmount').textContent = window.currentOrder.price;

  summaryEl.innerHTML = '';
  if (lead.name) {
    var nameEl = document.createElement('div');
    var strong = document.createElement('strong');
    strong.textContent = lead.name;
    nameEl.appendChild(strong);
    var contactEl = document.createElement('div');
    contactEl.textContent = lead.phone ? (lead.email + ' | ' + lead.phone) : (lead.email || '');
    var linkEl = document.createElement('div');
    linkEl.textContent = lead.link || '';
    summaryEl.append(nameEl, contactEl, linkEl);
  } else {
    summaryEl.textContent = 'No order details found on this device — please start again from the Audit, Promote, or Retainer page.';
  }
}

/* ---------- Razorpay ----------
   Order creation and price resolution happen server-side (/api/create-order) so a client
   can never dictate the amount charged; payment success is only trusted after
   /api/verify-payment recomputes and checks the Razorpay HMAC signature. */

/* Maps the display name already used across the site's buttons to the server's product
   catalog key. The server — not this map — is what determines the amount charged. */
var PRODUCT_CATALOG = {
  'Channel Audit': 'audit',
  'Starter Push': 'starter_push',
  'Growth Push': 'growth_push',
  'Starter Growth (Monthly Retainer)': 'starter_growth',
  'Managed Growth (Monthly Retainer)': 'managed_growth',
  'Full Channel Partner (Monthly Retainer)': 'full_channel_partner'
};

function setCheckoutNote(message) {
  var note = document.getElementById('note-checkout');
  if (!note) return;
  note.textContent = message;
  note.classList.add('show');
}

function payWithRazorpay() {
  var order = window.currentOrder || { name: 'Channel Audit', price: '$25' };
  var lead = window.currentLead || {};
  var productId = PRODUCT_CATALOG[order.name];

  if (!productId) {
    setCheckoutNote('We could not match your package to a valid product. Please start again from the Audit, Promote, or Growth Plans page.');
    return false;
  }
  if (typeof Razorpay === 'undefined') {
    setCheckoutNote("Razorpay's checkout script did not load — check your connection and try again, or message us on WhatsApp to complete your order.");
    return false;
  }

  var payBtn = document.getElementById('checkoutPayBtn');
  if (payBtn) payBtn.disabled = true;
  setCheckoutNote('Preparing your secure payment...');

  fetch('/api/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: productId })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      if (payBtn) payBtn.disabled = false;
      if (!result.ok) {
        setCheckoutNote(result.data && result.data.error ? result.data.error : 'Could not start your order. Please try again.');
        return;
      }
      openRazorpayCheckout(result.data, productId, lead);
    })
    .catch(function () {
      if (payBtn) payBtn.disabled = false;
      setCheckoutNote('Could not reach the payment server. Please check your connection and try again.');
    });

  return false;
}

function openRazorpayCheckout(orderData, productId, lead) {
  var options = {
    key: orderData.key_id,
    amount: orderData.amount,
    currency: orderData.currency,
    order_id: orderData.order_id,
    name: 'ClipOrbits',
    description: orderData.product_name,
    prefill: { name: lead.name || '', email: lead.email || '', contact: lead.phone || '' },
    notes: { youtube_link: lead.link || '', niche: lead.niche || '', package: orderData.product_name },
    theme: { color: '#1663D6' },
    handler: function (response) { verifyAndShowSuccess(response, lead, productId, orderData); },
    modal: { ondismiss: function () { setCheckoutNote('Payment window closed. You can try again whenever you are ready.'); } }
  };

  var rzp = new Razorpay(options);
  rzp.on('payment.failed', function (response) {
    setCheckoutNote('Payment failed: ' + (response.error && response.error.description ? response.error.description : 'please try again.'));
  });
  rzp.open();
}

function verifyAndShowSuccess(response, lead, productId, orderData) {
  setCheckoutNote('Verifying your payment...');
  var utm = getUtmData();

  fetch('/api/verify-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature,
      product_id: productId,
      product_name: orderData.product_name,
      lead: lead || {},
      utm_first_touch: utm.first_touch,
      utm_last_touch: utm.last_touch
    })
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      if (result.ok && result.data && result.data.verified) {
        showPaymentSuccess(response.razorpay_payment_id, lead, orderData);
      } else {
        setCheckoutNote(
          'We could not automatically verify this payment. If money was deducted, please message us on WhatsApp with Payment ID ' +
          response.razorpay_payment_id + ' so we can confirm it manually.'
        );
      }
    })
    .catch(function () {
      setCheckoutNote(
        'We could not reach our server to verify this payment. If money was deducted, please message us on WhatsApp with Payment ID ' +
        response.razorpay_payment_id + ' so we can confirm it manually.'
      );
    });
}

function showPaymentSuccess(paymentId, lead, orderData) {
  document.getElementById('checkoutPaymentPanel').hidden = true;
  document.getElementById('checkoutSuccessPanel').hidden = false;
  document.getElementById('checkoutSuccessDetail').textContent =
    'Payment ID ' + paymentId + ' — a confirmation has been sent to ' + ((lead && lead.email) || 'your email') + '.';

  trackEvent('purchase', {
    transaction_id: paymentId,
    value: orderData.amount / 100,
    currency: orderData.currency,
    items: [{ item_name: orderData.product_name }]
  });
}

function parseAmountToCents(priceStr) {
  var clean = String(priceStr).replace(/[^0-9.]/g, '');
  var amount = parseFloat(clean);
  return Math.round((isNaN(amount) ? 0 : amount) * 100);
}
