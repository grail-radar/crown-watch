import { Injectable, NotFoundException } from '@nestjs/common';
import { ModerationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Public, read-only catalog for the website: the brand directory and the
 * published-drops feed. Only moderation-approved, published drops are ever
 * exposed here (CONTEXT.md §5 — nothing reaches the public feed unmoderated).
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listBrands(take = 60, skip = 0) {
    const safeTake = Math.min(Math.max(take, 1), 200);
    const [total, brands] = await this.prisma.$transaction([
      this.prisma.brand.count(),
      this.prisma.brand.findMany({
        orderBy: { createdAt: 'desc' },
        take: safeTake,
        skip: Math.max(skip, 0),
        select: {
          id: true,
          name: true,
          slug: true,
          country: true,
          website: true,
          status: true,
          createdAt: true,
          _count: { select: { drops: true } },
        },
      }),
    ]);
    return { total, count: brands.length, brands };
  }

  async getBrandBySlug(slug: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        website: true,
        instagramHandle: true,
        country: true,
        foundedYearEst: true,
        status: true,
        createdAt: true,
        drops: {
          where: {
            moderationStatus: ModerationStatus.approved,
            publishedAt: { not: null },
          },
          orderBy: { publishedAt: 'desc' },
          select: {
            id: true,
            title: true,
            type: true,
            priceLow: true,
            priceHigh: true,
            currency: true,
            eventDate: true,
            publishedAt: true,
          },
        },
      },
    });
    if (!brand) throw new NotFoundException(`Brand not found: ${slug}`);
    return brand;
  }

  async listPublishedDrops(take = 50) {
    const safeTake = Math.min(Math.max(take, 1), 200);
    const drops = await this.prisma.drop.findMany({
      where: {
        moderationStatus: ModerationStatus.approved,
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: 'desc' },
      take: safeTake,
      select: {
        id: true,
        title: true,
        type: true,
        priceLow: true,
        priceHigh: true,
        currency: true,
        eventDate: true,
        publishedAt: true,
        brand: { select: { name: true, slug: true } },
      },
    });
    return { count: drops.length, drops };
  }
}
