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
import { createCommandRegistry } from './commands/registry';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const eventBus = createEventBus();
  const sessionStore = await createSessionStore(config, logger);
  const authProvider = await createAuthProvider(sessionStore, logger);
  const client = await createBaileysClient(config, eventBus, authProvider, logger);
  const messageSender = createMessageSender(client, eventBus, logger);
  const healthMonitor = createHealthMonitor(config.healthPort, logger, config.instanceName);
  const messageRouter = createMessageRouter(eventBus, logger);
  const webhookDispatcher = createWebhookDispatcher(eventBus, config, logger);
  const restApi = createRestApi(
    config.apiPort,
    config,
    logger,
    (to, text) => messageSender.sendText(to, text),
    (req) => messageSender.sendMedia(req),
    () => client.getConnectionStatus(),
    () => client.getQr(),
    () => client.logout(),
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
    (to, text) => messageSender.sendText(to, text),
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
  webhookDispatcher.start();
  restApi.start();

  if (config.connectOnStartup) {
    await client.start();
  }

  // ─── Handle shutdown ────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info('Shutdown signal received', { signal });
    commandRegistry.stop();
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
