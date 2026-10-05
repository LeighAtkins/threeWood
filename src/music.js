/**
 * Music — the drum & bass soundtrack's on/off switch.
 *
 * Off until the player asks for it. The band itself (musicRig.js, and Tone.js
 * with it) is only downloaded the first time music is switched on, and plays
 * through the Audio module's context so it needs no unlock of its own.
 */
import { SCENE_LEVEL } from './core/dnbPattern.js';

const KEY = 'threewood.music';

export class Music {
  /** @param {import('./audio.js').Audio} audio */
  constructor(audio) {
    this.audio = audio;
    this.enabled = false;
    this.level = 0;
    this.muffled = false;
    this.rig = null;
    this.loading = null;
    try { this.enabled = localStorage.getItem(KEY) === '1'; } catch { /* private mode */ }
    document.addEventListener('visibilitychange', () => this.sync());
  }

  /** Resolves to the state actually reached (stays off if the band can't be fetched). */
  async setEnabled(on) {
    this.enabled = on;
    await this.sync();
    try { localStorage.setItem(KEY, this.enabled ? '1' : '0'); } catch { /* ignore */ }
    return this.enabled;
  }

  /** Call from any user gesture: a saved "on" starts once the context is unlocked. */
  wake() {
    if (this.enabled && !this.rig) this.sync();
  }

  /** Follow the game: each state plays at its own intensity. */
  setScene(state) {
    this.level = SCENE_LEVEL[state] ?? 1;
    this.rig?.setLevel(this.level);
  }

  /** Muffle the track behind the pause menu. */
  setMuffled(on) {
    if (on === this.muffled) return;
    this.muffled = on;
    this.rig?.setMuffled(on);
  }

  /** A cymbal for the big moments. */
  accent() { this.rig?.accent(); }

  async sync() {
    const wanted = () => this.enabled && document.visibilityState === 'visible';
    if (wanted() && !this.rig) {
      if (!this.audio.ctx) return; // not unlocked yet; wake() comes back
      this.loading ??= this.load();
      await this.loading;
      this.loading = null;
    }
    if (!this.rig) return;
    if (wanted()) this.rig.play(); else this.rig.pause();
  }

  async load() {
    try {
      const { MusicRig } = await import('./musicRig.js');
      const rig = await MusicRig.create(this.audio.ctx);
      rig.setLevel(this.level);
      rig.setMuffled(this.muffled);
      this.rig = rig;
    } catch (err) {
      // Offline before the band was ever cached, most likely
      console.warn('Music unavailable', err);
      this.enabled = false;
    }
  }
}
