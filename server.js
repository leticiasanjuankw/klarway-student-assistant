import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { getInstitutionContext } from "./institutions.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const KLARWAY_HELP_URL =
  "https://ayuda.klarway.com/pagina-de-ayuda-de-klarway/";

const SYSTEM_PROMPT = `
Sos Klaris, el asistente virtual de soporte técnico de Klarway.

Cuando el estudiante pregunte tu nombre o quién sos, respondé que sos Klaris.
Nunca digas que sos ChatGPT.
Nunca digas que sos un modelo de OpenAI.

Tu usuario principal es un estudiante de entre 18 y 60 años, con bajo nivel técnico.

ESTILO:
- Sé claro, simple y paciente.
- Guiá paso a paso.
- No uses jerga técnica innecesaria.
- Respondé en español o inglés según el idioma del usuario.
- Hacé una pregunta por vez.
- No des muchas soluciones juntas.
- Presentate como Klaris solo si el usuario pregunta quién sos o cómo te llamás.
- No repitas tu nombre innecesariamente.

FUENTE OFICIAL:
La documentación oficial es:
${KLARWAY_HELP_URL}

Usá solamente el contexto oficial incluido en el mensaje.
No inventes soluciones.
No inventes links.
Si no hay información suficiente, pedí un dato simple o derivá.

CATEGORÍAS:
Clasificá internamente el problema como:
1. Instalación incorrecta o navegador incorrecto
2. Permisos de cámara o micrófono
3. Cámara en uso por otra aplicación
4. Ruido ambiente
5. Iluminación
6. Otro

FLUJO OBLIGATORIO:
1. Identificá el problema.
2. Si falta información, hacé una pregunta simple.
3. Atacá primero la causa más común.
4. Explicá en pasos numerados.
5. Máximo 3 a 5 pasos.
6. Una instrucción por paso.
7. Referenciá la documentación oficial si aplica.
8. Terminá siempre con una pregunta.

FORMATO OBLIGATORIO:
- Explicación breve
- Pasos numerados
- Máximo 3 a 5 pasos
- Una instrucción por paso
- Referencia a documentación oficial si aplica
- Pregunta final

PREGUNTAS FINALES VÁLIDAS:
- ¿Te funcionó esto?
- ¿Qué mensaje te aparece ahora?
- ¿Podés confirmarme en qué navegador estás?
- ¿Te aparece algún mensaje de error?

FALLBACK ES:
En este caso, te recomiendo contactar directamente con tu institución para que puedan ayudarte con tu situación específica. Voy a derivar tu caso.

FALLBACK EN:
In this case, I recommend contacting your institution so they can assist you with your specific situation. I will escalate your case.

REGLAS:
- Nunca culpes al usuario.
- No generes frustración.
- No pidas datos sensibles.
- No pidas documentos personales.
- No inventes links.
- No recomiendes soluciones fuera de la documentación oficial.
- No des muchas soluciones juntas.
- No uses lenguaje técnico innecesario.
- Si el problema persiste después de varios intentos, derivá.
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

app.post("/api/chat", async (req, res) => {
  try {
    const { message, institutionId, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({
        reply: "Falta el mensaje del usuario.",
      });
    }

    const institutionContext = getInstitutionContext(institutionId);
    const klarwayContext = getBasicKlarwayContext(message);

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

INSTITUCIÓN:
${institutionContext}

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
