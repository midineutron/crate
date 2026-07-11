// The decoy page. Served as the body of every unauthenticated /auth/verify
// response (status 502) so that, via Traefik forwardAuth, any unauthenticated
// request to any path renders a plausible generic "502 Bad Gateway" gateway
// error. The page silently listens for the konami code; on completion it POSTs
// /auth/konami and, on success, reloads into the real application.

/**
 * Build the decoy HTML.
 * @param {object} opts
 * @param {string} opts.konamiSequence - comma-delimited expected sequence
 */
export function decoyHtml({ konamiSequence } = {}) {
  // Embed the expected sequence so the client can collect the right number of
  // keystrokes. (The server re-validates the submission regardless.)
  const seqJson = JSON.stringify(
    String(konamiSequence || 'up,up,down,down,left,right,left,right,b,a')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>502 Bad Gateway</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    background: #f7f7f7;
    color: #4a4a4a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .wrap { text-align: center; padding: 2rem; max-width: 40rem; }
  h1 { font-size: 2.25rem; font-weight: 600; margin: 0 0 0.5rem; color: #333; }
  p { font-size: 1rem; line-height: 1.5; margin: 0.25rem 0; }
  .code { color: #999; font-size: 0.85rem; margin-top: 1.5rem; }
  hr { border: 0; border-top: 1px solid #e0e0e0; margin: 1.5rem 0; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>502 Bad Gateway</h1>
    <p>The server returned an invalid or incomplete response.</p>
    <p>Please try again in a few moments.</p>
    <hr>
    <p class="code">nginx</p>
  </div>
  <script>
  (function () {
    var seq = ${seqJson};
    var keymap = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      KeyA: 'a', KeyB: 'b'
    };
    var buf = [];
    function reset() { buf = []; }
    function submit(sequence) {
      fetch('/auth/konami', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sequence: sequence })
      }).then(function (r) {
        if (r.ok) { window.location.reload(); }
        else { reset(); touchReset(); }
      }).catch(function () { reset(); touchReset(); });
    }
    window.addEventListener('keydown', function (e) {
      var token = keymap[e.code];
      if (!token) { return; }
      buf.push(token);
      if (buf.length > seq.length) { buf.shift(); }
      // Once we have enough keystrokes matching the expected length, try.
      if (buf.length === seq.length) {
        var ok = true;
        for (var i = 0; i < seq.length; i++) {
          if (buf[i] !== seq[i]) { ok = false; break; }
        }
        if (ok) { submit(buf.slice()); }
      }
    });
    // Touch entry (mobile): swipes supply the directional tokens; a tap supplies
    // the next non-directional token (e.g. B then A). Mirrors the keyboard path,
    // tracking progress against the expected sequence.
    var DIRS = { up: 1, down: 1, left: 1, right: 1 };
    var entered = [];
    function touchReset() { entered = []; }
    function feed(token) {
      var expected = seq[entered.length];
      if (!expected) { touchReset(); return; }
      var expectDir = DIRS[expected] === 1;
      if (token === 'tap') {
        if (expectDir) { return; }        // ignore stray taps during the swipes
        entered.push(expected);           // tap supplies the non-directional token
      } else {                            // a swipe direction
        if (expectDir && token === expected) {
          entered.push(token);
        } else {
          touchReset();                   // wrong gesture: restart, seeding seq[0]
          if (token === seq[0]) { entered.push(token); }
          return;
        }
      }
      if (entered.length === seq.length) { submit(entered.slice()); }
    }
    var sx = 0, sy = 0;
    var SWIPE_MIN = 24, TAP_MAX = 12; // px
    window.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY;
    }, { passive: true });
    window.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx < TAP_MAX && ady < TAP_MAX) { feed('tap'); return; }
      if (adx < SWIPE_MIN && ady < SWIPE_MIN) { return; } // too small to classify
      if (adx > ady) { feed(dx > 0 ? 'right' : 'left'); }
      else { feed(dy > 0 ? 'down' : 'up'); }
    }, { passive: true });
  })();
  </script>
</body>
</html>`;
}
