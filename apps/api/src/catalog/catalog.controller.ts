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

  /** Every indexable Watch, for the sitemap. Accessories are not included. */
  @Get('watches')
  watches(@Query('take') take?: string) {
    return this.catalog.listWatches(this.int(take, 200));
  }

  @Get('watches/:brandSlug/:watchSlug')
  watch(
    @Param('brandSlug') brandSlug: string,
    @Param('watchSlug') watchSlug: string,
  ) {
    return this.catalog.getWatch(brandSlug, watchSlug);
  }

  @Get('drops')
  drops(
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('type') type?: string,
  ) {
    return this.catalog.listPublishedDrops(
      this.int(take, 50),
      this.int(skip, 0),
      type,
    );
  }

  @Get('drops/:id')
  drop(@Param('id') id: string) {
    return this.catalog.getPublishedDrop(id);
  }

  /**
   * The Watch a Drop is about, so a Drop URL can redirect to it — null when it
   * is about none. A distinct path from `drops/:id`, so the two cannot shadow
   * each other.
   */
  @Get('drops/:id/watch')
  dropWatch(@Param('id') id: string) {
    return this.catalog.getDropWatch(id);
  }

  private int(value: string | undefined, fallback: number): number {
    const n = value ? parseInt(value, 10) : NaN;
    return Number.isNaN(n) ? fallback : n;
  }
}
