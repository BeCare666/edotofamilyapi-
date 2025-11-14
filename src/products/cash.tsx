{ /**  async create(createProductDto: CreateProductDto & { digital_file?: any; video?: any; gallery?: any; image?: any }): Promise<Product> {
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
      video,
      digital_file,
      countries_id // ← AJOUTÉ ICI
    } = createProductDto;

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
      console.log('Inserted image:', imageJson);
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
      console.log('Inserted gallery:', galleryJson);
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
      console.log('Inserted video:', videoJson);
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
      console.log('Inserted digital_file:', digitalFileJson);
    }

    // --- Slug ---
    const finalSlug = slug && slug.trim() !== '' ? slug : this.formatSlug(name);
    const parsedPrice = price ? Number(price) : null;
    const parsedSalePrice = sale_price ? Number(sale_price) : null;

    // --- INSERT PRODUCT ---
    console.log('Inserting product with:', {
      owner_id,
      name,
      finalSlug,
      description,
      type_id,
      parsedPrice,
      shop_id,
      parsedSalePrice,
      language,
      min_price,
      max_price,
      sku,
      preview_url,
      quantity,
      in_stock,
      is_taxable,
      shipping_class_id,
      status,
      product_type,
      unit,
      height,
      width,
      length,
      imageJson,
      galleryJson,
      videoJson,
      digitalFileJson,
      author_id,
      manufacturer_id,
      is_digital,
      is_external,
      external_product_url,
      external_product_button_text,
    });

    const [product]: [OkPacket, any] = await this.DatabaseService.query<OkPacket>(
      `INSERT INTO products
     (owner_id, name, slug, description, type_id, price, shop_id, sale_price, language, min_price, max_price, sku,
      preview_url, quantity, in_stock, is_taxable, shipping_class_id, status, product_type, unit, height, width, length,
      image, gallery, video, digital_file, author_id, manufacturer_id, is_digital, is_external, external_product_url, external_product_button_text, countries_id,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
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
        digitalFileJson,
        author_id ?? null,
        manufacturer_id ?? null,
        is_digital ? 1 : 0,
        is_external ? 1 : 0,
        external_product_url ?? null,
        external_product_button_text ?? null,
        countries_id ?? null // ← AJOUTÉ ICI
      ]
    );

    console.log('Created product ID:', product.insertId);

    return this.getProductById(product.insertId);
  }**/}