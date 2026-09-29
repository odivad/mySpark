/**
 * Live reload for `npm run dev` (scripts/dev.mjs). Only on localhost, and only when the dev server
 * answers /__dev/events — under any other server this does nothing.
 *
 * A reload drops the Bluetooth connection, so while the amp is connected the page is not reloaded
 * behind the user's back: `onUpdate` is called instead, and the app offers a Reload button.
 */
export function startDevReload(isConnected: () => boolean, onUpdate: () => void): void {
  if (!['localhost', '127.0.0.1'].includes(location.hostname) || typeof EventSource === 'undefined') return;
  const events = new EventSource('/__dev/events');
  let ok = false;
  events.addEventListener('hello', () => (ok = true));
  events.addEventListener('reload', () => {
    if (isConnected()) onUpdate();
    else location.reload();
  });
  events.onerror = () => {
    // Not the dev server (e.g. python http.server): stop retrying. The dev server restarting: let it retry.
    if (!ok) events.close();
  };
}
