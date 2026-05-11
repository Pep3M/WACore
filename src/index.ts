import { loadConfig } from './config';
import { createLogger } from './utils/logger';
import { createEventBus } from './core/event-bus';
import { createMessageRouter } from './core/message-router';
import { createHealthMonitor } from './core/health';
import { createWebhookDispatcher } from './transport/webhook-dispatcher';
import { createRestApi } from './transport/rest-api';
import { createSSETransport } from './transport/sse-transport';
import { createIncomingMessageHub } from './core/incoming-message-hub';
import { createSessionStore } from './storage/session-store';
import { createAuthProvider } from './baileys/auth';
import { createBaileysClient } from './baileys/client';
import { createMessageSender } from './services/message-sender';
import { createCommandRegistry } from './commands/registry';
import { createPresenceManager } from './services/presence-manager';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  // ─── PostgreSQL startup gate ──────────────────────────────
  if (config.sessionStore === 'postgres') {
    if (!config.databaseUrl) {
      logger.error('SESSION_STORE=postgres requires DATABASE_URL');
      process.exit(1);
    }
    const { waitForPostgres, runMigrations } = await import('./storage/postgres-db');
    try {
      await waitForPostgres(config.databaseUrl, logger, 30_000);
      await runMigrations(config.databaseUrl, logger);
      logger.info('PostgreSQL ready, migrations applied');
    } catch (err) {
      logger.error('PostgreSQL startup failed', { error: String(err) });
      process.exit(1);
    }
  }

  const eventBus = createEventBus();
  const sessionStore = await createSessionStore(config, logger);
  const authProvider = await createAuthProvider(sessionStore, logger);
  const client = await createBaileysClient(config, eventBus, authProvider, sessionStore, logger);
  const messageSender = createMessageSender(client, eventBus, logger);
  const presenceManager = createPresenceManager(client, config, logger);
  const healthMonitor = createHealthMonitor(config.healthPort, logger, config.instanceName);
  const messageRouter = createMessageRouter(eventBus, logger);
  const webhookDispatcher = createWebhookDispatcher(eventBus, config, logger);
  const incomingHub = createIncomingMessageHub(eventBus, logger, {
    maxSize: config.messageBufferSize,
    ttlMs: config.messageBufferTtlMs,
  });
  let sseTransport: ReturnType<typeof createSSETransport> | undefined;
  if (config.sseEnabled) {
    sseTransport = createSSETransport(incomingHub, eventBus, logger, config.sseHeartbeatMs);
  }
  const restApi = createRestApi(
    config.apiPort,
    config,
    logger,
    (to, text) => messageSender.sendText(to, text),
    (req) => messageSender.sendMedia(req),
    () => client.getConnectionStatus(),
    () => client.getQr(),
    () => client.logout(),
    () => client.getContacts(),
    () => client.connect(),
    (to, type) => presenceManager.setPresence(to, type as any),
    incomingHub,
    sseTransport,
  );

  // ─── Bridge: connection updates → health monitor ─────────────
  let wasConnected = false;
  eventBus.on('connection.update', (update) => {
    healthMonitor.updateConnection(update.status as any, update.phoneNumber);
    if (update.status === 'connected') {
      if (wasConnected) healthMonitor.incrementReconnections();
      wasConnected = true;
    }
  });

  // ─── Command system ─────────────────────────────────────────
  const commandRegistry = createCommandRegistry(
    eventBus,
    (to, text) => presenceManager.sendWithTyping(to, () => messageSender.sendText(to, text)),
    logger,
  );

  commandRegistry.register({
    name: 'ping',
    description: 'Responde con pong y el tiempo de respuesta',
    handler: async (_msg, _args, reply) => {
      const start = Date.now();
      await reply('🏓 Pong!');
      const elapsed = Date.now() - start;
      await reply(`⏱️ ${elapsed}ms`);
    },
  });

  commandRegistry.register({
    name: 'help',
    aliases: ['h', 'comandos'],
    description: 'Muestra la lista de comandos disponibles',
    handler: async (_msg, _args, reply) => {
      const list = commandRegistry.getAll()
        .map(cmd => `• *!${cmd.name}* ${cmd.usage ? `\`${cmd.usage}\` ` : ''}— ${cmd.description}`)
        .join('\n');
      await reply(`📋 *Comandos disponibles:*\n\n${list}`);
    },
  });

  commandRegistry.start();

  // ─── Start subsystems ───────────────────────────────────────
  healthMonitor.start();
  messageRouter.start();
  incomingHub.start();
  webhookDispatcher.start();
  restApi.start();

  if (config.connectOnStartup) {
    await client.start();
  }

  // ─── Handle shutdown ────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info('Shutdown signal received', { signal });
    commandRegistry.stop();
    presenceManager.stop();
    await client.stop();
    webhookDispatcher.stop();
    messageRouter.stop();
    incomingHub.stop();
    sseTransport?.stop();
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
