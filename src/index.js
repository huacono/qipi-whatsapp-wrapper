import express from "express";
import qr from "qrcode";
import pino from "pino";
import { existsSync, mkdirSync } from "fs";
import { Boom } from "@hapi/boom";

const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || "qipi-secret-2024";
const AUTH_FOLDER = "./auth_info";
const logger = pino({ level: "silent" });

const SUPABASE_URL = "https://qwzvvcozwepjgrlnpoxq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3enZ2Y296d2VwamdybG5wb3hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyMTY0OTEsImV4cCI6MjA3NDc5MjQ5MX0.-wp5GWs_b0mGrk4RQ-o2EvwbW5DMrEWiO_o9fbevgQE";

let sock = null;
let isConnected = false;
let lastQR = null;

if (!existsSync(AUTH_FOLDER)) mkdirSync(AUTH_FOLDER);

function procesarPendientes() {
  console.log("WhatsApp conectado. Disparando reintento de pendientes...");
  fetch(`${SUPABASE_URL}/functions/v1/procesar-pendientes-whatsapp`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
      "x-webhook-secret": "cd9c4d39bf7f6f4d548851e456649aaa4f38575ddc05aa601c58f9a1a1204164",
      "Content-Type": "application/json"
    }
  })
    .then(res => res.json())
    .then(data => console.log("Resultado de reintentos:", data))
    .catch(err => console.error("Error al invocar reintentos:", err.message));
}

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
    if (connection === "open") {
      isConnected = true;
      lastQR = null;
      console.log("WhatsApp conectado!");
      procesarPendientes();
    }
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
  if (!/^[\d-]+@(g\.us|s\.whatsapp\.net)$/.test(groupId)) { return res.status(400).json({ error: "Formato de groupId invalido" }); }
  try { await sock.sendMessage(groupId, { text: message }); } catch (err) { console.error("Fallo al enviar mensaje a " + groupId + ":", err.message); return res.status(500).json({ error: "Fallo al enviar mensaje", detail: err.message }); }
  res.json({ success: true });
});

app.post("/procesar-pendientes", (req, res) => {
  procesarPendientes();
  res.json({ success: true, message: "Procesamiento de pendientes disparado" });
});

app.listen(PORT, () => {
  console.log("QIPI Wrapper en puerto " + PORT);
  setTimeout(connectToWhatsApp, 2000);
});


