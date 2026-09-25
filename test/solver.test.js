import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, normalizeInput } from '../server/solver.js';

const bigBoundary = [
  { x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 },
];

// 对称十字布置：内侧 ±3、外侧 ±8 两组候选
function crossPayload(over = {}) {
  return {
    rails: [
      [{ x: -3, y: 0 }, { x: -8, y: 0 }],
      [{ x: 3, y: 0 }, { x: 8, y: 0 }],
      [{ x: 0, y: -3 }, { x: 0, y: -8 }],
      [{ x: 0, y: 3 }, { x: 0, y: 8 }],
    ],
    boundary: [
      { x: -12, y: -12 }, { x: 12, y: -12 }, { x: 12, y: 12 }, { x: -12, y: 12 },
    ],
    cg: { x: 0, y: 0 },
    toleranceX: 2,
    toleranceY: 2,
    minSpacing: 1,
    ...over,
  };
}

test('可行方案：四角严格在内，返回每轨选点与正裕量', () => {
  const r = solve(crossPayload());
  assert.equal(r.feasible, true);
  assert.equal(r.evaluatedCombinations, 16);
  assert.deepEqual(r.metrics.indices, [1, 1, 1, 1]);
  assert.ok(r.metrics.minMargin > 0);
  assert.equal(r.corners.length, 4);
  assert.ok(r.corners.every((c) => c.margin > 0));
  assert.equal(r.selection.length, 4);
  r.selection.forEach((s, i) => assert.equal(s.rail, i));
});

test('第一目标：内侧组合更靠近重心但四角越界时，仍选裕量更大的外侧组合', () => {
  const r = solve(crossPayload());
  // 全选外侧(编号2)才能让偏差矩形四角严格在内
  assert.deepEqual(r.selection.map((s) => s.candidateNumber), [2, 2, 2, 2]);
});

test('第二目标：裕量持平时选择到标称重心距离和更小的组合', () => {
  // 矩形四角：沿 X 方向有内(±8)外(±12)两档，Y 恒为 ±6。
  // 容差为 0 时只有标称重心一个角点，其裕量由上下边锁定为 6（两档相同），
  // 但内档各点离重心更近，故距离和更小者（编号1）胜出。
  const payload = {
    rails: [
      [{ x: -8, y: -6 }, { x: -12, y: -6 }],
      [{ x: 8, y: -6 }, { x: 12, y: -6 }],
      [{ x: 8, y: 6 }, { x: 12, y: 6 }],
      [{ x: -8, y: 6 }, { x: -12, y: 6 }],
    ],
    boundary: bigBoundary,
    cg: { x: 0, y: 0 },
    toleranceX: 0,
    toleranceY: 0,
    minSpacing: 1,
  };
  const r = solve(payload);
  assert.equal(r.feasible, true);
  assert.ok(Math.abs(r.metrics.minMargin - 6) < 1e-9);
  assert.deepEqual(r.metrics.indices, [0, 0, 0, 0]);
});

test('第三目标：指标完全相同的并列组合，按候选编号字典序取最小', () => {
  const payload = crossPayload();
  // 导轨 1 放入两个完全重合的候选点，几何指标一致，应取编号 1
  payload.rails[0] = [{ x: -8, y: 0 }, { x: -8, y: 0 }];
  const r = solve(payload);
  assert.equal(r.feasible, true);
  assert.equal(r.metrics.indices[0], 0);
});

test('间距约束：最小间距无法满足时判定不可行并给出间距证据', () => {
  const r = solve(crossPayload({ minSpacing: 100 }));
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'spacing_failed');
  assert.ok(r.evidence.minGap < 100);
  assert.deepEqual(r.evidence.candidateNumbers.length, 4);
});

test('角点越界：凸包有效但容差过大时返回 corners_failed 证据', () => {
  const r = solve(crossPayload({ toleranceX: 6, toleranceY: 6, minSpacing: 1 }));
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'corners_failed');
  assert.ok(r.evidence.minCornerMargin <= 0);
  assert.ok(r.evidence.corners.some((c) => c.margin <= 0));
});

test('边界约束：候选点全部越界时返回 boundary_failed 证据', () => {
  const r = solve(crossPayload({
    boundary: [
      { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 },
    ],
  }));
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'boundary_failed');
  assert.ok(r.evidence.outside.length > 0);
});

test('共线选点导致凸包退化时返回 hull_degenerate', () => {
  const payload = {
    rails: [
      [{ x: -6, y: 0 }, { x: -3, y: 0 }],
      [{ x: 6, y: 0 }, { x: 3, y: 0 }],
      [{ x: -2, y: 0 }],
      [{ x: 2, y: 0 }],
    ],
    boundary: bigBoundary,
    cg: { x: 0, y: 0 },
    toleranceX: 1,
    toleranceY: 1,
    minSpacing: 0,
  };
  const r = solve(payload);
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'hull_degenerate');
});

test('输入校验：导轨数量不是 4 条时抛错', () => {
  assert.throws(() => normalizeInput({
    rails: [[], [], []],
    boundary: bigBoundary,
    cg: { x: 0, y: 0 },
    toleranceX: 1, toleranceY: 1, minSpacing: 1,
  }), /4 条导轨/);
});

test('输入校验：负值偏差抛错', () => {
  assert.throws(() => normalizeInput({
    rails: [[{ x: 0, y: 0 }], [{ x: 1, y: 0 }], [{ x: 0, y: 1 }], [{ x: 1, y: 1 }]],
    boundary: bigBoundary,
    cg: { x: 0, y: 0 },
    toleranceX: -1, toleranceY: 1, minSpacing: 1,
  }), /toleranceX/);
});

test('非数值坐标抛错', () => {
  assert.throws(() => normalizeInput({
    rails: [[{ x: 'a', y: 0 }], [{ x: 1, y: 0 }], [{ x: 0, y: 1 }], [{ x: 1, y: 1 }]],
    boundary: bigBoundary,
    cg: { x: 0, y: 0 },
    toleranceX: 1, toleranceY: 1, minSpacing: 1,
  }), /有限数值/);
});

test('超大有限坐标(1e307 量级)：选外侧候选 [2,2,2,2] 且全部裕量有限', () => {
  // 标称重心在原点、偏差为 0、最小间距 1；
  // 内侧候选构成 9e306 方形，外侧候选构成 1e307 方形，批准边界为 1.1e307 方形。
  const payload = {
    rails: [
      [{ x: -9e306, y: -9e306 }, { x: -1e307, y: -1e307 }],
      [{ x: 9e306, y: -9e306 }, { x: 1e307, y: -1e307 }],
      [{ x: 9e306, y: 9e306 }, { x: 1e307, y: 1e307 }],
      [{ x: -9e306, y: 9e306 }, { x: -1e307, y: 1e307 }],
    ],
    boundary: [
      { x: -1.1e307, y: -1.1e307 }, { x: 1.1e307, y: -1.1e307 },
      { x: 1.1e307, y: 1.1e307 }, { x: -1.1e307, y: 1.1e307 },
    ],
    cg: { x: 0, y: 0 },
    toleranceX: 0,
    toleranceY: 0,
    minSpacing: 1,
  };
  const r = solve(payload);
  assert.equal(r.feasible, true);
  assert.equal(r.evaluatedCombinations, 16);
  assert.deepEqual(r.metrics.indices, [1, 1, 1, 1]);
  assert.deepEqual(r.selection.map((s) => s.candidateNumber), [2, 2, 2, 2]);

  // 外侧方形裕量约为 1e307，严格大于内侧方形约 9e306 的裕量
  assert.ok(Number.isFinite(r.metrics.minMargin), 'minMargin 必须是有限数值');
  assert.ok(r.metrics.minMargin > 9.5e306 && r.metrics.minMargin <= 1e307,
    `minMargin 应约为 1e307，实际 ${r.metrics.minMargin}`);
  assert.equal(r.corners.length, 4);
  for (const c of r.corners) {
    assert.ok(Number.isFinite(c.margin), '每个角点裕量必须是有限数值');
    assert.ok(c.margin > 9.5e306 && c.margin <= 1e307, `角点裕量异常：${c.margin}`);
  }
  assert.ok(Number.isFinite(r.metrics.sumDistance), '距离和必须有限');
  assert.ok(Number.isFinite(r.metrics.minGap), '最小间距必须有限');
});

test('超大有限坐标：内侧组合也可行但裕量更小（9e306 < 1e307）', () => {
  const mk = (r) => ({
    rails: [
      [{ x: -r, y: -r }], [{ x: r, y: -r }],
      [{ x: r, y: r }], [{ x: -r, y: r }],
    ],
    boundary: [
      { x: -1.1e307, y: -1.1e307 }, { x: 1.1e307, y: -1.1e307 },
      { x: 1.1e307, y: 1.1e307 }, { x: -1.1e307, y: 1.1e307 },
    ],
    cg: { x: 0, y: 0 }, toleranceX: 0, toleranceY: 0, minSpacing: 1,
  });
  const inner = solve(mk(9e306));
  const outer = solve(mk(1e307));
  assert.equal(inner.feasible, true);
  assert.equal(outer.feasible, true);
  assert.ok(Math.abs(inner.metrics.minMargin - 9e306) / 9e306 < 1e-12);
  assert.ok(Math.abs(outer.metrics.minMargin - 1e307) / 1e307 < 1e-12);
  assert.ok(outer.metrics.minMargin > inner.metrics.minMargin);
});

// 题述场景：重心 (9e307,0)，四轨候选 y=±6e307；候选 1 横向偏移
// ±8.1e307（更远），候选 2 偏移 ±8e307（更近）。16 个组合的最小稳定
// 裕量均为 6e307（主目标并列），但单项距离分别约 1.008e308 与 1e308，
// 距离和超过 double 上限（约 1.8e308）。次级目标必须仍能区分并选中
// [2,2,2,2]，且距离指标不能序列化成 null。
function hugeTiePayload() {
  return {
    rails: [
      [{ x: 0.9e307, y: -6e307 }, { x: 1e307, y: -6e307 }],
      [{ x: 17.1e307, y: -6e307 }, { x: 17e307, y: -6e307 }],
      [{ x: 17.1e307, y: 6e307 }, { x: 17e307, y: 6e307 }],
      [{ x: 0.9e307, y: 6e307 }, { x: 1e307, y: 6e307 }],
    ],
    boundary: [
      { x: 8.9e306, y: -6.1e307 }, { x: 1.72e308, y: -6.1e307 },
      { x: 1.72e308, y: 6.1e307 }, { x: 8.9e306, y: 6.1e307 },
    ],
    cg: { x: 9e307, y: 0 },
    toleranceX: 0,
    toleranceY: 0,
    minSpacing: 1,
  };
}

test('超大有限距离：主目标并列、次级距离和超 double 上限时唯一选中更近的 [2,2,2,2]', () => {
  const r = solve(hugeTiePayload());
  assert.equal(r.feasible, true);
  assert.equal(r.evaluatedCombinations, 16);
  assert.deepEqual(r.metrics.indices, [1, 1, 1, 1]);
  assert.deepEqual(r.selection.map((s) => s.candidateNumber), [2, 2, 2, 2]);
  // 主目标：16 个组合裕量均为 6e307
  assert.ok(Math.abs(r.metrics.minMargin - 6e307) / 6e307 < 1e-12);
  assert.ok(r.corners.every((c) => Math.abs(c.margin - 6e307) / 6e307 < 1e-12));
});

test('超大有限距离：溢出的距离和以不丢数量级与大小关系的对象表达（绝不为 null）', () => {
  const r = solve(hugeTiePayload());
  const sd = r.metrics.sumDistance;
  assert.equal(typeof sd, 'object');
  assert.equal(sd.overflow, true);
  assert.ok(Number.isFinite(sd.mantissa) && Number.isFinite(sd.exponent));
  // 选中方案真实距离和 = 4 × 1e308 = 4e308
  assert.equal(sd.exponent, 308);
  assert.ok(Math.abs(sd.mantissa - 4) < 1e-9, `mantissa=${sd.mantissa}`);
  assert.ok(Number.isFinite(sd.scale) && sd.scale > 0);
  assert.ok(Number.isFinite(sd.normalizedSum));
  // JSON 序列化不得再出现 null
  const json = JSON.stringify(r);
  assert.ok(JSON.parse(json).metrics.sumDistance.overflow === true);
  assert.ok(!json.includes('sumDistance":null'));
});

test('超大有限距离：溢出指标仍保留候选 1（≈4.032e308）与候选 2（4e308）的大小关系', () => {
  // 强制每条导轨都选候选 1：直接校验指标 mantissa 更大。
  const forced = hugeTiePayload();
  forced.rails = forced.rails.map((rail) => [rail[0]]);
  const r1 = solve(forced);
  const r2 = solve(hugeTiePayload());
  assert.equal(r1.metrics.sumDistance.overflow, true);
  assert.equal(r2.metrics.sumDistance.overflow, true);
  const v1 = r1.metrics.sumDistance.mantissa * 10 ** (r1.metrics.sumDistance.exponent - 308);
  const v2 = r2.metrics.sumDistance.mantissa;
  // 候选 1 单项 ≈ sqrt(8.1²+6²)e307 ≈ 1.0080e308，四项 ≈ 4.0321e308
  assert.ok(v1 > 4.03 && v1 < 4.04, `候选1 距离和系数=${v1}`);
  assert.ok(Math.abs(v2 - 4) < 1e-9);
  assert.ok(v1 > v2);
});

test('普通数值范围内距离指标语义保持不变：sumDistance 仍是普通有限数值', () => {
  const r = solve(crossPayload());
  assert.equal(typeof r.metrics.sumDistance, 'number');
  assert.ok(Number.isFinite(r.metrics.sumDistance));
  // 外档四点 (±8,0)/(0,±8) 到原点距离和 = 4×8 = 32
  assert.ok(Math.abs(r.metrics.sumDistance - 32) < 1e-9, `sumDistance=${r.metrics.sumDistance}`);
});
