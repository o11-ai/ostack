import type { Channel, Playbook } from "./playbook.ts";

const PLACEHOLDER = /\{\{[^}]*\}\}|<\s*(first_?name|name|company|sender[a-z_]*|[a-z]+_[a-z_]+)\s*>|\[(first name|name|company|your name)\]/i;

/** Hard checks applied to every outgoing message before it can be reserved. */
export function checkMessage(
  playbook: Playbook,
  message: { channel: Channel; subject?: string; body: string; needsSubject: boolean },
): string[] {
  const problems: string[] = [];
  const body = message.body.trim();
  const text = `${message.subject ?? ""}\n${body}`;
  if (!body) problems.push("The message body is empty.");
  if (message.channel === "email" && message.needsSubject && !message.subject?.trim()) {
    problems.push("A first email needs a subject.");
  }
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words > playbook.writing.max_words) {
    problems.push(`The body has ${words} words; the playbook allows ${playbook.writing.max_words}.`);
  }
  for (const phrase of playbook.writing.banned) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) problems.push(`Contains banned text: "${phrase}".`);
  }
  const placeholder = text.match(PLACEHOLDER);
  if (placeholder) problems.push(`Contains an unfilled placeholder: ${placeholder[0]}.`);
  return problems;
}
