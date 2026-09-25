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

// ---- 边两端坐标差本身超出 double（边界横跨 ±double 上界附近）----
const B = 1.75e308;
const spanBoundary = [
  { x: -B, y: -B }, { x: B, y: -B }, { x: B, y: B }, { x: -B, y: B },
];
const spanCCW = ensureCCW(spanBoundary);

test('跨度超 double：内部点仍判定在界内、越界点判定在外', () => {
  assert.equal(pointInPolygon(spanCCW, { x: 1.71e308, y: 6e307 }), true);
  assert.equal(pointInPolygon(spanCCW, { x: 0, y: 0 }), true);
  assert.equal(pointInPolygon(spanCCW, { x: 0, y: 1.78e308 }), false);
});

test('跨度超 double：边界有符号距离不返回 NaN，内部为正且量级正确', () => {
  // 候选点 y=6e307，距下边 y=-B 的距离已超 double；最近边是左右竖边，约 4e306
  const d = polygonSignedDistance(spanCCW, { x: 1.71e308, y: 6e307 });
  assert.ok(!Number.isNaN(d), '不得为 NaN');
  assert.ok(d > 0, `内部点距离应为正，实际 ${d}`);
  assert.ok(Math.abs(d - 4e306) / 4e306 < 1e-9, `实际 ${d}`);
});

test('跨度超 double：lineSide 不返回 NaN 且符号正确', () => {
  // 下边 (-B,-B)->(B,-B)：内部点在其上方（左侧）
  const inside = lineSide({ x: 0, y: 0 }, spanCCW[0], spanCCW[1]);
  assert.ok(!Number.isNaN(inside) && inside > 0, `实际 ${inside}`);
  // 外部点在下边下方（取明显超出边界的有限值；B±ulp 会被舍入回 B）
  const outside = lineSide({ x: 0, y: -1.78e308 }, spanCCW[0], spanCCW[1]);
  assert.ok(!Number.isNaN(outside) && outside < 0, `实际 ${outside}`);
});

test('跨度超 double：pointDistance 不产生 NaN，scaled 分量有限且可比较大小',
  async () => {
    const { pointDistanceScaled } = await import('../server/geometry.js');
    const d = pointDistance({ x: -B, y: 0 }, { x: B, y: 0 });
    assert.equal(Number.isNaN(d), false);
    assert.ok(d > 1.7e308);
    const s1 = pointDistanceScaled({ x: -B, y: 0 }, { x: B, y: 0 });
    const s2 = pointDistanceScaled({ x: -B, y: 0 }, { x: B * 0.9, y: 0 });
    assert.ok(Number.isFinite(s1.scale) && Number.isFinite(s1.t));
    assert.ok(Number.isFinite(s2.scale) && Number.isFinite(s2.t));
    assert.ok((s1.scale / s2.scale) * (s1.t / s2.t) > 1,
      `跨距 2B 应大于跨距 1.9B：${JSON.stringify(s1)} vs ${JSON.stringify(s2)}`);
  });

test('跨度超 double：crossSign 对超大边给出正确共线/左右符号', () => {
  assert.equal(crossSign(spanCCW[0], spanCCW[1], { x: 0, y: 0 }), 1);
  assert.equal(crossSign(spanCCW[0], spanCCW[1], { x: 0, y: -1.78e308 }), -1);
});
