import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  Put,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { DatabaseService } from '../database/database.services';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { GetProductsDto, ProductPaginator } from './dto/get-products.dto';
import { Product } from './entities/product.entity';
import { GetPopularProductsDto } from './dto/get-popular-products.dto';
import { GetFollowedShopsProducts } from './dto/get-followed-shops-products.dto';
import { GetBestSellingProductsDto } from './dto/get-best-selling-products.dto';
import { GetProductsByCorridorDto } from './dto/get-products-by-corridor.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService,
    private readonly databaseService: DatabaseService,
  ) { }
  @Get('corridor')
  async getProductsByCorridor(@Query() query: GetProductsByCorridorDto) {
    return this.productsService.getProductsByCorridor(query);
  }
  @Get('search')
  async searchProducts(
    @Query('countryId') countryId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('corridorId') corridorId?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('search') search?: string,
  ) {
    return this.productsService.findFilteredProducts(
      countryId ? Number(countryId) : undefined,
      categoryId ? Number(categoryId) : undefined,
      corridorId ? Number(corridorId) : undefined,
      minPrice ? Number(minPrice) : undefined,
      maxPrice ? Number(maxPrice) : undefined,
      search ?? undefined,
    );
  }
  @Post()
  async createProduct(@Body() createProductDto: CreateProductDto) {
    const { shop_id } = createProductDto;

    if (!shop_id) {
      throw new BadRequestException('shop_id is required');
    }

    // Vérifier le shop et récupérer owner_id
    const [shops]: any[] = await this.databaseService.query(
      'SELECT owner_id FROM shops WHERE id = ?',
      [shop_id]
    );

    if (!shops.length) {
      throw new NotFoundException('Shop not found');
    }

    const owner_id = shops[0].owner_id;

    // Passer owner_id et shop_id au service
    return this.productsService.create({
      ...createProductDto,
      owner_id,
      shop_id,
    });
  }

  @Get()
  async getProducts(@Query() query: GetProductsDto): Promise<ProductPaginator> {
    return this.productsService.getProducts(query);
  }
  //@Get('test-simple')
  //async testSimple() {
  //  return this.productsService.testSimpleGet();
  //}
  @Get(':slug')
  async getProductBySlug(@Param('slug') slug: string): Promise<Product> {
    return this.productsService.getProductBySlug(slug);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    return this.productsService.update(+id, updateProductDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(+id);
  }
}

@Controller('popular-products')
export class PopularProductsController {
  constructor(private readonly productsService: ProductsService) { }

  @Get()
  async getProducts(@Query() query: GetPopularProductsDto): Promise<Product[]> {
    return this.productsService.getPopularProducts(query);
  }
}
@Controller('best-selling-products')
export class BestSellingProductsController {
  constructor(private readonly productsService: ProductsService) { }
  @Get()
  async getProducts(@Query() query: GetBestSellingProductsDto): Promise<Product[]> {
    return this.productsService.getBestSellingProducts(query);
  }
}

@Controller('followed-shops-popular-products')
export class FollowedShopsProductsController {
  constructor(private readonly productsService: ProductsService) { }

  @Get()
  async followedShopsPopularProducts(
    @Query() query: GetFollowedShopsProducts,
  ): Promise<Product[]> {
    return this.productsService.followedShopsPopularProducts(query);
  }
}
@Controller('draft-products')
export class DraftProductsController {
  constructor(private readonly productsService: ProductsService) { }
  @Get()
  async getProducts(@Query() query: GetProductsDto): Promise<ProductPaginator> {
    return this.productsService.getDraftProducts(query);
  }
}

@Controller('products-stock')
export class ProductsStockController {
  constructor(private readonly productsService: ProductsService) { }
  @Get()
  async getProducts(@Query() query: GetProductsDto): Promise<ProductPaginator> {
    return this.productsService.getProductsStock(query);
  }
}

@Controller()
export class ProductAliasController {
  constructor(private readonly productsService: ProductsService) { }

  // Alias pour /low-stock-products → /products-stock
  @Get('low-stock-products')
  async lowStock(@Query() query: GetProductsDto) {
    return this.productsService.getProductsStock(query);
  }

  // Alias pour /top-rate-product → /best-selling-products
  @Get('top-rate-product')
  async topRated(@Query() query: GetBestSellingProductsDto) {
    return this.productsService.getBestSellingProducts(query);
  }

  // Alias pour /category-wise-product → /products/search (par catégorie)
  @Get('category-wise-product')
  async categoryWise(@Query() query: GetProductsDto) {
    // Ici tu peux forcer un filtrage par categoryId si nécessaire
    return this.productsService.getProducts(query);
  }
}

