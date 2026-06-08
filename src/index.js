import express from "express";
import qr from "qrcode";
import pino from "pino";
import { existsSync, mkdirSync } from "fs";
import { Boom } from "@hapi/boom";

const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || "qipi-secret-2024";
const AUTH_FOLDER = "./auth_info";
const logger = pino({ level: "silent" });

let sock = null;
let isConnected = false;
let lastQR = null;

if (!existsSync(AUTH_FOLDER)) mkdirSync(AUTH_FOLDER);

async function connectToWhatsApp() {
  const pkg = await import("@whiskeysockets/baileys");
  const makeWASocket = pkg.default;
  const useMultiFileAuthState = pkg.useMultiFileAuthState;
  const DisconnectReason = pkg.DisconnectReason;
  const fetchLatestBaileysVersion = pkg.fetchLatestBaileysVersion;
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger, printQRInTerminal: false, browser: ["QIPI","Chrome","1.0"] });
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr: qrCode } = update;
    if (qrCode) { lastQR = qrCode; console.log("QR generado - abre http://localhost:3000/qr"); }
    if (connection === "close") {
      isConnected = false;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, 5000);
    }
    if (connection === "open") { isConnected = true; lastQR = null; console.log("WhatsApp conectado!"); }
  });
  sock.ev.on("creds.update", saveCreds);
}

const app = express();
app.use(express.json());

app.get("/qr", async (req, res) => {
  if (isConnected) return res.send("<h2>WhatsApp conectado!</h2>");
  if (!lastQR) return res.send("<h2>Generando QR...</h2><script>setTimeout(()=>location.reload(),5000)</script>");
  const qrImage = await qr.toDataURL(lastQR);
  res.send('<html><body style="text-align:center;font-family:sans-serif;padding:40px"><h2>Escanea con WhatsApp</h2><img src="' + qrImage + '" style="width:300px"/></body></html>');
});

app.use((req, res, next) => {
  if (req.headers["x-api-secret"] !== API_SECRET) return res.status(401).json({ error: "No autorizado" });
  next();
});

app.get("/status", (req, res) => res.json({ connected: isConnected }));

app.get("/groups", async (req, res) => {
  if (!isConnected) return res.status(503).json({ error: "No conectado" });
  const groups = await sock.groupFetchAllParticipating();
  res.json({ groups: Object.values(groups).map(g => ({ id: g.id, name: g.subject })) });
});

app.post("/send-message", async (req, res) => {
  if (!isConnected) return res.status(503).json({ error: "No conectado" });
  const { groupId, message } = req.body;
  if (!groupId || !message) return res.status(400).json({ error: "Faltan groupId y message" });
  await sock.sendMessage(groupId, { text: message });
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log("QIPI Wrapper en puerto " + PORT);
  setTimeout(connectToWhatsApp, 2000);
});
