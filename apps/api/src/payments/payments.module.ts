import { Global, Module } from '@nestjs/common';
import { PaymentAccountsService } from './payment-accounts.service';
import { PaymentsController } from './payments.controller';

@Global()
@Module({
  controllers: [PaymentsController],
  providers: [PaymentAccountsService],
  exports: [PaymentAccountsService],
})
export class PaymentsModule {}
