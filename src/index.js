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
const PORT        = process.env.PORT || 3000;
const API_SECRET  = process.env.API_SECRET || 'qipi-secret-2024';
const AUTH_FOLDER = './auth_info';

// ─── Logger silencioso (solo errores en consola) ───────────────────────────────
const logger = pino({ level: 'silent' });

// ─── Store en memoria (para listar grupos) ────────────────────────────────────
const store = makeInMemoryStore({ logger });

// ─── Estado global del socket ─────────────────────────────────────────────────
let sock = null;
let isConnected = false;

// ─── Crear carpeta de auth si no existe ───────────────────────────────────────
if (!existsSync(AUTH_FOLDER)) mkdirSync(AUTH_FOLDER);

// ─── Conectar a WhatsApp ──────────────────────────────────────────────────────
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false, // lo manejamos nosotros
  });

  store.bind(sock.ev);

  // QR para escanear
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
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 3000);
      } else {
        console.log('Sesión cerrada. Borra la carpeta auth_info y reinicia.');
      }
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

// Middleware de autenticación simple
app.use((req, res, next) => {
  const secret = req.headers['x-api-secret'];
  if (secret !== API_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
});

// GET /status — verificar si está conectado
app.get('/status', (req, res) => {
  res.json({ connected: isConnected });
});

// GET /groups — listar grupos para obtener el ID del grupo QIPI
app.get('/groups', async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({ error: 'WhatsApp no está conectado aún' });
  }
  try {
    const groups = await sock.groupFetchAllParticipating();
    const list = Object.values(groups).map((g) => ({
      id: g.id,
      name: g.subject,
    }));
    res.json({ groups: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /send-message — enviar mensaje al grupo
// Body: { "groupId": "120363XXXXXXXX@g.us", "message": "texto del mensaje" }
app.post('/send-message', async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({ error: 'WhatsApp no está conectado aún' });
  }

  const { groupId, message } = req.body;

  if (!groupId || !message) {
    return res.status(400).json({ error: 'Faltan campos: groupId y message son requeridos' });
  }

  try {
    await sock.sendMessage(groupId, { text: message });
    console.log(`✅ Mensaje enviado al grupo ${groupId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error enviando mensaje:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Arrancar ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 QIPI WhatsApp Wrapper corriendo en puerto ${PORT}`);
  console.log(`   API_SECRET: ${API_SECRET}\n`);
});

connectToWhatsApp();
