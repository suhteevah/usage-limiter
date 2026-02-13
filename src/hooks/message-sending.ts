/**
 * message_sending hook:
 * Hard block at 100% by canceling the outgoing message.
 * This is the actual enforcement gate.
 */

import type Database from "better-sqlite3";
import type { PluginConfig } from "../config.js";
import { checkAllBudgets, getWorstStatus } from "../limits.js";
import { formatBlockMessage } from "../downgrade.js";

type MessageSendingEvent = {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
};

type MessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

type MessageSendingResult = {
  content?: string;
  cancel?: boolean;
};

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export function createMessageSendingHook(
  db: Database.Database,
  config: PluginConfig,
  logger: Logger
) {
  return (
    _event: MessageSendingEvent,
    _ctx: MessageContext
  ): MessageSendingResult | void => {
    try {
      const statuses = checkAllBudgets(db, config);
      const worst = getWorstStatus(statuses);

      if (worst === "blocked") {
        const blocked = statuses.filter((s) => s.status === "blocked");
        logger.warn(
          `[usage-limiter] Blocking outgoing message - budget exceeded: ${blocked.map((b) => `${b.period}/${b.limitType}`).join(", ")}`
        );
        return { cancel: true };
      }
    } catch (err) {
      logger.error(
        `[usage-limiter] Error in message_sending hook: ${err}`
      );
    }

    return undefined;
  };
}
