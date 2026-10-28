const PLACEHOLDER = /\{\{[^}]*\}\}|<\s*(first_?name|name|company|sender[a-z_]*|[a-z]+_[a-z_]+)\s*>|\[(first name|name|company|your name)\]/i;

/**
 * The only writing checks the CLI enforces, because no customization should ever want them off.
 * Everything about style (length, tone, banned words) lives in the user's notes.
 */
export function checkMessage(message: { channel: string; subject?: string; body: string; needsSubject: boolean }): string[] {
  const problems: string[] = [];
  const body = message.body.trim();
  const text = `${message.subject ?? ""}\n${body}`;
  if (!body) problems.push("The message body is empty.");
  if (message.channel === "email" && message.needsSubject && !message.subject?.trim()) {
    problems.push("A first email needs a subject.");
  }
  const placeholder = text.match(PLACEHOLDER);
  if (placeholder) problems.push(`Contains an unfilled placeholder: ${placeholder[0]}.`);
  return problems;
}
