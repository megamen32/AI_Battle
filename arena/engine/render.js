import { len, sub, rot, add, mul } from "./math.js";

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    // debug flags (can be toggled from main.js)
    this.debug = {
      rays: false,
      rayHits: false,
      info: false,
    };
    // camera/view settings
    this.camera = {
      x: 0,      // pan offset x
      y: 0,      // pan offset y
      zoom: 1,   // zoom level (>1 = zoomed in)
    };
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    // auto follow settings
    this.autoFollow = true;
    this.minZoom = 0.5;
    this.maxZoom = 10;
    this._smooth = 0.12; // camera smoothing factor (0..1)
    this.autoZoomBias = 1;
    this.autoZoomBiasMin = 0.1;
    this.autoZoomBiasMax = 10.5;
  }

  // Convert canvas coordinates to world coordinates
  screenToWorld(canvasX, canvasY) {
    const cameraX = canvasX / this.camera.zoom + this.camera.x;
    const cameraY = canvasY / this.camera.zoom + this.camera.y;
    return { x: cameraX, y: cameraY };
  }

  // Convert world coordinates to canvas coordinates
  worldToScreen(worldX, worldY) {
    const canvasX = (worldX - this.camera.x) * this.camera.zoom;
    const canvasY = (worldY - this.camera.y) * this.camera.zoom;
    return { x: canvasX, y: canvasY };
  }

  draw(game) {
    const ctx = this.ctx;
    const { width:w, height:h } = this.c;
    ctx.clearRect(0,0,w,h);

    // Auto-follow all cars: compute bounding box and target camera
    if (this.autoFollow && game && game.cars && !this.isDragging) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const car of game.cars) {
        if (!car) continue;
        minX = Math.min(minX, car.pos.x);
        minY = Math.min(minY, car.pos.y);
        maxX = Math.max(maxX, car.pos.x);
        maxY = Math.max(maxY, car.pos.y);
      }
      if (minX === Infinity) { minX = 0; minY = 0; maxX = w; maxY = h; }

      // padding in world units
      const PAD = 160;
      const bboxW = Math.max(1, maxX - minX);
      const bboxH = Math.max(1, maxY - minY);

      // compute required zoom to fit bbox + padding into canvas
      const targetZoomX = w / (bboxW + PAD * 2);
      const targetZoomY = h / (bboxH + PAD * 2);
      let targetZoom = Math.min(targetZoomX, targetZoomY);
      targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, targetZoom));
      targetZoom *= this.autoZoomBias;
      targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, targetZoom));

      // target camera top-left so that center of bbox lands at canvas center
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const targetCamX = centerX - (w / (2 * targetZoom));
      const targetCamY = centerY - (h / (2 * targetZoom));

      // smooth step towards target
      this.camera.x += (targetCamX - this.camera.x) * this._smooth;
      this.camera.y += (targetCamY - this.camera.y) * this._smooth;
      this.camera.zoom += (targetZoom - this.camera.zoom) * this._smooth;
    }

    // Apply camera transform
    ctx.save();
    ctx.translate(w / 2, h / 2); // center of canvas
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x - w / (2 * this.camera.zoom), -this.camera.y - h / (2 * this.camera.zoom));

    // background grid (drawn in world coordinates across visible area)
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#9fb4cc";
    ctx.lineWidth = 1;

    // visible world bounds
    const worldLeft = this.camera.x;
    const worldTop = this.camera.y;
    const worldRight = this.camera.x + (w / this.camera.zoom);
    const worldBottom = this.camera.y + (h / this.camera.zoom);

    const gridSize = 40;
    ctx.beginPath();
    // vertical lines
    let sx = Math.floor(worldLeft / gridSize) * gridSize;
    for (let x = sx; x <= worldRight; x += gridSize) {
      ctx.moveTo(x, worldTop);
      ctx.lineTo(x, worldBottom);
    }
    // horizontal lines
    let sy = Math.floor(worldTop / gridSize) * gridSize;
    for (let y = sy; y <= worldBottom; y += gridSize) {
      ctx.moveTo(worldLeft, y);
      ctx.lineTo(worldRight, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // walls
    for (const r of game.world.walls) {
      ctx.fillStyle = "#182235";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#2a3b58";
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }

    // finish
    const f = game.world.finish;
    ctx.fillStyle = "rgba(139,213,255,0.14)";
    ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.strokeStyle = "rgba(139,213,255,0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.fillStyle = "rgba(139,213,255,0.9)";
    ctx.font = "14px ui-sans-serif";
    ctx.fillText("FINISH", f.x + 10, f.y + 20);

    // turrets
    for (const t of game.turrets) {
      ctx.fillStyle = "#25324a";
      ctx.beginPath();
      ctx.arc(t.pos.x, t.pos.y, 10, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = "#3a5277";
      ctx.stroke();
    }

    // bullets
    for (const b of game.bullets) {
      ctx.fillStyle = b.owner === "turret" ? "rgba(255,210,140,0.9)" : "rgba(200,255,170,0.9)";
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, 3, 0, Math.PI*2);
      ctx.fill();
    }

    // cars
    for (const car of game.cars) {
      const alive = car.hp > 0;

      ctx.save();
      ctx.translate(car.pos.x, car.pos.y);
      ctx.rotate(car.ang);

      ctx.fillStyle = alive ? (car.id === 0 ? "rgba(140,210,255,0.9)" : "rgba(255,140,210,0.9)") : "rgba(120,120,120,0.6)";
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.roundRect(-16, -10, 32, 20, 8);
      ctx.fill();
      ctx.stroke();

      // nose
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(8, -6, 6, 12);

      ctx.restore();

      // hp bar
      const hp = Math.max(0, Math.min(100, car.hp));
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(car.pos.x - 18, car.pos.y - 26, 36, 6);
      ctx.fillStyle = hp > 30 ? "rgba(170,255,190,0.9)" : "rgba(255,170,170,0.9)";
      ctx.fillRect(car.pos.x - 18, car.pos.y - 26, (36 * hp / 100), 6);

      // name
      ctx.fillStyle = "rgba(214,221,230,0.9)";
      ctx.font = "12px ui-sans-serif";
      ctx.fillText(car.name, car.pos.x - 14, car.pos.y - 32);
    }

    // debug overlays
    if (this.debug.rays || this.debug.rayHits || this.debug.info) {
      ctx.save();
      ctx.lineWidth = 1;

      for (const car of game.cars) {
        // draw vision rays by asking game for input (uses same raycast)
        try {
          const input = game.makeInputFor(car.id);
          const origin = car.pos;

          // draw each ray
          for (const r of input.vision || []) {
            const ang = car.ang + r.angle;
            const dir = rot(ang);
            const end = add(origin, mul(dir, r.dist));

            // color by hit
            let col = 'rgba(200,200,200,0.25)';
            if (r.hit === 'wall') col = 'rgba(255,120,80,0.35)';
            else if (r.hit === 'enemy') col = 'rgba(255,60,160,0.45)';
            else if (r.hit === 'turret') col = 'rgba(255,200,60,0.45)';
            else if (r.hit === 'finish') col = 'rgba(80,200,255,0.45)';

            if (this.debug.rays) {
              ctx.strokeStyle = col;
              ctx.beginPath();
              ctx.moveTo(origin.x, origin.y);
              ctx.lineTo(end.x, end.y);
              ctx.stroke();
            }

            if (this.debug.rayHits && r.hit) {
              // draw hit marker
              ctx.fillStyle = col;
              ctx.beginPath();
              ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
              ctx.fill();

              // label
              ctx.fillStyle = 'rgba(255,255,255,0.9)';
              ctx.font = '10px ui-sans-serif';
              ctx.fillText(`${r.hit} ${Math.round(r.dist)}`, end.x + 6, end.y - 6);
            }
          }

          if (this.debug.info) {
            // draw car debug box
            const infoX = car.pos.x + 18;
            const infoY = car.pos.y - 22;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(infoX, infoY, 140, 44);
            ctx.fillStyle = 'rgba(220,230,240,0.95)';
            ctx.font = '11px ui-sans-serif';
            const speed = Math.round(len(car.vel));
            ctx.fillText(`${car.name} id=${car.id}`, infoX + 6, infoY + 12);
            ctx.fillText(`hp=${Math.round(car.hp)} sp=${speed}`, infoX + 6, infoY + 26);
            ctx.fillText(`pos=${Math.round(car.pos.x)},${Math.round(car.pos.y)}`, infoX + 6, infoY + 40);
          }
        } catch (e) {
          // makeInputFor could throw for dead cars; ignore
        }
      }

      ctx.restore(); // pop camera transform for overlay
    }

    // winner overlay (drawn without camera transform)
      // restore from camera transform
      ctx.restore();

      // winner overlay (drawn without camera transform, on top)
      if (game.winner !== null) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "rgba(214,221,230,0.95)";
        ctx.font = "34px ui-sans-serif";
        const text = game.winner === -1 ? `DRAW (${game.winReason})` : `WINNER: ${game.botNames[game.winner]} (${game.winReason})`;
        ctx.fillText(text, 40, 60);
        ctx.font = "14px ui-sans-serif";
        ctx.fillStyle = "rgba(214,221,230,0.75)";
        ctx.fillText("Reset to run again.", 40, 86);
      }
  }

  adjustAutoZoomBias(factor) {
    if (!Number.isFinite(factor) || factor === 0) return;
    const next = this.autoZoomBias * factor;
    this.autoZoomBias = Math.max(this.autoZoomBiasMin, Math.min(this.autoZoomBiasMax, next));
  }

  resetAutoZoomBias() {
    this.autoZoomBias = 1;
  }
}
