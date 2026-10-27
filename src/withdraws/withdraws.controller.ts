import { Controller, Get, Param, Query, UsePipes } from '@nestjs/common';
import { WithdrawsService } from './withdraws.service';
import { GetWithdrawsDto, WithdrawPaginator } from './dto/get-withdraw.dto';
import { WithdrawValidationPipe } from './pipe/withdraw-validation.pipe';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';

// Lecture seule pour le tableau de bord du super admin (nettoyage N5, 27/10/2026) : aucun écran n'écrit de retrait.
@Controller('withdraws')
export class WithdrawsController {
  constructor(private readonly withdrawsService: WithdrawsService) {}

  @SuperAdminOnly()
  @Get()
  @UsePipes(new WithdrawValidationPipe())
  async withdraws(@Query() query: GetWithdrawsDto): Promise<WithdrawPaginator> {
    return this.withdrawsService.getWithdraws(query);
  }

  @SuperAdminOnly()
  @Get(':id')
  withdraw(@Param('id') id: string) {
    return this.withdrawsService.findOne(+id);
  }
}
