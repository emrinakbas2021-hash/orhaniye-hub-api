import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of required) if (!process.env[key]) {
  console.error(`Missing required environment variable: ${key}. Copy .env.example to .env and configure it.`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
pool.on('error', err => console.error('Unexpected idle PostgreSQL client error:', err.message));
const app = express();
const production = process.env.NODE_ENV === 'production';
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: frontendOrigin, credentials: true, methods: ['GET','POST','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Çok fazla deneme. Biraz sonra tekrar dene.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api', apiLimiter);
const cookieOptions = { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 };
function sign(user) { return jwt.sign({ sub: String(user.id) }, process.env.JWT_SECRET, { expiresIn: '7d', issuer: 'orhaniye-hub' }); }
async function optionalUser(req, _res, next) {
  try {
    const token = req.cookies.ohub_session;
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'orhaniye-hub' });
      const { rows } = await pool.query('SELECT id, username, display_name, role, status FROM users WHERE id=$1', [payload.sub]);
      if (rows[0]?.status === 'active') req.user = rows[0];
    }
    next();
  } catch { next(); }
}
function requireUser(req, res, next) { if (!req.user) return res.status(401).json({ error: 'Giriş yapmalısın.' }); next(); }
app.use('/api', optionalUser);
app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: 'connected' }); }
  catch (e) { console.error('Health check DB failure:', e.message); res.status(503).json({ ok: false, database: 'unavailable' }); }
});
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const displayName = String(req.body.displayName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^\w{3,20}$/.test(username)) return res.status(400).json({ error: 'Kullanıcı adı 3-20 harf/rakam/alt çizgi olmalı.' });
  if (displayName.length < 1 || displayName.length > 60) return res.status(400).json({ error: 'Görünen ad 1-60 karakter olmalı.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Geçerli e-posta adresi gir.' });
  if (password.length < 10 || password.length > 72) return res.status(400).json({ error: 'Şifre 10-72 karakter olmalı.' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query('INSERT INTO users(username,display_name,email,password_hash,status) VALUES($1,$2,$3,$4,\'pending\') RETURNING id,username,display_name,status,created_at', [username, displayName, email, hash]);
    res.status(201).json({ message: 'Kayıt başvurusu oluşturuldu. Yönetici onayı gerekiyor.', user: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bu kullanıcı adı veya e-posta zaten kayıtlı.' });
    console.error('Register failed:', e.message); res.status(500).json({ error: 'Kayıt sırasında hata oluştu.' });
  }
});
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim(); const password = String(req.body.password || '');
  try {
    const { rows } = await pool.query('SELECT id,username,display_name,role,status,password_hash FROM users WHERE lower(username)=lower($1)', [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    if (user.status === 'pending') return res.status(403).json({ error: 'Hesabın yönetici onayı bekliyor.' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Bu hesap şu anda kullanılamıyor.' });
    res.cookie('ohub_session', sign(user), cookieOptions).json({ user: { id:user.id, username:user.username, displayName:user.display_name, role:user.role } });
  } catch (e) { console.error('Login failed:', e.message); res.status(500).json({ error: 'Giriş sırasında hata oluştu.' }); }
});
app.get('/api/auth/me', requireUser, (req,res) => res.json({ user: { id:req.user.id, username:req.user.username, displayName:req.user.display_name, role:req.user.role } }));
app.post('/api/auth/logout', (_req,res) => res.clearCookie('ohub_session', { ...cookieOptions, maxAge: undefined }).json({ ok:true }));
app.get('/api/videos', async (req,res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '20',10) || 20,1),50);
  const cursor = Number.parseInt(req.query.before || '0',10) || 0;
  try {
    const { rows } = await pool.query(`SELECT v.id,v.title,v.description,v.category,v.video_url,v.thumbnail_url,v.views,v.created_at,u.username,u.display_name
      FROM videos v JOIN users u ON u.id=v.owner_id WHERE v.status='approved' AND ($1::bigint=0 OR v.id<$1) ORDER BY v.id DESC LIMIT $2`, [cursor,limit]);
    res.json({ videos:rows, nextBefore: rows.length===limit ? rows[rows.length-1].id : null });
  } catch(e) { console.error('List videos failed:',e.message); res.status(500).json({error:'Videolar yüklenemedi.'}); }
});
app.post('/api/videos', requireUser, async (req,res) => {
  const title = String(req.body.title || '').trim(); const description = String(req.body.description || '').trim();
  const category = String(req.body.category || 'Kategorisiz').trim();
  const videoUrl = req.body.videoUrl == null ? null : String(req.body.videoUrl).trim();
  const thumbnailUrl = req.body.thumbnailUrl == null ? null : String(req.body.thumbnailUrl).trim();
  if (!title || title.length>160 || description.length>10000 || category.length>80) return res.status(400).json({error:'Başlık, açıklama veya kategori uzunluğu geçersiz.'});
  for (const url of [videoUrl,thumbnailUrl]) if (url && (!/^https:\/\//i.test(url) || url.length>2048)) return res.status(400).json({error:'Video ve görsel adresleri HTTPS olmalı.'});
  try { const { rows } = await pool.query(`INSERT INTO videos(owner_id,title,description,category,video_url,thumbnail_url,status) VALUES($1,$2,$3,$4,$5,$6,'pending') RETURNING id,title,description,category,status,created_at`, [req.user.id,title,description,category,videoUrl,thumbnailUrl]); res.status(201).json({video:rows[0],message:'Video kaydı oluşturuldu ve onay bekliyor.'}); }
  catch(e) { console.error('Create video failed:',e.message); res.status(500).json({error:'Video kaydı oluşturulamadı.'}); }
});
app.post('/api/videos/:id/view', async (req,res) => {
  const id = Number.parseInt(req.params.id,10); if (!Number.isSafeInteger(id) || id<1) return res.status(400).json({error:'Geçersiz video ID.'});
  try { const r=await pool.query("UPDATE videos SET views=views+1 WHERE id=$1 AND status='approved' RETURNING views",[id]); if(!r.rowCount)return res.status(404).json({error:'Video bulunamadı.'}); res.json({views:r.rows[0].views}); }
  catch(e){ console.error('View count failed:',e.message); res.status(500).json({error:'Görüntülenme kaydedilemedi.'}); }
});
app.get('/', (_req,res) => res.json({name:'Orhaniye Hub API',health:'/api/health',docs:'README.md'}));
app.use((err,_req,res,_next)=>{ console.error('Unhandled request error:',err.message); res.status(500).json({error:'Beklenmeyen sunucu hatası.'}); });
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Orhaniye Hub API listening on port ${port}`));
