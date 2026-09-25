// 纯计算几何工具：二维点、有符号距离、凸包、点与简单多边形关系。
// 所有多边形约定按逆时针(CCW)给出边时，内部位于每条有向边的左侧，
// 因此“点到边的有符号距离”为正表示在内部、为负表示在外部、为 0 表示恰在边界上。

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

/**
 * 点距离的归一化表达 {scale, t}：真实距离 = t * scale，两分量恒为有限数值。
 * 坐标差本身超出 double（两端点逼近 ±double 上界）时按绝对坐标归一化，
 * t*scale 可能得到 Infinity，但 scale、t 本身仍可用于比较与序列化。
 */
export function pointDistanceScaled(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  if (Number.isFinite(dx) && Number.isFinite(dy)) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return m === 0 ? { scale: 0, t: 0 } : { scale: m, t: Math.hypot(dx / m, dy / m) };
  }
  const m = Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
  if (m === 0) return { scale: 0, t: 0 };
  return { scale: m, t: Math.hypot(a.x / m - b.x / m, a.y / m - b.y / m) };
}

export function pointDistance(a, b) {
  const { scale, t } = pointDistanceScaled(a, b);
  return t * scale;
}

/**
 * 数值稳定的叉积符号：返回 (b-a)×(c-a) 的符号（1/0/-1）。
 * 先以参与量的最大绝对值归一化再相乘，避免超大有限坐标（如 1e307 量级）
 * 下坐标差相乘溢出为 Infinity，或 Infinity-Infinity 得到 NaN。
 * 若坐标差本身相减即溢出（两端点在 ±double 上界附近），退化为按
 * 绝对坐标归一化，整个有限 double 范围内都不会产生 NaN。
 */
export function crossSign(a, b, c) {
  let u1 = b.x - a.x;
  let v1 = b.y - a.y;
  let u2 = c.x - a.x;
  let v2 = c.y - a.y;
  let m;
  if ([u1, v1, u2, v2].every(Number.isFinite)) {
    m = Math.max(Math.abs(u1), Math.abs(v1), Math.abs(u2), Math.abs(v2));
    if (m === 0) return 0;
  } else {
    // 坐标差溢出：用绝对坐标归一化（差值在归一化空间中不超过 2）
    m = Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y), Math.abs(c.x), Math.abs(c.y));
    if (m === 0) return 0;
    u1 = b.x / m - a.x / m;
    v1 = b.y / m - a.y / m;
    u2 = c.x / m - a.x / m;
    v2 = c.y / m - a.y / m;
    const z = u1 * v2 - v1 * u2;
    return z > 0 ? 1 : z < 0 ? -1 : 0;
  }
  const z = (u1 / m) * (v2 / m) - (v1 / m) * (u2 / m);
  return z > 0 ? 1 : z < 0 ? -1 : 0;
}

/**
 * 点 p 到过 a、b 的直线的有符号距离（沿 a->b 方向，左侧为正）。
 * 中间量按最大参与尺度归一化，保证坐标在整个有限 double 范围内
 * 都不会因叉积相乘溢出而错误返回 NaN。
 * 若坐标差相减本身溢出（端点跨 ±double 上界），改用绝对坐标归一化：
 * 真实距离仍在 double 内时给出有限值，确已超出 double 时返回同号 ±Infinity。
 */
export function lineSide(p, a, b) {
  const dx0 = b.x - a.x;
  const dy0 = b.y - a.y;
  const qx0 = p.x - a.x;
  const qy0 = p.y - a.y;
  if (dx0 === 0 && dy0 === 0) {
    const m = Math.max(Math.abs(qx0), Math.abs(qy0));
    return m === 0 ? 0 : Math.hypot(qx0 / m, qy0 / m) * m;
  }
  if ([dx0, dy0, qx0, qy0].every(Number.isFinite)) {
    const s = Math.max(Math.abs(dx0), Math.abs(dy0), Math.abs(qx0), Math.abs(qy0));
    if (s === 0) return 0;
    const l = Math.hypot(dx0 / s, dy0 / s);
    if (l === 0) {
      return Math.hypot(qx0 / s, qy0 / s) * s; // a、b 在该尺度下已退化为同一点
    }
    const c = (dx0 / s) * (qy0 / s) - (dy0 / s) * (qx0 / s);
    return (c / l) * s;
  }
  // 坐标差溢出：按绝对坐标归一化到 [-1,1] 后再做叉积/边长。
  // 归一化后各分量差不超过 2，不会溢出；真实距离在 double 内时结果仍为
  // 有限值（保持数量级），真实距离确实超出 double 时自然得到 ±Infinity。
  const m = Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y), Math.abs(p.x), Math.abs(p.y));
  if (m === 0) return 0;
  const ax = a.x / m, ay = a.y / m;
  const ex = b.x / m - ax, ey = b.y / m - ay;
  const qx = p.x / m - ax, qy = p.y / m - ay;
  const l = Math.hypot(ex, ey);
  if (l === 0) return Math.hypot(qx, qy) * m;
  return ((ex * qy - ey * qx) / l) * m;
}

/**
 * 点到线段的（无符号）距离，用于退化凸包（共线/重合）时的证据量化。
 * 投影参数按统一尺度归一化计算，避免超大坐标下相乘溢出。
 */
export function distanceToSegment(p, a, b) {
  const dx0 = b.x - a.x;
  const dy0 = b.y - a.y;
  const px0 = p.x - a.x;
  const py0 = p.y - a.y;
  if (dx0 === 0 && dy0 === 0) {
    const m = Math.max(Math.abs(px0), Math.abs(py0));
    return m === 0 ? 0 : Math.hypot(px0 / m, py0 / m) * m;
  }
  if ([dx0, dy0, px0, py0].every(Number.isFinite)) {
    const s = Math.max(Math.abs(dx0), Math.abs(dy0), Math.abs(px0), Math.abs(py0));
    const dxs = dx0 / s;
    const dys = dy0 / s;
    const len2 = dxs * dxs + dys * dys;
    if (len2 === 0) {
      return Math.hypot(px0 / s, py0 / s) * s;
    }
    let t = ((px0 / s) * dxs + (py0 / s) * dys) / len2;
    t = Math.max(0, Math.min(1, t));
    const rx = px0 / s - t * dxs;
    const ry = py0 / s - t * dys;
    return Math.hypot(rx, ry) * s;
  }
  // 坐标差溢出：按绝对坐标归一化。投影是否落在线段内在归一化空间中判定，
  // 超出 double 可表示范围的真实距离返回 Infinity（无符号）。
  const m = Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y), Math.abs(p.x), Math.abs(p.y));
  const ax = a.x / m, ay = a.y / m;
  const ex = b.x / m - ax, ey = b.y / m - ay;
  const qx = p.x / m - ax, qy = p.y / m - ay;
  const len2 = ex * ex + ey * ey;
  let t = len2 === 0 ? 0 : (qx * ex + qy * ey) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(qx - t * ex, qy - t * ey) * m;
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
      // 判定 p.x 是否在边 a->b 与水平线 y=p.y 交点的左侧（射线向 +x）。
      // 常规情形直接计算交点 x（t*(b.x-a.x) 的量级不超过边长，不溢出）；
      // 边坐标差本身超出 double（边横跨 ±double 上界）时交点 x 同样超出
      // double，改用叉积符号判定：s = sign(dy)·sign(t·dx − qx)，
      // 故交点位于 p 右侧（射线穿过多边形）当且仅当 s 与 dy 同号。
      const dy = b.y - a.y;
      const dx = b.x - a.x;
      if (Number.isFinite(dy) && Number.isFinite(dx)) {
        const t = (p.y - a.y) / dy;
        const xIntersect = a.x + t * dx;
        if (p.x < xIntersect) inside = !inside;
      } else {
        const s = crossSign(a, b, p);
        const upward = b.y > a.y;
        // s = sign(dy)·sign(t·dx − qx)，故交点在 p 右侧当且仅当 s 与 dy 同号
        if ((upward && s === 1) || (!upward && s === -1)) inside = !inside;
      }
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
