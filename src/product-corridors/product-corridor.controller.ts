import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ProductCorridorService } from './product-corridor.service';
import { SuperAdminOnly } from '../auth/super-admin-only.decorator';

@Controller('product-corridors')
export class ProductCorridorController {
    constructor(private readonly service: ProductCorridorService) { }

    @Get('unlinked-products')
    async getUnlinkedProducts() {
        return this.service.getUnlinkedProducts();
    }

    @Get('valid-corridors/:productId')
    async getValidCorridors(@Param('productId') productId: number) {
        return this.service.getValidCorridors(productId);
    }

    @SuperAdminOnly()
    @Post('link')
    async linkProductToCorridors(
        @Body() data: { productId: number; corridorIds: number[] },
    ) {
        return this.service.linkProductToCorridors(data.productId, data.corridorIds);
    }
}
