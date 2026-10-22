import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { GetPaymentMethodsDto } from './dto/get-payment-methods.dto';
import { DefaultCart } from './dto/set-default-card.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodService } from './payment-method.service';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';

@Controller('cards')
export class PaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  @SuperAdminOnly()
  @Post()
  create(@Body() createPaymentMethodDto: CreatePaymentMethodDto) {
    return this.paymentMethodService.create(createPaymentMethodDto);
  }

  @SuperAdminOnly()
  @Get()
  findAll(@Query() getTaxesDto: GetPaymentMethodsDto) {
    return this.paymentMethodService.findAll();
  }

  @SuperAdminOnly()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentMethodService.findOne(+id);
  }

  @SuperAdminOnly()
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateTaxDto: UpdatePaymentMethodDto,
  ) {
    return this.paymentMethodService.update(+id, updateTaxDto);
  }

  @SuperAdminOnly()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.paymentMethodService.remove(+id);
  }
}

@Controller('/save-payment-method')
export class SavePaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}
  @SuperAdminOnly()
  @Post()
  savePaymentMethod(@Body() createPaymentMethodDto: CreatePaymentMethodDto) {
    createPaymentMethodDto.default_card = false;
    return this.paymentMethodService.savePaymentMethod(createPaymentMethodDto);
  }
}

@Controller('/set-default-card')
export class SetDefaultCartController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}
  @SuperAdminOnly()
  @Post()
  setDefaultCart(@Body() defaultCart: DefaultCart) {
    return this.paymentMethodService.saveDefaultCart(defaultCart);
  }
}
