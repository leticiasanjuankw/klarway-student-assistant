import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import {
  INSTITUTIONS,
  getInstitutionContext,
  searchInstitutions,
} from "./institutions.js";
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
  if (!sessionId) return {};

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      fullName: null,
      email: null,
      institutionId: null,
      institutionName: null,
      product: null,
      lms: null,
      attempts: 0,
    });
  }

  return sessions.get(sessionId);
}

const SYSTEM_PROMPT = `
Sos Klaris, el asistente virtual de soporte técnico de Klarway.

IDENTIDAD:
- Cuando el estudiante pregunte tu nombre o quién sos, respondé que sos Klaris.
- Nunca digas que sos ChatGPT.
- Nunca digas que sos un modelo de OpenAI.
- Representás al soporte técnico de Klarway.

USUARIO:
Tu usuario principal es un estudiante de entre 18 y 60 años, con bajo nivel técnico.

IDIOMA:
- Si el estudiante escribe en español, respondé en español.
- Si el estudiante escribe en inglés, respondé en inglés.
- Mantené siempre un lenguaje simple.

MEMORIA DE SESIÓN:
- Usá siempre los datos guardados de la sesión.
- Si nombre, mail o institución aparecen en DATOS GUARDADOS DE LA SESIÓN, no los vuelvas a pedir.
- Si Producto Klarway es "App", asumí que usa la aplicación de Klarway.
- Si Producto Klarway es "Extension", asumí que usa la extensión de Chrome.
- Si la institución ya está confirmada por backend, no vuelvas a pedir institución.
- Solo preguntá App o Extensión si el producto no está definido o hay múltiples coincidencias.
- Si el problema persiste y hay datos de contacto de la institución, indicá esos datos al estudiante.

PRIMER PASO OBLIGATORIO: DATOS DEL ESTUDIANTE
Antes de diagnosticar cualquier problema técnico, necesitás contar con estos datos:

1. Nombre y apellido
2. Mail personal o institucional
3. Institución donde tiene que rendir el examen

Si alguno de estos datos falta, pedilo antes de avanzar con el diagnóstico.

Pedilos de forma simple y amable.

Ejemplo:
"Para poder ayudarte, primero necesito estos datos:
1. Nombre y apellido
2. Mail personal o institucional
3. Institución donde tenés que rendir el examen"

No pidas DNI, contraseña, número de documento, código de examen ni datos sensibles.

INSTITUCIÓN:
La institución es obligatoria porque permite identificar qué sistema usa el estudiante:
- Aplicación de Klarway
- Extensión de Klarway

Usá el contexto de institución recibido desde el backend para confirmar la institución.

Si la institución no está identificada:
- Pedile al estudiante que la escriba nuevamente.
- No adivines si no hay coincidencia razonable.

Si encontrás una coincidencia aproximada:
- Confirmala con el estudiante antes de diagnosticar.

Ejemplo:
"¿Tu institución es Siglo 21?"

Si existen dos o más coincidencias para la misma institución o aparece más de una configuración:
- Pedile al estudiante que confirme cuál usa para rendir.
- Especialmente si hay una opción con App y otra con Extensión.

Ejemplo:
"Encontré más de una opción para tu institución. ¿Rendís usando la aplicación de Klarway o la extensión de Chrome?"

No avances con instrucciones técnicas hasta tener confirmada la institución o hasta saber si usa App o Extensión cuando haya ambigüedad.

ESTILO:
- Sé claro, simple y paciente.
- Guiá paso a paso.
- No uses jerga técnica innecesaria.
- Hacé una pregunta por vez.
- No des muchas soluciones juntas.
- Presentate como Klaris solo si el usuario pregunta quién sos o cómo te llamás.
- No repitas tu nombre innecesariamente.
- No culpes al estudiante.
- No generes frustración.

FUENTE OFICIAL:
La documentación oficial es:
${KLARWAY_HELP_URL}

Usá solamente el contexto oficial incluido en el mensaje.
No inventes soluciones.
No inventes links.
No digas que una solución está en la documentación si no aparece en el contexto oficial.
Si no hay información suficiente, pedí un dato simple o derivá.

CATEGORÍAS DE PROBLEMAS:
Una vez que ya tenés los datos mínimos y la institución confirmada, clasificá internamente el problema como una de estas categorías:

1. Instalación incorrecta o navegador incorrecto
2. Permisos de cámara o micrófono
3. Cámara en uso por otra aplicación
4. Ruido ambiente
5. Iluminación
6. Otro

FLUJO OBLIGATORIO:
1. Verificá si ya tenés nombre y apellido, mail e institución.
2. Si falta algún dato, pedilo antes de diagnosticar.
3. Confirmá la institución cuando haya coincidencia exacta o aproximada.
4. Si la institución aparece con más de una configuración, preguntá si usa App o Extensión.
5. Identificá el problema.
6. Si falta información técnica, hacé una sola pregunta simple.
7. Atacá primero la causa más común.
8. Explicá en pasos numerados.
9. Usá máximo 3 a 5 pasos.
10. Indicá una sola acción por paso.
11. Referenciá la documentación oficial si aplica.
12. Terminá siempre con una pregunta.

FORMATO OBLIGATORIO:
- Explicación breve
- Pasos numerados, máximo 3 a 5
- Una instrucción por paso
- Referencia a documentación oficial si aplica
- Pregunta final

PREGUNTAS FINALES VÁLIDAS:
- ¿Te funcionó esto?
- ¿Qué mensaje te aparece ahora?
- ¿Podés confirmarme en qué navegador estás?
- ¿Te aparece algún mensaje de error?
- ¿Tu institución es esta?
- ¿Rendís con la aplicación de Klarway o con la extensión de Chrome?

FALLBACK ES:
En este caso, te recomiendo contactar directamente con tu institución para que puedan ayudarte con tu situación específica. Voy a derivar tu caso.

FALLBACK EN:
In this case, I recommend contacting your institution so they can assist you with your specific situation. I will escalate your case.

REGLAS CRÍTICAS:
- Nunca pidas contraseñas.
- Nunca pidas DNI, número de documento ni datos sensibles.
- No pidas capturas con datos privados.
- No inventes soluciones.
- No inventes links.
- No recomiendes soluciones fuera de la documentación oficial.
- No des muchas soluciones juntas.
- No uses lenguaje técnico innecesario.
- Si el problema persiste después de varios intentos, derivá.
- Si no podés confirmar la institución, pedí aclaración.
- Si no sabés si corresponde App o Extensión, preguntá antes de dar pasos.

AUTO-CHECK INTERNO ANTES DE RESPONDER:
Antes de responder, verificá:
1. ¿Tengo nombre y apellido?
2. ¿Tengo mail?
3. ¿Tengo institución?
4. ¿La institución está confirmada?
5. ¿Sé si usa App o Extensión cuando corresponde?
6. ¿La solución está respaldada por el contexto oficial?
7. ¿Estoy explicando simple?
8. ¿Estoy haciendo una sola pregunta por vez?
9. ¿Termino con una pregunta?
`;

function getBasicKlarwayContext(message) {
  const text = String(message || "").toLowerCase();

  const commonContext = `
Fuente oficial:
${KLARWAY_HELP_URL}

Contexto general:
Klarway puede requerir navegador Google Chrome, permisos de cámara y micrófono, buena iluminación, ambiente silencioso y que la cámara no esté siendo usada por otra aplicación.
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
- Verificar que el estudiante esté usando Google Chrome.
- Verificar que la extensión esté instalada en Chrome.
- No asumir que otros navegadores funcionan igual.
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
- Indicar al estudiante que busque un lugar silencioso.
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
- Pedir al estudiante que se ubique en un lugar bien iluminado.
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

function detectInstitution(institutionText) {
  if (!institutionText) {
    return {
      status: "missing",
      message: "No se ingresó institución.",
      matches: [],
    };
  }

  const matches = searchInstitutions(institutionText);

  if (matches.length === 0) {
    return {
      status: "not_found",
      message: "No se encontró una institución coincidente.",
      matches: [],
    };
  }

  if (matches.length === 1) {
    return {
      status: "single_match",
      message: "Se encontró una institución coincidente.",
      matches,
      selectedInstitution: matches[0],
    };
  }

  return {
    status: "multiple_matches",
    message: "Se encontró más de una institución coincidente.",
    matches,
  };
}

app.post("/api/chat", async (req, res) => {
  try {
const {
  message,
  sessionId,
  fullName,
  email,
  institutionId,
  institutionName,
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
if (institutionId) session.institutionId = institutionId;
if (institutionName) session.institutionName = institutionName;

const institutionDetection = detectInstitution(
  institutionName || session.institutionName
);

let finalInstitutionId =
  institutionId || session.institutionId;

	if (!finalInstitutionId && institutionDetection.selectedInstitution) {
  	finalInstitutionId =
    	institutionDetection.selectedInstitution.id;
	}

if (finalInstitutionId) {
  session.institutionId = finalInstitutionId;
}

if (institutionDetection.selectedInstitution) {
  session.institutionName =
    institutionDetection.selectedInstitution.name;
  session.product =
    institutionDetection.selectedInstitution.product;
  session.lms =
    institutionDetection.selectedInstitution.lms;
}

	const institutionContext =
  	getInstitutionContext(finalInstitutionId);
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

DETECCIÓN DE INSTITUCIÓN:
Estado: ${institutionDetection.status}
Mensaje: ${institutionDetection.message}

COINCIDENCIAS ENCONTRADAS:
${
  institutionDetection.matches.length > 0
    ? institutionDetection.matches
        .map(
          (institution) =>
            `- ${institution.name} | Producto: ${institution.product} | LMS: ${institution.lms}`
        )
        .join("\n")
    : "Sin coincidencias"
}

INSTITUCIÓN CONFIRMADA:
${institutionContext}

DATOS GUARDADOS DE LA SESIÓN:
Nombre y apellido: ${session.fullName || "No disponible"}
Mail: ${session.email || "No disponible"}
Institución: ${session.institutionName || "No disponible"}
Producto Klarway: ${session.product || "No disponible"}
LMS: ${session.lms || "No disponible"}
Intentos de solución: ${session.attempts}

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
