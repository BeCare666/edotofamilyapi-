import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { OkPacket, RowDataPacket } from 'mysql2';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { GetProductsDto } from './dto/get-products.dto';
import { GetPopularProductsDto } from './dto/get-popular-products.dto';
import { GetBestSellingProductsDto } from './dto/get-best-selling-products.dto';
import { GetProductsByCorridorDto } from './dto/get-products-by-corridor.dto';
import { paginate } from 'src/common/pagination/paginate';
import { Product } from './entities/product.entity';
import { ProductPaginator } from './interfaces/product-paginator.interface';
@Injectable()
export class ProductsService {
  constructor(private readonly DatabaseService: DatabaseService) { }
  /**
   * Service for managing products in the application.
      
   */
  // --- CREATE PRODUCT ----
  // Fonction utilitaire pour générer un slug propre à partir d'un texte.
  private formatSlug(text: string): string {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  }

  async create(createProductDto: CreateProductDto & { digital_file?: any; video?: any; gallery?: any; image?: any }): Promise<Product> {
    if (createProductDto.countries_id) {
      createProductDto.countries_id = Number(createProductDto.countries_id);
    }
    const {
      owner_id,
      name,
      slug,
      description,
      type_id,
      price,
      shop_id,
      sale_price,
      language,
      min_price,
      max_price,
      sku,
      preview_url,
      quantity,
      in_stock = true,
      is_taxable = false,
      shipping_class_id,
      status,
      product_type,
      unit,
      height,
      width,
      length,
      author_id,
      manufacturer_id,
      is_digital = false,
      is_external = false,
      external_product_url,
      external_product_button_text,
      image,
      gallery,
      is_origin,
      video,
      digital_file,
      countries_id
    } = createProductDto;
    console.log('Type de countries_id:', typeof createProductDto.countries_id);
    console.log('Valeur de createProductDto:', createProductDto);

    // Attention, je récupère aussi les tags et categories à part sans modifier la signature ni le DTO.  
    const tags = (createProductDto as any).tags ?? [];
    const categories = (createProductDto as any).categories ?? [];

    let imageJson = null;
    let galleryJson = null;
    let videoJson = null;
    let digitalFileJson = null;

    // --- INSERT MEDIA ---
    if (image?.url) {
      const [img]: [OkPacket, any] = await this.DatabaseService.query<OkPacket>(
        `INSERT INTO media (user_id, url, \`key\`, mime_type, size, original_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          owner_id,
          image.url,
          image.key ?? 'local-file',
          image.mimeType ?? null,
          image.size ?? null,
          image.originalName ?? null
        ]
      );
      imageJson = JSON.stringify({ id: img.insertId, url: image.url });
    }

    if (gallery && Array.isArray(gallery)) {
      const galleryItems = [];
      for (const g of gallery) {
        const [gal]: [OkPacket, any] = await this.DatabaseService.query<OkPacket>(
          `INSERT INTO media (user_id, url, \`key\`, mime_type, size, original_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            owner_id,
            g.url,
            g.key ?? 'local-file',
            g.mimeType ?? null,
            g.size ?? null,
            g.originalName ?? null
          ]
        );
        galleryItems.push({ id: gal.insertId, url: g.url });
      }
      galleryJson = JSON.stringify(galleryItems);
    }

    if (video?.url) {
      const [vid]: [OkPacket, any] = await this.DatabaseService.query<OkPacket>(
        `INSERT INTO media (user_id, url, \`key\`, mime_type, size, original_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          owner_id,
          video.url,
          video.key ?? 'local-file',
          video.mimeType ?? null,
          video.size ?? null,
          video.originalName ?? null
        ]
      );
      videoJson = JSON.stringify({ id: vid.insertId, url: video.url });
    }

    if (digital_file?.url) {
      const [file]: [OkPacket, any] = await this.DatabaseService.query<OkPacket>(
        `INSERT INTO media (user_id, url, \`key\`, mime_type, size, original_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          owner_id,
          digital_file.url,
          digital_file.key ?? 'local-file',
          digital_file.mimeType ?? null,
          digital_file.size ?? null,
          digital_file.originalName ?? null
        ]
      );
      digitalFileJson = JSON.stringify({ id: file.insertId, url: digital_file.url });
    }

    // --- Slug ---
    const finalSlug = slug && slug.trim() !== '' ? slug : this.formatSlug(name);
    const parsedPrice = price ? Number(price) : null;
    const parsedSalePrice = sale_price ? Number(sale_price) : null;

    // --- INSERT PRODUCT ---   
    const [product]: [OkPacket, any] = await this.DatabaseService.query<OkPacket>(
      `INSERT INTO products
     (owner_id, name, slug, description, type_id, price, shop_id, sale_price, language, min_price, max_price, sku,
      preview_url, quantity, in_stock, is_taxable, shipping_class_id, status, product_type, unit, height, width, length,
      image, gallery, video, is_origin, digital_file, author_id, manufacturer_id, is_digital, is_external, external_product_url, external_product_button_text, countries_id,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        owner_id ?? null,
        name,
        finalSlug,
        description ?? null,
        type_id ?? null,
        parsedPrice ?? null,
        shop_id ?? null,
        parsedSalePrice ?? null,
        language ?? null,
        min_price ?? null,
        max_price ?? null,
        sku ?? null,
        preview_url ?? null,
        quantity ?? 0,
        in_stock ? 1 : 0,
        is_taxable ? 1 : 0,
        shipping_class_id ?? null,
        status ?? null,
        product_type ?? null,
        unit ?? null,
        height ?? null,
        width ?? null,
        length ?? null,
        imageJson,
        galleryJson,
        videoJson,
        is_origin,
        digitalFileJson,
        author_id ?? null,
        manufacturer_id ?? null,
        is_digital ? 1 : 0,
        is_external ? 1 : 0,
        external_product_url ?? null,
        external_product_button_text ?? null,
        countries_id ?? null
      ]
    );

    const productId = product.insertId;

    // --- INSERT TAGS ---
    if (Array.isArray(tags) && tags.length > 0) {
      const values = tags.map(() => '(?, ?)').join(', ');
      const flatValues = tags.flatMap((tagId: number) => [productId, tagId]);

      await this.DatabaseService.query(
        `INSERT INTO product_tags (product_id, tag_id) VALUES ${values}`,
        flatValues
      );
    }

    // --- INSERT CATEGORIES ---
    // --- INSERT CATEGORIES, SOUS_CATEGORIES, SUB_CATEGORIES ---
    // --- INSERT CATEGORIES, SOUS_CATEGORIES, SUB_CATEGORIES ---
    console.log("📦 CATEGORIES REÇUES:", categories, "type:", typeof categories, "isArray:", Array.isArray(categories));

    if (Array.isArray(categories) && categories.length > 0) {
      const flatValues: any[] = [];

      // --- Récupérer les IDs valides depuis la DB ---
      const [validSous] = await this.DatabaseService.query('SELECT id FROM sous_categories');
      const validSousIds = validSous.map((c: any) => c.id);

      const [validSub] = await this.DatabaseService.query('SELECT id FROM sub_categories');
      const validSubIds = validSub.map((c: any) => c.id);

      categories.forEach(cat => {
        // Filtrer uniquement les sous_categories et sub_categories valides
        const sous = (Array.isArray(cat.sous_categories_id) ? cat.sous_categories_id : []).filter((id: number) => validSousIds.includes(id));
        const subs = (Array.isArray(cat.sub_categories_id) ? cat.sub_categories_id : []).filter((id: number) => validSubIds.includes(id));

        // Si aucune sous-category ou sub-category valide, on met null
        const sousToInsert = sous.length > 0 ? sous : [null];
        const subsToInsert = subs.length > 0 ? subs : [null];

        // Cross join pour toutes les combinaisons
        sousToInsert.forEach(sousId => {
          subsToInsert.forEach(subId => {
            flatValues.push([productId, cat.categories_id ?? null, sousId, subId]);
          });
        });
      });

      if (flatValues.length > 0) {
        const placeholders = flatValues.map(() => '(?, ?, ?, ?)').join(', ');
        const flattened = flatValues.flat();
        await this.DatabaseService.query(
          `INSERT INTO product_categories (product_id, categories_id, sous_categories_id, sub_categories_id) VALUES ${placeholders}`,
          flattened
        );
        console.log("✅ Product categories insérées avec succès :", flatValues);
      } else {
        console.log("⚠️ Aucune catégorie valide à insérer pour ce produit.");
      }
    }






    console.log('Created product ID:', productId);

    return this.getProductById(productId);
  }



  // --- GET ALL PRODUCTS ---
  async getProducts(query: GetProductsDto): Promise<ProductPaginator> {
    const {
      shop_id,
      language,
      name: rawName,
      status: rawStatus,
      product_type,
      categories,
      limit = 20,
      page = 1,
      orderBy = 'created_at',
      sortedBy = 'desc',
      search, // si le front envoie "search=name:Merc;status:publish"
    } = query;

    let name = rawName;
    let status = rawStatus;

    // 🔹 Parser le paramètre `search` si fourni
    if (search) {
      const searchParts = search.split(';');
      searchParts.forEach(part => {
        const [key, value] = part.split(':');
        if (key && value) {
          if (key === 'name') name = value;
          if (key === 'status') status = value;
        }
      });
    }

    const offset = (page - 1) * limit;
    const where: string[] = [];
    const params: any[] = [];
    const pool = this.DatabaseService.getPool();

    // 🔹 Conditions
    if (shop_id) {
      where.push(`p.shop_id = ?`);
      params.push(Number(shop_id));
    }

    if (language) {
      where.push(`(p.language = ? OR p.language IS NULL)`);
      params.push(language);
    }

    if (name && name.trim() !== '') {
      where.push(`p.name LIKE ?`);
      params.push(`%${name}%`);
    }

    if (status) {
      where.push(`p.status = ?`);
      params.push(status);
    }

    if (product_type) {
      where.push(`p.product_type = ?`);
      params.push(product_type);
    }

    if (categories) {
      where.push(`FIND_IN_SET(?, p.categories)`);
      params.push(categories);
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // 🔹 Order sécurisé
    const allowedOrderFields = ['created_at', 'name', 'price', 'updated_at'];
    const orderBySafe = allowedOrderFields.includes(orderBy) ? orderBy : 'created_at';
    const sortedBySafe = sortedBy?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 🔹 Count total
    const countSql = `SELECT COUNT(*) as total FROM products p ${whereSql}`;
    console.log('COUNT SQL:', countSql, 'Params:', params);
    const [countRows]: any = await pool.query(countSql, params);
    const total = countRows[0]?.total ?? 0;

    // 🔹 Charger les données
    const dataSql = `
    SELECT p.*, s.id AS shop_id, s.slug AS shop_slug, s.name AS shop_name
    FROM products p
    LEFT JOIN shops s ON p.shop_id = s.id
    ${whereSql}
    ORDER BY p.${orderBySafe} ${sortedBySafe}
    LIMIT ? OFFSET ?
  `;
    console.log('DATA SQL:', dataSql, 'Params:', [...params, Number(limit), Number(offset)]);

    const [rows]: any = await pool.query(dataSql, [...params, Number(limit), Number(offset)]);

    const last_page = Math.ceil(total / limit);
    const baseUrl = `/products?limit=${limit}`;

    return {
      data: rows.map((row: any) => ({
        ...row,
        shop: {
          id: row.shop_id,
          slug: row.shop_slug,
          name: row.shop_name,
        },
      })) as Product[],
      count: total,
      total,
      current_page: page,
      firstItem: offset + 1,
      lastItem: offset + rows.length,
      per_page: limit,
      last_page,
      first_page_url: `${baseUrl}&page=1`,
      last_page_url: `${baseUrl}&page=${last_page}`,
      next_page_url: page < last_page ? `${baseUrl}&page=${page + 1}` : null,
      prev_page_url: page > 1 ? `${baseUrl}&page=${page - 1}` : null,
    };
  }







  // --- GET PRODUCT BY SLUG ----
  async getProductBySlug(slug: string): Promise<Product> {
    try {
      const [rows]: [any[], any] = await this.DatabaseService.getPool().query(
        `SELECT p.*, s.slug as shop_slug, s.name as shop_name
       FROM products p
       LEFT JOIN shops s ON p.shop_id = s.id
       WHERE p.slug = ?`,
        [slug],
      );

      if (!rows.length) throw new NotFoundException('Product not found');

      const row = rows[0];

      const product: Product = {
        ...row,
        shop: {
          slug: row.shop_slug,
          name: row.shop_name,
        },
      };

      return product;
    } catch (err) {
      console.error('Error in getProductBySlug:', err);
      throw err;
    }
  }


  // --- GET PRODUCT BY ID ---
  async getProductById(id: number): Promise<Product> {
    const [rows]: [RowDataPacket[], any] = await this.DatabaseService.getPool().query(
      `SELECT * FROM products WHERE id = ?`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Product not found');
    return rows[0] as Product;
  }

  // --- GET POPULAR PRODUCTS ---
  async getPopularProducts({ limit = 10 }: GetPopularProductsDto): Promise<Product[]> {
    const [rows]: [RowDataPacket[], any] = await this.DatabaseService.getPool().query(
      `SELECT * FROM products ORDER BY ratings DESC LIMIT ?`,
      [Number(limit)],
    );
    return rows as Product[];
  }

  // --- GET BEST SELLING PRODUCTS ---
  async getBestSellingProducts({ limit = 10 }: GetBestSellingProductsDto): Promise<Product[]> {
    const [rows]: [RowDataPacket[], any] = await this.DatabaseService.getPool().query(
      `SELECT * FROM products ORDER BY total_reviews DESC LIMIT ?`,
      [Number(limit)],
    );
    return rows as Product[];
  }

  // --- FOLLOWED SHOPS POPULAR PRODUCTS ---
  async followedShopsPopularProducts({ limit = 10 }: any): Promise<Product[]> {
    const [rows]: [RowDataPacket[], any] = await this.DatabaseService.getPool().query(
      `SELECT * FROM products ORDER BY ratings DESC LIMIT ?`,
      [Number(limit)],
    );
    return rows as Product[];
  }

  // --- GET DRAFT PRODUCTS ----
  async getDraftProducts({ limit = 30, page = 1 }: GetProductsDto) {
    const offset = (page - 1) * limit;

    const [rows]: [RowDataPacket[], any] = await this.DatabaseService.getPool().query(
      `SELECT * FROM products WHERE status = 'draft' LIMIT ? OFFSET ?`,
      [Number(limit), Number(offset)],
    );

    const [count]: [RowDataPacket[], any] = await this.DatabaseService.getPool().query(
      `SELECT COUNT(*) as total FROM products WHERE status = 'draft'`,
    );

    return {
      data: rows as Product[],
      ...paginate(count[0].total, page, limit, rows.length, `/draft-products?limit=${limit}`),
    };
  }

  // --- GET PRODUCTS STOCK (low quantity) ---
  async getProductsStock({ limit = 30, page = 1 }: GetProductsDto) {
    const offset = (page - 1) * limit;

    const [rows]: [RowDataPacket[], any] = await this.DatabaseService.getPool().query(
      `SELECT * FROM products WHERE quantity <= 9 LIMIT ? OFFSET ?`,
      [Number(limit), Number(offset)],
    );

    const [count]: [RowDataPacket[], any] = await this.DatabaseService.getPool().query(
      `SELECT COUNT(*) as total FROM products WHERE quantity <= 9`,
    );

    return {
      data: rows as Product[],
      ...paginate(count[0].total, page, limit, rows.length, `/products-stock?limit=${limit}`),
    };
  }

  // --- UPDATE PRODUCT ---
  // --- UPDATE PRODUCT ---
  // --- UPDATE PRODUCT ---
  async update(id: number, updateProductDto: UpdateProductDto): Promise<Product> {
    const fieldsToUpdate: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(updateProductDto)) {
      // 🔒 1. Ignorer les champs non définis ou null
      if (value === null || value === undefined) continue;

      // 🔧 2. Sérialiser uniquement les objets/arrays
      if (typeof value === 'object' && !(value instanceof Date)) {
        fieldsToUpdate.push(`${key} = ?`);
        params.push(JSON.stringify(value));
      } else {
        fieldsToUpdate.push(`${key} = ?`);
        params.push(value);
      }
    }

    // 🔁 3. Exécuter la requête seulement s’il y a quelque chose à mettre à jour
    if (fieldsToUpdate.length > 0) {
      fieldsToUpdate.push('updated_at = NOW()');
      params.push(id);

      await this.DatabaseService.getPool().query(
        `UPDATE products SET ${fieldsToUpdate.join(', ')} WHERE id = ?`,
        params,
      );
    }

    // 🔙 4. Retourner le produit mis à jour
    return this.getProductById(id);
  }



  // --- REMOVE PRODUCT ---
  async remove(id: number): Promise<string> {
    await this.DatabaseService.getPool().query(`DELETE FROM products WHERE id = ?`, [id]);
    return `This action removes product #${id}`;
  }

  // ----GETPRODUCTBUYSEARCH ---
  async findFilteredProducts(
    countryId?: number,
    categoryId?: number,
    corridorId?: number,
    minPrice?: number,
    maxPrice?: number,
    search?: string,
  ) {
    let query = `
      SELECT DISTINCT p.*
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN countries co ON p.country_id = co.id
      LEFT JOIN corridors_produits cp ON p.id = cp.product_id
      LEFT JOIN corridors cor ON cp.corridor_id = cor.id
      WHERE 1 = 1
    `;

    const values: any[] = [];

    if (countryId) {
      query += ' AND p.country_id = ?';
      values.push(countryId);
    }

    if (categoryId) {
      query += ' AND p.category_id = ?';
      values.push(categoryId);
    }

    if (corridorId) {
      query += ' AND cor.id = ?';
      values.push(corridorId);
    }

    if (minPrice) {
      query += ' AND p.price >= ?';
      values.push(minPrice);
    }

    if (maxPrice) {
      query += ' AND p.price <= ?';
      values.push(maxPrice);
    }

    if (search) {
      query += ' AND (p.name LIKE ? OR p.description LIKE ?)';
      values.push(`%${search}%`, `%${search}%`);
    }

    const [rows]: any = await this.DatabaseService.getPool().query(query, values);
    return rows;
  }





  async getProductsByCorridor(query: GetProductsByCorridorDto) {
    console.log('Query reçue :', query);
    const {
      corridor_id,
      countries_id,
      categories_id,
      sous_categories_id,
      sub_categories_id,
      search,
      is_origin,
      limit = 20,
      offset = 0,
      orderBy = 'created_at',
      sortedBy = 'desc',
    } = query;

    const pool = this.DatabaseService.getPool();
    const where: string[] = [];
    const values: any[] = [];

    // 🔹 Filtre corridor
    if (corridor_id) {
      where.push(`pc.corridor_id = ?`);
      values.push(corridor_id);
    }

    // 🔹 Filtre pays
    if (countries_id) {
      where.push(`p.countries_id = ?`);
      values.push(countries_id);
    }
    // 🔹 Filtre is_origin
    if (is_origin) {
      where.push(`p.is_origin = ?`);
      values.push(true);
    }
    // 🔹 Filtre statut "publish"
    where.push(`p.status = ?`);
    values.push('publish');
    // 🔹 Filtre catégories / sous-catégories / sous-sous-catégories
    if (categories_id || sous_categories_id || sub_categories_id) {
      const subWhere: string[] = [];
      const subValues: any[] = [];

      if (categories_id) {
        subWhere.push(`categories_id = ?`);
        subValues.push(categories_id);
      }

      if (sous_categories_id) {
        subWhere.push(`sous_categories_id = ?`);
        subValues.push(sous_categories_id);
      }

      if (sub_categories_id) {
        subWhere.push(`sub_categories_id = ?`);
        subValues.push(sub_categories_id);
      }

      const [linkedProducts] = await pool.query(
        `SELECT DISTINCT product_id FROM product_categories WHERE ${subWhere.join(' AND ')}`,
        subValues
      );

      const productIds = (linkedProducts as any[]).map((row) => row.product_id);

      if (productIds.length > 0) {
        where.push(`p.id IN (${productIds.map(() => '?').join(',')})`);
        values.push(...productIds);
      } else {
        return {
          data: [],
          total: 0,
          limit,
          offset,
        };
      }
    }

    // 🔹 Filtre recherche textuelle
    if (search) {
      where.push(`p.name LIKE ?`);
      values.push(`%${search}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const allowedOrderFields = ['created_at', 'name', 'price', 'updated_at'];
    const orderBySafe = allowedOrderFields.includes(orderBy) ? orderBy : 'created_at';
    const sortedBySafe = sortedBy?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 🔹 Total des résultats
    const countSql = `
    SELECT COUNT(DISTINCT p.id) AS total
    FROM products p
    LEFT JOIN corridors_produits pc ON p.id = pc.produit_id
    ${whereSql}
  `;

    const [countRows]: any = await pool.query(countSql, values);
    const total = countRows[0]?.total ?? 0;

    // 🔹 Récupération des produits
    const dataSql = `
    SELECT DISTINCT p.*, s.id AS shop_id, s.slug AS shop_slug, s.name AS shop_name
    FROM products p
    LEFT JOIN corridors_produits pc ON p.id = pc.produit_id
    LEFT JOIN shops s ON p.shop_id = s.id
    ${whereSql}
    ORDER BY p.${orderBySafe} ${sortedBySafe}
    LIMIT ? OFFSET ?
  `;

    const [rows]: any = await pool.query(dataSql, [...values, Number(limit), Number(offset)]);

    return {
      data: rows.map((row: any) => ({
        ...row,
        shop: {
          id: row.shop_id,
          slug: row.shop_slug,
          name: row.shop_name,
        },
      })),
      total,
      limit,
      offset,
    };
  }













}
