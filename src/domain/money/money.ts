import Decimal from 'decimal.js';

interface MoneyProps {
  amount: string;
  currency: string;
}

const AMOUNT_FORMAT = /^(?:0|[1-9]\d{0,12})\.\d{2}$/; // Serializado como string decimal, sempre com escala fixa de 2 casas
const CURRENCY_FORMAT_ISO = /^[A-Z]{3}$/; // ISO-4217

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  // Factory que controla a criação
  static from(props: MoneyProps): Money {
    if (!AMOUNT_FORMAT.test(props.amount)) {
      throw new Error('Valor monetário inválido');
    }

    if (!CURRENCY_FORMAT_ISO.test(props.currency)) {
      throw new Error('Formato de moeda inválido');
    }

    return new Money(new Decimal(props.amount), props.currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);

    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);

    if (this.value.lessThan(other.value)) {
      throw new Error('Resultado monetário não pode ser negativo');
    }

    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  toString(): string {
    return this.value.toFixed(2);
  }

  // assertSameCurrency serve para garantir que dois valores monetários estejam na mesma moeda antes de realizar uma operação entre eles.
  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error('Moedas incompatíveis');
    }
  }
}
