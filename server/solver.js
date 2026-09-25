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
  pointDistanceScaled,
  polygonSignedDistance,
  distanceToSegment,
  polygonSignedArea,
} from './geometry.js';

const EPS = 1e-9;
const RAIL_COUNT = 4;

/**
 * 把若干“归一化标量”{scale,t}（真实值 = t*scale）加总为一个归一化标量。
 * 单项有限但其算术和可能超过 double（如 4 个 1e308 量级的距离），
 * 直接相加会得到 Infinity，既无法裁决大小也无法 JSON 序列化。
 */
function sumMagnitudes(parts) {
  let scale = 0;
  for (const p of parts) if (p.scale > scale) scale = p.scale;
  if (scale === 0) return { scale: 0, t: 0 };
  let t = 0;
  for (const p of parts) t += (p.scale / scale) * p.t;
  return { scale, t };
}

/** 比较两个归一化标量的大小（-1/0/1），全程只做比值，不产生溢出。 */
function compareMagnitude(a, b) {
  if (a.scale === 0 && b.scale === 0) return 0;
  if (a.scale === 0) return -1;
  if (b.scale === 0) return 1;
  const r = (a.t / b.t) * (a.scale / b.scale);
  if (Number.isNaN(r)) return 0;
  if (!Number.isFinite(r)) return r > 0 ? 1 : -1;
  return r < 1 ? -1 : r > 1 ? 1 : 0;
}

/**
 * 归一化标量转 JSON 可用值：有限时直接返回数值；
 * 超出 double 时输出定点尾数宽度的十进制科学计数（如 4.0000000000e+308），
 * 不丢失数量级，同指数下按文本排序即数值排序。
 */
function magnitudeToValue(mag) {
  const v = mag.scale * mag.t;
  if (Number.isFinite(v)) return v;
  const log = Math.log10(mag.scale) + Math.log10(mag.t);
  let e = Math.floor(log);
  let mantissa = 10 ** (log - e);
  // 处理尾数显示为 10 的边界情形
  if (mantissa.toFixed(10).startsWith('10')) {
    mantissa /= 10;
    e += 1;
  }
  return `${mantissa.toFixed(10)}e+${e}`;
}

/**
 * 超大坐标下浮点绝对误差本身可达 1e292，固定 1e-9 的绝对容差会把
 * 几何上相等（仅差 ulp）的裕量误判为有优劣。按参与尺度做相对比较。
 * 超出 double 的裕量（±Infinity）只与同号无穷大视为同尺度。
 */
function sameScale(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));
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
  let minGapPart = null;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const part = pointDistanceScaled(points[i], points[j]);
      if (minGapPart === null || compareMagnitude(part, minGapPart) < 0) {
        minGapPart = { ...part, pair: [i, j] };
      }
    }
  }
  if (minGapPart === null) return { minGap: Infinity, minGapPart: null, pair: null };
  const { pair, ...mag } = minGapPart;
  return { minGap: mag.scale * mag.t, minGapPart: mag, pair };
}

/**
 * 评估单个组合，返回约束状态与各项指标。
 * stage:
 *   boundary_failed -> spacing_failed -> hull_degenerate -> corners_failed -> feasible
 */
function evaluate(indices, input, corners) {
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

  const { minGap, minGapPart, pair } = pairGap(points);
  // 间距按归一化尺度比较：minGap 即使超出 double（minGap=Infinity）
  // 也必然满足有限的 minSpacing；只在确有不足时给出缺口。
  if (Number.isFinite(minGap)) {
    const gapTol = EPS * Math.max(1, Math.abs(minGap), input.minSpacing);
    if (minGap + gapTol < input.minSpacing) {
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
  }

  const hull = ensureCCW(convexHull(points));
  const area = polygonSignedArea(hull);
  if (hull.length < 3 || area <= EPS) {
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
      minGapPart,
      deficit: worst,
    };
  }

  const cornerResults = corners.map((c) => ({
    ...c,
    margin: convexMargin(hull, c),
  }));
  const minCornerMargin = Math.min(...cornerResults.map((c) => c.margin));
  // “严格在内”的零界按凸包坐标尺度取相对容差：超大坐标下边上一点的
  // 计算裕量可能只有 ±ulp（如 1e291），固定 1e-9 会把“恰好贴边”误判为在内。
  let coordScale = 0;
  for (const p of hull) coordScale = Math.max(coordScale, Math.abs(p.x), Math.abs(p.y));
  const marginTol = EPS * Math.max(1, coordScale);

  if (!(minCornerMargin > marginTol)) {
    return {
      status: 'corners_failed',
      stage: 3,
      indices,
      points,
      hull,
      cornerResults,
      minGap,
      minGapPart,
      minCornerMargin,
      deficit: -minCornerMargin, // 越大的裕量越接近可行
    };
  }

  const distanceParts = points.map((p) => pointDistanceScaled(p, input.cg));
  const sumMagnitude = sumMagnitudes(distanceParts);
  return {
    status: 'feasible',
    stage: 4,
    indices,
    points,
    hull,
    cornerResults,
    minGap,
    minGapPart,
    minCornerMargin,
    distanceParts,
    sumMagnitude,
  };
}

function fixed4(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(4) : String(v);
}

function describeFailure(r) {
  switch (r.status) {
    case 'boundary_failed':
      return `选点越出翼板批准边界：导轨 ${r.outside.map((o) => o.rail + 1).join('、')} 的候选点在界外（最远越界 ${fixed4(r.deficit)}）`;
    case 'spacing_failed':
      return `支撑垫间距不足：最小间距 ${fixed4(r.minGap)}，最小要求未满足，缺口 ${fixed4(r.deficit)}（导轨 ${r.pair[0] + 1} 与 ${r.pair[1] + 1}）`;
    case 'hull_degenerate':
      return '四个选点共线或重合，支撑凸包退化，无法围出有效支撑区域';
    case 'corners_failed':
      return `重心偏差矩形存在角点不在支撑凸包内部：最小有符号距离 ${fixed4(r.minCornerMargin)}（<=0 表示越界）`;
    default:
      return '无可行方案';
  }
}

/**
 * 主求解入口。输入为已解析的请求体，返回响应对象。
 */
export function solve(raw) {
  const input = normalizeInput(raw);
  const corners = deviationCorners(input.cg, input.toleranceX, input.toleranceY);

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
          const result = evaluate(indices, input, corners);
          evaluated++;

          if (result.status !== 'feasible') {
            const betterFailure =
              closestFailure === null ||
              result.stage > closestFailure.stage ||
              (result.stage === closestFailure.stage &&
                result.deficit <
                  closestFailure.deficit -
                    EPS * Math.max(1, Math.abs(result.deficit), Math.abs(closestFailure.deficit)));
            if (betterFailure) closestFailure = result;
            continue;
          }

          if (best === null) {
            best = result;
          } else if (!sameScale(result.minCornerMargin, best.minCornerMargin)) {
            if (result.minCornerMargin > best.minCornerMargin) best = result;
          } else {
            // 主目标并列：次级目标“距离和”按归一化尺度比较，
            // 各单项距离有限但总和可能超出 double（直接相加得到 Infinity
            // 会使所有组合错误并列，且 JSON 序列化为 null）。
            const cmp = compareMagnitude(result.sumMagnitude, best.sumMagnitude);
            if (cmp < 0) best = result;
            // 距离和也持平时保留先枚举到的（候选编号字典序最小）组合
          }
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
        distance: magnitudeToValue(best.distanceParts[rail]),
      })),
      hull: best.hull,
      corners: best.cornerResults,
      metrics: {
        minMargin: best.minCornerMargin,
        // 距离和在有限 double 内时为数值；超出 double 时为不丢数量级的
        // 十进制科学计数文本（如 4.0000000000e+308），绝不返回 null。
        sumDistance: magnitudeToValue(best.sumMagnitude),
        // 距离和的精确分解：sumDistance ≈ sumDistanceFactor × sumDistanceScale，
        // 两项均为有限数值，跨方案比较时按 factor×scale 判定大小关系。
        sumDistanceScale: best.sumMagnitude.scale,
        sumDistanceFactor: best.sumMagnitude.t,
        minGap: best.minGapPart ? magnitudeToValue(best.minGapPart) : best.minGap,
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
      minGap: closestFailure.minGapPart
        ? magnitudeToValue(closestFailure.minGapPart)
        : (closestFailure.minGap ?? null),
      minCornerMargin: closestFailure.minCornerMargin ?? null,
      outside: closestFailure.outside ?? null,
      deficit: closestFailure.deficit,
    },
  };
}
