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
  "https://klarway-web.fly.dev/soporte/";

const CHROME_STORE_KLARWAY_URL =
  "https://chromewebstore.google.com/search/klarway?hl=es&utm_source=ext_sidebar";

const KLARWAY_FAQS = `
PREGUNTAS FRECUENTES:

¿Qué ocurre si no se puede tomar la fotografía de mi rostro?
Deberás contactarte con la mesa de ayuda de tu institución para recibir asesoramiento.
El registro podrá completarse cuando la imagen haya sido correctamente tomada.
Tu cara debe verse completa.
Evita usar accesorios como gafas, gorros, auriculares, pañuelos, bufandas, etc.

¿Qué ocurre si no se puede tomar la fotografía de mi identificación?
Deberás aguardar a que la institución valide tus datos de forma manual.
Solo podrás realizar exámenes una vez que el registro haya sido aprobado.
La fotografía puede fallar si la imagen del rostro está oscura o tiene marcas que impiden su correcta captura.

¿Tengo que registrarme cada vez que realizo el examen?
No. El registro se realiza solo una vez. Luego podrás realizar tus exámenes.

¿Qué debo hacer si deseo cambiar mi registro?
Deberás comunicarte con tu institución y solicitar el pedido.

¿Dónde encuentro el estado de mi registro manual?
Debés ingresar al botón "Registro Klarway".
Los estados posibles son:
- En revisión: tu registro continúa en verificación y aún no podés realizar exámenes.
- Rechazado: tendrás que registrarte nuevamente y no podés realizar exámenes hasta que quede aprobado.
`;

const KLARWAY_KNOWLEDGE = `
CENTRO DE AYUDA:
Buscá la información que necesites para hacer tu examen con proctoring de manera segura y tranquilo.
Guía completa por tipo de producto, sistema operativo y asistente IA.

IMPORTANTE:
Si no encontraste lo que buscabas, contactate con tu institución.

REGLA PARA APP O EXTENSIÓN:
El sistema que usa el estudiante se define por la institución confirmada y por su campo Producto:
- Producto "App" = aplicación de Klarway.
- Producto "Extension" = extensión de Chrome.
No cambiar esta definición por lo que diga el estudiante. Si hay conflicto, aclarar usando la institución confirmada.

REQUISITOS:
Los requisitos son iguales para app y extensión.
En extensión es necesario usar Google Chrome.
https://klarway-web.fly.dev/soporte/requisitos-extension

EXTENSIÓN:
Instalación:
https://klarway-web.fly.dev/soporte/instalacion-extension

Registro:
https://klarway-web.fly.dev/soporte/registro-extension

Realizar un examen:
https://klarway-web.fly.dev/soporte/examen-extension-sin-sg-sin-ec

APP:

Instalacion:
https://klarway-web.fly.dev/soporte/instalacion-aplicacion

Registro:
https://klarway-web.fly.dev/soporte/registro-aplicacion

Realizar un examen:
https://klarway-web.fly.dev/soporte/realizar-un-examen

APP MAC:
Instalar Klarway:
https://klarway-web.fly.dev/soporte/instalacion-aplicacion

Permisos de cámara, micrófono y grabación de pantalla:
https://klarway-web.fly.dev/soporte/permisos-camara-mac

Cerrar procesos abiertos:
https://klarway-web.fly.dev/soporte/cerrar-procesos-mac

Desinstalar cámaras virtuales:
https://klarway-web.fly.dev/soporte/camaras-virtuales-mac

APP WINDOWS:
Instalar Klarway:
https://klarway-web.fly.dev/soporte/instalacion-aplicacion

Permiso de cámara y micrófono:
https://klarway-web.fly.dev/soporte/permisos-camara-windows

Cerrar procesos abiertos:
https://klarway-web.fly.dev/soporte/cerrar-procesos-windows

Desinstalar cámaras virtuales:
https://klarway-web.fly.dev/soporte/camaras-virtuales-windows

ANTIVIRUS WINDOWS:
Avast:
https://klarway-web.fly.dev/soporte/antivirus-avast

Windows Defender:
https://klarway-web.fly.dev/soporte/antivirus-defender

Norton:
https://klarway-web.fly.dev/soporte/antivirus-norton

McAfee:
https://klarway-web.fly.dev/soporte/antivirus-mcafee

Kaspersky:
https://klarway-web.fly.dev/soporte/antivirus-kaspersky
`;

const sessions = new Map();

/*
  Aliases para que la búsqueda de institución sea instantánea.
  Agregá acá siglas o formas comunes que escriben los estudiantes.
*/
const INSTITUTION_ALIASES = {
  unac: ["unac idiomas"],
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalizeInstitutionText(value) {
  return normalizeText(value)
    .replace(/xxi/g, "21")
    .replace(/sigloveintiuno/g, "siglo21")
    .replace(/veintiuno/g, "21");
}

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
      dailyMessageCount: 0,
      dailyMessageDate: new Date().toISOString().slice(0, 10),
      verifiedSteps: [],
      lastProblem: null,
      humanHelpRequested: false,
    });
  }

  return sessions.get(id);
}

function isAffirmative(message) {
  return [
    "si",
    "sí",
    "yes",
    "ok",
    "okay",
    "dale",
    "correcto",
    "correcta",
    "confirmo",
    "asi es",
    "asies",
  ].includes(normalizeText(message));
}

function isNegative(message) {
  return ["no", "ninguna", "ninguno", "incorrecto", "incorrecta"].includes(
    normalizeText(message)
  );
}

function similarity(a, b) {
  if (!a || !b) return 0;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1;

  const distance = levenshteinDistance(longer, shorter);

  return (longer.length - distance) / longer.length;
}

function levenshteinDistance(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function isProblemSolvedMessage(message) {
  return [
    "si",
    "sí",
    "yes",
    "listo",
    "funciono",
    "funcionó",
    "yaesta",
    "resuelto",
    "solucionado",
    "perfecto",
    "gracias",
    "muchasgracias",
  ].includes(normalizeText(message));
}

function needsHumanHelp(message) {
  const text = normalizeText(message);

  return (
    text.includes("ayudahumana") ||
    text.includes("humano") ||
    text.includes("persona") ||
    text.includes("asesor") ||
    text.includes("soportehumano") ||
    text.includes("hablarconalguien") ||
    text.includes("derivar") ||
    text.includes("necesitoayudahumana")
  );
}

function detectOS(message) {
  const text = normalizeText(message);

  if (text.includes("mac") || text.includes("ios") || text.includes("apple")) {
    return "mac";
  }

  if (text.includes("windows") || text.includes("win") || text.includes("pc")) {
    return "windows";
  }

  return null;
}

function findInstitutionById(id) {
  return INSTITUTIONS.find((institution) => institution.id === id) || null;
}

function getInstitutionDisplay(institution) {
  return `${institution.name} | Sistema: ${
    institution.lms || "No disponible"
  }`;
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

function getInstitutionSearchTexts(institution) {
  const normalizedName = normalizeInstitutionText(institution.name);

  const aliases = Object.entries(INSTITUTION_ALIASES)
    .filter(([, institutionNames]) =>
      institutionNames.some(
        (institutionName) =>
          normalizeInstitutionText(institutionName) === normalizedName
      )
    )
    .map(([alias]) => normalizeInstitutionText(alias));

  return [normalizedName, ...aliases];
}

function findInstitutionCandidates(institutionName) {
  if (!institutionName) return [];

  const normalizedInput = normalizeInstitutionText(institutionName);

  if (!normalizedInput) return [];

  return INSTITUTIONS.filter((institution) => {
    const searchTexts = getInstitutionSearchTexts(institution);

    return searchTexts.some((text) => {
      return (
        text === normalizedInput ||
        text.includes(normalizedInput) ||
        normalizedInput.includes(text) ||
        similarity(text, normalizedInput) >= 0.7
      );
    });
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

/*
  Búsqueda instantánea de institución.
  No llama a OpenAI. Usa solo INSTITUTIONS + aliases.
*/
function findInstitutionInstant(institutionName) {
  if (!institutionName) {
    return {
      status: "missing",
      matches: [],
    };
  }

  const matches = findInstitutionCandidates(institutionName);

  if (matches.length === 0) {
    return {
      status: "not_found",
      matches: [],
    };
  }

  const expanded = uniqueInstitutions(
    matches.flatMap((institution) => expandRelatedInstitutions(institution))
  );

  if (expanded.length === 1) {
    return {
      status: "probable_match",
      matches: expanded,
    };
  }

  return {
    status: "multiple_matches",
    matches: expanded.slice(0, 5),
  };
}

function confirmsPendingInstitutionByName(session, message) {
  if (!session.pendingInstitutionName) return false;

  return (
    normalizeInstitutionText(message) ===
    normalizeInstitutionText(session.pendingInstitutionName)
  );
}

/*
  Validación simple pedida:
  el email debe tener al menos un @.
*/
function looksLikeEmail(value) {
  return String(value || "").includes("@");
}

function looksLikeProblemMessage(message) {
  const text = normalizeText(message);

  return (
    text.includes("problema") ||
    text.includes("error") ||
    text.includes("noanda") ||
    text.includes("nofunciona") ||
    text.includes("camara") ||
    text.includes("microfono") ||
    text.includes("pantalla") ||
    text.includes("instalar") ||
    text.includes("instalacion") ||
    text.includes("extension") ||
    text.includes("app") ||
    text.includes("examen") ||
    text.includes("registro") ||
    text.includes("validacion") ||
    text.includes("validar") ||
    text.includes("antivirus") ||
    text.includes("bloqueado") ||
    text.includes("permiso")
  );
}

function getSupportTextForInstitution(session) {
  const institution = findInstitutionById(session.institutionId);

  if (!institution) {
    return "No tengo datos de contacto específicos para tu institución.";
  }

  return `
Datos de contacto de tu institución:
- Institución: ${institution.name}
- Teléfono de soporte: ${institution.supportPhone || "No disponible"}
- Mail de soporte: ${institution.supportEmail || "No disponible"}
`;
}

function addVerifiedStep(session, step) {
  if (!session.verifiedSteps.includes(step)) {
    session.verifiedSteps.push(step);
  }
}

function trackProblem(session, message) {
  const text = String(message || "").toLowerCase();

  session.lastProblem = message;

  if (session.product === "Extension") {
    addVerifiedStep(
      session,
      "Se confirmó que el estudiante usa la extensión de Chrome según su institución."
    );
  }

  if (session.product === "App") {
    addVerifiedStep(
      session,
      "Se confirmó que el estudiante usa la aplicación de Klarway según su institución."
    );
  }

  if (text.includes("extension") || text.includes("extensión")) {
    addVerifiedStep(session, "El estudiante consultó por la extensión.");
  }

  if (text.includes("app") || text.includes("aplicación")) {
    addVerifiedStep(session, "El estudiante consultó por la aplicación.");
  }

  if (text.includes("camara") || text.includes("cámara")) {
    addVerifiedStep(session, "Se revisó un problema relacionado con cámara.");
  }

  if (text.includes("microfono") || text.includes("micrófono")) {
    addVerifiedStep(
      session,
      "Se revisó un problema relacionado con micrófono."
    );
  }

  if (
    text.includes("instalar") ||
    text.includes("instalada") ||
    text.includes("activada")
  ) {
    addVerifiedStep(session, "Se revisaron pasos de instalación o activación.");
  }

  if (text.includes("antivirus")) {
    addVerifiedStep(session, "Se revisó posible interferencia de antivirus.");
  }
}

function buildHumanHelpSummary(session) {
  const steps =
    session.verifiedSteps.length > 0
      ? session.verifiedSteps.map((step) => `- ${step}`).join("\n")
      : "- No hay pasos técnicos registrados todavía.";

  return `
Te recomiendo contactar a tu institución con este resumen:

Datos del estudiante:
- Nombre: ${session.fullName || "No disponible"}
- Mail: ${session.email || "No disponible"}
- Institución: ${session.institutionName || "No disponible"}
- Sistema: ${session.lms || "No disponible"}

Problema informado:
${session.lastProblem || "Pedido de ayuda humana."}

Pasos verificados:
${steps}

${getSupportTextForInstitution(session)}
`;
}

function shouldDeliverHumanHelp(session) {
  return (
    session.humanHelpRequested &&
    Boolean(session.fullName) &&
    looksLikeEmail(session.email) &&
    Boolean(session.institutionId)
  );
}

const SYSTEM_PROMPT = `
Sos Klaris, el asistente virtual de soporte técnico de Klarway.

REGLAS PRINCIPALES:
- Sé amable, breve y concreto.
- Respondé directo al problema.
- No saludes al estudiante en cada respuesta.
- No empieces con "Hola", "Hola [nombre]", "Gracias por contactarte" ni frases similares.
- No uses el nombre del estudiante para saludar.
- No des explicaciones internas si el estudiante no las pide.
- No menciones el LMS/Sistema en mensajes de confirmación de institución.
- Hacé una sola pregunta por mensaje.
- Evitá mensajes largos cuando una frase corta alcanza.
- Podés usar enlaces en formato Markdown.
- No muestres una URL completa si podés usar un hipervínculo Markdown.
- Si indicás Google Chrome Store, usá este hipervínculo: [Google Chrome Store](${CHROME_STORE_KLARWAY_URL}).
- Si el estudiante consulta por instalación, activación o verificación de la extensión, no indiques chrome://extensions/. Indicá Google Chrome Store.
- Usá siempre DATOS GUARDADOS DE LA SESIÓN.
- No repitas pedidos de nombre, mail o institución si ya están guardados.
- La definición App o Extensión SIEMPRE viene de Producto Klarway de la institución confirmada.
- No cambies App o Extensión por lo que diga el estudiante.
- Si Producto Klarway es "Extension", respondé sobre la extensión de Chrome.
- Si Producto Klarway es "App", respondé sobre la aplicación de Klarway.
- Si el estudiante dice que usa otro sistema distinto al confirmado por institución, explicá brevemente que según su institución figura otro sistema y pedí que revise las instrucciones de su institución.
- Si el estudiante responde que se resolvió, cerrá breve.
- Si pide ayuda humana, no derives hasta tener nombre, email e institución confirmada.
- Máximo 3 a 5 pasos.
- Una instrucción por paso.
- No pidas DNI, contraseñas ni datos sensibles.
- No inventes links.
- Usá solo el contexto oficial incluido.

FUENTE OFICIAL:
${KLARWAY_HELP_URL}
`;

function getBasicKlarwayContext(message, session) {
  const text = String(message || "").toLowerCase();
  const normalized = normalizeText(message);
  const os = detectOS(message);

  let context = `
${KLARWAY_KNOWLEDGE}
${KLARWAY_FAQS}

Sistema confirmado por institución:
Producto Klarway: ${session.product || "No definido"}
LMS/Sistema: ${session.lms || "No definido"}
`;

  if (session.product === "Extension") {
    context += `
Contexto específico EXTENSIÓN:
- Usar Google Chrome.
- Si el estudiante necesita instalar, verificar o activar la extensión, responder con estos pasos:
1. Accedé a [Google Chrome Store](${CHROME_STORE_KLARWAY_URL}).
2. Confirmá que la extensión Klarway está instalada. Si no lo está, instalala.
- No indiques chrome://extensions/ para instalar, verificar o activar la extensión.
- Registro: https://klarway-web.fly.dev/soporte/registro-extension/
- Examen: https://klarway-web.fly.dev/soporte/examen-extension-sin-sg-sin-ec/
`;
  }

  if (session.product === "App") {
    context += `
Contexto específico APP:
- Registro: https://klarway-web.fly.dev/soporte/registro-aplicacion/
- Examen: https://klarway-web.fly.dev/soporte/examen-aplicacion/
`;
  }

  if (session.product === "App" && os === "mac") {
    context += `
Contexto App Mac:
- Instalación: https://klarway-web.fly.dev/soporte/instalacion-aplicacion/
- Permisos cámara, micrófono y grabación de pantalla: https://klarway-web.fly.dev/soporte/permisos-camara-mac/
- Procesos abiertos: https://klarway-web.fly.dev/soporte/cerrar-procesos-mac/
- Cámaras virtuales: https://klarway-web.fly.dev/soporte/camaras-virtuales-mac/
`;
  }

  if (session.product === "App" && os === "windows") {
    context += `
Contexto App Windows:
- Instalación: https://klarway-web.fly.dev/soporte/instalacion-aplicacion/
- Permiso cámara y micrófono: https://klarway-web.fly.dev/soporte/permisos-camara-windows/
- Procesos abiertos: https://klarway-web.fly.dev/soporte/cerrar-procesos-windows/
- Cámaras virtuales: https://klarway-web.fly.dev/soporte/camaras-virtuales-windows/
`;
  }

  if (session.product === "App" && text.includes("antivirus")) {
    context += `
Contexto antivirus Windows:
- Avast: https://klarway-web.fly.dev/soporte/antivirus-avast/
- Windows Defender: https://klarway-web.fly.dev/soporte/antivirus-defender/
- Norton: https://klarway-web.fly.dev/soporte/antivirus-norton/
- McAfee: https://klarway-web.fly.dev/soporte/antiviruss-mcafee/
- Kaspersky: https://klarway-web.fly.dev/soporte/antivirus-kaspersky/
`;
  }

  if (
    session.product === "App" &&
    (normalized.includes("extension") || normalized.includes("chrome"))
  ) {
    context += `
Aclaración:
Según la institución confirmada, el estudiante figura con App. No cambiar a Extensión.
Si el estudiante insiste en Extensión, pedirle que revise las instrucciones dadas por su institución.
`;
  }

  if (
    session.product === "Extension" &&
    (normalized.includes("app") || normalized.includes("aplicacion"))
  ) {
    context += `
Aclaración:
Según la institución confirmada, el estudiante figura con Extensión. No cambiar a App.
Si el estudiante insiste en App, pedirle que revise las instrucciones dadas por su institución.
`;
  }

  return context;
}

function buildProblemAnswerInput({ message, history, session }) {
  const institutionContext = getInstitutionContext(session.institutionId);
  const klarwayContext = getBasicKlarwayContext(message, session);
  const supportText = getSupportTextForInstitution(session);

  return [
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
Sistema/LMS: ${session.lms}
Intentos de solución: ${session.attempts}
Mensajes usados hoy: ${session.dailyMessageCount}/20

INSTITUCIÓN CONFIRMADA:
${institutionContext}

CONTACTO DE LA INSTITUCIÓN:
${supportText}

PASOS YA VERIFICADOS:
${session.verifiedSteps.map((step) => `- ${step}`).join("\n") || "Sin pasos registrados todavía."}

MENSAJE DEL ESTUDIANTE:
${message}
`,
    },
  ];
}

async function answerProblem({ message, history, session }) {
  trackProblem(session, message);
  session.attempts += 1;

  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    instructions: SYSTEM_PROMPT,
    input: buildProblemAnswerInput({ message, history, session }),
    temperature: 0.2,
    max_output_tokens: 500,
  });

  return response.output_text;
}

function setPendingInstitution(session, institution, matches) {
  session.pendingInstitutionId = institution.id;
  session.pendingInstitutionName = institution.name;
  session.pendingProduct = institution.product;
  session.pendingLms = institution.lms;
  session.pendingMatches = matches;
}

function buildInstitutionSearchResponse(session, institutionText) {
  const institutionResult = findInstitutionInstant(institutionText);

  if (
    institutionResult.status === "probable_match" &&
    institutionResult.matches.length === 1
  ) {
    const match = institutionResult.matches[0];

    setPendingInstitution(session, match, institutionResult.matches);

    return {
      reply: `Encontré ${match.name}. ¿Es tu institución?`,
      flowStep: "confirm_institution",
      needsInstitutionConfirmation: true,
      canContinueToProblem: false,
      matches: institutionResult.matches,
      session,
    };
  }

  if (
    institutionResult.status === "multiple_matches" &&
    institutionResult.matches.length > 0
  ) {
    session.pendingMatches = institutionResult.matches;

    const options = institutionResult.matches
      .map(
        (institution, index) =>
          `${index + 1}. ${getInstitutionDisplay(institution)}`
      )
      .join("\n");

    return {
      reply: `Encontré más de una configuración. ¿Con cuál rendís?\n\n${options}`,
      flowStep: "choose_institution_system",
      needsInstitutionConfirmation: true,
      canContinueToProblem: false,
      matches: institutionResult.matches,
      session,
    };
  }

  return {
    reply:
      "No pude identificar tu institución. ¿Podés escribir el nombre completo?",
    flowStep: "institution_not_found",
    needsInstitutionConfirmation: true,
    canContinueToProblem: false,
    matches: [],
    session,
  };
}

function buildNextRequiredHumanHelpStep(session) {
  if (!session.fullName) {
    return {
      reply: "Para derivarte necesito tus datos. ¿Cuál es tu nombre y apellido?",
      flowStep: "collect_full_name_for_human_help",
      session,
    };
  }

  if (!session.email) {
    return {
      reply: "¿Cuál es tu email?",
      flowStep: "collect_email_for_human_help",
      session,
    };
  }

  if (!looksLikeEmail(session.email)) {
    session.email = null;

    return {
      reply: "El email debe incluir @. ¿Cuál es tu email?",
      flowStep: "collect_email_for_human_help",
      session,
    };
  }

  if (!session.institutionId) {
    return {
      reply: "¿De qué institución sos?",
      flowStep: "collect_institution_for_human_help",
      session,
    };
  }

  return {
    reply: buildHumanHelpSummary(session),
    flowStep: "human_help_requested",
    session,
  };
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
    const trimmedMessage = String(message || "").trim();

    const today = new Date().toISOString().slice(0, 10);

    if (session.dailyMessageDate !== today) {
      session.dailyMessageDate = today;
      session.dailyMessageCount = 0;
    }

    if (session.dailyMessageCount >= 20) {
      return res.json({
        reply:
          "Alcanzaste el límite de 20 mensajes por hoy. Te recomiendo contactar a tu institución para continuar con la asistencia.",
        flowStep: "daily_limit_reached",
        session,
      });
    }

    session.dailyMessageCount += 1;

    if (fullName) session.fullName = fullName;

    if (email) {
      if (looksLikeEmail(email)) {
        session.email = email;
      } else {
        session.email = null;

        return res.json({
          reply: "El email debe incluir @. ¿Cuál es tu email?",
          flowStep: session.humanHelpRequested
            ? "collect_email_for_human_help"
            : "collect_email",
          session,
        });
      }
    }

    if (needsHumanHelp(trimmedMessage)) {
      session.humanHelpRequested = true;
      session.lastProblem = "Pedido de ayuda humana.";

      return res.json(buildNextRequiredHumanHelpStep(session));
    }

    if (
      session.institutionId &&
      !session.pendingInstitutionId &&
      isProblemSolvedMessage(trimmedMessage) &&
      session.attempts > 0
    ) {
      return res.json({
        reply:
          "Perfecto, me alegra que se haya resuelto. Si necesitás algo más, podés escribirme.",
        flowStep: "problem_closed",
        session,
      });
    }

    if (confirmedInstitutionId || selectedInstitutionId) {
      const confirmed = findInstitutionById(
        confirmedInstitutionId || selectedInstitutionId
      );

      if (confirmed) {
        confirmInstitution(session, confirmed);

        if (shouldDeliverHumanHelp(session)) {
          return res.json({
            reply: buildHumanHelpSummary(session),
            flowStep: "human_help_requested",
            session,
          });
        }

        return res.json({
          reply: "¿En qué puedo ayudarte?",
          flowStep: "institution_confirmed",
          needsInstitutionConfirmation: false,
          canContinueToProblem: true,
          session,
        });
      }
    }

    if (
      session.pendingInstitutionId &&
      (isAffirmative(trimmedMessage) ||
        confirmsPendingInstitutionByName(session, trimmedMessage))
    ) {
      const confirmed = findInstitutionById(session.pendingInstitutionId);

      if (confirmed) {
        confirmInstitution(session, confirmed);

        if (shouldDeliverHumanHelp(session)) {
          return res.json({
            reply: buildHumanHelpSummary(session),
            flowStep: "human_help_requested",
            session,
          });
        }

        return res.json({
          reply: "¿En qué puedo ayudarte?",
          flowStep: "institution_confirmed",
          needsInstitutionConfirmation: false,
          canContinueToProblem: true,
          session,
        });
      }
    }

    if (session.pendingInstitutionId && isNegative(trimmedMessage)) {
      session.pendingInstitutionId = null;
      session.pendingInstitutionName = null;
      session.pendingProduct = null;
      session.pendingLms = null;
      session.pendingMatches = [];

      return res.json({
        reply: "Entendido. ¿Cuál es el nombre completo de tu institución?",
        flowStep: session.humanHelpRequested
          ? "collect_institution_for_human_help"
          : "institution_not_confirmed",
        needsInstitutionConfirmation: true,
        canContinueToProblem: false,
        matches: [],
        session,
      });
    }

    if (!session.institutionId && session.pendingMatches.length > 0) {
      const normalizedMessage = normalizeText(trimmedMessage);
      const selectedByNumber = Number(normalizedMessage);

      if (
        selectedByNumber &&
        selectedByNumber >= 1 &&
        selectedByNumber <= session.pendingMatches.length
      ) {
        const selected = session.pendingMatches[selectedByNumber - 1];
        confirmInstitution(session, selected);

        if (shouldDeliverHumanHelp(session)) {
          return res.json({
            reply: buildHumanHelpSummary(session),
            flowStep: "human_help_requested",
            session,
          });
        }

        return res.json({
          reply: "¿En qué puedo ayudarte?",
          flowStep: "institution_confirmed",
          needsInstitutionConfirmation: false,
          canContinueToProblem: true,
          session,
        });
      }

      const selectedBySystem = session.pendingMatches.find((institution) => {
        return normalizeText(institution.lms).includes(normalizedMessage);
      });

      if (selectedBySystem) {
        confirmInstitution(session, selectedBySystem);

        if (shouldDeliverHumanHelp(session)) {
          return res.json({
            reply: buildHumanHelpSummary(session),
            flowStep: "human_help_requested",
            session,
          });
        }

        return res.json({
          reply: "¿En qué puedo ayudarte?",
          flowStep: "institution_confirmed",
          needsInstitutionConfirmation: false,
          canContinueToProblem: true,
          session,
        });
      }
    }

    /*
      Si el frontend manda institutionName como campo separado,
      se usa ese valor. Esto mantiene compatibilidad con tu flujo actual.
    */
    if (!session.institutionId && institutionName) {
      session.institutionName = institutionName;

      return res.json(buildInstitutionSearchResponse(session, institutionName));
    }

    /*
      Flujo de ayuda humana.
      Si el usuario ya pidió ayuda humana, seguimos juntando datos
      hasta tener nombre, email con @ e institución confirmada.
    */
    if (session.humanHelpRequested) {
      if (!session.fullName) {
        if (
          trimmedMessage &&
          !looksLikeEmail(trimmedMessage) &&
          findInstitutionInstant(trimmedMessage).matches.length === 0 &&
          !looksLikeProblemMessage(trimmedMessage)
        ) {
          session.fullName = trimmedMessage;

          return res.json(buildNextRequiredHumanHelpStep(session));
        }

        return res.json(buildNextRequiredHumanHelpStep(session));
      }

      if (!session.email) {
        if (looksLikeEmail(trimmedMessage)) {
          session.email = trimmedMessage;

          return res.json(buildNextRequiredHumanHelpStep(session));
        }

        return res.json({
          reply: "El email debe incluir @. ¿Cuál es tu email?",
          flowStep: "collect_email_for_human_help",
          session,
        });
      }

      if (!looksLikeEmail(session.email)) {
        session.email = null;

        return res.json({
          reply: "El email debe incluir @. ¿Cuál es tu email?",
          flowStep: "collect_email_for_human_help",
          session,
        });
      }

      if (!session.institutionId) {
        return res.json(buildInstitutionSearchResponse(session, trimmedMessage));
      }

      return res.json({
        reply: buildHumanHelpSummary(session),
        flowStep: "human_help_requested",
        session,
      });
    }

    /*
      Flujo normal de datos de a uno, usando también el message.
      Esto evita que Klaris vuelva a pedir datos que el usuario ya escribió.
    */
    if (!session.fullName) {
      if (
        trimmedMessage &&
        !looksLikeEmail(trimmedMessage) &&
        findInstitutionInstant(trimmedMessage).matches.length === 0 &&
        !looksLikeProblemMessage(trimmedMessage)
      ) {
        session.fullName = trimmedMessage;

        return res.json({
          reply: "Gracias. ¿Cuál es tu email?",
          flowStep: "collect_email",
          session,
        });
      }

      return res.json({
        reply: "¿Cuál es tu nombre y apellido?",
        flowStep: "collect_full_name",
        session,
      });
    }

    if (!session.email) {
      if (looksLikeEmail(trimmedMessage)) {
        session.email = trimmedMessage;

        return res.json({
          reply: "¿De qué institución sos?",
          flowStep: "collect_institution",
          session,
        });
      }

      return res.json({
        reply: "El email debe incluir @. ¿Cuál es tu email?",
        flowStep: "collect_email",
        session,
      });
    }

    if (!looksLikeEmail(session.email)) {
      session.email = null;

      return res.json({
        reply: "El email debe incluir @. ¿Cuál es tu email?",
        flowStep: "collect_email",
        session,
      });
    }

    if (!session.institutionId) {
      return res.json(buildInstitutionSearchResponse(session, trimmedMessage));
    }

    const reply = await answerProblem({
      message: trimmedMessage,
      history,
      session,
    });

    return res.json({
      reply,
      flowStep: "answer_problem",
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
