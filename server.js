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

// 📂 Directori per guardar dades
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
  console.log("📂 Carpeta data creada");
}

// 🟢 Servir el frontend (public/)
app.use(express.static(path.join(__dirname, "public")));

// 🔹 API de salut
app.get("/api/health", (req, res) => {
  console.log("💚 Ping /api/health");
  res.json({ ok: true });
});

// 🔹 Generar un PIN curt de 6 dígits
function genPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 🔹 Publicar un examen
app.post("/api/exams", (req, res) => {
  const exam = req.body;
  if (!exam || !exam.title || !Array.isArray(exam.questions)) {
    console.warn("⚠️ Examen rebut invàlid");
    return res.status(400).json({ error: "Examen invàlid" });
  }

  const examId = Date.now().toString(36);
  const pin = genPin();

  const entry = { ...exam, examId, pin };
  fs.writeFileSync(
    path.join(DATA_DIR, `exam_${examId}.json`),
    JSON.stringify(entry, null, 2)
  );

  console.log(`📩 Examen publicat: ${exam.title} (PIN ${pin}, examId ${examId})`);
  res.json({ examId, pin });
});

// 🔹 Recuperar examen a partir d’un PIN
app.get("/api/exams/pin/:pin", (req, res) => {
  const pin = req.params.pin;
  console.log(`🔎 Cerca examen per PIN ${pin}`);
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith("exam_"));

  for (const file of files) {
    const exam = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
    if (exam.pin === pin) {
      console.log(`✅ Examen trobat: ${exam.title}`);
      return res.json(exam);
    }
  }

  console.warn("❌ PIN no trobat");
  res.status(404).json({ error: "Examen no trobat" });
});

// 🔹 Llistar tots els exàmens (biblioteca del mestre)
app.get("/api/exams", (req, res) => {
  console.log("📤 Consulta biblioteca d’exàmens");
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith("exam_"));
  const exams = files.map(file => {
    const exam = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
    return {
      examId: exam.examId,
      pin: exam.pin,
      title: exam.title || "(Sense títol)"
    };
  });
  res.json(exams);
});

// 🔹 Guardar resultats d’un alumne (amb examId a la URL)
app.post("/api/results/:examId", (req, res) => {
  const { examId } = req.params;
  const result = req.body;

  if (!result || !result.student || !result.responses) {
    console.warn("⚠️ Resultat invàlid (manca camp)");
    return res.status(400).json({ error: "Resultat invàlid" });
  }

  const file = path.join(DATA_DIR, `results_${examId}.json`);
  let results = [];
  if (fs.existsSync(file)) {
    results = JSON.parse(fs.readFileSync(file, "utf-8"));
  }

  results.push({ ...result, submittedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(results, null, 2));

  console.log(`📩 Resultat rebut per examId ${examId} de ${result.student?.name || "?"}`);
  res.json({ ok: true });
});

// 🔹 Guardar resultats (versió genèrica: examId al body)
app.post("/api/results", (req, res) => {
  const result = req.body;
  if (!result || !result.examId || !result.student || !result.responses) {
    console.warn("⚠️ Resultat invàlid (falten camps)");
    return res.status(400).json({ error: "Falten camps obligatoris (examId, student, responses)" });
  }

  const examId = result.examId;
  const file = path.join(DATA_DIR, `results_${examId}.json`);
  let results = [];
  if (fs.existsSync(file)) {
    results = JSON.parse(fs.readFileSync(file, "utf-8"));
  }

  results.push({ ...result, submittedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(results, null, 2));

  console.log(`📩 Resultat rebut per examId ${examId} (genèric) de ${result.student?.name || "?"}`);
  res.json({ ok: true });
});

// 🔹 Recuperar tots els resultats d’un examen (via :examId)
app.get("/api/results/:examId", (req, res) => {
  const { examId } = req.params;
  const file = path.join(DATA_DIR, `results_${examId}.json`);

  console.log(`📤 Consulta resultats examId ${examId}`);
  if (!fs.existsSync(file)) return res.json([]);
  const results = JSON.parse(fs.readFileSync(file, "utf-8"));
  res.json(results);
});

// 🔹 Recuperar tots els resultats d’un examen (via ?examId=...)
app.get("/api/results", (req, res) => {
  const examId = req.query.examId;
  if (!examId) {
    console.warn("⚠️ Consulta resultats sense examId");
    return res.status(400).json({ error: "Falta examId" });
  }

  console.log(`📤 Consulta resultats examId ${examId} (query)`);
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