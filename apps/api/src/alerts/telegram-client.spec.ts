/**
 * Which Bot API call a drop turns into. Pure — the surrounding HTTP client is
 * the I/O seam and is exercised through the capturing double instead.
 */
import { buildSendCall } from './telegram-client';

const CHAT = '@crownwatch_en';

describe('buildSendCall', () => {
  it('posts a photo with the alert as its caption when there is an image', () => {
    const call = buildSendCall({
      chatId: CHAT,
      text: '🆕 New release\n<b>Baltic</b> — Scalegraph',
      imageUrl: 'https://cdn.example/baltic.jpg',
    });

    expect(call.method).toBe('sendPhoto');
    expect(call.body).toMatchObject({
      chat_id: CHAT,
      photo: 'https://cdn.example/baltic.jpg',
      caption: '🆕 New release\n<b>Baltic</b> — Scalegraph',
      parse_mode: 'HTML',
    });
  });

  it('falls back to a text message when the drop has no image', () => {
    for (const imageUrl of [null, undefined, '']) {
      const call = buildSendCall({ chatId: CHAT, text: 'hello', imageUrl });

      expect(call.method).toBe('sendMessage');
      expect(call.body).toMatchObject({ chat_id: CHAT, text: 'hello' });
    }
  });

  it('disables the link preview only on text posts', () => {
    // A photo post has no preview card to suppress; a text post would otherwise
    // render a second, redundant card for the link in the message.
    const text = buildSendCall({ chatId: CHAT, text: 'hi' });
    const photo = buildSendCall({
      chatId: CHAT,
      text: 'hi',
      imageUrl: 'https://cdn.example/a.jpg',
    });

    expect(text.body.link_preview_options).toEqual({ is_disabled: true });
    expect(photo.body.link_preview_options).toBeUndefined();
  });

  it('sends an over-long alert as text rather than not at all', () => {
    // Telegram caps a caption at 1024 characters but allows 4096 in a message.
    // A pathological title must cost the picture, not the alert.
    const call = buildSendCall({
      chatId: CHAT,
      text: 'x'.repeat(1025),
      imageUrl: 'https://cdn.example/a.jpg',
    });

    expect(call.method).toBe('sendMessage');
  });

  it('still uses a photo at exactly the caption limit', () => {
    const call = buildSendCall({
      chatId: CHAT,
      text: 'x'.repeat(1024),
      imageUrl: 'https://cdn.example/a.jpg',
    });

    expect(call.method).toBe('sendPhoto');
  });
});
