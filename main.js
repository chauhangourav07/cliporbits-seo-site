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

  enhanceLeadModal();
  initContactShortcuts();
  initCheckoutFromStorage();
  captureUtmParams();
});

/* ---------- GA4: every WhatsApp link click, wherever it sits on the page ---------- */
document.addEventListener('click', function (e) {
  var link = e.target.closest ? e.target.closest('a[href*="wa.me/"]') : null;
  if (link) {
    trackEvent('whatsapp_click', {
      location: link.getAttribute('data-wa-location') || 'inline',
      page: document.body.getAttribute('data-page') || ''
    });
  }
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

  /* ---------- Screenshot lightbox ---------- */
  var lightboxImages = Array.prototype.map.call(track.querySelectorAll('img'), function (img) { return img.getAttribute('src'); });
  var lightboxIndex = 0;
  var lightbox = document.getElementById('carouselLightbox');
  var lightboxImg = document.getElementById('lightboxImg');

  window.openLightbox = function (i) {
    lightboxIndex = i;
    lightboxImg.src = lightboxImages[lightboxIndex];
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  };
  window.closeLightbox = function () {
    lightbox.hidden = true;
    document.body.style.overflow = '';
  };
  window.lightboxNav = function (dir) {
    lightboxIndex = (lightboxIndex + dir + lightboxImages.length) % lightboxImages.length;
    lightboxImg.src = lightboxImages[lightboxIndex];
  };
  document.addEventListener('keydown', function (e) {
    if (lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxNav(-1);
    if (e.key === 'ArrowRight') lightboxNav(1);
  });
})();

/* ---------- Lead modal -> Razorpay flow ----------
   The modal collects the lead and opens Razorpay directly; checkout.html stays as a
   fallback for anyone who lands on it from an old link or email. */
var currentOrder = { name: 'Channel Audit', price: '$25' };
var currentGoal = '';
var startedLeadKeys = {};
var sentLeadKey = '';

function openLeadModal(name, price, prefillLink, prefillEmail, prefillName) {
  currentOrder = { name: name, price: price };
  currentGoal = '';
  document.getElementById('modalPkgName').textContent = name;
  document.getElementById('modalPkgPrice').textContent = price;
  document.getElementById('leadForm').reset();
  if (prefillLink) document.getElementById('leadLink').value = prefillLink;
  if (prefillEmail) document.getElementById('leadEmail').value = prefillEmail;
  if (prefillName) document.getElementById('leadName').value = prefillName;
  resetLeadModal();
  document.getElementById('leadModal').hidden = false;
  document.body.style.overflow = 'hidden';
  trackEvent('begin_checkout', { package: name });
}

function openLeadModalFromForm(e, formEl, name, price) {
  e.preventDefault();
  var field = function (role) {
    var el = formEl.querySelector('[data-role="' + role + '"]');
    return el ? el.value.trim() : '';
  };
  var emailInput = formEl.querySelector('input[type="email"]');
  var email = emailInput ? emailInput.value.trim() : '';
  openLeadModal(name, price, field('channel-link'), email, field('name'));
  currentGoal = field('goal');
  sendLeadStarted({ name: field('name'), email: email, link: field('channel-link'), goal: currentGoal, package: name, price: price });
  return false;
}

function closeLeadModal() {
  document.getElementById('leadModal').hidden = true;
  document.body.style.overflow = '';
}

function isLeadModalOpen() {
  var modal = document.getElementById('leadModal');
  return !!(modal && !modal.hidden);
}

/* Adds the payment status line, trust line and success panel to the shared modal markup. */
function enhanceLeadModal() {
  var form = document.getElementById('leadForm');
  if (!form || document.getElementById('note-modal')) return;
  var box = form.parentNode;

  var note = document.createElement('div');
  note.className = 'form-note';
  note.id = 'note-modal';
  note.setAttribute('role', 'status');
  var submitBtn = form.querySelector('button[type="submit"]');
  form.insertBefore(note, submitBtn.nextSibling);

  var trust = document.createElement('p');
  trust.className = 'micro modal-trust';
  trust.textContent = 'Secure payment by Razorpay. The Verified Delivery Guarantee applies to this order.';
  form.insertBefore(trust, note.nextSibling);

  var success = document.createElement('div');
  success.id = 'modalSuccess';
  success.className = 'modal-success';
  success.hidden = true;
  var title = document.createElement('h3');
  title.textContent = 'Payment successful';
  var detail = document.createElement('p');
  detail.id = 'modalSuccessDetail';
  var next = document.createElement('p');
  next.textContent = 'Gourav will personally review your order and reach out on WhatsApp within 24 hours.';
  var done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn btn-primary btn-block';
  done.textContent = 'Done';
  done.addEventListener('click', closeLeadModal);
  success.append(title, detail, next, done);
  box.appendChild(success);
}

function resetLeadModal() {
  var box = document.querySelector('#leadModal .modal-box');
  if (!box) return;
  Array.prototype.forEach.call(box.children, function (el) {
    if (el.id === 'modalSuccess') el.hidden = true;
    else if (el.classList.contains('modal-hide-on-success')) { el.hidden = false; el.classList.remove('modal-hide-on-success'); }
  });
  box.classList.remove('is-success');
  var note = document.getElementById('note-modal');
  if (note) { note.textContent = ''; note.classList.remove('show'); }
  var btn = document.querySelector('#leadForm button[type="submit"]');
  if (btn) btn.disabled = false;
}

function showModalSuccess(detailText) {
  var box = document.querySelector('#leadModal .modal-box');
  var success = document.getElementById('modalSuccess');
  if (!box || !success) return;
  Array.prototype.forEach.call(box.children, function (el) {
    if (el === success || el.classList.contains('modal-close') || el.classList.contains('modal-order')) return;
    el.hidden = true;
    el.classList.add('modal-hide-on-success');
  });
  document.getElementById('modalSuccessDetail').textContent = detailText;
  success.hidden = false;
  box.classList.add('is-success');
  document.getElementById('leadModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

/* ---------- Sticky mobile CTA bar + desktop WhatsApp button ---------- */
var WHATSAPP_NUMBER = '919306256300';
var WHATSAPP_DEFAULT_TEXT = 'Hi ClipOrbits, I have a question about YouTube promotion.';
var WHATSAPP_RETAINER_TEXT = "Hi ClipOrbits, I'd like to talk through which retainer plan fits my channel.";
var STICKY_CTA_BY_PAGE = {
  promote: { label: 'Start My $49 Push →', order: ['Starter Push', '$49'] },
  retainer: { label: 'Talk Through My Plan →', whatsappText: WHATSAPP_RETAINER_TEXT }
};
var STICKY_CTA_DEFAULT = { label: 'Get My $25 Audit →', order: ['Channel Audit', '$25'] };
var WHATSAPP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

function whatsappUrl(text) {
  return 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(text);
}

function makeWhatsappLink(className, location, text, label) {
  var a = document.createElement('a');
  a.className = className;
  a.href = whatsappUrl(text);
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('data-wa-location', location);
  a.setAttribute('aria-label', 'Chat with ClipOrbits on WhatsApp');
  a.innerHTML = WHATSAPP_ICON + '<span>' + label + '</span>';
  return a;
}

function initContactShortcuts() {
  var page = document.body.getAttribute('data-page') || '';
  if (page === 'checkout' || !document.getElementById('leadModal')) return;
  var cta = STICKY_CTA_BY_PAGE[page] || STICKY_CTA_DEFAULT;
  var waText = page === 'retainer' ? WHATSAPP_RETAINER_TEXT : WHATSAPP_DEFAULT_TEXT;

  document.body.appendChild(makeWhatsappLink('wa-float', 'float', waText, 'Chat on WhatsApp'));

  var bar = document.createElement('div');
  bar.className = 'sticky-cta';
  if (cta.whatsappText) {
    var waMain = makeWhatsappLink('btn btn-primary sticky-cta-main', 'sticky_bar', cta.whatsappText, cta.label);
    waMain.querySelector('svg').remove();
    bar.appendChild(waMain);
  } else {
    var main = document.createElement('button');
    main.type = 'button';
    main.className = 'btn btn-primary sticky-cta-main';
    main.textContent = cta.label;
    main.addEventListener('click', function () {
      trackEvent('sticky_cta_click', { package: cta.order[0] });
      openLeadModal(cta.order[0], cta.order[1]);
    });
    bar.appendChild(main);
    bar.appendChild(makeWhatsappLink('btn sticky-cta-wa', 'sticky_bar', waText, 'WhatsApp'));
  }
  document.body.appendChild(bar);
  document.body.classList.add('has-sticky-cta');

  /* Hide the bar while the hero's own button is on screen, and while the keyboard is up. */
  var heroButton = document.querySelector('.hero form button[type="submit"], .hero .btn-primary');
  var heroVisible = false;
  var typing = false;
  function update() { bar.classList.toggle('is-hidden', heroVisible || typing); }
  if (heroButton && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      heroVisible = entries[0].isIntersecting;
      update();
    }).observe(heroButton);
  }
  document.addEventListener('focusin', function (e) {
    if (e.target.matches && e.target.matches('input, textarea, select')) { typing = true; update(); }
  });
  document.addEventListener('focusout', function () { typing = false; update(); });
}

/* ---------- Make.com automation: lead capture sync to Google Sheet ---------- */
/* NOTE: the Payment event is no longer sent from here, it is fired server-side by
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

/* First-step capture: a hero or page form only has email + link, but saving it now means a
   visitor who closes the modal still lands in the sheet (event "Lead Started"). */
function sendLeadStarted(lead) {
  if (!lead.email) return;
  var key = lead.email + '|' + lead.package;
  if (startedLeadKeys[key]) return;
  startedLeadKeys[key] = true;

  var utm = getUtmData();
  sendToWebhook({
    event: 'Lead Started',
    name: lead.name || '',
    email: lead.email,
    phone: '',
    link: lead.link || '',
    niche: '',
    package: lead.package,
    price: lead.price,
    payment_id: '',
    source_page: document.body.getAttribute('data-page') || '',
    message: lead.goal ? 'Goal: ' + lead.goal : '',
    utm_first_touch: utm.first_touch,
    utm_last_touch: utm.last_touch
  });
  trackEvent('lead_started', { package: lead.package });
}

function submitLeadForm(e) {
  e.preventDefault();
  var lead = {
    name: document.getElementById('leadName').value,
    email: document.getElementById('leadEmail').value,
    phone: document.getElementById('leadPhone').value,
    link: document.getElementById('leadLink').value,
    niche: document.getElementById('leadNiche').value,
    goal: currentGoal,
    package: currentOrder.name,
    price: currentOrder.price
  };
  try {
    sessionStorage.setItem('clipOrbitsLead', JSON.stringify(lead));
    sessionStorage.setItem('clipOrbitsOrder', JSON.stringify(currentOrder));
  } catch (err) {}
  window.currentLead = lead;

  /* A retry after closing the Razorpay window shouldn't log the same lead twice. */
  var leadKey = [lead.email, lead.link, lead.package].join('|');
  if (sentLeadKey !== leadKey) {
    sentLeadKey = leadKey;
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
      message: lead.goal ? 'Goal: ' + lead.goal : '',
      utm_first_touch: utm.first_touch,
      utm_last_touch: utm.last_touch
    });
    trackEvent('lead', { package: lead.package });
  }

  payWithRazorpay();
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
    summaryEl.textContent = 'No order details found on this device, please start again from the Audit, Promote, or Retainer page.';
  }
}

/* ---------- Razorpay ----------
   Order creation and price resolution happen server-side (/api/create-order) so a client
   can never dictate the amount charged; payment success is only trusted after
   /api/verify-payment recomputes and checks the Razorpay HMAC signature. */

/* Maps the display name already used across the site's buttons to the server's product
   catalog key. The server, not this map, is what determines the amount charged. */
var PRODUCT_CATALOG = {
  'Channel Audit': 'audit',
  'Starter Push': 'starter_push',
  'Growth Push': 'growth_push',
  'Starter Growth (Monthly Retainer)': 'starter_growth',
  'Managed Growth (Monthly Retainer)': 'managed_growth',
  'Full Channel Partner (Monthly Retainer)': 'full_channel_partner'
};

/* Payment runs either from the lead modal (every page) or from checkout.html. */
function setCheckoutNote(message) {
  var note = document.getElementById(isLeadModalOpen() ? 'note-modal' : 'note-checkout');
  if (!note) return;
  note.textContent = message;
  note.classList.add('show');
}

function getPayButton() {
  return isLeadModalOpen()
    ? document.querySelector('#leadForm button[type="submit"]')
    : document.getElementById('checkoutPayBtn');
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
    setCheckoutNote("Razorpay's checkout script did not load, check your connection and try again, or message us on WhatsApp to complete your order.");
    return false;
  }

  var payBtn = getPayButton();
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
  var detail = 'Payment ID ' + paymentId + ', a confirmation has been sent to ' + ((lead && lead.email) || 'your email') + '.';
  var checkoutSuccess = document.getElementById('checkoutSuccessPanel');
  if (checkoutSuccess && !isLeadModalOpen()) {
    document.getElementById('checkoutPaymentPanel').hidden = true;
    checkoutSuccess.hidden = false;
    document.getElementById('checkoutSuccessDetail').textContent = detail;
  } else {
    showModalSuccess(detail);
  }

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
