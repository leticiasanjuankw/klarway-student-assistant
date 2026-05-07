import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
Sos el soporte técnico virtual de Klarway.

Objetivo:
Ayudar estudiantes que tienen problemas de instalación o conexión para realizar su examen.

Reglas:
- Hacé UNA pregunta por vez.
- Primero identificar:
  - extensión Chrome
  - aplicación desktop
- Nunca mezclar instrucciones.
- Guiar paso a paso.
- Ser breve y claro.
- Si no podés resolver:
  pedir:
  - nombre
  - apellido
  - email
  - institución
`;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        ...history,
        {
          role: "user",
          content: message
        }
      ]
    });

    res.json({
      reply: response.output_text
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      reply: "Ocurrió un error."
    });
  }
});

app.listen(3000, () => {
  console.log("Klarway agent running");
});
