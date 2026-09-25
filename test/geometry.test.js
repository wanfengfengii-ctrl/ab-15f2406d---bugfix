import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convexHull,
  ensureCCW,
  convexMargin,
  lineSide,
  pointInPolygon,
  polygonSignedArea,
  polygonSignedDistance,
  pointDistance,
  distanceToSegment,
  crossSign,
  scaledSum,
  compareScaledSum,
} from '../server/geometry.js';

test('凸包按逆时针返回并剔除共线点', () => {
  const hull = ensureCCW(convexHull([
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 },
    { x: 0, y: 2 }, { x: 1, y: 1 },
  ]));
  assert.equal(hull.length, 4);
  assert.ok(polygonSignedArea(hull) > 0);
});

test('内部点有符号距离为正，外部为负', () => {
  const hull = ensureCCW([
    { x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 },
  ]);
  assert.ok(convexMargin(hull, { x: 0, y: 0 }) > 0);
  assert.equal(convexMargin(hull, { x: 0, y: 0 }).toFixed(3), '5.000');
  assert.ok(convexMargin(hull, { x: 0, y: 6 }) < 0);
});

test('恰在边上的点有符号距离为 0（不满足严格在内）', () => {
  const hull = ensureCCW([
    { x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 },
  ]);
  assert.equal(convexMargin(hull, { x: 0, y: 5 }), 0);
});

test('lineSide 左侧为正', () => {
  assert.ok(lineSide({ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }) > 0);
  assert.ok(lineSide({ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }) < 0);
});

test('pointInPolygon 含边界', () => {
  const poly = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  assert.equal(pointInPolygon(poly, { x: 2, y: 2 }), true);
  assert.equal(pointInPolygon(poly, { x: 4, y: 2 }), true);
  assert.equal(pointInPolygon(poly, { x: 5, y: 2 }), false);
});

// ---- 超大有限坐标（1e307 量级接近 double 上界 1.8e308）下的数值稳定性 ----

const H = 1e307;
const bigSquareCCW = [
  { x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H },
];

test('超大坐标：lineSide 不溢出，原点到各边有符号距离约为 1e307', () => {
  assert.ok(Number.isFinite(lineSide({ x: 0, y: 0 }, bigSquareCCW[0], bigSquareCCW[1])));
  assert.ok(Math.abs(lineSide({ x: 0, y: 0 }, bigSquareCCW[0], bigSquareCCW[1]) - H) / H < 1e-12);
  // 顶边走向为右→左，其左侧（内部）在下方；外侧点 y=H+1e291 的有符号距离应为负且有限
  const outside = lineSide({ x: 0, y: H + 1e291 }, bigSquareCCW[2], bigSquareCCW[3]);
  assert.ok(Number.isFinite(outside) && outside < 0, `外侧距离异常：${outside}`);
});

test('超大坐标：convexMargin 返回有限值而非 null/Infinity/NaN', () => {
  const m = convexMargin(bigSquareCCW, { x: 0, y: 0 });
  assert.ok(Number.isFinite(m));
  assert.ok(Math.abs(m - H) / H < 1e-12);
});

test('超大坐标：凸包正确识别 4 个角且面积符号为正（不因溢出变成 NaN）', () => {
  const hull = convexHull(bigSquareCCW);
  assert.equal(hull.length, 4);
  // 面积真值约 4e614 超出 double，归一化后返回 +Infinity，但绝不能是 NaN/负值
  const area = polygonSignedArea(ensureCCW(bigSquareCCW));
  assert.ok(!Number.isNaN(area) && area > 0, `面积符号异常：${area}`);
});

test('超大坐标：原点在超大方形内，外部点判定为不在', () => {
  assert.equal(pointInPolygon(bigSquareCCW, { x: 0, y: 0 }), true);
  assert.equal(pointInPolygon(bigSquareCCW, { x: 1.5e307, y: 0 }), false);
});

test('超大坐标：pointDistance 不溢出', () => {
  const d = pointDistance({ x: -H, y: -H }, { x: H, y: H });
  assert.ok(Number.isFinite(d));
  assert.ok(Math.abs(d - 2 * H * Math.SQRT2) / (2 * H * Math.SQRT2) < 1e-12);
});

test('超大坐标：distanceToSegment 内/外投影均有限', () => {
  const a = { x: -H, y: -H };
  const b = { x: H, y: -H };
  const inside = distanceToSegment({ x: 0, y: 0 }, a, b);
  const beyond = distanceToSegment({ x: 0, y: -H - 5e306 }, a, b);
  assert.ok(Number.isFinite(inside) && inside > 0);
  assert.ok(Number.isFinite(beyond) && beyond > 0);
  assert.equal(Number.isNaN(distanceToSegment(a, a, b)), false);
});

test('超大坐标：crossSign 对明显左/右/共线给出正确符号', () => {
  assert.equal(crossSign({ x: -H, y: 0 }, { x: H, y: 0 }, { x: 0, y: 1 }), 1);
  assert.equal(crossSign({ x: -H, y: 0 }, { x: H, y: 0 }, { x: 0, y: -1 }), -1);
  assert.equal(crossSign({ x: -H, y: 0 }, { x: H, y: 0 }, { x: 0, y: 0 }), 0);
});

test('超大坐标：多边形有符号距离返回有限值', () => {
  const d = polygonSignedDistance(bigSquareCCW, { x: 0, y: 0 });
  assert.ok(Number.isFinite(d));
  assert.ok(d > 0);
});

// ---- scaledSum / compareScaledSum：超 double 上限的求和与大小比较 ----

test('scaledSum：普通范围内 value 为有限数值且与直接求和一致', () => {
  const s = scaledSum([3, 4]);
  assert.ok(Number.isFinite(s.value));
  assert.ok(Math.abs(s.value - 7) < 1e-12);
  assert.ok(Math.abs(s.norm * s.scale - 7) < 1e-12);
});

test('scaledSum：真实总和超过 double 上限时 value=Infinity 但 norm/scale 保留数量级', () => {
  const near = 1.7e308;
  const s = scaledSum([near, near, near, near]);
  assert.equal(s.value, Infinity);
  assert.ok(Number.isFinite(s.norm) && Number.isFinite(s.scale));
  // 对数尺度还原真实总量：4×1.7e308 = 6.8e308（字面量 6.8e308 在 JS 中即 Infinity，故对数分开算）
  const lg = Math.log10(s.norm) + Math.log10(s.scale);
  assert.ok(Math.abs(lg - (Math.log10(6.8) + 308)) < 1e-10, `log10(sum)=${lg}`);
});

test('scaledSum：空集/全零返回 0', () => {
  assert.equal(scaledSum([]).value, 0);
  assert.equal(scaledSum([0, 0]).value, 0);
});

test('compareScaledSum：两个都溢出为 Infinity 的和仍能分出大小（4.032e308 > 4e308）', () => {
  const legFar = Math.hypot(8.1, 6) * 1e307; // ≈ 1.0080178e308
  const legNear = 1e308;
  const far = scaledSum([legFar, legFar, legFar, legFar]);
  const near = scaledSum([legNear, legNear, legNear, legNear]);
  assert.equal(far.value, Infinity);
  assert.equal(near.value, Infinity);
  assert.equal(compareScaledSum(far, near), 1);
  assert.equal(compareScaledSum(near, far), -1);
  assert.equal(compareScaledSum(far, far), 0);
});

test('compareScaledSum：相对/绝对容差内视为相等，否则更小为 -1', () => {
  const a = scaledSum([1e308, 1e308]);
  const b = scaledSum([1e308, 1e308 * (1 + 1e-14)]);
  // 差异 1e-14 落在 relEps=1e-12 内，视为相等
  assert.equal(compareScaledSum(a, b, 1e-9, 1e-12), 0);
  // 无容差时可区分
  assert.equal(compareScaledSum(a, b, 0, 0), -1);
});
