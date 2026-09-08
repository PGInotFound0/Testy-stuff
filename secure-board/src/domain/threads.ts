export interface ThreadReplyContent {
  msgtype: 'm.text';
  body: string;
  'm.relates_to': {
    rel_type: 'm.thread';
    event_id: string;
    is_falling_back: true;
    'm.in_reply_to': { event_id: string };
  };
}

export interface ParsedThreadRelation {
  rootEventId: string;
  replyToEventId?: string;
}

export function buildReplyContent(
  rootEventId: string,
  body: string,
  replyToEventId = rootEventId,
): ThreadReplyContent {
  return {
    msgtype: 'm.text',
    body,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootEventId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: replyToEventId },
    },
  };
}

export function parseThreadRelation(value: unknown): ParsedThreadRelation | null {
  if (!value || typeof value !== 'object') return null;
  const relation = value as Record<string, unknown>;
  if (relation.rel_type !== 'm.thread' || typeof relation.event_id !== 'string') return null;

  const inReplyTo = relation['m.in_reply_to'];
  const replyToEventId = inReplyTo && typeof inReplyTo === 'object'
    ? (inReplyTo as Record<string, unknown>).event_id
    : undefined;

  return {
    rootEventId: relation.event_id,
    ...(typeof replyToEventId === 'string' ? { replyToEventId } : {}),
  };
}

export function isRootPost(content: unknown): boolean {
  if (!content || typeof content !== 'object') return false;
  const message = content as Record<string, unknown>;
  return message.msgtype === 'm.text'
    && typeof message.body === 'string'
    && message['m.relates_to'] === undefined;
}
