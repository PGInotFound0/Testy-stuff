import { describe, expect, it } from 'vitest';
import { mapPrivateBoards } from '../src/domain/boards';

describe('mapPrivateBoards', () => {
  it('maps joined private Matrix rooms to boards', () => {
    const boards = mapPrivateBoards([
      { roomId: '!organizing:example.org', name: 'Mutual Aid', topic: 'Needs and offers', membership: 'join', joinRule: 'invite', encrypted: true },
      { roomId: '!public:example.org', name: 'Town Square', membership: 'join', joinRule: 'public', encrypted: false },
      { roomId: '!old:example.org', name: 'Old', membership: 'leave', joinRule: 'invite', encrypted: true },
    ]);

    expect(boards).toEqual([{
      id: '!organizing:example.org',
      name: 'Mutual Aid',
      topic: 'Needs and offers',
      encrypted: true,
    }]);
  });
});
