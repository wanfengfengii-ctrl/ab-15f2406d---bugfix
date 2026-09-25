// 纯计算几何工具：二维点、有符号距离、凸包、点与简单多边形关系。
// 所有多边形约定按逆时针(CCW)给出边时，内部位于每条有向边的左侧，
// 因此“点到边的有符号距离”为正表示在内部、为负表示在外部、为 0 表示恰在边界上。

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function pointDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  // 先除以较大分量再做 hypot，避免两个超大分量平方和溢出
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  if (m === 0) return 0;
  return Math.hypot(dx / m, dy / m) * m;
}

/**
 * 数值稳定的叉积符号：返回 (b-a)×(c-a) 的符号（1/0/-1）。
 * 先以参与量的最大绝对值归一化再相乘，避免超大有限坐标（如 1e307 量级）
 * 下坐标差相乘溢出为 Infinity，或 Infinity-Infinity 得到 NaN。
 */
export function crossSign(a, b, c) {
  const u1 = b.x - a.x;
  const v1 = b.y - a.y;
  const u2 = c.x - a.x;
  const v2 = c.y - a.y;
  const m = Math.max(Math.abs(u1), Math.abs(v1), Math.abs(u2), Math.abs(v2));
  if (m === 0) return 0;
  const z = (u1 / m) * (v2 / m) - (v1 / m) * (u2 / m);
  return z > 0 ? 1 : z < 0 ? -1 : 0;
}

/**
 * 点 p 到过 a、b 的直线的有符号距离（沿 a->b 方向，左侧为正）。
 * 中间量按最大参与尺度归一化，保证坐标在整个有限 double 范围内
 * 都不会因叉积相乘溢出而错误返回 Infinity/NaN。
 */
export function lineSide(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const qx = p.x - a.x;
  const qy = p.y - a.y;
  if (dx === 0 && dy === 0) {
    const m = Math.max(Math.abs(qx), Math.abs(qy));
    return m === 0 ? 0 : Math.hypot(qx / m, qy / m) * m;
  }
  const s = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(qx), Math.abs(qy));
  if (s === 0) return 0;
  const l = Math.hypot(dx / s, dy / s);
  if (l === 0) {
    return Math.hypot(qx / s, qy / s) * s; // a、b 在该尺度下已退化为同一点
  }
  const c = (dx / s) * (qy / s) - (dy / s) * (qx / s);
  return (c / l) * s;
}

/**
 * 点到线段的（无符号）距离，用于退化凸包（共线/重合）时的证据量化。
 * 投影参数按统一尺度归一化计算，避免超大坐标下相乘溢出。
 */
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const px = p.x - a.x;
  const py = p.y - a.y;
  if (dx === 0 && dy === 0) {
    const m = Math.max(Math.abs(px), Math.abs(py));
    return m === 0 ? 0 : Math.hypot(px / m, py / m) * m;
  }
  const s = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(px), Math.abs(py));
  const dxs = dx / s;
  const dys = dy / s;
  const len2 = dxs * dxs + dys * dys;
  if (len2 === 0) {
    return Math.hypot(px / s, py / s) * s;
  }
  let t = ((px / s) * dxs + (py / s) * dys) / len2;
  t = Math.max(0, Math.min(1, t));
  const rx = px / s - t * dxs;
  const ry = py / s - t * dys;
  return Math.hypot(rx, ry) * s;
}

export function polygonSignedArea(poly) {
  // 先按顶点最大尺度归一化叉积，避免超大坐标下 shoelace 求和溢出或 NaN。
  let mx = 0;
  for (const p of poly) {
    if (Math.abs(p.x) > mx) mx = Math.abs(p.x);
    if (Math.abs(p.y) > mx) mx = Math.abs(p.y);
  }
  if (mx === 0) return 0;
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += (a.x / mx) * (b.y / mx) - (b.x / mx) * (a.y / mx);
  }
  // 真实面积超过 double 上限时，mx*mx 为 Infinity，仍保留正确符号；
  // 退化（共线）情形 s 为 0，返回 0。
  return s === 0 ? 0 : (s / 2) * (mx * mx);
}

/**
 * 保证多边形为逆时针方向。
 */
export function ensureCCW(poly) {
  return polygonSignedArea(poly) < 0 ? poly.slice().reverse() : poly.slice();
}

/**
 * 点到（逆时针）多边形边界的有符号距离：
 * 内部为正（到最近边的距离），外部为负。
 */
export function polygonSignedDistance(polyCCW, p) {
  let minAbs = Infinity;
  for (let i = 0; i < polyCCW.length; i++) {
    minAbs = Math.min(minAbs, lineSide(p, polyCCW[i], polyCCW[(i + 1) % polyCCW.length]));
  }
  return minAbs;
}

/**
 * 射线法点是否在多边形内（含边界）。
 * 边界共线判定与射线交点均用不产生超大乘积的形式，
 * 保证在整个有限 double 坐标范围内结果可靠。
 */
export function pointInPolygon(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const onBoundary =
      crossSign(a, b, p) === 0 &&
      Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
      Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
    if (onBoundary) return true;
    if (a.y > p.y !== b.y > p.y) {
      // 交点参数 t∈(0,1)，t*(b.x-a.x) 的量级不超过边长，避免两个超大坐标相乘溢出
      const t = (p.y - a.y) / (b.y - a.y);
      const xIntersect = a.x + t * (b.x - a.x);
      if (p.x < xIntersect) inside = !inside;
    }
  }
  return inside;
}

function dedupe(points) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    const key = `${p.x},${p.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/**
 * Andrew 单调链凸包，返回逆时针顶点序列，剔除共线中间点。
 * 点数不足时原样返回（去重后）。
 */
export function convexHull(points) {
  const pts = dedupe(points).sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossSign(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossSign(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * 点到逆时针凸包边界的最小有符号距离（各边有符号距离的最小值）。
 * 凸包退化（不足 3 个顶点）时返回 -Infinity。
 */
export function convexMargin(hullCCW, p) {
  if (hullCCW.length < 3) return -Infinity;
  let m = Infinity;
  for (let i = 0; i < hullCCW.length; i++) {
    m = Math.min(m, lineSide(p, hullCCW[i], hullCCW[(i + 1) % hullCCW.length]));
  }
  return m;
}
