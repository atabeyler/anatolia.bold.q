# BCI API — M1 Foundation

BOLD Cyber Intelligence (BCI) platformunun bağımsız backend'i. Bu klasör
ANATOLIA-Q'nun `server/` veya `client/`'ına bağımlı değildir; kendi
`package.json`, kendi veritabanı bağlantısı ve kendi Docker imajına
sahiptir. ANATOLIA-Q, BCI'yi bir servis olarak çağırabilir; BCI hiçbir zaman
ANATOLIA-Q'ya bağımlı olamaz.

## Kapsam (M1)

- Express API iskeleti, request-id + yapılandırılmış (pino) loglama
- Fail-closed env doğrulama (production'da `BCI_DATABASE_URL` zorunlu)
- Kendi PostgreSQL bağlantısı + basit SQL tabanlı migration runner
- Liveness/readiness health endpoint'leri (`/api/v1/health/live`, `/ready`)
- Vitest ile birim testleri
- Bağımsız Dockerfile

RBAC, organizasyon/tenant modeli, asset inventory, job queue, engine
adapter'lar vb. sonraki milestone'larda (M2+) eklenecektir — bu klasörde
henüz yoktur.

## Geliştirme

```bash
npm install --prefix bci
cp bci/.env.example bci/.env
npm run migrate --prefix bci
npm run dev --prefix bci
npm test --prefix bci
```

## Mimari not

```
ANATOLIA-Q  →  BCI Gateway  →  BCI API  →  BCI Database
```

Bağımlılık yönü tektir: ANATOLIA-Q, BCI'yi kullanabilir; BCI, ANATOLIA-Q'yu
hiçbir şekilde import etmez, onun veritabanını paylaşmaz, onun
authentication/authorization sistemini kullanmaz.
