/**
 * Crate Music Player
 * Self-hosted streaming PWA (auth handled upstream by the proxy)
 *
 * @module main
 */

import { init } from './js/events.js';

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
