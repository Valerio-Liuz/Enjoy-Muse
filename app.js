/* ====== ISI DENGAN DATA PROYEK SUPABASE KAMU ====== */
const SUPABASE_URL = 'https://ptehoxephbznnrybdrkv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0ZWhveGVwaGJ6bm5yeWJkcmt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1MzM1MTMsImV4cCI6MjExMDEwOTUxM30.nFkRzUV59kcy-jvgVG8nqvXHytqIzQIoFrLfUQT92DM';
/* ================================================== */

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const au = $('au');
 
let token = null, user = null, songs = [], playlists = [], plMap = {}, view = 'all';
let queue = [], idx = -1, curId = null, shuffle = false, hist = [], seeking = false;
let mode = 'login', recovering = location.hash.includes('type=recovery');
 
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('show'), 2500); }
const fmt = t => isFinite(t) ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '0:00';
 
/* ---------- Auth ---------- */
function setMode(m) {
  mode = m; $('msg').textContent = '';
  const T = { login: ['Masuk ke akunmu', 'Masuk'], signup: ['Buat akun baru', 'Buat akun'], forgot: ['Kami kirim tautan reset ke email-mu', 'Kirim tautan reset'], reset: ['Buat password baru', 'Simpan password baru'] }[m];
  $('atitle').textContent = T[0]; $('abtn').textContent = T[1];
  $('un').hidden = m !== 'signup'; $('un').required = m === 'signup';
  $('em').hidden = m === 'reset'; $('em').required = m !== 'reset';
  $('pw').hidden = m === 'forgot'; $('pw').required = m !== 'forgot';
  $('pw').placeholder = m === 'reset' ? 'Password baru (min. 6 karakter)' : 'Password (min. 6 karakter)';
  $('alinks').innerHTML = m === 'login'
    ? '<a class="lnk" onclick="setMode(\'signup\')">Buat akun</a> &nbsp; <a class="lnk" onclick="setMode(\'forgot\')">Lupa password?</a>'
    : m === 'reset' ? '' : '<a class="lnk" onclick="setMode(\'login\')">Kembali ke halaman masuk</a>';
}
$('af').onsubmit = async e => {
  e.preventDefault();
  const email = $('em').value.trim(), password = $('pw').value;
  const redirectTo = location.origin + location.pathname;
  $('msg').textContent = 'Memproses…';
  let r;
  if (mode === 'login') r = await sb.auth.signInWithPassword({ email, password });
  else if (mode === 'signup') {
    r = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo, data: { username: $('un').value.trim() } } });
    if (!r.error && !r.data.session) { $('msg').textContent = 'Akun dibuat. Cek email untuk konfirmasi, lalu masuk.'; return; }
  } else if (mode === 'forgot') {
    r = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (!r.error) { $('msg').textContent = 'Tautan reset sudah dikirim. Cek email-mu.'; return; }
  } else {
    r = await sb.auth.updateUser({ password });
    if (!r.error) { recovering = false; touch(); history.replaceState(null, '', location.pathname); toast('Password diperbarui'); start(); return; }
  }
  if (r.error) $('msg').textContent = r.error.message; else touch();
};
 
sb.auth.onAuthStateChange((ev, session) => {
  user = session?.user ?? null; token = session?.access_token ?? null;
  if (ev === 'PASSWORD_RECOVERY' || (recovering && session)) { showAuth('reset'); return; }
  if (session) setTimeout(start, 0); else showAuth('login');
});
function showAuth(m) { $('app').hidden = true; $('auth').hidden = false; setMode(m); stopAll(true); }
 
/* ---------- Data ---------- */
async function start() {
  if (!user || recovering) return;
  if (idleExpired()) { sb.auth.signOut(); toast('Sesi berakhir karena tidak aktif 5 jam'); return; }
  $('auth').hidden = true; $('app').hidden = false;
  $('hello').textContent = 'Halo, ' + (user.user_metadata?.username || user.email);
  const [s, p, ps] = await Promise.all([
    sb.from('songs').select('*').order('created_at', { ascending: false }),
    sb.from('playlists').select('*').order('created_at'),
    sb.from('playlist_songs').select('*')
  ]);
  if (s.error) return toast(s.error.message);
  songs = s.data; playlists = p.data || []; plMap = {};
  (ps.data || []).forEach(r => (plMap[r.playlist_id] ??= new Set()).add(r.song_id));
  render();
  restore();
}
async function restore() {
  if (curId) return;
  const { data } = await sb.from('player_state').select('*').maybeSingle();
  if (!data?.song_id) return;
  const i = songs.findIndex(s => s.id === data.song_id);
  if (i >= 0) play(songs, i, data.position, false);
}
const visible = () => view === 'all' ? songs : view === 'fav' ? songs.filter(s => s.favorite) : songs.filter(s => plMap[view]?.has(s.id));
 
function render() {
  $('nav').innerHTML =
    `<button class="${view === 'all' ? 'on' : ''}" onclick="setView('all')">Semua lagu</button>` +
    `<button class="${view === 'fav' ? 'on' : ''}" onclick="setView('fav')">♥ Favorit</button>` +
    playlists.map(p => `<button class="${view === p.id ? 'on' : ''}" onclick="setView('${p.id}')">${esc(p.name)}</button>`).join('') +
    `<button onclick="newPlaylist()">＋ Playlist baru</button>`;
  const pl = playlists.find(p => p.id === view);
  $('vt').textContent = view === 'all' ? 'Semua lagu' : view === 'fav' ? 'Favorit' : pl?.name || '';
  $('delpl').hidden = !pl;
  const list = visible();
  const opts = '<option value="">＋</option>' + playlists.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('list').innerHTML = list.length ? list.map((s, i) => `
    <div class="row ${s.id === curId ? 'on' : ''}">
      <div class="t" onclick="playFrom(${i})"><b>${esc(s.title)}</b><small>${esc(s.artist || 'Artis tidak diketahui')}</small></div>
      <button class="fav" onclick="toggleFav('${s.id}')" aria-label="Favorit">${s.favorite ? '♥' : '♡'}</button>
      ${playlists.length ? `<select onchange="addToPl('${s.id}',this)" aria-label="Tambah ke playlist">${opts}</select>` : ''}
      ${pl ? `<button onclick="rmFromPl('${s.id}')" title="Keluarkan dari playlist" aria-label="Keluarkan dari playlist">−</button>` : ''}
      <button onclick="openEdit('${s.id}')" title="Ubah judul dan artis" aria-label="Ubah judul dan artis">✎</button>
      <button onclick="delSong('${s.id}')" title="Hapus lagu" aria-label="Hapus lagu">🗑</button>
    </div>`).join('')
    : '<p style="color:var(--mute)">Belum ada lagu di sini. Unggah lagu atau tambahkan dari "Semua lagu".</p>';
}
function setView(v) { view = v; render(); }
 
/* ---------- Playback ---------- */
let lastSave = 0, pendingSeek = 0, urlAt = 0;
async function play(list, i, startAt = 0, auto = true) {
  queue = list; idx = i;
  const s = queue[i]; if (!s) return;
  const { data, error } = await sb.storage.from('songs').createSignedUrl(s.file_path, 7200);
  if (error) return toast('Gagal memuat lagu: ' + error.message);
  curId = s.id; urlAt = Date.now(); pendingSeek = startAt; au.src = data.signedUrl;
  $('pbar').hidden = false;
  if (auto) au.play().catch(() => {});
  saveState(startAt);
  $('np').textContent = s.title + (s.artist ? ' — ' + s.artist : '');
  render();
}
function playFrom(i) { if (curId) hist.push(curId); play(visible(), i); }
function toggle() { if (!au.src) { const l = visible(); if (l.length) play(l, shuffle ? Math.floor(Math.random() * l.length) : 0); return; } if (au.paused && Date.now() - urlAt > 5400000) return play(queue, idx, au.currentTime, true); au.paused ? au.play() : au.pause(); }
function next() {
  if (!queue.length) return;
  if (curId) hist.push(curId);
  let n;
  if (shuffle && queue.length > 1) { do { n = Math.floor(Math.random() * queue.length); } while (n === idx); }
  else n = (idx + 1) % queue.length;
  play(queue, n);
}
function prev() {
  if (!queue.length) return;
  if (au.currentTime > 3) { au.currentTime = 0; return; }
  if (shuffle && hist.length) {
    const id = hist.pop(), n = queue.findIndex(s => s.id === id);
    if (n >= 0) return play(queue, n);
  }
  play(queue, (idx - 1 + queue.length) % queue.length);
}
function stopAll(silent) { $('pbar').hidden = true; pendingSeek = 0; au.pause(); au.removeAttribute('src'); au.load(); curId = null; $('np').textContent = 'Belum ada lagu diputar'; $('seek').value = 0; $('cur').textContent = $('dur').textContent = '0:00'; if (!silent) render(); }
async function stopBtn() { stopAll(); await clearState(); }
async function saveState(pos = au.currentTime) {
  if (!user || !curId) return;
  lastSave = Date.now();
  await sb.from('player_state').upsert({ user_id: user.id, song_id: curId, position: Math.floor(pos || 0), updated_at: new Date().toISOString() });
}
function saveBeacon() {
  try {
    fetch(SUPABASE_URL + '/rest/v1/player_state?on_conflict=user_id', {
      method: 'POST', keepalive: true,
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: user.id, song_id: curId, position: Math.floor(au.currentTime || 0), updated_at: new Date().toISOString() })
    });
  } catch {}
}
async function clearState() { if (user) await sb.from('player_state').delete().eq('user_id', user.id); }
function toggleShuffle() { shuffle = !shuffle; hist = []; $('shuf').classList.toggle('on', shuffle); toast(shuffle ? 'Acak aktif' : 'Acak mati'); }
 
au.onended = next;
au.onplay = () => $('pp').textContent = '⏸';
au.onpause = () => { $('pp').textContent = '▶'; if (!au.ended) saveState(); };
au.onloadedmetadata = () => { $('seek').max = Math.floor(au.duration) || 0; $('dur').textContent = fmt(au.duration); if (pendingSeek) { au.currentTime = Math.min(pendingSeek, au.duration || pendingSeek); $('seek').value = pendingSeek; $('cur').textContent = fmt(pendingSeek); pendingSeek = 0; } };
au.ontimeupdate = () => { if (!seeking) { $('seek').value = au.currentTime; $('cur').textContent = fmt(au.currentTime); } if (!au.paused && Date.now() - lastSave > 10000) saveState(); };
au.onerror = () => { if (au.src) toast('Lagu tidak bisa diputar'); };
$('seek').oninput = e => { seeking = true; $('cur').textContent = fmt(+e.target.value); };
$('seek').onchange = e => { au.currentTime = +e.target.value; seeking = false; saveState(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });
addEventListener('pagehide', () => { if (curId && user && token) saveBeacon(); au.pause(); });
 
/* ---------- Favorit & playlist ---------- */
async function toggleFav(id) {
  const s = songs.find(x => x.id === id), v = !s.favorite;
  const { error } = await sb.from('songs').update({ favorite: v }).eq('id', id);
  if (error) return toast(error.message);
  s.favorite = v; render();
}
async function newPlaylist() {
  const name = prompt('Nama playlist baru:'); if (!name?.trim()) return;
  const { data, error } = await sb.from('playlists').insert({ name: name.trim() }).select().single();
  if (error) return toast(error.message);
  playlists.push(data); view = data.id; render();
}
async function delPlaylist() {
  const p = playlists.find(x => x.id === view);
  if (!p || !confirm(`Hapus playlist "${p.name}"? Lagunya tidak ikut terhapus.`)) return;
  const { error } = await sb.from('playlists').delete().eq('id', p.id);
  if (error) return toast(error.message);
  playlists = playlists.filter(x => x.id !== p.id); delete plMap[p.id]; view = 'all'; render();
}
async function addToPl(songId, sel) {
  const pid = sel.value; sel.value = ''; if (!pid) return;
  const { error } = await sb.from('playlist_songs').insert({ playlist_id: pid, song_id: songId });
  if (error && error.code !== '23505') return toast(error.message);
  (plMap[pid] ??= new Set()).add(songId);
  toast('Ditambahkan ke ' + playlists.find(p => p.id === pid).name);
}
async function rmFromPl(songId) {
  const { error } = await sb.from('playlist_songs').delete().eq('playlist_id', view).eq('song_id', songId);
  if (error) return toast(error.message);
  plMap[view].delete(songId); render();
}
 
/* ---------- Upload & hapus ---------- */
let staged = [];
function openUpload() { renderStaged(); $('upd').showModal(); }
function closeUpload(clear) { if (clear) staged = []; $('upd').close(); }
$('pick').onchange = e => { [...e.target.files].forEach(f => staged.push({ f, artist: '' })); e.target.value = ''; renderStaged(); };
function renderStaged() {
  $('stg').innerHTML = staged.length ? staged.map((x, i) => `
    <div class="srow"><div class="sn" title="${esc(x.f.name)}">${esc(x.f.name)}</div>
      <input type="text" placeholder="Nama artis (wajib)" value="${esc(x.artist)}" oninput="staged[${i}].artist=this.value;this.classList.remove('bad')">
      <button onclick="staged.splice(${i},1);renderStaged()" aria-label="Hapus dari daftar">✕</button></div>`).join('')
    : '<p class="mute">Belum ada file dipilih.</p>';
}
async function doUpload() {
  if (!staged.length) return toast('Pilih file dulu');
  const inputs = [...document.querySelectorAll('#stg input')];
  const bad = inputs.filter((el, i) => !staged[i].artist.trim());
  if (bad.length) { bad.forEach(el => el.classList.add('bad')); bad[0].focus(); return toast('Nama artis wajib diisi untuk semua file'); }
  $('go').disabled = true;
  const items = [...staged], failed = [];
  for (const [n, x] of items.entries()) {
    $('go').textContent = `Mengunggah ${n + 1}/${items.length}…`;
    const f = x.f, safe = f.name.replace(/[^\w.\-]+/g, '_'), path = `${user.id}/${Date.now()}-${safe}`;
    const up = await sb.storage.from('songs').upload(path, f, { contentType: f.type || 'audio/mpeg' });
    if (up.error) { toast('Gagal unggah: ' + up.error.message); failed.push(x); continue; }
    const { data, error } = await sb.from('songs').insert({ title: f.name.replace(/\.[^.]+$/, ''), artist: x.artist.trim(), file_path: path }).select().single();
    if (error) { await sb.storage.from('songs').remove([path]); toast(error.message); failed.push(x); continue; }
    songs.unshift(data); render();
  }
  staged = failed; $('go').disabled = false; $('go').textContent = 'Unggah';
  if (failed.length) { renderStaged(); toast(failed.length + ' file gagal diunggah'); }
  else { $('upd').close(); toast('Selesai'); }
}
async function delSong(id) {
  const s = songs.find(x => x.id === id);
  if (!confirm(`Hapus "${s.title}" secara permanen?`)) return;
  const r1 = await sb.storage.from('songs').remove([s.file_path]);
  if (r1.error) return toast(r1.error.message);
  const { error } = await sb.from('songs').delete().eq('id', id);
  if (error) return toast(error.message);
  songs = songs.filter(x => x.id !== id);
  Object.values(plMap).forEach(set => set.delete(id));
  if (curId === id) stopAll(true);
  render();
}
 
/* ---------- Ubah judul & artis ---------- */
let editId = null;
function openEdit(id) {
  const s = songs.find(x => x.id === id); if (!s) return;
  editId = id; $('etitle').value = s.title; $('eartist').value = s.artist || '';
  $('etitle').classList.remove('bad'); $('eartist').classList.remove('bad');
  $('edd').showModal(); $('etitle').focus();
}
async function saveEdit() {
  const title = $('etitle').value.trim(), artist = $('eartist').value.trim();
  $('etitle').classList.toggle('bad', !title); $('eartist').classList.toggle('bad', !artist);
  if (!title || !artist) return toast('Judul Lagu dan Penyanyi wajib diisi');
  const { error } = await sb.from('songs').update({ title, artist }).eq('id', editId);
  if (error) return toast(error.message);
  const s = songs.find(x => x.id === editId); s.title = title; s.artist = artist;
  if (curId === editId) $('np').textContent = title + ' — ' + artist;
  $('edd').close(); render();
}
['etitle', 'eartist'].forEach(id => $(id).onkeydown = e => { if (e.key === 'Enter') saveEdit(); });
 
/* ---------- Batas tidak aktif 5 jam ---------- */
const IDLE_MS = 5 * 3600 * 1000, IDLE_KEY = 'musikku_last_active';
let lastTouch = 0;
function touch() { try { localStorage.setItem(IDLE_KEY, Date.now()); } catch {} }
function idleExpired() { try { const t = +localStorage.getItem(IDLE_KEY); return t > 0 && Date.now() - t > IDLE_MS; } catch { return false; } }
function onActivity() { const n = Date.now(); if (n - lastTouch > 30000) { lastTouch = n; touch(); } }
['pointerdown', 'keydown', 'touchstart', 'scroll', 'mousemove'].forEach(ev => addEventListener(ev, onActivity, { passive: true }));
function checkIdle() {
  if (!user) return;
  if (au.src && !au.paused && !au.ended) { touch(); return; }  // sedang memutar lagu = aktif
  if (idleExpired()) { sb.auth.signOut(); toast('Sesi berakhir karena tidak aktif 5 jam'); }
}
setInterval(checkIdle, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkIdle(); });
 
setMode('login');
sb.auth.getSession().then(({ data }) => { if (!data.session) showAuth(recovering ? 'login' : 'login'); });
