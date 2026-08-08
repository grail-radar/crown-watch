/**
 * The controller is a thin router, and these tests keep it that way. They exist
 * for the query parameters an operator reaches for during an incident, where a
 * silently-ignored flag is worse than an error: `force` waives a backoff window
 * and `release` publishes a poll that was refused.
 */
import { BadRequestException } from '@nestjs/common';
import { SiteWatchController } from './site-watch.controller';
import { SiteWatchService } from './site-watch.service';

describe('SiteWatchController', () => {
  let pollSource: jest.Mock;
  let pollAll: jest.Mock;
  let controller: SiteWatchController;

  beforeEach(() => {
    pollSource = jest.fn().mockResolvedValue({ status: 'ok' });
    pollAll = jest.fn().mockResolvedValue({ sourceCount: 0 });
    controller = new SiteWatchController({
      pollSource,
      pollAll,
    } as unknown as SiteWatchService);
  });

  it('polls every source when none is named', () => {
    controller.poll();

    expect(pollAll).toHaveBeenCalled();
    expect(pollSource).not.toHaveBeenCalled();
  });

  it('polls one source, waiving nothing by default', () => {
    controller.poll('src_1');

    expect(pollSource).toHaveBeenCalledWith('src_1', {
      force: false,
      release: false,
    });
  });

  it('passes force and release through when asked for', () => {
    controller.poll('src_1', 'true', 'true');

    expect(pollSource).toHaveBeenCalledWith('src_1', {
      force: true,
      release: true,
    });
  });

  it('treats anything but the literal true as not asking', () => {
    controller.poll('src_1', '1', 'yes');

    expect(pollSource).toHaveBeenCalledWith('src_1', {
      force: false,
      release: false,
    });
  });

  it('refuses to release a whole run', () => {
    // An operator who believes they have released a held store, and has not,
    // should learn it here — not from a channel that stayed silent.
    expect(() => controller.poll(undefined, undefined, 'true')).toThrow(
      BadRequestException,
    );
    expect(pollAll).not.toHaveBeenCalled();
  });
});
