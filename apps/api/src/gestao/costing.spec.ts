import { costSheet, DEFAULT_RATES, paymentFeeBps, unitCost, type CostItem } from '@delivery360/shared';

const burger: CostItem[] = [
  { name: 'Pão', kind: 'INGREDIENT', costCents: 300 },
  { name: 'Hambúrguer', kind: 'INGREDIENT', costCents: 500 },
  { name: 'Fatia de queijo', kind: 'INGREDIENT', costCents: 100 },
  { name: 'Embalagem', kind: 'PACKAGING', costCents: 30 },
];
const rates = { ...DEFAULT_RATES, salesTaxBps: 600, pixFeeBps: 99, creditFeeBps: 400, cardOnDeliveryFeeBps: 250, targetMarginBps: 2000 };

describe('Ficha técnica (CMV)', () => {
  it('exemplo do hambúrguer: CMV, outras despesas, lucro e % de resultado', () => {
    const s = costSheet(3000, burger, rates);
    expect(s.ingredientsCents).toBe(900);
    expect(s.packagingCents).toBe(30);
    expect(s.cmvCents).toBe(930);
    expect(s.cmvPct).toBe(31);
    // imposto 6% + maior taxa (cartão online 4%) = 10% de R$ 30 = R$ 3,00
    expect(s.variablePct).toBe(10);
    expect(s.variableCents).toBe(300);
    expect(s.profitCents).toBe(3000 - 930 - 300);
    expect(s.resultPct).toBe(59);
    expect(s.cmvHealth).toBe('attention');
  });

  it('outras despesas do produto somam aos impostos e taxas', () => {
    expect(costSheet(3000, burger, rates, 500).variableCents).toBe(450);
  });

  it('preço sugerido para a meta de resultado', () => {
    // 930 / (1 - 10% - 20%) = 1328,57 → arredonda para cima em R$ 0,10
    expect(costSheet(3000, burger, rates).suggestedPriceCents).toBe(1330);
    // meta impossível (despesas + meta >= 100%)
    expect(costSheet(3000, burger, { ...rates, targetMarginBps: 9000 }).suggestedPriceCents).toBeNull();
  });

  it('sem ficha, a situação fica "none"; CMV alto acima de 40%', () => {
    expect(costSheet(3000, [], rates).cmvHealth).toBe('none');
    expect(costSheet(2000, burger, rates).cmvHealth).toBe('high');
    expect(costSheet(5000, burger, rates).cmvHealth).toBe('good');
  });

  it('custo da unidade vendida soma os adicionais; taxa depende da forma de pagamento', () => {
    expect(unitCost(burger, [150, 100])).toBe(1180);
    expect(paymentFeeBps(rates, 'PIX')).toBe(99);
    expect(paymentFeeBps(rates, 'CASH_ON_DELIVERY')).toBe(0);
  });
});
