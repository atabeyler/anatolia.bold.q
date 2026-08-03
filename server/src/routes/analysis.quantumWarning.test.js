import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const generateAnalysisMock = vi.fn();
const computeQuantumProbabilitiesMock = vi.fn();
const generateReportDocxMock = vi.fn(async () => Buffer.from('docx'));
const generateReportPdfMock = vi.fn(async () => Buffer.from('pdf'));

vi.mock('../services/ai.js', () => ({
  generateAnalysis: (...args) => generateAnalysisMock(...args),
  generateAnalysisWithVision: vi.fn(),
  streamConsultationText: vi.fn(),
  getSystemPromptForCategory: () => 'sys',
  getQuantumSystemPrompt: () => 'sys-quantum',
  getScenarioDeepDivePrompt: () => 'sys-scenario',
  getConsultationPrompt: () => 'sys-consult',
  getStatus: () => ({ claude: false, gemini: false, openai: false }),
  isFraudCategory: () => false,
}));
vi.mock('../services/docx.js', () => ({ generateReportDocx: (...args) => generateReportDocxMock(...args) }));
vi.mock('../services/pdf.js', () => ({ generateReportPdf: (...args) => generateReportPdfMock(...args) }));
vi.mock('../services/email.js', () => ({ sendAnalysisReport: vi.fn(async () => {}) }));
vi.mock('../db/client.js', () => ({ isDbConfigured: () => false, getDb: () => { throw new Error('not used when isDbConfigured() is false'); } }));
vi.mock('../db/schema.js', () => ({ analyses: {}, messages: {} }));
vi.mock('../services/quantum.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    computeQuantumProbabilities: (...args) => computeQuantumProbabilitiesMock(...args),
  };
});
vi.mock('../services/fraudDetection.js', () => ({ computeFraudRiskScores: vi.fn(), mergeFraudResults: vi.fn() }));
vi.mock('../services/portfolioOptimizer.js', () => ({ computeOptimalAllocation: vi.fn(), mergeOptimizerResults: vi.fn() }));
vi.mock('../services/transactionSource.js', () => ({ parseTransactionFile: vi.fn() }));
vi.mock('../services/scenarioDataSource.js', () => ({ parseScenarioFile: vi.fn(), parseOptimizationFile: vi.fn() }));
vi.mock('../services/tableParsing.js', () => ({ sheetToText: vi.fn() }));
vi.mock('../services/weather.js', () => ({ isWeatherQuery: () => false, getLiveWeatherReply: vi.fn() }));
vi.mock('../services/webResearch.js', () => ({ researchWeb: vi.fn(), formatResearchContext: vi.fn() }));

const { default: analysisRouter } = await import('./analysis.js');
const { JWT_SECRET } = await import('../lib/jwtSecret.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analysis', analysisRouter);
  return app;
}

function token(userCode = 'BOLD-001') {
  return jwt.sign({ userCode }, JWT_SECRET, { expiresIn: '1h' });
}

const QUANTUM_CONTENT = `## KUANTUM OLASILIK MATRİSİ
| Senaryo | Olasılık | Zaman Ufku | Kritik Tetikleyici |
|---|---|---|---|
| SENARYO-A | %60 | 0-12 ay | tetikleyici A |
| SENARYO-B | %40 | 12-24 ay | tetikleyici B |
`;

beforeEach(() => {
  vi.clearAllMocks();
  generateAnalysisMock.mockResolvedValue({ content: QUANTUM_CONTENT, provider: 'Test Provider' });
});

describe('POST /api/analysis/generate -- quantum failure visibility', () => {
  it('surfaces a quantumWarning (and appends a note to the report) when the circuit computation fails', async () => {
    computeQuantumProbabilitiesMock.mockResolvedValue(null); // simulates a broken/missing Qiskit worker
    const app = buildApp();
    const res = await request(app)
      .post('/api/analysis/generate')
      .set('Authorization', `Bearer ${token()}`)
      .send({ category: 'enerji', title: 'Test', prompt: 'test prompt', quantumMode: true });

    expect(res.status).toBe(200);
    expect(res.body.quantumWarning).toMatch(/başarısız/);
    expect(res.body.content).toContain(res.body.quantumWarning);
  });

  it('does not set quantumWarning when the circuit computation succeeds', async () => {
    computeQuantumProbabilitiesMock.mockResolvedValue({
      backend: 'qiskit-aer-simulator', qubits: 2, shots: 4096, batches: 1, circuitDepth: 8,
      scenarios: [
        { id: 'SENARYO-A', llmEstimate: 60, quantumProbability: 58, quantumStdDev: 1, quantumRangeLow: 57, quantumRangeHigh: 59 },
        { id: 'SENARYO-B', llmEstimate: 40, quantumProbability: 42, quantumStdDev: 1, quantumRangeLow: 41, quantumRangeHigh: 43 },
      ],
    });
    const app = buildApp();
    const res = await request(app)
      .post('/api/analysis/generate')
      .set('Authorization', `Bearer ${token()}`)
      .send({ category: 'enerji', title: 'Test', prompt: 'test prompt', quantumMode: true });

    expect(res.status).toBe(200);
    expect(res.body.quantumWarning).toBeNull();
    expect(res.body.quantum).toMatchObject({ backend: 'qiskit-aer-simulator', qubits: 2 });
  });

  it('does not set quantumWarning when quantum mode is off', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/analysis/generate')
      .set('Authorization', `Bearer ${token()}`)
      .send({ category: 'enerji', title: 'Test', prompt: 'test prompt', quantumMode: false });

    expect(res.status).toBe(200);
    expect(res.body.quantumWarning).toBeNull();
    expect(computeQuantumProbabilitiesMock).not.toHaveBeenCalled();
  });
});
