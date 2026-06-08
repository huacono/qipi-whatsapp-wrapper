# QIPI WhatsApp Wrapper

Servidor Node.js con Baileys para enviar mensajes automáticos de WhatsApp cuando una orden cambia a estado "entregado".

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/status` | Verifica si WhatsApp está conectado |
| GET | `/groups` | Lista los grupos para obtener el ID |
| POST | `/send-message` | Envía un mensaje a un grupo |

## Variables de entorno en Railway

| Variable | Valor |
|----------|-------|
| `PORT` | `3000` (Railway lo pone automático) |
| `API_SECRET` | Pon una clave segura, ejemplo: `qipi-prod-2024` |

## Pasos para desplegar

1. Subir este repo a GitHub
2. En Railway: New Project → GitHub Repository → seleccionar este repo
3. Agregar variable de entorno `API_SECRET`
4. Esperar el deploy y abrir los logs
5. Escanear el QR que aparece en los logs con el chip de QIPI
6. Una vez conectado, llamar a `GET /groups` para obtener el ID del grupo

## Cómo obtener el ID del grupo

Una vez conectado, hacer:

```bash
curl -H "x-api-secret: TU_SECRET" https://TU_URL.railway.app/groups
```

Responde algo como:
```json
{
  "groups": [
    { "id": "120363XXXXXXXX@g.us", "name": "QIPI Entregas 🚀" }
  ]
}
```

Copia el `id` del grupo correcto y úsalo en la Edge Function de Supabase.

## Ejemplo de envío de mensaje

```bash
curl -X POST https://TU_URL.railway.app/send-message \
  -H "x-api-secret: TU_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "120363XXXXXXXX@g.us",
    "message": "✅ Pedido RUM-058-OE-0007 de Tienda XYZ fue entregado exitosamente."
  }'
```
