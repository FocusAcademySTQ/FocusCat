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
  await client.connect();
  const db = client.db('focusExams'); // nom de la BD
  exams = db.collection('exams');
  results = db.collection('results');
  console.log('✅ Connectat a MongoDB Atlas');
}

/* ==================== Middlewares ==================== */
app.use(cors());
app.use(express.json({ limit: '10mb' })); // per imatges base64
app.use(morgan('dev'));
app.use(express.static('public'));

/* ==================== Helpers ==================== */
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
    console.error("❌ Error llistant exàmens:", err);
    res.status(500).json({ error: 'Error llistant exàmens' });
  }
});

// 📌 Obté examen per PIN (alumne)
app.get('/api/exams/pin/:pin', async (req, res) => {
  try {
    const exam = await exams.findOne({ pin: String(req.params.pin) });
    if (!exam) return res.status(404).json({ error: 'PIN no trobat' });
    res.json({
      _id: exam._id, // 👈 molt important per guardar resultats
      title: exam.title,
      desc: exam.desc,
      settings: exam.settings || {},
      questions: exam.questions || [],
      pin: String(exam.pin) // assegurem que sempre sigui string
    });
  } catch (err) {
    console.error("❌ Error obtenint examen per PIN:", err);
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
    console.error("❌ Error obtenint examen per ID:", err);
    res.status(500).json({ error: 'Error obtenint examen per ID' });
  }
});

// 📌 Crea/publica examen
app.post('/api/exams', async (req, res) => {
  try {
    console.log("➡️ Rebut nou examen:", req.body); // debug
    const exam = req.body;
    if (!exam?.questions || !exam.questions.length) {
      return res.status(400).json({ error: 'Cal almenys una pregunta' });
    }
    let pin;
    do {
      pin = genPin();
    } while (await exams.findOne({ pin: String(pin) }));

    // ❌ eliminem _id i id si vénen del client
    const { _id, id, ...rest } = exam;

    const doc = {
      ...rest,
      pin: String(pin), // 👈 assegurem que sempre és string
      createdAt: new Date().toISOString()
    };

    const result = await exams.insertOne(doc);
    res.json({ examId: result.insertedId, pin: String(pin) });
  } catch (err) {
    console.error("❌ Error creant examen:", err, "Body rebut:", req.body);
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
    console.error("❌ Error actualitzant examen:", err);
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

    // 👇 comparem sempre com a string
    if (String(exam.pin) !== String(payload.pin)) {
      console.warn("⚠️ PIN incorrecte:", { examPin: exam.pin, payloadPin: payload.pin });
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
    console.error("❌ Error desant resultat:", err, "Payload rebut:", req.body);
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
    console.error("❌ Error obtenint resultats:", err);
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
    console.error("❌ Error exportant CSV:", err);
    res.status(500).json({ error: 'Error exportant CSV' });
  }
}); // ✅ clau que faltava

// 📌 Elimina un examen per ID
app.delete('/api/exams/:examId', async (req, res) => {
  try {
    const examId = new ObjectId(req.params.examId);

    // Esborrem l'examen
    await exams.deleteOne({ _id: examId });

    // També esborrem resultats associats
    await results.deleteMany({ examId });

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error eliminant examen:", err);
    res.status(500).json({ error: 'Error eliminant examen' });
  }
});

/* ==================== Server ==================== */
async function start() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`🚀 Server escoltant al port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ No s'ha pogut inicialitzar la DB:", err);
    process.exit(1);
  }
}

start();
