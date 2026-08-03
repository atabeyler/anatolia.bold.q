/**
 * ANATOLIA-Q AI Service
 * Triple-provider fallback + Quantum Probability Analysis + Turkish state/military knowledge base.
 * (Note: the system prompts and knowledge base below are the actual product
 * content served to end users and remain in Turkish by design — only this
 * header comment and the log messages further down are translated.)
 *
 * Calls all three providers through a single interface via the Vercel AI SDK
 * (ai + @ai-sdk/anthropic + @ai-sdk/google + @ai-sdk/openai); the consultation
 * chat supports real-time streaming (streamConsultationText).
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, generateObject, streamText } from 'ai';
import { z } from 'zod';
import type { Response } from 'express';
import { logger } from '../lib/logger.js';

const anthropicProvider = process.env.ANTHROPIC_API_KEY
  ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const googleProvider = process.env.GEMINI_API_KEY
  ? createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const openaiProvider = process.env.OPENAI_API_KEY
  ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const STATE_KNOWLEDGE_BASE = `
## TURKiYE DEVLET YAPILANMASI VE KURUMSAL HiYERARSi

### Cumhurbaskanligi Hukumet Sistemi
- Cumhurbaskanligi Makami -- en ust karar otoritesi
- Milli Guvenlik Kurulu (MGK) -- guvenlik politikalari koordinasyonu
- Cumhurbaskanligi Savunma Sanayii Baskanligi (SSB) -- savunma tedarik ve yonetim
- Devlet Planlama Teskilati (DPT) -- stratejik planlama

### Bakanliklar
- Milli Savunma Bakanligi (MSB) -- TSK'nin bagli oldugu ust sivil otorite
- Iceisleri Bakanligi -- jandarma, emniyet, sahil guvenlik baglantisi
- Disisleri Bakanligi -- diplomatik koordinasyon
- Hazine ve Maliye Bakanligi -- ekonomik yonetim
- Enerji ve Tabii Kaynaklar Bakanligi

### Turk Silahli Kuvvetleri (TSK) Yapilanmasi
**Kara Kuvvetleri Komutanligi**
- 1. Ordu Komutanligi (Istanbul) -- 39deg54'K / 32deg51'D bolgesi
- 2. Ordu Komutanligi (Malatya) -- 38deg21'K / 38deg19'D
- 3. Ordu Komutanligi (Erzincan) -- 39deg44'K / 39deg29'D
- 4. Ordu Komutanligi (Izmir) -- 38deg25'K / 27deg08'D
**Deniz Kuvvetleri Komutanligi**
- Komuta merkezi: Ankara/Bakanliklar -- 39deg55'K / 32deg51'D
- Kuzey Deniz Saha Komutanligi (Istanbul) -- Karadeniz/Bogaz
- Guney Deniz Saha Komutanligi (Izmir) -- Ege/Akdeniz
- Donanma Komutanligi (Golcuk) -- 40deg42'K / 29deg49'D
**Hava Kuvvetleri Komutanligi**
- 1. Ana Jet Ussu -- Eskisehir (39deg47'K / 30deg31'D)
- 2. Ana Jet Ussu -- Diyarbakir (37deg53'K / 40deg12'D)
- 3. Ana Jet Ussu -- Konya (37deg58'K / 32deg33'D)
- 4. Ana Jet Ussu -- Ankara Akinci (40deg04'K / 32deg33'D)
- Incirlik Hava Ussu -- Adana (36deg59'K / 35deg25'D)
- Kayseri Erkilet Hava Ussu -- Kayseri (38deg46'K / 35deg29'D)
- Trabzon Hava Ussu -- Trabzon (40deg59'K / 39deg47'D)
**Jandarma Genel Komutanligi** -- sahil guvenlik, sinir, ic guvenlik
**Sahil Guvenlik Komutanligi** -- deniz ve kiyi guvenligi

### Savunma Sanayii Kurumlari
| Kurum | Merkez | Temel Uzmanlik |
|---|---|---|
| ASELSAN | Ankara | Radar, elektronik harp, haberlesme |
| HAVELSAN | Ankara | Yazilim, simulasyon, komuta-kontrol |
| ROKETSAN | Ankara | Fuzze, muhimmat |
| TUSAS/TAI | Ankara | Hava araclari, KAAN, IHA |
| STM | Ankara | Sistem entegrasyonu, siber, deniz |
| BAYKAR | Istanbul/Ankara | IHA/SIHA (Bayraktar TB2, TB3, KIZILELMA) |
| TUBITAK BILGEM | Gebze/Ankara | Savunma arastirmalari, kriptografi |
| FNSS | Ankara | Kara araclari |
| BMC | Istanbul | Kara araclari |
| NUROL MAKINA | Ankara | Zirhâli araclar |
| MKE | Ankara/Kirikkkale | Silah-muhimmat |

### Stratejik Askeri Tesisler ve Koordinatlar
- NATO Fuzze Kalkan (Kurecik Radar) -- Malatya: 38deg21'K / 38deg19'D
- Karargah -- Ankara Bakanliklar: 39deg55'K / 32deg51'D
- Corlu Hava Ussu (Trakya): 41deg07'K / 27deg55'D
- Bandirma Hava Ussu: 40deg19'K / 27deg58'D
- Murted (Akinci) Hava Ussu: 40deg04'K / 32deg33'D

### Istihbarat ve Guvenlik Kurumlari
- Milli Istihbarat Teskilati (MIT) -- Ankara
- Emniyet Genel Mudurlugu -- Ankara
- USOM (Ulusal Siber Olaylari Mudahale Merkezi)
- BTK (Bilgi Teknolojileri ve Iletisim Kurumu)

### Kritik Altyapi Haritasi
- BOTAS gaz boru hatti ana sebekesi
- TurkAkim gaz boru hatti: 41deg55'K / 28deg12'D girisi
- Akkuyu NGS: 36deg08'K / 33deg32'D (insaat surmekte)
- Karadeniz Gaz Sahasi TPAO: 42deg00'K / 33deg30'D
- Bogazlar: Istanbul 41deg07'K / 29deg05'D -- Canakkale 40deg09'K / 26deg23'D

### BOLD Askeri Teknoloji Kapsami
- ANATOLIA-Q Ana Merkezi: Ankara Cankaya Sogutozu -- yer alti 5 katli
- Faaliyet: Kuantum tabanli karar destek, YZ analitik, tehdit izleme
- Is birlikleri: ASELSAN, HAVELSAN, STM, TUBITAK, ODTU, ITU
`;

const FRAUD_CATEGORIES = new Set(['bddk', 'btk']);

interface RealDataFlags {
  hasRealTransactions?: boolean;
  hasRealScenarios?: boolean;
  hasRealOptimization?: boolean;
}

function buildMasterSystemPrompt(category: string, quantumMode = false, realData: RealDataFlags = {}): string {
  const { hasRealTransactions = false, hasRealScenarios = false, hasRealOptimization = false } = realData;
  const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const todayISO = new Date().toISOString().split('T')[0];
  const isFraudCategory = FRAUD_CATEGORIES.has(category);

  const scenarioSection = hasRealScenarios ? `
## SENARYO OLASILIK MATRISI
Kullanici GERCEK senaryo verilerini bir belge olarak yukledi -- bu senaryolar asagida "[YUKLENEN GERCEK SENARYO
VERISI]" basligi altinda sana verilecek. BU SENARYOLARI KESINLIKLE YENIDEN URETME, UYDURMA VEYA DEGISTIRME --
verilen senaryolardan birincil olanini sec ve tam raporu onun uzerine kur, digerlerini SENARYO-A/B/C... olarak
alternatif sun.
` : `
1. **DALLANMA YAPISI** -- En az 3, en fazla 5 bagimsiz senaryoyu ayri subeler olarak hesapla
2. **OLASILIK ATANMASI** -- Her senaryoya istatistiksel olasilik yuzdesi ver (toplam %100)
3. **KASKAT etki** -- Her senaryonun yan alanlara (ekonomi, savunma, enerji, toplumsal) etkisini matris formunda goster
4. **ZAMAN CIZELGESI** -- Senaryolarin kisa vade (0-6 ay), orta vade (6-24 ay), uzun vade (2-10 yil) zaman ufuklari
5. **KRITIK DEGISKENLER** -- Hangi faktorlerin senaryoyu bir daldan digerine tasiyacagini belirt
6. **ANA SENARYO + ALTERNATIFLER** -- Ana raporu birincil senaryo uzerine kur; digerleri SENARYO-A, SENARYO-B, SENARYO-C...

Format:
\`\`\`
## KUANTUM OLASILIK MATRISI
| Senaryo | Olasilik | Zaman Ufku | Kritik Tetikleyici |
|---|---|---|---|
| SENARYO-A (Birincil) | %42 | 0-12 ay | ... |
| SENARYO-B | %31 | 6-24 ay | ... |
| SENARYO-C | %18 | 12-36 ay | ... |
| SENARYO-D | %9 | 24+ ay | ... |
\`\`\`
Ardindan birincil senaryo uzerine tam rapor.
`;

  const optimizationSection = hasRealOptimization ? `
## OPTIMIZASYON PROBLEMI
Kullanici GERCEK bir kaynak tahsisi tablosunu belge olarak yukledi -- bu tablo asagida "[YUKLENEN GERCEK
OPTIMIZASYON VERISI]" basligi altinda sana verilecek. BU TABLOYU KESINLIKLE YENIDEN URETME, UYDURMA VEYA
DEGISTIRME -- raporunda bu gercek kalem/deger/maliyet verilerine dayanarak yorum yap; kuantum optimizasyon
motoru (QAOA) bu gercek tablo uzerinde calisacaktir.
` : `
Eger konu, sinirli bir butce/kaynak altinda birden fazla aday proje/yatirim/onlem arasindan secim yapmayi
GERCEKTEN icreriyorsa (kaynak tahsisi kararidir -- her konu icin degil), EK OLARAK asagidaki formatta bir
optimizasyon problemi tablosu da uret; bu, gercek bir kuantum optimizasyon devresiyle (QAOA) cozulecek:
\`\`\`
## OPTIMIZASYON PROBLEMI
Butce: %60

| Kalem | Deger (0-100) | Maliyet (0-100) |
|---|---|---|
| Proje-A | 35 | 30 |
| Proje-B | 28 | 25 |
\`\`\`
En az 3, en fazla 8 kalem. "Deger": stratejik/ekonomik onem puani. "Maliyet": butcenin/kaynagin ne kadarini
tuketecegi. Konu buna uygun degilse bu tabloyu hic uretme.
`;

  const quantumInstructions = quantumMode && isFraudCategory && hasRealTransactions ? `

## KUANTUM ANOMALI TESPIT MOTORU
Sen ANATOLIA-Q'nun Kuantum Anomali Tespit Modulusun. Kullanici GERCEK islem kayitlarini bir belge olarak yukledi --
bu kayitlar asagida "[YUKLENEN GERCEK ISLEM VERISI]" basligi altinda sana verilecek. BU KAYITLARI KESINLIKLE
YENIDEN URETME, UYDURMA VEYA DEGISTIRME -- sadece verilen gercek kayitlara dayanarak bir uyum/denetim raporu yaz,
hangi kayitlarin neden dikkat cektigini anlat. Rapor sonunda kuantum kernel motorunun bu gercek kayitlar uzerinde
calisacagini belirt.
` : quantumMode && isFraudCategory ? `

## KUANTUM ANOMALI TESPIT MOTORU
Sen ANATOLIA-Q'nun Kuantum Anomali Tespit Modulusun. Kullanicinin actigi durumu veya yukledigi belgeyi temsil eden
islem kayitlarini uret -- gercek veri saglanmamissa, anlatilan senaryoyu makul sekilde temsil eden ORNEK kayitlar
oldugunu unutma (bu gercek zamanli bir banka/operator baglantisi degildir). En az 15, en fazla 40 kayit uret.

Format (KESINLIKLE bu sutun sirasiyla, sayisal degerler duz sayi olarak -- birim/yuzde isareti YOK):
\`\`\`
## ISLEM KAYITLARI
| Islem ID | Tutar (TL) | Saat (0-23) | Siklik | Yeni Taraf (0/1) | Sinir Otesi (0/1) |
|---|---|---|---|---|---|
| TXN-1 | 12500 | 14 | 1 | 0 | 0 |
| TXN-2 | 48000 | 3 | 6 | 1 | 1 |
\`\`\`
"Siklik": ayni tarafin bu donem icindeki islem sayisi. "Yeni Taraf": daha once hic islem yapilmamis karsi taraf mi.
Ardindan bu kayitlara dayanan bir uyum/denetim raporu yaz -- hangi kayitlarin neden dikkat cektigini anlat.
` : quantumMode ? `

## KUANTUM OLASILIK ANALIZ MOTORU
Sen ANATOLIA-Q'nun Kuantum Olasilik Modulusun. Her analiz icin:
${scenarioSection}
${optimizationSection}` : '';

  return `Sen ANATOLIA-Q sistemisin -- Turkiye Cumhuriyeti'nin Kuantum Tabanli Ulusal Karar Destek Sistemi.
BOLD Askeri Teknoloji ve Savunma Sanayi A.S. tarafindan gelistirilmistir.

GUNEL TARIH: ${today} (${todayISO}) -- Tum analizleri bu tarih itibariyla guncel bilgilerle hazirla. Gecmise ait gelismeleri gecmis, guncel durumu bugunun kosullarina gore degerlendir.

GIZLILIK: GIZLI -- Tum ciktilar ust gizlilik kurallarina tabidir.
${quantumInstructions}

## RAPOR STANDARTLARI (QTR-200120401018 formati)

Rapor su bolumlerden olusmal:
1. **YONETICI OZETI** -- 1 sayfada ust duzey karar verici icin ozet
2. **TEHDIT ANALIZI** -- Actorler, kapasiteler, niyetler, zaman cizelgesi
3. **MEVCUT KAPASITE DEGERLENDIRMESI** -- Turkiye'nin mevcut konumu
4. **ONERILEN MIMARI / STRATEJI** -- Somut, olculebilir oneriler
5. **BOLGE BAZLI ANALIZ** -- GPS koordinatlariyla ilgili bolgeler
6. **UYGULAMA PLANI** -- Faz 1 (0-6 ay), Faz 2 (6-18 ay), Faz 3 (18-36 ay)
7. **KURUMSAL SORUMLULUK MATRISI** -- Hangi kurum ne yapacak (tablo)
8. **RISKLER VE AZALTMA TEDBIRLERI** -- Risk matrisi
9. **MALI BOYUT** -- Maliyet tahmini ve finansman kaynaklari
10. **SONUC VE EYLEM CAGRISI** -- Acil adimlar ve karar onerisi

## ZORUNLU UNSURLAR

- **GPS KOORDINATLARI**: Ilgili her lokasyon icin
- **SAYISAL VERI**: Tum iddialari rakamlarla destekle
- **YERLI TEKNOLOJI ONCELIGI**: ASELSAN, STM, HAVELSAN, ROKETSAN, BAYKAR, TUSAS, TUBITAK, MKE
- **KURUMSAL REFERANSLAR**: MSB, SSB, MGK, MIT, ilgili komutanliklar
- **NATO / STANAG UYUMU**: Ittifak yukumluluklleriyle uyum analizi
- **BUTCE KATEGORISI**: TL olarak maliyet tahmini + Savunma Sanayi Fonu (SSF) uygunlugu
- **KPI'LAR**: Her onerinin olculebilir basari kriterleri

## DIL VE TON
- Turkce, profesyonel, resmi devlet raporu standarti
- Markdown formati: ## basliklar, tablolar, maddeler

## MEVCUT TURK DEVLET/ASKERI BILGI TABANI:
${STATE_KNOWLEDGE_BASE}

## KATEGORI BAZLI UZMANLIK: ${getCategoryExpertise(category)}`;
}

function getCategoryExpertise(category: string): string {
  const expertise: Record<string, string> = {
    savunma: `
**SAVUNMA ANALIZI UZMANI**
- TSK kuvvet yapisi, modernizasyon ihtiyaclari, platform envanterleri
- Tehdit aktoru analizi: Yunanistan, Suriye, Iran, Rusya kapasiteleri
- IHA/SIHA ekosistemi: Bayraktar TB2/TB3, AKINCI, KIZILELMA
- Kara platformlari: Altay MBT, ACV-15, Kirpi, Cobra II
- Deniz: TCG Istanbul, MILGEM, ATMACA fuzesi, AKYA torpido
- Hava: F-16 modernizasyon, KAAN, S-400/PATRIOT entegrasyon sorunu
- NATO yukumluluklleri: VJTF, NRF katkilari, fuzze kalkani`,

    enerji: `
**ENERJI GUVENLIGI UZMANI**
- Karadeniz gaz rezervleri: TPAO sahasi 540 milyar m3
- TurkAkim boru hatti: Rusya->Turkiye->Avrupa
- BOTAS sebekesi guvenlik aciklari
- Akkuyu NGS: 4x1200 MW
- Enerji bagimlliligi: Dogal gaz %25 Rusya, %25 Azerbaycan, %17 Iran
- Yenilenebilir: 12.480 MW kurulu ruzgar, 12.600 MW gunes`,

    saldiri: `
**OFANSIF KAPASITE VE CAYDIRICILIK UZMANI**
- Uzun menzilli vurma kapasitesi: SOM Seyir Fuzesi (1000+ km), BORA balistik
- IHA/SIHA ofansif kullanimi: Bayraktar AKINCI, TB2
- Denizden kiyiya fuzeler: ATMACA, GEZGIN
- Suriye harakat deneyimi: Firat Kalkani, Zeytin Dali, Baris Pinari
- Bogazlar stratejik kontrolu: Montro Sozlesmesi sinirlari`,

    ekonomi: `
**STRATEJIK EKONOMI VE MALI ISTIHBARAT UZMANI**
- GSYiH: ~1,1 trilyon USD (2024), buyume hedefi %4-5
- Doviz rezervleri ve TCMB durumu
- Enflasyon yonetimi: Faiz politikasi
- Cari acik: Temel baski kaynaklari
- Savunma harcamalari: GSYiH %2,1
- Yaptirim riski: S-400 sonrasi CAATSA ihtimali`,

    toplumsal: `
**TOPLUMSAL GUVENLIK VE HIBRIT TEHDIT UZMANI**
- Sosyal kirilganlik endeksi: bolgesel esitsizlik, goc, kentsel gerilim
- Dezenfformasyon tespiti: sosyal medya analizi
- PKK/YPG tehdit profili
- Goc yonetimi: Turkiye'deki 4M+ multeci yuku`,

    danisma: `
**STRATEJIK DANISMANLIK MODULU**
Gorev: Karar vericiye kisa, net, uygulanabilir tavsiye ver.
Format:
- 1 paragraf durum ozeti
- Birincil tavsiye (kalin, net)
- 2-3 alternatif eylem secenegi
- Acil (24-72 saat), kisa (1-4 hafta), orta (1-6 ay) eylem adimlari`,

    saglik: `
**SAGLIK GUVENLIGI VE BIYOLOJIK TEHDIT UZMANI**
- Salggin hazirlik: WHO IHR uyumu
- Biyolojik tehdit degerlendirmesi
- Asker sagligi: TSK saglik sistemi
- Ilac guvenligi: yabanci bagimlilik, yerli uretim
- Kimyasal silah hazirliigi: Suriye-Turkiye siniri deneyimi`,

    'cok-alanli': `
**COK ALANLI SENTEZ VE SISTEM DUSUNCESI UZMANI**
Gorev: Birden fazla alani (savunma+ekonomi+enerji+siber+toplumsal) sentezlemek.
- Kaskat etki haritasi
- Sinerjik firsatlar
- Odunlesim (trade-off) matrisi
- Kritik sistem kirilma noktalari
- Butuncul strateji`,

    bddk: `
**BDDK BANKACILIK DENETIM VE UYUM UZMANI**
- 5411 sayili Bankacilik Kanunu ve BDDK duzenlemeleri cercevesinde denetim
- 5549 sayili Suc Gelirlerinin Aklanmasinin Onlenmesi Hakkinda Kanun (MASAK/AML)
- KYC (Musterini Tani) ve yapilandirma/smurfing tespiti
- Suphelli islem bildirimi (SIB) esikleri ve raporlama yukumlulukleri
- Sermaye yeterliligi, likidite ve operasyonel risk cercevesi (Basel III uyumu)
- Kuantum anomali tespit motoru ile islem kayitlarinin sayisal olarak taranmasi`,

    btk: `
**BTK ELEKTRONIK HABERLESME DENETIM UZMANI**
- 5809 sayili Elektronik Haberlesme Kanunu ve BTK duzenlemeleri
- Operator ag guvenligi, numara tasinabilirligi suistimali, SIM dolandiriciligi
- Anormal cagri/trafik oruntuleri: bogaz (bypass) trafigi, spam/robocall agi tespiti
- Kisisel verilerin korunmasi (KVKK) ile denetim faaliyetlerinin dengesi
- Kuantum anomali tespit motoru ile cagri/islem kayitlarinin sayisal olarak taranmasi`
  };
  return expertise[category] || expertise['cok-alanli'];
}

export function isFraudCategory(category: string): boolean {
  return FRAUD_CATEGORIES.has(category);
}

interface AttemptDef {
  name: string;
  model: any; // concrete model types differ per provider
}

const MODELS = {
  claudeText: 'claude-sonnet-4-6',
  claudeVoice: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-3.5-flash',
  openai: 'gpt-4o',
};

interface GenerateResult {
  provider: string;
  content: string;
  usage: unknown;
}

export async function generateAnalysisWithVision(
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  imageMimetype: string
): Promise<GenerateResult> {
  if (anthropicProvider) {
    try {
      const { text, usage } = await generateText({
        model: anthropicProvider(MODELS.claudeText),
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', image: imageBase64, mediaType: imageMimetype },
              { type: 'text', text: userPrompt },
            ],
          },
        ],
        maxOutputTokens: 8000,
      });
      return { provider: 'Claude Vision (Anthropic)', content: text, usage };
    } catch (err) {
      logger.warn({ err }, 'Claude Vision failed -> falling back to text');
    }
  }
  return generateAnalysis(systemPrompt, `[Görsel eklendi — görsel AI kullanılamıyor]\n\n${userPrompt}`);
}

export async function generateAnalysis(systemPrompt: string, userPrompt: string): Promise<GenerateResult> {
  const errors: Array<{ provider: string; error: string }> = [];

  if (anthropicProvider) {
    try {
      const { text, usage } = await generateText({
        model: anthropicProvider(MODELS.claudeText),
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 8000,
      });
      return { provider: 'Claude (Anthropic)', content: text, usage };
    } catch (err) {
      logger.warn({ err }, 'Claude failed -> Gemini');
      errors.push({ provider: 'claude', error: (err as Error).message });
    }
  }

  if (googleProvider) {
    try {
      const { text } = await generateText({
        model: googleProvider(MODELS.gemini),
        system: systemPrompt,
        prompt: userPrompt,
      });
      return { provider: 'Gemini (Google)', content: text, usage: null };
    } catch (err) {
      logger.warn({ err }, 'Gemini failed -> OpenAI');
      errors.push({ provider: 'gemini', error: (err as Error).message });
    }
  }

  if (openaiProvider) {
    try {
      const { text, usage } = await generateText({
        model: openaiProvider.chat(MODELS.openai),
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 8000,
      });
      return { provider: 'GPT-4o (OpenAI)', content: text, usage };
    } catch (err) {
      errors.push({ provider: 'openai', error: (err as Error).message });
    }
  }

  throw new Error(`Tüm AI sağlayıcılar başarısız: ${JSON.stringify(errors)}`);
}

/**
 * Real-time streaming for consultation chat. Providers are tried in order;
 * if a provider errors before producing its first chunk, the next one is
 * tried. Once writing has started (res.writeHead has been called), the
 * provider can no longer be switched — any error after that point ends the
 * stream where it is.
 */
export async function streamConsultationText(
  systemPrompt: string,
  userPrompt: string,
  res: Response
): Promise<{ provider: string; content: string }> {
  const attempts: AttemptDef[] = [
    anthropicProvider ? { name: 'Claude (Anthropic)', model: anthropicProvider(MODELS.claudeText) } : null,
    googleProvider ? { name: 'Gemini (Google)', model: googleProvider(MODELS.gemini) } : null,
    openaiProvider ? { name: 'GPT-4o (OpenAI)', model: openaiProvider.chat(MODELS.openai) } : null,
  ].filter((x): x is AttemptDef => x !== null);

  for (const attempt of attempts) {
    let startedSending = false;
    let full = '';
    try {
      const result = streamText({ model: attempt.model, system: systemPrompt, prompt: userPrompt });
      for await (const chunk of result.textStream) {
        if (!startedSending) {
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-AI-Provider': encodeURIComponent(attempt.name),
            'Cache-Control': 'no-cache',
          });
          startedSending = true;
        }
        full += chunk;
        res.write(chunk);
      }
      res.end();
      return { provider: attempt.name, content: full };
    } catch (err) {
      if (startedSending) {
        // Data has already been sent to the client — no choice but to end the stream here.
        logger.warn({ err, provider: attempt.name }, 'Streaming cut short');
        res.end();
        return { provider: attempt.name, content: full };
      }
      logger.warn({ err, provider: attempt.name }, 'Failed to start streaming, trying next provider');
    }
  }

  throw new Error('Tüm AI sağlayıcılar başarısız');
}

export function getSystemPromptForCategory(category: string): string {
  return buildMasterSystemPrompt(category, false);
}

export function getQuantumSystemPrompt(category: string, realData: RealDataFlags = {}): string {
  return buildMasterSystemPrompt(category, true, realData);
}

export function getScenarioDeepDivePrompt(category: string, scenarioId: string, scenarioSummary: string): string {
  return `${buildMasterSystemPrompt(category, false)}

## GOREV: ALTERNATIF SENARYO DERIN ANALIZI
Kullanici daha once KUANTUM OLASILIK MATRISI'nde belirlenen "${scenarioId}" numarali senaryonun
tam analizini istemektedir.

Senaryo ozeti: ${scenarioSummary}

Bu senaryonun TAM raporunu yaz -- sanki birincil senaryoymus gibi:
- Senaryo nasil gerceklesir? (Tetikleyici olaylar zinciri)
- Turkiye icin etkileri (pozitif/negatif)
- Bu senaryoya hazirlik icin onerilen adimlar
- Bolge bazli koordinatli analiz
- Kurumsal sorumluluk matrisi
- Mali boyut ve kaynak gereksinimi
`;
}

export function getConsultationPrompt(): string {
  const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Sen ANATOLIA-Q Genel Asistanısın.

Tarih: ${today}

Görev:
- Kullanıcının HER konudaki sorusuna yardımcı ol (genel bilgi, teknik, yazılım, hukuk, ekonomi, sağlık, eğitim, gündelik konular vb.).
- Sadece tek bir alanla sınırlı değilsin; normal bir GPT/Claude tarzı genel amaçlı asistansın.

Cevap ilkeleri:
- Türkçe yaz; kullanıcı başka dilde sorarsa o dilde cevap ver.
- Net, doğru, uygulanabilir cevap ver.
- Gerekirse adım adım anlat, örnek ver, kısa/uzun dengeyi soruya göre ayarla.
- Emin olmadığın yerde bunu açıkça belirt; uydurma bilgi verme.
- Kullanıcı isterse aynı konuda derinleş.

Önemli:
- Kullanıcının sorusunu alan dışı diye reddetme.
- Zararlı/tehlikeli taleplerde güvenli alternatif öner.
- Sohbet geçmişini dikkate al ve bağlamı koru.`;
}

export function getStatus(): { claude: boolean; gemini: boolean; openai: boolean } {
  return { claude: !!anthropicProvider, gemini: !!googleProvider, openai: !!openaiProvider };
}

const voiceIntentSchema = z.object({
  actions: z.array(z.object({
    action: z.string(),
    params: z.record(z.string(), z.any()).optional().default({}),
  })),
  speak: z.string(),
});

export type VoiceIntentResult = z.infer<typeof voiceIntentSchema>;

// Uses generateObject (provider-native structured output) instead of free-text
// generation + manual JSON.parse -- the previous approach broke whenever a model
// wrapped its reply in prose/markdown or emitted an unescaped character, which
// made the voice assistant fall back to "could not understand" far too often.
export async function parseVoiceIntent(systemPrompt: string, userMessage: string): Promise<VoiceIntentResult> {
  if (anthropicProvider) {
    try {
      const { object } = await generateObject({
        model: anthropicProvider(MODELS.claudeVoice),
        schema: voiceIntentSchema,
        system: systemPrompt,
        prompt: userMessage,
      });
      return object;
    } catch (err) {
      logger.warn({ err }, '[VoiceIntent] Claude failed, trying Gemini');
    }
  }

  if (googleProvider) {
    try {
      const { object } = await generateObject({
        model: googleProvider(MODELS.gemini),
        schema: voiceIntentSchema,
        system: systemPrompt,
        prompt: userMessage,
      });
      return object;
    } catch (err) {
      logger.warn({ err }, '[VoiceIntent] Gemini failed, trying GPT-4o');
    }
  }

  if (openaiProvider) {
    try {
      const { object } = await generateObject({
        model: openaiProvider.chat(MODELS.openai),
        schema: voiceIntentSchema,
        system: systemPrompt,
        prompt: userMessage,
      });
      return object;
    } catch (err) {
      logger.warn({ err }, '[VoiceIntent] GPT-4o also failed');
    }
  }

  throw new Error('Tüm AI sağlayıcılar başarısız');
}
