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

function toPlainId(value) {
  if (!value) return value;
  if (value instanceof ObjectId) return value.toHexString();
  if (typeof value === 'object' && typeof value.toHexString === 'function') {
    try {
      return value.toHexString();
    } catch (_err) {
      // ignore fallbacks
    }
  }
  return value;
}

function serializeExam(doc) {
  if (!doc) return doc;
  const payload = { ...doc };
  payload._id = toPlainId(doc._id);
  if (payload.pin != null) payload.pin = String(payload.pin);
  if (Array.isArray(doc.questions)) {
    payload.questions = doc.questions.map((q) => ({ ...q }));
  }
  return payload;
}

function serializeResult(doc) {
  if (!doc) return doc;
  const payload = { ...doc };
  payload._id = toPlainId(doc._id);
  payload.examId = toPlainId(doc.examId);
  return payload;
}

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

function cleanSubject(s) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, 64); // límit raonable
}

/* ==================== API ==================== */

// 📌 Llista d’exàmens (biblioteca) amb filtres opcions ?subject= & ?q=
app.get('/api/exams', async (req, res) => {
  try {
    const { subject, q } = req.query;
    const filter = {};

    if (subject) filter.subject = String(subject);

    if (q) {
      const query = String(q).trim();
      const or = [{ title: { $regex: query, $options: 'i' } }];
      if (ObjectId.isValid(query)) or.push({ _id: new ObjectId(query) });
      filter.$or = or;
    }

    const items = await exams.find(filter, { projection: { questions: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    const safeItems = items.map(serializeExam);

    res.json(safeItems);
  } catch (err) {
    console.error('❌ Error llistant exàmens:', err);
    res.status(500).json({ error: 'Error llistant exàmens' });
  }
});

// 📌 Llista d’assignatures disponibles (distinct)
app.get('/api/exams/subjects', async (_req, res) => {
  try {
    const subjects = (await exams.distinct('subject'))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    res.json({ subjects });
  } catch (err) {
    console.error('❌ Error obtenint assignatures:', err);
    res.status(500).json({ error: 'Error obtenint assignatures' });
  }
});

// 📌 Obté examen per PIN (alumne)
app.get('/api/exams/pin/:pin', async (req, res) => {
  try {
    const exam = await exams.findOne({ pin: String(req.params.pin) });
    if (!exam) return res.status(404).json({ error: 'PIN no trobat' });
    res.json({
      _id: toPlainId(exam._id), // 👈 molt important per guardar resultats
      title: exam.title,
      desc: exam.desc,
      subject: exam.subject || '',
      settings: exam.settings || {},
      questions: exam.questions || [],
      pin: String(exam.pin) // assegurem que sempre sigui string
    });
  } catch (err) {
    console.error('❌ Error obtenint examen per PIN:', err);
    res.status(500).json({ error: 'Error obtenint examen per PIN' });
  }
});

// 📌 Obté examen per ID (mestre)
app.get('/api/exams/:examId', async (req, res) => {
  try {
    const exam = await exams.findOne({ _id: new ObjectId(req.params.examId) });
    if (!exam) return res.status(404).json({ error: 'Examen no trobat' });
    res.json(serializeExam(exam));
  } catch (err) {
    console.error('❌ Error obtenint examen per ID:', err);
    res.status(500).json({ error: 'Error obtenint examen per ID' });
  }
});

// 📌 Crea/publica examen
app.post('/api/exams', async (req, res) => {
  try {
    console.log('➡️ Rebut nou examen:', req.body); // debug
    const body = req.body;

    if (!body?.questions || !body.questions.length) {
      return res.status(400).json({ error: 'Cal almenys una pregunta' });
    }

    let pin;
    do {
      pin = genPin();
    } while (await exams.findOne({ pin: String(pin) }));

    // ❌ eliminem _id i id si vénen del client
    const { _id, id, ...rest } = body;

    const doc = {
      ...rest,
      subject: cleanSubject(rest.subject || ''), // 👈 assignatura
      pin: String(pin),                          // 👈 sempre string
      createdAt: new Date().toISOString()
    };

    const result = await exams.insertOne(doc);
    res.json({ examId: toPlainId(result.insertedId), pin: String(pin) });
  } catch (err) {
    console.error('❌ Error creant examen:', err, 'Body rebut:', req.body);
    res.status(500).json({ error: 'Error creant examen' });
  }
});

// 📌 Actualitza examen (inclou subject)
app.put('/api/exams/:examId', async (req, res) => {
  try {
    const { examId } = req.params;
    const update = { ...req.body, updatedAt: new Date().toISOString() };

    if ('subject' in update) {
      update.subject = cleanSubject(update.subject);
    }

    await exams.updateOne(
      { _id: new ObjectId(examId) },
      { $set: update }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error actualitzant examen:', err);
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
      console.warn('⚠️ PIN incorrecte:', { examPin: exam.pin, payloadPin: payload.pin });
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
    res.json({ ok: true, resultId: toPlainId(result.insertedId) });
  } catch (err) {
    console.error('❌ Error desant resultat:', err, 'Payload rebut:', req.body);
    res.status(500).json({ error: 'Error desant resultat' });
  }
});

// 📌 Consulta resultats per examId
app.get('/api/results/:examId', async (req, res) => {
  try {
    const examId = new ObjectId(req.params.examId);
    const items = await results.find({ examId }).toArray();
    const safeItems = items.map(serializeResult);
    res.json({ examId: toPlainId(examId), items: safeItems });
  } catch (err) {
    console.error('❌ Error obtenint resultats:', err);
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
    console.error('❌ Error exportant CSV:', err);
    res.status(500).json({ error: 'Error exportant CSV' });
  }
}); // ✅ clau que faltava

// 📌 Elimina un examen per ID (i els seus resultats)
app.delete('/api/exams/:examId', async (req, res) => {
  try {
    const examId = new ObjectId(req.params.examId);

    await exams.deleteOne({ _id: examId });      // examen
    await results.deleteMany({ examId });        // resultats associats

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Error eliminant examen:', err);
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
