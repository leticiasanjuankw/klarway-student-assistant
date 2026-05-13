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
      pendingInstitutionId: null,
      pendingInstitutionName: null,
      pendingProduct: null,
      pendingLms: null,
      pendingMatches: [],
      attempts: 0,
    });
  }

  return sessions.get(id);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function isAffirmative(message) {
  const normalized = normalizeText(message);

  return [
    "si",
    "sí",
    "yes",
    "ok",
    "correcto",
    "correcta",
    "confirmo",
    "confirmada",
    "confirmado",
  ].includes(normalized);
}

function isNegative(message) {
  const normalized = normalizeText(message);

  return [
    "no",
    "ninguna",
    "ninguno",
    "incorrecto",
    "incorrecta",
  ].includes(normalized);
}

function detectSystemPreference(message) {
  const text = normalizeText(message);

  if (
    text.includes("extension") ||
    text.includes("extencion") ||
    text.includes("chrome")
  ) {
    return "Extension";
  }

  if (
    text.includes("app") ||
    text.includes("aplicacion") ||
    text.includes("desktop") ||
    text.includes("escritorio")
  ) {
    return "App";
  }

  return null;
}

function findInstitutionById(id) {
  return INSTITUTIONS.find((institution) => institution.id === id) || null;
}

function getSystemTypeLabel(product) {
  if (product === "App") return "la aplicación de Klarway";
  if (product === "Extension") return "la extensión de Chrome";
  return "Klarway";
}

function getInstitutionDisplay(institution) {
  return `${institution.name} | Sistema: ${getSystemTypeLabel(
    institution.product
  )} | LMS: ${institution.lms || "No disponible"}`;
}

function confirmInstitution(session, institution) {
  session.institutionId = institution.id;
  session.institutionName = institution.name;
  session.product = institution.product;
  session.lms = institution.lms;
  session.pendingInstitutionId = null;
  session.pendingInstitutionName = null;
  session.pendingProduct = null;
  session.pendingLms = null;
  session.pendingMatches = [];
}

function findInstitutionCandidates(institutionName) {
  if (!institutionName) return [];

  const normalizedInput = normalizeText(institutionName);

  return INSTITUTIONS.filter((institution) => {
    const normalizedName = normalizeText(institution.name);

    return (
      normalizedName === normalizedInput ||
      normalizedName.includes(normalizedInput) ||
      normalizedInput.includes(normalizedName)
    );
  });
}

function expandRelatedInstitutions(baseInstitution) {
  if (!baseInstitution) return [];

  const baseName = normalizeText(baseInstitution.name);

  return INSTITUTIONS.filter((institution) => {
    const name = normalizeText(institution.name);

    return (
      name === baseName ||
      name.includes(baseName) ||
      baseName.includes(name)
    );
  });
}

function uniqueInstitutions(institutions) {
  const seen = new Set();

  return institutions.filter((institution) => {
    if (!institution || seen.has(institution.id)) return false;
    seen.add(institution.id);
    return true;
  });
}

async function findInstitutionWithAI(institutionName) {
  if (!institutionName) {
    return {
      status: "missing",
      matches: [],
    };
  }

  const deterministicMatches = findInstitutionCandidates(institutionName);

  if (deterministicMatches.length > 0) {
    const expanded = uniqueInstitutions(
      deterministicMatches.flatMap((institution) =>
        expandRelatedInstitutions(institution)
      )
    );

    return {
      status: expanded.length === 1 ? "probable_match" : "multiple_matches",
      matches: expanded.slice(0, 5),
    };
  }

  const institutionList = INSTITUTIONS.map(
    (institution) =>
      `ID: ${institution.id} | Nombre: ${institution.name} | Producto: ${institution.product} | LMS: ${institution.lms}`
  ).join("\n");

  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    instructions: `
Compará el nombre de institución escrito por el estudiante con la lista disponible.

Devolvé SOLO JSON válido.
No expliques.
No uses markdown.
No inventes instituciones.

Reglas:
- Si hay una coincidencia probable, devolvé status "probable_match".
- Si hay varias posibles para la misma institución, devolvé status "multiple_matches".
- Si no hay coincidencia clara, devolvé status "not_found".
- Máximo 5 matches.
- No confirmes automáticamente.
`,
    input: `
Institución escrita por el estudiante:
${institutionName}

Lista de instituciones disponibles:
${institutionList}

Formato exacto:
{
  "status": "probable_match" | "multiple_matches" | "not_found",
  "matches": [
    {
      "id": "string",
      "name": "string",
      "product": "string",
      "lms": "string"
    }
  ]
}
`,
    temperature: 0,
    max_output_tokens: 500,
  });

  try {
    const parsed = JSON.parse(response.output_text);

    const rawMatches = Array.isArray(parsed.matches)
      ? parsed.matches
          .map((match) => findInstitutionById(match.id))
          .filter(Boolean)
      : [];

    const expanded = uniqueInstitutions(
      rawMatches.flatMap((institution) => expandRelatedInstitutions(institution))
    );

    return {
      status:
        expanded.length > 1
          ? "multiple_matches"
          : parsed.status || "not_found",
      matches: expanded.length > 0 ? expanded.slice(0, 5) : rawMatches.slice(0, 5),
    };
  } catch (error) {
    return {
      status: "not_found",
      matches: [],
    };
  }
}

function findRelatedAlternativeByProduct(session, product) {
  if (!session.institutionName) return null;

  const normalizedCurrentName = normalizeText(session.institutionName);

  return INSTITUTIONS.find((institution) => {
    const normalizedName = normalizeText(institution.name);

    return (
      institution.product === product &&
      (normalizedName.includes(normalizedCurrentName) ||
        normalizedCurrentName.includes(normalizedName))
    );
  });
}

function getSupportTextForInstitution(session) {
  const institution = findInstitutionById(session.institutionId);

  if (!institution) {
    return "No tengo datos de contacto específicos para tu institución.";
  }

  const phone = institution.supportPhone || "No disponible";
  const email = institution.supportEmail || "No disponible";

  return `
Datos de contacto de tu institución:
- Institución: ${institution.name}
- Teléfono de soporte: ${phone}
- Mail de soporte: ${email}
`;
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
- Si ya hay nombre, mail e institución confirmada, NO vuelvas a pedirlos.
- Si Producto Klarway es "App", asumí que usa la aplicación de Klarway.
- Si Producto Klarway es "Extension", asumí que usa la extensión de Chrome.
- No vuelvas a pedir institución si ya está confirmada.
- No vuelvas a pedir App o Extensión si Producto Klarway ya está definido.
- Si el estudiante corrige el sistema y dice que usa extensión o app, respetá el sistema actualizado por backend.

SISTEMA CONFIRMADO:
- Si Producto Klarway es "Extension", todas las respuestas deben referirse a la extensión de Chrome.
- Si Producto Klarway es "App", todas las respuestas deben referirse a la aplicación de Klarway.
- Si el usuario pregunta cómo ver si la extensión está instalada o activada, respondé sobre Chrome y chrome://extensions/.
- No cambies a cámara, micrófono o app si la pregunta actual es sobre instalación, activación o verificación de extensión.

DATOS MÍNIMOS:
Antes de diagnosticar necesitás:
1. Nombre y apellido
2. Mail personal o institucional
3. Institución confirmada

Pero si esos datos ya están en sesión, NO los vuelvas a pedir.

INSTITUCIÓN:
- Si el backend dice que la institución está confirmada, usala.
- Si el backend dice que hay institución pendiente, esperá confirmación del estudiante.
- Si Producto Klarway está definido, usalo para decidir App o Extensión.
- Si hay más de una configuración para la misma institución, preguntá cuál usa según el LMS o sistema indicado.

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
- Si el problema persiste después de varios intentos, derivá y mostrale los datos de contacto de la institución si están disponibles.
`;

function getBasicKlarwayContext(message, session) {
  const text = String(message || "").toLowerCase();
  const normalized = normalizeText(message);

  const commonContext = `
Fuente oficial:
${KLARWAY_HELP_URL}

Contexto general:
Klarway puede requerir Google Chrome, permisos de cámara y micrófono, buena iluminación, ambiente silencioso y que la cámara no esté siendo usada por otra aplicación.
`;

  if (
    session.product === "Extension" &&
    (normalized.includes("extension") ||
      normalized.includes("instalada") ||
      normalized.includes("instalar") ||
      normalized.includes("activada") ||
      normalized.includes("activar") ||
      normalized.includes("version") ||
      normalized.includes("chrome"))
  ) {
    return `
${commonContext}

Tema probable:
Extensión de Chrome.

Guía:
- Para verificar la extensión, abrir Google Chrome.
- Ir a chrome://extensions/.
- Buscar Klarway en la lista.
- Verificar que esté activada.
- Si no aparece, debe instalarse desde el enlace oficial indicado por la institución o la documentación oficial.
`;
  }

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
    text.includes("extensión") ||
    text.includes("instalada") ||
    text.includes("activada")
  ) {
    return `
${commonContext}

Tema probable:
Extensión o navegador.

Guía:
- Si corresponde extensión, usar Google Chrome.
- Abrir chrome://extensions/.
- Buscar Klarway.
- Verificar que esté instalada y activada.
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
      institutionName,
      confirmedInstitutionId,
      selectedInstitutionId,
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

    const systemPreference = detectSystemPreference(message);

    if (confirmedInstitutionId || selectedInstitutionId) {
      const confirmed = findInstitutionById(
        confirmedInstitutionId || selectedInstitutionId
      );

      if (confirmed) {
        confirmInstitution(session, confirmed);

        return res.json({
          reply: `Perfecto, confirmé tu institución: ${confirmed.name}. Usás ${getSystemTypeLabel(
            confirmed.product
          )}. ¿En qué puedo ayudarte?`,
          flowStep: "institution_confirmed",
          needsInstitutionConfirmation: false,
          canContinueToProblem: true,
          session,
        });
      }
    }

    if (session.pendingInstitutionId && isAffirmative(message)) {
      const confirmed = findInstitutionById(session.pendingInstitutionId);

      if (confirmed) {
        confirmInstitution(session, confirmed);

        return res.json({
          reply: `Perfecto, confirmé tu institución: ${confirmed.name}. Usás ${getSystemTypeLabel(
            confirmed.product
          )}. ¿En qué puedo ayudarte?`,
          flowStep: "institution_confirmed",
          needsInstitutionConfirmation: false,
          canContinueToProblem: true,
          session,
        });
      }
    }

    if (session.pendingInstitutionId && isNegative(message)) {
      session.pendingInstitutionId = null;
      session.pendingInstitutionName = null;
      session.pendingProduct = null;
      session.pendingLms = null;
      session.pendingMatches = [];

      return res.json({
        reply:
          "Entendido. Por favor, escribí el nombre completo de tu institución.",
        flowStep: "institution_not_confirmed",
        needsInstitutionConfirmation: true,
        canContinueToProblem: false,
        matches: [],
        session,
      });
    }

    if (session.institutionId && systemPreference && session.product !== systemPreference) {
      const alternative = findRelatedAlternativeByProduct(session, systemPreference);

      if (alternative) {
        confirmInstitution(session, alternative);

        return res.json({
          reply: `Perfecto, actualicé el sistema: para ${alternative.name} estás usando ${getSystemTypeLabel(
            alternative.product
          )}. ¿En qué puedo ayudarte?`,
          flowStep: "system_updated",
          needsInstitutionConfirmation: false,
          canContinueToProblem: true,
          session,
        });
      }
    }

    if (!session.institutionId && institutionName) {
      session.institutionName = institutionName;

      const institutionResult = await findInstitutionWithAI(institutionName);

      if (
        institutionResult.status === "probable_match" &&
        institutionResult.matches.length === 1
      ) {
        const match = institutionResult.matches[0];

        session.pendingInstitutionId = match.id;
        session.pendingInstitutionName = match.name;
        session.pendingProduct = match.product;
        session.pendingLms = match.lms;
        session.pendingMatches = institutionResult.matches;

        return res.json({
          reply: `Encontré una posible coincidencia: ${match.name}. ¿Tu institución es esa?`,
          flowStep: "confirm_institution",
          needsInstitutionConfirmation: true,
          canContinueToProblem: false,
          matches: institutionResult.matches,
          session,
        });
      }

      if (
        institutionResult.status === "multiple_matches" &&
        institutionResult.matches.length > 0
      ) {
        session.pendingMatches = institutionResult.matches;

        const options = institutionResult.matches
          .map((institution, index) => `${index + 1}. ${getInstitutionDisplay(institution)}`)
          .join("\n");

        return res.json({
          reply: `Encontré más de una configuración para esa institución. ¿Con cuál sistema rendís?\n\n${options}`,
          flowStep: "choose_institution_system",
          needsInstitutionConfirmation: true,
          canContinueToProblem: false,
          matches: institutionResult.matches,
          session,
        });
      }

      return res.json({
        reply:
          "No pude identificar tu institución. ¿Podés escribir el nombre completo?",
        flowStep: "institution_not_found",
        needsInstitutionConfirmation: true,
        canContinueToProblem: false,
        matches: [],
        session,
      });
    }

    if (!session.institutionId && session.pendingMatches.length > 0) {
      const normalizedMessage = normalizeText(message);

      const selectedByNumber = Number(normalizedMessage);
      if (
        selectedByNumber &&
        selectedByNumber >= 1 &&
        selectedByNumber <= session.pendingMatches.length
      ) {
        const selected = session.pendingMatches[selectedByNumber - 1];
        confirmInstitution(session, selected);

        return res.json({
          reply: `Perfecto, confirmé tu institución: ${selected.name}. Usás ${getSystemTypeLabel(
            selected.product
          )}. ¿En qué puedo ayudarte?`,
          flowStep: "institution_confirmed",
          needsInstitutionConfirmation: false,
          canContinueToProblem: true,
          session,
        });
      }

      const selectedBySystem = session.pendingMatches.find((institution) => {
        if (normalizedMessage.includes("extension") && institution.product === "Extension") {
          return true;
        }

        if (
          (normalizedMessage.includes("app") ||
            normalizedMessage.includes("aplicacion")) &&
          institution.product === "App"
        ) {
          return true;
        }

        return normalizeText(institution.lms).includes(normalizedMessage);
      });

      if (selectedBySystem) {
        confirmInstitution(session, selectedBySystem);

        return res.json({
          reply: `Perfecto, confirmé tu institución: ${selectedBySystem.name}. Usás ${getSystemTypeLabel(
            selectedBySystem.product
          )}. ¿En qué puedo ayudarte?`,
          flowStep: "institution_confirmed",
          needsInstitutionConfirmation: false,
          canContinueToProblem: true,
          session,
        });
      }
    }

    const hasMinimumData =
      Boolean(session.fullName) &&
      Boolean(session.email) &&
      Boolean(session.institutionId);

    if (!hasMinimumData) {
      return res.json({
        reply:
          "Para poder ayudarte, primero necesito estos datos:\n\n1. Nombre y apellido\n2. Mail personal o institucional\n3. Institución donde tenés que rendir el examen",
        flowStep: "collect_student_data",
        needsInstitutionConfirmation: false,
        canContinueToProblem: false,
        session,
      });
    }

    const institutionContext = getInstitutionContext(session.institutionId);
    const klarwayContext = getBasicKlarwayContext(message, session);
    const supportText = getSupportTextForInstitution(session);

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
Nombre y apellido: ${session.fullName}
Mail: ${session.email}
Institución confirmada: ${session.institutionName}
Institución confirmada ID: ${session.institutionId}
Producto Klarway: ${session.product}
LMS: ${session.lms}
Intentos de solución: ${session.attempts}

INSTITUCIÓN CONFIRMADA:
${institutionContext}

CONTACTO DE LA INSTITUCIÓN:
${supportText}

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
      flowStep: "answer_problem",
      needsInstitutionConfirmation: false,
      canContinueToProblem: true,
      session,
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
