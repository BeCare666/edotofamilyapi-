import { Product } from '../entities/product.entity';

export interface ProductPaginator {
    data: Product[];
    total: number;
    count: number;
    current_page: number;
    firstItem: number;
    lastItem: number;
    per_page: number;
    last_page: number;
    first_page_url: string;
    last_page_url: string;
    next_page_url: string | null;
    prev_page_url: string | null;
}

export interface GetProductsDto {
    searchJoin?: string;
    search?: string;
    date_range?: string;
    limit?: number;
    page?: number;
    shop_id?: number;
    name?: string;
    product_type?: string;
    categories?: string;
    language?: string;
    orderBy?: string;
    sortedBy?: 'asc' | 'desc';
}