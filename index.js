require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'school-portal.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 role TEXT NOT NULL CHECK(role IN ('admin','student','staff')),
 login_id TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 must_change_password INTEGER NOT NULL DEFAULT 1,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 type TEXT NOT NULL,
 data TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS records_type_idx ON records(type);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || '';
if (adminEmail && adminPassword && !db.prepare('SELECT id FROM users WHERE role=?').get('admin')) {
  db.prepare('INSERT INTO users(role,login_id,display_name,password_hash,must_change_password) VALUES(?,?,?,?,1)')
    .run('admin', adminEmail, 'School Administrator', bcrypt.hashSync(adminPassword, 12));
  console.log(`Initial admin account created for ${adminEmail}. Change its password after first login.`);
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir }),
  secret: process.env.SESSION_SECRET || 'unsafe-development-secret-change-before-deployment',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const resourceTypes = new Set(['students','staff','classes','subjects','exams','results','attendance','fees','timetable','announcements','parents','library','transport','discipline','documents']);
const safeUser = u => ({ id: u.id, role: u.role, loginId: u.login_id, displayName: u.display_name, mustChangePassword: !!u.must_change_password });
function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:'Please sign in.'}); if(req.session.user.mustChangePassword && !['/password','/me','/logout'].includes(req.path) && !(req.path==='/settings' && req.method==='GET')) return res.status(403).json({error:'Change your initial password before using the portal.'}); next(); }
function adminOnly(req,res,next){ if(!req.session.user || req.session.user.role!=='admin') return res.status(403).json({error:'Only an administrator can make this change.'}); next(); }
function parseRecord(row){ return {id:row.id,...JSON.parse(row.data),createdAt:row.created_at,updatedAt:row.updated_at}; }
function grade(percent){ if(percent>=80)return 'A'; if(percent>=70)return 'B'; if(percent>=60)return 'C'; if(percent>=50)return 'D'; if(percent>=40)return 'E'; return 'F'; }

app.get('/api/health', (req,res)=>res.json({ok:true,service:'School Management Portal'}));
app.post('/api/login', loginLimiter, (req,res)=>{
 const {loginId,password}=req.body||{};
 if(!loginId || !password) return res.status(400).json({error:'Enter your login ID and password.'});
 const id=String(loginId).trim().toLowerCase();
 const user=db.prepare('SELECT * FROM users WHERE login_id=? AND active=1').get(id);
 if(!user || !bcrypt.compareSync(String(password),user.password_hash)) return res.status(401).json({error:'Login details were not recognised. If your admission number has not been registered, contact the administrator at 0716152290 or nyakundi1759@yahoo.com.'});
 req.session.regenerate(err=>{ if(err)return res.status(500).json({error:'Could not start a secure session.'}); req.session.user=safeUser(user); res.json({user:req.session.user}); });
});
app.get('/api/me', auth, (req,res)=>res.json({user:req.session.user}));
app.post('/api/logout', (req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.put('/api/password', auth, (req,res)=>{
 const {currentPassword,newPassword}=req.body||{};
 if(typeof newPassword!=='string'||newPassword.length<10) return res.status(400).json({error:'New password must be at least 10 characters.'});
 const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);
 if(!user || !bcrypt.compareSync(String(currentPassword||''),user.password_hash)) return res.status(400).json({error:'Current password is incorrect.'});
 db.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').run(bcrypt.hashSync(newPassword,12),user.id);
 req.session.user.mustChangePassword=false; res.json({ok:true});
});

// Admin-only account provisioning. Student login ID is the admission number.
app.get('/api/users', auth, adminOnly, (req,res)=>res.json(db.prepare('SELECT id,role,login_id,display_name,active,must_change_password,created_at FROM users ORDER BY role,display_name').all()));
app.post('/api/users', auth, adminOnly, (req,res)=>{
 const {role,loginId,displayName,initialPassword}=req.body||{};
 if(!['student','staff','admin'].includes(role)||!loginId||!displayName) return res.status(400).json({error:'Provide role, login ID and full name.'});
 const normalizedLogin=String(loginId).trim().toLowerCase();
 const passwordToSet=role==='student'?String(loginId).trim():String(initialPassword||'');
 if(!passwordToSet || (role!=='student' && passwordToSet.length<8)) return res.status(400).json({error:'For staff/admin accounts, provide an initial password of at least 8 characters. Student initial passwords are set to their admission number.'});
 try { const info=db.prepare('INSERT INTO users(role,login_id,display_name,password_hash,must_change_password) VALUES(?,?,?,?,1)').run(role,normalizedLogin,String(displayName).trim(),bcrypt.hashSync(passwordToSet,12)); res.status(201).json({id:info.lastInsertRowid,role,loginId:normalizedLogin,displayName,mustChangePassword:true}); }
 catch(e){ if(String(e.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({error:'That login ID already exists.'}); throw e; }
});
app.patch('/api/users/:id', auth, adminOnly, (req,res)=>{
 const {active,displayName,resetPassword}=req.body||{}; const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id); if(!user)return res.status(404).json({error:'Account not found.'});
 if(user.id===req.session.user.id && active===false)return res.status(400).json({error:'You cannot deactivate your own account.'});
 if(displayName!==undefined)db.prepare('UPDATE users SET display_name=? WHERE id=?').run(String(displayName),user.id);
 if(active!==undefined)db.prepare('UPDATE users SET active=? WHERE id=?').run(active?1:0,user.id);
 if(resetPassword){ if(String(resetPassword).length<8)return res.status(400).json({error:'Temporary password must be at least 8 characters.'}); db.prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?').run(bcrypt.hashSync(String(resetPassword),12),user.id); }
 res.json({ok:true});
});
app.delete('/api/users/:id', auth, adminOnly, (req,res)=>{ if(Number(req.params.id)===req.session.user.id)return res.status(400).json({error:'You cannot delete your own account.'}); const info=db.prepare('DELETE FROM users WHERE id=?').run(req.params.id); res.json({deleted:info.changes>0}); });

app.get('/api/settings', auth, (req,res)=>{ const all=db.prepare('SELECT key,value FROM settings').all(); const settings={}; all.forEach(x=>settings[x.key]=x.value); res.json(settings); });
app.put('/api/settings', auth, adminOnly, (req,res)=>{ const allowed=['schoolName','motto','phone','email','address','logoData','coverData','primaryColor','academicYear','currentTerm','currency','adminContact']; const up=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'); for(const k of allowed){if(req.body[k]!==undefined)up.run(k,String(req.body[k]));} res.json({ok:true}); });

app.get('/api/resources/:type', auth, (req,res)=>{ const type=req.params.type; if(!resourceTypes.has(type))return res.status(404).json({error:'Unknown module.'}); let rows=db.prepare('SELECT * FROM records WHERE type=? ORDER BY id DESC').all(type).map(parseRecord); if(req.session.user.role==='student'){ const account=db.prepare('SELECT login_id FROM users WHERE id=?').get(req.session.user.id); if(type==='results')rows=rows.filter(r=>String(r.admissionNumber||'').toLowerCase()===account.login_id); else if(type==='students')rows=rows.filter(r=>String(r.admissionNumber||'').toLowerCase()===account.login_id); else rows=[]; } res.json(rows); });
app.post('/api/resources/:type', auth, adminOnly, (req,res)=>{ const type=req.params.type;if(!resourceTypes.has(type))return res.status(404).json({error:'Unknown module.'}); let data=req.body||{}; if(type==='results')data=calculateResult(data); const info=db.prepare('INSERT INTO records(type,data) VALUES(?,?)').run(type,JSON.stringify(data)); const row=db.prepare('SELECT * FROM records WHERE id=?').get(info.lastInsertRowid); res.status(201).json(parseRecord(row)); });
app.put('/api/resources/:type/:id', auth, adminOnly, (req,res)=>{ const type=req.params.type;if(!resourceTypes.has(type))return res.status(404).json({error:'Unknown module.'}); let data=req.body||{};if(type==='results')data=calculateResult(data);const info=db.prepare('UPDATE records SET data=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND type=?').run(JSON.stringify(data),req.params.id,type);if(!info.changes)return res.status(404).json({error:'Record not found.'});res.json(parseRecord(db.prepare('SELECT * FROM records WHERE id=?').get(req.params.id))); });
app.delete('/api/resources/:type/:id', auth, adminOnly, (req,res)=>{const type=req.params.type;if(!resourceTypes.has(type))return res.status(404).json({error:'Unknown module.'});const info=db.prepare('DELETE FROM records WHERE id=? AND type=?').run(req.params.id,type);res.json({deleted:info.changes>0});});
function calculateResult(data){
 const marks=Array.isArray(data.marks)?data.marks:[]; const clean=marks.map(m=>({subject:String(m.subject||'').trim(),score:Math.max(0,Number(m.score)||0),outOf:Math.max(1,Number(m.outOf)||100)})).filter(m=>m.subject);
 const total=clean.reduce((a,m)=>a+m.score,0), outOf=clean.reduce((a,m)=>a+m.outOf,0); const percentage=outOf?Math.round(total/outOf*10000)/100:0;
 return {...data,marks:clean,totalMarks:total,totalOutOf:outOf,percentage,grade:grade(percentage),resultStatus:clean.length?'Calculated':'Pending'};
}
app.get('/api/report-books', auth, (req,res)=>{
 const rows=db.prepare("SELECT * FROM records WHERE type='results' ORDER BY id DESC").all().map(parseRecord);
 const visible=req.session.user.role==='student'?rows.filter(r=>String(r.admissionNumber||'').toLowerCase()===db.prepare('SELECT login_id FROM users WHERE id=?').get(req.session.user.id).login_id):rows;
 const grouped={}; visible.forEach(r=>{const key=[r.admissionNumber||'',r.studentName||'',r.className||'',r.term||'',r.academicYear||''].join('|');if(!grouped[key])grouped[key]={admissionNumber:r.admissionNumber||'',studentName:r.studentName||'',className:r.className||'',term:r.term||'',academicYear:r.academicYear||'',exams:[]};grouped[key].exams.push({examName:r.examName||'Examination',marks:r.marks||[],totalMarks:r.totalMarks||0,totalOutOf:r.totalOutOf||0,percentage:r.percentage||0,grade:r.grade||'Pending'});});res.json(Object.values(grouped));
});
app.get('/api/dashboard', auth, (req,res)=>{const counts={};for(const type of ['students','staff','classes','subjects','exams','results','attendance','fees','announcements'])counts[type]=db.prepare('SELECT COUNT(*) n FROM records WHERE type=?').get(type).n;res.json({counts,role:req.session.user.role});});
app.use(express.static(path.join(__dirname,'..','public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'An unexpected server error occurred.'});});
app.listen(PORT,()=>console.log(`School portal listening on http://localhost:${PORT}`));
