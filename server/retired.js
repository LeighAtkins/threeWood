// Deliberately stateless retirement stub. No bindings, storage or alarms.
// Keep development, preview and custom-domain routes disabled.
export default {
  fetch() {
    return new Response('ThreeWood multiplayer has been retired. Solo golf remains available at https://threewood.app/.', {
      status: 410,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
