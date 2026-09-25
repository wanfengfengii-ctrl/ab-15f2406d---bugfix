// 页面展示回归：格式化逻辑被抽成无 DOM 依赖的 public/format.js，
// 这里直接覆盖“普通数值范围原有展示语义”与“超 double 上限溢出指标展示”。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, formatDistance } from '../public/format.js';

test('普通数值范围保持原有定点去尾零展示', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(6), '6');
  assert.equal(fmt(6.5), '6.5');
  assert.equal(fmt(32), '32');
  assert.equal(fmt(6.123456, 4), '6.1235');
});

test('超大有限数值用科学记数法展示而不是展开成数百位', () => {
  const s = fmt(6e307);
  assert.ok(/e\+/.test(s), `期望科学记数法，实际 ${s}`);
  assert.ok(s.toLowerCase().includes('e+308') || s.toLowerCase().includes('e+307'),
    `数量级应为 1e307/1e308，实际 ${s}`);
});

test('普通有限距离和按数值格式化', () => {
  assert.equal(formatDistance(32), '32');
  assert.equal(formatDistance(45.6), '45.6');
});

test('溢出距离和对象展示数量级与指数，绝不显示 null', () => {
  const text = formatDistance({
    overflow: true,
    mantissa: 3.9999999999999996,
    exponent: 308,
    scale: 1e308,
    normalizedSum: 3.9999999999999996,
  });
  assert.ok(text.includes('10^308'), `应含 10^308：${text}`);
  assert.ok(!/null|Infinity/i.test(text), `不应出现 null/Infinity：${text}`);
  // 系数约 4
  assert.ok(text.startsWith('4'), `应以 4 开头：${text}`);
});

test('候选1（≈4.032e308）与候选2（4e308）的展示文本都保留各自数量级信息', () => {
  const far = formatDistance({ overflow: true, mantissa: 4.0320714, exponent: 308 });
  const near = formatDistance({ overflow: true, mantissa: 4, exponent: 308 });
  assert.ok(far.includes('4.032') && far.includes('10^308'));
  assert.ok(near.startsWith('4') && near.includes('10^308'));
  assert.notEqual(far, near);
});
