import { parseThreadRelation } from './threads';

export interface BoardReply {
  id: string;
  body: string;
  sender: string;
  timestamp: number;
}

export interface BoardPost extends BoardReply {
  replies: BoardReply[];
}

export interface MatrixMessageEventLike {
  getId(): string | undefined;
  getType(): string;
  getContent(): unknown;
  getTs(): number;
  getSender(): string | undefined;
  isRedacted(): boolean;
}

interface ParsedMessage extends BoardReply {
  rootEventId?: string;
}

function parseMessage(event: MatrixMessageEventLike): ParsedMessage | null {
  if (event.getType() !== 'm.room.message' || event.isRedacted()) return null;
  const id = event.getId();
  const content = event.getContent();
  if (!id || !content || typeof content !== 'object') return null;
  const message = content as Record<string, unknown>;
  if (message.msgtype !== 'm.text' || typeof message.body !== 'string') return null;
  const sender = event.getSender();
  if (typeof sender !== 'string') return null;
  const relation = parseThreadRelation(message['m.relates_to']);
  if (message['m.relates_to'] !== undefined && !relation) return null;
  return {
    id,
    body: message.body,
    sender,
    timestamp: event.getTs(),
    ...(relation ? { rootEventId: relation.rootEventId } : {}),
  };
}

const eventOrder = (a: BoardReply, b: BoardReply) => a.timestamp - b.timestamp || a.id.localeCompare(b.id);

export function buildBoardPosts(events: MatrixMessageEventLike[]): BoardPost[] {
  const messages = new Map<string, ParsedMessage>();
  for (const event of events) {
    const parsed = parseMessage(event);
    if (parsed && !messages.has(parsed.id)) messages.set(parsed.id, parsed);
  }
  const roots = [...messages.values()]
    .filter((message) => !message.rootEventId)
    .sort(eventOrder)
    .map<BoardPost>((message) => ({
      id: message.id,
      body: message.body,
      sender: message.sender,
      timestamp: message.timestamp,
      replies: [...messages.values()]
        .filter((reply) => reply.rootEventId === message.id)
        .sort(eventOrder)
        .map(({ id, body, sender, timestamp }) => ({ id, body, sender, timestamp })),
    }));
  return roots;
}
