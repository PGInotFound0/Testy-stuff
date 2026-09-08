import { describe, expect, it } from 'vitest';
import { buildReplyContent, isRootPost, parseThreadRelation } from '../src/domain/threads';

describe('Matrix thread relations', () => {
  it('builds an m.thread reply with the compatibility fallback', () => {
    expect(buildReplyContent('$root', 'Count me in')).toEqual({
      msgtype: 'm.text',
      body: 'Count me in',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$root',
        is_falling_back: true,
        'm.in_reply_to': { event_id: '$root' },
      },
    });
  });

  it('targets the latest thread event in the fallback reply', () => {
    expect(buildReplyContent('$root', 'Following up', '$latest')['m.relates_to']['m.in_reply_to'])
      .toEqual({ event_id: '$latest' });
  });

  it('parses valid thread replies and rejects other relations', () => {
    expect(parseThreadRelation({
      rel_type: 'm.thread',
      event_id: '$root',
      'm.in_reply_to': { event_id: '$previous' },
    })).toEqual({ rootEventId: '$root', replyToEventId: '$previous' });
    expect(parseThreadRelation({ rel_type: 'm.reference', event_id: '$root' })).toBeNull();
    expect(parseThreadRelation(null)).toBeNull();
  });

  it('treats message events without a thread relation as root posts', () => {
    expect(isRootPost({ msgtype: 'm.text', body: 'Assembly at seven' })).toBe(true);
    expect(isRootPost(buildReplyContent('$root', 'I will attend'))).toBe(false);
    expect(isRootPost({ msgtype: 'm.image', body: 'poster.png' })).toBe(false);
  });
});
