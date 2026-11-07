// JnySaver extractor. Runs inside a page on https://www.instagram.com so every
// request is same-origin, carries the WebView's own cookies (if logged in) and
// uses a real browser network stack.
// Defines window.__jnySaver(text, hints) -> Promise<result>.
// `hints` = headers captured from Instagram's own page requests (x-ig-app-id, ...).
(function () {
  if (window.__jnySaver) return;

  var DESKTOP_APP_ID = '936619743392459';
  var MOBILE_APP_ID = '1217981644879628';
  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var GQL_DOC_ID = '27130156389949648';
  var GQL_NAME = 'PolarisLoggedOutDesktopWWWPostRootContentQuery';

  // ---------- link handling ----------

  function firstLink(text) {
    var m = String(text || '').match(/https?:\/\/(?:[a-z]+\.)?instagram\.com\/[^\s"'<>]*/i);
    return m ? m[0] : null;
  }

  function pathOf(url) {
    return String(url).replace(/^https?:\/\/(?:[a-z]+\.)?instagram\.com/i, '');
  }

  // Code from a normal post path: /p/X, /reel/X, /reels/X, /tv/X, /user/reel/X,
  // or a login redirect carrying ?next=/reel/X/.
  function codeFromPath(path) {
    var p = decodeURIComponent(String(path || ''));
    if (/(^|\/)share\//i.test(p)) return null;
    var m = p.match(/\/(?:p|reels?|tv)\/([A-Za-z0-9_-]{5,})/);
    return m ? m[1] : null;
  }

  function codeFromHtml(html) {
    var m = html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i) ||
            html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i);
    if (m) { var c = codeFromPath(pathOf(m[1])); if (c) return c; }
    m = html.match(/"shortcode"\s*:\s*"([A-Za-z0-9_-]{5,})"/) ||
        html.match(/\\?"code\\?"\s*:\s*\\?"([A-Za-z0-9_-]{5,})\\?"/);
    return m ? m[1] : null;
  }

  // Instagram's share sheet may hand over /share/... links that redirect to the post.
  async function resolveCode(text, log) {
    var link = firstLink(text);
    if (!link) return null;
    var path = pathOf(link);
    var direct = codeFromPath(path);
    if (direct) return direct;
    if (!/(^|\/)share\//i.test(path)) return null;
    try {
      var r = await fetch(path, { credentials: 'include', redirect: 'follow' });
      var c = codeFromPath(pathOf(r.url));
      if (!c) c = codeFromHtml(await r.text());
      log.push('share>' + (c || ('none ' + r.status + ' ' + pathOf(r.url).slice(0, 40))));
      return c;
    } catch (e) {
      log.push('share ' + e.message);
      return null;
    }
  }

  function shortcodeToId(code) {
    if (code.length > 28) code = code.slice(0, code.length - 28);
    var n = 0n;
    for (var i = 0; i < code.length; i++) {
      var v = ALPHABET.indexOf(code[i]);
      if (v < 0) throw new Error('Bad shortcode');
      n = n * 64n + BigInt(v);
    }
    return n.toString();
  }

  // ---------- request helpers ----------

  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // App IDs to try: the one Instagram's own page uses first, then known web IDs.
  function appIds(hints) {
    var ids = [];
    if (hints['x-ig-app-id']) ids.push(hints['x-ig-app-id']);
    var m = document.documentElement.innerHTML.match(
      /"(?:appId|APP_ID|app_id|appID|X-IG-App-ID|igAppId)"\s*:\s*"?(\d{12,18})/);
    if (m) ids.push(m[1]);
    var mobile = /Mobile|Android/i.test(navigator.userAgent);
    ids.push(mobile ? MOBILE_APP_ID : DESKTOP_APP_ID, mobile ? DESKTOP_APP_ID : MOBILE_APP_ID);
    return ids.filter(function (x, i) { return ids.indexOf(x) === i; });
  }

  function headers(appId, hints, extra) {
    var h = {
      'X-IG-App-ID': appId,
      'X-ASBD-ID': hints['x-asbd-id'] || '359341',
      'X-IG-WWW-Claim': hints['x-ig-www-claim'] || '0',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': '*/*'
    };
    for (var k in (extra || {})) if (extra[k]) h[k] = extra[k];
    return h;
  }

  // Short, readable reason from a failed response for the on-screen details.
  async function why(r) {
    var t = '';
    try { t = (await r.text()).replace(/^for \(;;\);/, ''); } catch (e) {}
    var msg = '';
    try { var j = JSON.parse(t); msg = j.message || j.error || (j.errors && j.errors[0] && j.errors[0].message) || ''; }
    catch (e) { msg = /<html/i.test(t) ? 'html' : t.slice(0, 50); }
    var login = /\/accounts\/login/.test(r.url) ? ' (login page)' : '';
    return r.status + (msg ? ' ' + String(msg).slice(0, 60) : '') + login;
  }

  // ---------- parsers ----------

  function area(o) { return (o.width || 0) * (o.height || 0); }

  // Shape used by /api/v1/media/{id}/info/, the post page and the logged-out GraphQL query.
  function fromProduct(p) {
    var nodes = (p.carousel_media && p.carousel_media.length) ? p.carousel_media : [p];
    var out = [];
    nodes.forEach(function (n) {
      var vids = (n.video_versions || []).filter(function (v) { return v && v.url; });
      if (vids.length) {
        vids.sort(function (a, b) { return area(b) - area(a); });
        out.push({ type: 'video', url: vids[0].url });
        return;
      }
      var imgs = ((n.image_versions2 || {}).candidates || []).filter(function (c) { return c && c.url; });
      if (imgs.length) {
        imgs.sort(function (a, b) { return area(b) - area(a); });
        out.push({ type: 'image', url: imgs[0].url });
      }
    });
    return {
      user: (p.user && p.user.username) || (p.owner && p.owner.username) || '',
      media: out
    };
  }

  // Older GraphQL shape (video_url / display_url / edge_sidecar_to_children).
  function fromGraphNode(n) {
    var kids = n.edge_sidecar_to_children && n.edge_sidecar_to_children.edges;
    var nodes = (kids && kids.length) ? kids.map(function (e) { return e.node; }) : [n];
    var out = [];
    nodes.forEach(function (k) {
      if (k.video_url) out.push({ type: 'video', url: k.video_url });
      else if (k.display_url) out.push({ type: 'image', url: k.display_url });
    });
    return { user: (n.owner && n.owner.username) || '', media: out };
  }

  function deepFind(obj, code, depth) {
    if (!obj || typeof obj !== 'object' || depth > 40) return null;
    if ((obj.code === code || obj.shortcode === code) &&
        (obj.video_versions || obj.image_versions2 || obj.carousel_media ||
         obj.video_url || obj.display_url)) return obj;
    for (var k in obj) {
      var r = deepFind(obj[k], code, depth + 1);
      if (r) return r;
    }
    return null;
  }

  function convert(obj) {
    return (obj.video_versions || obj.image_versions2 || obj.carousel_media)
      ? fromProduct(obj) : fromGraphNode(obj);
  }

  function lsdFrom(html) {
    var m = html.match(/"LSD",\[\],\{"token":"([^"]+)"/);
    if (m) return m[1];
    m = html.match(/<script[^>]*id="__eqmc"[^>]*>([\s\S]*?)<\/script>/);
    if (m) { try { return JSON.parse(m[1]).l || null; } catch (e) {} }
    m = html.match(/"lsd"\s*:\s*"([^"]+)"/i);
    return m ? m[1] : null;
  }

  function unescapeUrl(s) {
    return s.replace(/\\+u0026/g, '&').replace(/\\+\//g, '/').replace(/\\/g, '')
            .replace(/&amp;/g, '&');
  }

  // ---------- routes ----------

  async function viaApi(ctx) {
    for (var i = 0; i < ctx.ids.length; i++) {
      var r = await fetch('/api/v1/media/' + ctx.id + '/info/', {
        credentials: 'include',
        headers: headers(ctx.ids[i], ctx.hints, { 'X-CSRFToken': cookie('csrftoken') })
      });
      if (r.ok) {
        var j = await r.json();
        if (j.items && j.items[0]) return fromProduct(j.items[0]);
        ctx.log.push('api[' + ctx.ids[i].slice(0, 4) + '] empty');
      } else {
        ctx.log.push('api[' + ctx.ids[i].slice(0, 4) + '] ' + await why(r));
        if (r.status === 404) return null;
      }
    }
    return null;
  }

  async function viaA1(ctx) {
    var r = await fetch('/p/' + ctx.code + '/?__a=1&__d=dis', {
      credentials: 'include',
      headers: headers(ctx.ids[0], ctx.hints, { 'X-CSRFToken': cookie('csrftoken') })
    });
    if (!r.ok) { ctx.log.push('a1 ' + await why(r)); return null; }
    var t = await r.text();
    try {
      var j = JSON.parse(t);
      if (j.items && j.items[0]) return fromProduct(j.items[0]);
      var g = j.graphql && j.graphql.shortcode_media;
      if (g) return fromGraphNode(g);
    } catch (e) {}
    ctx.log.push('a1 ' + (/<html/i.test(t) ? 'html' : 'empty'));
    return null;
  }

  async function viaGraphql(ctx) {
    var lsd = lsdFrom(document.documentElement.innerHTML);
    if (!lsd) {
      var page = await fetch('/', { credentials: 'include' }).then(function (r) { return r.text(); });
      lsd = lsdFrom(page);
    }
    if (!lsd) { ctx.log.push('gql no-lsd'); return null; }

    var csrf = null;
    try {
      var ruling = await fetch('/api/v1/web/get_ruling_for_content/?content_type=MEDIA&target_id=' + ctx.id,
        { credentials: 'include', headers: headers(ctx.ids[0], ctx.hints) }).then(function (r) { return r.json(); });
      if (ruling && ruling.status === 'ok') csrf = cookie('csrftoken');
    } catch (e) { /* optional step */ }

    for (var i = 0; i < ctx.ids.length; i++) {
      var body = new URLSearchParams({
        lsd: lsd,
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: GQL_NAME,
        server_timestamps: 'true',
        variables: JSON.stringify({ media_id: ctx.id }),
        doc_id: GQL_DOC_ID
      });
      var r = await fetch('/api/graphql', {
        method: 'POST',
        credentials: 'include',
        headers: headers(ctx.ids[i], ctx.hints, {
          'X-FB-Friendly-Name': GQL_NAME,
          'X-FB-LSD': lsd,
          'X-CSRFToken': csrf,
          'Content-Type': 'application/x-www-form-urlencoded'
        }),
        body: body
      });
      if (!r.ok) { ctx.log.push('gql[' + ctx.ids[i].slice(0, 4) + '] ' + await why(r)); continue; }
      var t = (await r.text()).replace(/^for \(;;\);/, '');
      var j = JSON.parse(t);
      var p = j && j.data && j.data.xig_polaris_media && j.data.xig_polaris_media.if_not_gated_logged_out;
      if (p) return fromProduct(p);
      var err = j && j.errors && j.errors[0] && j.errors[0].message;
      ctx.log.push('gql[' + ctx.ids[i].slice(0, 4) + '] ' + (err ? String(err).slice(0, 60) : 'empty'));
    }
    return null;
  }

  async function viaPage(ctx) {
    var r = await fetch('/p/' + ctx.code + '/', { credentials: 'include' });
    if (!r.ok || /\/accounts\/login/.test(r.url)) { ctx.log.push('page ' + await why(r)); return null; }
    var html = await r.text();
    var re = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(html))) {
      if (m[1].indexOf(ctx.code) < 0) continue;
      try {
        var hit = deepFind(JSON.parse(m[1]), ctx.code, 0);
        if (hit) return convert(hit);
      } catch (e) {}
    }
    ctx.log.push('page none');
    return null;
  }

  async function viaEmbed(ctx) {
    var r = await fetch('/p/' + ctx.code + '/embed/captioned/', { credentials: 'include' });
    if (!r.ok) { ctx.log.push('embed ' + await why(r)); return null; }
    var html = await r.text();
    var media = [];
    function add(type, u) {
      u = unescapeUrl(u);
      if (/^https:\/\//.test(u) && media.every(function (x) { return x.url !== u; })) media.push({ type: type, url: u });
    }
    var re = /video_url\\*"\s*:\s*\\*"(https?:.+?)\\*"/g, m;
    while ((m = re.exec(html))) add('video', m[1]);
    if (!media.length) {
      re = /<video[^>]+src="(https?:[^"]+)"/g;
      while ((m = re.exec(html))) add('video', m[1]);
    }
    if (!media.length) {
      m = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/) ||
          html.match(/src="([^"]+)"[^>]*class="EmbeddedMediaImage"/);
      if (m) add('image', m[1]);
    }
    if (!media.length) { ctx.log.push('embed none'); return null; }
    var u = html.match(/class="UsernameText"[^>]*>([^<]+)</);
    return { user: u ? u[1] : '', media: media };
  }

  // ---------- entry point ----------

  window.__jnySaver = async function (text, hints) {
    var log = [];
    hints = hints || {};
    var loggedIn = !!cookie('ds_user_id');
    var base = { loggedIn: loggedIn, log: log };
    function done(extra) { for (var k in extra) base[k] = extra[k]; return base; }

    if (!firstLink(text)) return done({ ok: false, error: 'No Instagram post or reel link found.' });
    var code = await resolveCode(text, log);
    if (!code) return done({ ok: false, error: 'Could not read the post from that link.' });
    var id;
    try { id = shortcodeToId(code); }
    catch (e) { return done({ ok: false, code: code, error: 'That link does not look right.' }); }

    var ctx = { code: code, id: id, hints: hints, ids: appIds(hints), log: log };
    var routes = loggedIn
      ? [['api', viaApi], ['a1', viaA1], ['page', viaPage], ['graphql', viaGraphql], ['embed', viaEmbed]]
      : [['graphql', viaGraphql], ['page', viaPage], ['embed', viaEmbed], ['a1', viaA1]];

    for (var i = 0; i < routes.length; i++) {
      try {
        var res = await routes[i][1](ctx);
        if (res && res.media && res.media.length) {
          return done({ ok: true, code: code, method: routes[i][0], user: res.user, media: res.media });
        }
      } catch (e) { log.push(routes[i][0] + ' ' + e.message); }
    }
    return done({
      ok: false, code: code,
      error: loggedIn
        ? 'Instagram did not give JnySaver this post.'
        : 'Instagram did not return this post without a login. Log in once in JnySaver and try again.'
    });
  };
})();
