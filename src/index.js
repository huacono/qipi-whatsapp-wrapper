import pkg from '@whiskeysockets/baileys';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
} = pkg;

import { Boom } from '@hapi/boom';
import pino from 'pino';
import { existsSync, mkdirSync } from 'fs';
import express from 'express';
import qr from 'qrcode';

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const API_SECRET  = process.env.API_SECRET || 'qipi-secret-2024';
const AUTH_FOLDER = './auth_info';

const logger = pino({ level: 'silent' });
const store  = makeInMemoryStore({ logger });

let sock        = null;
let isConnected = false;
let lastQR      = null; // guardamos el último QR aquí

if (!existsSync(AUTH_FOLDER)) mkdirSync(AUTH_FOLDER);

// ─── Conectar a WhatsApp ──────────────────────────────────────────────────────
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth: state, logger, printQRInTerminal: false });
  store.bind(sock.ev);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr: qrCode } = update;

    if (qrCode) {
      lastQR = qrCode; // guardamos el QR para mostrarlo en el navegador
      console.log('QR generado — abre /qr en el navegador para escanearlo');
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
      lastQR = null;
      console.log('✅ WhatsApp conectado exitosamente!');
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

// ─── Express API ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// GET /qr — página HTML con el QR para escanear (sin auth para poder abrirlo fácil)
app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.send('<h2>✅ WhatsApp ya está conectado!</h2>');
  }
  if (!lastQR) {
    return res.send('<h2>⏳ Esperando QR... refresca en unos segundos.</h2>');
  }
  try {
    const qrImage = await qr.toDataURL(lastQR);
    res.send(`
      <html>
        <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;padding:40px">
          <h2>Escanea este QR con el chip de QIPI</h2>
          <img src="${qrImage}" style="width:300px;height:300px"/>
          <p>Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
          <p><small>Esta página se puede cerrar después de escanear</small></p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error generando QR: ' + err.message);
  }
});

// Auth middleware para el resto de endpoints
app.use((req, res, next) => {
  if (req.headers['x-api-secret'] !== API_SECRET)
    return res.status(401).json({ error: 'No autorizado' });
  next();
});

// GET /status
app.get('/status', (req, res) => {
  res.json({ connected: isConnected });
});

// GET /groups
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

// POST /send-message
app.post('/send-message', async (req, res) => {
  if (!isConnected) return res.status(503).json({ error: 'WhatsApp no conectado' });

  const { groupId, message } = req.body;
  if (!groupId || !message)
    return res.status(400).json({ error: 'Faltan campos: groupId y message' });
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

app.listen(PORT, () => {
  console.log(`\n🚀 QIPI WhatsApp Wrapper corriendo en puerto ${PORT}`);
  console.log(`   Abre /qr en el navegador para vincular WhatsApp\n`);
});

connectToWhatsApp();
