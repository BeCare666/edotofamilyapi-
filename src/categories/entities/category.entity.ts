import { Attachment } from 'src/common/entities/attachment.entity';
import { CoreEntity } from 'src/common/entities/core.entity';
import { Product } from 'src/products/entities/product.entity';
import { Type } from 'src/types/entities/type.entity';

export class Category extends CoreEntity {
  name: string;
  slug: string;
  parent_id?: Category;
  children?: Category[];
  details?: string;
  icon?: string;
  type_id?: number;
  parent?: number;
  type?: Type;
  products?: Product[];
  language: string;
  translated_languages: string[];
}
