import express from "express";
import cors from "cors";
import morgan from "morgan";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// 📂 Carpeta per guardar exàmens i resultats
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
  console.log("📂 Carpeta data creada");
}

// 🟢 Servir el frontend
app.use(express.static(path.join(__dirname, "public")));

// 🔹 API de salut
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// 🔹 Generar un PIN de 6 dígits
function genPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 🔹 Publicar examen
app.post("/api/exams", (req, res) => {
  const exam = req.body;
  if (
    !exam ||
    !exam.title ||
    !Array.isArray(exam.questions) ||
    exam.questions.length === 0
  ) {
    return res.status(400).json({ error: "Examen invàlid" });
  }

  const examId = Date.now().toString(36);
  const pin = genPin();

  const entry = {
    ...exam,
    examId,
    pin,
    settings: {
      showScore: exam.settings?.showScore ?? true,
      shuffle: exam.settings?.shuffle ?? false,
      time: exam.settings?.time ?? 0,
    },
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(DATA_DIR, `exam_${examId}.json`),
    JSON.stringify(entry, null, 2)
  );

  console.log(`✅ Publicat examen: ${exam.title} (PIN ${pin})`);
  res.json({ examId, pin });
});

// 🔹 Obtenir examen per PIN
app.get("/api/exams/pin/:pin", (req, res) => {
  const { pin } = req.params;
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("exam_"));

  for (const file of files) {
    const exam = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, file), "utf-8")
    );
    if (exam.pin === pin) return res.json(exam);
  }
  res.status(404).json({ error: "Examen no trobat" });
});

// 🔹 Biblioteca d’exàmens
app.get("/api/exams", (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("exam_"));
  const exams = files.map((file) => {
    const exam = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, file), "utf-8")
    );
    return {
      examId: exam.examId,
      pin: exam.pin,
      title: exam.title || "(Sense títol)",
      createdAt: exam.createdAt,
    };
  });
  res.json(exams);
});

// 🔹 Guardar resultats
app.post("/api/results", (req, res) => {
  const result = req.body;
  if (!result || !result.examId || !result.student || !result.responses) {
    return res.status(400).json({
      error: "Falten camps obligatoris (examId, student, responses)",
    });
  }

  const file = path.join(DATA_DIR, `results_${result.examId}.json`);
  let results = [];
  if (fs.existsSync(file)) {
    results = JSON.parse(fs.readFileSync(file, "utf-8"));
  }

  results.push({ ...result, submittedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(results, null, 2));

  console.log(`📩 Resultat guardat per examId ${result.examId}`);
  res.json({ ok: true });
});

// 🔹 Recuperar resultats
app.get("/api/results/:examId", (req, res) => {
  const { examId } = req.params;
  const file = path.join(DATA_DIR, `results_${examId}.json`);
  if (!fs.existsSync(file)) return res.json([]);
  const results = JSON.parse(fs.readFileSync(file, "utf-8"));
  res.json(results);
});

// 🔹 Catch-all → servir sempre index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 🟢 Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor escoltant al port ${PORT}`));