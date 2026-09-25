const fs = require('fs');
const path = require('path');

const baileys = path.join(__dirname, '..', 'node_modules', 'baileys', 'lib', 'Utils');

if (!fs.existsSync(baileys)) {
  console.log('baileys not installed, skipping patch');
  process.exit(0);
}

// ─── 1. El JID de descifrado prefiere el teléfono al LID ──────────────────────

patch(
  path.join(baileys, 'decode-wa-message.js'),
  'getPNForLID',
  `export const getDecryptionJid = async (sender, repository) => {
    if (isLidUser(sender) || isHostedLidUser(sender)) {
        return sender;
    }`,
  `export const getDecryptionJid = async (sender, repository) => {
    if (isLidUser(sender) || isHostedLidUser(sender)) {
        const mapped = await repository.lidMapping?.getPNForLID(sender);
        return mapped || sender;
    }`,
  'getDecryptionJid prefers PN over LID',
);

// ─── 2. Un registro ilegible no tira la colección entera ──────────────────────
//
// WhatsApp devuelve snapshots de app-state con registros que este protocolo no sabe decodificar
// («invalid wire type 7», «index out of range»). Baileys deja que ese error se propague, así que
// **un solo registro malo deja a la línea sin agenda**: la colección se abandona entera y
// `/api/contacts/resync` devolvía 0 contactos como si el teléfono no tuviera ninguno.
//
// Baileys ya se salta los registros que no descifran y los de MAC inválido; esto extiende la
// misma tolerancia a los que no parsean. Los saltados se cuentan en `globalThis` para poder
// decir cuántos se perdieron en vez de callarlo.

patch(
  path.join(baileys, 'chat-utils.js'),
  '__wacoreAppStateSkipped',
  `        const syncAction = proto.SyncActionData.decode(result);
        if (validateMacs) {
            const hmac = hmacSign(syncAction.index, key.indexKey);
            if (Buffer.compare(hmac, record.index.blob) !== 0) {
                throw new Boom('HMAC index verification failed');
            }
        }
        const indexStr = Buffer.from(syncAction.index).toString();
        onMutation({ syncAction, index: JSON.parse(indexStr) });`,
  `        try {
            const syncAction = proto.SyncActionData.decode(result);
            if (validateMacs) {
                const hmac = hmacSign(syncAction.index, key.indexKey);
                if (Buffer.compare(hmac, record.index.blob) !== 0) {
                    throw new Boom('HMAC index verification failed');
                }
            }
            const indexStr = Buffer.from(syncAction.index).toString();
            onMutation({ syncAction, index: JSON.parse(indexStr) });
        }
        catch {
            // Registro ilegible: se salta, como los que no descifran, en vez de abortar.
            globalThis.__wacoreAppStateSkipped = (globalThis.__wacoreAppStateSkipped || 0) + 1;
        }`,
  'app-state snapshot tolerates unreadable records',
);

function patch(file, marca, original, parcheado, descripcion) {
  if (!fs.existsSync(file)) {
    console.log(`baileys: ${path.basename(file)} not found, skipping patch`);
    return;
  }

  const content = fs.readFileSync(file, 'utf8');

  if (content.includes(marca)) {
    console.log(`baileys already patched: ${descripcion}`);
    return;
  }

  if (!content.includes(original)) {
    console.log(`baileys source format different, patch may need update: ${descripcion}`);
    return;
  }

  fs.writeFileSync(file, content.replace(original, parcheado));
  console.log(`baileys patched: ${descripcion}`);
}
