import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import crypto from 'crypto';
import { MongoClient, ObjectId } from 'mongodb';

const app = express();
const PORT = process.env.PORT || 3000;

/* ==================== DB (MongoDB Atlas) ==================== */
const client = new MongoClient(process.env.MONGO_URI);
let exams, results;

async function initDb() {
  try {
    await client.connect();
    const db = client.db('focusExams'); // nom de la BD
    exams = db.collection('exams');
    results = db.collection('results');
    console.log('✅ Connectat a MongoDB Atlas');
  } catch (err) {
    console.error('❌ Error connectant a MongoDB:', err);
    process.exit(1);
  }
}
initDb();

/* ==================== Middlewares ==================== */
app.use(cors());
app.use(express.json({ limit: '10mb' })); // per imatges base64
app.use(morgan('dev'));
app.use(express.static('public'));

/* ==================== Helpers ==================== */
const genId = () => crypto.randomBytes(8).toString('hex');
const genPin = () => String(Math.floor(100000 + Math.random() * 900000));

/* ==================== API ==================== */

// 📌 Llista d’exàmens (biblioteca)
app.get('/api/exams', async (req, res) => {
  try {
    const items = await exams.find({}, { projection: { questions: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Error llistant exàmens' });
  }
});

// 📌 Obté examen per PIN (alumne)
app.get('/api/exams/pin/:pin', async (req, res) => {
  try {
    const exam = await exams.findOne({ pin: req.params.pin });
    if (!exam) return res.status(404).json({ error: 'PIN no trobat' });
    res.json({
      id: exam._id,
      title: exam.title,
      desc: exam.desc,
      settings: exam.settings || {},
      questions: exam.questions || [],
      pin: exam.pin
    });
  } catch (err) {
    res.status(500).json({ error: 'Error obtenint examen per PIN' });
  }
});

// 📌 Obté examen per ID (mestre)
app.get('/api/exams/:examId', async (req, res) => {
  try {
    const exam = await exams.findOne({ _id: new ObjectId(req.params.examId) });
    if (!exam) return res.status(404).json({ error: 'Examen no trobat' });
    res.json(exam);
  } catch (err) {
    res.status(500).json({ error: 'Error obtenint examen per ID' });
  }
});

// 📌 Crea/publica examen
app.post('/api/exams', async (req, res) => {
  try {
    const exam = req.body;
    if (!exam?.questions || !exam.questions.length) {
      return res.status(400).json({ error: 'Cal almenys una pregunta' });
    }
    let pin;
    do {
      pin = genPin();
    } while (await exams.findOne({ pin }));

    const doc = {
      ...exam,
      pin,
      createdAt: new Date().toISOString()
    };
    const result = await exams.insertOne(doc);
    res.json({ examId: result.insertedId, pin });
  } catch (err) {
    res.status(500).json({ error: 'Error creant examen' });
  }
});

// 📌 Actualitza examen
app.put('/api/exams/:examId', async (req, res) => {
  try {
    const { examId } = req.params;
    const update = { ...req.body, updatedAt: new Date().toISOString() };
    await exams.updateOne(
      { _id: new ObjectId(examId) },
      { $set: update }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error actualitzant examen' });
  }
});

// 📌 Desa resultats d’alumne
app.post('/api/results', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload?.examId || !payload?.pin) {
      return res.status(400).json({ error: 'Resultat invàlid' });
    }
    const exam = await exams.findOne({ _id: new ObjectId(payload.examId) });
    if (!exam) return res.status(404).json({ error: 'Examen no trobat' });
    if (exam.pin !== payload.pin) {
      return res.status(400).json({ error: 'PIN incorrecte' });
    }

    const item = {
      examId: new ObjectId(payload.examId),
      submittedAt: new Date().toISOString(),
      student: payload.student,
      totals: payload.totals,
      responses: payload.responses
    };

    const result = await results.insertOne(item);
    res.json({ ok: true, resultId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: 'Error desant resultat' });
  }
});

// 📌 Consulta resultats per examId
app.get('/api/results/:examId', async (req, res) => {
  try {
    const examId = new ObjectId(req.params.examId);
    const items = await results.find({ examId }).toArray();
    res.json({ examId, items });
  } catch (err) {
    res.status(500).json({ error: 'Error obtenint resultats' });
  }
});

// 📌 Export CSV
app.get('/api/results/:examId/csv', async (req, res) => {
  try {
    const examId = new ObjectId(req.params.examId);
    const items = await results.find({ examId }).toArray();

    const maxQ = items.reduce((m, r) => Math.max(m, r.responses?.length || 0), 0);
    const head = ['Alumne', 'Grup', 'Puntuació', 'Max', 'Percent', 'Data', ...Array.from({ length: maxQ }, (_, i) => `Q${i + 1}`)];
    const lines = [head.join(',')];
    const csv = (s) => `"${String(s ?? '').replaceAll('"', '""')}"`;

    for (const r of items) {
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
    res.setHeader('Content-Disposition', `attachment; filename="resultats_${req.params.examId}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: 'Error exportant CSV' });
  }
});

/* ==================== Server ==================== */
app.listen(PORT, () => {
  console.log(`🚀 Server escoltant al port ${PORT}`);
});
