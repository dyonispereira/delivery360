import { Global, Module } from '@nestjs/common';
import { FakePaymentGateway, PAYMENT_GATEWAY } from './payment-gateway';

@Global()
@Module({
  providers: [{ provide: PAYMENT_GATEWAY, useFactory: () => new FakePaymentGateway() }],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentsModule {}
