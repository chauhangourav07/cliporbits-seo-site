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
});

document.addEventListener('keydown', function (e) {
  var modal = document.getElementById('leadModal');
  if (e.key === 'Escape' && modal && !modal.hidden) closeLeadModal();
});

function fakeSubmit(e, id) {
  e.preventDefault();
  var note = document.getElementById('note-' + id);
  if (note) {
    note.classList.add('show');
    setTimeout(function () { note.classList.remove('show'); }, 6000);
  }
  return false;
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

/* ---------- Make.com automation: lead capture + payment sync to Google Sheet ---------- */
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
    source_page: document.body.getAttribute('data-page') || ''
  });

  window.location.href = 'checkout.html';
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

/* ---------- Razorpay ---------- */
var RAZORPAY_KEY_ID = 'rzp_test_TaN7iMrpJw7tuC';

function parseAmountToCents(priceStr) {
  var clean = String(priceStr).replace(/[^0-9.]/g, '');
  var amount = parseFloat(clean);
  return Math.round((isNaN(amount) ? 0 : amount) * 100);
}

function payWithRazorpay() {
  var note = document.getElementById('note-checkout');
  var order = window.currentOrder || { name: 'Channel Audit', price: '$25' };
  var lead = window.currentLead || {};

  if (typeof Razorpay === 'undefined') {
    note.textContent = "Razorpay's checkout script did not load — check your connection and try again, or message us on WhatsApp to complete your order.";
    note.classList.add('show');
    return false;
  }

  var options = {
    key: RAZORPAY_KEY_ID,
    amount: parseAmountToCents(order.price),
    currency: 'USD',
    name: 'ClipOrbits',
    description: order.name,
    prefill: { name: lead.name || '', email: lead.email || '', contact: lead.phone || '' },
    notes: { youtube_link: lead.link || '', niche: lead.niche || '', package: order.name },
    theme: { color: '#1663D6' },
    handler: function (response) { showPaymentSuccess(response, lead); },
    modal: { ondismiss: function () {} }
  };

  var rzp = new Razorpay(options);
  rzp.on('payment.failed', function (response) {
    note.textContent = 'Payment failed: ' + (response.error && response.error.description ? response.error.description : 'please try again.');
    note.classList.add('show');
  });
  rzp.open();
  return false;
}

function showPaymentSuccess(response, lead) {
  document.getElementById('checkoutPaymentPanel').hidden = true;
  document.getElementById('checkoutSuccessPanel').hidden = false;
  var paymentId = response && response.razorpay_payment_id ? response.razorpay_payment_id : '';
  document.getElementById('checkoutSuccessDetail').textContent =
    'Payment ID ' + paymentId + ' — a confirmation has been sent to ' + ((lead && lead.email) || 'your email') + '.';

  var order = window.currentOrder || { name: 'Channel Audit', price: '$25' };
  lead = lead || {};
  sendToWebhook({
    event: 'Payment',
    name: lead.name || '',
    email: lead.email || '',
    phone: lead.phone || '',
    link: lead.link || '',
    niche: lead.niche || '',
    package: order.name,
    price: order.price,
    payment_id: paymentId,
    source_page: 'Checkout'
  });
  // In production: also verify response.razorpay_payment_id / order_id / signature on your
  // backend before treating this order as paid — this client-side event is for CRM/sheet sync only.
}
