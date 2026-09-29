(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var formKey = script.getAttribute("data-form-key");
  if (!formKey) return;
  var scriptUrl = new URL(script.src, window.location.href);
  var apiBase = (script.getAttribute("data-api-base") || scriptUrl.origin).replace(/\/$/, "");
  var visitorKey = "sthyra_marketing_visitor";
  var sessionKey = "sthyra_marketing_session";

  function id() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "evt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
  }

  function stored(storage, key) {
    try {
      var existing = storage.getItem(key);
      if (existing) return existing;
      var created = id();
      storage.setItem(key, created);
      return created;
    } catch {
      return id();
    }
  }

  var visitorId = stored(window.localStorage, visitorKey);
  var sessionId = stored(window.sessionStorage, sessionKey);

  function attribution(extra) {
    var params = new URLSearchParams(window.location.search);
    return Object.assign(
      {
        anonymous_visitor_id: visitorId,
        session_id: sessionId,
        landing_page_url: window.location.href,
        referrer_url: document.referrer || null,
        utm_source: params.get("utm_source"),
        utm_medium: params.get("utm_medium"),
        utm_campaign: params.get("utm_campaign"),
        utm_term: params.get("utm_term"),
        utm_content: params.get("utm_content"),
        gclid: params.get("gclid"),
        gbraid: params.get("gbraid"),
        wbraid: params.get("wbraid"),
        fbclid: params.get("fbclid"),
      },
      extra || {},
    );
  }

  function post(path, payload, options) {
    return fetch(apiBase + "/api/marketing/forms/" + encodeURIComponent(formKey) + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: Boolean(options && options.keepalive),
      mode: "cors",
      credentials: "omit",
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.error || "Marketing request failed");
        return body;
      });
    });
  }

  function track(eventType, metadata, extraAttribution) {
    return post(
      "/track",
      {
        event_id: id(),
        event_type: eventType || "page_view",
        attribution: attribution(extraAttribution),
        metadata: metadata || {},
      },
      { keepalive: eventType === "page_exit" },
    );
  }

  function submit(fields, options) {
    options = options || {};
    return post("/submit", {
      event_id: options.eventId || id(),
      fields: fields || {},
      attribution: attribution(Object.assign({
        event_type: "form_submit",
        ad_user_data_consent: options.adUserDataConsent || "unknown",
        ad_personalization_consent: options.adPersonalizationConsent || "unknown",
      }, options.attribution || {})),
      website_url: fields && fields.website_url,
    });
  }

  window.SthyraMarketing = Object.freeze({
    track: track,
    submit: submit,
    visitorId: visitorId,
    sessionId: sessionId,
  });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-sthyra-form]")) return;
    event.preventDefault();
    var fields = {};
    new FormData(form).forEach(function (value, key) {
      if (typeof value === "string") fields[key] = value;
    });
    form.dispatchEvent(new CustomEvent("sthyra:submitting", { bubbles: true }));
    submit(fields, {
      adUserDataConsent: form.getAttribute("data-ad-user-data-consent") || "unknown",
      adPersonalizationConsent: form.getAttribute("data-ad-personalization-consent") || "unknown",
    }).then(function (result) {
      form.dispatchEvent(new CustomEvent("sthyra:submitted", { bubbles: true, detail: result }));
    }).catch(function (error) {
      form.dispatchEvent(new CustomEvent("sthyra:error", { bubbles: true, detail: { error: error } }));
    });
  });

  if (script.getAttribute("data-auto-track") !== "false") {
    track("page_view", { title: document.title }).catch(function () {});
  }
})();
