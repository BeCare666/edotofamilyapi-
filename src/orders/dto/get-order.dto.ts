// Pour un order unique
export class GetOrderArgs {
  id?: number;
  tracking_number?: string;
}

// Pour la liste avec pagination
import { Paginator } from 'src/common/dto/paginator.dto';
import { Order } from '../entities/order.entity';
import { PaginationArgs } from 'src/common/dto/pagination-args.dto';
import { SortOrder } from 'src/common/dto/generic-conditions.dto';

export class GetOrdersDto extends PaginationArgs {
  orderBy?: QueryOrdersOrderByColumn;
  sortedBy?: SortOrder;
  search?: string;
}

export enum QueryOrdersOrderByColumn {
  CREATED_AT = 'created_at',
  UPDATED_AT = 'updated_at',
  TOTAL = 'total',
  PAID_TOTAL = 'paid_total',
  CUSTOMER_CONTACT = 'customer_contact',
  TRACKING_NUMBER = 'tracking_number',
}

export class OrderPaginator extends Paginator<Order> {
  data: Order[];
}
