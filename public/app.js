// Tabs
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(t.dataset.tab).classList.add('active');
  });
});

const aed = (n) => (typeof n === 'number' ? 'AED ' + n.toFixed(2) : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function freshStamp(ts, cached) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  return `${cached ? 'Cached' : 'Checked'} ${when}`;
}

function offerCard(o, best) {
  const unit = o.unit_price ? `<div class="unit">${aed(o.unit_price)} ${esc(o.unit || '')}</div>` : '';
  const oos = o.in_stock === false ? '<span class="oos">out of stock</span>' : '';
  const src = o.source_url ? `<div class="src"><a href="${esc(o.source_url)}" target="_blank" rel="noopener">view source ↗</a></div>` : '';
  const notes = o.notes ? `<div class="notes">${esc(o.notes)}</div>` : '';
  return `<div class="card"><div class="offer ${best ? 'best' : ''}">
    <div>
      ${best ? '<span class="badge">CHEAPEST</span><br>' : ''}
      <span class="store">${esc(o.store)}</span> ${oos}
      <div class="prod">${esc(o.product_name || '')} ${o.pack_size ? '· ' + esc(o.pack_size) : ''}</div>
      ${unit}${src}${notes}
    </div>
    <div class="price">${aed(o.price_aed)}</div>
  </div></div>`;
}

// ---- Search ----
const searchForm = document.getElementById('searchForm');
const results = document.getElementById('searchResults');
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (!q) return;
  results.innerHTML = `<div class="loading"><div class="spinner"></div>Checking all Abu Dhabi stores for "${esc(q)}"…</div>`;
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Search failed');
    if (!data.offers.length) {
      results.innerHTML = `<div class="error">No prices found for "${esc(q)}". Try a more specific product name.</div>`;
      return;
    }
    let html = `<div class="stamp">${freshStamp(data.fetched_at, data.cached)} · ${data.offers.length} stores</div>`;
    html += data.offers.map((o, i) => offerCard(o, i === 0)).join('');
    results.innerHTML = html;
  } catch (err) {
    results.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
});

// ---- Basket ----
const basketGo = document.getElementById('basketGo');
const basketResults = document.getElementById('basketResults');
basketGo.addEventListener('click', async () => {
  const items = document.getElementById('basketList').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!items.length) return;
  basketGo.disabled = true;
  basketResults.innerHTML = `<div class="loading"><div class="spinner"></div>Pricing ${items.length} item(s) across every store… this can take a minute.</div>`;
  try {
    const r = await fetch('/api/basket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Basket failed');
    basketResults.innerHTML = renderPlan(data);
  } catch (err) {
    basketResults.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  } finally {
    basketGo.disabled = false;
  }
});

function renderPlan(data) {
  const { plan } = data;
  let html = '';

  // Optimal split
  if (plan.split.lines.length) {
    html += `<div class="summary">
      <div class="lbl">Best store-by-store split</div>
      <div class="big">${aed(plan.split.total)}</div>
      ${plan.savings.splitSavings ? `<div class="save">Saves AED ${plan.savings.splitSavings.toFixed(2)} vs one store</div>` : ''}
    </div><div class="card">`;
    for (const l of plan.split.lines) {
      html += `<div class="line"><span class="q">${esc(l.query)}</span>` +
        (l.pick ? `<span class="v">${esc(l.pick.store)} · <b>${aed(l.pick.price_aed)}</b></span>` : `<span class="miss">no price found</span>`) +
        `</div>`;
    }
    html += `</div>`;
  }

  // Cheapest single store
  if (plan.cheapestStore) {
    const cs = plan.cheapestStore;
    html += `<div class="headline">Cheapest single store: ${esc(cs.store)}</div>`;
    html += `<div class="summary"><div class="lbl">Whole basket at ${esc(cs.store)}</div><div class="big">${aed(cs.total)}</div>
      <div>${cs.have}/${data.items.length} items available here${cs.missing ? ` · ${cs.missing} missing` : ''}</div>
      ${plan.savings.singleStoreSavings ? `<div class="save">Up to AED ${plan.savings.singleStoreSavings.toFixed(2)} cheaper than the priciest store</div>` : ''}
    </div><div class="card">`;
    for (const l of cs.lines) {
      html += `<div class="line"><span class="q">${esc(l.query)}</span>` +
        (l.offer ? `<span class="v">${aed(l.offer.price_aed)}</span>` : `<span class="miss">not sold here</span>`) +
        `</div>`;
    }
    html += `</div>`;
  }

  if (!plan.cheapestStore && !plan.split.lines.length) {
    html = `<div class="error">Couldn't find enough prices to build a plan. Try simpler item names.</div>`;
  }
  return html;
}

// ---- Voice dictation (mic → /api/transcribe → shopping list) ----
const micBtn = document.getElementById('micBtn');
const micStatus = document.getElementById('micStatus');
const basketList = document.getElementById('basketList');
let mediaRecorder = null;
let chunks = [];
let recording = false;

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const m of opts) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; }
  return '';
}

// Turn a spoken sentence ("milk, eggs and some chicken") into list lines.
function toLines(text) {
  return text
    .replace(/\band\b/gi, ',')
    .split(/[,\n]+/)
    .map((s) => s.replace(/^\s*(also|then|some|a|an)\s+/i, '').trim())
    .filter(Boolean);
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    micStatus.textContent = 'Voice input is not supported on this browser.';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMime();
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      micStatus.textContent = 'Transcribing…';
      try {
        const r = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/webm' },
          body: blob,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Transcription failed');
        const items = toLines(data.text || '');
        if (items.length) {
          const cur = basketList.value.trim();
          basketList.value = (cur ? cur + '\n' : '') + items.join('\n');
          micStatus.textContent = `Added ${items.length} item${items.length > 1 ? 's' : ''}. Tap the mic to add more.`;
        } else {
          micStatus.textContent = "Didn't catch any items — try again.";
        }
      } catch (err) {
        micStatus.textContent = err.message;
      }
    };
    mediaRecorder.start();
    recording = true;
    micBtn.classList.add('recording');
    micStatus.textContent = '🎙️ Listening… tap the mic again when you finish your list.';
  } catch (err) {
    micStatus.textContent = err.name === 'NotAllowedError'
      ? 'Microphone permission denied — allow it in your browser to dictate.'
      : 'Could not start the microphone.';
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  recording = false;
  micBtn.classList.remove('recording');
}

micBtn?.addEventListener('click', () => {
  if (recording) stopRecording();
  else startRecording();
});
