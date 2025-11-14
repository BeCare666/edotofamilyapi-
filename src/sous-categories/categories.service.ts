import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { GetCategoriesDto } from './dto/get-categories.dto';
import { paginate } from 'src/common/pagination/paginate';
import categoriesData from '@db/edotofamily_categories_full.json';
import { readFileSync } from 'fs';
import { join } from 'path';
// Interface pour typer correctement les données JSON
export interface SousCategorie {
  id: number;
  name: string;
  slug: string;
  language: string;
  parent: any;
  categories_id: number;
  icon?: string | null;
  details?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  category_name?: string | null;
}

@Injectable()
export class SousCategoriesService {
  private sousCategories: SousCategorie[];

  constructor() {
    let filePath = join(__dirname, '..', 'db', 'edotofamily_categories_full.json');

    try {
      // Essai avec dist/ (prod)
      const raw = readFileSync(filePath, 'utf8');
      const categoriesData = JSON.parse(raw);

      this.sousCategories = (categoriesData.sous_categories || []).map((sc: any) => ({
        ...sc,
        icon: sc.icon ?? null,
        details: sc.details ?? null,
        created_at: sc.created_at ?? null,
        updated_at: sc.updated_at ?? null,
        category_name:
          (categoriesData.categories || []).find(
            (cat: any) => cat.id === sc.categories_id,
          )?.name || null,
      }));
    } catch (err) {
      // Fallback sur src/ (dev)
      filePath = join(process.cwd(), 'src', 'db', 'pixer', 'edotofamily_categories_full.json');
      const raw = readFileSync(filePath, 'utf8');
      const categoriesData = JSON.parse(raw);

      this.sousCategories = (categoriesData.sous_categories || []).map((sc: any) => ({
        ...sc,
        icon: sc.icon ?? null,
        details: sc.details ?? null,
        created_at: sc.created_at ?? null,
        updated_at: sc.updated_at ?? null,
        category_name:
          (categoriesData.categories || []).find(
            (cat: any) => cat.id === sc.categories_id,
          )?.name || null,
      }));
    }
  }

  async create(dto: CreateCategoryDto) {
    const newSousCat: SousCategorie = {
      id: this.sousCategories.length
        ? Math.max(...this.sousCategories.map((c) => c.id)) + 1
        : 1,
      name: dto.name,
      slug: dto.slug,
      language: dto.language ?? 'fr',
      parent: null,
      categories_id: dto.categories_id ?? null,
      icon: dto.icon ?? null,
      details: dto.details ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      category_name:
        (categoriesData as any).categories.find(
          (cat: any) => cat.id === dto.categories_id,
        )?.name || null,
    };
    this.sousCategories.push(newSousCat);
    return newSousCat;
  }

  async createMany(dtos: CreateCategoryDto[]) {
    return Promise.all(dtos.map((dto) => this.create(dto)));
  }

  async getCategories({ limit = 200, page = 1, search }: GetCategoriesDto) {
    const numericLimit = Number(limit);
    const numericPage = Number(page);

    let filtered = [...this.sousCategories];

    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(s) ||
          c.slug.toLowerCase().includes(s),
      );
    }

    filtered.sort((a, b) => {
      const dateA = a.created_at || '';
      const dateB = b.created_at || '';
      return dateA < dateB ? 1 : dateA > dateB ? -1 : 0;
    });

    const total = filtered.length;
    const start = (numericPage - 1) * numericLimit;
    const data = filtered.slice(start, start + numericLimit);

    const url = `/sous_categories?search=${search || ''}&limit=${limit}`;

    return {
      data,
      ...paginate(total, numericPage, numericLimit, data.length, url),
    };
  }

  async findByCategoryId(categoryId: number) {
    return this.sousCategories.filter(
      (sc) => sc.categories_id === categoryId,
    );
  }

  async getCategory(param: string, language: string) {
    return this.sousCategories.find(
      (c) => c.id === Number(param) || c.slug === param,
    );
  }

  async update(id: number, dto: UpdateCategoryDto) {
    const index = this.sousCategories.findIndex((c) => c.id === id);
    if (index === -1) return null;

    this.sousCategories[index] = {
      ...this.sousCategories[index],
      ...dto,
      updated_at: new Date().toISOString(),
      category_name:
        (categoriesData as any).categories.find(
          (cat: any) => cat.id === dto.categories_id,
        )?.name || this.sousCategories[index].category_name,
    };
    return this.sousCategories[index];
  }

  async remove(id: number) {
    const index = this.sousCategories.findIndex((c) => c.id === id);
    if (index === -1) return null;

    const deleted = this.sousCategories.splice(index, 1)[0];
    return deleted;
  }
}
