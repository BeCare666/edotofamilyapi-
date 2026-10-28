import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ShopsService } from './shops.service';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { GetShopsDto, ShopPaginator } from './dto/get-shops.dto';
import { GetStaffsDto } from './dto/get-staffs.dto';
import { UserPaginator } from 'src/users/dto/get-users.dto';
import { GetTopShopsDto } from './dto/get-top-shops.dto';
import { GetFollowedShops } from './dto/get-followed-shop.dto';
import { Shop } from './entities/shop.entity';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Req } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';

import { Request } from 'express';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';
import { Public } from '../auth/public.decorator';
import { ApproveShopDto, IdBodyDto } from '../common/dto/id-body.dto';

@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) { }

  @SuperAdminOnly()
  @Post()
  create(@Req() req, @Body() createShopDto: CreateShopDto) {
    const ownerId = req.user.userId;  // userId du JWT validé
    console.log('Creating shop for user:', ownerId);
    console.log('req.user:', req.user);
    return this.shopsService.create({ ...createShopDto, owner_id: ownerId });
  }

  @Public()
  @Get()
  async getShops(@Query() query: GetShopsDto): Promise<ShopPaginator> {
    return this.shopsService.getShops(query);
  }

  @Public()
  @Get(':slug')
  async getShop(@Param('slug') slug: string) {
    return this.shopsService.getShop(slug);
  }

  @SuperAdminOnly()
  @Put(':id')
  update(@Param('id') id: string, @Body() updateShopDto: UpdateShopDto) {
    return this.shopsService.update(+id, updateShopDto);
  }

  @SuperAdminOnly()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shopsService.remove(+id);
  }

  @SuperAdminOnly()
  @Post('approve')
  approveShop(@Param('id') id: string) {
    return this.shopsService.approve(+id);
  }
}

@Controller('disapprove-shop')
export class DisapproveShop {
  constructor(private shopsService: ShopsService) { }

  @SuperAdminOnly()
  @Post(':id')
  disapproveShop(@Param('id', ParseIntPipe) id: number) {
    return this.shopsService.disapproveShop(id);
  }
}

@Controller('staffs')
export class StaffsController {
  constructor(private readonly shopsService: ShopsService) { }

  @SuperAdminOnly()
  @Post()
  create(@Body() createShopDto: CreateShopDto) {
    return this.shopsService.create(createShopDto);
  }

  @Get()
  async getStaffs(@Query() query: GetStaffsDto): Promise<UserPaginator> {
    return this.shopsService.getStaffs(query);
  }

  @Get(':slug')
  async getShop(@Param('slug') slug: string) {
    return this.shopsService.getShop(slug);
  }

  @SuperAdminOnly()
  @Put(':id')
  update(@Param('id') id: string, @Body() updateShopDto: UpdateShopDto) {
    return this.shopsService.update(+id, updateShopDto);
  }

  @SuperAdminOnly()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shopsService.remove(+id);
  }
}

@Controller('disapprove-shop')
export class DisapproveShopController {
  constructor(private shopsService: ShopsService) { }

  @SuperAdminOnly()
  @Post()
  async disapproveShop(@Body() { id }: IdBodyDto) {
    return this.shopsService.disapproveShop(id);
  }
}

@Controller('approve-shop')
export class ApproveShopController {
  constructor(private shopsService: ShopsService) { }

  @SuperAdminOnly()
  @Post()
  async approveShop(@Body() { id }: ApproveShopDto) {
    return this.shopsService.approveShop(id);
  }
}

@Controller('new-shops')
export class NewShopsController {
  constructor(private shopsService: ShopsService) { }

  @Public()
  @Get()
  async getNewShops(@Query() query: GetShopsDto): Promise<ShopPaginator> {
    return this.shopsService.getNewShops(query);
  }
}
