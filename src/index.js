import express from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { existsSync, mkdirSync } from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || 'qipi-secret-2024';
const AUTH_FOLDER = './auth_info';

const logger = pino({ level: 'silent' });
const store  = makeInMemoryStore({ logger });

let sock        = null;
let isConnected = false;

if (!existsSync(AUTH_FOLDER)) mkdirSync(AUTH_FOLDER);

// ─── Conectar a WhatsApp ──────────────────────────────────────────────────────
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth: state, logger, printQRInTerminal: false });
  store.bind(sock.ev);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n──────────────────────────────────────────');
      console.log('  Escanea este QR con el chip de QIPI:');
      console.log('──────────────────────────────────────────\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect =
        new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada. Reconectando:', shouldReconnect);
      if (shouldReconnect) setTimeout(connectToWhatsApp, 3000);
      else console.log('Sesión cerrada. Borra auth_info y reinicia.');
    }

    if (connection === 'open') {
      isConnected = true;
      console.log('\n✅ WhatsApp conectado exitosamente!\n');
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

// ─── Express API ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Auth
app.use((req, res, next) => {
  if (req.headers['x-api-secret'] !== API_SECRET)
    return res.status(401).json({ error: 'No autorizado' });
  next();
});

// GET /status
app.get('/status', (req, res) => {
  res.json({ connected: isConnected });
});

// GET /groups — listar todos los grupos para obtener IDs
app.get('/groups', async (req, res) => {
  if (!isConnected) return res.status(503).json({ error: 'WhatsApp no conectado' });
  try {
    const groups = await sock.groupFetchAllParticipating();
    const list = Object.values(groups).map((g) => ({ id: g.id, name: g.subject }));
    res.json({ groups: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /send-message — enviar mensaje a un grupo específico de una tienda
// Body: { "groupId": "120363XXXXXXXX@g.us", "message": "texto" }
app.post('/send-message', async (req, res) => {
  if (!isConnected) return res.status(503).json({ error: 'WhatsApp no conectado' });

  const { groupId, message } = req.body;

  if (!groupId || !message)
    return res.status(400).json({ error: 'Faltan campos: groupId y message' });

  // Validar formato de groupId de WhatsApp
  if (!groupId.endsWith('@g.us'))
    return res.status(400).json({ error: 'groupId inválido, debe terminar en @g.us' });

  try {
    await sock.sendMessage(groupId, { text: message });
    console.log(`✅ Mensaje enviado → grupo ${groupId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error enviando mensaje:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Arrancar ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 QIPI WhatsApp Wrapper corriendo en puerto ${PORT}\n`);
});

connectToWhatsApp();
