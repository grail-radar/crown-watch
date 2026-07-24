import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';

/** Public read API consumed by the Next.js site. */
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('brands')
  brands(@Query('take') take?: string, @Query('skip') skip?: string) {
    return this.catalog.listBrands(this.int(take, 60), this.int(skip, 0));
  }

  @Get('brands/:slug')
  brand(@Param('slug') slug: string) {
    return this.catalog.getBrandBySlug(slug);
  }

  @Get('drops')
  drops(@Query('take') take?: string) {
    return this.catalog.listPublishedDrops(this.int(take, 50));
  }

  private int(value: string | undefined, fallback: number): number {
    const n = value ? parseInt(value, 10) : NaN;
    return Number.isNaN(n) ? fallback : n;
  }
}
