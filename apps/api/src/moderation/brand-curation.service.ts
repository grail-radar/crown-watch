import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BrandStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Approving what we say about a Brand.
 *
 * The Annotation is the one honest sentence about a Brand, unflattering ones
 * included, and `CONTEXT.md` §2 makes it the differentiator: a much larger
 * competitor tracks roughly ten times as many Brands with better alerting and
 * cannot say whether any of them is worth your money.
 *
 * That only holds while **`curated` means a person read the sentence and
 * agreed**. So promotion happens here and nowhere else — no poll, no
 * enrichment pass, no import may set it. When drafting arrives
 * ([#30](https://github.com/grail-radar/crown-watch/issues/30)) it will write
 * `annotation` on a Brand that stays `listed`, and a draft nobody approved is
 * shown to nobody.
 *
 * Nothing about an Annotation is purchasable, in any form (ADR-0004). There is
 * deliberately no "sponsored", no "featured", and no way to pay for the state.
 */
/**
 * An Annotation is "the one honest sentence" (CONTEXT.md §9), and the page
 * renders it at display size. The cap is generous enough for a real sentence
 * and small enough that nobody pastes a review into it.
 */
const MAX_ANNOTATION = 400;

@Injectable()
export class BrandCurationService {
  private readonly logger = new Logger(BrandCurationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an approved Annotation and curate the Brand.
   *
   * The text is stored as written apart from surrounding whitespace. There is
   * no house style, no softening and nothing appended: an Annotation that says
   * the lume is poor has to say the lume is poor, or the whole exercise is
   * marketing.
   */
  async annotate(slug: string, annotation: string) {
    const text = annotation?.trim() ?? '';
    if (!text) {
      // Curated with nothing to show would be a badge with no judgement behind
      // it, which is exactly what `verified` used to be.
      throw new BadRequestException(
        'An Annotation is required to curate a Brand — curated with nothing to say is a badge, not a judgement.',
      );
    }
    if (text.length > MAX_ANNOTATION) {
      // Refused rather than truncated: cutting somebody's judgement mid-clause
      // is its own kind of misrepresentation.
      throw new BadRequestException(
        `An Annotation is one sentence — ${text.length} characters is past the ${MAX_ANNOTATION} limit.`,
      );
    }

    const brand = await this.prisma.brand.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!brand) throw new NotFoundException(`Brand not found: ${slug}`);

    const updated = await this.prisma.brand.update({
      where: { id: brand.id },
      data: {
        annotation: text,
        annotationApprovedAt: new Date(),
        status: BrandStatus.curated,
      },
      select: {
        slug: true,
        name: true,
        status: true,
        annotation: true,
        annotationApprovedAt: true,
      },
    });

    this.logger.log(`Curated ${updated.slug}`);
    return updated;
  }

  /**
   * Withdraw approval and return the Brand to Listed.
   *
   * The Brand stays fully visible and fully alerted on — Listed is not a
   * penalty box. What goes away is the claim that somebody stands behind a
   * judgement of it.
   *
   * **The sentence itself is kept, as a draft.** It is somebody's writing, the
   * API withholds it the moment the Brand is no longer Curated, and having it
   * to hand is the difference between revising a take and starting again. To
   * erase the text as well, approve a replacement — or, if it must genuinely
   * be gone, clear the column directly and deliberately.
   */
  async withdraw(slug: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!brand) throw new NotFoundException(`Brand not found: ${slug}`);

    const updated = await this.prisma.brand.update({
      where: { id: brand.id },
      data: {
        annotationApprovedAt: null,
        status: BrandStatus.listed,
      },
      select: {
        slug: true,
        name: true,
        status: true,
        annotation: true,
        annotationApprovedAt: true,
      },
    });

    this.logger.log(`Returned ${updated.slug} to listed`);
    return updated;
  }
}
