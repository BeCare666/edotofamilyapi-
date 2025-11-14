import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) { }

  @Get()
  async findAll(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) return { error: 'Utilisateur non identifié' };

    // On délègue la logique de rôle au service
    return this.analyticsService.findAllByUser(userId);
  }


  @Get('category-wise-product')
  async categoryWiseProduct(@Req() req: any) {
    const user = req.user;
    const isAdmin = user?.permissions?.includes('super_admin');

    if (isAdmin) return this.analyticsService.findAllCategoryWiseProduct();
    const shop = await this.analyticsService.getShopByOwnerId(user.userId);
    return this.analyticsService.findAllCategoryWiseProduct(); // Pour l'instant même query, mais tu peux adapter par shop si nécessaire
  }

  @Get('low-stock-products')
  async lowStockProducts(@Req() req: any) {
    const user = req.user;
    const isAdmin = user?.permissions?.includes('super_admin');

    if (isAdmin) return this.analyticsService.findAllLowStockProducts();
    const shop = await this.analyticsService.getShopByOwnerId(user.userId);
    return this.analyticsService.findAllLowStockProducts(); // Pareil, adapter par shop si besoin
  }

  @Get('top-rate-product')
  async topRateProducts(@Req() req: any) {
    const user = req.user;
    const isAdmin = user?.permissions?.includes('super_admin');

    if (isAdmin) return this.analyticsService.findAllTopRateProduct();
    const shop = await this.analyticsService.getShopByOwnerId(user.userId);
    return this.analyticsService.findAllTopRateProduct(); // Adapter par shop si nécessaire
  }
}
