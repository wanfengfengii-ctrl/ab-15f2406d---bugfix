// 方案求解器：在四条导轨候选点的完整组合中直接裁决。
//
// 决策规则（按优先级）：
//   1. 硬约束：每轨恰选一点；选点在批准边界内；任意两垫间距 >= minSpacing；
//      重心偏差矩形的四个角点严格位于四点支撑凸包内部。
//   2. 在全部可行组合中，先最大化“四角到凸包边界的最小有符号距离”；
//      再最小化“四垫到标称重心的距离和”；
//      再按导轨输入顺序的候选编号序列取字典序最小者，保证方案唯一稳定。
//   3. 无可行方案时，返回在约束检查流程中“走得最远、违约最小”的组合作为证据。

import {
  convexHull,
  ensureCCW,
  convexMargin,
  pointInPolygon,
  pointDistance,
  polygonSignedDistance,
  distanceToSegment,
  polygonSignedArea,
  scaledSum,
  compareScaledSum,
} from './geometry.js';

// 绝对容差仅在“零”附近生效；主比较一律叠加按数量级折算的相对容差，
// 否则固定的 1e-9 在 1e307 量级（一个 ULP 就近 1e291）会把
// 本应相等的指标判成有差异，或把严格在内的角点误判在边上。
const EPS = 1e-9;
const REL_EPS = 1e-12;
const RAIL_COUNT = 4;

/**
 * 按 a、b 自身数量级折算的比较容差。
 */
function cmpTol(a, b) {
  return EPS + REL_EPS * Math.max(Math.abs(a), Math.abs(b));
}

/**
 * 尺度自适应的数值比较：a 明显大于/小于/约等于 b，返回 1/-1/0。
 */
function cmpNum(a, b) {
  const t = cmpTol(a, b);
  if (a > b + t) return 1;
  if (a < b - t) return -1;
  return 0;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function parsePoint(p, where) {
  if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
    throw new Error(`${where} 的点必须是有限数值 {x, y}`);
  }
  return { x: p.x, y: p.y };
}

/**
 * 校验并归一化请求。返回规范化后的输入；非法时抛出带中文说明的错误。
 */
export function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('请求体必须是 JSON 对象');

  if (!Array.isArray(raw.rails) || raw.rails.length !== RAIL_COUNT) {
    throw new Error(`必须提供恰好 ${RAIL_COUNT} 条导轨的候选点（rails 为长度 ${RAIL_COUNT} 的数组）`);
  }
  const rails = raw.rails.map((candidates, r) => {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error(`第 ${r + 1} 条导轨至少需要一个候选点`);
    }
    return candidates.map((p, i) => parsePoint(p, `第 ${r + 1} 条导轨的第 ${i + 1} 个候选点`));
  });

  if (!Array.isArray(raw.boundary) || raw.boundary.length < 3) {
    throw new Error('翼板批准边界 boundary 至少需要 3 个顶点');
  }
  const boundary = ensureCCW(
    raw.boundary.map((p, i) => parsePoint(p, `边界第 ${i + 1} 个顶点`))
  );

  const cg = parsePoint(raw.cg ?? null, '重心标称坐标 cg');

  const toleranceX = raw.toleranceX;
  const toleranceY = raw.toleranceY;
  if (!isFiniteNumber(toleranceX) || toleranceX < 0) {
    throw new Error('横向偏差 toleranceX 必须是非负数值');
  }
  if (!isFiniteNumber(toleranceY) || toleranceY < 0) {
    throw new Error('纵向偏差 toleranceY 必须是非负数值');
  }
  if (!isFiniteNumber(raw.minSpacing) || raw.minSpacing < 0) {
    throw new Error('支撑垫最小间距 minSpacing 必须是非负数值');
  }

  return {
    rails,
    boundary,
    cg,
    toleranceX,
    toleranceY,
    minSpacing: raw.minSpacing,
  };
}

export function deviationCorners(cg, tx, ty) {
  return [
    { label: '左下', x: cg.x - tx, y: cg.y - ty },
    { label: '右下', x: cg.x + tx, y: cg.y - ty },
    { label: '右上', x: cg.x + tx, y: cg.y + ty },
    { label: '左上', x: cg.x - tx, y: cg.y + ty },
  ];
}

function pairGap(points) {
  let minGap = Infinity;
  let pair = null;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = pointDistance(points[i], points[j]);
      if (d < minGap) {
        minGap = d;
        pair = [i, j];
      }
    }
  }
  return { minGap, pair };
}

/**
 * 评估单个组合，返回约束状态与各项指标。
 * stage:
 *   boundary_failed -> spacing_failed -> hull_degenerate -> corners_failed -> feasible
 */
function evaluate(indices, input, corners, coordScale) {
  const points = indices.map((idx, r) => input.rails[r][idx]);

  const outside = [];
  for (let i = 0; i < points.length; i++) {
    if (!pointInPolygon(input.boundary, points[i])) {
      outside.push({
        rail: i,
        amount: -polygonSignedDistance(input.boundary, points[i]),
      });
    }
  }
  if (outside.length > 0) {
    return {
      status: 'boundary_failed',
      stage: 0,
      indices,
      points,
      outside,
      deficit: Math.max(...outside.map((o) => o.amount)),
    };
  }

  const { minGap, pair } = pairGap(points);
  if (cmpNum(minGap, input.minSpacing) < 0) {
    return {
      status: 'spacing_failed',
      stage: 1,
      indices,
      points,
      minGap,
      pair,
      deficit: input.minSpacing - minGap,
    };
  }

  const hull = ensureCCW(convexHull(points));
  const area = polygonSignedArea(hull);
  // 归一化面积在整个有限 double 范围内都可靠：真实面积超过 double 上限时
  // polygonSignedArea 返回 +Infinity（符号仍正确），视为非退化；
  // 无量纲面积恰为 0 才是机器精度下的共线/重合退化。
  const areaScale = coordScale * coordScale;
  const areaTol = Number.isFinite(areaScale) ? EPS + REL_EPS * areaScale : EPS;
  if (hull.length < 3 || !(area > areaTol)) {
    // 退化凸包：用角点到凸包点集/线段的最近距离量化“差多少”
    let worst = 0;
    for (const c of corners) {
      let nearest = Infinity;
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i];
        const b = hull[(i + 1) % hull.length];
        nearest = Math.min(nearest, distanceToSegment(c, a, b));
      }
      worst = Math.max(worst, nearest);
    }
    return {
      status: 'hull_degenerate',
      stage: 2,
      indices,
      points,
      hull,
      minGap,
      deficit: worst,
    };
  }

  const cornerResults = corners.map((c) => ({
    ...c,
    margin: convexMargin(hull, c),
  }));
  const minCornerMargin = Math.min(...cornerResults.map((c) => c.margin));

  // 角点必须严格在内：在 1e307 量级下一个 ULP 就近 1e291，绝对 EPS 无意义，
  // 故按角点裕量自身尺度折算“在边上”的容差。
  if (!(minCornerMargin > EPS + REL_EPS * Math.abs(minCornerMargin))) {
    return {
      status: 'corners_failed',
      stage: 3,
      indices,
      points,
      hull,
      cornerResults,
      minGap,
      minCornerMargin,
      deficit: -minCornerMargin, // 越大的裕量越接近可行
    };
  }

  // 距离和按最大单项归一化累加：真实总和超过 double 上限时不会丢失为
  // Infinity，从而保留各组合次级目标的真实大小关系与数量级。
  const legDistances = points.map((p) => pointDistance(p, input.cg));
  const distanceSum = scaledSum(legDistances);
  return {
    status: 'feasible',
    stage: 4,
    indices,
    points,
    hull,
    cornerResults,
    minGap,
    minCornerMargin,
    distanceSum,
  };
}

function describeFailure(r) {
  switch (r.status) {
    case 'boundary_failed':
      return `选点越出翼板批准边界：导轨 ${r.outside.map((o) => o.rail + 1).join('、')} 的候选点在界外（最远越界 ${r.deficit.toFixed(4)}）`;
    case 'spacing_failed':
      return `支撑垫间距不足：最小间距 ${r.minGap.toFixed(4)}，最小要求未满足，缺口 ${r.deficit.toFixed(4)}（导轨 ${r.pair[0] + 1} 与 ${r.pair[1] + 1}）`;
    case 'hull_degenerate':
      return '四个选点共线或重合，支撑凸包退化，无法围出有效支撑区域';
    case 'corners_failed':
      return `重心偏差矩形存在角点不在支撑凸包内部：最小有符号距离 ${r.minCornerMargin.toFixed(4)}（<=0 表示越界）`;
    default:
      return '无可行方案';
  }
}

/**
 * 输入坐标的整体数量级（候选点、边界、重心的最大绝对值）。
 */
function coordinateScale(input) {
  let m = 0;
  const consider = (p) => {
    if (Number.isFinite(p.x) && Math.abs(p.x) > m) m = Math.abs(p.x);
    if (Number.isFinite(p.y) && Math.abs(p.y) > m) m = Math.abs(p.y);
  };
  input.rails.forEach((rail) => rail.forEach(consider));
  input.boundary.forEach(consider);
  consider(input.cg);
  return m;
}

/**
 * 距离和指标：普通范围内保持为原有数值（距离和的有限 double）；
 * 真实总量超过 double 上限时改以 {mantissa, exponent, ...} 表达，
 * 不丢失数量级与方案之间的大小关系（绝不让 JSON 把 Infinity 序列化成 null）。
 */
function distanceMetric(sum) {
  if (Number.isFinite(sum.value)) return sum.value;
  // sum.norm 与 sum.scale 均为有限值：用十进制科学记数法还原真实总量。
  // mantissa 只从对数尾数 10^frac（frac∈[0,1)）还原，避免 10^exponent
  // 在 exponent≥309 时溢出成 Infinity。
  const log10 = Math.log10(sum.norm) + Math.log10(sum.scale);
  const exponent = Math.floor(log10);
  const mantissa = 10 ** (log10 - exponent);
  return {
    overflow: true,
    mantissa,
    exponent,
    scale: sum.scale,
    normalizedSum: sum.norm,
  };
}

/**
 * 主求解入口。输入为已解析的请求体，返回响应对象。
 */
export function solve(raw) {
  const input = normalizeInput(raw);
  const corners = deviationCorners(input.cg, input.toleranceX, input.toleranceY);
  const coordScale = coordinateScale(input);

  const [r0, r1, r2, r3] = input.rails.map((c) => c.length);
  let evaluated = 0;
  let best = null;
  let closestFailure = null;

  // 按导轨输入顺序、候选编号升序枚举，天然字典序，首个最优即稳定唯一解。
  for (let i0 = 0; i0 < r0; i0++) {
    for (let i1 = 0; i1 < r1; i1++) {
      for (let i2 = 0; i2 < r2; i2++) {
        for (let i3 = 0; i3 < r3; i3++) {
          const indices = [i0, i1, i2, i3];
          const result = evaluate(indices, input, corners, coordScale);
          evaluated++;

          if (result.status !== 'feasible') {
            if (
              closestFailure === null ||
              result.stage > closestFailure.stage ||
              (result.stage === closestFailure.stage &&
                cmpNum(result.deficit, closestFailure.deficit) < 0)
            ) {
              closestFailure = result;
            }
            continue;
          }

          let replace = best === null;
          if (best !== null) {
            // 第一目标：最大化四角最小裕量（按数量级折算容差判定并列）
            const byMargin = cmpNum(result.minCornerMargin, best.minCornerMargin);
            if (byMargin > 0) {
              replace = true;
            } else if (byMargin === 0) {
              // 第二目标：最小化距离和；总和即使溢出 double 也要保留真实大小关系
              if (compareScaledSum(result.distanceSum, best.distanceSum, EPS, REL_EPS) < 0) {
                replace = true;
              }
              // 第三目标：两者持平时保留先枚举到的（候选编号字典序最小）组合
            }
          }
          if (replace) best = result;
        }
      }
    }
  }

  if (best) {
    return {
      feasible: true,
      evaluatedCombinations: evaluated,
      selection: best.indices.map((idx, rail) => ({
        rail,
        candidateIndex: idx,
        candidateNumber: idx + 1,
        x: best.points[rail].x,
        y: best.points[rail].y,
      })),
      hull: best.hull,
      corners: best.cornerResults,
      metrics: {
        minMargin: best.minCornerMargin,
        sumDistance: distanceMetric(best.distanceSum),
        minGap: best.minGap,
        indices: best.indices,
      },
    };
  }

  return {
    feasible: false,
    evaluatedCombinations: evaluated,
    reason: closestFailure ? closestFailure.status : 'no_combination',
    message: closestFailure ? describeFailure(closestFailure) : '不存在任何候选组合',
    evidence: closestFailure && {
      status: closestFailure.status,
      indices: closestFailure.indices,
      candidateNumbers: closestFailure.indices.map((i) => i + 1),
      points: closestFailure.points,
      hull: closestFailure.hull,
      corners: closestFailure.cornerResults ?? corners,
      minGap: closestFailure.minGap ?? null,
      minCornerMargin: closestFailure.minCornerMargin ?? null,
      outside: closestFailure.outside ?? null,
      deficit: closestFailure.deficit,
    },
  };
}
