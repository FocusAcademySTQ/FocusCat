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
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// 🟢 Servir el frontend (public/)
app.use(express.static(path.join(__dirname, "public")));

// 🔹 API de salut
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// 🔹 Generar PIN curt
function genPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 🔹 Publicar examen
app.post("/api/exams", (req, res) => {
  const exam = req.body;
  if (!exam || !exam.title || !Array.isArray(exam.questions)) {
    return res.status(400).json({ error: "Examen invàlid" });
  }
  const examId = Date.now().toString(36);
  const pin = genPin();
  const entry = { ...exam, examId, pin };
  fs.writeFileSync(
    path.join(DATA_DIR, `exam_${examId}.json`),
    JSON.stringify(entry, null, 2)
  );
  res.json({ examId, pin });
});

// 🔹 Recuperar examen per PIN
app.get("/api/exams/pin/:pin", (req, res) => {
  const pin = req.params.pin;
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith("exam_"));
  for (const file of files) {
    const exam = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
    if (exam.pin === pin) return res.json(exam);
  }
  res.status(404).json({ error: "Examen no trobat" });
});

// 🔹 Guardar resultats amb :examId
app.post("/api/results/:examId", (req, res) => {
  const { examId } = req.params;
  const result = req.body;
  if (!result || !result.student || !result.responses) {
    return res.status(400).json({ error: "Resultat invàlid" });
  }
  const file = path.join(DATA_DIR, `results_${examId}.json`);
  let results = [];
  if (fs.existsSync(file)) {
    results = JSON.parse(fs.readFileSync(file, "utf-8"));
  }
  results.push({ ...result, submittedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  res.json({ ok: true });
});

// 🔹 Guardar resultats amb examId al body
app.post("/api/results", (req, res) => {
  const result = req.body;
  if (!result || !result.examId || !result.student || !result.responses) {
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
  res.json({ ok: true });
});

// 🔹 Recuperar resultats via :examId
app.get("/api/results/:examId", (req, res) => {
  const { examId } = req.params;
  const file = path.join(DATA_DIR, `results_${examId}.json`);
  if (!fs.existsSync(file)) return res.json([]);
  const results = JSON.parse(fs.readFileSync(file, "utf-8"));
  res.json(results);
});

// 🔹 Recuperar resultats via ?examId=xxx
app.get("/api/results", (req, res) => {
  const examId = req.query.examId;
  if (!examId) return res.status(400).json({ error: "Falta examId" });
  const file = path.join(DATA_DIR, `results_${examId}.json`);
  if (!fs.existsSync(file)) return res.json([]);
  const results = JSON.parse(fs.readFileSync(file, "utf-8"));
  res.json(results);
});

// 🔹 Catch-all → servir sempre index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 🟢 Inici servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor escoltant al port ${PORT}`));
