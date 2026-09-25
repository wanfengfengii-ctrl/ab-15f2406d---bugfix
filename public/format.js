// 纯展示格式化工具（无 DOM 依赖）：同时被前端页面与 node:test 复用，
// 保证“普通数值范围原语义 + 超 double 上限的溢出指标”两种展示都有回归覆盖。

export function fmt(v, d = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(n);
  const av = Math.abs(n);
  // 普通范围沿用定点去尾零；超出 1e9 或接近 0 时改用科学记数法，
  // 避免 6e307 量级被 toFixed 展开成三百多位字符。
  if (av !== 0 && (av >= 1e9 || av < 1e-4)) return n.toExponential(3);
  return n.toFixed(d).replace(/\.?0+$/, '');
}

// 距离和指标：普通范围内是数值；真实总量超出 double 上限时服务端改以
// {overflow, mantissa, exponent} 表达（mantissa × 10^exponent），
// 页面必须展示其数量级而不是 null/Infinity。
export function formatDistance(m) {
  if (m && typeof m === 'object' && m.overflow) {
    return `${fmt(m.mantissa, 3)}×10^${m.exponent}（超出普通数值范围）`;
  }
  return fmt(m);
}
