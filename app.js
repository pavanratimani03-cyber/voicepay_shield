const $ = (id) => document.getElementById(id);
const form = $('verify-form');
const input = $('audio-file');
let selectedFile = null;
let recorder = null;
let stream = null;
let recordingChunks = [];
let checks = [];

const humanSize = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function setFile(file) {
  if (!file) return;
  if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|aac|ogg|webm|flac)$/i.test(file.name)) return showError('Choose an audio file such as WAV, MP3, M4A, or WebM.');
  if (file.size > 20 * 1024 * 1024) return showError('Audio must be smaller than 20 MB.');
  selectedFile = file;
  $('file-name').textContent = file.name;
  $('file-size').textContent = humanSize(file.size);
  $('empty-audio').classList.add('hidden');
  $('selected-audio').classList.remove('hidden');
  $('form-error').classList.add('hidden');
  $('form-info').classList.add('hidden');
}
function clearFile() {
  selectedFile = null; input.value = '';
  $('empty-audio').classList.remove('hidden');
  $('selected-audio').classList.add('hidden');
}
function showError(message) { $('form-error').textContent = message; $('form-error').classList.remove('hidden'); $('form-info').classList.add('hidden'); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

$('browse-btn').addEventListener('click', () => input.click());
input.addEventListener('change', () => setFile(input.files?.[0]));
$('remove-file').addEventListener('click', clearFile);
const drop = $('drop-zone');
drop.addEventListener('click', (event) => { if (event.target === drop || event.target.closest('.audio-empty')) input.click(); });
drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('drag-over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
drop.addEventListener('drop', (event) => { event.preventDefault(); drop.classList.remove('drag-over'); setFile(event.dataTransfer.files?.[0]); });

$('record-btn').addEventListener('click', async () => {
  const button = $('record-btn');
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return showError('Recording is unavailable in this browser. Upload an authorized audio file instead.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined;
    recorder = new MediaRecorder(stream, options);
    recorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(recordingChunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size) setFile(new File([blob], `call-sample-${new Date().toISOString().slice(11, 19).replaceAll(':', '-')}.webm`, { type: blob.type }));
      stream?.getTracks().forEach((track) => track.stop()); stream = null;
      button.classList.remove('recording'); $('record-label').textContent = 'Record a sample'; $('record-hint').textContent = 'Ask consent before recording';
    };
    recorder.start(); button.classList.add('recording'); $('record-label').textContent = 'Stop recording'; $('record-hint').textContent = 'Recording · ask consent first';
    $('form-error').classList.add('hidden');
  } catch { showError('Microphone access was denied or unavailable. Upload an authorized audio sample instead.'); }
});

async function refreshApiStatus() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    const connected = status.configured;
    $('api-chip').classList.toggle('connected', connected);
    $('api-chip').innerHTML = `<span class="status-dot"></span><span>${connected ? 'READY' : 'NOT CONNECTED'}</span>`;
    $('sidebar-api-dot').style.background = connected ? '#54a36e' : '#c1c5bf';
    $('sidebar-api-text').textContent = connected ? 'API ready' : 'API not connected';
    $('api-stat-value').textContent = connected ? 'Ready to verify' : 'Awaiting setup';
    $('api-stat-foot').textContent = connected ? 'Both checks are configured' : 'Add team endpoints to .env';
  } catch {
    $('api-stat-foot').textContent = 'Start the local app server to connect';
  }
}
refreshApiStatus();

function addActivity(name, outcome, passed, time) {
  checks.unshift({ name, outcome, passed, time });
  $('activity-count').textContent = `${checks.length} ${checks.length === 1 ? 'check' : 'checks'}`;
  $('activity-empty').classList.add('hidden');
  $('activity-list').innerHTML = checks.slice(0, 5).map((item) => `<div class="activity-item"><span class="activity-person">${escapeHtml(item.name)}</span><span class="activity-time">${item.time}</span><span class="activity-checks">2 API checks</span><span class="activity-result ${item.passed ? '' : 'block'}">${item.passed ? 'VERIFIED' : 'BLOCKED'}</span></div>`).join('');
}

function renderResult(data, caller) {
  const passed = data.gate === 'verified' && data.checks?.deepfake?.passed === true && data.checks?.speaker?.passed === true;
  $('result-empty').classList.add('hidden');
  $('result-content').classList.remove('hidden');
  const checkRow = (label, check) => {
    const ok = check?.passed === true;
    return `<div class="check-row"><span class="check-mark ${ok ? '' : 'fail'}">${ok ? '✓' : '!'}</span><div class="check-info"><strong>${label}</strong><span>${escapeHtml(check?.signal || 'No explicit pass signal returned')}</span></div><span class="check-status ${ok ? '' : 'fail'}">${ok ? 'PASSED' : 'FAILED'}</span></div>`;
  };
  $('result-content').innerHTML = `<div class="outcome-banner ${passed ? 'pass' : 'block'}"><div class="outcome-kicker">${passed ? 'VOICE CHECK PASSED' : 'PAYMENT HOLD · VERIFY INDEPENDENTLY'}</div><div class="outcome-title">${passed ? 'Caller checks passed' : 'Do not approve this call'}</div><div class="outcome-copy">${escapeHtml(data.message || (passed ? 'Both checks passed.' : 'At least one check did not pass.'))}</div></div>${checkRow('Audio authenticity', data.checks?.deepfake)}${checkRow('Enrolled speaker match', data.checks?.speaker)}<div class="result-meta">Caller · ${escapeHtml(caller)} &nbsp;·&nbsp; ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
  addActivity(caller, passed ? 'VERIFIED' : 'BLOCKED', passed, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  $('form-error').classList.add('hidden'); $('form-info').classList.add('hidden');
  const caller = $('caller').value.trim();
  const speakerId = $('speaker-id').value.trim();
  if (!selectedFile) return showError('Add an authorized audio recording to run the voice checks.');
  if (!caller || !speakerId) return showError('Enter the claimed caller and their enrolled speaker ID.');
  const button = $('verify-btn');
  button.disabled = true; button.querySelector('span:first-child').textContent = 'Checking with DetectifAI…';
  $('form-info').textContent = 'Sending this recording to the configured deepfake and speaker verification APIs.';
  $('form-info').classList.remove('hidden');
  try {
    const body = new FormData(); body.append('audio', selectedFile, selectedFile.name); body.append('caller', caller); body.append('speakerId', speakerId);
    const response = await fetch('/api/verify', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Verification service returned ${response.status}.`);
    $('form-info').classList.add('hidden'); renderResult(data, caller);
  } catch (error) {
    showError(error.message || 'Could not reach the verification service.');
    $('form-info').classList.add('hidden');
  } finally {
    button.disabled = false; button.querySelector('span:first-child').textContent = 'Run voice checks';
  }
});
