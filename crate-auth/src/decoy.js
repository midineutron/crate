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
    function submit() {
      fetch('/auth/konami', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sequence: buf.slice() })
      }).then(function (r) {
        if (r.ok) { window.location.reload(); }
        else { reset(); }
      }).catch(reset);
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
        if (ok) { submit(); }
      }
    });
    // Touch fallback: a long-press sequence is intentionally not supported;
    // the entry path is keyboard-only by design.
  })();
  </script>
</body>
</html>`;
}
