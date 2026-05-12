import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { INSTITUTIONS, getInstitutionContext } from "./institutions.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const KLARWAY_HELP_URL =
  "https://ayuda.klarway.com/pagina-de-ayuda-de-klarway/";

const sessions = new Map();

function getSession(sessionId) {
  const id = sessionId || "default-session";

  if (!sessions.has(id)) {
    sessions.set(id, {
      fullName: null,
      email: null,
      institutionId: null,
      institutionName: null,
      product: null,
      lms: null,
      attempts: 0,
    });
  }

  return sessions.get(id);
}

function getInstitutionListForAI() {
  return INSTITUTIONS.map((institution) => {
    return `- ID: ${institution.id} | Nombre: ${institution.name} | Producto: ${institution.product} | LMS: ${institution.lms}`;
  }).join("\n");
}

function getInstitutionById(institutionId) {
  return INSTITUTIONS.find((i) => i.id === institutionId) || null;
}

const SYSTEM_PROMPT = `
Sos Klaris, el asistente virtual de soporte técnico de Klarway.

IDENTIDAD:
- Sos Klaris.
- Nunca digas que sos ChatGPT.
- Nunca digas que sos un modelo de OpenAI.
- Representás al soporte técnico de Klarway.

IDIOMA:
- Respondé en español o inglés según el idioma del estudiante.
- Usá lenguaje simple.

MEMORIA DE SESIÓN:
- Usá siempre DATOS GUARDADOS DE LA SESIÓN.
- Si ya hay nombre, mail e institución en sesión, NO vuelvas a pedirlos.
- Si Producto Klarway es "App", asumí que usa la aplicación de Klarway.
- Si Producto Klarway es "Extension", asumí que usa la extensión de Chrome.
- No vuelvas a pedir institución si ya está guardada.
- Solo pedí confirmación si la institución fue inferida por aproximación o si hay varias opciones posibles.

DETECCIÓN INTELIGENTE DE INSTITUCIÓN:
- Compará la institución escrita por el estudiante contra LISTA DE INSTITUCIONES DISPONIBLES.
- Podés detectar errores de tipeo, abreviaturas o formas alternativas.
- Ejemplo: "Sigloxxi", "Siglo XXI" o "UES21" pueden corresponder a "Siglo 21".
- Si encontrás una coincidencia probable, preguntá confirmación antes de diagnosticar.
- Si hay más de una posibilidad, mostrá máximo 3 opciones y pedí que elija.
- Si no hay coincidencia clara, pedí que escriba el nombre completo de la institución.
- Si la institución ya está confirmada y el producto está definido, no preguntes App o Extensión.

DATOS MÍNIMOS:
Antes de diagnosticar, necesitás:
1. Nombre y apellido
2. Mail personal o institucional
3. Institución

Pero si esos datos ya están en sesión, NO los vuelvas a pedir.

ESTILO:
- Claro, simple y paciente.
- Una pregunta por vez.
- Máximo 3 a 5 pasos.
- Una instrucción por paso.
- No uses jerga técnica.
- No culpes al estudiante.

FUENTE OFICIAL:
La documentación oficial es:
${KLARWAY_HELP_URL}

Usá solamente el contexto oficial incluido en el mensaje.
No inventes soluciones.
No inventes links.

CATEGORÍAS:
1. Instalación incorrecta o navegador incorrecto
2. Permisos de cámara o micrófono
3. Cámara en uso por otra aplicación
4. Ruido ambiente
5. Iluminación
6. Otro

FORMATO:
- Explicación breve
- Pasos numerados
- Referencia oficial si aplica
- Pregunta final

FALLBACK ES:
En este caso, te recomiendo contactar directamente con tu institución para que puedan ayudarte con tu situación específica. Voy a derivar tu caso.

FALLBACK EN:
In this case, I recommend contacting your institution so they can assist you with your specific situation. I will escalate your case.

REGLAS:
- No pidas contraseñas.
- No pidas DNI.
- No pidas datos sensibles.
- No repitas pedidos de datos ya guardados.
- Si el problema persiste después de varios intentos, derivá.
`;

function getBasicKlarwayContext(message) {
  const text = String(message || "").toLowerCase();

  const commonContext = `
Fuente oficial:
${KLARWAY_HELP_URL}

Contexto general:
Klarway puede requerir Google Chrome, permisos de cámara y micrófono, buena iluminación, ambiente silencioso y que la cámara no esté siendo usada por otra aplicación.
`;

  if (
    text.includes("camara") ||
    text.includes("cámara") ||
    text.includes("camera") ||
    text.includes("microfono") ||
    text.includes("micrófono") ||
    text.includes("microphone")
  ) {
    return `
${commonContext}

Tema probable:
Problema de cámara o micrófono.

Guía:
- Revisar permisos del navegador.
- Verificar que otra app como Zoom, Meet o Teams no esté usando la cámara.
- Recargar la página del examen.
`;
  }

  if (
    text.includes("chrome") ||
    text.includes("navegador") ||
    text.includes("browser") ||
    text.includes("extension") ||
    text.includes("extensión")
  ) {
    return `
${commonContext}

Tema probable:
Instalación o navegador.

Guía:
- Verificar si corresponde extensión de Chrome o aplicación.
- Si corresponde extensión, usar Google Chrome.
- Verificar que la extensión esté instalada.
`;
  }

  if (
    text.includes("ruido") ||
    text.includes("noise") ||
    text.includes("sonido")
  ) {
    return `
${commonContext}

Tema probable:
Ruido ambiente.

Guía:
- Buscar un lugar silencioso.
- Evitar hablar durante el examen.
- Reducir ruidos externos.
`;
  }

  if (
    text.includes("luz") ||
    text.includes("iluminacion") ||
    text.includes("iluminación") ||
    text.includes("light")
  ) {
    return `
${commonContext}

Tema probable:
Iluminación.

Guía:
- Ubicarse en un lugar bien iluminado.
- Evitar estar a contraluz.
- Mantener el rostro visible.
`;
  }

  return commonContext;
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "klarway-student-assistant",
    assistant: "Klaris",
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const {
      message,
      sessionId,
      fullName,
      email,
      institutionId,
      institutionName,
      confirmedInstitutionId,
      history = [],
    } = req.body;

    if (!message) {
      return res.status(400).json({
        reply: "Falta el mensaje del usuario.",
      });
    }

    const session = getSession(sessionId);

    if (fullName) session.fullName = fullName;
    if (email) session.email = email;
    if (institutionName) session.institutionName = institutionName;

    if (confirmedInstitutionId || institutionId) {
      const selectedInstitution =
        getInstitutionById(confirmedInstitutionId || institutionId);

      if (selectedInstitution) {
        session.institutionId = selectedInstitution.id;
        session.institutionName = selectedInstitution.name;
        session.product = selectedInstitution.product;
        session.lms = selectedInstitution.lms;
      }
    }

    const institutionContext = session.institutionId
      ? getInstitutionContext(session.institutionId)
      : "Institución no confirmada todavía.";

    const klarwayContext = getBasicKlarwayContext(message);

    session.attempts += 1;

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      instructions: SYSTEM_PROMPT,
      input: [
        ...history,
        {
          role: "user",
          content: `
DOCUMENTACIÓN OFICIAL DE KLARWAY:
${klarwayContext}

DATOS GUARDADOS DE LA SESIÓN:
Nombre y apellido: ${session.fullName || "No disponible"}
Mail: ${session.email || "No disponible"}
Institución escrita o guardada: ${session.institutionName || "No disponible"}
Institución confirmada ID: ${session.institutionId || "No disponible"}
Producto Klarway: ${session.product || "No disponible"}
LMS: ${session.lms || "No disponible"}
Intentos de solución: ${session.attempts}

INSTITUCIÓN CONFIRMADA:
${institutionContext}

LISTA DE INSTITUCIONES DISPONIBLES:
${getInstitutionListForAI()}

INSTRUCCIÓN IMPORTANTE:
Si la institución escrita parece coincidir con una de la lista, pedí confirmación antes de diagnosticar.
Si ya hay Institución confirmada ID y Producto Klarway, no vuelvas a pedir institución ni App/Extensión.
Si ya hay nombre y mail en sesión, no los vuelvas a pedir.

MENSAJE DEL ESTUDIANTE:
${message}
`,
        },
      ],
      temperature: 0.2,
      max_output_tokens: 450,
    });

    res.json({
      reply: response.output_text,
      session: {
        fullName: session.fullName,
        email: session.email,
        institutionId: session.institutionId,
        institutionName: session.institutionName,
        product: session.product,
        lms: session.lms,
        attempts: session.attempts,
      },
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      reply:
        "Ocurrió un error al generar la respuesta. Probá nuevamente en unos segundos.",
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Klarway student assistant running on port ${PORT}`);
});
