import express from 'express';
import multer from 'multer';
import { createRequire } from 'module';
import { authMiddleware } from '../middleware/auth.js';
import { publicActionLimiter, analysisLimiter } from '../middleware/rateLimit.js';
import {
  generateAnalysis,
  generateAnalysisWithVision,
  streamConsultationText,
  getSystemPromptForCategory,
  getQuantumSystemPrompt,
  getScenarioDeepDivePrompt,
  getConsultationPrompt,
  getStatus,
  isFraudCategory,
  getCategoryGroup,
  CATEGORY_GROUP_SOURCES
} from '../services/ai.js';
import { generateReportDocx } from '../services/docx.js';
import { generateReportPdf } from '../services/pdf.js';
import { sendAnalysisReport } from '../services/email.js';
import { eq, and, inArray, isNotNull, asc } from 'drizzle-orm';
import { getDb, isDbConfigured } from '../db/client.js';
import { analyses, messages } from '../db/schema.js';
import {
  computeQuantumProbabilities, mergeQuantumResults,
  isIbmHardwareConfigured, verifyScenarioHardwareAsync, buildScenarioHardwareSection,
} from '../services/quantum.js';
import {
  computeFraudRiskScores, mergeFraudResults,
  verifyFraudHardwareAsync, buildFraudHardwareSection,
} from '../services/fraudDetection.js';
import { broadcastToUser } from '../services/socket.js';
import { computeOptimalAllocation, mergeOptimizerResults } from '../services/portfolioOptimizer.js';
import { parseTransactionFile } from '../services/transactionSource.js';
import { parseScenarioFile, parseOptimizationFile } from '../services/scenarioDataSource.js';
import { sheetToText } from '../services/tableParsing.js';
import { isWeatherQuery, getLiveWeatherReply } from '../services/weather.js';
import { researchWeb, formatResearchContext } from '../services/webResearch.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// Runs two searches in parallel: a general topic search (same pattern as
// /chat below), and one steered toward the category group's official local
// + international sources (mevzuat.gov.tr/resmigazete.gov.tr always
// included, plus e.g. tcmb.gov.tr/imf.org for economic reports) via `site:`
// filters. Grounds report content (mevzuat/kurum references) in real search
// results instead of the model's training-data recall, which for
// law/regulation numbers is a real hallucination risk.
async function gatherResearchContext(category, topic) {
  const group = getCategoryGroup(category);
  const sources = CATEGORY_GROUP_SOURCES[group];
  const siteFilter = [...sources.local, ...sources.international].map((d) => `site:${d}`).join(' OR ');
  const topicQuery = (topic || '').slice(0, 150);

  const queries = [topicQuery, siteFilter ? `${topicQuery} mevzuat kanun yönetmelik ${siteFilter}` : null].filter(Boolean);

  try {
    const results = (await Promise.all(queries.map((q) => researchWeb(q).catch(() => [])))).flat();
    return formatResearchContext(results);
  } catch (e) {
    logger.warn({ err: e }, '[WebResearch] generate search error');
    return '';
  }
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const require = createRequire(import.meta.url);

router.get('/status', (req, res) => {
  res.json(getStatus());
});

// Public, boolean-only diagnostic (same exposure level as /status above) --
// actually spawns the Python/Qiskit worker with a trivial payload so a
// broken deployment (e.g. qiskit failed to install, python3 missing) can
// be confirmed directly instead of only inferred from a report silently
// missing quantum results.
router.get('/quantum-status', publicActionLimiter, async (req, res) => {
  const result = await computeQuantumProbabilities([{ id: 'health-check', probability: '%50' }]);
  // Note: `result.backend` is always "qiskit-aer-simulator" -- that's the
  // simulator run that always happens. Whether IBM_QUANTUM_TOKEN/INSTANCE
  // are configured AND a real hardware run actually succeeded is only
  // reflected in hardwareVerification (null if unconfigured or the
  // hardware attempt failed/fell back -- see quantum/_ibm_backend.py).
  res.json({
    ok: !!result,
    backend: result?.backend || null,
    qubits: result?.qubits || null,
    hardwareVerification: result?.hardwareVerification || null,
    ibmDiagnostic: result?.ibmDiagnostic || null,
  });
});

// BDDK/BTK fraud-flag trend over time -- each report previously stood alone,
// with no way to see whether flagged transactions are trending up or down
// across reports. Admin-only: this aggregates flag counts across every
// user's fraud-category reports, not just the caller's own.
router.get('/fraud-trend', authMiddleware, async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Yetkisiz' });
  if (!isDbConfigured()) return res.json({ points: [] });

  try {
    const category = ['bddk', 'btk'].includes(req.query.category) ? req.query.category : null;
    const rows = await getDb()
      .select({
        category: analyses.category,
        transactionCount: analyses.fraudTransactionCount,
        flaggedCount: analyses.fraudFlaggedCount,
        createdAt: analyses.createdAt,
      })
      .from(analyses)
      .where(
        and(
          category ? eq(analyses.category, category) : inArray(analyses.category, ['bddk', 'btk']),
          isNotNull(analyses.fraudTransactionCount)
        )
      )
      .orderBy(asc(analyses.createdAt))
      .limit(1000);

    // Bucketed by day (UTC) x category so multiple reports on the same day
    // still show as one trend point instead of a noisy per-report series.
    const buckets = new Map();
    for (const r of rows) {
      const day = new Date(r.createdAt).toISOString().slice(0, 10);
      const key = `${day}|${r.category}`;
      const bucket = buckets.get(key) || { date: day, category: r.category, reportCount: 0, transactionCount: 0, flaggedCount: 0 };
      bucket.reportCount += 1;
      bucket.transactionCount += r.transactionCount || 0;
      bucket.flaggedCount += r.flaggedCount || 0;
      buckets.set(key, bucket);
    }

    const points = Array.from(buckets.values())
      .map((b) => ({ ...b, flagRate: b.transactionCount ? Math.round((b.flaggedCount / b.transactionCount) * 1000) / 10 : 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({ points });
  } catch (err) {
    logger.error({ err }, '[Analysis] Fraud trend query error');
    res.status(500).json({ error: err.message });
  }
});

// Document upload and text extraction
router.post('/upload', authMiddleware, analysisLimiter, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Dosya bulunamadı' });

    // Image: return as base64 (for Claude Vision)
    if (file.mimetype.startsWith('image/')) {
      return res.json({
        type: 'image',
        base64: file.buffer.toString('base64'),
        mimetype: file.mimetype,
        filename: file.originalname,
      });
    }

    const name = (file.originalname || '').toLowerCase();

    // Real-data upload paths: a CSV/XLSX recognized as a genuine transaction,
    // scenario, or optimization table skips the AI's invented-sample-data
    // path entirely -- see transactionSource.js / scenarioDataSource.js and
    // the realTransactions/realScenarios/realOptimization handling below.
    if (/\.(csv|xlsx|xls)$/.test(name)) {
      const txParsed = parseTransactionFile(file.buffer, file.originalname);
      if (txParsed) {
        return res.json({
          type: 'transactions',
          transactions: txParsed.transactions,
          warnings: txParsed.warnings,
          recordCount: txParsed.transactions.length,
          filename: file.originalname,
        });
      }

      const scenarioParsed = parseScenarioFile(file.buffer, file.originalname);
      if (scenarioParsed) {
        return res.json({
          type: 'scenarios',
          scenarios: scenarioParsed.scenarios,
          warnings: scenarioParsed.warnings,
          recordCount: scenarioParsed.scenarios.length,
          filename: file.originalname,
        });
      }

      const optimizationParsed = parseOptimizationFile(file.buffer, file.originalname);
      if (optimizationParsed) {
        return res.json({
          type: 'optimization',
          items: optimizationParsed.items,
          budgetPercent: optimizationParsed.budgetPercent,
          warnings: optimizationParsed.warnings,
          recordCount: optimizationParsed.items.length,
          filename: file.originalname,
        });
      }

      // Not a recognized structured table -- still usable as generic document context.
      try {
        const csvText = sheetToText(file.buffer);
        return res.json({ type: 'text', text: csvText.slice(0, 15000), length: csvText.length, filename: file.originalname });
      } catch (e) {
        return res.status(400).json({ error: 'Dosya okunamadı: ' + e.message });
      }
    }

    let text = '';

    if (name.endsWith('.txt') || file.mimetype === 'text/plain') {
      text = file.buffer.toString('utf-8');
    } else if (name.endsWith('.pdf') || file.mimetype === 'application/pdf') {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(file.buffer);
        text = data.text;
      } catch (e) {
        return res.status(500).json({ error: 'PDF okunamadı: ' + e.message });
      }
    } else if (name.endsWith('.docx') || file.mimetype.includes('wordprocessingml')) {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        text = result.value;
      } catch (e) {
        return res.status(500).json({ error: 'DOCX okunamadı: ' + e.message });
      }
    } else {
      return res.status(400).json({ error: 'Desteklenmeyen format. PDF, DOCX veya TXT yükleyin.' });
    }

    const trimmed = text.trim().slice(0, 15000);
    res.json({ type: 'text', text: trimmed, length: text.length, filename: file.originalname });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function isRealTransactionArray(v) {
  return Array.isArray(v) && v.length >= 3 && v.every((t) => t && typeof t.amount !== 'undefined');
}

function isRealScenarioArray(v) {
  return Array.isArray(v) && v.length >= 2 && v.every((s) => s && s.title && typeof s.probability !== 'undefined');
}

function isRealOptimizationProblem(v) {
  return v && Array.isArray(v.items) && v.items.length >= 2 && v.items.every((it) => it && typeof it.value !== 'undefined' && typeof it.cost !== 'undefined');
}

/**
 * Standard Analysis — quantum mode optional
 * Body: { category, title, prompt, quantumMode?, documentContext?, realTransactions?, realScenarios?, realOptimization? }
 * realTransactions/realScenarios/realOptimization: real records parsed from
 * an uploaded CSV/XLSX (see transactionSource.js / scenarioDataSource.js).
 * When present, the AI is told NOT to invent the corresponding table and the
 * quantum engine computes on these real rows directly instead of ones the
 * AI fabricated.
 */
router.post('/generate', authMiddleware, analysisLimiter, async (req, res) => {
  try {
    const {
      category, title, prompt, quantumMode = false, documentContext = null, imageData = null,
      realTransactions = null, realScenarios = null, realOptimization = null, lang = 'tr',
    } = req.body;
    const userCode = req.user.userCode;

    if (!category || !prompt) {
      return res.status(400).json({ error: 'category ve prompt zorunlu' });
    }

    const fraudCategory = isFraudCategory(category);
    const hasRealTransactions = fraudCategory && isRealTransactionArray(realTransactions);
    const hasRealScenarios = !fraudCategory && isRealScenarioArray(realScenarios);
    const hasRealOptimization = !fraudCategory && isRealOptimizationProblem(realOptimization);

    const systemPrompt = quantumMode
      ? getQuantumSystemPrompt(category, { hasRealTransactions, hasRealScenarios, hasRealOptimization }, lang)
      : getSystemPromptForCategory(category, lang);

    const webContext = await gatherResearchContext(category, prompt);

    const basePrompt = `${prompt}

---
Raporun sonunda şu bilgileri mutlaka ekle:
- Kullanılan/önerilen yerli sistemler ve koordinatları (ilgili ise)
- Kurumsal koordinasyon önerileri (MSB/SSB/ilgili komutanlık)
- Bir sonraki 30 gün içinde atılması gereken kritik adımlar
- Bu konudaki ulusal mevzuat referansı (kanun/yönetmelik numarası)
${quantumMode ? '\nKUANTUM MOD AKTİF: Birden fazla senaryo hesapla, olasılık matrisi sun.' : ''}`;

    const realTransactionsNote = hasRealTransactions
      ? `[YÜKLENEN GERÇEK İŞLEM VERİSİ -- ${realTransactions.length} kayıt, kullanıcı tarafından yüklenen dosyadan çıkarıldı. BUNLARI UYDURMA/YENİDEN ÜRETME, sadece aşağıdaki gerçek kayıtlara dayanarak yorum yap:]\n` +
        realTransactions.slice(0, 20).map((t) => `${t.id}: ${t.amount} TL, saat ${t.hour}, sıklık ${t.frequency}, yeni taraf ${t.newCounterparty ? 'evet' : 'hayır'}, sınır ötesi ${t.crossBorder ? 'evet' : 'hayır'}`).join('\n') +
        (realTransactions.length > 20 ? `\n... (+${realTransactions.length - 20} kayıt daha)` : '') + '\n\n'
      : '';

    const realScenariosNote = hasRealScenarios
      ? `[YÜKLENEN GERÇEK SENARYO VERİSİ -- ${realScenarios.length} senaryo, kullanıcı tarafından yüklenen dosyadan çıkarıldı. BUNLARI UYDURMA/DEĞİŞTİRME, birincil senaryoyu bunlardan seç ve tam raporu buna göre yaz:]\n` +
        realScenarios.map((s) => `${s.title}: ${s.probability}${s.timeframe ? `, ${s.timeframe}` : ''}${s.trigger ? `, tetikleyici: ${s.trigger}` : ''}`).join('\n') + '\n\n'
      : '';

    const realOptimizationNote = hasRealOptimization
      ? `[YÜKLENEN GERÇEK OPTİMİZASYON VERİSİ -- Bütçe %${realOptimization.budgetPercent}, ${realOptimization.items.length} kalem, kullanıcı tarafından yüklenen dosyadan çıkarıldı. BU TABLOYU UYDURMA/DEĞİŞTİRME:]\n` +
        realOptimization.items.map((it) => `${it.id}: değer ${it.value}, maliyet ${it.cost}`).join('\n') + '\n\n'
      : '';

    const hasRealData = hasRealTransactions || hasRealScenarios || hasRealOptimization;
    const webContextPrefix = webContext ? `${webContext}\n` : '';
    const enrichedPrompt = documentContext || hasRealData
      ? `${webContextPrefix}[YÜKLENEN KAYNAK BELGE]\n${documentContext || ''}\n\n${realTransactionsNote}${realScenariosNote}${realOptimizationNote}[ANALİZ TALEBİ]\n${basePrompt}`
      : `${webContextPrefix}${basePrompt}`;

    const result = imageData?.base64
      ? await generateAnalysisWithVision(systemPrompt, enrichedPrompt, imageData.base64, imageData.mimetype)
      : await generateAnalysis(systemPrompt, enrichedPrompt);

    let scenarios = quantumMode && !fraudCategory
      ? (hasRealScenarios ? realScenarios : parseScenarios(result.content))
      : null;
    let quantumComputation = null;
    let fraudComputation = null;
    let optimizerComputation = null;
    let finalContent = result.content;
    // Surfaced to the client (and appended to the report) whenever quantum
    // mode was requested but the real circuit computation didn't happen --
    // previously this failed completely silently (only a server log line),
    // so a broken Python/Qiskit worker looked identical to a healthy one
    // that just used the AI's own estimates.
    let quantumWarning = null;

    // Hardware verification (when IBM_QUANTUM_TOKEN/INSTANCE are configured)
    // waits on IBM's job queue for up to IBM_QUANTUM_WAIT_SECONDS -- always
    // fetched with skipHardware so /generate responds on the fast local
    // simulator alone; the hardware lane (if any) runs after the response
    // is sent, see the background verification block below.
    let hardwareTransactions = null;
    let hardwareScenarios = null;

    if (quantumMode && fraudCategory) {
      const transactions = hasRealTransactions ? realTransactions : parseTransactions(result.content);
      if (transactions?.length) {
        fraudComputation = await computeFraudRiskScores(transactions, { skipHardware: true });
        if (fraudComputation) {
          hardwareTransactions = transactions;
          fraudComputation.dataSource = hasRealTransactions ? 'uploaded' : 'ai-generated';
          const note = mergeFraudResults(fraudComputation);
          if (note) finalContent += note;
        } else {
          logger.warn('[FraudDetection] Kernel result unavailable — proceeding with AI narrative only');
          quantumWarning = 'Kuantum çekirdek (kernel) hesaplaması başarısız oldu — bu rapor yalnızca YZ anlatısına dayanmaktadır, gerçek kuantum doğrulaması içermemektedir.';
        }
      }
    } else if (quantumMode) {
      if (scenarios?.length) {
        quantumComputation = await computeQuantumProbabilities(scenarios, 4096, { skipHardware: true });
        if (quantumComputation) {
          quantumComputation.dataSource = hasRealScenarios ? 'uploaded' : 'ai-generated';
          const merged = mergeQuantumResults(scenarios, quantumComputation);
          scenarios = merged.scenarios;
          hardwareScenarios = merged.scenarios;
          if (merged.note) finalContent += merged.note;
        } else {
          logger.warn('[Quantum] Circuit result unavailable — proceeding with AI estimates');
          quantumWarning = 'Kuantum devre hesaplaması başarısız oldu — gösterilen olasılıklar YZ tahminleridir, gerçek kuantum ölçümüyle doğrulanmamıştır.';
        }
      } else {
        logger.warn('[Quantum] No parseable scenario matrix in the AI response — quantum computation skipped');
        quantumWarning = 'Kuantum modu seçildi ancak raporda ayrıştırılabilir bir senaryo matrisi bulunamadığından kuantum hesaplaması yapılamadı.';
      }

      // Independent of the scenario matrix: only present when the topic is
      // shaped like a budget-constrained resource-allocation decision, or
      // when the user uploaded one directly.
      const optimizationProblem = hasRealOptimization ? realOptimization : parseOptimizationProblem(result.content);
      if (optimizationProblem?.items?.length) {
        optimizerComputation = await computeOptimalAllocation(optimizationProblem.items, optimizationProblem.budgetPercent);
        if (optimizerComputation) {
          optimizerComputation.dataSource = hasRealOptimization ? 'uploaded' : 'ai-generated';
          const note = mergeOptimizerResults(optimizerComputation);
          if (note) finalContent += note;
        } else {
          logger.warn('[PortfolioOptimizer] QAOA result unavailable — proceeding without it');
        }
      }
    }

    if (quantumWarning) finalContent += `\n\n> ⚠️ ${quantumWarning}`;

    let analysisId = null;
    if (isDbConfigured()) {
      const [row] = await getDb()
        .insert(analyses)
        .values({
          userCode,
          category,
          title: title || prompt.slice(0, 80),
          content: finalContent,
          aiProvider: result.provider,
          fraudTransactionCount: fraudComputation ? fraudComputation.transactionCount : null,
          fraudFlaggedCount: fraudComputation ? fraudComputation.flaggedCount : null,
        })
        .returning({ id: analyses.id });
      analysisId = row.id;
    }

    const docxBuffer = await generateReportDocx({
      category,
      title: title || prompt.slice(0, 80),
      content: finalContent,
      userCode,
      aiProvider: result.provider
    });
    const pdfBuffer = await generateReportPdf({
      category,
      title: title || prompt.slice(0, 80),
      content: finalContent,
      userCode,
      aiProvider: result.provider
    });

    sendAnalysisReport(userCode, category, title || prompt.slice(0, 80), docxBuffer)
      .catch(e => logger.error({ err: e }, 'Mail error'));

    const hardwarePending = isIbmHardwareConfigured() && !!(hardwareScenarios || hardwareTransactions);

    res.json({
      success: true,
      analysisId,
      provider: result.provider,
      content: finalContent,
      docxBase64: docxBuffer.toString('base64'),
      pdfBase64: pdfBuffer.toString('base64'),
      quantumMode,
      quantumWarning,
      scenarios,
      quantum: quantumComputation
        ? {
            backend: quantumComputation.backend,
            qubits: quantumComputation.qubits,
            shots: quantumComputation.shots,
            batches: quantumComputation.batches,
            circuitDepth: quantumComputation.circuitDepth,
            dataSource: quantumComputation.dataSource,
            hardwareVerification: quantumComputation.hardwareVerification || null,
            ibmDiagnostic: quantumComputation.ibmDiagnostic || null,
            hardwarePending: hardwarePending && !!hardwareScenarios,
          }
        : null,
      fraud: fraudComputation
        ? {
            backend: fraudComputation.backend,
            qubits: fraudComputation.qubits,
            circuitDepth: fraudComputation.circuitDepth,
            transactionCount: fraudComputation.transactionCount,
            flaggedCount: fraudComputation.flaggedCount,
            transactions: fraudComputation.transactions,
            dataSource: fraudComputation.dataSource,
            hardwareVerification: fraudComputation.hardwareVerification || null,
            ibmDiagnostic: fraudComputation.ibmDiagnostic || null,
            hardwarePending: hardwarePending && !!hardwareTransactions,
          }
        : null,
      optimizer: optimizerComputation
        ? {
            backend: optimizerComputation.backend,
            qubits: optimizerComputation.qubits,
            circuitDepth: optimizerComputation.circuitDepth,
            selected: optimizerComputation.selected,
            totalValue: optimizerComputation.totalValue,
            totalCost: optimizerComputation.totalCost,
            budgetPercent: optimizerComputation.budgetPercent,
            items: optimizerComputation.items,
            dataSource: optimizerComputation.dataSource,
          }
        : null
    });

    // Deferred, non-blocking: the response above already went out on the
    // fast local-simulator result. If IBM hardware verification is
    // configured, run it now in the background (this is what can take up
    // to IBM_QUANTUM_WAIT_SECONDS) and, once it resolves, append the result
    // to the saved report and push it to the user's socket if still online
    // — see the "background quantum jobs" roadmap item this replaces.
    if (hardwarePending) {
      const io = req.app.get('io');
      (async () => {
        try {
          if (hardwareScenarios) {
            const hw = await verifyScenarioHardwareAsync(hardwareScenarios);
            if (hw?.hardwareVerification) {
              const section = buildScenarioHardwareSection(hardwareScenarios, hw.hardwareVerification);
              if (analysisId && isDbConfigured() && section) {
                await getDb().update(analyses)
                  .set({ content: finalContent + section })
                  .where(eq(analyses.id, analysisId));
              }
              broadcastToUser(io, userCode, 'analysis:hardwareVerified', {
                analysisId, kind: 'quantum', hardwareVerification: hw.hardwareVerification, ibmDiagnostic: hw.ibmDiagnostic,
              }).catch(() => {});
            }
          } else if (hardwareTransactions) {
            const hw = await verifyFraudHardwareAsync(hardwareTransactions);
            if (hw?.hardwareVerification) {
              const section = buildFraudHardwareSection(hw.hardwareVerification);
              if (analysisId && isDbConfigured() && section) {
                await getDb().update(analyses)
                  .set({ content: finalContent + section })
                  .where(eq(analyses.id, analysisId));
              }
              broadcastToUser(io, userCode, 'analysis:hardwareVerified', {
                analysisId, kind: 'fraud', hardwareVerification: hw.hardwareVerification, ibmDiagnostic: hw.ibmDiagnostic,
              }).catch(() => {});
            }
          }
        } catch (err) {
          logger.warn({ err }, '[Analysis] Background hardware verification failed');
        }
      })();
    }
  } catch (err) {
    logger.error({ err }, 'Analysis error');
    res.status(500).json({ error: err.message, code: err.code });
  }
});

/**
 * Alternative scenario deep-dive analysis
 */
router.post('/scenario-deep-dive', authMiddleware, analysisLimiter, async (req, res) => {
  try {
    const { category, scenarioId, scenarioSummary, lang = 'tr' } = req.body;
    const userCode = req.user.userCode;

    const systemPrompt = getScenarioDeepDivePrompt(category, scenarioId, scenarioSummary, lang);
    const userPrompt = `"${scenarioId}" senaryosunun tam derinlemesine analizini hazırla.\nSenaryo özeti: ${scenarioSummary}\nSanki bu birincil senaryoymuş gibi eksiksiz bir BOLD raporu yaz.`;

    const result = await generateAnalysis(systemPrompt, userPrompt);

    let analysisId = null;
    if (isDbConfigured()) {
      const [row] = await getDb()
        .insert(analyses)
        .values({
          userCode,
          category,
          title: `[ALT-SENARYO] ${scenarioId}`,
          content: result.content,
          aiProvider: result.provider,
        })
        .returning({ id: analyses.id });
      analysisId = row.id;
    }

    const docxBuffer = await generateReportDocx({
      category,
      title: `ALTERNATİF SENARYO: ${scenarioId}`,
      content: result.content,
      userCode,
      aiProvider: result.provider
    });
    const pdfBuffer = await generateReportPdf({
      category,
      title: `ALTERNATİF SENARYO: ${scenarioId}`,
      content: result.content,
      userCode,
      aiProvider: result.provider
    });

    res.json({
      success: true,
      analysisId,
      provider: result.provider,
      content: result.content,
      docxBase64: docxBuffer.toString('base64'),
      pdfBase64: pdfBuffer.toString('base64'),
      scenarioId
    });
  } catch (err) {
    logger.error({ err }, 'Scenario analysis error');
    res.status(500).json({ error: err.message, code: err.code });
  }
});

/**
 * Consultation chat — documentContext optional
 */
router.post('/chat', authMiddleware, analysisLimiter, async (req, res) => {
  try {
    const { message, history = [], documentContext = null, imageData = null } = req.body;
    const userCode = req.user.userCode;

    if (isWeatherQuery(message)) {
      const weatherText = await getLiveWeatherReply(message);
      if (isDbConfigured()) {
        await getDb().insert(messages).values([
          { fromUser: userCode, toUser: 'ANATOLIA-Q', message, messageType: 'consultation' },
          { fromUser: 'ANATOLIA-Q', toUser: userCode, message: weatherText, messageType: 'consultation' },
        ]);
      }
      return res.json({ provider: 'Live Weather (Open-Meteo)', content: weatherText });
    }

    const systemPrompt = getConsultationPrompt();

    const historyStr = history.length
      ? history.map(m => `${m.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${m.content}`).join('\n') + '\n'
      : '';

    const docPrefix = documentContext
      ? `[YÜKLENEN KAYNAK BELGE]\n${documentContext}\n\n`
      : '';

    let webContext = '';
    try {
      const webResults = await researchWeb(message);
      webContext = formatResearchContext(webResults);
    } catch (e) {
      logger.warn({ err: e }, '[WebResearch] search error');
    }

    const userPrompt = `${webContext ? `${webContext}\n` : ''}${docPrefix}${historyStr}Kullanıcı: ${message}\n\nNot: Eğer web araştırması geldiyse önce onu baz al, kaynaklarla tutarlı cevap ver.`;

    // If an image is present, use the existing one-shot (non-streaming) vision path;
    // for text-only chat the reply streams in real time.
    const result = imageData?.base64
      ? await generateAnalysisWithVision(systemPrompt, userPrompt, imageData.base64, imageData.mimetype)
      : await streamConsultationText(systemPrompt, userPrompt, res);

    if (isDbConfigured()) {
      await getDb().insert(messages).values([
        { fromUser: userCode, toUser: 'ANATOLIA-Q', message, messageType: 'consultation' },
        { fromUser: 'ANATOLIA-Q', toUser: userCode, message: result.content, messageType: 'consultation' },
      ]);
    }

    if (!res.headersSent) {
      res.json({ provider: result.provider, content: result.content });
    }
  } catch (err) {
    logger.error({ err }, 'Chat error');
    if (!res.headersSent) {
      res.status(500).json({ error: err.message, code: err.code });
    } else {
      res.end();
    }
  }
});

// Parses a number that may be in Turkish notation ("." thousands separator,
// "," decimal separator, e.g. "15.000,50") as well as plain notation.
// Only treats "." as a thousands separator when it's unambiguous — either a
// "," decimal separator is also present, or the whole string is a pure
// digit-grouping ("15.000") with no fractional remainder — so ordinary
// decimals like "0.5" are left untouched.
function toNumber(s) {
  let str = String(s).replace(/[^\d.,-]/g, '').trim();
  if (!str) return 0;
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  if (hasComma && hasDot) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    str = str.replace(',', '.');
  } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(str)) {
    str = str.replace(/\./g, '');
  }
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : 0;
}

function parseScenarios(content) {
  try {
    const scenarios = [];
    // "MATR.S." (wildcard for İ/I) avoids depending on a literal diacritic
    // character matching byte-for-byte against whatever encoding the LLM
    // used for the Turkish İ in "MATRİSİ".
    const matrixMatch = content.match(/KUANTUM OLASILIK MATR.S.[\s\S]*?\|([^\n]+)\|([^\n]+)\|([^\n]+)\|([^\n]+)\|([\s\S]*?)(?=\n##|\n---|\n\n##|$)/i);
    if (!matrixMatch) return null;

    // The AI sometimes wraps the scenario cell in markdown bold
    // ("| **SENARYO-A...** | ..."), which a plain startsWith('| SENARYO')
    // check misses entirely -- silently dropping every scenario row and
    // disabling the quantum computation for the whole report. Tolerate
    // leading emphasis markers, and strip them from every cell so ids/
    // titles don't carry literal asterisks through to the UI or the
    // Qiskit worker payload.
    const lines = content.split('\n').filter(l => /^\|\s*\*{0,2}SENARYO/.test(l.trim()));
    for (const line of lines) {
      const parts = line.split('|').map(s => s.trim().replace(/\*+/g, '')).filter(Boolean);
      if (parts.length >= 3) {
        scenarios.push({
          id: parts[0].split(' ')[0] + ' ' + (parts[0].split(' ')[1] || ''),
          title: parts[0],
          probability: parts[1],
          timeframe: parts[2],
          trigger: parts[3] || ''
        });
      }
    }
    return scenarios.length > 0 ? scenarios : null;
  } catch {
    return null;
  }
}

function parseTransactions(content) {
  try {
    const transactions = [];
    // "LEM KAYITLARI" (drops the leading İ/I/Ş/S entirely) sidesteps both the
    // diacritic-encoding risk above AND the İŞLEM (with Ş) vs. an ASCII
    // "ISLEM" transliteration mismatch.
    const tableMatch = content.match(/LEM KAYITLARI[\s\S]*?\|([^\n]+)\|([^\n]+)\|([^\n]+)\|([^\n]+)\|([^\n]+)\|([^\n]+)\|([\s\S]*?)(?=\n##|\n---|\n\n##|$)/i);
    if (!tableMatch) return null;

    // Same emphasis-marker tolerance as parseScenarios below -- the AI can
    // wrap the row's leading cell in markdown bold.
    const lines = content.split('\n').filter(l => /^\|\s*\*{0,2}TXN/.test(l.trim()));
    for (const line of lines) {
      const parts = line.split('|').map(s => s.trim().replace(/\*+/g, '')).filter(Boolean);
      if (parts.length >= 6) {
        transactions.push({
          id: parts[0],
          amount: toNumber(parts[1]),
          hour: toNumber(parts[2]),
          frequency: toNumber(parts[3]),
          newCounterparty: toNumber(parts[4]),
          crossBorder: toNumber(parts[5]),
        });
      }
    }
    return transactions.length > 0 ? transactions : null;
  } catch {
    return null;
  }
}

function parseOptimizationProblem(content) {
  try {
    // "OPT.M.ZASYON PROBLEM" (wildcards for the İ/I in "OPTİMİZASYON", drops
    // the trailing İ) sidesteps the diacritic mojibake risk -- same
    // reasoning as parseScenarios' "MATR.S." and parseTransactions'
    // "LEM KAYITLARI". This previously used a literal ASCII "OPTIMIZASYON",
    // but the AI's actual uppercase Turkish text uses İ (U+0130), which is
    // NOT case-fold-equivalent to ASCII I/i -- so the heading never
    // matched and this parser always returned null in production.
    const headingIdx = content.search(/OPT.M.ZASYON PROBLEM/i);
    if (headingIdx === -1) return null;

    // Bounded by the next section heading (like the other parsers), with a
    // generous cap so a missing heading marker can't run away indefinitely.
    const rest = content.slice(headingIdx);
    const endMatch = rest.match(/\n##|\n---|\n\n##/);
    const section = rest.slice(0, Math.min(endMatch ? endMatch.index : rest.length, 8000));

    // Prefer a "%N" that appears near the word "bütçe" so an unrelated
    // percentage mentioned earlier in the section isn't mistaken for it.
    const budgetMatch = section.match(/b[üu]tçe[^%]{0,40}%\s*(\d+(?:[.,]\d+)?)/i)
      || section.match(/%\s*(\d+(?:[.,]\d+)?)[^%]{0,40}b[üu]tçe/i)
      || section.match(/%\s*(\d+(?:[.,]\d+)?)/);
    const budgetPercent = budgetMatch ? toNumber(budgetMatch[1]) : 60;

    const lines = section.split('\n').filter(l => l.trim().startsWith('|'));
    const items = [];
    for (const line of lines) {
      const parts = line.split('|').map(s => s.trim().replace(/\*+/g, '')).filter(Boolean);
      if (parts.length < 3) continue;
      if (/^-+$/.test(parts[1])) continue; // separator row
      if (toNumber(parts[1]) === 0 && toNumber(parts[2]) === 0) continue; // header row
      items.push({ id: parts[0], value: toNumber(parts[1]), cost: toNumber(parts[2]) });
    }

    return items.length >= 2 ? { budgetPercent, items } : null;
  } catch {
    return null;
  }
}

// Exported for unit tests — these are LLM-output parsers, the most format-
// fragile code in this file, and previously had a bug that silently broke
// scenario parsing.
export { toNumber, parseScenarios, parseTransactions, parseOptimizationProblem };

export default router;

