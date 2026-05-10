const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'baileys', 'lib', 'Utils', 'decode-wa-message.js');

if (!fs.existsSync(target)) {
  console.log('baileys not installed, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(target, 'utf8');

if (content.includes('getPNForLID')) {
  console.log('baileys already patched');
  process.exit(0);
}

const original = `export const getDecryptionJid = async (sender, repository) => {
    if (isLidUser(sender) || isHostedLidUser(sender)) {
        return sender;
    }`;

const patched = `export const getDecryptionJid = async (sender, repository) => {
    if (isLidUser(sender) || isHostedLidUser(sender)) {
        const mapped = await repository.lidMapping?.getPNForLID(sender);
        return mapped || sender;
    }`;

if (!content.includes(original)) {
  console.log('baileys source format different, patch may need update');
  process.exit(0);
}

content = content.replace(original, patched);
fs.writeFileSync(target, content);
console.log('baileys patched: getDecryptionJid prefers PN over LID');
