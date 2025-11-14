import { PaginationArgs } from 'src/common/dto/pagination-args.dto';
import { Paginator } from 'src/common/dto/paginator.dto';

import { Product } from '../entities/product.entity';

export class ProductPaginator extends Paginator<Product> {
  data: Product[];

}

export class GetProductsDto extends PaginationArgs {

  searchJoin?: string;
  search?: string;
  date_range?: string;
  limit?: number;
  page?: number;
  shop_id?: number;
  countries_id?: number;
  name?: string;
  product_type?: string;
  categories?: string;
  language?: string;
  status?: string;
  orderBy?: string;
  is_origin?: boolean;
  sortedBy?: 'asc' | 'desc';
}

export enum QueryProductsOrderByColumn {
  CREATED_AT = 'CREATED_AT',
  NAME = 'NAME',
  UPDATED_AT = 'UPDATED_AT',
}

