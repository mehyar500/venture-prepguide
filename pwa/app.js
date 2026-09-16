/* PrepGuide app.js — intake, teaser, checkout. Vanilla, no build step. */
(function () {
  "use strict";

  var CHECKOUT_URL = "https://mehyar.us/api/pay/checkout";
  var PRODUCT_ID = "prepguide-playbook";

  // ---------- intake state ----------
  var intake = { adults: 2, kids: 0, pets: 0 };
  var LIMITS = { adults: [1, 10], kids: [0, 10], pets: [0, 10] };

  function $(id) { return document.getElementById(id); }

  document.querySelectorAll(".stepper").forEach(function (el) {
    var field = el.getAttribute("data-field");
    var valEl = el.querySelector(".stepper-val");
    el.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-step]");
      if (!btn) return;
      var step = parseInt(btn.getAttribute("data-step"), 10);
      var next = intake[field] + step;
      next = Math.max(LIMITS[field][0], Math.min(LIMITS[field][1], next));
      intake[field] = next;
      valEl.textContent = String(next);
    });
  });

  function readIntake() {
    var homeType = document.querySelector('input[name="home_type"]:checked');
    var budget = document.querySelector('input[name="budget_tier"]:checked');
    return {
      adults: intake.adults,
      kids: intake.kids,
      pets: intake.pets,
      home_type: homeType ? homeType.value : "house",
      region: $("region").value,
      budget_tier: budget ? budget.value : "practical",
    };
  }

  function setStatus(el, kind, msg) {
    el.className = "status" + (kind ? " " + kind : "");
    el.textContent = msg || "";
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------- teaser ----------
  var teaserForm = $("intake-form");
  var teaserBtn = $("teaser-btn");
  var teaserStatus = $("teaser-status");
  var teaserResult = $("teaser-result");
  var upsell = $("upsell");

  function renderTeaser(data) {
    var html = "";
    html += '<div class="teaser-head"><span class="tag">✓ Free checklist</span></div>';
    if (data.headline) html += '<p class="teaser-headline">' + esc(data.headline) + "</p>";
    if (data.household_label) html += '<p class="teaser-household">' + esc(data.household_label) + "</p>";
    if (typeof data.water_gallons_72h === "number") {
      html += '<div class="water-callout"><div class="big">' + esc(String(data.water_gallons_72h)) +
        '</div><div class="cap"><strong>gallons of water</strong><br>for your household, 72 hours</div></div>';
    }
    (data.checklist || []).forEach(function (cat) {
      html += '<div class="checklist-cat"><h4>' + esc(cat.name) + "</h4><ul>";
      (cat.items || []).forEach(function (it) {
        html += "<li><span>" + esc(it.item) + '</span><span class="qty">' + esc(it.qty) + "</span></li>";
      });
      html += "</ul></div>";
    });
    if (data.note) html += '<p class="teaser-note">' + esc(data.note) + "</p>";
    teaserResult.innerHTML = html;
    teaserResult.hidden = false;
  }

  if (teaserForm) {
    teaserForm.addEventListener("submit", function (e) {
      e.preventDefault();
      teaserBtn.disabled = true;
      setStatus(teaserStatus, "busy", "Building your personalized checklist…");
      fetch("/api/prepguide/teaser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readIntake()),
      })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }); })
        .then(function (res) {
          teaserBtn.disabled = false;
          var d = res.body;
          if (!d.ok) {
            var msg = d.error === "rate_limited"
              ? "You've hit the free preview limit for today — try again tomorrow, or unlock the full playbook below."
              : "Couldn't build the checklist just now — please try again.";
            setStatus(teaserStatus, "error", msg);
            return;
          }
          setStatus(teaserStatus, "", "");
          renderTeaser(d);
          upsell.hidden = false;
          teaserResult.scrollIntoView({ behavior: "smooth", block: "start" });
        })
        .catch(function () {
          teaserBtn.disabled = false;
          setStatus(teaserStatus, "error", "Network hiccup — please try again.");
        });
    });
  }

  // ---------- checkout (wires every form.buy-form on the page) ----------
  function wireBuyForm(form) {
    var emailEl = form.querySelector(".buy-email");
    var btn = form.querySelector(".buy-btn");
    var statusEl = form.querySelector(".buy-status");
    if (!emailEl || !btn || !statusEl) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = (emailEl.value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setStatus(statusEl, "error", "Enter your email so we can deliver your playbook.");
        emailEl.focus();
        return;
      }
      btn.disabled = true;
      setStatus(statusEl, "busy", "Starting secure checkout…");
      fetch(CHECKOUT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: PRODUCT_ID,
          email: email,
          params: readIntake(),
          success_url: "https://prepguide.mehyar.us/success.html",
          cancel_url: "https://prepguide.mehyar.us/#get",
        }),
      })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }); })
        .then(function (res) {
          var d = res.body;
          if (!d.ok || !d.checkout_url) {
            btn.disabled = false;
            setStatus(statusEl, "error", FRIENDLY[d.error] || "Couldn't start checkout — please try again.");
            return;
          }
          setStatus(statusEl, "busy", "Taking you to secure checkout…");
          window.location.href = d.checkout_url;
        })
        .catch(function () {
          btn.disabled = false;
          setStatus(statusEl, "error", "Network hiccup — please try again.");
        });
    });
  }

  document.querySelectorAll("form.buy-form").forEach(wireBuyForm);

  var FRIENDLY = {
    invalid_email: "That email doesn't look right — double-check it?",
    invalid_product: "This product isn't available right now — try again in a bit.",
    params_too_large: "Something odd with the form data — refresh and try again.",
    stripe_test_not_configured: "Checkout isn't ready yet — try again in a bit.",
    stripe_not_configured: "Checkout isn't ready yet — try again in a bit.",
    checkout_failed: "Couldn't start checkout — please try again.",
  };

  // ---------- reveal on scroll ----------
  var io = null;
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
  }

  // ---------- sticky mobile CTA ----------
  var sticky = $("sticky-cta");
  var getSection = $("get");
  if (sticky && getSection) {
    var onScroll = function () {
      var r = getSection.getBoundingClientRect();
      var past = r.top < window.innerHeight * 0.6 && r.bottom > window.innerHeight * 0.4;
      sticky.hidden = past || window.scrollY < 400;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
})();
