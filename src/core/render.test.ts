import { describe, expect, it } from 'vitest';

import { plain } from '../formats/plain';
import { createBan } from './create-ban';

describe('render', () => {
  const ban = createBan({ format: plain(), docsBaseUrl: 'https://d' });

  it('sanitizes meta before the format sees it', () => {
    const meta = JSON.parse('{"__proto__":{"x":1},"ok":true}') as Record<
      string,
      unknown
    >;
    const rendered = ban.render(ban.badRequest({ meta }));
    expect(rendered.body).toMatchObject({ meta: { ok: true } });
  });

  it('adds the stack only for 5xx with includeStack, preferring the cause', () => {
    const cause = new Error('root');
    const server = ban.internalServerError({ cause });
    const client = ban.badRequest({ cause });
    expect(ban.render(server, { includeStack: true }).body).toMatchObject({
      stack: cause.stack,
    });
    expect(ban.render(server).body).not.toHaveProperty('stack');
    expect(ban.render(client, { includeStack: true }).body).not.toHaveProperty(
      'stack',
    );
    expect(
      ban.render(ban.internalServerError(), { includeStack: true }).body,
    ).toHaveProperty('stack');
  });

  it('lets an explicit instance on the error win over the request path', () => {
    const rendered = ban.render(ban.notFound({ instance: '/mine' }), {
      instance: '/req',
    });
    expect(rendered.body).toMatchObject({ instance: '/mine' });
  });

  it('uses renderValidation when issues are attached', () => {
    const error = ban.validation([{ path: ['a'], message: 'bad' }], {
      location: 'query',
    });
    const rendered = ban.render(error);
    expect(rendered.body).toMatchObject({
      status: 422,
      errors: [{ location: 'query', name: 'a', detail: 'bad' }],
    });
  });
});
