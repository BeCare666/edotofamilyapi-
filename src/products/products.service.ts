import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    // Slug unique : la fiche produit et l'édition admin se chargent par slug
    const baseSlug = slug && slug.trim() !== '' ? slug.trim() : this.formatSlug(name);
    let finalSlug = baseSlug;
    for (let i = 2; ; i++) {
      const [taken]: any = await this.DatabaseService.getPool().query('SELECT id FROM products WHERE slug = ? LIMIT 1', [finalSlug]);
      if (!taken.length) break;
      finalSlug = `${baseSlug}-${i}`;
    }
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



  // --- GET ALL PRODUCTS (liste admin) ---
  // Filtres réels : nom/SKU, statut, catégorie et étiquette (tables de liaison), état du stock
  // (rupture < 1, faible 1-9, disponible ≥ 10 — mêmes seuils que les alertes stock), promo,
  // prix payé (promo sinon prix), origine locale, boutique. Tri sécurisé (liste blanche).
  private buildAdminProductFilters(query: Record<string, any>) {
    const q: any = query;
    let name = q.name;
    let status = q.status;
    if (q.search) {
      String(q.search).split(';').forEach((part: string) => {
        const [key, value] = part.split(':');
        if (key && value) {
          if (key === 'name') name = value;
          if (key === 'status') status = value;
        }
      });
    }
    const where: string[] = [];
    const params: any[] = [];
    const effectivePrice = 'COALESCE(p.sale_price, p.price)';
    if (q.shop_id) { where.push('p.shop_id = ?'); params.push(Number(q.shop_id)); }
    if (q.language) { where.push('(p.language = ? OR p.language IS NULL)'); params.push(q.language); }
    if (name && String(name).trim() !== '') {
      // Recherche insensible aux majuscules et aux accents (colonnes en utf8mb4_bin)
      const term = `%${String(name).trim()}%`;
      where.push('(p.name COLLATE utf8mb4_general_ci LIKE ? OR p.sku COLLATE utf8mb4_general_ci LIKE ?)');
      params.push(term, term);
    }
    if (status) {
      const list = String(status).split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) { where.push(`p.status IN (${list.map(() => '?').join(', ')})`); params.push(...list); }
    }
    if (q.product_type) { where.push('p.product_type = ?'); params.push(q.product_type); }
    const categoryId = Number(q.categories);
    if (q.categories && Number.isInteger(categoryId) && categoryId > 0) {
      where.push('p.id IN (SELECT product_id FROM product_categories WHERE categories_id = ?)');
      params.push(categoryId);
    }
    const tagId = Number(q.tag);
    if (q.tag && Number.isInteger(tagId) && tagId > 0) {
      where.push('p.id IN (SELECT product_id FROM product_tags WHERE tag_id = ?)');
      params.push(tagId);
    }
    if (q.stock === 'out') where.push('COALESCE(p.quantity, 0) < 1');
    if (q.stock === 'low') where.push('p.quantity BETWEEN 1 AND 9');
    if (q.stock === 'ok') where.push('p.quantity >= 10');
    if (String(q.on_sale) === 'true') where.push('p.sale_price IS NOT NULL AND p.sale_price < p.price');
    if (String(q.on_sale) === 'false') where.push('(p.sale_price IS NULL OR p.sale_price >= p.price)');
    if (String(q.is_origin) === 'true' || String(q.is_origin) === '1') where.push('p.is_origin = 1');
    if (String(q.is_origin) === 'false' || String(q.is_origin) === '0') where.push('p.is_origin = 0');
    const min = Number(q.min_price);
    if (q.min_price !== undefined && String(q.min_price) !== '' && Number.isFinite(min)) { where.push(`${effectivePrice} >= ?`); params.push(min); }
    const max = Number(q.max_price);
    if (q.max_price !== undefined && String(q.max_price) !== '' && Number.isFinite(max)) { where.push(`${effectivePrice} <= ?`); params.push(max); }
    return { where, params, effectivePrice };
  }

  async getProducts(query: GetProductsDto): Promise<ProductPaginator> {
    const { orderBy = 'created_at', sortedBy = 'desc' } = query;
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const page = Math.max(1, Number(query.page) || 1);
    const offset = (page - 1) * limit;
    const pool = this.DatabaseService.getPool();
    const { where, params, effectivePrice } = this.buildAdminProductFilters(query as any);
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const orderColumns: Record<string, string> = {
      created_at: 'p.created_at',
      updated_at: 'p.updated_at',
      name: 'p.name',
      price: effectivePrice,
      quantity: 'p.quantity',
    };
    const orderSql = orderColumns[orderBy] ?? 'p.created_at';
    const sortedBySafe = String(sortedBy).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [[countRows], [rows]]: any = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM products p ${whereSql}`, params),
      pool.query(
        `SELECT p.*, s.id AS shop_id, s.slug AS shop_slug, s.name AS shop_name,
                (SELECT COUNT(*) FROM order_children oc WHERE oc.product_id = p.id) AS order_lines
         FROM products p
         LEFT JOIN shops s ON p.shop_id = s.id
         ${whereSql}
         ORDER BY ${orderSql} ${sortedBySafe}, p.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    const last_page = Math.max(1, Math.ceil(total / limit));
    const baseUrl = `/products?limit=${limit}`;

    return {
      data: rows.map((row: any) => ({
        ...row,
        order_lines: Number(row.order_lines ?? 0),
        shop: {
          id: row.shop_id,
          slug: row.shop_slug,
          name: row.shop_name,
        },
      })) as Product[],
      count: total,
      total,
      current_page: page,
      firstItem: total ? offset + 1 : 0,
      lastItem: offset + rows.length,
      per_page: limit,
      last_page,
      first_page_url: `${baseUrl}&page=1`,
      last_page_url: `${baseUrl}&page=${last_page}`,
      next_page_url: page < last_page ? `${baseUrl}&page=${page + 1}` : null,
      prev_page_url: page > 1 ? `${baseUrl}&page=${page - 1}` : null,
    } as any;
  }

  // Compteurs réels pour les filtres de la liste admin (seules les valeurs présentes en base)
  async getAdminProductFacets(shopId?: number) {
    const pool = this.DatabaseService.getPool();
    const shopWhere = shopId ? 'WHERE p.shop_id = ?' : '';
    const shopParams = shopId ? [shopId] : [];
    const [[statusRows], [catRows], [tagRows], [summaryRows]]: any = await Promise.all([
      pool.query(`SELECT p.status, COUNT(*) AS n FROM products p ${shopWhere} GROUP BY p.status ORDER BY n DESC`, shopParams),
      pool.query(
        `SELECT pc.categories_id AS id, COUNT(DISTINCT pc.product_id) AS n
         FROM product_categories pc JOIN products p ON p.id = pc.product_id ${shopWhere}
         GROUP BY pc.categories_id ORDER BY n DESC`, shopParams),
      pool.query(
        `SELECT t.id, t.name, COUNT(DISTINCT pt.product_id) AS n
         FROM product_tags pt JOIN tags t ON t.id = pt.tag_id JOIN products p ON p.id = pt.product_id ${shopWhere}
         GROUP BY t.id, t.name ORDER BY n DESC, t.name`, shopParams),
      pool.query(
        `SELECT COUNT(*) AS total,
                SUM(COALESCE(p.quantity, 0) < 1) AS out_of_stock,
                SUM(p.quantity BETWEEN 1 AND 9) AS low_stock,
                SUM(p.quantity >= 10) AS in_stock,
                SUM(p.sale_price IS NOT NULL AND p.sale_price < p.price) AS on_sale,
                SUM(p.is_origin = 1) AS local_origin,
                MIN(COALESCE(p.sale_price, p.price)) AS min_price,
                MAX(COALESCE(p.sale_price, p.price)) AS max_price
         FROM products p ${shopWhere}`, shopParams),
    ]);
    const s = summaryRows[0] ?? {};
    const num = (v: any) => Number(v ?? 0);
    return {
      total: num(s.total),
      statuses: statusRows.map((r: any) => ({ value: r.status, count: num(r.n) })),
      categories: catRows.map((r: any) => ({ id: Number(r.id), count: num(r.n) })),
      tags: tagRows.map((r: any) => ({ id: Number(r.id), name: r.name, count: num(r.n) })),
      stock: { out: num(s.out_of_stock), low: num(s.low_stock), ok: num(s.in_stock) },
      on_sale: num(s.on_sale),
      local_origin: num(s.local_origin),
      price: { min: s.min_price != null ? Number(s.min_price) : null, max: s.max_price != null ? Number(s.max_price) : null },
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
      const pool = this.DatabaseService.getPool();

      // Catégories, étiquettes et type depuis leurs vraies tables (les colonnes JSON
      // products.categories / tags / type sont vides) : le formulaire d'édition s'en sert.
      const [[catRows], [tagRows], [typeRows]]: any = await Promise.all([
        pool.query(
          'SELECT categories_id, sous_categories_id, sub_categories_id FROM product_categories WHERE product_id = ? ORDER BY id',
          [row.id],
        ),
        pool.query(
          'SELECT t.id, t.name, t.slug FROM product_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.product_id = ? ORDER BY t.name',
          [row.id],
        ),
        row.type_id ? pool.query('SELECT id, name, slug FROM types WHERE id = ?', [row.type_id]) : Promise.resolve([[]]),
      ]);
      const byCategory = new Map<number, { categories_id: number; sous_categories_id: number[]; sub_categories_id: number[] }>();
      for (const c of catRows) {
        const key = Number(c.categories_id);
        if (!byCategory.has(key)) byCategory.set(key, { categories_id: key, sous_categories_id: [], sub_categories_id: [] });
        const entry = byCategory.get(key)!;
        if (c.sous_categories_id != null && !entry.sous_categories_id.includes(Number(c.sous_categories_id))) entry.sous_categories_id.push(Number(c.sous_categories_id));
        if (c.sub_categories_id != null && !entry.sub_categories_id.includes(Number(c.sub_categories_id))) entry.sub_categories_id.push(Number(c.sub_categories_id));
      }

      const product: Product = {
        ...row,
        categories: [...byCategory.values()],
        tags: tagRows,
        type: typeRows[0] ?? row.type ?? null,
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
  // Colonnes réelles de la table products que le formulaire peut modifier. Avant, chaque clé reçue
  // devenait une colonne : l'admin envoie « variation_options » (colonne absente) → erreur SQL 500
  // à chaque mise à jour. Les autres clés (variation_options, in_flash_sale, type, shop…) sont ignorées.
  static readonly EDITABLE_COLUMNS = new Set([
    'name', 'slug', 'description', 'type_id', 'price', 'shop_id', 'sale_price', 'language',
    'min_price', 'max_price', 'sku', 'preview_url', 'quantity', 'in_stock', 'is_taxable',
    'shipping_class_id', 'status', 'product_type', 'unit', 'height', 'width', 'length',
    'image', 'video', 'gallery', 'author_id', 'manufacturer_id', 'is_digital', 'is_external',
    'external_product_url', 'external_product_button_text', 'digital_file', 'countries_id', 'is_origin',
  ]);
  // Colonnes qu'un null envoyé explicitement doit vider (ex. retirer le prix promo)
  static readonly CLEARABLE_COLUMNS = new Set(['sale_price', 'video', 'preview_url']);
  static readonly JSON_COLUMNS = new Set(['image', 'video', 'gallery', 'digital_file']);

  async update(id: number, updateProductDto: UpdateProductDto): Promise<Product> {
    const fieldsToUpdate: string[] = [];
    const params: any[] = [];
    const input: any = updateProductDto;

    if (typeof input.slug === 'string' && input.slug.trim() !== '') {
      const [dup]: any = await this.DatabaseService.getPool().query(
        'SELECT id FROM products WHERE slug = ? AND id <> ? LIMIT 1',
        [input.slug.trim(), id],
      );
      if (dup.length) throw new BadRequestException('Ce slug est déjà utilisé par un autre produit.');
      input.slug = input.slug.trim();
    }

    for (const [key, raw] of Object.entries(input)) {
      if (!ProductsService.EDITABLE_COLUMNS.has(key)) continue;
      let value: any = raw === '' && key !== 'description' && key !== 'preview_url' ? null : raw;
      if (value === undefined) continue;
      if (value === null && !ProductsService.CLEARABLE_COLUMNS.has(key)) continue;
      if (typeof value === 'boolean') value = value ? 1 : 0;
      else if (value !== null && typeof value === 'object' && !(value instanceof Date)) value = JSON.stringify(value);
      else if (value !== null && ProductsService.JSON_COLUMNS.has(key)) value = JSON.stringify(value);
      fieldsToUpdate.push(`${key} = ?`);
      params.push(value);
    }

    const pool = this.DatabaseService.getPool();
    if (fieldsToUpdate.length > 0) {
      fieldsToUpdate.push('updated_at = NOW()');
      await pool.query(`UPDATE products SET ${fieldsToUpdate.join(', ')} WHERE id = ?`, [...params, id]);
    }

    // Catégories et étiquettes : tables de liaison (lues par le site et les filtres), jamais réécrites
    // si le formulaire ne les envoie pas. Une liste vide n'efface rien (garde-fou : le formulaire
    // d'édition peut s'afficher avant le chargement des catégories).
    if (Array.isArray(input.categories) && input.categories.length > 0) {
      await this.replaceProductCategories(id, input.categories);
    }
    if (Array.isArray(input.tags)) {
      await this.replaceProductTags(id, input.tags);
    }

    return this.getProductById(id);
  }

  /** Accepte [{ categories_id, sous_categories_id[], sub_categories_id[] }] ou une liste d'ids. */
  private normalizeCategoryRows(categories: any[]) {
    return categories
      .map((c: any) => {
        if (c !== null && typeof c === 'object') {
          const toIds = (v: any) => (Array.isArray(v) ? v : v != null && v !== '' ? [v] : [])
            .map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
          return {
            categories_id: Number(c.categories_id ?? c.id),
            sous: toIds(c.sous_categories_id),
            sub: toIds(c.sub_categories_id),
          };
        }
        return { categories_id: Number(c), sous: [] as number[], sub: [] as number[] };
      })
      .filter((r) => Number.isInteger(r.categories_id) && r.categories_id > 0);
  }

  private async replaceProductCategories(productId: number, categories: any[]) {
    const rows = this.normalizeCategoryRows(categories);
    if (!rows.length) return;
    const pool = this.DatabaseService.getPool();
    const [validSous]: any = await pool.query('SELECT id FROM sous_categories');
    const [validSub]: any = await pool.query('SELECT id FROM sub_categories');
    const sousOk = new Set(validSous.map((r: any) => Number(r.id)));
    const subOk = new Set(validSub.map((r: any) => Number(r.id)));
    const values: any[] = [];
    for (const r of rows) {
      const sous = r.sous.filter((x) => sousOk.has(x));
      const sub = r.sub.filter((x) => subOk.has(x));
      for (const s of sous.length ? sous : [null]) {
        for (const u of sub.length ? sub : [null]) values.push([productId, r.categories_id, s, u]);
      }
    }
    await pool.query('DELETE FROM product_categories WHERE product_id = ?', [productId]);
    await pool.query(
      `INSERT INTO product_categories (product_id, categories_id, sous_categories_id, sub_categories_id) VALUES ${values.map(() => '(?, ?, ?, ?)').join(', ')}`,
      values.flat(),
    );
  }

  private async replaceProductTags(productId: number, tags: any[]) {
    const ids = [...new Set(
      tags.map((t: any) => Number(t !== null && typeof t === 'object' ? t.id : t))
        .filter((n) => Number.isInteger(n) && n > 0),
    )];
    const pool = this.DatabaseService.getPool();
    await pool.query('DELETE FROM product_tags WHERE product_id = ?', [productId]);
    if (ids.length) {
      await pool.query(
        `INSERT INTO product_tags (product_id, tag_id) VALUES ${ids.map(() => '(?, ?)').join(', ')}`,
        ids.flatMap((t) => [productId, t]),
      );
    }
  }

  // --- REMOVE PRODUCT ---
  // Un produit présent dans des commandes n'est pas supprimé (les commandes, retraits et
  // commissions s'y réfèrent) : l'admin le passe en « Non publié ». Sinon, on supprime aussi
  // ses liaisons (catégories, étiquettes, corridors).
  async remove(id: number): Promise<{ success: true; message: string }> {
    const pool = this.DatabaseService.getPool();
    const [used]: any = await pool.query('SELECT COUNT(*) AS n FROM order_children WHERE product_id = ?', [id]);
    const n = Number(used[0]?.n ?? 0);
    if (n > 0) {
      throw new BadRequestException(
        `Suppression impossible : ce produit figure dans ${n} commande${n > 1 ? 's' : ''}. Passez-le en « Non publié » pour le retirer du site.`,
      );
    }
    await pool.query('DELETE FROM product_categories WHERE product_id = ?', [id]);
    await pool.query('DELETE FROM product_tags WHERE product_id = ?', [id]);
    await pool.query('DELETE FROM corridors_produits WHERE produit_id = ?', [id]);
    await pool.query('DELETE FROM products WHERE id = ?', [id]);
    return { success: true, message: 'Produit supprimé.' };
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
      // Recherche insensible aux majuscules et aux accents (colonnes en utf8mb4_bin)
      query += ' AND (p.name COLLATE utf8mb4_general_ci LIKE ? OR p.description COLLATE utf8mb4_general_ci LIKE ?)';
      values.push(`%${search}%`, `%${search}%`);
    }

    const [rows]: any = await this.DatabaseService.getPool().query(query, values);
    return rows;
  }





  // Liste publique des produits (page catégorie). Une seule série de requêtes en parallèle :
  // total et page de résultats (avant : 3 requêtes à la suite, jointure corridors + DISTINCT
  // sur toutes les colonnes même sans filtre corridor). Prix filtré et trié sur le prix payé
  // (prix promo, sinon prix), comme à la commande.
  async getProductsByCorridor(query: GetProductsByCorridorDto) {
    const {
      corridor_id,
      countries_id,
      categories_id,
      sous_categories_id,
      sub_categories_id,
      search,
      is_origin,
      min_price,
      max_price,
      orderBy = 'created_at',
      sortedBy = 'desc',
    } = query;
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = Math.max(0, Number(query.offset) || 0);

    const pool = this.DatabaseService.getPool();
    const where: string[] = ['p.status = ?'];
    const values: any[] = ['publish'];
    const effectivePrice = 'COALESCE(p.sale_price, p.price)';

    if (corridor_id) {
      where.push('p.id IN (SELECT produit_id FROM corridors_produits WHERE corridor_id = ?)');
      values.push(Number(corridor_id));
    }
    if (countries_id) {
      where.push('p.countries_id = ?');
      values.push(Number(countries_id));
    }
    // « true » / « 1 » uniquement (avant, la chaîne « false » activait aussi le filtre)
    if (is_origin === true || String(is_origin) === 'true' || String(is_origin) === '1') {
      where.push('p.is_origin = ?');
      values.push(true);
    }
    if (categories_id || sous_categories_id || sub_categories_id) {
      const sub: string[] = [];
      if (categories_id) { sub.push('categories_id = ?'); values.push(Number(categories_id)); }
      if (sous_categories_id) { sub.push('sous_categories_id = ?'); values.push(Number(sous_categories_id)); }
      if (sub_categories_id) { sub.push('sub_categories_id = ?'); values.push(Number(sub_categories_id)); }
      where.push(`p.id IN (SELECT product_id FROM product_categories WHERE ${sub.join(' AND ')})`);
    }
    if (search && String(search).trim()) {
      // Recherche insensible aux majuscules et aux accents (colonnes en utf8mb4_bin)
      where.push('p.name COLLATE utf8mb4_general_ci LIKE ?');
      values.push(`%${String(search).trim()}%`);
    }
    const min = Number(min_price);
    if (min_price !== undefined && min_price !== null && String(min_price) !== '' && Number.isFinite(min)) {
      where.push(`${effectivePrice} >= ?`);
      values.push(min);
    }
    const max = Number(max_price);
    if (max_price !== undefined && max_price !== null && String(max_price) !== '' && Number.isFinite(max)) {
      where.push(`${effectivePrice} <= ?`);
      values.push(max);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const orderColumns: Record<string, string> = {
      created_at: 'p.created_at',
      updated_at: 'p.updated_at',
      name: 'p.name',
      price: effectivePrice,
    };
    const orderSql = orderColumns[orderBy] ?? 'p.created_at';
    const direction = String(sortedBy).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [[countRows], [rows]]: any = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM products p ${whereSql}`, values),
      pool.query(
        `SELECT p.*, s.id AS shop_id, s.slug AS shop_slug, s.name AS shop_name
         FROM products p
         LEFT JOIN shops s ON p.shop_id = s.id
         ${whereSql}
         ORDER BY ${orderSql} ${direction}, p.id DESC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset],
      ),
    ]);

    return {
      data: rows.map((row: any) => ({
        ...row,
        shop: {
          id: row.shop_id,
          slug: row.shop_slug,
          name: row.shop_name,
        },
      })),
      total: Number(countRows[0]?.total ?? 0),
      limit,
      offset,
    };
  }













}
