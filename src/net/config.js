// Multiplayer must be explicitly restored in both the browser and Worker.
// Default builds cannot create sockets or retry a parked backend.
export const MULTIPLAYER_ENABLED = import.meta.env?.VITE_MULTIPLAYER_ENABLED === 'true';
