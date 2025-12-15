export function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

export function v(x=0, y=0) { return { x, y }; }
export function add(a,b){ return { x:a.x+b.x, y:a.y+b.y }; }
export function sub(a,b){ return { x:a.x-b.x, y:a.y-b.y }; }
export function mul(a,k){ return { x:a.x*k, y:a.y*k }; }
export function dot(a,b){ return a.x*b.x + a.y*b.y; }
export function len(a){ return Math.hypot(a.x,a.y); }
export function norm(a){
  const L = len(a) || 1;
  return { x:a.x/L, y:a.y/L };
}
export function rot(angle){
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function circleRectResolve(pos, radius, rect) {
  // rect: {x,y,w,h} axis-aligned. returns {pos, hit, n}
  const cx = clamp(pos.x, rect.x, rect.x + rect.w);
  const cy = clamp(pos.y, rect.y, rect.y + rect.h);
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  const d2 = dx*dx + dy*dy;
  if (d2 >= radius*radius) return { pos, hit:false, n: v(0,0) };

  const d = Math.sqrt(d2) || 0.0001;
  const pen = radius - d;
  const n = { x: dx / d, y: dy / d };
  return { pos: { x: pos.x + n.x*pen, y: pos.y + n.y*pen }, hit:true, n };
}

export function reflect(vel, n, bounciness=0.2) {
  // v' = v - (1+e)*(v·n)n
  const vn = dot(vel, n);
  return sub(vel, mul(n, (1 + bounciness) * vn));
}

export function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function rayCircle(o, d, c, r, maxDist) {
  const oc = { x: o.x - c.x, y: o.y - c.y };
  const b = oc.x*d.x + oc.y*d.y;
  const c2 = oc.x*oc.x + oc.y*oc.y - r*r;
  const disc = b*b - c2;
  if (disc < 0) return null;

  const t = -b - Math.sqrt(disc);
  if (t > 0 && t <= maxDist) return t;
  return null;
}

export function rayRect(o, d, r, maxDist) {
  let tmin = 0;
  let tmax = maxDist;

  for (const [p, s, min, max] of [
    [o.x, d.x, r.x, r.x + r.w],
    [o.y, d.y, r.y, r.y + r.h],
  ]) {
    if (Math.abs(s) < 1e-6) {
      if (p < min || p > max) return null;
    } else {
      const t1 = (min - p) / s;
      const t2 = (max - p) / s;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax) return null;
    }
  }
  return tmin <= maxDist ? tmin : null;
}
