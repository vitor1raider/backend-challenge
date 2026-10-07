import { describe, expect, it } from 'bun:test';
import { Money } from '../../../../src/domain/money/money';

describe('Money', () => {
  it('should receive and serialize amount as a decimal string with exactly two decimal places', () => {
    const money = Money.from({ amount: '100.00', currency: 'BRL' });

    const serialized = money.toJSON();

    expect(typeof serialized.amount).toBe('string');
    expect(serialized.amount).toBe('100.00');
    expect(money.toString()).toBe('100.00');
  });

  it('should throw a domain error when operating with different currencies', () => {
    const brl = Money.from({ amount: '100.00', currency: 'BRL' });
    const usd = Money.from({ amount: '10.00', currency: 'USD' });

    expect(() => brl.add(usd)).toThrow('Moedas incompatíveis');
    expect(() => brl.subtract(usd)).toThrow('Moedas incompatíveis');
    expect(() => brl.isLessThan(usd)).toThrow('Moedas incompatíveis');
  });

  it('should remain immutable after a monetary operation', () => {
    const original = Money.from({ amount: '100.00', currency: 'BRL' });
    const increment = Money.from({ amount: '25.00', currency: 'BRL' });

    const result = original.add(increment);

    expect(result).not.toBe(original);
    expect(original.toString()).toBe('100.00');
    expect(increment.toString()).toBe('25.00');
    expect(result.toString()).toBe('125.00');
  });

  it('should add monetary values with exact decimal precision', () => {
    const left = Money.from({ amount: '0.10', currency: 'BRL' });
    const right = Money.from({ amount: '0.20', currency: 'BRL' });

    const result = left.add(right);

    expect(result.toString()).toBe('0.30');
    expect(result.currency).toBe('BRL');
  });

  it('should subtract monetary values with exact decimal precision', () => {
    const left = Money.from({ amount: '100.00', currency: 'BRL' });
    const right = Money.from({ amount: '25.55', currency: 'BRL' });

    const result = left.subtract(right);

    expect(result.toString()).toBe('74.45');
    expect(left.toString()).toBe('100.00');
  });

  it('should negate a monetary value without changing the original', () => {
    const original = Money.from({ amount: '25.50', currency: 'BRL' });

    const negated = original.negate();

    expect(negated.toString()).toBe('-25.50');
    expect(negated.isNegative()).toBeTrue();
    expect(original.toString()).toBe('25.50');
    expect(original.isPositive()).toBeTrue();
  });

  it('should create and identify a zero monetary value', () => {
    const zero = Money.zero('BRL');

    expect(zero.toString()).toBe('0.00');
    expect(zero.currency).toBe('BRL');
    expect(zero.isZero()).toBeTrue();
    expect(zero.isPositive()).toBeFalse();
    expect(zero.isNegative()).toBeFalse();
  });

  it('should compare monetary values with the same currency', () => {
    const lower = Money.from({ amount: '10.00', currency: 'BRL' });
    const equal = Money.from({ amount: '10.00', currency: 'BRL' });
    const higher = Money.from({ amount: '20.00', currency: 'BRL' });
    const sameAmountInUsd = Money.from({ amount: '10.00', currency: 'USD' });

    expect(lower.isLessThan(higher)).toBeTrue();
    expect(higher.isLessThan(lower)).toBeFalse();
    expect(lower.equals(equal)).toBeTrue();
    expect(lower.equals(higher)).toBeFalse();
    expect(lower.equals(sameAmountInUsd)).toBeFalse();
  });

  it('should reject an amount instead of rounding it', () => {
    expect(() =>
      Money.from({ amount: '10.005', currency: 'BRL' }),
    ).toThrow();
  });

  it.each([
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['scientific notation', '1e3'],
    ['an empty string', ''],
    ['more than two decimal places', '10.001'],
    ['a negative value', '-1.00'],
  ])('should reject %s as an invalid input amount', (_, amount) => {
    expect(() => Money.from({ amount, currency: 'BRL' })).toThrow(
      'Valor monetário inválido',
    );
  });
});
