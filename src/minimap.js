/**
 * Minimap — a 2D canvas overhead map of the current hole: fairway path,
 * hazards, trees, green, ball, and a live prediction of the current shot.
 * Drawn bottom-right. Projection centers on the hole's path with adaptive zoom.
 */

const SIZE = 200;                 // canvas pixel size
const PADDING = 14;               // inner padding

export class Minimap {
  constructor(container, game) {
    this.game = game;
    this.visible = false;

    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    Object.assign(this.canvas.style, {
      position: 'absolute',
      right: '20px',
      bottom: '20px',
      width: SIZE + 'px',
      height: SIZE + 'px',
      zIndex: '1001',
      pointerEvents: 'none',
      border: '2px solid #FFD700',
      borderRadius: '8px',
      background: 'rgba(20, 30, 20, 0.55)',
      boxShadow: '0 0 0 2px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.6)',
      display: 'none',
    });
    (container || document.body).appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Projection state, recomputed per hole in update()
    this._cx = 0;
    this._cz = 0;
    this._scale = 1;
  }

  setVisible(v) {
    this.visible = v;
    this.canvas.style.display = v ? 'block' : 'none';
  }

  /** Project a world XZ point to minimap pixel coords. */
  _project(x, z) {
    const px = SIZE / 2 + (x - this._cx) * this._scale;
    const py = SIZE / 2 - (z - this._cz) * this._scale; // +Z up
    return [px, py];
  }

  /**
   * Redraw the minimap.
   * @param {Object} opts
   * @param {THREE.Vector3} opts.ball - ball world position
   * @param {THREE.Vector3} opts.aimDir - normalized horizontal aim direction
   * @param {number} opts.loft - loft in degrees
   * @param {number} opts.power - 0..100 power-meter value
   * @param {number} opts.maxSpeed - club launch speed at 100% power
   * @param {boolean} opts.showShot - whether to draw the predicted shot arc
   */
  update({ ball, aimDir, loft, power, maxSpeed, showShot }) {
    if (!this.visible) return;
    const terrain = this.game.terrain;
    if (!terrain) return;
    const data = terrain.getMinimapData();
    if (!data.tee || !data.hole || !data.path?.length) return;

    // Center + zoom on the path bounds (with margin for hazards)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of data.path) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this._cx = (minX + maxX) / 2;
    this._cz = (minZ + maxZ) / 2;
    const spanX = maxX - minX + 90;
    const spanZ = maxZ - minZ + 90;
    this._scale = (SIZE - PADDING * 2) / Math.max(spanX, spanZ);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // --- Fairway (path polyline, two-tone stroke) ---
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [color, width] of [['#5a8a3a', 13], ['#6fa84a', 8]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      data.path.forEach((p, i) => {
        const [px, py] = this._project(p.x, p.z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }

    // --- Water ponds ---
    for (const w of data.water || []) {
      const [wx, wy] = this._project(w.x, w.z);
      ctx.fillStyle = '#2f5d8a';
      ctx.beginPath();
      ctx.arc(wx, wy, Math.max(3, w.r * this._scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Bunkers ---
    for (const b of data.bunkers || []) {
      const [bx, by] = this._project(b.x, b.z);
      ctx.fillStyle = '#d9c48a';
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(2, b.r * this._scale * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Trees (tiny dark dots — they matter for doglegs/chutes) ---
    ctx.fillStyle = 'rgba(20, 50, 20, 0.85)';
    for (const t of data.trees || []) {
      const [tx, ty] = this._project(t.x, t.z);
      ctx.beginPath();
      ctx.arc(tx, ty, 1.5 * (t.s || 1), 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Green + hole + flag ---
    if (data.green) {
      const [gx, gy] = this._project(data.green.x, data.green.z);
      ctx.fillStyle = '#8fd06a';
      ctx.beginPath();
      ctx.arc(gx, gy, Math.max(6, data.green.size * this._scale * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(gx, gy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e53935';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + 5, gy - 7);
      ctx.stroke();
    }

    // --- Tee marker ---
    {
      const [tx, ty] = this._project(data.tee.x, data.tee.z);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(tx - 3, ty - 3, 6, 6);
    }

    // --- Predicted shot arc ---
    if (showShot && ball && aimDir) {
      this._drawShotArc(ctx, ball, aimDir, loft, power, maxSpeed);
    }

    // --- Ball (drawn last so it sits on top) ---
    if (ball) {
      const [bx, by] = this._project(ball.x, ball.z);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /**
   * Simulate a light ballistic trajectory and draw it as a graded dotted arc
   * ending in a landing marker. Not the real physics — a readable approximation
   * scaled by power and loft so the player can see where the shot will land.
   */
  _drawShotArc(ctx, ball, aimDir, loft, power, maxSpeed) {
    const p = Math.max(0, Math.min(100, power || 50)) / 100;
    const loftRad = (loft || 10) * Math.PI / 180;

    // Match the real launch profile (club max speed x power) so the predicted
    // arc is honest about the selected club
    const speed = (maxSpeed || 42) * p;
    const vx = aimDir.x * speed * Math.cos(loftRad);
    const vz = aimDir.z * speed * Math.cos(loftRad);
    const vy = speed * Math.sin(loftRad);
    const g = 9.81;

    const dt = 0.04;
    let x = ball.x, y = ball.y, z = ball.z;
    let ddx = vx, ddy = vy, ddz = vz;
    const pts = [];
    let landing = null;
    const terrain = this.game.terrain;
    for (let i = 0; i < 160; i++) {
      x += ddx * dt;
      z += ddz * dt;
      ddy -= g * dt;
      y += ddy * dt;
      const ground = terrain.getHeightAtPosition ? terrain.getHeightAtPosition(x, z) : 0;
      pts.push([x, z, y]);
      if (y <= ground && i > 2) {
        landing = { x, z };
        break;
      }
    }
    if (!landing && pts.length) {
      landing = { x: pts[pts.length - 1][0], z: pts[pts.length - 1][1] };
    }

    for (let i = 0; i < pts.length; i++) {
      const t = i / pts.length;
      const [px, py] = this._project(pts[i][0], pts[i][1]);
      ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.5 * (1 - t)})`;
      const r = 1.6 + (1 - t) * 1.2;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const [lx, ly] = this._project(landing.x, landing.z);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(lx, ly, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lx - 6, ly);
    ctx.lineTo(lx + 6, ly);
    ctx.moveTo(lx, ly - 6);
    ctx.lineTo(lx, ly + 6);
    ctx.stroke();
  }
}
