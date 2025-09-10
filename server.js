import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;

/* ==================== Directori de dades ==================== */
const DATA_DIR = path.join(process.cwd(), 'data');
const EXAMS_DIR = path.join(DATA_DIR, 'exams');
const RESULTS_DIR = path.join(DATA_DIR, 'results');
for (const d of [DATA_DIR, EXAMS_DIR, RESULTS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

/* ==================== Middlewares ==================== */
app.use(cors());
app.use(express.json({ limit: '10mb' })); // pujat per imatges base64
app.use(morgan('dev'));
app.use(express.static(path.join(process.cwd(), 'public')));

/* ==================== Helpers ==================== */
const genId = () => crypto.randomBytes(8).toString('hex');
const genPin = () => String(Math.floor(100000 + Math.random() * 900000));
const examPathById = (id) => path.join(EXAMS_DIR, `${id}.json`);
const resultPathByExam = (examId) => path.join(RESULTS_DIR, `${examId}.json`);

const readJSON = (p, defVal) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return defVal; }
};
const writeJSON = (p, obj) => {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
};

// Sanejament d’examen rebut del client (eliminem camps no desitjats)
const sanitizeExam = (raw = {}) => {
  const safe = {
    title: String(raw.title || ''),
    desc: String(raw.desc || ''),
    settings: {
      showScoreToStudent: raw?.settings?.showScoreToStudent !== false,
      shuffle: !!raw?.settings?.shuffle
    },
    questions: Array.isArray(raw.questions) ? raw.questions.map(q => {
      const base = {
        id: String(q.id || genId()),
        type: String(q.type || 'mc'),
        text: String(q.text || ''),
        points: Number.isFinite(Number(q.points)) ? Number(q.points) : 1,
        tags: Array.isArray(q.tags) ? q.tags.filter(Boolean).map(String) : [],
        media: {}
      };
      // Només acceptem imatges (no àudio)
      if (q?.media?.imgData && typeof q.media.imgData === 'string' && q.media.imgData.startsWith('data:image/')) {
        base.media.imgData = q.media.imgData;
      }
      // Propietats específiques per tipus
      if (base.type === 'mc' || base.type === 'tf') {
        base.options = Array.isArray(q.options) ? q.options.map(o => ({
          text: String(o?.text || ''),
          correct: o?.correct === true
        })) : [];
      } else if (base.type === 'short') {
        base.answerText = String(q.answerText || '');
        base.accepts = Array.isArray(q.accepts) ? q.accepts.filter(Boolean).map(String) : [];
      } else if (base.type === 'num') {
        base.numAnswer = String(q.numAnswer ?? '');
        base.tolerance = String(q.tolerance ?? '0');
      } else if (base.type === 'long') {
        base.rubric = String(q.rubric || '');
      } else if (base.type === 'order') {
        base.items = Array.isArray(q.items) ? q.items.filter(Boolean).map(String) : [];
      } else if (base.type === 'match') {
        base.left = Array.isArray(q.left) ? q.left.filter(Boolean).map(String) : [];
        base.right = Array.isArray(q.right) ? q.right.filter(Boolean).map(String) : [];
      }
      return base;
    }) : []
  };
  return safe;
};

/* ==================== Índex PIN→examId (memòria) ==================== */
let pinIndex = new Map();
// Reconstrueix index a l'arrencada (només .json)
for (const f of fs.readdirSync(EXAMS_DIR).filter(n => n.endsWith('.json'))) {
  const exam = readJSON(path.join(EXAMS_DIR, f), null);
  if (exam?.pin && exam?.id) pinIndex.set(exam.pin, exam.id);
}

/* ==================== API ==================== */

// Llista d’exàmens (biblioteca) – info bàsica, més recents primer
app.get('/api/exams', (req, res) => {
  const files = fs.readdirSync(EXAMS_DIR).filter(f => f.endsWith('.json'));
  const exams = files.map(f => {
    const ex = readJSON(path.join(EXAMS_DIR, f), null);
    if (!ex) return null;
    return {
      id: ex.id,
      title: ex.title,
      createdAt: ex.createdAt,
      updatedAt: ex.updatedAt,
      pin: ex.pin
    };
  }).filter(Boolean).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  res.json(exams);
});

// Obté examen per PIN (alumnes) – ruta específica abans de /api/exams/:examId
app.get('/api/exams/pin/:pin', (req, res) => {
  const { pin } = req.params;
  const examId = pinIndex.get(pin);
  if (!examId) return res.status(404).json({ error: 'PIN no trobat' });
  const exam = readJSON(examPathById(examId), null);
  if (!exam) return res.status(404).json({ error: 'Examen no trobat' });

  // Retornem només el necessari per a l’alumne
  res.json({
    id: exam.id,
    title: exam.title,
    desc: exam.desc,
    settings: exam.settings || {},
    questions: exam.questions || [],
    pin: exam.pin
  });
});

// Obté examen per ID (mestre: carregar/editar/clonejar)
app.get('/api/exams/:examId', (req, res) => {
  const { examId } = req.params;
  const p = examPathById(examId);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Examen no trobat' });
  const exam = readJSON(p, null);
  res.json(exam || {});
});

// Crea/publica examen: retorna {examId, pin}
app.post('/api/exams', (req, res) => {
  const incoming = sanitizeExam(req.body);
  if (!incoming || !Array.isArray(incoming.questions) || incoming.questions.length === 0) {
    return res.status(400).json({ error: 'Examen invàlid: cal almenys una pregunta.' });
  }

  const id = genId();
  // Evitem col·lisions de PIN
  let pin;
  do { pin = genPin(); } while (pinIndex.has(pin));

  const stored = {
    ...incoming,
    id,
    pin,
    createdAt: new Date().toISOString()
  };

  // Persistim
  writeJSON(examPathById(id), stored);
  pinIndex.set(pin, id);

  res.json({ examId: id, pin });
});

// Actualitza un examen existent (opcional)
app.put('/api/exams/:examId', (req, res) => {
  const { examId } = req.params;
  const p = examPathById(examId);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Examen no trobat' });

  const current = readJSON(p, null) || {};
  const incoming = sanitizeExam(req.body || {});
  const updated = {
    ...current,
    ...incoming,
    id: examId,
    pin: current.pin, // no canviem PIN
    updatedAt: new Date().toISOString()
  };

  writeJSON(p, updated);
  // Si el títol canvia o altres camps, no cal tocar el map de PINs
  res.json({ ok: true });
});

// Desa un resultat d'alumne
app.post('/api/results', (req, res) => {
  const payload = req.body;
  // Esperem: { examId, pin, student:{name,group}, totals:{score,max}, responses:[...] }
  if (!payload?.examId || !payload?.pin || !payload?.student || !payload?.responses) {
    return res.status(400).json({ error: 'Resultat invàlid' });
  }

  const pExam = examPathById(payload.examId);
  if (!fs.existsSync(pExam)) return res.status(404).json({ error: 'Examen no trobat' });

  const exam = readJSON(pExam, null);
  if (exam.pin !== payload.pin) return res.status(400).json({ error: 'PIN incorrecte per a aquest examen' });

  const rPath = resultPathByExam(payload.examId);
  const bag = readJSON(rPath, { examId: payload.examId, items: [] });

  const item = {
    id: genId(),
    submittedAt: new Date().toISOString(),
    student: {
      name: String(payload.student?.name || ''),
      group: String(payload.student?.group || '')
    },
    totals: {
      score: Number(payload.totals?.score || 0),
      max: Number(payload.totals?.max || 0)
    },
    responses: Array.isArray(payload.responses) ? payload.responses : []
  };

  bag.items.push(item);
  writeJSON(rPath, bag);
  res.json({ ok: true, resultId: item.id });
});

// Consulta resultats per examId (mestre)
app.get('/api/results/:examId', (req, res) => {
  const { examId } = req.params;
  const rPath = resultPathByExam(examId);
  const bag = readJSON(rPath, { examId, items: [] });
  res.json(bag);
});

// Export CSV
app.get('/api/results/:examId/csv', (req, res) => {
  const { examId } = req.params;
  const rPath = resultPathByExam(examId);
  const bag = readJSON(rPath, { examId, items: [] });

  // Calcular màxim nombre de preguntes entre els resultats
  const maxQ = bag.items.reduce((m, r) => Math.max(m, r.responses?.length || 0), 0);

  const head = ['Alumne', 'Grup', 'Puntuació', 'Max', 'Percent', 'Data', ...Array.from({ length: maxQ }, (_, i) => `Q${i + 1}`)];
  const lines = [head.join(',')];
  const csv = (s) => `"${String(s ?? '').replaceAll('"', '""')}"`;

  for (const r of bag.items) {
    const pct = r.totals?.max ? (100 * (r.totals.score || 0) / r.totals.max).toFixed(1) : '';
    const base = [
      csv(r.student?.name || ''),
      csv(r.student?.group || ''),
      r.totals?.score ?? '',
      r.totals?.max ?? '',
      pct,
      csv(new Date(r.submittedAt).toLocaleString())
    ];
    const qcells = (r.responses || []).map(ans => csv(ans.correct === true ? 'OK' : (ans.correct === false ? 'KO' : 'NA')));
    while (qcells.length < maxQ) qcells.push('');
    lines.push([...base, ...qcells].join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="resultats_${examId}.csv"`);
  // Afegim BOM per compatibilitat amb Excel
  res.send('\uFEFF' + lines.join('\n'));
});

/* ==================== Server ==================== */
app.listen(PORT, () => {
  console.log(`🚀 Server escoltant a http://localhost:${PORT}`);
});
