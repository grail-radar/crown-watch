/**
 * The unattended trigger. No database and no network: this is about whether the
 * job is registered, whether a bad run can take the process down, and whether a
 * slow run can pile up on itself.
 */
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SiteWatchScheduler } from './site-watch.scheduler';
import { SiteWatchRunResult, SiteWatchService } from './site-watch.service';

const emptyRun = (): SiteWatchRunResult => ({
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  sourceCount: 0,
  totalDropsCreated: 0,
  totalBroadcastsSent: 0,
  failureCount: 0,
  skippedCount: 0,
  sources: [],
});

/** Stands in for the real service; records calls and can be made slow or angry. */
class StubSiteWatch {
  calls = 0;
  behaviour: 'ok' | 'throw' | 'hang' = 'ok';
  release: (() => void) | null = null;

  async pollAll(): Promise<SiteWatchRunResult> {
    this.calls += 1;
    if (this.behaviour === 'throw') throw new Error('everything is on fire');
    if (this.behaviour === 'hang') {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
    return emptyRun();
  }
}

function build(config: Record<string, unknown>) {
  const siteWatch = new StubSiteWatch();
  const registry = new SchedulerRegistry();
  const scheduler = new SiteWatchScheduler(
    siteWatch as unknown as SiteWatchService,
    new ConfigService({ siteWatch: config }),
    registry,
  );
  return { siteWatch, registry, scheduler };
}

/** Reach the private runner the cron tick calls. */
const tick = (scheduler: SiteWatchScheduler): Promise<void> =>
  (scheduler as unknown as { run(trigger: string): Promise<void> }).run('test');

describe('SiteWatchScheduler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers a recurring job so the poll runs with nobody at a keyboard', () => {
    const { scheduler, registry } = build({ pollCron: '0 5 * * * *' });

    scheduler.onModuleInit();

    const job = registry.getCronJob('site-watch-poll');
    expect(job).toBeDefined();
    expect(job.nextDate()).toBeDefined();
    job.stop();
  });

  it('does not poll on boot unless asked', () => {
    const { scheduler, siteWatch, registry } = build({ pollCron: '0 5 * * * *' });

    scheduler.onModuleInit();

    expect(siteWatch.calls).toBe(0);
    registry.getCronJob('site-watch-poll').stop();
  });

  it('polls immediately on boot when configured to', async () => {
    const { scheduler, siteWatch, registry } = build({
      pollCron: '0 5 * * * *',
      pollOnBoot: true,
    });

    scheduler.onModuleInit();
    await new Promise((r) => setImmediate(r));

    expect(siteWatch.calls).toBe(1);
    registry.getCronJob('site-watch-poll').stop();
  });

  it('survives a run that throws, so the next tick still happens', async () => {
    // pollAll isolates per-source failures itself; reaching the catch means
    // something broader broke, and it must not take the scheduler down.
    const { scheduler, siteWatch } = build({ pollCron: '0 5 * * * *' });
    siteWatch.behaviour = 'throw';

    await expect(tick(scheduler)).resolves.toBeUndefined();

    siteWatch.behaviour = 'ok';
    await tick(scheduler);
    expect(siteWatch.calls).toBe(2);
  });

  it('does not start a second run while one is still in flight', async () => {
    // Hourly ticks and a slow run would otherwise stack up on a cold host.
    const { scheduler, siteWatch } = build({ pollCron: '0 5 * * * *' });
    siteWatch.behaviour = 'hang';

    const first = tick(scheduler);
    await new Promise((r) => setImmediate(r));
    await tick(scheduler); // overlapping tick — must be refused

    expect(siteWatch.calls).toBe(1);

    siteWatch.release?.();
    await first;

    // Once the slow run finishes the next tick proceeds normally.
    siteWatch.behaviour = 'ok';
    await tick(scheduler);
    expect(siteWatch.calls).toBe(2);
  });
});
