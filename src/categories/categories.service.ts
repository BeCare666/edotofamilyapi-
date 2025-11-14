import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { GetCategoriesDto } from './dto/get-categories.dto';
import { paginate } from 'src/common/pagination/paginate';
import { readFileSync } from 'fs';
import { join } from 'path';
export interface Category {
  id: number;
  name: string;
  slug: string;
  language: string;
  parent: any;
  type_id?: number | null;
  icon?: string | null;
  details?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  type_name?: string | null;
}

@Injectable()
export class CategoriesService {
  private categories: Category[]

  constructor() {
    // D'abord on construit le chemin relatif à __dirname
    let filePath = join(__dirname, '..', 'db', 'pixer', 'edotofamily_categories_full.json');

    try {
      // On tente d'ouvrir la version build (dist/)
      let raw = readFileSync(filePath, 'utf8');
      const categoriesData = JSON.parse(raw);

      this.categories = categoriesData.categories.map((c: any) => ({
        ...c,
        type_id: null,
        icon: c.icon ?? null,
        details: null,
        created_at: null,
        updated_at: null,
        type_name: null,
      }));
    } catch (err) {
      // Si on est en dev (src/), on cherche dans src/db/
      filePath = join(process.cwd(), 'src', 'db', 'edotofamily_categories_full.json');
      const raw = readFileSync(filePath, 'utf8');
      const categoriesData = JSON.parse(raw);

      this.categories = categoriesData.categories.map((c: any) => ({
        ...c,
        type_id: null,
        icon: c.icon ?? null,
        details: null,
        created_at: null,
        updated_at: null,
        type_name: null,
      }));
    }
  }

  async create(dto: CreateCategoryDto) {
    const newId = this.categories.length
      ? Math.max(...this.categories.map(c => c.id)) + 1
      : 1;

    const newCategory: Category = {
      id: newId,
      name: dto.name,
      slug: dto.slug,
      type_id: dto.type_id ?? null,
      icon: dto.icon || null,
      details: dto.details || null,
      language: dto.language || 'fr',
      parent: null,
      created_at: new Date().toISOString(),
      updated_at: null,
      type_name: null,
    };

    this.categories.push(newCategory);
    return newCategory;
  }

  async getCategories({ limit = 30, page = 1, search }: GetCategoriesDto) {
    const numericLimit = Number(limit);
    const numericPage = Number(page);

    let filtered = [...this.categories];

    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        c =>
          c.name.toLowerCase().includes(s) ||
          c.slug.toLowerCase().includes(s),
      );
    }

    filtered.sort((a, b) => {
      if (a.created_at && b.created_at) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return b.id - a.id;
    });

    const total = filtered.length;
    const offset = (numericPage - 1) * numericLimit;
    const pagedData = filtered.slice(offset, offset + numericLimit);

    const url = `/categories?search=${search || ''}&limit=${limit}`;
    return {
      data: pagedData,
      ...paginate(total, numericPage, numericLimit, pagedData.length, url),
    };
  }

  async getCategory(param: string, language: string) {
    return this.categories.find(
      c =>
        c.id === Number(param) ||
        c.slug.toLowerCase() === param.toLowerCase(),
    );
  }

  async update(id: number, dto: UpdateCategoryDto) {
    const index = this.categories.findIndex(c => c.id === id);
    if (index === -1) return null;

    this.categories[index] = {
      ...this.categories[index],
      name: dto.name,
      slug: dto.slug,
      type_id: dto.type_id ?? null,
      icon: dto.icon || null,
      details: dto.details || null,
      updated_at: new Date().toISOString(),
    };

    return this.categories[index];
  }

  async remove(id: number) {
    const index = this.categories.findIndex(c => c.id === id);
    if (index === -1) return null;

    const deleted = this.categories[index];
    this.categories.splice(index, 1);
    return deleted;
  }

  async createMany(categories: CreateCategoryDto[]) {
    const results: Category[] = [];

    for (const dto of categories) {
      if (!dto.name || !dto.slug) {
        console.warn('Catégorie invalide ignorée :', dto);
        continue;
      }

      const newId = this.categories.length
        ? Math.max(...this.categories.map(c => c.id)) + 1
        : 1;

      const newCategory: Category = {
        id: newId,
        name: dto.name,
        slug: dto.slug,
        type_id: dto.type_id ?? null,
        icon: dto.icon || null,
        details: dto.details || null,
        language: dto.language || 'fr',
        parent: null,
        created_at: new Date().toISOString(),
        updated_at: null,
        type_name: null,
      };

      this.categories.push(newCategory);
      results.push(newCategory);
    }

    return results;
  }
}
