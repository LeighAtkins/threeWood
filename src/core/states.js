/**
 * Minimal strict state machine.
 *
 * Kills the stringly-typed state bugs (e.g. states missing from the switch,
 * invalid transitions). Every legal state is declared up front with enter/exit
 * hooks; setting an unknown state throws immediately instead of silently
 * corrupting the game loop.
 */
export class StateMachine {
  /**
   * @param {Object<string, {enter?: Function, exit?: Function}>} states
   * @param {{ initial?: string, onTransition?: (prev: string, next: string) => void }} options
   */
  constructor(states, options = {}) {
    this.states = states;
    this.state = null;
    this.onTransition = options.onTransition || null;
    if (options.initial) this.set(options.initial);
  }

  is(...names) {
    return names.includes(this.state);
  }

  set(next, payload) {
    if (!Object.prototype.hasOwnProperty.call(this.states, next)) {
      throw new Error(`Unknown game state: "${next}". Legal states: ${Object.keys(this.states).join(', ')}`);
    }
    const prev = this.state;
    if (prev === next) return;
    if (prev) this.states[prev].exit?.(next);
    this.state = next;
    this.onTransition?.(prev, next);
    this.states[next].enter?.(prev, payload);
  }
}
