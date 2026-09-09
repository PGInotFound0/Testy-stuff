import { describe, expect, it } from 'vitest';
import { buildBoardPosts } from '../src/domain/posts';

function event(id: string | undefined, content: unknown, timestamp = 1, options: {
  type?: string;
  wireType?: string;
  encrypted?: boolean;
  redacted?: boolean;
  sender?: string;
} = {}) {
  return {
    getId: () => id,
    getType: () => options.type ?? 'm.room.message',
    getWireType: () => options.wireType ?? 'm.room.encrypted',
    isEncrypted: () => options.encrypted ?? true,
    getContent: () => content,
    getTs: () => timestamp,
    getSender: () => options.sender ?? '@alice:example.org',
    isRedacted: () => options.redacted ?? false,
  };
}

describe('buildBoardPosts', () => {
  it('excludes plaintext m.room.message events even when collected from an encrypted room', () => {
    expect(buildBoardPosts([
      event('$plaintext', { msgtype: 'm.text', body: 'Not encrypted' }, 1, {
        wireType: 'm.room.message', encrypted: false,
      }),
    ])).toEqual([]);
  });

  it('includes decrypted events whose wire event was m.room.encrypted', () => {
    expect(buildBoardPosts([
      event('$decrypted', { msgtype: 'm.text', body: 'Encrypted on the wire' }),
    ])).toEqual([{
      id: '$decrypted', body: 'Encrypted on the wire', sender: '@alice:example.org', timestamp: 1, replies: [],
    }]);
  });

  it('renders ordered roots and thread replies using stable event IDs', () => {
    const events = [
      event('$reply', { msgtype: 'm.text', body: 'Reply', 'm.relates_to': { rel_type: 'm.thread', event_id: '$root', 'm.in_reply_to': { event_id: '$root' } } }, 30),
      event('$later', { msgtype: 'm.text', body: 'Later' }, 20),
      event('$root', { msgtype: 'm.text', body: 'Root' }, 10),
      event('$root', { msgtype: 'm.text', body: 'duplicate' }, 40),
    ];

    expect(buildBoardPosts(events)).toEqual([
      { id: '$root', body: 'Root', sender: '@alice:example.org', timestamp: 10, replies: [
        { id: '$reply', body: 'Reply', sender: '@alice:example.org', timestamp: 30 },
      ] },
      { id: '$later', body: 'Later', sender: '@alice:example.org', timestamp: 20, replies: [] },
    ]);
  });

  it('ignores encrypted placeholders, malformed/non-text messages, missing IDs, orphan replies, and redacted events', () => {
    expect(buildBoardPosts([
      event('$encrypted', {}, 1, { type: 'm.room.encrypted' }),
      event('$image', { msgtype: 'm.image', body: 'photo' }),
      event('$bad', { msgtype: 'm.text', body: 42 }),
      event(undefined, { msgtype: 'm.text', body: 'missing ID' }),
      event('$orphan', { msgtype: 'm.text', body: 'orphan', 'm.relates_to': { rel_type: 'm.thread', event_id: '$missing' } }),
      event('$redacted', { msgtype: 'm.text', body: 'gone' }, 1, { redacted: true }),
    ])).toEqual([]);
  });
});
