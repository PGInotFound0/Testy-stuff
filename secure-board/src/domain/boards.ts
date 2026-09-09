export interface MatrixRoomSummary {
  roomId: string;
  name?: string;
  topic?: string;
  membership: string;
  joinRule?: string;
  encrypted: boolean;
}

export interface Board {
  id: string;
  name: string;
  topic?: string;
  encrypted: boolean;
}

export function mapPrivateBoards(rooms: MatrixRoomSummary[]): Board[] {
  return rooms
    .filter((room) => room.membership === 'join' && room.joinRule === 'invite')
    .map((room) => ({
      id: room.roomId,
      name: room.name?.trim() || room.roomId,
      ...(room.topic ? { topic: room.topic } : {}),
      encrypted: room.encrypted,
    }));
}
