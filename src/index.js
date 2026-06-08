import pkg from '@whiskeysockets/baileys';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = pkg;

import { Boom } from '@hapi/boom';
import pino from 'pino';
import { existsSync, mkdirSync } from 'fs';
import express from 'express';
import qr from 'qrcode';

const PORT        = process.env.PORT || 3000;
const API_SECRET  = process.env.API_SECRET || 'qipi-secret-2024';
const AUTH_FOLDER = './auth_info';

const logger = pino({ level: 'silent' });

let sock        = null;
let isConnected = false;
let lastQR      = null;

if (!existsSync(AUTH_FOLDER)) mkdirSync(AUTH_FOLDER);

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['QIPI', 'Chrome', '1.0'],
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr: qrCode } = update;

    if (qrCode) {
      lastQR = qrCode;
      console.log('✅ QR generado — abre /qr en el navegador');
    }

    if (connection === 'close') {
      isConnected = false;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada, código:', code, 'Reconectando:', shouldReconnect);
      if (shouldReconnect) setTimeout(connectToWhatsApp, 5000);
    }

    if (connection === 'open') {
      isConnected = true;
      lastQR = null;
      console.log('✅ WhatsApp conectado!');
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// QR público
app.get('/qr', async (req, res) => {
  if (isConnected) return res.send('<h2 style="font-family:sans-serif">✅ WhatsApp ya está conectado!</h2>');
  if (!lastQR) return res.send('<h2 style="font-family:sans-serif">⏳ Generando QR... refresca en 10 segundos.</h2><script>setTimeout(()=>location.reload(),5000)</script>');
  try {
    const qrImage = await qr.toDataURL(lastQR);
    res.send(`
      <html><body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;padding:40px">
        <h2>Escanea con WhatsApp → Dispositivos vinculados</h2>
        <img src="${qrImage}" style="width:300px;height:300px"/>
        <p>Usa el chip de QIPI para escanear</p>
        <script>setTimeout(()=>location.reload(),30000)</script>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Auth
app.use((req, res, next) => {
  if (req.headers['x-api-secret'] !== API_SECRET)
    return res.status(401).json({ error: 'No autorizado' });
  next();
});

app.get('/status', (req, res) => res.json({ connected: isConnected }));

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

app.post('/send-message', async (req, res) => {
  if (!isConnected) return res.status(503).json({ error: 'WhatsApp no conectado' });
  const { groupId, message } = req.body;
  if (!groupId || !message) return res.status(400).json({ error: 'Faltan groupId y message' });
  if (!groupId.endsWith('@g.us')) return res.status(400).json({ error: 'groupId inválido' });
  try {
    await sock.sendMessage(groupId, { text: message });
    console.log(`✅ Mensaje enviado → ${groupId}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Arrancar servidor primero, luego conectar WhatsApp
app.listen(PORT, () => {
  console.log(`🚀 QIPI Wrapper en puerto ${PORT}`);
  // Pequeño delay para que el servidor esté listo
  setTimeout(connectToWhatsApp, 2000);
});
