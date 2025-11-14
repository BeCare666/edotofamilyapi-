// src/order/dto/order-paginator.dto.ts
import { Paginator } from 'src/common/dto/paginator.dto';
import { Order } from '../entities/order.entity';

export class OrderPaginator extends Paginator<Order> {
    data: Order[];
}
