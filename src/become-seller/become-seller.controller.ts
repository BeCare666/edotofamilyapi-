// src/become-seller/become-seller.controller.ts
import { Controller, Get, Post, UseGuards, Req, UnauthorizedException } from '@nestjs/common';
import { BecomeSellerService } from './become-seller.service';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, SUPER_ADMIN } from '../auth/roles.decorator';
import { assertSellerSignupOpen } from '../auth/seller-signup';

@Controller('became-seller')
export class BecomeSellerController {
  constructor(private readonly becomeSellerService: BecomeSellerService) { }

  // Devenir vendeur : fermé tant que SELLER_SIGNUP_OPEN n'est pas activé (décision du 25/09/2026)
  @UseGuards(AuthGuard('jwt'))
  @Post()
  async create(@Req() req: Request) {
    assertSellerSignupOpen();
    const user = req.user as any;
    if (!user?.id) {
      throw new UnauthorizedException('Utilisateur non authentifié');
    }

    return this.becomeSellerService.create({ userId: user.id });
  }

  // Liste des vendeurs : admin uniquement, sans mot de passe (était publique et renvoyait SELECT *)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Get()
  findAll() {
    return this.becomeSellerService.findAll();
  }
}
