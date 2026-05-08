import { loadConfig } from './config';
import { createLogger } from './utils/logger';
import { createEventBus } from './core/event-bus';
import { createMessageRouter } from './core/message-router';
import { createHealthMonitor } from './core/health';
import { createWebhookDispatcher } from './transport/webhook-dispatcher';
import { createRestApi } from './transport/rest-api';
import { createSessionStore } from './storage/session-store';
import { createAuthProvider } from './baileys/auth';
import { createBaileysClient } from './baileys/client';
import { createMessageSender } from './services/message-sender';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const eventBus = createEventBus();
  const sessionStore = createSessionStore(config, logger);
  const authProvider = await createAuthProvider(sessionStore, logger);
  const client = await createBaileysClient(config, eventBus, authProvider, logger);
  const messageSender = createMessageSender(client, eventBus, logger);
  const healthMonitor = createHealthMonitor(config.healthPort, logger, config.instanceName);
  const messageRouter = createMessageRouter(eventBus, logger);
  const webhookDispatcher = createWebhookDispatcher(eventBus, config, logger);
  const restApi = createRestApi(
    config.healthPort,
    config,
    logger,
    (to, text) => messageSender.sendText(to, text),
    (req) => messageSender.sendMedia(req),
    () => client.getConnectionStatus(),
    () => client.getQr(),
    () => client.logout(),
  );

  // ─── Start subsystems ───────────────────────────────────────
  healthMonitor.start();
  messageRouter.start();
  webhookDispatcher.start();
  restApi.start();

  if (config.connectOnStartup) {
    await client.start();
  }

  // ─── Handle shutdown ────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info('Shutdown signal received', { signal });
    await client.stop();
    webhookDispatcher.stop();
    messageRouter.stop();
    restApi.stop();
    healthMonitor.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('WACore started', {
    instance: config.instanceName,
    sessionStore: config.sessionStore,
  });
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
